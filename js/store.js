// データ保存
// ・端末内（localStorage）に常に保存し、オフラインでも使える
// ・ログイン中は変更を「操作」としてキューに積み、Supabase に送る。送れたらサーバーの内容で置き換える
import { toKey } from './plan.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const KEY = 'study-planner:v1';
const QKEY = 'study-planner:queue';
const SYNCED_KEY = 'study-planner:synced-user';

function empty() {
  return {
    version: 1,
    done: {},       // { taskKey: 'YYYY-MM-DD' }
    marks: {},      // { itemId: [{ id, d, m }] }  m: o=○ t=△ x=×
    achieved: {},   // { 'YYYY-MM-DD': { subject: true } }
    sessions: [],   // [{ id, subject, start, end, manual, source }]
    active: null,   // { subject, start }
  };
}

let state = load();
let queue = loadQueue();
const listeners = new Set();
export const sync = {
  status: 'local',   // local / connecting / signedout / syncing / ok / offline / error
  email: null,
  lastSync: null,
  message: '',
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...empty(), ...JSON.parse(raw) };
      for (const arr of Object.values(s.marks)) for (const r of arr) r.id ||= uuid();
      return s;
    }
  } catch (e) { /* 読めない場合は空で始める */ }
  return empty();
}
function loadQueue() { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; } }
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    localStorage.setItem(QKEY, JSON.stringify(queue));
  } catch (e) { console.warn('保存できませんでした', e); }
}
function emit() { listeners.forEach((fn) => fn(state)); }
function commit(ops) {
  if (client && user) queue.push(...ops);
  persist();
  emit();
  if (ops.length) scheduleFlush();
}

export const store = {
  get: () => state,
  queueSize: () => queue.length,
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  reload() { state = load(); queue = loadQueue(); emit(); },

  toggleDone(key, dateKey) {
    if (state.done[key]) { delete state.done[key]; commit([{ t: 'done_del', key }]); }
    else { state.done[key] = dateKey; commit([{ t: 'done_set', key, d: dateKey }]); }
  },
  addMark(itemId, m, dateKey) {
    const r = { id: uuid(), d: dateKey, m };
    (state.marks[itemId] ||= []).push(r);
    commit([{ t: 'mark_add', item: itemId, ...r }]);
  },
  removeLastMark(itemId) {
    const r = state.marks[itemId]?.pop();
    if (state.marks[itemId] && !state.marks[itemId].length) delete state.marks[itemId];
    commit(r ? [{ t: 'mark_del', id: r.id }] : []);
  },
  toggleAchieved(dateKey, subject) {
    const day = (state.achieved[dateKey] ||= {});
    if (day[subject]) { delete day[subject]; commit([{ t: 'ach_del', d: dateKey, subject }]); }
    else { day[subject] = true; commit([{ t: 'ach_set', d: dateKey, subject }]); }
  },

  // タイマー：開始時刻だけを保存し、経過時間は毎回「現在 − 開始」で計算する
  startTimer(subject) {
    const ops = closeActive();
    state.active = { subject, start: Date.now() };
    ops.push({ t: 'timer_set', subject, start: state.active.start });
    commit(ops);
  },
  stopTimer() { commit(closeActive()); },
  addManual(subject, dateKey, minutes) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const end = new Date(y, m - 1, d, 12, 0, 0).getTime();
    const x = { id: uuid(), subject, start: end - minutes * 60000, end, manual: true, source: 'app' };
    state.sessions.push(x);
    commit([{ t: 'session_add', ...x }]);
  },
  removeSession(id) {
    state.sessions = state.sessions.filter((x) => x.id !== id);
    commit([{ t: 'session_del', id }]);
  },

  exportJSON() { return JSON.stringify(state, null, 2); },
  importJSON(text) {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || !('sessions' in data)) throw new Error('形式が違います');
    state = { ...empty(), ...data };
    for (const arr of Object.values(state.marks)) for (const r of arr) r.id ||= uuid();
    commit(user ? fullStateOps(state) : []);
  },
  reset() {
    const ops = [];
    for (const k of Object.keys(state.done)) ops.push({ t: 'done_del', key: k });
    for (const arr of Object.values(state.marks)) for (const r of arr) ops.push({ t: 'mark_del', id: r.id });
    for (const [d, subs] of Object.entries(state.achieved)) for (const s of Object.keys(subs)) ops.push({ t: 'ach_del', d, subject: s });
    for (const x of state.sessions) ops.push({ t: 'session_del', id: x.id });
    if (state.active) ops.push({ t: 'timer_del' });
    state = empty();
    commit(ops);
  },
};

