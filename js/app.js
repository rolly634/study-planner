import { SUBJECTS, SUBJECT_ORDER, ITEMS, BOOKS } from './catalog.js';
import {
  START, END, todayKey, addDays, diffDays, fmtDay, periodOf, periodByKey, PERIOD_KEYS, daysOfPeriod,
  plannedHours, dayTasks, aheadItems, earlierItems, periodItems, rangesOf, sumHours, fromKey,
} from './plan.js';
import { store, hoursByDay, lastMark, sync, initSync, syncNow, auth } from './store.js';
import { pickTip } from './tips.js';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MARK = { o: '○', t: '△', x: '×' };
const MARK_NAME = { o: '自力で正解', t: '迷った・遅い', x: '解けない' };
const MISTAKES_APP = 'https://rolly634.github.io/study-mistakes-app/';

// 誤答アプリとの連携：写真待ち・項目ごとの誤答の状況
function waitingOf(s, itemId) { return s.waiting.some((w) => w.item_id === itemId); }
function mistakeBadge(s, itemId) {
  const m = s.mistakes[itemId];
  const parts = [];
  if (waitingOf(s, itemId)) parts.push('<span class="mb wait" title="写真待ち">📷</span>');
  if (m) parts.push(`<span class="mb ${m.caution ? 'ng' : m.teichaku === m.problems ? 'ok' : ''}" title="誤答アプリ：${m.problems}問中${m.teichaku}問定着${m.caution ? '・要注意あり' : ''}">${m.caution ? '要注意' : `誤${m.teichaku}/${m.problems}`}</span>`);
  return parts.join('');
}
function renderWaiting(s) {
  if (!s.waiting.length) return '';
  return `<section class="card waiting">
    <div class="wait-head"><h2>📷 写真待ち ${s.waiting.length}件</h2><button class="btn" data-dismiss-all>まとめて確認</button></div>
    <div class="muted" style="font-size:12.5px;margin:-4px 0 6px">×をつけた問題の写真を Claude のチャットに送ってください。送ると自動で消えます。</div>
    <ul class="wait-list">${s.waiting.map((w) => `<li class="c-${w.subject}"><span class="dot"></span><span class="grow">${esc(w.label)}</span><span class="muted num">${fmtDay(w.marked_on)}</span><button class="linkbtn" data-dismiss="${esc(w.mark_id)}">確認した</button></li>`).join('')}</ul>
  </section>`;
}

const view = {
  tab: 'today',
  date: todayKey(),
  followToday: true,
  week: periodOf(todayKey())?.key ?? 1,
  reviewFilter: 'all',
  aheadOpen: new Set(),   // 先取りを開いている科目
};

