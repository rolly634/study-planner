// データ保存（現在は端末内 localStorage。Supabase 接続時はこのモジュールを差し替える）
import { toKey } from './plan.js';

const KEY = 'study-planner:v1';

function empty() {
  return {
    version: 1,
    done: {},       // { taskKey: 'YYYY-MM-DD' }  完了した課題
    marks: {},      // { itemId: [{ d: 'YYYY-MM-DD', m: 'o'|'t'|'x' }] }  ○△×の履歴
    achieved: {},   // { 'YYYY-MM-DD': { subject: true } }  目標達成した科目
    sessions: [],   // [{ id, subject, start, end }]  学習時間（ミリ秒の時刻）
    active: null,   // { subject, start }  計測中のタイマー
  };
}

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...empty(), ...JSON.parse(raw) };
  } catch (e) { /* 読めない場合は空で始める */ }
  return empty();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('保存できませんでした', e); }
  listeners.forEach((fn) => fn(state));
}

export const store = {
  get: () => state,
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  update(fn) { fn(state); save(); },

  // 別タブ・別ウィンドウでの変更を反映
  reload() { state = load(); listeners.forEach((fn) => fn(state)); },

  toggleDone(key, dateKey) {
    this.update((s) => { if (s.done[key]) delete s.done[key]; else s.done[key] = dateKey; });
  },
  addMark(itemId, m, dateKey) {
    this.update((s) => { (s.marks[itemId] ||= []).push({ d: dateKey, m }); });
  },
  removeLastMark(itemId) {
    this.update((s) => { s.marks[itemId]?.pop(); if (s.marks[itemId] && !s.marks[itemId].length) delete s.marks[itemId]; });
  },
  toggleAchieved(dateKey, subject) {
    this.update((s) => {
      const day = (s.achieved[dateKey] ||= {});
      if (day[subject]) delete day[subject]; else day[subject] = true;
    });
  },

  // ── タイマー：開始時刻だけを保存し、経過時間は毎回「現在 − 開始」で計算する ──
  startTimer(subject) {
    this.update((s) => {
      if (s.active) closeActive(s);
      s.active = { subject, start: Date.now() };
    });
  },
  stopTimer() { this.update((s) => closeActive(s)); },
  addManual(subject, dateKey, minutes) {
    this.update((s) => {
      const [y, m, d] = dateKey.split('-').map(Number);
      const end = new Date(y, m - 1, d, 12, 0, 0).getTime();
      s.sessions.push({ id: uid(), subject, start: end - minutes * 60000, end, manual: true });
    });
  },
  removeSession(id) { this.update((s) => { s.sessions = s.sessions.filter((x) => x.id !== id); }); },

  exportJSON() { return JSON.stringify(state, null, 2); },
  importJSON(text) {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || !('sessions' in data)) throw new Error('形式が違います');
    state = { ...empty(), ...data };
    save();
  },
  reset() { state = empty(); save(); },
};

function closeActive(s) {
  if (!s.active) return;
  const end = Date.now();
  if (end - s.active.start >= 1000) s.sessions.push({ id: uid(), subject: s.active.subject, start: s.active.start, end });
  s.active = null;
}
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

// ── 集計 ──
// 日付ごとの科目別学習時間（時間）。日をまたいだセッションは日ごとに分ける。計測中も含める。
export function hoursByDay(s, now = Date.now()) {
  const out = {};
  const add = (subject, start, end) => {
    let t = start;
    while (t < end) {
      const d = new Date(t);
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const seg = Math.min(end, next) - t;
      const k = toKey(d);
      (out[k] ||= {})[subject] = (out[k][subject] || 0) + seg / 3600000;
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
