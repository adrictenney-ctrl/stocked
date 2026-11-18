import { backend, DEMO } from './backend.js';

/* ---------------------------------------------------------------- constants */

const CATEGORIES = ['Produce', 'Dairy & eggs', 'Meat & fish', 'Bakery', 'Pantry', 'Frozen', 'Drinks', 'Snacks', 'Household', 'Other'];
const UNITS = ['cans', 'boxes', 'bags', 'bottles', 'jars', 'lb', 'oz', 'kg', 'g', 'gal', 'L', 'dozen', 'loaves', 'packs', 'rolls', 'sticks'];
const ROLES = {
  manager: { label: 'Manager', desc: 'Does everything: edits the pantry, takes counts, adds people and changes their roles.' },
  stocker: { label: 'Stocker', desc: 'Edits the pantry and takes the weekly count.' },
  shopper: { label: 'Shopper', desc: 'Sees what to buy, marks things picked up, and adds requests.' },
};
const EMOJIS = ['🥕', '🍎', '🧀', '🥫', '🥖', '🍳', '🧺', '🏠', '🌿', '🍋'];
const TABS = ['shop', 'pantry', 'count', 'people'];
const DAY = 864e5;

/* ---------------------------------------------------------------- state */

const state = {
  user: null, authReady: false, authMode: 'signin', authError: '', busy: false,
  lists: [], listId: null, list: null, items: [], shopping: [], counts: [],
  loaded: { items: false, shopping: false },
  tab: 'shop', counting: false, countDraft: {}, openCount: null, drafts: {},
};
const subs = { lists: null, list: [] };
const app = document.getElementById('app');
const dlg = document.getElementById('dialog');

/* ---------------------------------------------------------------- helpers */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fmt = (n) => { const v = num(n); return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100); };
const SINGULAR = { cans: 'can', boxes: 'box', bags: 'bag', bottles: 'bottle', jars: 'jar', loaves: 'loaf', packs: 'pack', rolls: 'roll', sticks: 'stick', cartons: 'carton', bunches: 'bunch', heads: 'head' };
const unitFor = (q, u) => (num(q) === 1 && SINGULAR[String(u).toLowerCase()]) || u;
const qtyUnit = (q, u) => `${fmt(q)}${u ? ` ${esc(unitFor(q, u))}` : ''}`;
const val = (key, fallback = '') => esc(state.drafts[key] ?? fallback);
const firstName = (n) => String(n || '').split(' ')[0];