// ── 書式 ──
function fmtH(h) { return `${Math.round(h * 10) / 10}h`; }
function fmtDur(h) {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
function fmtClock(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function signed(h) { const v = Math.round(h * 10) / 10; return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)}h`; }
function pct(a, b) { return b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0; }
function seedOf(k) { return Math.max(0, diffDays(START, k)); }

// ── 描画 ──
function render() {
  renderTopbar();
  renderTimerbar();
  const v = $('#view');
  if (view.tab === 'today') v.innerHTML = renderToday();
  else if (view.tab === 'week') v.innerHTML = renderWeek();
  else if (view.tab === 'review') v.innerHTML = renderReview();
  else v.innerHTML = renderSettings();
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === view.tab));
}

function renderTopbar() {
  const el = $('#topbar');
  if (view.tab === 'today') {
    const p = periodOf(view.date);
    const isToday = view.date === todayKey();
    el.innerHTML = `
      <div class="datenav">
        <button class="iconbtn" data-nav="-1" aria-label="前の日">‹</button>
        <span class="label num">${fmtDay(view.date)}</span>
        ${p ? `<span class="period">${esc(p.label)}</span>` : ''}
        <button class="iconbtn" data-nav="1" aria-label="次の日">›</button>
      </div>
      ${isToday ? '' : '<button class="pill" data-nav="today">今日</button>'}`;
  } else if (view.tab === 'week') {
    const p = periodByKey(view.week);
    el.innerHTML = `
      <div class="datenav">
        <button class="iconbtn" data-pnav="-1" aria-label="前の週">‹</button>
        <span class="label">${esc(p.label)}</span>
        <span class="period num">${fmtDay(p.start)}${p.end !== p.start ? '–' + fmtDay(p.end) : ''}</span>
        <button class="iconbtn" data-pnav="1" aria-label="次の週">›</button>
      </div>
      ${periodOf(todayKey())?.key === view.week ? '' : '<button class="pill" data-pnav="now">今週</button>'}`;
  } else {
    el.innerHTML = `<div class="datenav"><span class="label">${view.tab === 'review' ? '復習リスト' : '設定'}</span></div>`;
  }
}

function renderTimerbar() {
  const s = store.get(), el = $('#timerbar');
  if (!s.active) { el.innerHTML = ''; return; }
  const subj = s.active.subject;
  el.innerHTML = `
    <div class="timerbar c-${subj}">
      <span class="dot"></span>
      <span>${SUBJECTS[subj].name} を計測中</span>
      <span class="grow"></span>
      <span class="elapsed num" data-live-clock>${fmtClock(Date.now() - s.active.start)}</span>
      <button class="btn" data-stop>■ 停止</button>
    </div>`;
}

// ── 今日 ──
function renderToday() {
  const k = view.date, s = store.get(), p = periodOf(k);
  if (!p) {
    const before = k < START;
    return `<div class="card notice">${before ? `計画は ${fmtDay(START)} から始まります。` : '計画期間（〜3/21）は終了しました。おつかれさまでした。'}</div>`;
  }
  if (p.key === 'EXAM1' || p.key === 'EXAM2') {
    return `<div class="card notice"><div style="font-size:28px">🎯</div><b>${esc(p.title)}</b><br>今日は本番です。これまでの積み重ねを信じて。</div>`;
  }
  const hrs = plannedHours(k), tasks = dayTasks(k, s.done), ahead = aheadItems(k, s.done);
  const actual = hoursByDay(s)[k] || {};
  const carry = {};
  for (const t of earlierItems(k)) if (!s.done[t.key]) (carry[t.subject] ||= []).push(t);
  const ranges = rangesOf(p);
  const subjects = SUBJECT_ORDER.filter((x) => hrs[x] > 0 || tasks[x].length || carry[x]?.length || actual[x] > 0);
  const achieved = s.achieved[k] || {};

  const planTotal = sumHours(hrs), actTotal = sumHours(actual);
  const achCount = subjects.filter((x) => achieved[x]).length;

  // TIPS
  const seed = seedOf(k);
  const tips = [];
  for (const subj of subjects) {
    if (subj === 'review') continue;
    const chapters = [...new Set(tasks[subj].filter((t) => t.id).map((t) => ITEMS[t.id].chapter))];
    if (!chapters.length && subj === 'physics') chapters.push('力学');
    const tip = pickTip(subj, chapters, seed);
    if (tip) tips.push({ subj, tip });
  }
  const rtip = pickTip('review', [''], seed);
  if (rtip && tips.length < 2) tips.push({ subj: 'review', tip: rtip });

  const rows = subjects.map((subj) => renderRow(subj, k, s, hrs[subj], tasks[subj], carry[subj] || [], ahead[subj] || [], actual[subj] || 0, ranges[subj], !!achieved[subj])).join('');

  const daySessions = s.sessions.filter((x) => todayOf(x.start) === k).sort((a, b) => a.start - b.start);

  return `
    ${k === todayKey() ? renderWaiting(s) : ''}
    <section class="card summary">
      <div>
        <div class="muted" style="font-size:12px">今日の学習時間</div>
        <div><span class="big num" data-live-total>${fmtDur(actTotal)}</span> <span class="muted num">/ 計画 ${fmtH(planTotal)}</span></div>
      </div>
      <div class="grow">
        <div class="bar"><i data-live-totalbar style="width:${pct(actTotal, planTotal)}%"></i></div>
        <div class="muted" style="font-size:12px;margin-top:4px">目標達成 ${achCount}/${subjects.length} 科目</div>
      </div>
    </section>

    ${tips.length ? `<section class="card"><h2>TIPS</h2><div class="tips">
      ${tips.map((t) => `<div class="tip c-${t.subj}"><span class="tag">${SUBJECTS[t.subj].name}</span><span>${esc(t.tip)}</span></div>`).join('')}
    </div></section>` : ''}

    <section class="board">
      <div class="board-head"><div>今日の学習課題</div><div>実際の進捗</div></div>
      ${rows || '<div class="notice">今日の課題はありません</div>'}
    </section>

    <section class="card">
      <h2>学習時間の記録</h2>
      ${daySessions.length ? `<ul class="sessions">${daySessions.map((x) => `
        <li class="c-${x.subject}"><span class="dot"></span><span>${SUBJECTS[x.subject].name}</span>
          <span class="muted num">${x.manual ? '手動追加' : `${hm(x.start)}–${hm(x.end)}`}${x.source === 'mistakes' ? '・誤答アプリ' : ''}</span>
          <span class="grow"></span><span class="num">${fmtDur((x.end - x.start) / 3600000)}</span>
          <button class="linkbtn" data-del-session="${x.id}" aria-label="削除">削除</button></li>`).join('')}</ul>`
        : '<div class="muted" style="font-size:13px">まだ記録はありません。各科目の「開始」で計測できます（復習は誤答アプリが自動で記録します）。</div>'}
      <form class="inline-form" id="manualForm">
        <select name="subject">${SUBJECT_ORDER.filter((x) => x !== 'review').map((x) => `<option value="${x}">${SUBJECTS[x].name}</option>`).join('')}</select>
        <input name="minutes" type="number" inputmode="numeric" min="1" max="720" placeholder="分" required>
        <button class="btn" type="submit">時間を追加</button>
      </form>
    </section>`;
}

function renderRow(subj, k, s, planH, tasks, carry, ahead, actH, range, achieved) {
  const li = (t) => {
    const done = !!s.done[t.key];
    if (t.custom) {
      return `<li class="${done ? 'done' : ''}"><button class="chk ${done ? 'on' : ''}" data-chk="${esc(t.key)}" aria-label="完了">✓</button>
        <span class="task-label custom">${esc(t.label)}</span></li>`;
    }
    const it = ITEMS[t.id], m = lastMark(s, t.id);
    return `<li class="${done ? 'done' : ''}"><button class="chk ${done ? 'on' : ''}" data-chk="${esc(t.key)}" aria-label="完了">✓</button>
      <button class="task-label" data-item="${t.id}" data-key="${esc(t.key)}">${esc(it.label)}${t.round > 1 ? ' <span class="muted">(2周目)</span>' : ''}</button>
      ${mistakeBadge(s, t.id)}${m ? `<span class="mk ${m}">${MARK[m]}</span>` : ''}${t.planned ? `<span class="plan-day">${'日月火水木金土'[fromKey(t.planned).getDay()]}</span>` : ''}</li>`;
  };
  const aheadOpen = view.aheadOpen.has(subj);
  const aheadLeft = ahead.filter((t) => !s.done[t.key]).length;
  const aheadDone = ahead.length - aheadLeft;
  const all = [...tasks, ...carry];
  const doneN = all.filter((t) => s.done[t.key]).length;
  const marksToday = { o: 0, t: 0, x: 0 };
  for (const [id, arr] of Object.entries(s.marks)) {
    if (ITEMS[id]?.subject !== subj) continue;
    for (const r of arr) if (r.d === k) marksToday[r.m]++;
  }
  const running = s.active?.subject === subj;
  const isToday = k === todayKey();
  return `
    <div class="row c-${subj}">
      <div class="plan">
        <div class="subj-head"><span class="dot"></span>${SUBJECTS[subj].name}<span class="h num">${planH ? fmtH(planH) : ''}</span></div>
        ${range ? `<div class="range">${esc(range)}</div>` : ''}
        <ul class="tasks">${tasks.map(li).join('')}</ul>
        ${carry.length ? `<div class="carry-h">持ち越し（${carry.length}）</div><ul class="tasks">${carry.map(li).join('')}</ul>` : ''}
        ${ahead.length ? `<button class="ahead-toggle" data-ahead="${subj}" aria-expanded="${aheadOpen}">先取り（残り${aheadLeft}${aheadDone ? `・済${aheadDone}` : ''}）<span class="chev">${aheadOpen ? '▾' : '▸'}</span></button>
          ${aheadOpen ? `<ul class="tasks ahead">${ahead.map(li).join('')}</ul>` : ''}` : ''}
      </div>
      <div class="act">
        <div class="time num"><b data-live-subj="${subj}">${fmtDur(actH)}</b> / ${planH ? fmtH(planH) : '—'}</div>
        <div class="bar subj"><i data-live-subjbar="${subj}" style="width:${pct(actH, planH)}%"></i></div>
        ${isToday && subj === 'review' ? `<a class="timer-btn auto" href="${MISTAKES_APP}" target="_blank" rel="noopener">誤答アプリで自動記録 ↗</a>`
          : isToday ? `<button class="timer-btn ${running ? 'running' : ''}" data-timer="${subj}">
          ${running ? `■ <span class="num" data-live-clock>${fmtClock(Date.now() - s.active.start)}</span>` : '▶ 開始'}</button>` : ''}
        <div class="stat-line">
          ${all.length ? `<span>完了 ${doneN}/${all.length}</span>` : ''}
          ${marksToday.o + marksToday.t + marksToday.x ? `<span><span class="mk o">○</span>${marksToday.o} <span class="mk t">△</span>${marksToday.t} <span class="mk x">×</span>${marksToday.x}</span>` : ''}
        </div>
        <label class="achieve ${achieved ? 'on' : ''}"><input type="checkbox" data-ach="${subj}" ${achieved ? 'checked' : ''}>目標達成</label>
      </div>
    </div>`;
}

function todayOf(ms) { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function hm(ms) { const d = new Date(ms); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; }

// ── 予実（週） ──
function renderWeek() {
  const s = store.get(), p = periodByKey(view.week), days = daysOfPeriod(p);
  const byDay = hoursByDay(s);
  const today = todayKey();
  const plan = {}, act = {};
  for (const subj of SUBJECT_ORDER) { plan[subj] = 0; act[subj] = 0; }
  const dayRows = days.map((d) => {
    const ph = plannedHours(d), ah = byDay[d] || {};
    for (const subj of SUBJECT_ORDER) { plan[subj] += ph[subj] || 0; act[subj] += ah[subj] || 0; }
    return { d, plan: sumHours(ph), act: sumHours(ah) };
  });
  const planT = sumHours(plan), actT = sumHours(act);

  // 課題の消化率
  const items = periodItems(p);
  const comp = {};
  for (const t of items) { const c = (comp[t.subject] ||= { done: 0, total: 0 }); c.total++; if (s.done[t.key]) c.done++; }
  const compDone = items.filter((t) => s.done[t.key]).length;

  // 累計（開始日〜今日）
  const last = today < END ? today : END;
  let cumPlan = 0, cumAct = 0, cumPlanPrev = 0;
  if (last >= START) {
    for (let d = START; d <= last; d = addDays(d, 1)) {
      const h = sumHours(plannedHours(d));
      cumPlan += h;
      if (d < today) cumPlanPrev += h;
    }
    for (const [d, h] of Object.entries(byDay)) if (d >= START && d <= last) cumAct += sumHours(h);
  }
  // 遅れ・貯金は「昨日までの計画」と比べる（今日の分はまだ途中なので含めない）
  let planToDate = 0, planPrev = 0;
  for (const r of dayRows) { if (r.d <= today) planToDate += r.plan; if (r.d < today) planPrev += r.plan; }
  const diffW = actT - planPrev, diffC = cumAct - cumPlanPrev;

  const subjects = SUBJECT_ORDER.filter((x) => plan[x] > 0 || act[x] > 0);
  const maxH = Math.max(1, ...subjects.map((x) => Math.max(plan[x], act[x])));
  const ranges = rangesOf(p);

  return `
    <div class="kpis">
      <div class="kpi"><div class="k">今週の学習時間</div><div class="v num">${fmtH(actT)}</div><div class="s num">計画 ${fmtH(planT)}（今日まで ${fmtH(planToDate)}）</div></div>
      <div class="kpi"><div class="k">昨日までの計画との差</div><div class="v num ${diffW >= 0 ? 'pos' : 'neg'}">${signed(diffW)}</div><div class="s">${diffW >= 0 ? '予定どおり' : '遅れ'}${planToDate > planPrev && actT < planToDate ? `・今日の残り ${fmtH(planToDate - actT)}` : ''}</div></div>
      <div class="kpi"><div class="k">課題の消化</div><div class="v num">${pct(compDone, items.length)}%</div><div class="s num">${compDone}/${items.length} 項目</div></div>
      <div class="kpi"><div class="k">累計（${fmtDay(START)}〜）</div><div class="v num">${fmtH(cumAct)}</div><div class="s num"><span class="${diffC >= 0 ? 'pos' : 'neg'}">${diffC >= 0 ? '貯金' : '遅れ'} ${signed(diffC)}</span>（昨日まで）</div></div>
    </div>

    <section class="card">
      <h2>科目別 計画と実績</h2>
      <div class="legend"><span><i style="background:var(--track)"></i>計画</span><span><i style="background:var(--text-2)"></i>実績（科目の色）</span></div>
      <div class="hbars">
        ${subjects.map((x) => `
          <div class="hbar c-${x}" title="${SUBJECTS[x].name}：実績 ${fmtH(act[x])} / 計画 ${fmtH(plan[x])}">
            <div class="top"><span class="dot"></span><span class="name">${SUBJECTS[x].name}</span>
              <span class="val num">${fmtH(act[x])} / ${fmtH(plan[x])}　<span class="${act[x] - plan[x] >= 0 ? 'pos' : 'neg'}">${signed(act[x] - plan[x])}</span></span></div>
            <div class="tracks">
              <div class="plan" style="width:${(plan[x] / maxH) * 100}%"></div>
              <div class="actual" style="width:${Math.max(act[x] > 0 ? 1 : 0, (act[x] / maxH) * 100)}%"></div>
            </div>
          </div>`).join('') || '<div class="muted">この期間の計画はありません</div>'}
      </div>
    </section>

    <section class="card">
      <h2>日ごとの計画と実績</h2>
      <div class="legend"><span><i style="background:var(--track)"></i>計画</span><span><i style="background:var(--accent)"></i>実績</span></div>
      ${dayChart(dayRows, today)}
    </section>

    <section class="card">
      <h2>科目別の詳細</h2>
      <table class="tbl num">
        <thead><tr><th>科目</th><th>計画</th><th>実績</th><th>差</th><th>課題</th></tr></thead>
        <tbody>${subjects.map((x) => `<tr class="c-${x}"><td><span class="dot"></span> ${SUBJECTS[x].name}</td>
          <td>${fmtH(plan[x])}</td><td>${fmtH(act[x])}</td>
          <td class="${act[x] - plan[x] >= 0 ? 'pos' : 'neg'}">${signed(act[x] - plan[x])}</td>
          <td>${comp[x] ? `${comp[x].done}/${comp[x].total}` : '—'}</td></tr>`).join('')}
          <tr><td><b>合計</b></td><td>${fmtH(planT)}</td><td>${fmtH(actT)}</td><td class="${actT - planT >= 0 ? 'pos' : 'neg'}">${signed(actT - planT)}</td><td>${compDone}/${items.length}</td></tr>
        </tbody>
      </table>
    </section>

    ${Object.keys(ranges).length ? `<section class="card"><h2>この期間の範囲</h2>
      <div class="tips">${SUBJECT_ORDER.filter((x) => ranges[x]).map((x) => `<div class="tip c-${x}"><span class="tag">${SUBJECTS[x].name}</span><span>${esc(ranges[x])}</span></div>`).join('')}</div>
    </section>` : ''}`;
}

function dayChart(rows, today) {
  const W = 340, H = 170, padL = 28, padB = 30, padT = 10, padR = 4;
  const maxV = Math.max(2, ...rows.map((r) => Math.max(r.plan, r.act)));
  const top = Math.ceil(maxV / 2) * 2;
  const cw = (W - padL - padR) / rows.length;
  const bw = Math.min(14, cw / 3);
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);
  const ticks = [0, top / 2, top];
  let svg = `<svg class="daychart" viewBox="0 0 ${W} ${H}" role="img" aria-label="日ごとの計画と実績">`;
  for (const t of ticks) svg += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/><text x="${padL - 4}" y="${y(t) + 4}" text-anchor="end">${t}h</text>`;
  rows.forEach((r, i) => {
    const cx = padL + cw * i + cw / 2;
    const bar = (v, x, cls) => {
      const h = Math.max(0, y(0) - y(v));
      if (h <= 0) return '';
      const rr = Math.min(4, h, bw / 2);
      const x1 = x, x2 = x + bw, yt = y(v), yb = y(0);
      return `<path class="${cls}" d="M${x1},${yb} V${yt + rr} Q${x1},${yt} ${x1 + rr},${yt} H${x2 - rr} Q${x2},${yt} ${x2},${yt + rr} V${yb} Z"/>`;
    };
    const d = fromKey(r.d);
    svg += `<g><title>${fmtDay(r.d)} 計画 ${fmtH(r.plan)} / 実績 ${fmtDur(r.act)}</title>
      <rect x="${cx - cw / 2}" y="${padT}" width="${cw}" height="${H - padT}" fill="transparent"/>
      ${bar(r.plan, cx - bw - 1, 'plan')}${bar(r.act, cx + 1, 'act')}
      <text x="${cx}" y="${H - 14}" text-anchor="middle" class="${r.d === today ? 'today-l' : ''}">${'日月火水木金土'[d.getDay()]}</text>
      <text x="${cx}" y="${H - 2}" text-anchor="middle" class="${r.d === today ? 'today-l' : ''}">${d.getDate()}</text></g>`;
  });
  return svg + '</svg>';
}

