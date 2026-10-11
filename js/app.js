// Кошелёк: экраны и действия.

import * as db from './db.js';
import {
  rub, money, MINUS, today, monthOf, addMonths, monthEnd, monthTitle, dayTitle, dateDots, dateRu,
  esc, hash, uid, normText, prettyDesc, parseMoney, saveFile, monthShort,
} from './util.js';
import { DEFAULT_CATEGORIES, DEFAULT_TAGS, BANKS } from './catalog.js';
import { merchantKey, isGenericKey, autoCategory, sortRules, makeRule, ruleMatches, dirOf, categoryFits, ruleScopes, suggestScope } from './categorize.js';
import { parseFile, tableToTx, ROLE_LABELS } from './importers.js';
import { buildReport, exportXlsx, chartPng, isWorkTx } from './report.js';

const APP_VERSION = '1.2.1';

const S = {
  txs: [], byId: new Map(), rules: [], sortedRules: [], imports: [],
  cats: [], catMap: new Map(), tags: [], tagMap: new Map(), profiles: {}, settings: {},
  tab: 'home',
  ops: { month: monthOf(today()), q: '', cat: 'all', tag: 'all', range: null },
  rep: { preset: 'month', from: '', to: '', includeWork: false, bank: '' },
  queue: { skipped: [], split: new Set() },
};

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const screen = $('#screen');
const sheet = $('#sheet');

function bind(root, h) {
  root.onclick = (e) => {
    const el = e.target.closest('[data-act]');
    if (el && root.contains(el) && h[el.dataset.act]) h[el.dataset.act](el, e);
  };
  root.onchange = (e) => {
    const el = e.target.closest('[data-change]');
    if (el && h[el.dataset.change]) h[el.dataset.change](el, e);
  };
  root.oninput = (e) => {
    const el = e.target.closest('[data-input]');
    if (el && h[el.dataset.input]) h[el.dataset.input](el, e);
  };
  root.onsubmit = (e) => {
    const el = e.target.closest('[data-submit]');
    if (el) { e.preventDefault(); if (h[el.dataset.submit]) h[el.dataset.submit](el, e); }
  };
}

// ---------- данные ----------
function reindex() {
  S.byId = new Map(S.txs.map(t => [t.id, t]));
  S.catMap = new Map(S.cats.map(c => [c.id, c]));
  S.tagMap = new Map(S.tags.map(t => [t.id, t]));
  S.sortedRules = sortRules(S.rules);
}
async function load() {
  const [txs, rules, imports, meta] = await Promise.all(['tx', 'rules', 'imports', 'meta'].map(db.getAll));
  const m = Object.fromEntries(meta.map(r => [r.key, r.value]));
  S.cats = m.categories || DEFAULT_CATEGORIES.map(c => ({ ...c }));
  S.tags = m.tags || DEFAULT_TAGS.map(t => ({ ...t }));
  S.profiles = m.profiles || {};
  S.settings = m.settings || {};
  // Новые категории из обновлений приложения — добавить, но не возвращать удалённые человеком.
  const knownCats = new Set(S.settings.knownCats || S.cats.map(c => c.id));
  for (const d of DEFAULT_CATEGORIES) {
    if (knownCats.has(d.id) || S.cats.some(c => c.id === d.id)) continue;
    const at = S.cats.findIndex(c => c.id === 'fees');
    S.cats.splice(at >= 0 ? at : S.cats.findIndex(c => c.type !== 'out'), 0, { ...d });
  }
  const fun = S.cats.find(c => c.id === 'fun');
  if (fun && fun.name === 'Развлечения и хобби') fun.name = 'Спорт, развлечения, хобби';
  S.settings.knownCats = DEFAULT_CATEGORIES.map(c => c.id);
  S.txs = txs;
  S.rules = rules;
  S.imports = imports.sort((a, b) => b.at.localeCompare(a.at));
  reindex();
  await db.setMeta('categories', S.cats);
  await db.setMeta('settings', S.settings);
  if (!m.tags) await db.setMeta('tags', S.tags);
}
const saveTxs = (list) => db.putMany('tx', list);
const saveCats = () => { reindex(); return db.setMeta('categories', S.cats); };
const saveTags = () => { reindex(); return db.setMeta('tags', S.tags); };
const saveSettings = () => db.setMeta('settings', S.settings);

const isWork = (t) => isWorkTx(t, S.tagMap);
const catName = (id) => (S.catMap.get(id) ? S.catMap.get(id).name : 'Без категории');
/** Ждёт ответа во вкладке «Разобрать»: нет категории и не отмечена «не учитывать». */
const needsAnswer = (t) => !t.category && !t.ignored;
/** Входит в расходы и доходы: не «не учитывать» и не перевод между своими счетами. */
const counted = (t) => !t.ignored && !(S.catMap.get(t.category) && S.catMap.get(t.category).type === 'transfer');
function updateReimb(t) {
  if (isWork(t)) { if (!t.reimb) t.reimb = 'pending'; }
  else t.reimb = null;
}

/** Применить правило ко всем операциям с тем же получателем. Выставленные вручную меняются,
 *  только когда человек сам поменял категорию в карточке операции (includeManual). */
function applyRule(rule, exceptId, includeManual = false) {
  const changed = [];
  for (const t of S.txs) {
    if (t.id === exceptId || (!includeManual && t.catBy === 'manual')) continue;
    if (!ruleMatches(rule, t)) continue;
    if (rule.ignore) { t.ignored = true; t.ruleId = rule.id; }
    else {
      if (!categoryFits(S.catMap.get(rule.category), t)) continue;
      t.category = rule.category; t.catBy = includeManual ? 'manual' : 'rule'; t.ruleId = rule.id;
    }
    changed.push(t);
  }
  return changed;
}

const autoCtx = () => ({ owners: S.settings.owners || [], ownNumbers: S.settings.ownNumbers || [] });

const BANK_ALIASES = [
  ['Т-Банк', /T-?BANK|Т-?БАНК|TINKOFF|ТИНЬКОФФ/], ['Ozon Банк', /OZON|ОЗОН/], ['Сбербанк', /SBER|СБЕР/],
  ['ВТБ', /(^|[^A-ZА-Я])(VTB|ВТБ)([^A-ZА-Я]|$)/], ['Альфа-Банк', /ALFA|АЛЬФА/], ['Яндекс', /YANDEX|ЯНДЕКС/],
];
/** Какой банк назван в описании перевода («Перевод в T-Bank»), кроме своего собственного. */
function mentionedBank(t) {
  const u = (t.desc + ' ' + (t.raw || '')).toUpperCase().replace(/Ё/g, 'Е');
  for (const [b, re] of BANK_ALIASES) if (b !== t.bank && re.test(u)) return b;
  return null;
}
const transferLike = (t) => /ПЕРЕВОД|ПОПОЛНЕНИЕ|СБП/.test((t.desc + ' ' + (t.raw || '')).toUpperCase().replace(/Ё/g, 'Е')) || /перевод|пополн/i.test(t.bankCategory || '');
const stamp = (t) => new Date(t.date + 'T' + (t.time || '12:00') + ':00').getTime();

/** Встречная операция в другом банке: та же сумма с другим знаком, почти в то же время. */
function findCounterpart(t, used = new Set()) {
  if (!transferLike(t)) return null;
  const mt = mentionedBank(t);
  const win = t.time ? 15 * 60000 : 86400000;
  return S.txs.find(o => o.id !== t.id && !used.has(o.id) && o.amount === -t.amount
    && o.bank !== t.bank && o.bank !== 'Вручную' && t.bank !== 'Вручную'
    && (!o.category || o.category === 'own') && !o.ignored && transferLike(o)
    && Math.abs(stamp(o) - stamp(t)) <= (o.time ? win : 86400000)
    && (!mt || mt === o.bank) && (!mentionedBank(o) || mentionedBank(o) === t.bank)) || null;
}

/** Разложить всё, что ещё без категории: новые правила, свои переводы, пары между банками. */
function autoRecheck() {
  const changed = [];
  for (const t of S.txs) {
    if (!needsAnswer(t)) continue;
    const sug = autoCategory(t, S.sortedRules, S.catMap, autoCtx());
    if (!sug) continue;
    if (sug.ignore) { t.ignored = true; t.ruleId = sug.ruleId; }
    else { t.category = sug.category; t.catBy = sug.by; if (sug.ruleId) t.ruleId = sug.ruleId; }
    changed.push(t);
  }
  const used = new Set(S.txs.filter(t => t.pairId).map(t => t.id));
  for (const t of S.txs) {
    if (!needsAnswer(t) || used.has(t.id)) continue;
    const o = findCounterpart(t, used);
    if (!o) continue;
    t.category = 'own'; t.catBy = 'pair'; t.pairId = o.id;
    if (!o.category) { o.category = 'own'; o.catBy = 'pair'; }
    o.pairId = t.id;
    used.add(t.id); used.add(o.id);
    changed.push(t, o);
  }
  return changed;
}

// ---------- общий интерфейс ----------
let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}
function busy(text) { const b = $('#busy'); if (text) { $('#busy-text').textContent = text; b.hidden = false; } else b.hidden = true; }

let sheetDone = null;
function openSheet(html, handlers) {
  sheet.innerHTML = html;
  bind(sheet, handlers || {});
  if (!sheet.open) sheet.showModal();
  sheet.scrollTop = 0;
}
function closeSheet() { if (sheet.open) sheet.close(); }
sheet.addEventListener('close', () => {
  sheet.innerHTML = '';
  if (sheetDone) { const f = sheetDone; sheetDone = null; f(); }
});
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

function setTab(tab) {
  S.tab = tab;
  render();
  window.scrollTo(0, 0);
}
$('#tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) setTab(b.dataset.tab);
});