function ago(ms) {
  if (!ms) return 'never';
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  const m = s / 60; if (m < 60) return `${Math.floor(m)} min ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)} hr ago`;
  const d = Math.floor(h / 24); if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const longDay = (ms) => new Date(ms).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

function groupByCategory(rows) {
  const map = new Map();
  for (const r of rows) {
    const c = CATEGORIES.includes(r.category) ? r.category : 'Other';
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(r);
  }
  return CATEGORIES.filter((c) => map.has(c)).map((c) => [c, map.get(c).sort((a, b) => a.name.localeCompare(b.name))]);
}

function friendlyError(e) {
  const code = e?.code || '';
  const map = {
    'auth/invalid-credential': "That email and password don't match an account.",
    'auth/wrong-password': "That email and password don't match an account.",
    'auth/user-not-found': "That email and password don't match an account.",
    'auth/email-already-in-use': 'An account already uses that email. Sign in instead.',
    'auth/weak-password': 'Use at least 6 characters for the password.',
    'auth/invalid-email': 'Enter a full email address, like sam@example.com.',
    'auth/too-many-requests': 'Too many tries. Wait a minute, then try again.',
    'auth/invalid-action-code': 'That sign-in link has expired or was already used. Send yourself a new one.',
    'auth/expired-action-code': 'That sign-in link has expired. Send yourself a new one.',
    'auth/invalid-continue-uri': "This web address isn't allowed for sign-in links yet. Add it under Authentication → Settings → Authorized domains in Firebase.",
    'auth/unauthorized-continue-uri': "This web address isn't allowed for sign-in links yet. Add it under Authentication → Settings → Authorized domains in Firebase.",
    'auth/operation-not-allowed': "That sign-in method isn't turned on in Firebase yet.",
    'auth/quota-exceeded': 'Too many sign-in emails were sent today. Try again tomorrow, or use a password.',
    'auth/popup-blocked': 'Your browser blocked the Google window. Allow pop-ups for this site, then try again.',
    'auth/account-exists-with-different-credential': 'That email already signs in with a password. Use email and password instead.',
    'auth/unauthorized-domain': "This web address isn't allowed to sign in yet. Add it under Authentication → Settings → Authorized domains in Firebase.",
    'auth/network-request-failed': "Can't reach the server. Check your connection.",
    'permission-denied': "Your role on this list can't do that.",
    'no-user': 'No Stocked account uses that email yet. Ask them to create one, then add them again.',
  };
  return map[code] || e?.message || 'Something went wrong. Try again.';
}

const myRole = () => state.list?.members?.[state.user?.uid]?.role;
const canEdit = () => ['manager', 'stocker'].includes(myRole());
const isManager = () => myRole() === 'manager';
const isOwner = () => state.list?.ownerId === state.user?.uid;

function countStatus(list) {
  const every = num(list?.countEveryDays) || 7;
  const last = list?.lastCountAt;
  if (!last) return { due: true, every, days: null };
  const days = Math.floor((Date.now() - last) / DAY);
  return { due: days >= every, every, days, nextIn: Math.max(0, every - days) };
}

/* ---------------------------------------------------------------- icons */

const svg = (d, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  basket: svg('<path d="M4 10h16l-1.6 9.1a2 2 0 0 1-2 1.6H7.6a2 2 0 0 1-2-1.6z"/><path d="M8.5 10 12 4l3.5 6"/><path d="M9 14v3M15 14v3"/>'),
  shelf: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M8 6h3M8 12h6M8 18h2"/>'),
  clip: svg('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2.5h6v3H9z"/><path d="m9 13 2 2 4-4"/>'),
  people: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16.5 14.2A5 5 0 0 1 21.5 19"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 'icon-check'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>'),
  logout: svg('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
};

/* ---------------------------------------------------------------- stock meter */

const stockPct = (current, target) => (num(target) > 0 ? clamp(num(current) / num(target), 0, 1) : num(current) > 0 ? 1 : 0);
const stockLevel = (p) => (p >= 1 ? 'ok' : p >= 0.5 ? 'low' : 'out');

// A slim bar showing how much is on hand compared to the amount to keep.
function meter(current, target) {
  const p = stockPct(current, target);
  return `<span class="meter meter-${stockLevel(p)}" data-meter aria-hidden="true"><span style="width:${Math.round(p * 100)}%"></span></span>`;
}

function setMeter(el, current, target) {
  if (!el) return;
  const p = stockPct(current, target);
  el.className = `meter meter-${stockLevel(p)}`;
  el.firstElementChild.style.width = `${Math.round(p * 100)}%`;
}

const logo = () => `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" class="logo-bg"/><rect x="8" y="9" width="16" height="3.2" rx="1.6" class="logo-bar"/><rect x="8" y="14.4" width="11" height="3.2" rx="1.6" class="logo-bar"/><rect x="8" y="19.8" width="6" height="3.2" rx="1.6" class="logo-bar"/></svg>`;

const AVATAR_TINTS = 5;
function avatar(name, size = '') {
  const n = String(name || '?');
  let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `<span class="avatar tint-${h % AVATAR_TINTS} ${size}" aria-hidden="true">${esc(n.trim()[0]?.toUpperCase() || '?')}</span>`;
}

/* ---------------------------------------------------------------- render */

function render() {
  const a = document.activeElement;
  const key = a && app.contains(a) ? a.dataset.key : null;
  let sel = null;
  try { sel = key ? [a.selectionStart, a.selectionEnd] : null; } catch {}

  app.innerHTML = view();

  if (key) {
    const el = app.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (el) { el.focus({ preventScroll: true }); try { if (sel?.[0] != null) el.setSelectionRange(...sel); } catch {} }
  }
}

function view() {
  if (!state.authReady) return `<div class="splash">${logo()}</div>`;
  if (!state.user) return viewAuth();
  if (!state.listId) return viewHome();
  return viewList();
}

/* ---- auth */

function viewAuth() {
  const up = state.authMode === 'signup';
  return `<div class="auth">
    <section class="auth-hero">
      <div class="brand brand-light">${logo()}<span>Stocked</span></div>
      <h1 class="auth-title">Count the pantry once a week. Stocked tells your shoppers what to buy.</h1>
      <div class="hero-card" aria-hidden="true">
        <p class="hero-card-title">To pick up this week</p>
        <div class="hero-row is-done"><span class="hero-check">${I.check}</span><span>Milk</span><span>2 gal</span></div>
        <div class="hero-row"><span class="hero-check"></span><span>Eggs</span><span>1 dozen</span></div>
        <div class="hero-row"><span class="hero-check"></span><span>Coffee</span><span>1 bag</span></div>
      </div>
      <ul class="auth-points">
        <li>Share one list with everyone in the house</li>
        <li>Set how much of each thing you like to keep</li>
        <li>Anything that runs short lands on the shopping list</li>
      </ul>
    </section>
    <section class="auth-panel">
      ${authCard()}
      ${DEMO ? `<p class="demo-note"><strong>Demo mode.</strong> Accounts and lists here are saved in this browser only, not shared. New accounts start with a sample pantry.</p>` : ''}
    </section>
  </div>`;
}

const GOOGLE_G = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.2-4.8 3.2-8z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z"/></svg>`;

function authCard() {
  const mode = state.authMode;
  const err = state.authError ? `<p class="form-error" role="alert">${esc(state.authError)}</p>` : '';
  const busy = state.busy ? 'disabled' : '';
  const email = () => `<label class="field"><span class="label">Email</span><input class="input" name="email" type="email" data-key="auth-email" value="${val('auth-email')}" autocomplete="email" required></label>`;
  const switchTo = (label, to) => `<button type="button" class="link" data-action="auth-mode" data-to="${to}">${label}</button>`;

  if (mode === 'linking') {
    return `<div class="auth-card"><h2>Signing you in…</h2><p class="sub">One moment while we check your sign-in link.</p></div>`;
  }

  if (mode === 'link-sent') {
    return `<div class="auth-card">
      <div class="sent-icon" aria-hidden="true">${I.mail}</div>
      <h2>Check your email</h2>
      <p class="sub">We sent a sign-in link to <strong>${esc(state.drafts['auth-email'] || 'your email')}</strong>. Open it on this device to finish signing in. It can take a minute, and sometimes lands in spam.</p>
      ${err}
      <button type="button" class="btn btn-ghost btn-block" data-action="resend-link" ${busy}>${state.busy ? 'Sending…' : 'Send the link again'}</button>
      <p class="auth-switch">Wrong address? ${switchTo('Use a different email', 'link')}</p>
    </div>`;
  }

  if (mode === 'link-confirm') {
    return `<form class="auth-card" data-form="auth" novalidate>
      <h2>Confirm your email</h2>
      <p class="sub">This sign-in link was opened in a different browser or device than the one that asked for it. Enter the same email to finish.</p>
      ${email()}
      ${err}
      <button class="btn btn-primary btn-block" ${busy}>${state.busy ? 'One moment…' : 'Finish signing in'}</button>
      <p class="auth-switch">${switchTo('Cancel', 'signin')}</p>
    </form>`;
  }

  if (mode === 'link') {
    return `<form class="auth-card" data-form="auth" novalidate>
      <h2>Sign in with a link</h2>
      <p class="sub">No password needed. We'll email you a link that signs you in.</p>
      ${email()}
      <label class="field"><span class="label">Your name</span><input class="input" name="name" data-key="auth-name" value="${val('auth-name')}" autocomplete="name"><span class="hint">Only needed the first time, so others on your lists know who you are.</span></label>
      ${err}
      <button class="btn btn-primary btn-block" ${busy}>${state.busy ? 'Sending…' : 'Email me a link'}</button>
      <p class="auth-switch">${switchTo('Use a password instead', 'signin')}</p>
    </form>`;
  }

  const up = mode === 'signup';
  return `<form class="auth-card" data-form="auth" novalidate>
    <h2>${up ? 'Create your account' : 'Welcome back'}</h2>
    <p class="sub">${up ? 'You can make a list and invite people right after.' : 'Sign in to see your lists.'}</p>
    ${up ? `<label class="field"><span class="label">Your name</span><input class="input" name="name" data-key="auth-name" value="${val('auth-name')}" autocomplete="name" required></label>` : ''}
    ${email()}
    <label class="field"><span class="label">Password</span><input class="input" name="password" type="password" data-key="auth-pw" value="${val('auth-pw')}" autocomplete="${up ? 'new-password' : 'current-password'}" minlength="6" required>${up ? '<span class="hint">At least 6 characters.</span>' : ''}</label>
    ${err}
    <button class="btn btn-primary btn-block" ${busy}>${state.busy ? 'One moment…' : up ? 'Create account' : 'Sign in'}</button>
    ${backend.signInWithGoogle || backend.sendSignInLink ? '<div class="or"><span>or</span></div>' : ''}
    ${backend.signInWithGoogle ? `<button type="button" class="btn btn-ghost btn-block btn-alt" data-action="google" ${busy}>${GOOGLE_G}Continue with Google</button>` : ''}
    ${backend.sendSignInLink ? `<button type="button" class="btn btn-ghost btn-block btn-alt" data-action="auth-mode" data-to="link" ${busy}>${I.mail}Email me a sign-in link</button>` : ''}
    <p class="auth-switch">${up ? 'Already have an account?' : 'New to Stocked?'} ${switchTo(up ? 'Sign in' : 'Create an account', up ? 'signin' : 'signup')}</p>
  </form>`;
}

/* ---- top bar */

function topbar() {
  const l = state.list;
  const inList = state.listId && l;
  return `<header class="topbar"><div class="topbar-in">
    ${state.listId
      ? `<a class="icon-btn" href="#/" aria-label="All lists">${I.back}</a>`
      : `<div class="brand">${logo()}<span>Stocked</span></div>`}
    ${inList ? `<div class="topbar-title"><span class="topbar-emoji" aria-hidden="true">${esc(l.emoji || '🧺')}</span><div><h1>${esc(l.name)}</h1><p>You're ${myRole() === 'manager' ? 'the' : 'a'} ${ROLES[myRole()]?.label.toLowerCase() || 'member'}</p></div></div>` : '<span class="spacer"></span>'}
    ${DEMO ? '<span class="chip chip-quiet demo-chip">Demo</span>' : ''}
    <button class="avatar-btn" data-action="account" aria-label="Account: ${esc(state.user.name)}">${avatar(state.user.name)}</button>
    <button class="btn btn-ghost btn-small signout-btn" data-action="sign-out" aria-label="Sign out">${I.logout}<span>Sign out</span></button>
  </div></header>`;
}

/* ---- home */

function viewHome() {
  const cards = state.lists.map((l) => {
    const role = l.members?.[state.user.uid]?.role;
    const n = l.memberIds?.length || 1;
    const cs = countStatus(l);
    const meta = `${n} ${n === 1 ? 'person' : 'people'}, you're ${role === 'manager' ? 'the manager' : `a ${ROLES[role]?.label.toLowerCase() || 'member'}`}`;
    return `<li><a class="list-card" href="#/list/${esc(l.id)}/shop">
      <span class="list-emoji" aria-hidden="true">${esc(l.emoji || '🧺')}</span>
      <span class="list-card-body"><span class="list-card-name">${esc(l.name)}</span><span class="list-card-meta">${esc(meta)}</span>
        ${cs.due && role !== 'shopper' ? '<span class="chip chip-warn">Count due</span>' : ''}</span>
      ${I.chevron}
    </a></li>`;
  }).join('');

  return `${topbar()}<main class="page page-home">
    <div class="page-head">
      <div><h1 class="display">${state.lists.length ? 'Your lists' : `Hi, ${esc(firstName(state.user.name))}`}</h1>
      ${state.lists.length ? '' : '<p class="sub">Make a list for your household, then add the people who shop with you.</p>'}</div>
      ${state.lists.length ? `<button class="btn btn-primary" data-action="new-list">${I.plus}New list</button>` : ''}
    </div>
    ${state.lists.length ? `<ul class="list-cards">${cards}</ul>` : `
      <div class="empty">
        <div class="empty-icon" aria-hidden="true">${I.basket}</div>
        <h2>No lists yet</h2>
        <p>A list holds your pantry, the weekly count, and what needs buying.</p>
        <button class="btn btn-primary" data-action="new-list">${I.plus}Make your first list</button>
      </div>`}
  </main>`;
}

