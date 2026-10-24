// 学習計画 v4 の期間・時間配分・日ごとの割り振り
import { itemsForPeriod, SUBJECT_ORDER } from './catalog.js';

export const START = '2026-10-24';
export const END = '2027-03-21';

// ── 日付ユーティリティ（YYYY-MM-DD、端末のローカル日付） ──
export function toKey(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
export function fromKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(k, n) { const d = fromKey(k); d.setDate(d.getDate() + n); return toKey(d); }
export function diffDays(a, b) { return Math.round((Date.UTC(...ymd(b)) - Date.UTC(...ymd(a))) / 86400000); }
function ymd(k) { const [y, m, d] = k.split('-').map(Number); return [y, m - 1, d]; }
export function todayKey() { return toKey(new Date()); }
const WD = ['日', '月', '火', '水', '木', '金', '土'];
export function fmtDay(k) { const d = fromKey(k); return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`; }
export function weekdayOf(k) { return fromKey(k).getDay(); }

// ── 期間 ──
const SPECIAL = [
  { key: 'EXAM1', start: '2027-03-04', end: '2027-03-04', label: '入試', title: '東京理科大 理学部第二部 物理学科 B方式' },
  { key: 'D1', start: '2027-03-05', end: '2027-03-10', label: '電験①', title: '電験のみ：機械05〜11' },
  { key: 'D2', start: '2027-03-11', end: '2027-03-17', label: '電験②', title: '電験のみ：法規01〜06' },
  { key: 'D3', start: '2027-03-18', end: '2027-03-20', label: '電験③', title: '電験のみ：4科目の過去問' },
  { key: 'EXAM2', start: '2027-03-21', end: '2027-03-21', label: '電験', title: '電験三種 下期 筆記' },
];

export function periodByKey(key) {
  if (typeof key === 'number') {
    const start = addDays(START, (key - 1) * 7);
    const end = key === 19 ? '2027-03-03' : addDays(start, 6);
    return { key, start, end, label: `W${key}`, title: WEEK_RANGES[key - 1]?.title || '' };
  }
  return SPECIAL.find((p) => p.key === key) || null;
}
export const PERIOD_KEYS = [...Array.from({ length: 19 }, (_, i) => i + 1), ...SPECIAL.map((p) => p.key)];

export function periodOf(k) {
  if (k < START || k > END) return null;
  for (const s of SPECIAL) if (k >= s.start && k <= s.end) return s;
  const w = Math.floor(diffDays(START, k) / 7) + 1;
  return periodByKey(w);
}
export function daysOfPeriod(p) {
  const out = [];
  for (let k = p.start; k <= p.end; k = addDays(k, 1)) out.push(k);
  return out;
}

// ── 週ごとの範囲（計画v4の表） ──
export const WEEK_RANGES = [
  { math: '三角関数：基礎問IIB 52–63／合格る 43–51', physics: '力学I・II・IV／良問 力学1,3', english: '速単1–4・Santa', denken: '理論01 直流回路' },
  { math: '数と式・集合・不等式：基礎問IA 1–25／合格る 8–20, 38–42', physics: '力学V・VI／良問 力学4–6', english: '速単5–10', denken: '理論02 静電気' },
  { math: '2次関数・方程式：基礎問IA 26–51／合格る 21–37', physics: '力学VII（慣性力〜単振り子）／良問 力学7–9', english: '速単11–16', denken: '理論04 交流回路①' },
  { math: '図形の性質・図形と計量：基礎問IA 52–89／合格る 52–60', physics: '力学III・万有引力、熱I・II／良問 力学2,10・熱1–2', english: '速単17–22', denken: '理論04 交流回路②' },
  { math: '式と証明・複素数と方程式・図形と方程式：基礎問IIB 1–51／合格る 68–71', physics: '波動I〜III／良問 波動1–3', english: '速単23–28', denken: '理論05 三相交流' },
  { math: '指数対数・数II微積：基礎問IIB 64–110／合格る 72–80', physics: '波動IV・V／良問 波動4–5', english: '速単29–34', denken: '理論08 電気測定・07 電子理論①' },
  { math: '場合の数・確率・数列①：基礎問IA 90–123、IIB 111–122／合格る 81–88', physics: '電磁気I・II／良問 電磁気1–2', english: '速単35–40', denken: '理論07 電子理論②・06 過渡現象' },
  { math: '数列②・数III関数極限：基礎問IIB 123–138、IIIC 37–56／合格るIIIC 1–5', physics: '電磁気III・IV・VII／良問 電磁気3,4,7', english: '速単41–46', denken: '理論03 電磁力①' },
  { math: '数III微分：基礎問IIIC 57–82／合格るIIIC 6–17', physics: '電磁気V・VI／良問 電磁気5–6', english: '速単47–52', denken: '理論03 電磁力②' },
  { math: '数III積分①：基礎問IIIC 83–103／合格るIIIC 18–37', physics: '原子I〜III／良問 原子1–3', english: '速単53–58', denken: '理論 ×△の解き直し' },
  { math: '数III積分②・2次曲線極座標：基礎問IIIC 104–125, 1–12／合格るIIIC 38–43, 52–58', physics: '良問の風2周目 力学・熱', english: '速単59–64', denken: '電力01 水力・02 火力' },
  { math: 'ベクトル：基礎問IIB 139–168、IIIC 126–136／合格る 61–67', physics: '良問の風2周目 波動・電磁気・原子', english: '速単65–71', denken: '電力03 原子力・04 その他・05 変電所' },
  { math: 'データの分析・統計的な推測：基礎問IA 124–142、IIB 169–183／合格る 89', physics: '良問の風3周目（△×）・論述問題', english: '速単2周目 1–36', denken: '電力06 送電・07 配電・08 地中' },
  { math: '複素数平面：基礎問IIIC 13–36／合格るIIIC 44–51＋過去問1年分（試し）', physics: '3周目の残り＋過去問1年分（試し）', english: '速単2周目 37–71', denken: '電力09 材料・10 電力計算①' },
  { math: '過去問1年分＋×', physics: '過去問1年分＋×', english: '過去問1年分', denken: '電力10 電力計算②・11 線路計算・12 たるみ' },
  { math: '過去問2年分＋弱点', physics: '過去問2年分＋弱点', english: '過去問1年分', denken: '機械01 直流機' },
  { math: '過去問2年分＋弱点', physics: '過去問2年分＋弱点', english: '過去問1年分', denken: '機械02 変圧器' },
  { math: '過去問2年分＋弱点', physics: '過去問2年分＋弱点', english: '過去問1年分', denken: '機械03 誘導機' },
  { math: '総仕上げ（公式集）', physics: '総仕上げ', english: '総仕上げ', denken: '機械04 同期機（軽め）' },
];
export function rangesOf(p) {
  if (!p) return {};
  if (typeof p.key === 'number') return WEEK_RANGES[p.key - 1];
  if (p.key === 'D1') return { denken: '機械05〜11（パワエレ・自動制御・情報・照明・電熱・電動機応用・電気化学）' };
  if (p.key === 'D2') return { denken: '法規01〜06' };
  if (p.key === 'D3') return { denken: '4科目の過去問1年分ずつ' };
  return {};
}

// ── 時間配分（時間） ──
const HOURS = {
  weekday: { math: 2, physics: 1.5, english: 0, denken: 2, review: 0.5 },
  sat:     { math: 4.5, physics: 4, english: 2, denken: 1, review: 0.5 },
  sun:     { math: 3.5, physics: 3, english: 2, denken: 0, review: 0.5 },
  denkenOnly: { math: 0, physics: 0, english: 0, denken: 7, review: 0.5 },
  none:    { math: 0, physics: 0, english: 0, denken: 0, review: 0 },
};
export function plannedHours(k) {
  const p = periodOf(k);
  if (!p || p.key === 'EXAM1' || p.key === 'EXAM2') return { ...HOURS.none };
  if (typeof p.key === 'string') return { ...HOURS.denkenOnly };
  const wd = weekdayOf(k);
  return { ...(wd === 6 ? HOURS.sat : wd === 0 ? HOURS.sun : HOURS.weekday) };
}

// ── 計画にある「教材以外」の課題 ──
function customTasks(p, k) {
  const out = [];
  const w = typeof p.key === 'number' ? p.key : 0;
  const wd = weekdayOf(k); // 6=土 0=日 4=木 5=金
  const add = (subject, label) => out.push({ key: `custom:${subject}:${label}@${k}`, subject, label, custom: true });
  const hrs = plannedHours(k);
  if (hrs.review > 0) add('review', '×△の解き直し・進捗の記入');
  if (w >= 1 && w <= 14) {
    if (wd === 6 && w >= 2) add('math', '前週の×△の解き直し（1h）');
    if (wd === 6 || wd === 0) add('english', 'Santa TOEFL（1h）');
    if (wd === 0) add('english', '速単 前日分の音読');
  }
  if (w >= 1 && w <= 10) {
    if (wd === 6) add('physics', '宇宙一わかりやすい高校物理で通読（1.5h）');
    if (wd === 0) add('physics', 'エッセンス 要点まとめ');
    if (wd === 4) add('physics', 'エッセンス 演習');
    if (wd === 5) add('physics', '復習・バッファ');
  }
  if (w === 13 || w === 14) add('physics', '良問の風 3周目（△×の問題）');
  if (w === 14 && wd === 6) { add('math', '理科大 過去問1年分（試し）'); add('physics', '理科大 過去問1年分（試し）'); }
  if (w === 15) {
    if (wd === 6) { add('math', '理科大 過去問1年分'); add('physics', '理科大 過去問1年分'); add('english', '理科大 過去問1年分'); }
    else if (hrs.math) { add('math', '過去問の×の解き直し'); add('physics', '過去問の×の解き直し'); }
  }
  if (w >= 16 && w <= 18) {
    if (wd === 6 || wd === 0) { add('math', '理科大 過去問1年分'); add('physics', '理科大 過去問1年分'); }
    if (wd === 6) add('english', '理科大 過去問1年分');
    if (wd !== 6 && wd !== 0) { add('math', '弱点分野の演習'); add('physics', '弱点分野の演習'); }
  }
  if (w === 19) {
    add('math', '総仕上げ（公式集・×△）'); add('physics', '総仕上げ（×△）');
    if (wd === 6 || wd === 0) add('english', '総仕上げ');
  }
  return out;
}

// ── 割り振り ──
// weights: 期間の各日の重み。spanning=true は「1項目が複数日にまたがる」（電験の章など）
function allocate(items, weights, spanning) {
  const n = items.length, W = weights.reduce((a, b) => a + b, 0);
  const days = weights.map(() => []);
  if (!n || !W) return days;
  const cum = [0];
  for (const w of weights) cum.push(cum[cum.length - 1] + w);
  items.forEach((it, i) => {
    if (spanning) {
      const a = (i / n) * W, b = ((i + 1) / n) * W;
      weights.forEach((w, d) => { if (w > 0 && Math.min(b, cum[d + 1]) - Math.max(a, cum[d]) > 1e-9) days[d].push(it); });
    } else {
      const mid = ((i + 0.5) / n) * W;
      const d = cum.findIndex((c, j) => j < weights.length && mid >= c && mid < cum[j + 1]);
      days[d >= 0 ? d : weights.length - 1].push(it);
    }
  });
  return days;
}

const cache = new Map();
// 期間ごとの割り振り表：{ [dateKey]: [{key,id,round,subject,label?}] }
export function periodAllocation(p) {
  const ck = String(p.key);
  if (cache.has(ck)) return cache.get(ck);
  const days = daysOfPeriod(p);
  const items = itemsForPeriod(p.key);
  const by = (stream) => items.filter((x) => x.stream === stream);
  const hrs = days.map(plannedHours);
  const wd = days.map(weekdayOf);
  const w = typeof p.key === 'number' ? p.key : 0;
  const result = Object.fromEntries(days.map((d) => [d, []]));
  const put = (list, weights, spanning = false) => {
    allocate(list, weights, spanning).forEach((arr, i) => {
      for (const it of arr) result[days[i]].push({ key: `${it.id}#${it.round}`, id: it.id, round: it.round, subject: it.subject, stream: it.stream, spanning });
    });
  };
  // 数学：基礎問は全日、合格るは2〜3日後（月〜金）
  put(by('kiso'), hrs.map((h) => h.math));
  put(by('gokaku'), hrs.map((h, i) => (wd[i] !== 6 && wd[i] !== 0 ? h.math : 0)));
  // 物理：W1〜W10 はエッセンスを土日、良問の風を月〜水。W11以降は全日
  if (w >= 1 && w <= 10) {
    put(by('essence'), wd.map((d) => (d === 6 || d === 0 ? 1 : 0)));
    put(by('ryomon'), wd.map((d) => (d >= 1 && d <= 3 ? 1 : 0)));
  } else {
    put(by('essence'), hrs.map((h) => h.physics));
    put(by('ryomon'), hrs.map((h) => h.physics));
  }
  // 英語：速単は土日に半分ずつ
  put(by('sokutan'), wd.map((d) => (d === 6 || d === 0 ? 1 : 0)));
  // 電験：章は複数日にまたがる
  put(by('denken'), hrs.map((h) => h.denken), true);
  cache.set(ck, result);
  return result;
}