function closeActive() {
  const ops = [];
  if (!state.active) return ops;
  const end = Date.now();
  if (end - state.active.start >= 1000) {
    const x = { id: uuid(), subject: state.active.subject, start: state.active.start, end, manual: false, source: 'app' };
    state.sessions.push(x);
    ops.push({ t: 'session_add', ...x });
  }
  state.active = null;
  ops.push({ t: 'timer_del' });
  return ops;
}
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
}

// ── 集計 ──
// 日付ごとの科目別学習時間（時間）。日をまたいだセッションは日ごとに分ける。計測中も含める。
export function hoursByDay(s, now = Date.now()) {
  const out = {};
  const add = (subject, start, end) => {
    let t = start;
    while (t < end) {
      const d = new Date(t);
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const k = toKey(d);
      (out[k] ||= {})[subject] = (out[k][subject] || 0) + (Math.min(end, next) - t) / 3600000;
      t = Math.min(end, next);
    }
  };
  for (const x of s.sessions) add(x.subject, x.start, x.end);
  if (s.active) add(s.active.subject, s.active.start, now);
  return out;
}
export function lastMark(s, itemId) {
  const arr = s.marks[itemId];
  return arr && arr.length ? arr[arr.length - 1].m : null;
}

// ── Supabase 同期 ──
let client = null, user = null, channel = null, flushTimer = null, flushing = false;

function setStatus(status, message = '') { sync.status = status; sync.message = message; emit(); }