/* ---- list shell */

function viewList() {
  if (!state.list) return `${topbar()}<main class="page"><div class="loading">${logo()}<p>Opening list…</p></div></main>`;
  const needed = state.shopping.filter((s) => s.status !== 'picked').length;
  const cs = countStatus(state.list);
  const tabs = [
    ['shop', 'Shop', I.basket, needed ? `<span class="tab-badge">${needed}</span>` : ''],
    ['pantry', 'Pantry', I.shelf, ''],
    ['count', 'Count', I.clip, cs.due && canEdit() ? '<span class="tab-dot" aria-label="due"></span>' : ''],
    ['people', 'People', I.people, ''],
  ];
  const body = { shop: viewShop, pantry: viewPantry, count: viewCount, people: viewPeople }[state.tab]();
  return `${topbar()}<div class="shell">
    <nav class="tabs" aria-label="List sections">
      ${tabs.map(([id, label, icon, extra]) => `<a class="tab" href="#/list/${esc(state.listId)}/${id}" ${state.tab === id ? 'aria-current="page"' : ''}>
        <span class="tab-icon">${icon}${extra}</span><span>${label}</span></a>`).join('')}
    </nav>
    <main class="page" id="main">${body}</main>
  </div>`;
}

/* ---- shop */

function viewShop() {
  const needed = state.shopping.filter((s) => s.status !== 'picked');
  const picked = state.shopping.filter((s) => s.status === 'picked').sort((a, b) => (b.pickedAt || 0) - (a.pickedAt || 0));
  const cs = countStatus(state.list);
  const ready = state.loaded.shopping;

  const banner = cs.due && canEdit() && state.items.length ? `<div class="banner">
      <span class="banner-icon" aria-hidden="true">${I.clip}</span>
      <div><strong>This week's count is due.</strong><span>${cs.days == null ? "You haven't counted the pantry yet." : `Last count was ${cs.days} days ago.`}</span></div>
      <button class="btn btn-small" data-action="start-count">Start count</button>
    </div>` : '';

  return `${banner}
    <div class="page-head">
      <div><h1 class="display">${!ready ? 'Shopping list' : needed.length ? `${needed.length} to pick up` : 'All picked up'}</h1>
      <p class="sub">${needed.length ? 'Tap the circle when something is in the cart.' : 'Nothing on the list right now. Add something below if you need it.'}</p></div>
    </div>

    <form class="quick-add" data-form="quick-add" autocomplete="off">
      <label class="qa-name"><span class="sr-only">What do we need?</span>
        <input name="name" data-key="qa-name" value="${val('qa-name')}" placeholder="What do we need?" list="dl-items" required maxlength="80"></label>
      <label class="qa-qty"><span class="sr-only">Amount</span>
        <input name="qty" data-key="qa-qty" value="${val('qa-qty', '1')}" type="number" min="0" step="any" inputmode="decimal" placeholder="Qty"></label>
      <label class="qa-unit"><span class="sr-only">Unit</span>
        <input name="unit" data-key="qa-unit" value="${val('qa-unit')}" placeholder="Unit" list="dl-units" maxlength="20"></label>
      <button class="btn btn-primary qa-btn" aria-label="Add to list">${I.plus}<span>Add</span></button>
    </form>
    <datalist id="dl-items">${state.items.map((i) => `<option value="${esc(i.name)}">`).join('')}</datalist>
    <datalist id="dl-units">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist>

    ${groupByCategory(needed).map(([cat, rows]) => `<section class="group">
      <h2 class="group-title">${esc(cat)}</h2>
      <ul class="rows">${rows.map(entryRow).join('')}</ul>
    </section>`).join('')}

    ${picked.length ? `<section class="group group-picked">
      <div class="group-head"><h2 class="group-title">Picked up</h2>
      ${canEdit() ? `<button class="link" data-action="clear-picked">Clear picked up</button>` : ''}</div>
      <ul class="rows">${picked.map(entryRow).join('')}</ul>
    </section>` : ''}`;
}

