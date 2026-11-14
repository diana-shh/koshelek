// Зарплата: начисления по графику (две выплаты в месяц) и долг компании.
//
// Выплата в день выплаты X платит за период, который закончился в предыдущий день выплаты.
// При днях 10 и 25: 10-го — за 11–25 число прошлого месяца, 25-го — за 26-е прошлого месяца – 10-е текущего.
// Каждая выплата — половина месячного оклада (если оклад менялся внутри периода — пропорционально дням).
// Поступления — операции в категории «Зарплата» в любом банке; частями и с опозданием — не важно:
// деньги закрывают выплаты по очереди, начиная с самой старой.

import { ymd } from './util.js';

const D = (s) => new Date(s + 'T12:00:00');
export const addDays = (s, n) => { const d = D(s); d.setDate(d.getDate() + n); return ymd(d); };
export const daysBetween = (a, b) => Math.round((D(b) - D(a)) / 86400000);
const cutDate = (y, m0, day) => ymd(new Date(y, m0, Math.min(day, new Date(y, m0 + 1, 0).getDate()), 12));

/** Настройки зарплаты из общих настроек приложения, с безопасными значениями по умолчанию. */
export function salaryCfg(settings) {
  const s = (settings && settings.salary) || {};
  const days = Array.isArray(s.days) && s.days.length === 2 && s.days[0] !== s.days[1]
    ? [...s.days].map(Number).sort((a, b) => a - b) : [10, 25];
  return {
    on: !!s.on,
    start: s.start || '',
    opening: Number(s.opening) || 0,
    days,
    rates: (s.rates || []).filter(r => r && r.from && r.amount > 0).sort((a, b) => a.from.localeCompare(b.from)),
    adj: s.adj || {},
  };
}

/** Оклад в месяц на дату. До первой записи действует первая. */
export function rateOn(cfg, date) {
  if (!cfg.rates.length) return 0;
  let r = cfg.rates[0].amount;
  for (const x of cfg.rates) if (x.from <= date) r = x.amount;
  return r;
}

/** Начисление за период: половина оклада, при смене оклада внутри периода — по дням. */
function accrue(cfg, from, to) {
  let sum = 0, n = 0;
  for (let d = from; d <= to && n < 62; d = addDays(d, 1)) { sum += rateOn(cfg, d) / 2; n++; }
  return n ? Math.round(sum / n) : 0;
}

/** Все выплаты по графику с начала учёта до даты upTo (включительно). */
export function payoutList(cfg, upTo) {
  if (!cfg.start || !cfg.rates.length) return [];
  const cuts = [];
  const [sy, sm] = cfg.start.split('-').map(Number);
  const [ey, em] = upTo.split('-').map(Number);
  for (let y = sy, m = sm - 1 - 2; ; m++) {
    const d0 = new Date(y, m, 1);
    const yy = d0.getFullYear(), mm = d0.getMonth();
    if (yy > ey || (yy === ey && mm > em - 1) || cuts.length > 2400) break;
    for (const day of cfg.days) cuts.push(cutDate(yy, mm, day));
  }
  const out = [];
  for (let i = 2; i < cuts.length; i++) {
    const due = cuts[i];
    if (due < cfg.start || due > upTo) continue;
    const from = addDays(cuts[i - 2], 1), to = cuts[i - 1];
    const base = accrue(cfg, from, to);
    const a = cfg.adj[due];
    out.push({ due, from, to, base, amount: a ? a.amount : base, note: a ? a.note || '' : '', adjusted: !!a });
  }
  return out;
}

export const isSalaryTx = (t) => !t.ignored && t.category === 'salary' && t.amount > 0;

const chrono = (a, b) => a.date === b.date ? (a.time || '').localeCompare(b.time || '') : a.date.localeCompare(b.date);

/**
 * Состояние зарплаты на дату asOf: начислено, получено, долг, статус каждой выплаты.
 * Поступления распределяются по выплатам по очереди (сначала долг на начало, потом самая старая выплата).
 */
export function salaryState(cfg, txs, asOf) {
  const all = payoutList(cfg, addDays(asOf, 70));
  const due = all.filter(p => p.due <= asOf).map(p => ({ ...p }));
  const future = all.filter(p => p.due > asOf).map(p => ({ ...p }));
  const receipts = txs.filter(t => isSalaryTx(t) && t.date >= cfg.start && t.date <= asOf).sort(chrono);
  const received = receipts.reduce((s, t) => s + t.amount, 0);
  const accrued = due.reduce((s, p) => s + p.amount, 0);
  const debt = cfg.opening + accrued - received;

  const items = [];
  if (cfg.opening > 0) items.push({ opening: true, due: cfg.start, amount: cfg.opening });
  items.push(...due);
  let ri = 0;
  let avail = cfg.opening < 0 ? -cfg.opening : 0;
  let lastDate = cfg.start;
  const fill = (it) => {
    let need = it.amount;
    it.paid = 0; it.closedOn = null;
    while (need > 0) {
      if (avail <= 0) {
        if (ri >= receipts.length) break;
        avail = receipts[ri].amount; lastDate = receipts[ri].date; ri++;
        continue;
      }
      const take = Math.min(need, avail);
      need -= take; avail -= take; it.paid += take;
    }
    if (need <= 0) it.closedOn = it.amount > 0 ? lastDate : it.due;
  };
  for (const it of items) {
    fill(it);
    if (it.closedOn) { it.status = 'paid'; it.delay = Math.max(0, daysBetween(it.due, it.closedOn)); it.early = daysBetween(it.closedOn, it.due) > 0; }
    else { it.status = it.paid > 0 ? 'partial' : 'unpaid'; it.overdue = daysBetween(it.due, asOf); }
  }
  // Что пришло сверх долга — аванс в счёт следующих выплат.
  for (const it of future) { fill(it); it.status = it.closedOn ? 'prepaid' : it.paid > 0 ? 'partprepaid' : 'future'; }
  const open = items.filter(it => it.status !== 'paid');
  return {
    asOf, cfg, accrued, received, debt, opening: cfg.opening,
    items, receipts, next: future[0] || null, future,
    oldestUnpaid: open.length ? open[0] : null,
  };
}

/** Итоги за период [from, to] и долг на его конец. */
export function salaryPeriod(cfg, txs, from, to) {
  const st = salaryState(cfg, txs, to);
  const inP = (d) => d >= from && d <= to;
  const items = st.items.filter(it => !it.opening && inP(it.due));
  const receipts = st.receipts.filter(t => inP(t.date));
  return {
    ...st,
    pAccrued: items.reduce((s, it) => s + it.amount, 0),
    pReceived: receipts.reduce((s, t) => s + t.amount, 0),
    pItems: items, pReceipts: receipts,
  };
}

/** «10.08» */
export const dm = (ds) => `${ds.slice(8, 10)}.${ds.slice(5, 7)}`;
/** Пояснение графика для экрана настроек (дни выплат — от 1 до 28). */
export function scheduleText(days) {
  const [a, b] = days;
  return `${a}-го — половина за ${a + 1}–${b} число прошлого месяца; ${b}-го — половина за ${b + 1}-е прошлого месяца – ${a}-е текущего.`;
}