// ── 復習 ──
function renderReview() {
  const s = store.get();
  const list = Object.entries(s.marks)
    .filter(([id, arr]) => ITEMS[id] && arr.length && arr[arr.length - 1].m !== 'o')
    .map(([id, arr]) => ({ id, it: ITEMS[id], arr, last: arr[arr.length - 1] }))
    .sort((a, b) => (a.last.d < b.last.d ? 1 : a.last.d > b.last.d ? -1 : 0));
  const counts = {};
  for (const r of list) counts[r.it.subject] = (counts[r.it.subject] || 0) + 1;
  const f = view.reviewFilter;
  const shown = list.filter((r) => f === 'all' || r.it.subject === f);
  const caution = Object.entries(s.mistakes).filter(([id, m]) => m.caution && ITEMS[id]).map(([id]) => ITEMS[id]);
  return `
    ${renderWaiting(s)}
    ${caution.length ? `<section class="card"><h2>誤答アプリで要注意（2回続けて解けなかった）</h2><ul class="rv">${caution.map((it) => `
      <li class="c-${it.subject}"><span class="mb ng">要注意</span><button class="lbl" data-item="${it.id}">${esc(it.label)}<small>${esc(BOOKS[it.book].name)}・${esc(it.chapter)}</small></button></li>`).join('')}</ul></section>` : ''}
    <div class="chips">
      <button class="chip ${f === 'all' ? 'on' : ''}" data-filter="all">すべて ${list.length}</button>
      ${SUBJECT_ORDER.filter((x) => counts[x]).map((x) => `<button class="chip ${f === x ? 'on' : ''}" data-filter="${x}">${SUBJECTS[x].name} ${counts[x]}</button>`).join('')}
    </div>
    <section class="card">
      <h2>△と×の問題（最後の結果が○になると外れます）</h2>
      ${shown.length ? `<ul class="rv">${shown.map((r) => `
        <li class="c-${r.it.subject}"><span class="mk ${r.last.m}">${MARK[r.last.m]}</span>
          <button class="lbl" data-item="${r.id}">${esc(r.it.label)}<small>${esc(BOOKS[r.it.book].name)}・${esc(r.it.chapter)}・最終 ${fmtDay(r.last.d)}</small></button>
          ${mistakeBadge(s, r.id)}<span class="hist">${r.arr.map((x) => `<span class="mk ${x.m}" title="${fmtDay(x.d)}${x.src === 'mistakes' ? '（誤答アプリで定着）' : ''}">${MARK[x.m]}</span>`).join('')}</span></li>`).join('')}</ul>`
        : '<div class="muted" style="font-size:14px">△・×の問題はまだありません。今日の課題の問題名をタップすると○△×を記録できます。</div>'}
    </section>`;
}