function entryRow(e) {
  const picked = e.status === 'picked';
  const item = e.itemId ? state.items.find((i) => i.id === e.itemId) : null;
  let meta;
  if (picked) meta = `Picked up by ${esc(firstName(e.pickedBy?.name) || 'someone')}, ${ago(e.pickedAt)}`;
  else if (e.source === 'inventory') meta = item ? `From the count: ${qtyUnit(item.current, item.unit)} left, keep ${fmt(item.target)}` : 'From the pantry count';
  else meta = `Asked for by ${esc(e.addedBy?.uid === state.user.uid ? 'you' : firstName(e.addedBy?.name) || 'someone')}`;
  const canDelete = canEdit() || e.addedBy?.uid === state.user.uid;
  return `<li class="row entry ${picked ? 'is-picked' : ''}">
    <button class="check" data-action="toggle-pick" data-id="${esc(e.id)}" aria-pressed="${picked}" aria-label="${picked ? 'Put back on the list' : 'Mark picked up'}: ${esc(e.name)}">${I.check}</button>
    <div class="row-main"><div class="row-title">${esc(e.name)}</div><div class="row-meta">${meta}</div></div>
    <div class="row-qty">${qtyUnit(e.qty, e.unit)}</div>
    ${canDelete && !picked ? `<button class="icon-btn subtle" data-action="delete-entry" data-id="${esc(e.id)}" aria-label="Remove ${esc(e.name)}">${I.x}</button>` : ''}
  </li>`;
}

/* ---- pantry */

function viewPantry() {
  const items = state.items;
  const low = items.filter((i) => num(i.current) < num(i.target)).length;
  return `<div class="page-head">
      <div><h1 class="display">Pantry</h1>
      <p class="sub">${items.length ? `${items.length} things you keep on hand${low ? `, ${low} running low` : ''}. Each count compares against the amount you keep.` : 'List what you keep on hand and how much of each.'}</p></div>
      ${canEdit() && items.length ? `<button class="btn btn-primary" data-action="add-item">${I.plus}Add item</button>` : ''}
    </div>
    ${!items.length && state.loaded.items ? `<div class="empty">
        <div class="empty-icon" aria-hidden="true">${I.shelf}</div>
        <h2>The pantry is empty</h2>
        <p>${canEdit() ? 'Add the things you buy every week, like milk, eggs or rice, with how much you like to keep.' : 'A manager or stocker adds what the household keeps on hand.'}</p>
        ${canEdit() ? `<button class="btn btn-primary" data-action="add-item">${I.plus}Add your first item</button>` : ''}
      </div>` : ''}
    ${groupByCategory(items).map(([cat, rows]) => `<section class="group">
      <h2 class="group-title">${esc(cat)}</h2>
      <ul class="rows">${rows.map(pantryRow).join('')}</ul>
    </section>`).join('')}`;
}

function pantryRow(i) {
  const short = Math.max(0, num(i.target) - num(i.current));
  const label = `${i.name}: ${fmt(i.current)} of ${fmt(i.target)}`;
  const inner = `<div class="row-main"><div class="row-title">${esc(i.name)}</div>
      <div class="row-meta">${short > 0 ? `<span class="short">Short ${qtyUnit(short, i.unit)}</span>` : 'Stocked'}${i.lastCountedAt ? `, counted ${ago(i.lastCountedAt)}` : ''}</div>
      ${meter(i.current, i.target)}</div>
    <div class="stock" aria-label="${esc(label)}"><strong>${fmt(i.current)}</strong><span>of ${qtyUnit(i.target, i.unit)}</span></div>`;
  return canEdit()
    ? `<li class="row pantry-row"><button class="row-btn" data-action="edit-item" data-id="${esc(i.id)}" aria-label="Edit ${esc(i.name)}">${inner}${I.chevron}</button></li>`
    : `<li class="row pantry-row">${inner}</li>`;
}

/* ---- count */