export async function initSync() {
  setStatus('connecting');
  try {
    let mod;
    try { mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'); }
    catch { mod = await import('https://esm.sh/@supabase/supabase-js@2'); }
    const { createClient } = mod;
    client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  } catch (e) {
    setStatus('offline', 'サーバーにつながりません（端末内に保存中）');
    return;
  }
  client.auth.onAuthStateChange((_ev, session) => { onSession(session); });
  const { data } = await client.auth.getSession();
  await onSession(data.session);
}

let currentUid = null;
async function onSession(session) {
  const u = session?.user || null;
  if ((u?.id || null) === currentUid) { user = u; return; }
  currentUid = u?.id || null;
  user = u;
  sync.email = u?.email || null;
  if (channel) { client.removeChannel(channel); channel = null; }
  if (!u) { setStatus('signedout'); return; }
  // この端末で初めてログインしたら、端末内の記録をサーバーに送る
  let synced = null;
  try { synced = localStorage.getItem(SYNCED_KEY); } catch {}
  if (synced !== u.id) {
    queue = fullStateOps(state);
    try { localStorage.setItem(SYNCED_KEY, u.id); } catch {}
    persist();
  }
  channel = client.channel('study-planner')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_done' }, onRemote)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'marks' }, onRemote)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'achieved' }, onRemote)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, onRemote)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'active_timer' }, onRemote)
    .subscribe();
  await syncNow();
}

let remoteTimer = null;
function onRemote() { clearTimeout(remoteTimer); remoteTimer = setTimeout(() => syncNow(), 600); }
function scheduleFlush() { clearTimeout(flushTimer); flushTimer = setTimeout(() => syncNow(), 300); }

// キューを送ってから、サーバーの内容を取り込む
export async function syncNow() {
  if (!client || !user || flushing) return;
  flushing = true;
  setStatus('syncing');
  try {
    while (queue.length) {
      await applyOp(queue[0]);
      queue.shift();
      persist();
    }
    await pull();
    sync.lastSync = Date.now();
    setStatus('ok');
  } catch (e) {
    console.warn(e);
    setStatus(navigator.onLine === false ? 'offline' : 'error', navigator.onLine === false ? 'オフライン（つながったら送ります）' : '同期できませんでした：' + (e.message || e));
  } finally {
    flushing = false;
  }
}

async function applyOp(op) {
  const db = client;
  const iso = (ms) => new Date(ms).toISOString();
  let r;
  switch (op.t) {
    case 'done_set': r = await db.from('task_done').upsert({ task_key: op.key, done_on: op.d }, { onConflict: 'user_id,task_key' }); break;
    case 'done_del': r = await db.from('task_done').delete().eq('task_key', op.key); break;
    case 'mark_add': r = await db.from('marks').upsert({ id: op.id, item_id: op.item, mark: op.m, marked_on: op.d }); break;
    case 'mark_del': r = await db.from('marks').delete().eq('id', op.id); break;
    case 'ach_set': r = await db.from('achieved').upsert({ day: op.d, subject: op.subject }, { onConflict: 'user_id,day,subject' }); break;
    case 'ach_del': r = await db.from('achieved').delete().eq('day', op.d).eq('subject', op.subject); break;
    case 'session_add': r = await db.from('sessions').upsert({ id: op.id, subject: op.subject, started_at: iso(op.start), ended_at: iso(op.end), manual: !!op.manual, source: op.source || 'app' }); break;
    case 'session_del': r = await db.from('sessions').delete().eq('id', op.id); break;
    case 'timer_set': r = await db.from('active_timer').upsert({ user_id: user.id, subject: op.subject, started_at: iso(op.start) }); break;
    case 'timer_del': r = await db.from('active_timer').delete().eq('user_id', user.id); break;
    default: return;
  }
  if (r.error) throw r.error;
}

async function pull() {
  const db = client;
  const [done, marks, ach, sess, timer] = await Promise.all([
    db.from('task_done').select('task_key, done_on'),
    db.from('marks').select('id, item_id, mark, marked_on, created_at').order('created_at'),
    db.from('achieved').select('day, subject'),
    db.from('sessions').select('id, subject, started_at, ended_at, manual, source').order('started_at'),
    db.from('active_timer').select('subject, started_at').maybeSingle(),
  ]);
  for (const r of [done, marks, ach, sess, timer]) if (r.error) throw r.error;
  if (queue.length) return; // 取得中に新しい変更があれば次の同期で取り込む
  const s = empty();
  for (const r of done.data) s.done[r.task_key] = r.done_on;
  for (const r of marks.data) (s.marks[r.item_id] ||= []).push({ id: r.id, d: r.marked_on, m: r.mark });
  for (const r of ach.data) (s.achieved[r.day] ||= {})[r.subject] = true;
  s.sessions = sess.data.map((r) => ({ id: r.id, subject: r.subject, start: Date.parse(r.started_at), end: Date.parse(r.ended_at), manual: r.manual, source: r.source }));
  s.active = timer.data ? { subject: timer.data.subject, start: Date.parse(timer.data.started_at) } : null;
  state = s;
  persist();
}

function fullStateOps(s) {
  const ops = [];
  for (const [key, d] of Object.entries(s.done)) ops.push({ t: 'done_set', key, d });
  for (const [item, arr] of Object.entries(s.marks)) for (const r of arr) ops.push({ t: 'mark_add', item, ...r });
  for (const [d, subs] of Object.entries(s.achieved)) for (const subject of Object.keys(subs)) ops.push({ t: 'ach_set', d, subject });
  for (const x of s.sessions) ops.push({ t: 'session_add', ...x });
  if (s.active) ops.push({ t: 'timer_set', subject: s.active.subject, start: s.active.start });
  return ops;
}

// ── ログイン ──
export const auth = {
  async signIn(email, password) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },
  async signUp(email, password) {
    const redirect = location.origin + location.pathname;
    const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
    if (error) throw error;
    return !data.session; // true = 確認メール待ち
  },
  async signOut() { await client.auth.signOut(); },
  ready: () => !!client,
};