// 先取りを反映した割り当て（指定日 k 時点）
// ・k より前に完了した項目（先取り分）を、k 以降の予定から外す
// ・残りは教材ごとに順番どおり前へ詰める。各日の問題数は元の予定と同じなので、週の終わりが空く
// ・数日かけて進める章（電験）は、完了していれば外すだけ
// done: { taskKey: 'YYYY-MM-DD' }
export function replanFrom(k, done = {}) {
  const p = periodOf(k);
  if (!p) return {};
  const alloc = periodAllocation(p);
  const days = daysOfPeriod(p).filter((d) => d >= k);
  const out = Object.fromEntries(days.map((d) => [d, []]));
  const doneBefore = (t) => done[t.key] && done[t.key] < k;
  const streams = new Map();
  for (const d of days) {
    for (const t of alloc[d]) {
      if (t.spanning) { if (!doneBefore(t)) out[d].push(t); continue; }
      let st = streams.get(t.stream);
      if (!st) streams.set(t.stream, (st = { items: [], quota: Object.fromEntries(days.map((x) => [x, 0])) }));
      st.items.push(t);
      st.quota[d]++;
    }
  }
  for (const st of streams.values()) {
    const rest = st.items.filter((t) => !doneBefore(t));
    let i = 0;
    for (const d of days) for (let n = 0; n < st.quota[d] && i < rest.length; n++) out[d].push(rest[i++]);
  }
  return out;
}