function viewCount() {
  if (state.counting && canEdit()) return viewCounting();
  const cs = countStatus(state.list);
  const last = state.counts[0];
  const statusTitle = cs.days == null ? 'No count yet' : cs.due ? "This week's count is due" : cs.nextIn === 1 ? 'Next count tomorrow' : `Next count in ${cs.nextIn} days`;
  const statusSub = last ? `Last counted ${longDay(last.takenAt)} by ${esc(last.takenBy?.uid === state.user.uid ? 'you' : last.takenBy?.name)}.` : `Counts repeat every ${cs.every} days.`;

  return `<div class="page-head"><div><h1 class="display">Weekly count</h1>
      <p class="sub">Count what's on hand. Anything below the amount you keep goes on the shopping list for your shoppers.</p></div></div>

    <section class="count-hero ${cs.due ? 'is-due' : ''}">
      <div class="count-hero-text">
        <h2>${statusTitle}</h2>
        <p>${statusSub}</p>
      </div>
      ${canEdit()
        ? state.items.length
          ? `<button class="btn ${cs.due ? 'btn-primary' : 'btn-ghost'}" data-action="start-count">${I.clip}Start count</button>`
          : `<a class="btn btn-ghost" href="#/list/${esc(state.listId)}/pantry">Add pantry items first</a>`
        : `<p class="note">Managers and stockers take the count. You'll see the results on the Shop tab.</p>`}
    </section>

    <section class="group">
      <h2 class="group-title">Past counts</h2>
      ${state.counts.length ? `<ul class="rows">${state.counts.map(historyRow).join('')}</ul>` : '<p class="muted">Finished counts show up here.</p>'}
    </section>`;
}

function historyRow(c) {
  const short = (c.results || []).filter((r) => r.short > 0);
  const open = state.openCount === c.id;
  return `<li class="row history ${open ? 'is-open' : ''}">
    <button class="row-btn" data-action="toggle-history" data-id="${esc(c.id)}" aria-expanded="${open}">
      <div class="row-main"><div class="row-title">${esc(longDay(c.takenAt))}</div>
      <div class="row-meta">Counted by ${esc(c.takenBy?.uid === state.user.uid ? 'you' : c.takenBy?.name)}</div></div>
      <span class="chip ${short.length ? 'chip-danger' : 'chip-brand'}">${short.length ? `${short.length} short` : 'All stocked'}</span>
      ${I.chevron}
    </button>
    ${open ? `<table class="history-table"><thead><tr><th scope="col">Item</th><th scope="col">Counted</th><th scope="col">Keep</th><th scope="col">Bought</th></tr></thead><tbody>
      ${(c.results || []).slice().sort((a, b) => b.short - a.short || a.name.localeCompare(b.name)).map((r) => `<tr class="${r.short > 0 ? 'is-short' : ''}">
        <td>${esc(r.name)}</td><td>${fmt(r.counted)}</td><td>${qtyUnit(r.target, r.unit)}</td><td>${r.short > 0 ? qtyUnit(r.short, r.unit) : ''}</td></tr>`).join('')}
    </tbody></table>` : ''}
  </li>`;
}

function countSummary() {
  let short = 0;
  for (const i of state.items) if (num(i.target) - num(state.countDraft[i.id] ?? i.current) > 0) short++;
  return short;
}

function viewCounting() {
  const short = countSummary();
  return `<div class="page-head"><div><h1 class="display">Counting</h1>
      <p class="sub">Enter how much is on hand right now. The bars fill as you go.</p></div></div>
    ${groupByCategory(state.items).map(([cat, rows]) => `<section class="group">
      <h2 class="group-title">${esc(cat)}</h2>
      <ul class="rows">${rows.map(countRow).join('')}</ul>
    </section>`).join('')}
    <div class="count-bar" role="region" aria-label="Count summary">
      <p data-count-summary>${summaryText(short)}</p>
      <button class="btn btn-ghost" data-action="cancel-count">Cancel</button>
      <button class="btn btn-primary" data-action="save-count" ${state.busy ? 'disabled' : ''}>Save count</button>
    </div>`;
}

const summaryText = (short) => (short ? `<strong>${short}</strong> ${short === 1 ? 'thing' : 'things'} to buy` : '<strong>Everything</strong> is stocked');

function countRow(i) {
  const v = state.countDraft[i.id] ?? i.current;
  const short = Math.max(0, num(i.target) - num(v));
  return `<li class="row count-row" data-count-row="${esc(i.id)}">
    <div class="row-main"><div class="row-title">${esc(i.name)}</div>
      <div class="row-meta" data-short>${shortText(short, i.unit, i.target)}</div>
      ${meter(v, i.target)}</div>
    <div class="stepper">
      <button type="button" class="step" data-action="step" data-id="${esc(i.id)}" data-delta="-1" aria-label="One less ${esc(i.name)}">${I.minus}</button>
      <input type="number" min="0" step="any" inputmode="decimal" value="${esc(v)}" data-key="count-${esc(i.id)}" data-count-input="${esc(i.id)}" aria-label="${esc(i.name)} on hand">
      <button type="button" class="step" data-action="step" data-id="${esc(i.id)}" data-delta="1" aria-label="One more ${esc(i.name)}">${I.plus}</button>
    </div>
  </li>`;
}

const shortText = (short, unit, target) => (short > 0 ? `<span class="short">Buy ${qtyUnit(short, unit)}</span> to reach ${fmt(target)}` : `Keep ${qtyUnit(target, unit)}, stocked`);

function updateCountRow(id) {
  const item = state.items.find((i) => i.id === id);
  const row = app.querySelector(`[data-count-row="${CSS.escape(id)}"]`);
  if (!item || !row) return;
  const v = state.countDraft[id];
  setMeter(row.querySelector('[data-meter]'), v, item.target);
  row.querySelector('[data-short]').innerHTML = shortText(Math.max(0, num(item.target) - num(v)), item.unit, item.target);
  const s = app.querySelector('[data-count-summary]');
  if (s) s.innerHTML = summaryText(countSummary());
}

/* ---- people */

function viewPeople() {
  const l = state.list;
  const members = Object.entries(l.members || {}).map(([uid, m]) => ({ uid, ...m }))
    .sort((a, b) => (a.uid === l.ownerId ? -1 : b.uid === l.ownerId ? 1 : 0) || ['manager', 'stocker', 'shopper'].indexOf(a.role) - ['manager', 'stocker', 'shopper'].indexOf(b.role) || a.name.localeCompare(b.name));

  return `<div class="page-head"><div><h1 class="display">People</h1>
    <p class="sub">${members.length} ${members.length === 1 ? 'person' : 'people'} on this list.</p></div></div>

    ${isManager() ? `<form class="invite" data-form="invite" autocomplete="off">
      <h2 class="group-title">Add someone</h2>
      <div class="invite-fields">
        <label><span class="sr-only">Their email</span><input class="input" type="email" name="email" data-key="inv-email" value="${val('inv-email')}" placeholder="Their email" required></label>
        <label><span class="sr-only">Role</span><select class="input" name="role" data-key="inv-role">
          ${['shopper', 'stocker', 'manager'].map((r) => `<option value="${r}" ${(state.drafts['inv-role'] || 'shopper') === r ? 'selected' : ''}>${ROLES[r].label}</option>`).join('')}
        </select></label>
        <button class="btn btn-primary">Add to list</button>
      </div>
      <p class="hint">They need a Stocked account that uses this email.</p>
    </form>` : ''}

    <ul class="rows members">${members.map((m) => {
      const me = m.uid === state.user.uid;
      const owner = m.uid === l.ownerId;
      const editable = isManager() && !owner && !me;
      return `<li class="row member">
        ${avatar(m.name, 'avatar-lg')}
        <div class="row-main"><div class="row-title">${esc(m.name)}${me ? ' <span class="muted">(you)</span>' : ''}</div>
          <div class="row-meta">${esc(m.email || '')}${owner ? ', made this list' : ''}</div></div>
        ${editable
          ? `<label class="role-select"><span class="sr-only">Role for ${esc(m.name)}</span><select class="input input-small" data-change="set-role" data-uid="${esc(m.uid)}">
              ${['manager', 'stocker', 'shopper'].map((r) => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${ROLES[r].label}</option>`).join('')}</select></label>
             <button class="icon-btn subtle" data-action="remove-member" data-uid="${esc(m.uid)}" aria-label="Remove ${esc(m.name)}">${I.x}</button>`
          : `<span class="chip chip-role-${m.role}">${ROLES[m.role]?.label || m.role}</span>`}
      </li>`;
    }).join('')}</ul>

    <section class="group">
      <h2 class="group-title">What each role can do</h2>
      <dl class="roles">${Object.entries(ROLES).map(([k, r]) => `<div><dt><span class="chip chip-role-${k}">${r.label}</span></dt><dd>${r.desc}</dd></div>`).join('')}</dl>
    </section>

    ${isManager() ? `<section class="group">
      <h2 class="group-title">List settings</h2>
      <form class="settings" data-form="settings">
        <label class="field"><span class="label">List name</span><input class="input" name="name" data-key="set-name" value="${val('set-name', l.name)}" required maxlength="40"></label>
        <fieldset class="field"><legend class="label">Icon</legend><div class="emoji-pick">
          ${EMOJIS.map((e) => `<label><input type="radio" name="emoji" value="${e}" ${(state.drafts['set-emoji'] || l.emoji) === e ? 'checked' : ''} data-key="set-emoji-${e}"><span>${e}</span></label>`).join('')}
        </div></fieldset>
        <label class="field"><span class="label">Count every</span>
          <span class="with-suffix"><input class="input" name="every" type="number" min="1" max="60" data-key="set-every" value="${val('set-every', l.countEveryDays || 7)}"><span>days</span></span></label>
        <div class="settings-foot">
          <button class="btn btn-primary">Save changes</button>
          ${isOwner() ? `<button type="button" class="btn btn-danger-ghost" data-action="delete-list">${I.trash}Delete list</button>` : ''}
        </div>
      </form>
    </section>` : ''}

    ${!isOwner() ? `<div class="leave"><button class="btn btn-danger-ghost" data-action="leave-list">Leave this list</button></div>` : ''}`;
}

/* ---------------------------------------------------------------- dialogs + toasts */

function openDialog({ title, body, submit, danger, onSubmit, extra = '', onOpen }) {
  dlg.innerHTML = `<form class="dlg" novalidate>
    <header class="dlg-head"><h2>${title}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${I.x}</button></header>
    <div class="dlg-body">${body}</div>
    <p class="form-error" data-err hidden></p>
    <footer class="dlg-foot">${extra}<span class="spacer"></span>
      <button type="button" class="btn btn-ghost" data-close>Cancel</button>
      ${submit ? `<button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-submit>${submit}</button>` : ''}
    </footer>
  </form>`;
  const form = dlg.querySelector('form');
  const errEl = form.querySelector('[data-err]');
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const btn = form.querySelector('[data-submit]');
    if (btn) btn.disabled = true;
    errEl.hidden = true;
    try { await onSubmit(new FormData(form), form); dlg.close(); }
    catch (e) { errEl.textContent = friendlyError(e); errEl.hidden = false; }
    finally { if (btn) btn.disabled = false; }
  };
  dlg.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dlg.close()));
  onOpen?.(form);
  dlg.showModal();
  form.querySelector('input:not([type=radio]), select')?.focus();
}
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

function confirmDialog(title, message, label, fn) {
  openDialog({ title, body: `<p class="dlg-text">${message}</p>`, submit: label, danger: true, onSubmit: fn });
}

function toast(msg) {
  const host = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3200);
}

