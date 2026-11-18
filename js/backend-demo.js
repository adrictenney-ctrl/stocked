// Demo backend: same API as backend-firebase.js, stored in this browser's localStorage.
// Open the app in two tabs to see changes sync between them.
const KEY = 'stocked-demo-v1';
const DAY = 864e5;

export function createDemoBackend() {
  let db = load();
  const watchers = new Set();
  const authCbs = new Set();

  function blank() { return { users: {}, session: null, lists: {}, items: {}, shopping: {}, counts: {} }; }
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch {}
    return blank();
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} }
  function commit() { persist(); watchers.forEach((w) => w()); }

  addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    const prev = db.session;
    db = load();
    if (db.session !== prev) emitAuth();
    watchers.forEach((w) => w());
  });

  const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const wait = (ms = 90) => new Promise((r) => setTimeout(r, ms));
  const err = (code, message) => Object.assign(new Error(message || code), { code });
  const pub = (u) => (u ? { uid: u.uid, name: u.name, email: u.email } : null);
  const me = () => (db.session ? db.users[db.session] : null);
  const col = (name, listId) => (db[name][listId] ||= {});
  const lower = (e) => String(e || '').trim().toLowerCase();

  function emitAuth() { const u = pub(me()); authCbs.forEach((cb) => cb(u)); }

  function watch(compute, cb) {
    let last;
    const w = () => {
      const v = JSON.stringify(compute() ?? null);
      if (v !== last) { last = v; cb(JSON.parse(v)); }
    };
    watchers.add(w);
    setTimeout(w, 60);
    return () => watchers.delete(w);
  }

  function getList(listId) {
    const l = db.lists[listId];
    if (!l) throw err('not-found', 'That list no longer exists.');
    return l;
  }
  function need(listId, roles) {
    const r = getList(listId).members[db.session]?.role;
    if (!r || (roles && !roles.includes(r))) throw err('permission-denied');
  }

  function seed(uid) {
    const u = db.users[uid];
    const fake = (name, email) => {
      const found = Object.values(db.users).find((x) => x.emailLower === email);
      if (found) return found.uid;
      const id = newId();
      db.users[id] = { uid: id, name, email, emailLower: email, fake: true };
      return id;
    };
    const sam = fake('Sam Ortiz', 'sam@example.com');
    const riley = fake('Riley Chen', 'riley@example.com');
    fake('Jordan Park', 'jordan@example.com');

    const now = Date.now();
    const last = now - 8 * DAY;
    const lid = newId();
    db.lists[lid] = {
      id: lid, name: 'Home pantry', emoji: '🥕', ownerId: uid,
      members: {
        [uid]: { role: 'manager', name: u.name, email: u.email },
        [sam]: { role: 'stocker', name: 'Sam Ortiz', email: 'sam@example.com' },
        [riley]: { role: 'shopper', name: 'Riley Chen', email: 'riley@example.com' },
      },
      memberIds: [uid, sam, riley], createdAt: now - 40 * DAY, lastCountAt: last, countEveryDays: 7,
    };

    const stock = [
      ['Milk', 'Dairy & eggs', 'gal', 2, 1], ['Eggs', 'Dairy & eggs', 'dozen', 2, 2], ['Butter', 'Dairy & eggs', 'sticks', 4, 1],
      ['Bananas', 'Produce', '', 6, 2], ['Apples', 'Produce', '', 8, 8], ['Spinach', 'Produce', 'bags', 1, 0],
      ['Chicken thighs', 'Meat & fish', 'lb', 3, 1], ['Sandwich bread', 'Bakery', 'loaves', 2, 1],
      ['Rice', 'Pantry', 'bags', 1, 1], ['Pasta', 'Pantry', 'boxes', 4, 3], ['Crushed tomatoes', 'Pantry', 'cans', 6, 2],
      ['Coffee', 'Pantry', 'bags', 1, 0], ['Frozen peas', 'Frozen', 'bags', 2, 2],
      ['Sparkling water', 'Drinks', 'cans', 12, 5], ['Paper towels', 'Household', 'rolls', 6, 4],
    ];
    const items = col('items', lid), shop = col('shopping', lid), counts = col('counts', lid);
    const results = [];
    for (const [name, category, unit, target, current] of stock) {
      const id = newId();
      items[id] = { id, name, category, unit, target, current, lastCountedAt: last, createdAt: now - 40 * DAY };
      results.push({ itemId: id, name, unit, category, target, counted: current, short: Math.max(0, target - current) });
    }
    const samBy = { uid: sam, name: 'Sam Ortiz' };
    for (const r of results.filter((r) => r.short > 0)) {
      const id = newId();
      shop[id] = { id, name: r.name, qty: r.short, unit: r.unit, category: r.category, source: 'inventory', itemId: r.itemId, status: 'needed', addedBy: samBy, createdAt: last };
    }
    // Riley already picked up the bananas.
    const bananas = Object.values(shop).find((s) => s.name === 'Bananas');
    Object.assign(bananas, { status: 'picked', pickedBy: { uid: riley, name: 'Riley Chen' }, pickedAt: now - 2.5 * 3600e3 });
    items[bananas.itemId].current += bananas.qty;
    const cid = newId();
    shop[cid] = { id: cid, name: 'Birthday candles', qty: 1, unit: 'box', category: 'Other', source: 'manual', status: 'needed', addedBy: { uid: riley, name: 'Riley Chen' }, createdAt: now - 26 * 3600e3 };

    const c1 = newId(), c2 = newId();
    counts[c1] = { id: c1, takenAt: last, takenBy: samBy, results };
    counts[c2] = {
      id: c2, takenAt: last - 7 * DAY, takenBy: { uid, name: u.name },
      results: results.map((r, i) => { const counted = i % 4 === 0 ? Math.max(0, r.target - 1) : r.target; return { ...r, counted, short: r.target - counted }; }),
    };
  }

  return {
    mode: 'demo',

    onAuth(cb) { authCbs.add(cb); setTimeout(() => cb(pub(me())), 120); return () => authCbs.delete(cb); },

    async signUp(name, email, password) {
      await wait();
      const e = lower(email);
      if (!/^\S+@\S+\.\S+$/.test(e)) throw err('auth/invalid-email');
      if (String(password).length < 6) throw err('auth/weak-password');
      if (Object.values(db.users).some((u) => u.emailLower === e)) throw err('auth/email-already-in-use');
      const uid = newId();
      db.users[uid] = { uid, name: name.trim(), email: email.trim(), emailLower: e };
      seed(uid);
      db.session = uid;
      commit(); emitAuth();
      return pub(db.users[uid]);
    },

    async signIn(email, password) {
      await wait();
      const u = Object.values(db.users).find((x) => x.emailLower === lower(email) && !x.fake);
      if (!u || String(password).length < 6) throw err('auth/invalid-credential');
      db.session = u.uid;
      commit(); emitAuth();
    },

    async signOut() { db.session = null; commit(); emitAuth(); },

    async resetDemo() { localStorage.removeItem(KEY); db = blank(); commit(); emitAuth(); },

    watchMyLists(uid, cb) {
      return watch(() => Object.values(db.lists).filter((l) => l.memberIds.includes(uid)).sort((a, b) => a.createdAt - b.createdAt), cb);
    },
    watchList(listId, cb) {
      return watch(() => { const l = db.lists[listId]; return l && l.memberIds.includes(db.session) ? l : null; }, cb);
    },
    watchItems(listId, cb) { return watch(() => Object.values(col('items', listId)), cb); },
    watchShopping(listId, cb) { return watch(() => Object.values(col('shopping', listId)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)), cb); },
    watchCounts(listId, cb) { return watch(() => Object.values(col('counts', listId)).sort((a, b) => b.takenAt - a.takenAt).slice(0, 8), cb); },

    async createList({ name, emoji }, user) {
      await wait();
      const id = newId();
      db.lists[id] = {
        id, name, emoji, ownerId: user.uid,
        members: { [user.uid]: { role: 'manager', name: user.name, email: user.email } },
        memberIds: [user.uid], createdAt: Date.now(), lastCountAt: null, countEveryDays: 7,
      };
      commit();
      return id;
    },
    async updateList(listId, patch) { await wait(); need(listId, ['manager']); Object.assign(getList(listId), patch); commit(); },
    async deleteList(listId) {
      await wait();
      if (getList(listId).ownerId !== db.session) throw err('permission-denied');
      delete db.lists[listId]; delete db.items[listId]; delete db.shopping[listId]; delete db.counts[listId];
      commit();
    },

    async addMemberByEmail(listId, email, role) {
      await wait();
      need(listId, ['manager']);
      const u = Object.values(db.users).find((x) => x.emailLower === lower(email));
      if (!u) throw err('no-user');
      const l = getList(listId);
      if (l.memberIds.includes(u.uid)) throw err('already-member', `${u.name} is already on this list.`);
      l.members[u.uid] = { role, name: u.name, email: u.email };
      l.memberIds.push(u.uid);
      commit();
      return pub(u);
    },
    async setMemberRole(listId, uid, role) {
      await wait(); need(listId, ['manager']);
      const l = getList(listId);
      if (uid === l.ownerId) throw err('permission-denied');
      l.members[uid].role = role; commit();
    },
    async removeMember(listId, uid) {
      await wait();
      const l = getList(listId);
      if (uid !== db.session) need(listId, ['manager']);
      if (uid === l.ownerId) throw err('permission-denied');
      delete l.members[uid];
      l.memberIds = l.memberIds.filter((x) => x !== uid);
      commit();
    },

    async addItem(listId, item) { await wait(); need(listId, ['manager', 'stocker']); const id = newId(); col('items', listId)[id] = { id, ...item, createdAt: Date.now() }; commit(); },
    async updateItem(listId, itemId, patch) { await wait(); need(listId, ['manager', 'stocker']); Object.assign(col('items', listId)[itemId], patch); commit(); },
    async deleteItem(listId, itemId) { await wait(); need(listId, ['manager', 'stocker']); delete col('items', listId)[itemId]; commit(); },

    async addShopping(listId, entry) { await wait(); need(listId); const id = newId(); col('shopping', listId)[id] = { id, ...entry, createdAt: Date.now() }; commit(); },
    async deleteShopping(listId, ids) {
      await wait(); need(listId);
      const shop = col('shopping', listId);
      const r = getList(listId).members[db.session].role;
      for (const id of ids) {
        if (r === 'shopper' && shop[id]?.addedBy?.uid !== db.session) throw err('permission-denied');
        delete shop[id];
      }
      commit();
    },
    async setPicked(listId, entry, picked, user, bump) {
      await wait(60); need(listId);
      const e = col('shopping', listId)[entry.id];
      if (!e) return;
      e.status = picked ? 'picked' : 'needed';
      e.pickedBy = picked ? { uid: user.uid, name: user.name } : null;
      e.pickedAt = picked ? Date.now() : null;
      if (bump) {
        const it = col('items', listId)[entry.itemId];
        if (it) it.current = Math.max(0, (Number(it.current) || 0) + (picked ? 1 : -1) * (Number(entry.qty) || 0));
      }
      commit();
    },

    async saveCount(listId, { results, staleIds, user }) {
      await wait(); need(listId, ['manager', 'stocker']);
      const now = Date.now();
      const items = col('items', listId), shop = col('shopping', listId);
      for (const r of results) if (items[r.itemId]) Object.assign(items[r.itemId], { current: r.counted, lastCountedAt: now });
      for (const id of staleIds) delete shop[id];
      const by = { uid: user.uid, name: user.name };
      for (const r of results.filter((r) => r.short > 0)) {
        const id = newId();
        shop[id] = { id, name: r.name, qty: r.short, unit: r.unit, category: r.category, source: 'inventory', itemId: r.itemId, status: 'needed', addedBy: by, createdAt: now };
      }
      const cid = newId();
      col('counts', listId)[cid] = { id: cid, takenAt: now, takenBy: by, results };
      getList(listId).lastCountAt = now;
      commit();
    },
  };
}