// その日の課題（先取りを反映した今日の割り当て＋教材以外の課題）
export function dayTasks(k, done = {}) {
  const p = periodOf(k);
  const out = Object.fromEntries(SUBJECT_ORDER.map((s) => [s, []]));
  if (!p) return out;
  for (const t of replanFrom(k, done)[k] || []) out[t.subject].push(t);
  for (const t of customTasks(p, k)) out[t.subject].push(t);
  return out;
}

// 今週の残り（明日以降に割り当てられた項目）＝先取りできる課題
export function aheadItems(k, done = {}) {
  const plan = replanFrom(k, done);
  const out = Object.fromEntries(SUBJECT_ORDER.map((s) => [s, []]));
  const seen = new Set((plan[k] || []).map((t) => t.key));
  for (const d of Object.keys(plan).sort()) {
    if (d <= k) continue;
    for (const t of plan[d]) if (!seen.has(t.key)) { seen.add(t.key); out[t.subject].push({ ...t, planned: d }); }
  }
  return out;
}

// その期間で、指定日より前に割り当てられた項目（持ち越し候補）
export function earlierItems(k) {
  const p = periodOf(k);
  if (!p) return [];
  const alloc = periodAllocation(p);
  const seen = new Set(), out = [];
  for (const d of daysOfPeriod(p)) {
    if (d >= k) break;
    for (const t of alloc[d]) if (!seen.has(t.key)) { seen.add(t.key); out.push({ ...t, from: d }); }
  }
  // 今日も続く章（電験）は持ち越しにしない
  const todayKeys = new Set((alloc[k] || []).map((t) => t.key));
  return out.filter((t) => !todayKeys.has(t.key));
}

// 期間の全項目（重複なし）
export function periodItems(p) {
  const seen = new Set(), out = [];
  for (const arr of Object.values(periodAllocation(p))) for (const t of arr) if (!seen.has(t.key)) { seen.add(t.key); out.push(t); }
  return out;
}

export function sumHours(h) { return SUBJECT_ORDER.reduce((a, s) => a + (h[s] || 0), 0); }