// ── 設定 ──
function renderSettings() {
  const theme = getTheme();
  return `
    ${renderAccount()}
    <section class="card">
      <h2>表示</h2>
      <div class="chips">
        ${[['auto', '自動'], ['light', 'ライト'], ['dark', 'ダーク']].map(([v, l]) => `<button class="chip ${theme === v ? 'on' : ''}" data-theme-set="${v}">${l}</button>`).join('')}
      </div>
    </section>
    <section class="card">
      <h2>バックアップ</h2>
      <div class="inline-form">
        <button class="btn" data-export>書き出し（JSON）</button>
        <label class="btn">読み込み<input type="file" accept="application/json,.json" data-import hidden></label>
      </div>
    </section>
    <section class="card">
      <h2>リセット</h2>
      <button class="btn danger" data-reset>すべての記録を消去</button>
    </section>
    <div class="muted" style="font-size:12px;text-align:center">学習計画 v4（${fmtDay(START)}〜${fmtDay(END)}）・<a href="https://github.com/rolly634/study-planner" style="color:inherit">GitHub</a></div>`;
}

const STATUS_TEXT = {
  local: '端末内に保存', connecting: '接続中…', signedout: '未ログイン（端末内に保存）', syncing: '同期中…',
  ok: '同期済み', offline: 'オフライン', error: '同期エラー',
};
function renderAccount() {
  const q = store.queueSize();
  if (sync.email) {
    return `<section class="card">
      <h2>同期</h2>
      <div style="font-size:14px"><b>${esc(sync.email)}</b> でログイン中</div>
      <div class="muted" style="font-size:13px;margin:4px 0 8px">${STATUS_TEXT[sync.status] || ''}${sync.lastSync ? `・最終 ${hm(sync.lastSync)}` : ''}${q ? `・未送信 ${q}件` : ''}${sync.message ? `<br>${esc(sync.message)}` : ''}</div>
      <div class="inline-form" style="margin-top:0">
        <button class="btn" data-sync>今すぐ同期</button>
        <button class="btn" data-signout>ログアウト</button>
      </div>
      <div class="muted" style="font-size:12px;margin-top:8px">スマホとPCで同じ記録を使えます。Claude アプリで話した進捗もここに反映されます。</div>
    </section>`;
  }
  return `<section class="card">
    <h2>ログインして同期</h2>
    <div style="font-size:13px;color:var(--text-2);margin-bottom:8px">${sync.status === 'connecting' ? '接続中…' : sync.status === 'offline' ? esc(sync.message) : 'ログインすると、スマホとPCで記録を同期し、Claude から進捗を記録できます。今は端末内に保存しています。'}</div>
    <form id="authForm" class="auth-form">
      <input name="email" type="email" autocomplete="email" placeholder="メールアドレス" required>
      <input name="password" type="password" autocomplete="current-password" placeholder="パスワード（6文字以上）" minlength="6" required>
      <div class="inline-form" style="margin-top:0">
        <button class="btn primary" type="submit" name="mode" value="in">ログイン</button>
        <button class="btn" type="submit" name="mode" value="up">新規登録</button>
      </div>
      <div class="muted" id="authMsg" style="font-size:13px"></div>
    </form>
  </section>`;
}

