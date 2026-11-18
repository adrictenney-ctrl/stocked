// Firebase backend: Firebase Auth (email + password) and Cloud Firestore with live updates.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, updateProfile, GoogleAuthProvider, signInWithPopup,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, getDocs, onSnapshot, query, where,
  orderBy, limit, writeBatch, serverTimestamp, arrayUnion, arrayRemove, deleteField, increment,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

export function createFirebaseBackend(config) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);

  const listRef = (id) => doc(db, 'lists', id);
  const sub = (id, name) => collection(db, 'lists', id, name);
  const lower = (e) => String(e || '').trim().toLowerCase();
  const err = (code, message) => Object.assign(new Error(message || code), { code });

  // Turn a Firestore doc into a plain object; timestamps become milliseconds.
  const norm = (d) => {
    const o = { id: d.id, ...d.data({ serverTimestamps: 'estimate' }) };
    for (const k in o) if (o[k] && typeof o[k].toMillis === 'function') o[k] = o[k].toMillis();
    return o;
  };
  const docs = (qs) => qs.docs.map(norm);

  const toUser = (u) => (u ? { uid: u.uid, name: u.displayName || u.email.split('@')[0], email: u.email } : null);

  async function saveProfile(u, name) {
    await setDoc(doc(db, 'users', u.uid), {
      name: name || u.displayName || u.email.split('@')[0], email: u.email, emailLower: lower(u.email),
    }, { merge: true });
  }

  return {
    mode: 'firebase',

    onAuth(cb) { return onAuthStateChanged(auth, (u) => cb(toUser(u))); },

    async signUp(name, email, password) {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(cred.user, { displayName: name.trim() });
      await saveProfile(cred.user, name.trim());
      return toUser(cred.user);
    },
    async signIn(email, password) {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      saveProfile(cred.user).catch(() => {});
    },
    async signInWithGoogle() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const cred = await signInWithPopup(auth, provider);
      await saveProfile(cred.user);
    },
    signOut() { return signOut(auth); },

    watchMyLists(uid, cb, onErr) {
      const q = query(collection(db, 'lists'), where('memberIds', 'array-contains', uid));
      return onSnapshot(q, (qs) => cb(docs(qs).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))), onErr);
    },
    watchList(listId, cb, onErr) {
      return onSnapshot(listRef(listId), (d) => cb(d.exists() ? norm(d) : null), () => (onErr ? onErr() : cb(null)));
    },
    watchItems(listId, cb, onErr) { return onSnapshot(sub(listId, 'items'), (qs) => cb(docs(qs)), onErr); },
    watchShopping(listId, cb, onErr) {
      return onSnapshot(sub(listId, 'shopping'), (qs) => cb(docs(qs).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))), onErr);
    },
    watchCounts(listId, cb, onErr) {
      return onSnapshot(query(sub(listId, 'counts'), orderBy('takenAt', 'desc'), limit(8)), (qs) => cb(docs(qs)), onErr);
    },

    async createList({ name, emoji }, user) {
      const ref = await addDoc(collection(db, 'lists'), {
        name, emoji, ownerId: user.uid,
        members: { [user.uid]: { role: 'manager', name: user.name, email: user.email } },
        memberIds: [user.uid], createdAt: serverTimestamp(), lastCountAt: null, countEveryDays: 7,
      });
      return ref.id;
    },
    updateList(listId, patch) { return updateDoc(listRef(listId), patch); },
    async deleteList(listId) {
      const batch = writeBatch(db);
      for (const name of ['items', 'shopping', 'counts']) {
        (await getDocs(sub(listId, name))).forEach((d) => batch.delete(d.ref));
      }
      batch.delete(listRef(listId));
      await batch.commit();
    },

    async addMemberByEmail(listId, email, role) {
      const qs = await getDocs(query(collection(db, 'users'), where('emailLower', '==', lower(email)), limit(1)));
      if (qs.empty) throw err('no-user');
      const u = { uid: qs.docs[0].id, ...qs.docs[0].data() };
      await updateDoc(listRef(listId), {
        [`members.${u.uid}`]: { role, name: u.name, email: u.email },
        memberIds: arrayUnion(u.uid),
      });
      return u;
    },
    setMemberRole(listId, uid, role) { return updateDoc(listRef(listId), { [`members.${uid}.role`]: role }); },
    removeMember(listId, uid) {
      return updateDoc(listRef(listId), { [`members.${uid}`]: deleteField(), memberIds: arrayRemove(uid) });
    },

    addItem(listId, item) { return addDoc(sub(listId, 'items'), { ...item, createdAt: serverTimestamp() }); },
    updateItem(listId, itemId, patch) { return updateDoc(doc(db, 'lists', listId, 'items', itemId), patch); },
    deleteItem(listId, itemId) {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'lists', listId, 'items', itemId));
      return batch.commit();
    },

    addShopping(listId, entry) { return addDoc(sub(listId, 'shopping'), { ...entry, createdAt: serverTimestamp() }); },
    deleteShopping(listId, ids) {
      const batch = writeBatch(db);
      ids.forEach((id) => batch.delete(doc(db, 'lists', listId, 'shopping', id)));
      return batch.commit();
    },
    setPicked(listId, entry, picked, user, bump) {
      const batch = writeBatch(db);
      batch.update(doc(db, 'lists', listId, 'shopping', entry.id), {
        status: picked ? 'picked' : 'needed',
        pickedBy: picked ? { uid: user.uid, name: user.name } : null,
        pickedAt: picked ? serverTimestamp() : null,
      });
      if (bump) {
        batch.update(doc(db, 'lists', listId, 'items', entry.itemId), {
          current: increment((picked ? 1 : -1) * (Number(entry.qty) || 0)),
          updatedAt: serverTimestamp(),
        });
      }
      return batch.commit();
    },

    saveCount(listId, { results, staleIds, user }) {
      const batch = writeBatch(db);
      const by = { uid: user.uid, name: user.name };
      for (const r of results) {
        batch.update(doc(db, 'lists', listId, 'items', r.itemId), { current: r.counted, lastCountedAt: serverTimestamp() });
      }
      for (const id of staleIds) batch.delete(doc(db, 'lists', listId, 'shopping', id));
      for (const r of results.filter((r) => r.short > 0)) {
        batch.set(doc(sub(listId, 'shopping')), {
          name: r.name, qty: r.short, unit: r.unit, category: r.category, source: 'inventory', itemId: r.itemId,
          status: 'needed', addedBy: by, createdAt: serverTimestamp(),
        });
      }
      batch.set(doc(sub(listId, 'counts')), { takenAt: serverTimestamp(), takenBy: by, results });
      batch.update(listRef(listId), { lastCountAt: serverTimestamp() });
      return batch.commit();
    },
  };
}