async function attempt(fn, ok) {
  try { await fn(); if (ok) toast(ok); return true; }
  catch (e) { console.error(e); toast(friendlyError(e)); return false; }
}

function itemForm(item = {}) {
  return `<label class="field"><span class="label">Name</span><input class="input" name="name" value="${esc(item.name || '')}" required maxlength="60" placeholder="Oat milk"></label>
    <div class="field-row">
      <label class="field"><span class="label">Aisle</span><select class="input" name="category">
        ${CATEGORIES.map((c) => `<option ${(item.category || 'Pantry') === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="field"><span class="label">Unit</span><input class="input" name="unit" value="${esc(item.unit || '')}" list="dlg-units" maxlength="20" placeholder="cartons">
        <datalist id="dlg-units">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist></label>
    </div>
    <div class="field-row">
      <label class="field"><span class="label">Amount to keep</span><input class="input" name="target" type="number" min="0" step="any" inputmode="decimal" value="${esc(item.target ?? 2)}" required>
        <span class="hint">Each count compares against this.</span></label>
      <label class="field"><span class="label">On hand now</span><input class="input" name="current" type="number" min="0" step="any" inputmode="decimal" value="${esc(item.current ?? 0)}" required></label>
    </div>`;
}

const readItem = (fd) => ({
  name: String(fd.get('name')).trim(), category: fd.get('category'), unit: String(fd.get('unit') || '').trim(),
  target: Math.max(0, num(fd.get('target'))), current: Math.max(0, num(fd.get('current'))),
});

/* ---------------------------------------------------------------- actions */

const actions = {
  async google() {
    state.busy = true; state.authError = ''; render();
    try { await backend.signInWithGoogle(); }
    catch (e) { if (!['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(e?.code)) state.authError = friendlyError(e); }
    state.busy = false; render();
  },

  'auth-mode'(el) {
    const to = el.dataset.to || (state.authMode === 'signin' ? 'signup' : 'signin');
    if (state.authMode === 'link-confirm') backend.clearLink?.();
    state.authMode = to; state.authError = ''; render();
  },

  async 'resend-link'() {
    state.busy = true; state.authError = ''; render();
    try { await backend.sendSignInLink(state.drafts['auth-email'] || '', state.drafts['auth-name'] || ''); toast('Sent another link.'); }
    catch (e) { state.authError = friendlyError(e); }
    state.busy = false; render();
  },

  async 'sign-out'() {
    closeList();
    location.hash = '#/';
    await backend.signOut();
    toast('Signed out.');
  },

  account() {
    openDialog({
      title: 'Account',
      body: `<div class="account">${avatar(state.user.name, 'avatar-xl')}<div><strong>${esc(state.user.name)}</strong><p class="muted">${esc(state.user.email)}</p></div></div>
        ${DEMO ? '<p class="demo-note">Demo mode: everything is saved in this browser only.</p>' : ''}`,
      extra: DEMO ? '<button type="button" class="btn btn-danger-ghost" data-reset>Reset demo</button>' : '',
      submit: 'Sign out',
      onSubmit: async () => { closeList(); location.hash = '#/'; await backend.signOut(); },
      onOpen: (form) => {
        form.querySelector('[data-reset]')?.addEventListener('click', async () => { dlg.close(); await backend.resetDemo(); location.hash = '#/'; });
      },
    });
  },

  'new-list'() {
    openDialog({
      title: 'New list',
      body: `<label class="field"><span class="label">Name</span><input class="input" name="name" required maxlength="40" placeholder="Home pantry"></label>
        <fieldset class="field"><legend class="label">Icon</legend><div class="emoji-pick">
          ${EMOJIS.map((e, i) => `<label><input type="radio" name="emoji" value="${e}" ${i === 0 ? 'checked' : ''}><span>${e}</span></label>`).join('')}</div></fieldset>
        <p class="hint">You'll be the manager. Add people from the People tab.</p>`,
      submit: 'Create list',
      onSubmit: async (fd) => {
        const id = await backend.createList({ name: String(fd.get('name')).trim(), emoji: fd.get('emoji') || '🧺' }, state.user);
        location.hash = `#/list/${id}/pantry`;
        toast('List created. Start by adding what you keep in the pantry.');
      },
    });
  },

  async 'toggle-pick'(el) {
    const e = state.shopping.find((s) => s.id === el.dataset.id);
    if (!e) return;
    const picked = e.status !== 'picked';
    const bump = !!e.itemId && state.items.some((i) => i.id === e.itemId);
    // Optimistic update so the check feels instant.
    Object.assign(e, { status: picked ? 'picked' : 'needed', pickedBy: picked ? { uid: state.user.uid, name: state.user.name } : null, pickedAt: picked ? Date.now() : null });
    render();
    await attempt(() => backend.setPicked(state.listId, e, picked, state.user, bump));
  },

  'delete-entry'(el) {
    const e = state.shopping.find((s) => s.id === el.dataset.id);
    if (e) attempt(() => backend.deleteShopping(state.listId, [e.id]), `Removed ${e.name}.`);
  },

  'clear-picked'() {
    const ids = state.shopping.filter((s) => s.status === 'picked').map((s) => s.id);
    if (ids.length) attempt(() => backend.deleteShopping(state.listId, ids), `Cleared ${ids.length} picked up ${ids.length === 1 ? 'item' : 'items'}.`);
  },

  'add-item'() {
    openDialog({
      title: 'Add to pantry', body: itemForm(), submit: 'Add item',
      onSubmit: async (fd) => { const it = readItem(fd); await backend.addItem(state.listId, it); toast(`Added ${it.name}.`); },
    });
  },

  'edit-item'(el) {
    const item = state.items.find((i) => i.id === el.dataset.id);
    if (!item) return;
    openDialog({
      title: `Edit ${esc(item.name)}`, body: itemForm(item), submit: 'Save changes',
      extra: `<button type="button" class="btn btn-danger-ghost" data-del>${I.trash}Delete</button>`,
      onSubmit: async (fd) => { await backend.updateItem(state.listId, item.id, readItem(fd)); toast('Saved changes.'); },
      onOpen: (form) => form.querySelector('[data-del]').addEventListener('click', () => {
        dlg.close();
        confirmDialog(`Delete ${esc(item.name)}?`, 'It comes off the pantry, the shopping list and future counts. Past counts keep it.', 'Delete item',
          async () => {
            const onList = state.shopping.filter((s) => s.itemId === item.id && s.status !== 'picked').map((s) => s.id);
            await backend.deleteItem(state.listId, item.id);
            if (onList.length) await backend.deleteShopping(state.listId, onList);
            toast(`Deleted ${item.name}.`);
          });
      }),
    });
  },

  'start-count'() {
    state.counting = true;
    state.countDraft = Object.fromEntries(state.items.map((i) => [i.id, num(i.current)]));
    const target = `#/list/${state.listId}/count`;
    if (location.hash !== target) location.hash = target; else render();
    scrollTo({ top: 0 });
  },

  'cancel-count'() { state.counting = false; state.countDraft = {}; render(); },

  step(el) {
    const id = el.dataset.id;
    const next = Math.max(0, num(state.countDraft[id]) + Number(el.dataset.delta));
    state.countDraft[id] = next;
    const input = app.querySelector(`[data-count-input="${CSS.escape(id)}"]`);
    if (input) input.value = fmt(next);
    updateCountRow(id);
  },

  async 'save-count'() {
    const results = state.items.map((i) => {
      const counted = Math.max(0, num(state.countDraft[i.id] ?? i.current));
      const target = num(i.target);
      return { itemId: i.id, name: i.name, unit: i.unit || '', category: i.category || 'Other', target, counted, short: Math.max(0, Math.round((target - counted) * 100) / 100) };
    });
    const staleIds = state.shopping.filter((s) => s.source === 'inventory' && s.status !== 'picked').map((s) => s.id);
    const short = results.filter((r) => r.short > 0).length;
    state.busy = true; render();
    const ok = await attempt(() => backend.saveCount(state.listId, { results, staleIds, user: state.user }),
      short ? `Count saved. ${short} ${short === 1 ? 'thing is' : 'things are'} on the shopping list.` : 'Count saved. Everything is stocked.');
    state.busy = false;
    if (ok) { state.counting = false; state.countDraft = {}; }
    render();
  },

  'toggle-history'(el) { state.openCount = state.openCount === el.dataset.id ? null : el.dataset.id; render(); },

  'remove-member'(el) {
    const m = state.list.members[el.dataset.uid];
    confirmDialog(`Remove ${esc(m.name)}?`, `${esc(firstName(m.name))} will lose access to ${esc(state.list.name)}. You can add them again later.`, 'Remove',
      async () => { await backend.removeMember(state.listId, el.dataset.uid); toast(`Removed ${m.name}.`); });
  },

  'leave-list'() {
    confirmDialog(`Leave ${esc(state.list.name)}?`, 'You lose access until a manager adds you again.', 'Leave list', async () => {
      const id = state.listId;
      location.hash = '#/';
      await backend.removeMember(id, state.user.uid);
      toast('You left the list.');
    });
  },

  'delete-list'() {
    confirmDialog(`Delete ${esc(state.list.name)}?`, 'This deletes the pantry, shopping list and count history for everyone on it. It can\'t be undone.', 'Delete list', async () => {
      const id = state.listId;
      const name = state.list.name;
      location.hash = '#/';
      await backend.deleteList(id);
      toast(`Deleted ${name}.`);
    });
  },
};