function getTheme() { try { return localStorage.getItem('study-planner:theme') || 'auto'; } catch { return 'auto'; } }
function applyTheme(t) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

// ── ○△× ダイアログ ──
let dlgCtx = null;
function openMark(itemId, taskKey) {
  dlgCtx = { itemId, taskKey };
  renderMarkDlg();
  const d = $('#markDlg');
  if (!d.open) d.showModal();
}
function renderMarkDlg() {
  const { itemId, taskKey } = dlgCtx, s = store.get(), it = ITEMS[itemId];
  const hist = s.marks[itemId] || [];
  const done = taskKey ? !!s.done[taskKey] : false;
  $('#markBody').innerHTML = `
    <h3>${esc(it.label)}</h3>
    <div class="sub">${esc(BOOKS[it.book].name)}・${esc(it.chapter)}</div>
    <div class="markbtns">
      ${['o', 't', 'x'].map((m) => `<button class="${m}" data-mark="${m}">${MARK[m]}<small>${MARK_NAME[m]}</small></button>`).join('')}
    </div>
    <div class="histlist">${hist.length ? `これまで：${hist.map((h, i) => `${i + 1}回目 ${fmtDay(h.d)} <span class="mk ${h.m}">${MARK[h.m]}</span>${h.src === 'mistakes' ? '<small>（誤答アプリで定着）</small>' : ''}`).join('　')}` : 'まだ記録はありません'}</div>
    ${s.mistakes[itemId] || waitingOf(s, itemId) ? `<div class="histlist">誤答アプリ：${s.mistakes[itemId] ? `${s.mistakes[itemId].problems}問中 ${s.mistakes[itemId].teichaku}問定着${s.mistakes[itemId].caution ? '・<b style="color:var(--mark-x)">要注意あり</b>' : ''}` : ''}${waitingOf(s, itemId) ? '　📷 写真待ち' : ''}　<a href="${MISTAKES_APP}" target="_blank" rel="noopener">開く ↗</a></div>` : ''}
    <div class="row-btns">
      ${hist.length ? '<button class="btn" data-unmark>最後の記録を取り消す</button>' : '<span></span>'}
      <span>
        ${taskKey ? `<button class="btn" data-dlg-done>${done ? '未完了に戻す' : '完了にする'}</button>` : ''}
        <button class="btn primary" data-close>閉じる</button>
      </span>
    </div>`;
}
function markDate() { return view.tab === 'today' ? view.date : todayKey(); }