function render() {
  for (const b of $$('#tabbar [data-tab]')) {
    if (b.dataset.tab === S.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  const n = S.txs.filter(needsAnswer).length;
  const badge = $('#queue-badge');
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.hidden = !n;
  ({ home: renderHome, ops: renderOps, queue: renderQueue, report: renderReport, more: renderMore })[S.tab]();
}

const chipsHtml = (name, items, selected, type = 'radio') => items.map(it => `
  <label class="chip"><input type="${type}" name="${name}" value="${esc(it.id)}" ${(type === 'radio' ? selected === it.id : selected.includes(it.id)) ? 'checked' : ''}><span>${esc(it.name)}</span></label>`).join('');
const fittingCats = (dir) => S.cats.filter(c => c.type === dir).concat(S.cats.filter(c => c.type === 'transfer'));

function amountCls(t) { return t.amount > 0 ? 'amt pos' : 'amt'; }

function txRow(t) {
  const c = t.category ? S.catMap.get(t.category) : null;
  const tags = (t.tags || []).map(id => S.tagMap.get(id)).filter(Boolean);
  return `<button class="tx" type="button" data-act="edit" data-id="${esc(t.id)}">
    <span class="tx-main">
      <span class="tx-title">${esc(prettyDesc(t.desc))}</span>
      <span class="tx-sub">${c ? esc(c.name) : t.ignored ? '' : '<span class="pill warn">без категории</span>'}${t.ignored ? `${c ? ' ' : ''}<span class="pill">не учитывается</span>` : ''}${tags.map(g => ` <span class="pill">${esc(g.name)}</span>`).join('')}${t.reimb === 'done' ? ' <span class="pill ok">возмещено</span>' : ''}${t.bank ? ` · ${esc(t.bank)}` : ''}</span>
      ${t.comment ? `<span class="tx-note">${esc(t.comment)}</span>` : ''}
    </span>
    <span class="${amountCls(t)}${!counted(t) ? ' transfer' : ''}">${money(t.amount)}</span>
  </button>`;
}
function txListByDay(list) {
  const days = new Map();
  for (const t of list) { if (!days.has(t.date)) days.set(t.date, []); days.get(t.date).push(t); }
  return [...days].map(([d, items]) => {
    const spent = items.filter(t => t.amount < 0 && counted(t)).reduce((s, t) => s - t.amount, 0);
    return `<section class="day"><div class="day-h"><span>${esc(dayTitle(d))}</span><span>${spent ? MINUS + rub(spent) : ''}</span></div>
      <div class="list">${items.map(txRow).join('')}</div></section>`;
  }).join('');
}
const sortTx = (a, b) => a.date === b.date ? (b.time || '').localeCompare(a.time || '') || (b.created || '').localeCompare(a.created || '') : b.date.localeCompare(a.date);

// ---------- Обзор ----------
function renderHome() {
  const standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const install = !standalone ? `<section class="note">
      <p><b>Добавьте кошелёк на экран «Домой»</b></p>
      <p class="muted">В Safari нажмите «Поделиться» → «На экран „Домой“». Потом открывайте кошелёк только значком: у значка своё отдельное хранилище, данные из вкладки Safari туда не переходят.</p>
    </section>` : '';
  if (!S.txs.length) {
    screen.innerHTML = `<header class="scr-head"><h1 class="brand">Кошелёк</h1></header>
      ${install}
      <section class="card onboarding">
        <h2>С чего начать</h2>
        <ol class="steps">
          <li><b>Скачайте выписку</b> в приложении банка за нужный период: PDF, Excel или CSV. Сохраните её в «Файлы».</li>
          <li><b>Загрузите выписки</b> кнопкой ниже. Можно несколько файлов сразу, от разных банков.</li>
          <li><b>Ответьте</b>, куда отнести операции, по которым банк не указал категорию. Кошелёк запомнит ответ и в следующий раз не спросит.</li>
        </ol>
        <div class="btn-row">
          <button class="primary" type="button" data-act="upload">Загрузить выписки</button>
          <button class="secondary" type="button" data-act="add">Добавить вручную</button>
        </div>
      </section>
      <p class="muted small">Все данные хранятся только в памяти этого телефона и никуда не отправляются.</p>`;
    bind(screen, homeActions);
    return;
  }
  const latest = S.txs.reduce((m, t) => (t.date > m ? t.date : m), '');
  const m = monthOf(today()) <= monthOf(latest) ? monthOf(today()) : monthOf(latest);
  const rep = buildReport({ txs: S.txs, catMap: S.catMap, tagMap: S.tagMap, from: m + '-01', to: monthEnd(m), includeWork: false });
  const uncat = S.txs.filter(needsAnswer);
  const pend = S.txs.filter(t => t.amount < 0 && isWork(t) && t.reimb !== 'done');
  const pendSum = pend.reduce((s, t) => s - t.amount, 0);
  const top = rep.cats.slice(0, 4);
  const max = top.length ? top[0].sum : 1;
  const lastBackup = S.settings.lastBackup;
  const backupOld = !lastBackup || (Date.now() - new Date(lastBackup).getTime()) > 30 * 86400000;
  screen.innerHTML = `<header class="scr-head"><h1 class="brand">Кошелёк</h1></header>
    ${install}
    <section class="hero">
      <div class="eyebrow">Расходы · ${esc(monthTitle(m))}</div>
      <div class="big">${rub(rep.exp)}</div>
      <div class="split">
        <div><span class="eyebrow">Доходы</span><span class="val pos">+${rub(rep.inc)}</span></div>
        <div><span class="eyebrow">Разница</span><span class="val ${rep.inc - rep.exp < 0 ? 'neg' : ''}">${money(rep.inc - rep.exp)}</span></div>
      </div>
    </section>
    ${uncat.length ? `<button class="alert" type="button" data-act="go" data-tab="queue">
        <span><b>Нужно разобрать: ${uncat.length}</b><span class="muted"> · непонятно, куда отнести</span></span><span aria-hidden="true">›</span></button>` : ''}
    ${top.length ? `<section class="card">
        <div class="card-h"><h2>Куда ушли деньги</h2><button class="link" type="button" data-act="go" data-tab="report">Весь отчёт</button></div>
        <div class="bars">${top.map(c => barRow(c, rep.exp, max)).join('')}</div>
      </section>` : ''}
    ${pend.length ? `<button class="alert soft" type="button" data-act="pending">
        <span><b>Ждут возмещения: ${rub(pendSum)}</b><span class="muted"> · ${pend.length} ${plural(pend.length, 'рабочая трата', 'рабочие траты', 'рабочих трат')}</span></span><span aria-hidden="true">›</span></button>` : ''}
    <div class="btn-row">
      <button class="primary" type="button" data-act="upload">Загрузить выписки</button>
      <button class="secondary" type="button" data-act="add">Добавить вручную</button>
    </div>
    ${S.imports.length ? `<section class="card">
        <h2>Последние загрузки</h2>
        <ul class="plain">${S.imports.slice(0, 3).map(i => `<li><span>${esc(i.bank)}${i.account ? ' ' + esc(i.account) : ''}</span><span class="muted">${dateDots(i.from)}–${dateDots(i.to)} · ${i.count} опер.</span></li>`).join('')}</ul>
      </section>` : ''}
    ${backupOld ? `<section class="note"><p><b>Сохраните резервную копию.</b> ${lastBackup ? 'Последняя была ' + esc(dateRu(lastBackup.slice(0, 10))) + '.' : 'Её ещё ни разу не делали.'} Если телефон потеряется или сбросится, данные можно будет восстановить из копии.</p>
      <div class="btn-row"><button class="secondary" type="button" data-act="backup">Сохранить копию</button></div></section>` : ''}`;
  bind(screen, homeActions);
}
const homeActions = {
  upload: () => $('#file-in').click(),
  add: () => editTx(null),
  go: (el) => setTab(el.dataset.tab),
  pending: () => { S.ops.tag = 'pending'; S.ops.cat = 'all'; S.ops.q = ''; setTab('ops'); },
  backup: () => doBackup(),
};
function plural(n, one, few, many) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
function barRow(c, total, max, act) {
  const share = total ? c.sum / total * 100 : 0;
  const inner = `<span class="bar-name">${esc(c.name)}</span>
    <span class="bar-val">${rub(c.sum)}<small>${share < 1 ? '<1' : Math.round(share)}%</small></span>
    <span class="track"><span class="fill${c.id ? '' : ' none'}" style="width:${Math.max(1.5, c.sum / max * 100)}%"></span></span>`;
  return act ? `<button class="bar-row" type="button" data-act="${act}" data-cat="${esc(c.id)}">${inner}</button>` : `<div class="bar-row">${inner}</div>`;
}

// ---------- Операции ----------
function opsFiltered() {
  const o = S.ops;
  const q = normText(o.q);
  let list;
  if (o.tag === 'pending') list = S.txs.filter(t => t.amount < 0 && isWork(t) && t.reimb !== 'done');
  else if (o.range) list = S.txs.filter(t => t.date >= o.range.from && t.date <= o.range.to);
  else list = S.txs.filter(t => t.date.startsWith(o.month));
  if (o.cat === 'none') list = list.filter(needsAnswer);
  else if (o.cat !== 'all') list = list.filter(t => t.category === o.cat);
  if (o.tag === 'ignored') list = list.filter(t => t.ignored);
  else if (o.tag !== 'all' && o.tag !== 'pending') list = list.filter(t => (t.tags || []).includes(o.tag));
  if (q) {
    const qn = q.replace(',', '.').replace(/\s/g, '');
    list = list.filter(t => normText(t.desc + ' ' + (t.comment || '') + ' ' + catName(t.category)).includes(q) || String(Math.abs(t.amount) / 100).includes(qn));
  }
  return list.sort(sortTx);
}

function renderOps() {
  const o = S.ops;
  const catOpts = [['all', 'Все категории'], ['none', 'Без категории'], ...S.cats.map(c => [c.id, c.name])];
  const tagOpts = [['all', 'Все метки'], ['pending', 'Ждут возмещения'], ['ignored', 'Не учитываются'], ...S.tags.map(t => [t.id, t.name])];
  let period;
  if (o.tag === 'pending') period = `<p class="muted">Рабочие траты за всё время, которые ещё не возместили.</p>`;
  else if (o.range) period = `<div class="range-bar"><span>${dateDots(o.range.from)} – ${dateDots(o.range.to)}</span><button class="link" type="button" data-act="by-month">по месяцам</button></div>`;
  else period = `<nav class="month" aria-label="Месяц">
      <button class="round" type="button" data-act="prev" aria-label="Предыдущий месяц">‹</button>
      <h2>${esc(monthTitle(o.month))}</h2>
      <button class="round" type="button" data-act="next" aria-label="Следующий месяц">›</button>
    </nav>`;
  screen.innerHTML = `<header class="scr-head"><h1>Операции</h1><button class="ghost" type="button" data-act="add">+ Вручную</button></header>
    ${period}
    <div class="filters">
      <input type="search" id="ops-q" placeholder="Поиск: название, сумма, комментарий" value="${esc(o.q)}" data-input="q" autocomplete="off" enterkeyhint="search">
      <div class="filter-row">
        <select id="ops-cat" data-change="cat" aria-label="Категория">${catOpts.map(([v, n]) => `<option value="${esc(v)}" ${o.cat === v ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <select id="ops-tag" data-change="tag" aria-label="Метка">${tagOpts.map(([v, n]) => `<option value="${esc(v)}" ${o.tag === v ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      </div>
    </div>
    <div id="ops-body"></div>`;
  fillOps();
  bind(screen, {
    add: () => editTx(null),
    prev: () => { o.month = addMonths(o.month, -1); renderOps(); },
    next: () => { o.month = addMonths(o.month, 1); renderOps(); },
    'by-month': () => { o.month = monthOf(o.range.to); o.range = null; renderOps(); },
    q: (el) => { o.q = el.value; clearTimeout(renderOps.t); renderOps.t = setTimeout(fillOps, 200); },
    cat: (el) => { o.cat = el.value; renderOps(); },
    tag: (el) => { o.tag = el.value; renderOps(); },
    edit: (el) => editTx(S.byId.get(el.dataset.id)),
    bulk: () => { $('#bulk-a').hidden = true; $('#bulk-b').hidden = false; },
    'bulk-no': () => { $('#bulk-a').hidden = false; $('#bulk-b').hidden = true; },
    'bulk-yes': async () => {
      const list = opsFiltered();
      for (const t of list) t.reimb = 'done';
      await saveTxs(list);
      toast(`Отмечено возмещёнными: ${list.length}`);
      render();
    },
  });
}

/** Список и итоги — без перерисовки поля поиска, чтобы не закрывалась клавиатура. */
function fillOps() {
  const body = $('#ops-body');
  if (!body) return;
  const list = opsFiltered();
  let exp = 0, inc = 0;
  for (const t of list) {
    if (!counted(t)) continue;
    if (t.amount < 0) exp -= t.amount; else inc += t.amount;
  }
  body.innerHTML = `
    <div class="sumline"><span>Расходы <b>${exp ? MINUS : ''}${rub(exp)}</b></span><span>Доходы <b class="pos">+${rub(inc)}</b></span><span class="muted">${list.length} опер.</span></div>
    ${S.ops.tag === 'pending' && list.length ? `<div class="note">
        <div class="btn-row" id="bulk-a"><button class="secondary" type="button" data-act="bulk">Отметить все показанные возмещёнными</button></div>
        <div class="btn-row" id="bulk-b" hidden><span>Отметить ${list.length} на ${rub(exp)}?</span>
          <button class="primary small" type="button" data-act="bulk-yes">Да, отметить</button>
          <button class="secondary small" type="button" data-act="bulk-no">Нет</button></div>
      </div>` : ''}
    ${list.length ? txListByDay(list) : `<div class="empty">${S.txs.length ? 'Ничего не нашлось. Попробуйте другой месяц или фильтр.' : 'Операций пока нет. Загрузите выписку на вкладке «Обзор».'}</div>`}`;
}

// ---------- Карточка операции ----------
function editTx(t) {
  const isNew = !t;
  const dir = t ? dirOf(t) : 'out';
  const tagsSel = t ? [...(t.tags || [])] : [];
  const sameKey = t ? S.txs.filter(o => o.id !== t.id && o.key === t.key && dirOf(o) === dir).length : 0;
  const canRule = t && !isGenericKey(t.key);
  const html = `<form data-submit="save" class="sheet-form" novalidate>
    <div class="sheet-head"><h3>${isNew ? 'Новая операция' : 'Операция'}</h3><button class="ghost" type="button" data-act="close">Закрыть</button></div>
    ${isNew ? `
      <fieldset class="seg"><legend class="vh">Тип</legend>
        <input type="radio" name="dir" id="d-out" value="out" checked data-change="dir"><label for="d-out">Расход</label>
        <input type="radio" name="dir" id="d-in" value="in" data-change="dir"><label for="d-in">Доход</label>
      </fieldset>
      <label class="amount" for="e-amount"><input id="e-amount" inputmode="decimal" placeholder="0" autocomplete="off" aria-label="Сумма в рублях"><span>₽</span></label>
      <label class="field" for="e-desc">Что это<input id="e-desc" maxlength="120" placeholder="Например, такси до офиса" autocomplete="off"></label>
      <label class="field" for="e-date">Дата<input type="date" id="e-date" value="${today()}"></label>
    ` : `
      <div class="tx-head">
        <div class="big ${t.amount > 0 ? 'pos' : ''}">${money(t.amount)}</div>
        <div class="muted">${esc(dateRu(t.date))}${t.time ? ', ' + esc(t.time) : ''} · ${esc(t.bank || 'вручную')}${t.account ? ' ' + esc(t.account) : ''}</div>
        <div class="raw">${esc(t.raw || t.desc || 'Без описания')}</div>
        ${t.bankCategory ? `<div class="muted small">Категория банка: «${esc(t.bankCategory)}»${t.mcc ? ` · MCC ${esc(t.mcc)}` : ''}</div>` : (t.mcc ? `<div class="muted small">MCC ${esc(t.mcc)}</div>` : '')}
      </div>
    `}
    <div class="group"><div class="group-h">Категория</div>
      <fieldset class="chips" id="e-cats" aria-label="Категория">${chipsHtml('cat', fittingCats(dir), t ? t.category : null)}<button class="chip-add" type="button" data-act="newcat">+ категория</button></fieldset>
      ${newCatRowHtml('e')}</div>
    <div class="group"><div class="group-h">Метки</div>
      <fieldset class="chips" id="e-tags" aria-label="Метки">${chipsHtml('tag', S.tags, tagsSel, 'checkbox')}
        <button class="chip-add" type="button" data-act="newtag">+ метка</button></fieldset>
      <div class="add-row" id="newtag-row" hidden><input id="newtag" maxlength="30" placeholder="Название метки" autocomplete="off" aria-label="Название новой метки"><button type="button" class="secondary small" data-act="newtag-ok">Добавить</button></div>
    </div>
    <fieldset class="seg" id="e-reimb" ${t && isWork(t) ? '' : 'hidden'}><legend class="vh">Возмещение</legend>
      <input type="radio" name="reimb" id="r-p" value="pending" ${!t || t.reimb !== 'done' ? 'checked' : ''}><label for="r-p">Ждёт возмещения</label>
      <input type="radio" name="reimb" id="r-d" value="done" ${t && t.reimb === 'done' ? 'checked' : ''}><label for="r-d">Возмещено</label>
    </fieldset>
    <label class="field" for="e-comment">Комментарий<input id="e-comment" maxlength="200" value="${esc(t ? t.comment || '' : '')}" placeholder="Например, поездка к поставщику" autocomplete="off"></label>
    <label class="check ignore-box"><input type="checkbox" id="e-ign" ${t && t.ignored ? 'checked' : ''}><span><b>Не учитывать</b><br><span class="muted small">Операция останется в списке, но не попадёт ни в расходы, ни в доходы, ни в отчёт.</span></span></label>
    ${canRule ? ruleBoxHtml('e', t.key, sameKey > 0 && !t.ignored, sameKey) : ''}
    <p class="err" id="e-err" hidden></p>
    <button class="primary" type="submit">Сохранить</button>
    ${t ? `<div class="del-zone"><button class="text-danger" type="button" data-act="del" id="e-del">Удалить операцию</button>
      <span id="e-delc" hidden>Точно удалить? <button class="danger small" type="button" data-act="del-yes">Да</button> <button class="secondary small" type="button" data-act="del-no">Нет</button></span></div>` : ''}
  </form>`;
  const refreshReimb = () => {
    const sel = $$('input[name="tag"]:checked', sheet).map(i => i.value);
    $('#e-reimb', sheet).hidden = !sel.some(id => S.tagMap.get(id) && S.tagMap.get(id).reimb);
  };
  openSheet(html, {
    close: closeSheet,
    dir: (el) => { $('#e-cats', sheet).innerHTML = chipsHtml('cat', fittingCats(el.value), null) + '<button class="chip-add" type="button" data-act="newcat">+ категория</button>'; },
    newcat: () => showNewCat('e'),
    'newcat-ok': () => addCatInline('e', 'cat', isNew ? ($('input[name="dir"]:checked', sheet) || {}).value || 'out' : dir),
    newtag: () => { $('#newtag-row', sheet).hidden = false; $('#newtag', sheet).focus(); },
    'newtag-ok': async () => {
      const name = $('#newtag', sheet).value.trim();
      if (!name) return;
      let tag = S.tags.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (!tag) { tag = { id: 'g' + uid(), name, reimb: false }; S.tags.push(tag); await saveTags(); }
      const lab = document.createElement('span');
      lab.innerHTML = chipsHtml('tag', [tag], [tag.id], 'checkbox');
      $('.chip-add', sheet).before(lab.firstElementChild);
      $('#newtag', sheet).value = ''; $('#newtag-row', sheet).hidden = true;
    },
    del: () => { $('#e-del', sheet).hidden = true; $('#e-delc', sheet).hidden = false; },
    'del-no': () => { $('#e-del', sheet).hidden = false; $('#e-delc', sheet).hidden = true; },
    'del-yes': async () => {
      await db.delMany('tx', [t.id]);
      S.txs = S.txs.filter(x => x.id !== t.id); reindex();
      closeSheet(); toast('Операция удалена'); render();
    },
    save: async () => {
      const err = (m) => { const e = $('#e-err', sheet); e.textContent = m; e.hidden = false; };
      const catIn = $('input[name="cat"]:checked', sheet);
      const tags = $$('input[name="tag"]:checked', sheet).map(i => i.value);
      const comment = $('#e-comment', sheet).value.trim();
      let target = t;
      if (isNew) {
        const d = $('input[name="dir"]:checked', sheet).value;
        const kop = parseMoney($('#e-amount', sheet).value);
        if (!kop || kop < 0) return err('Введите сумму больше нуля, например 1250 или 99,90.');
        const date = $('#e-date', sheet).value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err('Выберите дату.');
        const desc = $('#e-desc', sheet).value.trim() || (catIn ? catName(catIn.value) : 'Наличные');
        target = { id: 'm' + uid(), bank: 'Вручную', account: '', date, time: '', amount: d === 'out' ? -kop : kop, desc, key: merchantKey(desc), bankCategory: '', mcc: '', manual: true, created: new Date().toISOString() };
      }
      const ignored = $('#e-ign', sheet).checked;
      const catChanged = !isNew && (catIn ? catIn.value : null) !== t.category;
      const ignoreChanged = !isNew && ignored !== !!t.ignored;
      target.category = catIn ? catIn.value : null;
      target.catBy = catIn ? 'manual' : null;
      target.ignored = ignored;
      target.tags = tags;
      target.comment = comment;
      if (isWork(target)) target.reimb = ($('input[name="reimb"]:checked', sheet) || {}).value || 'pending';
      else target.reimb = null;
      const changed = [target];
      const ruleBox = $('#e-rule', sheet);
      if (ruleBox && ruleBox.checked && (target.category || ignored)) {
        const rule = makeRule(target, ignored ? null : target.category, $('#e-scope', sheet).value, ignored);
        S.rules = S.rules.filter(r => !(r.op === rule.op && r.value === rule.value && r.dir === rule.dir));
        S.rules.push(rule); reindex();
        await db.put('rules', rule);
        target.ruleId = rule.id;
        // Человек сам поменял категорию — меняем её и у всех таких же операций, даже разобранных вручную.
        changed.push(...applyRule(rule, target.id, catChanged || ignoreChanged));
      }
      if (isNew) { S.txs.push(target); reindex(); }
      await saveTxs(changed);
      closeSheet();
      toast(changed.length > 1 ? `Сохранено. Правило применено ещё к ${changed.length - 1}` : 'Сохранено');
      render();
    },
  });
  const baseChange = sheet.onchange;
  sheet.onchange = (e) => {
    baseChange(e);
    if (e.target.name === 'tag') refreshReimb();
    // «Не учитывать» обычно про одну операцию: не распространять на всех получателей без явного согласия.
    if (e.target.id === 'e-ign' && e.target.checked && $('#e-rule', sheet)) $('#e-rule', sheet).checked = false;
  };
  if (isNew) setTimeout(() => { const a = $('#e-amount', sheet); if (a) a.focus(); }, 50);
}

const newCatRowHtml = (p) => `<div class="add-row" id="${p}-newcat-row" hidden><input id="${p}-newcat" maxlength="40" placeholder="Название новой категории" autocomplete="off" aria-label="Название новой категории"><button type="button" class="secondary small" data-act="newcat-ok">Добавить</button></div>`;
function showNewCat(p) {
  const root = p === 'q' ? screen : sheet;
  $(`#${p}-newcat-row`, root).hidden = false;
  $(`#${p}-newcat`, root).focus();
}
/** Своя категория прямо из выбора: создаётся, появляется среди вариантов и сразу выбрана. */
async function addCatInline(p, inputName, type) {
  const root = p === 'q' ? screen : sheet;
  const inp = $(`#${p}-newcat`, root);
  const name = inp.value.trim();
  if (!name) return;
  let c = S.cats.find(x => x.name.toLowerCase() === name.toLowerCase() && (x.type === type || x.type === 'transfer'));
  if (!c) {
    c = { id: 'c' + uid(), name, type: type === 'in' ? 'in' : 'out' };
    const lastOfType = S.cats.map(x => x.type).lastIndexOf(c.type);
    S.cats.splice(lastOfType + 1, 0, c);
    await saveCats();
  }
  let input = $(`input[name="${inputName}"][value="${c.id}"]`, root);
  if (!input) {
    const tmp = document.createElement('span');
    tmp.innerHTML = chipsHtml(inputName, [c], c.id);
    $('.chip-add[data-act="newcat"]', root).before(tmp.firstElementChild);
    input = $(`input[name="${inputName}"][value="${c.id}"]`, root);
  }
  input.checked = true;
  inp.value = '';
  $(`#${p}-newcat-row`, root).hidden = true;
  toast(`Категория «${c.name}» добавлена`);
}

/** «Запомнить и больше не спрашивать про [PEREKRESTOK …]» — с выбором, на сколько широко действует правило. */
function ruleBoxHtml(prefix, key, checked, more = 0) {
  const scopes = ruleScopes(key);
  const sug = suggestScope(key);
  return `<div class="rule-box">
    <label class="check"><input type="checkbox" id="${prefix}-rule" ${checked ? 'checked' : ''}><span>Запомнить и больше не спрашивать${more ? ` (ещё ${more} ${plural(more, 'такая операция', 'такие операции', 'таких операций')})` : ''}</span></label>
    ${scopes.length > 1 ? `<label class="field" for="${prefix}-scope">Для каких операций
      <select id="${prefix}-scope">${scopes.map(sc => `<option value="${esc(sc)}" ${sc === sug ? 'selected' : ''}>${esc(sc)}${sc === key ? '' : ' …'}</option>`).join('')}</select></label>
      <p class="muted small">«…» — все, у кого описание начинается так: например, все магазины сети.</p>`
      : `<input type="hidden" id="${prefix}-scope" value="${esc(key)}"><p class="muted small">Для всех операций «${esc(key)}».</p>`}
  </div>`;
}

// ---------- Разобрать ----------
function queueGroups() {
  const groups = new Map();
  for (const t of S.txs) {
    if (!needsAnswer(t)) continue;
    const gkBase = (isGenericKey(t.key) ? 'g:' + normText(prettyDesc(t.desc)).replace(/[\d*•№]+/g, '').replace(/\s+/g, ' ') : t.key) + '|' + dirOf(t);
    const gk = S.queue.split.has(gkBase) ? 'tx:' + t.id : gkBase;
    if (!groups.has(gk)) groups.set(gk, { id: gk, base: gkBase, key: t.key, dir: dirOf(t), items: [] });
    groups.get(gk).items.push(t);
  }
  const list = [...groups.values()];
  for (const g of list) {
    g.items.sort(sortTx);
    g.sum = g.items.reduce((s, t) => s + t.amount, 0);
    g.single = g.id.startsWith('tx:');
  }
  const skipped = S.queue.skipped;
  list.sort((a, b) => (skipped.indexOf(a.id) - skipped.indexOf(b.id)) || (b.items.length - a.items.length) || (Math.abs(b.sum) - Math.abs(a.sum)));
  return list;
}

function renderQueue() {
  const groups = queueGroups();
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  if (!groups.length) {
    screen.innerHTML = `<header class="scr-head"><h1>Разобрать</h1></header>
      <div class="empty big-empty"><p><b>Всё разобрано.</b></p><p class="muted">Здесь появятся операции, по которым банк не указал, что это за трата или поступление. После ответа кошелёк запоминает получателя и больше о нём не спрашивает.</p></div>`;
    bind(screen, {});
    return;
  }
  const g = groups[0];
  const t0 = g.items[0];
  const dates = g.items.map(t => t.date).sort();
  const hintCat = g.items.length === 1 ? findCounterpart(t0) : null;
  const preselect = hintCat ? 'own' : null;
  const generic = isGenericKey(g.key);
  screen.innerHTML = `<header class="scr-head"><h1>Разобрать</h1><span class="muted">осталось ${total}</span></header>
    <article class="card q-card">
      <div class="q-title">${esc(prettyDesc(t0.desc))}</div>
      <div class="q-meta"><b class="${g.sum > 0 ? 'pos' : ''}">${money(g.sum)}</b> · ${g.items.length > 1 ? `${g.items.length} ${plural(g.items.length, 'операция', 'операции', 'операций')} · ${dateDots(dates[0])}–${dateDots(dates[dates.length - 1])}` : esc(dateRu(t0.date))} · ${esc(t0.bank || '')}</div>
      ${t0.bankCategory ? `<div class="muted small">Банк пишет: «${esc(t0.bankCategory)}»</div>` : ''}
      ${hintCat ? `<div class="hint">Похоже на перевод между своими счетами: есть встречная операция ${money(hintCat.amount)} в ${esc(hintCat.bank)} ${dateDots(hintCat.date)}.</div>` : ''}
      ${g.items.length > 1 ? `<ul class="q-ex">${g.items.slice(0, 4).map(t => `<li><span>${dateDots(t.date)}</span><span class="${amountCls(t)}">${money(t.amount)}</span></li>`).join('')}${g.items.length > 4 ? `<li class="muted">и ещё ${g.items.length - 4}</li>` : ''}</ul>` : ''}
      <div class="group"><div class="group-h">${g.dir === 'out' ? 'Что это за трата?' : 'Что это за поступление?'}</div>
        <fieldset class="chips" aria-label="Категория">${chipsHtml('qcat', fittingCats(g.dir), preselect)}<button class="chip-add" type="button" data-act="newcat">+ категория</button></fieldset>
        ${newCatRowHtml('q')}
        <button class="link left" type="button" data-act="cats">Переименовать или удалить категории</button></div>
      <details class="more"><summary>Метка и комментарий</summary>
        <fieldset class="chips" aria-label="Метки">${chipsHtml('qtag', S.tags, [], 'checkbox')}</fieldset>
        <label class="field" for="q-comment">Комментарий${g.items.length > 1 ? ' (ко всем операциям группы)' : ''}<input id="q-comment" maxlength="200" autocomplete="off"></label>
      </details>
      ${!generic ? ruleBoxHtml('q', g.key, true) : `<p class="muted small">В описании нет получателя, поэтому правило не создаётся${g.items.length > 1 ? '. Если операции разные, нажмите «Разобрать по одной»' : ''}.</p>`}
      <p class="err" id="q-err" hidden></p>
      <button class="primary" type="button" data-act="done">Готово</button>
      <button class="secondary" type="button" data-act="ignore">Не учитывать${g.items.length > 1 ? ` (все ${g.items.length})` : ''}</button>
      <div class="btn-row center">
        <button class="link" type="button" data-act="skip">Пропустить</button>
        ${g.items.length > 1 ? `<button class="link" type="button" data-act="split">Разобрать по одной</button>` : ''}
        <button class="link" type="button" data-act="open">Открыть операцию</button>
      </div>
    </article>`;
  bind(screen, {
    skip: () => { S.queue.skipped = S.queue.skipped.filter(x => x !== g.id); S.queue.skipped.push(g.id); renderQueue(); },
    split: () => { S.queue.split.add(g.base); renderQueue(); },
    open: () => editTx(t0),
    newcat: () => showNewCat('q'),
    'newcat-ok': () => addCatInline('q', 'qcat', g.dir),
    cats: () => { S.settings.openFold = 'cats'; setTab('more'); },
    ignore: async () => {
      const comment = $('#q-comment', screen).value.trim();
      const changed = [];
      for (const t of g.items) { t.ignored = true; if (comment) t.comment = comment; changed.push(t); }
      const rb = $('#q-rule', screen);
      let ruleNote = '';
      if (rb && rb.checked) {
        const rule = makeRule(t0, null, $('#q-scope', screen).value, true);
        S.rules = S.rules.filter(r => !(r.op === rule.op && r.value === rule.value && r.dir === rule.dir));
        S.rules.push(rule); reindex();
        await db.put('rules', rule);
        changed.push(...applyRule(rule));
        ruleNote = `. Правило: «${rule.value}» не учитывать`;
      }
      await saveTxs(changed);
      S.queue.skipped = S.queue.skipped.filter(x => x !== g.id);
      toast(`Не учитывается: ${g.items.length}${ruleNote}`);
      render();
    },
    done: async () => {
      const c = $('input[name="qcat"]:checked', screen);
      if (!c) { const e = $('#q-err', screen); e.textContent = 'Выберите категорию.'; e.hidden = false; return; }
      const tags = $$('input[name="qtag"]:checked', screen).map(i => i.value);
      const comment = $('#q-comment', screen).value.trim();
      const changed = [];
      for (const t of g.items) {
        t.category = c.value; t.catBy = 'manual';
        if (tags.length) t.tags = [...new Set([...(t.tags || []), ...tags])];
        if (comment) t.comment = comment;
        updateReimb(t);
        changed.push(t);
      }
      const rb = $('#q-rule', screen);
      if (rb && rb.checked) {
        const rule = makeRule(t0, c.value, $('#q-scope', screen).value);
        S.rules = S.rules.filter(r => !(r.op === rule.op && r.value === rule.value && r.dir === rule.dir));
        S.rules.push(rule); reindex();
        await db.put('rules', rule);
        for (const t of g.items) t.ruleId = rule.id;
        changed.push(...applyRule(rule));
      }
      await saveTxs(changed);
      S.queue.skipped = S.queue.skipped.filter(x => x !== g.id);
      toast(`«${catName(c.value)}»: ${g.items.length} ${plural(g.items.length, 'операция', 'операции', 'операций')}`);
      render();
    },
  });
}

// ---------- Отчёт ----------
function presetRange(p) {
  const m = monthOf(today());
  if (p === 'month') return [m + '-01', monthEnd(m)];
  if (p === 'prev') { const k = addMonths(m, -1); return [k + '-01', monthEnd(k)]; }
  if (p === '3m') return [addMonths(m, -2) + '-01', monthEnd(m)];
  if (p === 'year') return [m.slice(0, 4) + '-01-01', m.slice(0, 4) + '-12-31'];
  return null;
}
function renderReport() {
  const r = S.rep;
  if (!r.from) { [r.from, r.to] = presetRange('month'); }
  const banks = [...new Set(S.txs.map(t => t.bank).filter(Boolean))].sort();
  const rep = buildReport({ txs: S.txs, catMap: S.catMap, tagMap: S.tagMap, from: r.from, to: r.to, includeWork: r.includeWork, bank: r.bank });
  const max = rep.cats.length ? rep.cats[0].sum : 1;
  const mMax = Math.max(1, ...rep.months.map(m => rep.byMonth.get(m) || 0));
  const presets = [['month', 'Этот месяц'], ['prev', 'Прошлый месяц'], ['3m', '3 месяца'], ['year', 'Этот год'], ['custom', 'Свой период']];
  screen.innerHTML = `<header class="scr-head"><h1>Отчёт</h1></header>
    <fieldset class="chips presets" aria-label="Период">${presets.map(([v, n]) => `<label class="chip"><input type="radio" name="preset" value="${v}" ${r.preset === v ? 'checked' : ''} data-change="preset"><span>${n}</span></label>`).join('')}</fieldset>
    <div class="range">
      <label class="field" for="r-from">С<input type="date" id="r-from" value="${r.from}" data-change="range"></label>
      <label class="field" for="r-to">По<input type="date" id="r-to" value="${r.to}" data-change="range"></label>
    </div>
    <div class="filter-row">
      <select id="r-bank" data-change="bank" aria-label="Банк"><option value="">Все банки</option>${banks.map(b => `<option ${r.bank === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
      <label class="check inline"><input type="checkbox" id="r-work" ${r.includeWork ? 'checked' : ''} data-change="work"><span>С рабочими тратами</span></label>
    </div>
    <section class="hero">
      <div class="eyebrow">Расходы за период</div>
      <div class="big">${rub(rep.exp)}</div>
      <div class="split">
        <div><span class="eyebrow">Доходы</span><span class="val pos">+${rub(rep.inc)}</span></div>
        <div><span class="eyebrow">Разница</span><span class="val ${rep.inc - rep.exp < 0 ? 'neg' : ''}">${money(rep.inc - rep.exp)}</span></div>
      </div>
    </section>
    ${rep.uncat ? `<button class="alert" type="button" data-act="queue"><span><b>${rep.uncat} ${plural(rep.uncat, 'операция', 'операции', 'операций')} без категории</b><span class="muted"> на ${rub(rep.uncatSum)} · разобрать</span></span><span aria-hidden="true">›</span></button>` : ''}
    <section class="card">
      <h2>Распределение расходов</h2>
      ${rep.cats.length ? `<div class="bars">${rep.cats.map(c => barRow(c, rep.exp, max, 'cat')).join('')}</div>` : '<p class="muted">За этот период расходов нет.</p>'}
    </section>
    ${rep.months.length > 1 && rep.exp ? `<section class="card">
      <h2>Расходы по месяцам</h2>
      <div class="readout" id="m-read"><b>${esc(monthTitle(rep.months[rep.months.length - 1]))}</b> · ${rub(rep.byMonth.get(rep.months[rep.months.length - 1]) || 0)}</div>
      <div class="cols" style="--n:${rep.months.length}">
        <div class="cols-grid"><span class="gl" style="bottom:100%"><i>${rub(mMax)}</i></span><span class="gl" style="bottom:50%"><i>${rub(mMax / 2)}</i></span></div>
        ${rep.months.map(m => { const v = rep.byMonth.get(m) || 0; return `<button class="col" type="button" data-act="mread" data-m="${m}" aria-label="${esc(monthTitle(m))}: ${rub(v)}"><span class="col-bar"><span style="height:${v ? Math.max(2, v / mMax * 100) : 0}%"></span></span><span class="col-l">${esc(monthShort(m))}</span></button>`; }).join('')}
      </div>
    </section>` : ''}
    ${rep.work.count ? `<section class="card">
      <h2>Рабочие траты</h2>
      <div class="split three">
        <div><span class="eyebrow">Всего</span><span class="val">${rub(rep.work.total)}</span></div>
        <div><span class="eyebrow">Возмещено</span><span class="val pos">${rub(rep.work.done)}</span></div>
        <div><span class="eyebrow">Ждут</span><span class="val">${rub(rep.work.pending)}</span></div>
      </div>
      <p class="muted small">${r.includeWork ? 'Включены в расходы выше.' : 'Не входят в расходы выше. Поступления с категорией «Возмещение рабочих трат» тоже не считаются доходом.'}</p>
    </section>` : ''}
    <div class="btn-row">
      <button class="primary" type="button" data-act="xlsx" ${rep.rows.length ? '' : 'disabled'}>Выгрузить в Excel</button>
      <button class="secondary" type="button" data-act="png" ${rep.cats.length ? '' : 'disabled'}>График картинкой</button>
    </div>
    <p class="muted small">${rep.transfers ? `Переводы между своими счетами (${rep.transfers}) не входят ни в расходы, ни в доходы. ` : ''}${rep.ignored.length ? `Не учитываются по вашей отметке: ${rep.ignored.length} ${plural(rep.ignored.length, 'операция', 'операции', 'операций')}. <button class="link inline" type="button" data-act="ignored">Показать</button>` : ''}</p>`;
  bind(screen, {
    preset: (el) => { r.preset = el.value; const pr = presetRange(el.value); if (pr) [r.from, r.to] = pr; renderReport(); },
    range: () => {
      const f = $('#r-from', screen).value, t = $('#r-to', screen).value;
      if (f && t) { r.from = f <= t ? f : t; r.to = f <= t ? t : f; r.preset = 'custom'; renderReport(); }
    },
    bank: (el) => { r.bank = el.value; renderReport(); },
    work: (el) => { r.includeWork = el.checked; renderReport(); },
    queue: () => setTab('queue'),
    ignored: () => { S.ops.tag = 'ignored'; S.ops.cat = 'all'; S.ops.q = ''; S.ops.range = { from: r.from, to: r.to }; setTab('ops'); },
    cat: (el) => {
      S.ops.cat = el.dataset.cat || 'none'; S.ops.tag = 'all'; S.ops.q = '';
      S.ops.range = { from: r.from, to: r.to };
      setTab('ops');
    },
    mread: (el) => { $('#m-read', screen).innerHTML = `<b>${esc(monthTitle(el.dataset.m))}</b> · ${rub(rep.byMonth.get(el.dataset.m) || 0)}`; },
    xlsx: async () => {
      try { busy('Готовлю Excel…'); await exportXlsx(rep, { catMap: S.catMap, tagMap: S.tagMap }); }
      catch (e) { console.error(e); toast('Не получилось сохранить файл: ' + (e.message || e)); }
      finally { busy(false); }
    },
    png: async () => {
      try { await chartPng(rep); } catch (e) { console.error(e); toast('Не получилось сохранить картинку'); }
    },
  });
  // подсказка по столбцам при наведении мышью
  for (const c of $$('.col', screen)) c.addEventListener('pointerenter', () => c.click());
  import('./importers.js').then(m => m.loadXLSX()).catch(() => {});
}

// ---------- Ещё ----------
function renderMore() {
  const used = new Map();
  for (const t of S.txs) if (t.category) used.set(t.category, (used.get(t.category) || 0) + 1);
  const typeName = { out: 'Расходы', in: 'Доходы', transfer: 'Переводы между своими' };
  const catList = (type) => S.cats.filter(c => c.type === type).map(c => `
    <li><input value="${esc(c.name)}" maxlength="40" data-change="cat-rename" data-id="${esc(c.id)}" aria-label="Название категории «${esc(c.name)}»">
      <button class="x" type="button" data-act="cat-del" data-id="${esc(c.id)}" aria-label="Удалить категорию «${esc(c.name)}»">Удалить</button></li>`).join('');
  const rules = [...S.rules].sort((a, b) => a.value.localeCompare(b.value));
  const fold = (k) => (S.settings.openFold === k ? 'open' : '');
  screen.innerHTML = `<header class="scr-head"><h1>Ещё</h1></header>

    <details class="card fold" ${fold('cats')} data-fold="cats"><summary><h2>Категории</h2><span class="muted">${S.cats.length}</span></summary>
      ${['out', 'in', 'transfer'].map(type => `<div class="group"><div class="group-h">${typeName[type]}</div><ul class="edit-list">${catList(type)}</ul></div>`).join('')}
      <form class="add-row" data-submit="cat-add">
        <input id="nc-name" maxlength="40" placeholder="Новая категория" autocomplete="off" aria-label="Название новой категории">
        <select id="nc-type" aria-label="Тип"><option value="out">расход</option><option value="in">доход</option></select>
        <button class="secondary small" type="submit">Добавить</button>
      </form>
      <div id="cat-del-box"></div>
    </details>

    <details class="card fold" ${fold('tags')} data-fold="tags"><summary><h2>Метки</h2><span class="muted">${S.tags.length}</span></summary>
      <p class="muted small">Метка добавляется к операции поверх категории: «Такси» + «Рабочая». Траты с меткой «к возмещению» учитываются отдельно, и их можно отмечать возмещёнными.</p>
      <ul class="edit-list">${S.tags.map(g => `<li class="tag-li">
        <input value="${esc(g.name)}" maxlength="30" data-change="tag-rename" data-id="${esc(g.id)}" aria-label="Название метки «${esc(g.name)}»">
        <label class="check inline"><input type="checkbox" ${g.reimb ? 'checked' : ''} data-change="tag-reimb" data-id="${esc(g.id)}"><span>к возмещению</span></label>
        <button class="x" type="button" data-act="tag-del" data-id="${esc(g.id)}" aria-label="Удалить метку «${esc(g.name)}»">Удалить</button></li>`).join('')}</ul>
      <form class="add-row" data-submit="tag-add">
        <input id="nt-name" maxlength="30" placeholder="Новая метка" autocomplete="off" aria-label="Название новой метки">
        <button class="secondary small" type="submit">Добавить</button>
      </form>
    </details>

    <details class="card fold" ${fold('rules')} data-fold="rules"><summary><h2>Правила</h2><span class="muted">${S.rules.length}</span></summary>
      <p class="muted small">Правило срабатывает при каждой загрузке выписки: операция с этим получателем сразу попадает в нужную категорию.</p>
      ${rules.length ? `<ul class="rules">${rules.map(r => `<li>
        <span class="rule-text"><b>${esc(r.value)}</b>${r.op === 'contains' ? ' <span class="muted">(содержит)</span>' : ''}<br><span class="muted">${r.dir === 'in' ? 'поступление' : r.dir === 'out' ? 'трата' : 'любая'} → ${r.ignore ? 'не учитывать' : esc(catName(r.category))}</span></span>
        <button class="x" type="button" data-act="rule-del" data-id="${esc(r.id)}" aria-label="Удалить правило «${esc(r.value)}»">Удалить</button></li>`).join('')}</ul>` : '<p class="muted">Правил пока нет. Они появятся, когда вы разберёте первые операции.</p>'}
      <form class="rule-add" data-submit="rule-add">
        <div class="group-h">Своё правило</div>
        <input id="nr-text" maxlength="60" placeholder="Текст из описания, например YANDEX" autocomplete="off" aria-label="Текст в описании">
        <div class="filter-row">
          <select id="nr-dir" aria-label="Направление"><option value="out">трата</option><option value="in">поступление</option><option value="any">любая</option></select>
          <select id="nr-cat" aria-label="Категория">${S.cats.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}<option value="__ignore">— не учитывать —</option></select>
        </div>
        <button class="secondary small" type="submit">Добавить правило</button>
      </form>
    </details>

    <details class="card fold" ${fold('imports')} data-fold="imports"><summary><h2>Загруженные выписки</h2><span class="muted">${S.imports.length}</span></summary>
      ${S.imports.length ? `<ul class="rules">${S.imports.map(i => `<li>
        <span class="rule-text"><b>${esc(i.bank)}${i.account ? ' ' + esc(i.account) : ''}</b> · ${i.count} опер.<br><span class="muted">${dateDots(i.from)}–${dateDots(i.to)} · ${esc(i.fileName)}</span></span>
        <button class="x" type="button" data-act="imp-del" data-id="${esc(i.id)}" aria-label="Удалить выписку ${esc(i.fileName)}">Удалить</button></li>`).join('')}</ul>` : '<p class="muted">Пока ничего не загружено.</p>'}
      <div id="imp-del-box"></div>
    </details>

    <section class="card">
      <h2>Резервная копия</h2>
      <p class="muted small">Файл со всеми операциями, правилами и настройками. Сохраните его в «Файлы» или iCloud. ${S.settings.lastBackup ? 'Последняя копия: ' + esc(dateRu(S.settings.lastBackup.slice(0, 10))) + '.' : 'Копий ещё не было.'}</p>
      <div class="btn-row">
        <button class="primary" type="button" data-act="backup">Сохранить копию</button>
        <button class="secondary" type="button" data-act="restore">Восстановить из копии</button>
      </div>
      <div id="restore-box"></div>
    </section>

    <section class="card">
      <h2>О приложении</h2>
      <p class="muted small">Версия ${APP_VERSION}. Работает без интернета. Операций: ${S.txs.length}, правил: ${S.rules.length}. <span id="persist-st"></span></p>
      <div class="btn-row"><button class="secondary" type="button" data-act="upd-check" id="upd-btn">Проверить обновления</button></div>
      <p class="muted small" id="upd-st"></p>
      <button class="link left" type="button" data-act="reinstall" id="re-a">Переустановить файлы приложения</button>
      <div class="note" id="re-b" hidden>
        <p>Кошелёк заново скачает свои файлы с сайта. Ваши операции, категории и правила останутся на месте. Нужен интернет.</p>
        <div class="btn-row"><button class="primary small" type="button" data-act="reinstall-yes">Переустановить</button><button class="secondary small" type="button" data-act="reinstall-no">Отмена</button></div>
      </div>
    </section>`;
  db.persist().then(ok => { const s = $('#persist-st'); if (s) s.textContent = ok ? 'Хранилище закреплено: телефон не удалит данные сам.' : ''; });
  for (const d of $$('details[data-fold]', screen)) d.addEventListener('toggle', () => { if (d.open) S.settings.openFold = d.dataset.fold; });

  bind(screen, {
    'cat-rename': async (el) => {
      const c = S.catMap.get(el.dataset.id); const v = el.value.trim();
      if (!c) return; if (!v) { el.value = c.name; return; }
      c.name = v; await saveCats(); toast('Категория переименована');
    },
    'cat-del': (el) => {
      const c = S.catMap.get(el.dataset.id); if (!c) return;
      const n = used.get(c.id) || 0;
      const others = S.cats.filter(x => x.id !== c.id && (x.type === c.type || x.type === 'transfer'));
      $('#cat-del-box', screen).innerHTML = `<div class="note">
        <p>Удалить категорию «${esc(c.name)}»?${n ? ` В ней ${n} ${plural(n, 'операция', 'операции', 'операций')}.` : ''}</p>
        ${n ? `<label class="field" for="cd-to">Куда перенести операции<select id="cd-to"><option value="">Никуда, вернуть в «Разобрать»</option>${others.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select></label>` : ''}
        <div class="btn-row"><button class="danger small" type="button" data-act="cat-del-yes" data-id="${esc(c.id)}">Да, удалить</button><button class="secondary small" type="button" data-act="cat-del-no">Нет</button></div></div>`;
    },
    'cat-del-no': () => { $('#cat-del-box', screen).innerHTML = ''; },
    'cat-del-yes': async (el) => {
      const id = el.dataset.id;
      const to = ($('#cd-to', screen) || {}).value || null;
      const ch = [];
      for (const t of S.txs) if (t.category === id) { t.category = to; t.catBy = to ? 'manual' : null; ch.push(t); }
      const deadRules = S.rules.filter(r => r.category === id);
      if (to) for (const r of deadRules) r.category = to;
      S.rules = to ? S.rules : S.rules.filter(r => r.category !== id);
      S.cats = S.cats.filter(c => c.id !== id);
      await saveCats();
      await saveTxs(ch);
      if (to) await db.putMany('rules', deadRules); else await db.delMany('rules', deadRules.map(r => r.id));
      reindex(); toast('Категория удалена'); render();
    },
    'cat-add': async () => {
      const name = $('#nc-name', screen).value.trim(); const type = $('#nc-type', screen).value;
      if (!name) return;
      if (S.cats.some(c => c.name.toLowerCase() === name.toLowerCase() && c.type === type)) { toast('Такая категория уже есть'); return; }
      S.cats.push({ id: 'c' + uid(), name, type }); await saveCats(); S.settings.openFold = 'cats'; render(); toast('Категория добавлена');
    },
    'tag-rename': async (el) => {
      const g = S.tagMap.get(el.dataset.id); const v = el.value.trim();
      if (!g) return; if (!v) { el.value = g.name; return; }
      g.name = v; await saveTags(); toast('Метка переименована');
    },
    'tag-reimb': async (el) => {
      const g = S.tagMap.get(el.dataset.id); if (!g) return;
      g.reimb = el.checked; await saveTags();
      const ch = S.txs.filter(t => (t.tags || []).includes(g.id));
      ch.forEach(updateReimb); await saveTxs(ch);
      toast(g.reimb ? 'Траты с этой меткой ждут возмещения' : 'Метка больше не про возмещение');
    },
    'tag-del': async (el) => {
      const id = el.dataset.id;
      const ch = S.txs.filter(t => (t.tags || []).includes(id));
      for (const t of ch) { t.tags = t.tags.filter(x => x !== id); }
      S.tags = S.tags.filter(g => g.id !== id); await saveTags();
      ch.forEach(updateReimb); await saveTxs(ch);
      S.settings.openFold = 'tags'; render(); toast('Метка удалена');
    },
    'tag-add': async () => {
      const name = $('#nt-name', screen).value.trim(); if (!name) return;
      if (S.tags.some(g => g.name.toLowerCase() === name.toLowerCase())) { toast('Такая метка уже есть'); return; }
      S.tags.push({ id: 'g' + uid(), name, reimb: false }); await saveTags(); S.settings.openFold = 'tags'; render();
    },
    'rule-del': async (el) => {
      S.rules = S.rules.filter(r => r.id !== el.dataset.id); reindex();
      await db.delMany('rules', [el.dataset.id]); S.settings.openFold = 'rules'; render(); toast('Правило удалено. Уже разобранные операции не изменились');
    },
    'rule-add': async () => {
      const text = $('#nr-text', screen).value.trim().toUpperCase().replace(/Ё/g, 'Е');
      if (text.length < 3) { toast('Введите хотя бы 3 буквы'); return; }
      const catVal = $('#nr-cat', screen).value;
      const rule = { id: uid(), op: 'contains', value: text, dir: $('#nr-dir', screen).value, category: catVal === '__ignore' ? null : catVal, ignore: catVal === '__ignore', tags: [], created: today() };
      S.rules.push(rule); reindex(); await db.put('rules', rule);
      const ch = [];
      for (const t of S.txs) {
        if (!needsAnswer(t) || !ruleMatches(rule, t)) continue;
        if (rule.ignore) { t.ignored = true; t.ruleId = rule.id; ch.push(t); }
        else if (categoryFits(S.catMap.get(rule.category), t)) { t.category = rule.category; t.catBy = 'rule'; t.ruleId = rule.id; ch.push(t); }
      }
      await saveTxs(ch);
      S.settings.openFold = 'rules'; render(); toast(ch.length ? `Правило добавлено и сразу разобрало ${ch.length}` : 'Правило добавлено');
    },
    'imp-del': (el) => {
      const i = S.imports.find(x => x.id === el.dataset.id); if (!i) return;
      const n = S.txs.filter(t => t.importId === i.id).length;
      $('#imp-del-box', screen).innerHTML = `<div class="note"><p>Удалить выписку «${esc(i.fileName)}» и ${n} ${plural(n, 'операцию', 'операции', 'операций')} из неё? Правила останутся.</p>
        <div class="btn-row"><button class="danger small" type="button" data-act="imp-del-yes" data-id="${esc(i.id)}">Да, удалить</button><button class="secondary small" type="button" data-act="imp-del-no">Нет</button></div></div>`;
    },
    'imp-del-no': () => { $('#imp-del-box', screen).innerHTML = ''; },
    'imp-del-yes': async (el) => {
      const id = el.dataset.id;
      const ids = S.txs.filter(t => t.importId === id).map(t => t.id);
      await db.delMany('tx', ids); await db.delMany('imports', [id]);
      S.txs = S.txs.filter(t => t.importId !== id); S.imports = S.imports.filter(i => i.id !== id);
      reindex(); S.settings.openFold = 'imports'; render(); toast(`Удалено операций: ${ids.length}`);
    },
    backup: () => doBackup(),
    restore: () => $('#restore-in').click(),
    'upd-check': (el) => checkUpdate(el, $('#upd-st', screen)),
    'upd-apply': () => { if (swReg && swReg.waiting) swReg.waiting.postMessage('skip'); },
    reinstall: () => { $('#re-a', screen).hidden = true; $('#re-b', screen).hidden = false; },
    'reinstall-no': () => { $('#re-a', screen).hidden = false; $('#re-b', screen).hidden = true; },
    'reinstall-yes': async () => {
      // Только файлы программы: данные лежат в отдельном хранилище и не трогаются.
      try {
        for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
        for (const k of await caches.keys()) await caches.delete(k);
      } catch {}
      location.reload();
    },
  });
}

async function doBackup() {
  const data = await db.dumpAll();
  const payload = { app: 'koshelek', version: 1, exportedAt: new Date().toISOString(), data };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const ok = await saveFile(blob, `Кошелёк_копия_${today()}.json`);
  if (ok) { S.settings.lastBackup = new Date().toISOString(); await saveSettings(); toast('Копия сохранена'); render(); }
}

$('#restore-in').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  let payload;
  try { payload = JSON.parse(await f.text()); } catch { toast('Это не файл копии кошелька'); return; }
  if (!payload || payload.app !== 'koshelek' || !payload.data) { toast('Это не файл копии кошелька'); return; }
  const n = (payload.data.tx || []).length;
  openSheet(`<div class="sheet-form">
    <div class="sheet-head"><h3>Восстановить из копии</h3><button class="ghost" type="button" data-act="close">Отмена</button></div>
    <p>Копия от ${esc(dateRu(String(payload.exportedAt).slice(0, 10)))}: ${n} ${plural(n, 'операция', 'операции', 'операций')}.</p>
    <p class="muted">Все текущие данные в кошельке заменятся данными из копии.</p>
    <button class="danger" type="button" data-act="go">Заменить данные</button></div>`, {
    close: closeSheet,
    go: async () => {
      await db.replaceAll(payload.data);
      await load(); closeSheet(); toast('Данные восстановлены'); render();
    },
  });
});

// ---------- загрузка выписок ----------
function fingerprint(list, bank, account) {
  const seen = new Map();
  return list.map(t => {
    const acc = t.account || account || '';
    const base = [bank, acc, t.date, t.time || '', t.amount, normText(t.desc)].join('|');
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return { ...t, account: acc, id: 't' + hash(base + '#' + n) };
  });
}

function reviewImport(res) {
  return new Promise((resolve) => {
    const st = { bank: res.bank || '', account: res.account || '', cols: { ...(res.table ? res.table.cols : {}) }, invert: !!res.invert, txs: res.txs, skipLike: true, showMap: !!res.needsMapping };
    const header = res.table && res.table.headerIndex >= 0 ? res.table.rows[res.table.headerIndex] : null;
    const knownBanks = [...new Set([...BANKS, ...S.imports.map(i => i.bank), ...(st.bank ? [st.bank] : [])])];

    function prepared() {
      let txs = st.txs.map(t => ({ ...t, amount: st.invert ? -t.amount : t.amount }));
      txs = fingerprint(txs, st.bank, st.account);
      const exist = new Set(S.byId.keys());
      // «Похожие» — та же карта, дата и сумма, но другое описание: обычно та же операция из выписки другого вида.
      const like = new Set(S.txs.map(t => `${t.bank}|${t.account || ''}|${t.date}|${t.amount}`));
      const fresh = [], dup = [], similar = [];
      for (const t of txs) {
        if (exist.has(t.id)) dup.push(t);
        else if (like.has(`${st.bank}|${t.account || ''}|${t.date}|${t.amount}`)) similar.push(t);
        else fresh.push(t);
      }
      return { txs, fresh, dup, similar };
    }

    function draw() {
      const p = prepared();
      const toSave = st.skipLike ? p.fresh : p.fresh.concat(p.similar);
      const dates = p.txs.map(t => t.date).sort();
      let auto = 0;
      const ctx = autoCtx();
      if (res.owner) ctx.owners = [...ctx.owners, res.owner];
      if (res.ownNumbers) ctx.ownNumbers = [...ctx.ownNumbers, ...res.ownNumbers];
      for (const t of toSave) if (autoCategory({ ...t, key: merchantKey(t.desc) }, S.sortedRules, S.catMap, ctx)) auto++;
      const exp = p.txs.filter(t => t.amount < 0).reduce((s, t) => s - t.amount, 0);
      const inc = p.txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      // Сверка с итогами, которые банк печатает в выписке.
      let check = '';
      if (res.totals && (res.totals.in != null || res.totals.out != null)) {
        const okIn = res.totals.in == null || res.totals.in === inc;
        const okOut = res.totals.out == null || res.totals.out === exp;
        check = okIn && okOut
          ? `<p class="hint ok">Сверено с итогами выписки: поступления и списания совпадают до копейки.</p>`
          : `<p class="hint bad">Суммы не сходятся с итогами выписки. В выписке: поступления ${rub(res.totals.in || 0)}, списания ${rub(res.totals.out || 0)}. Прочитано: ${rub(inc)} и ${rub(exp)}. Часть операций могла не распознаться — пришлите этот файл Claude, чтобы поправить разбор.</p>`;
      }
      const mapHtml = header ? `<details class="more" ${st.showMap ? 'open' : ''}><summary>Колонки таблицы${res.known ? ' (как в прошлый раз)' : ''}</summary>
          <p class="muted small">Проверьте, что кошелёк правильно понял, где дата, сумма и описание. Настройка запомнится для следующих выписок этого банка.</p>
          ${['date', 'amount', 'debit', 'credit', 'direction', 'desc', 'category', 'mcc'].map(role => `
            <label class="field" for="map-${role}">${ROLE_LABELS[role]}
              <select id="map-${role}" data-change="map" data-role="${role}"><option value="">— нет —</option>
              ${header.map((h, i) => `<option value="${i}" ${st.cols[role] === i ? 'selected' : ''}>${esc(String(h || 'Колонка ' + (i + 1)))}${sampleOf(i)}</option>`).join('')}</select></label>`).join('')}
        </details>` : '';
      sheet.innerHTML = `<div class="sheet-form">
        <div class="sheet-head"><h3>Загрузка выписки</h3><button class="ghost" type="button" data-act="cancel">Отмена</button></div>
        <p class="muted small file">${esc(res.fileName)}</p>
        <div class="filter-row">
          <label class="field" for="imp-bank">Банк
            <select id="imp-bank" data-change="bank"><option value="">Выберите банк</option>${knownBanks.map(b => `<option ${st.bank === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}<option value="__other">Другой…</option></select></label>
          <label class="field" for="imp-acc">Карта или счёт<input id="imp-acc" value="${esc(st.account)}" placeholder="*1234" maxlength="20" data-change="acc" autocomplete="off"></label>
        </div>
        <div class="add-row" id="other-bank" hidden><input id="imp-bank-other" maxlength="30" placeholder="Название банка" aria-label="Название банка"><button class="secondary small" type="button" data-act="bank-ok">ОК</button></div>
        ${res.kind === 'pdf' && res.generic ? `<p class="hint">Для этого банка пока нет отдельного разбора PDF, поэтому кошелёк читает выписку общим способом. Проверьте ниже, что суммы и знаки верные: расходы со знаком «−», поступления с «+».</p>` : ''}
        ${p.txs.length ? `
          <div class="stat-grid">
            <div><span class="eyebrow">Операций</span><b>${p.txs.length}</b></div>
            <div><span class="eyebrow">Период</span><b>${dateDots(dates[0])}–${dateDots(dates[dates.length - 1])}</b></div>
            <div><span class="eyebrow">Расходы</span><b>${MINUS}${rub(exp)}</b></div>
            <div><span class="eyebrow">Поступления</span><b class="pos">+${rub(inc)}</b></div>
          </div>
          ${check}
          <ul class="plain">
            <li><span>Новых</span><b>${p.fresh.length}</b></li>
            ${p.dup.length ? `<li><span>Уже были загружены, пропущу</span><b>${p.dup.length}</b></li>` : ''}
            ${p.similar.length ? `<li><span>Похожи на загруженные раньше (та же дата, сумма и банк)</span><b>${p.similar.length}</b></li>` : ''}
            <li><span>Категория определится сама</span><b>${auto}</b></li>
            <li><span>Спрошу у вас (часть ещё найдётся как переводы между своими счетами)</span><b>${toSave.length - auto}</b></li>
          </ul>
          ${p.similar.length ? `<label class="check"><input type="checkbox" id="imp-like" ${st.skipLike ? 'checked' : ''} data-change="like"><span>Не загружать похожие: скорее всего, это те же операции из другой выписки</span></label>` : ''}
          <label class="check"><input type="checkbox" id="imp-inv" ${st.invert ? 'checked' : ''} data-change="inv"><span>Поменять знак у всех сумм (если расходы показаны как поступления)</span></label>
          <div class="group-h">Первые операции</div>
          <div class="list">${p.txs.slice(0, 6).map(t => `<div class="tx static"><span class="tx-main"><span class="tx-title">${esc(prettyDesc(t.desc))}</span><span class="tx-sub">${dateDots(t.date)}${t.time ? ' ' + esc(t.time) : ''}${t.bankCategory ? ' · ' + esc(t.bankCategory) : ''}</span></span><span class="${amountCls(t)}">${money(t.amount)}</span></div>`).join('')}</div>
          ${p.txs.length > 6 ? `<p class="muted small">и ещё ${p.txs.length - 6}</p>` : ''}
        ` : `<p class="err">Не нашла в файле ни одной операции.${header ? ' Укажите колонки ниже.' : res.kind === 'pdf' ? ' Возможно, это скан (картинка), а не текст, или формат этого банка пока незнаком.' : ' Не нашла строку с заголовками: «Дата», «Сумма», «Описание».'}</p>`}
        ${mapHtml}
        <p class="err" id="imp-err" hidden></p>
        <button class="primary" type="button" data-act="save" ${toSave.length ? '' : 'disabled'}>${toSave.length ? `Загрузить ${toSave.length} ${plural(toSave.length, 'операцию', 'операции', 'операций')}` : 'Нечего загружать'}</button>
      </div>`;
    }
    function sampleOf(i) {
      const rows = res.table.rows;
      for (let r = res.table.headerIndex + 1; r < Math.min(rows.length, res.table.headerIndex + 6); r++) {
        const v = rows[r] && rows[r][i];
        if (v !== '' && v != null) return ' — ' + esc(String(v).slice(0, 24));
      }
      return '';
    }
    function remap() {
      const out = tableToTx(res.table, st.cols, {});
      st.txs = out.txs;
    }

    let saved = false;
    sheetDone = () => resolve(saved);
    draw();
    bind(sheet, {
      cancel: closeSheet,
      bank: (el) => {
        if (el.value === '__other') { $('#other-bank', sheet).hidden = false; $('#imp-bank-other', sheet).focus(); return; }
        st.bank = el.value; draw();
      },
      'bank-ok': () => { const v = $('#imp-bank-other', sheet).value.trim(); if (v) { st.bank = v; knownBanks.push(v); draw(); } },
      acc: (el) => { st.account = el.value.trim(); draw(); },
      like: (el) => { st.skipLike = el.checked; draw(); },
      inv: (el) => { st.invert = el.checked; draw(); },
      map: (el) => { const v = el.value; if (v === '') delete st.cols[el.dataset.role]; else st.cols[el.dataset.role] = Number(v); st.showMap = true; remap(); draw(); },
      save: async () => {
        if (!st.bank) { const e = $('#imp-err', sheet); e.textContent = 'Выберите банк: так операции разных банков не перепутаются.'; e.hidden = false; return; }
        const p = prepared();
        const list = st.skipLike ? p.fresh : p.fresh.concat(p.similar);
        if (res.owner) {
          const owners = S.settings.owners || [];
          if (!owners.some(o => o.first === res.owner.first && o.middle === res.owner.middle)) owners.push(res.owner);
          S.settings.owners = owners;
        }
        if (res.ownNumbers && res.ownNumbers.length) S.settings.ownNumbers = [...new Set([...(S.settings.ownNumbers || []), ...res.ownNumbers])];
        await saveSettings();
        const importId = 'i' + uid();
        const now = new Date().toISOString();
        const txs = list.map(t => {
          const tx = { ...t, bank: st.bank, key: merchantKey(t.desc), importId, created: now, tags: [], comment: '', reimb: null, category: null, catBy: null };
          const sug = autoCategory(tx, S.sortedRules, S.catMap, autoCtx());
          if (sug && sug.ignore) { tx.ignored = true; tx.ruleId = sug.ruleId; }
          else if (sug) { tx.category = sug.category; tx.catBy = sug.by; if (sug.ruleId) tx.ruleId = sug.ruleId; if (sug.tags && sug.tags.length) tx.tags = [...sug.tags]; }
          updateReimb(tx);
          return tx;
        });
        const dates = list.map(t => t.date).sort();
        const imp = { id: importId, fileName: res.fileName, bank: st.bank, account: st.account, from: dates[0], to: dates[dates.length - 1], count: txs.length, at: now };
        await saveTxs(txs);
        await db.put('imports', imp);
        if (res.kind === 'table' && res.table.signature) {
          S.profiles[res.table.signature] = { cols: st.cols, bank: st.bank, invert: st.invert };
          await db.setMeta('profiles', S.profiles);
        }
        S.txs.push(...txs); S.imports.unshift(imp); reindex();
        const more = autoRecheck();
        if (more.length) await saveTxs(more);
        saved = true;
        closeSheet();
        const left = txs.filter(needsAnswer).length;
        toast(`Загружено ${txs.length}. ${left ? `Нужно разобрать: ${left}` : 'Всё разобрано автоматически'}`);
      },
    });
    if (!sheet.open) sheet.showModal();
  });
}

$('#file-in').addEventListener('change', async (e) => {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  let any = false;
  for (const f of files) {
    busy(`Читаю «${f.name}»…`);
    let res;
    try { res = await parseFile(f, S.profiles); }
    catch (err) { console.error(err); busy(false); toast(`Не получилось прочитать «${f.name}»: ${err.message || err}`); continue; }
    busy(false);
    if (await reviewImport(res)) any = true;
  }
  if (any) {
    const left = S.txs.filter(needsAnswer).length;
    setTab(left ? 'queue' : 'home');
  } else render();
});

// ---------- обновления приложения ----------
let swReg = null;
function showUpdate() {
  const b = $('#update');
  b.hidden = false;
  b.onclick = () => { if (swReg && swReg.waiting) swReg.waiting.postMessage('skip'); };
}
function watchInstalling(w) {
  if (!w) return;
  w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(); });
}
/** Кнопка «Проверить обновления»: спросить сайт, дождаться загрузки и предложить обновиться. */
async function checkUpdate(btn, st) {
  if (!swReg) { st.textContent = 'Обновления работают в приложении, открытом с сайта.'; return; }
  btn.disabled = true; btn.textContent = 'Проверяю…'; st.textContent = '';
  try { await swReg.update(); } catch { st.textContent = 'Не получилось связаться с сайтом. Проверьте интернет.'; }
  for (let i = 0; i < 60 && swReg.installing; i++) { st.textContent = 'Загружаю новую версию…'; await new Promise(r => setTimeout(r, 500)); }
  btn.disabled = false;
  if (swReg.waiting) {
    btn.textContent = 'Обновить сейчас'; btn.dataset.act = 'upd-apply';
    st.textContent = 'Новая версия загружена.';
  } else {
    btn.textContent = 'Проверить обновления';
    if (!st.textContent) st.textContent = `У вас последняя версия (${APP_VERSION}).`;
  }
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then(reg => {
    swReg = reg;
    if (reg.waiting) showUpdate();
    watchInstalling(reg.installing);
    reg.addEventListener('updatefound', () => watchInstalling(reg.installing));
  }).catch(() => {});
  // На iPhone приложение со значка часто не перезапускается, а возвращается из фона — проверяем и тогда.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && swReg) swReg.update().catch(() => {});
  });
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

// ---------- запуск ----------
(async () => {
  try {
    await load();
    db.persist();
    render();
  } catch (e) {
    console.error(e);
    screen.innerHTML = `<div class="empty"><p><b>Не получилось открыть хранилище.</b></p><p class="muted">${esc(e.message || e)}. Закройте приложение и откройте снова.</p></div>`;
  }
})();