const forms = {
  async auth(form) {
    const fd = new FormData(form);
    const mode = state.authMode;
    if (mode === 'link' || mode === 'link-confirm') {
      const email = String(fd.get('email') || '').trim();
      if (!email) { state.authError = 'Enter your email.'; render(); return; }
      state.drafts['auth-email'] = email;
      state.drafts['auth-name'] = String(fd.get('name') || state.drafts['auth-name'] || '').trim();
      state.busy = true; state.authError = ''; render();
      try {
        if (mode === 'link') {
          await backend.sendSignInLink(email, state.drafts['auth-name']);
          state.authMode = 'link-sent';
        } else {
          const u = await backend.finishLinkSignIn(email);
          if (state.user?.uid === u.uid) state.user.name = u.name;
          state.authMode = 'signin';
        }
      } catch (e) { state.authError = friendlyError(e); }
      state.busy = false; render();
      return;
    }
    const up = mode === 'signup';
    const email = String(fd.get('email') || '').trim();
    const pw = String(fd.get('password') || '');
    const name = String(fd.get('name') || '').trim();
    if (up && !name) { state.authError = 'Enter your name so others know who you are.'; render(); return; }
    if (!email) { state.authError = 'Enter your email.'; render(); return; }
    state.busy = true; state.authError = ''; render();
    try {
      if (up) {
        const u = await backend.signUp(name, email, pw);
        state.user = { ...(state.user || u), name };
      } else {
        await backend.signIn(email, pw);
      }
      delete state.drafts['auth-pw'];
    } catch (e) {
      state.authError = friendlyError(e);
    }
    state.busy = false;
    render();
  },

  async 'quick-add'(form) {
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    if (!name) return;
    const match = state.items.find((i) => i.name.toLowerCase() === name.toLowerCase());
    const entry = {
      name: match?.name || name, qty: Math.max(0, num(fd.get('qty')) || 1), unit: String(fd.get('unit') || '').trim() || match?.unit || '',
      category: match?.category || 'Other', source: 'manual', itemId: match?.id || null, status: 'needed',
      addedBy: { uid: state.user.uid, name: state.user.name },
    };
    delete state.drafts['qa-name']; delete state.drafts['qa-qty']; delete state.drafts['qa-unit'];
    form.reset();
    form.querySelector('[name=name]').focus();
    await attempt(() => backend.addShopping(state.listId, entry), `Added ${entry.name}.`);
  },

  async invite(form) {
    const fd = new FormData(form);
    const email = String(fd.get('email') || '').trim();
    const role = fd.get('role');
    if (!email) return;
    if (Object.values(state.list.members).some((m) => m.email?.toLowerCase() === email.toLowerCase())) { toast('That person is already on this list.'); return; }
    const ok = await attempt(async () => {
      const u = await backend.addMemberByEmail(state.listId, email, role);
      toast(`Added ${u.name} as a ${ROLES[role].label.toLowerCase()}.`);
    });
    if (ok) { delete state.drafts['inv-email']; render(); }
  },

  async settings(form) {
    const fd = new FormData(form);
    const patch = { name: String(fd.get('name')).trim() || state.list.name, emoji: fd.get('emoji') || state.list.emoji, countEveryDays: clamp(Math.round(num(fd.get('every')) || 7), 1, 60) };
    const ok = await attempt(() => backend.updateList(state.listId, patch), 'Saved changes.');
    if (ok) { for (const k of Object.keys(state.drafts)) if (k.startsWith('set-')) delete state.drafts[k]; }
  },
};