// ── イベント ──
document.addEventListener('click', (e) => {
  const t = e.target.closest('button, [data-nav], [data-pnav]');
  if (!t) return;
  const ds = t.dataset;
  if (ds.tab) { view.tab = ds.tab; window.scrollTo(0, 0); render(); return; }
  if (ds.nav) {
    if (ds.nav === 'today') { view.date = todayKey(); view.followToday = true; }
    else { view.date = addDays(view.date, Number(ds.nav)); view.followToday = view.date === todayKey(); }
    render(); return;
  }
  if (ds.pnav) {
    if (ds.pnav === 'now') view.week = periodOf(todayKey())?.key ?? 1;
    else {
      const i = PERIOD_KEYS.indexOf(view.week) + Number(ds.pnav);
      if (i >= 0 && i < PERIOD_KEYS.length) view.week = PERIOD_KEYS[i];
    }
    render(); return;
  }
  if (ds.chk) { store.toggleDone(ds.chk, view.date); return; }
  if (ds.item) { openMark(ds.item, ds.key || null); return; }
  if (ds.timer) { const s = store.get(); if (s.active?.subject === ds.timer) store.stopTimer(); else store.startTimer(ds.timer); return; }
  if ('stop' in ds) { store.stopTimer(); return; }
  if (ds.delSession) { if (confirm('この記録を削除しますか？')) store.removeSession(ds.delSession); return; }
  if (ds.filter) { view.reviewFilter = ds.filter; render(); return; }
  if (ds.dismiss) { store.dismissWaiting([ds.dismiss]); return; }
  if ('dismissAll' in ds) { store.dismissWaiting(store.get().waiting.map((w) => w.mark_id)); return; }
  if (ds.ahead) { if (view.aheadOpen.has(ds.ahead)) view.aheadOpen.delete(ds.ahead); else view.aheadOpen.add(ds.ahead); render(); return; }
  if (ds.themeSet) { try { localStorage.setItem('study-planner:theme', ds.themeSet); } catch {} applyTheme(ds.themeSet); render(); return; }
  if ('export' in ds) { download(); return; }
  if ('sync' in ds) { syncNow(); return; }
  if ('signout' in ds) { if (confirm('ログアウトしますか？（この端末の記録はそのまま残ります）')) auth.signOut(); return; }
  if ('reset' in ds) { if (confirm('すべての記録を消去します。よろしいですか？（元に戻せません）')) store.reset(); return; }
  // ダイアログ
  if (ds.mark) {
    store.addMark(dlgCtx.itemId, ds.mark, markDate());
    if (dlgCtx.taskKey && !store.get().done[dlgCtx.taskKey]) store.toggleDone(dlgCtx.taskKey, markDate());
    $('#markDlg').close(); return;
  }
  if ('unmark' in ds) { store.removeLastMark(dlgCtx.itemId); renderMarkDlg(); return; }
  if ('dlgDone' in ds) { store.toggleDone(dlgCtx.taskKey, markDate()); renderMarkDlg(); return; }
  if ('close' in ds) { $('#markDlg').close(); return; }
});
$('#markDlg').addEventListener('click', (e) => { if (e.target.id === 'markDlg') e.target.close(); });

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.ach) { store.toggleAchieved(view.date, t.dataset.ach); return; }
  if ('import' in t.dataset && t.files?.[0]) {
    t.files[0].text().then((txt) => {
      try { store.importJSON(txt); alert('読み込みました'); } catch (err) { alert('読み込めませんでした：' + err.message); }
    });
  }
});
document.addEventListener('submit', async (e) => {
  if (e.target.id === 'authForm') {
    e.preventDefault();
    const f = new FormData(e.target), msg = $('#authMsg');
    const mode = e.submitter?.value || 'in';
    if (!auth.ready()) { msg.textContent = 'サーバーにつながっていません'; return; }
    msg.textContent = mode === 'up' ? '登録中…' : 'ログイン中…';
    try {
      if (mode === 'up') {
        const needConfirm = await auth.signUp(f.get('email'), f.get('password'));
        if (needConfirm) msg.textContent = '確認メールを送りました。メールのリンクを開いてから「ログイン」してください。';
      } else {
        await auth.signIn(f.get('email'), f.get('password'));
      }
    } catch (err) {
      msg.textContent = (err.message || String(err)).includes('Invalid login') ? 'メールアドレスかパスワードが違います' : 'エラー：' + (err.message || err);
    }
    return;
  }
  if (e.target.id !== 'manualForm') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const min = Number(f.get('minutes'));
  if (min > 0) store.addManual(f.get('subject'), view.date, min);
});