/* ---------------------------------------------------------------- events */

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !app.contains(el)) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el); }
});

app.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  forms[form.dataset.form]?.(form);
});

app.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.countInput) {
    state.countDraft[t.dataset.countInput] = t.value === '' ? 0 : Math.max(0, num(t.value));
    updateCountRow(t.dataset.countInput);
    return;
  }
  if (t.dataset.key && t.type !== 'radio') state.drafts[t.dataset.key] = t.value;
});

app.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.type === 'radio' && t.name === 'emoji') state.drafts['set-emoji'] = t.value;
  if (t.dataset.key === 'inv-role') state.drafts['inv-role'] = t.value;
  if (t.dataset.change === 'set-role') {
    const m = state.list.members[t.dataset.uid];
    await attempt(() => backend.setMemberRole(state.listId, t.dataset.uid, t.value), `${firstName(m.name)} is now a ${ROLES[t.value].label.toLowerCase()}.`);
  }
});

/* ---------------------------------------------------------------- data + routing */

function closeList() {
  subs.list.forEach((u) => u && u());
  subs.list = [];
  Object.assign(state, { listId: null, list: null, items: [], shopping: [], counts: [], counting: false, countDraft: {}, openCount: null, loaded: { items: false, shopping: false } });
  for (const k of Object.keys(state.drafts)) if (!k.startsWith('auth')) delete state.drafts[k];
}

function openList(id) {
  if (state.listId === id) return;
  closeList();
  state.listId = id;
  const lost = () => { if (state.listId === id && state.user) { toast("You don't have access to that list anymore."); location.hash = '#/'; } };
  subs.list.push(
    backend.watchList(id, (l) => { if (state.listId !== id) return; if (!l) return lost(); state.list = l; render(); }, lost),
    backend.watchItems(id, (rows) => { if (state.listId !== id) return; state.items = rows; state.loaded.items = true; render(); }, lost),
    backend.watchShopping(id, (rows) => { if (state.listId !== id) return; state.shopping = rows; state.loaded.shopping = true; render(); }, lost),
    backend.watchCounts(id, (rows) => { if (state.listId !== id) return; state.counts = rows; render(); }, () => {}),
  );
}

function route() {
  if (!state.user) { closeList(); render(); return; }
  const m = location.hash.match(/^#\/list\/([^/]+)(?:\/(\w+))?/);
  const prevTab = state.tab;
  if (m) {
    openList(m[1]);
    state.tab = TABS.includes(m[2]) ? m[2] : 'shop';
  } else {
    closeList();
  }
  render();
  if (prevTab !== state.tab) scrollTo({ top: 0 });
}

addEventListener('hashchange', route);

// Opened from an email sign-in link? Finish signing in, or ask for the email if it was opened elsewhere.
const link = backend.pendingLink?.();
if (link) {
  if (link.email) {
    state.authMode = 'linking';
    backend.finishLinkSignIn(link.email)
      .then((u) => { if (state.user?.uid === u.uid) state.user.name = u.name; state.authMode = 'signin'; render(); })
      .catch((e) => { backend.clearLink(); state.authMode = 'link'; state.authError = friendlyError(e); render(); });
  } else {
    state.authMode = 'link-confirm';
  }
}

backend.onAuth((u) => {
  const was = state.user?.uid;
  state.user = u ? { ...u, name: state.user?.uid === u.uid ? state.user.name : u.name } : null;
  state.authReady = true;
  if (u && u.uid !== was) {
    subs.lists?.();
    subs.lists = backend.watchMyLists(u.uid, (lists) => { state.lists = lists; render(); }, () => {});
  }
  if (!u) { subs.lists?.(); subs.lists = null; state.lists = []; }
  route();
});

render();