function download() {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `study-planner-${todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── 計測中の表示を毎秒更新（画面全体は描き直さない） ──
function tick() {
  const s = store.get();
  if (!s.active) return;
  const el = Date.now() - s.active.start;
  document.querySelectorAll('[data-live-clock]').forEach((n) => { n.textContent = fmtClock(el); });
  if (view.tab === 'today') {
    const a = hoursByDay(s)[view.date] || {}, h = plannedHours(view.date);
    document.querySelectorAll('[data-live-subj]').forEach((n) => { n.textContent = fmtDur(a[n.dataset.liveSubj] || 0); });
    document.querySelectorAll('[data-live-subjbar]').forEach((n) => { const k = n.dataset.liveSubjbar; n.style.width = pct(a[k] || 0, h[k]) + '%'; });
    const tot = $('[data-live-total]'); if (tot) tot.textContent = fmtDur(sumHours(a));
    const tb = $('[data-live-totalbar]'); if (tb) tb.style.width = pct(sumHours(a), sumHours(h)) + '%';
  }
}
setInterval(tick, 1000);

// 復帰時：日付が変わっていれば今日に合わせ、計測時間を再計算
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  store.reload();
  if (view.followToday) view.date = todayKey();
  syncNow();
});
setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
window.addEventListener('online', () => syncNow());
window.addEventListener('storage', (e) => { if (e.key === 'study-planner:v1') store.reload(); });

// 入力中は描き直さない（入力内容が消えないように）。入力が終わったら描き直す
let pendingRender = false;
function typing() { const a = document.activeElement; return a && $('#view').contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox'; }
store.subscribe(() => {
  if (typing()) { pendingRender = true; renderTimerbar(); return; }
  render();
  if ($('#markDlg').open && dlgCtx) renderMarkDlg();
});
document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender && !typing()) { pendingRender = false; render(); } }, 0));

applyTheme(getTheme());
render();
initSync();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
