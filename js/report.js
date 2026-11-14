// Отчёт за период: суммы по категориям и месяцам, рабочие траты, выгрузка в Excel и картинку.

import { rub, monthsBetween, monthTitle, dateDots, prettyDesc, saveFile } from './util.js';
import { loadXLSX } from './importers.js';

/** «Рабочая · Транспорт» для подкатегории, просто название — для обычной. */
export function catLabel(id, catMap) {
  const c = id ? catMap.get(id) : null;
  if (!c) return 'Без категории';
  const p = c.parent ? catMap.get(c.parent) : null;
  return p ? `${p.name} · ${c.name}` : c.name;
}

/** Рабочая трата: расход в группе «Рабочая» (или со старой меткой «к возмещению»). */
export const isWorkTx = (t, tagMap, catMap) => {
  const c = catMap && t.category ? catMap.get(t.category) : null;
  if (c && c.work && t.amount < 0) return true;
  return (t.tags || []).some(id => tagMap.get(id) && tagMap.get(id).reimb);
};
/** Возмещение: поступление в категории с work (например, «Возмещение рабочих трат»). */
export const isReimbTx = (t, catMap) => {
  const c = t.category ? catMap.get(t.category) : null;
  return !!(c && c.work && t.amount > 0);
};
/** Баланс рабочих трат по списку операций: потрачено, возмещено, осталось вернуть, разбивка по подкатегориям. */
export function workBalance(txs, catMap, tagMap) {
  const out = { spent: 0, back: 0, left: 0, bySub: new Map(), list: [] };
  for (const t of txs) {
    if (t.ignored) continue;
    if (isWorkTx(t, tagMap, catMap)) {
      const v = -t.amount;
      out.spent += v;
      const c = catMap.get(t.category);
      const key = c && c.work ? c.id : 'w_other';
      const name = c && c.work ? c.name : 'Прочее';
      const e = out.bySub.get(key) || { id: key, name, sum: 0, count: 0 };
      e.sum += v; e.count++; out.bySub.set(key, e);
      out.list.push(t);
    } else if (isReimbTx(t, catMap)) {
      out.back += t.amount;
      out.list.push(t);
    }
  }
  out.left = out.spent - out.back;
  out.subs = [...out.bySub.values()].sort((a, b) => b.sum - a.sum);
  out.list.sort((a, b) => a.date === b.date ? (a.time || '').localeCompare(b.time || '') : a.date.localeCompare(b.date));
  return out;
}

export function buildReport({ txs, catMap, tagMap, from, to, includeWork, bank }) {
  const months = monthsBetween(from, to);
  const byCat = new Map();
  const byInCat = new Map();
  const byMonth = new Map(months.map(m => [m, 0]));
  const catMonth = new Map();

  const rows = [];
  let exp = 0, inc = 0, transfers = 0, uncat = 0, uncatSum = 0;
  const ignored = [];

  for (const t of txs) {
    if (t.date < from || t.date > to) continue;
    if (bank && t.bank !== bank) continue;
    if (t.ignored) { ignored.push(t); continue; }
    const c = t.category ? catMap.get(t.category) : null;
    if (c && c.type === 'transfer') { transfers++; continue; }
    const w = isWorkTx(t, tagMap, catMap);
    if (!includeWork && (w || (c && c.work))) continue;
    rows.push(t);
    if (!c) { uncat++; uncatSum += Math.abs(t.amount); }
    const key = c ? c.id : '';
    const name = c ? catLabel(c.id, catMap) : 'Без категории';
    // Поступление в статье расхода (вернули долю за сквош, за ужин) уменьшает эту статью, а не считается доходом.
    const offset = t.amount > 0 && c && c.type === 'out';
    if (t.amount < 0 || offset) {
      const v = -t.amount;
      exp += v;
      const e = byCat.get(key) || { id: key, name, sum: 0, count: 0 };
      e.sum += v; if (!offset) e.count++; byCat.set(key, e);
      const m = t.date.slice(0, 7);
      byMonth.set(m, (byMonth.get(m) || 0) + v);
      const cm = catMonth.get(key) || new Map();
      cm.set(m, (cm.get(m) || 0) + v); catMonth.set(key, cm);
    } else {
      inc += t.amount;
      const e = byInCat.get(key) || { id: key, name, sum: 0, count: 0 };
      e.sum += t.amount; e.count++; byInCat.set(key, e);
    }
  }
  const cats = [...byCat.values()].sort((a, b) => b.sum - a.sum);
  const inCats = [...byInCat.values()].sort((a, b) => b.sum - a.sum);
  rows.sort((a, b) => a.date === b.date ? (a.time || '').localeCompare(b.time || '') : a.date.localeCompare(b.date));
  const work = workBalance(txs.filter(t => t.date >= from && t.date <= to && (!bank || t.bank === bank)), catMap, tagMap);
  ignored.sort((a, b) => a.date.localeCompare(b.date));
  return { from, to, months, exp, inc, cats, inCats, byMonth, catMonth, work, rows, transfers, uncat, uncatSum, includeWork, bank, ignored };
}

// ---------- Excel ----------
function setFormats(ws, XLSX, colFormats) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (const [col, z] of Object.entries(colFormats)) {
      const addr = XLSX.utils.encode_cell({ r, c: Number(col) });
      const cell = ws[addr];
      if (cell && cell.t === 'n') cell.z = z;
    }
  }
}

export async function exportXlsx(rep, { catMap, tagMap }) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  const period = `Период: ${dateDots(rep.from)} – ${dateDots(rep.to)}`;
  const note = rep.includeWork ? 'Рабочие траты включены' : 'Без рабочих трат (к возмещению)';
  const MONEY = '#,##0.00';

  const s1 = [['Расходы по категориям'], [period], [note + (rep.bank ? ` · ${rep.bank}` : '')], [],
    ['Категория', 'Сумма, ₽', 'Доля', 'Операций']];
  for (const c of rep.cats) s1.push([c.name, c.sum / 100, rep.exp ? c.sum / rep.exp : 0, c.count]);
  s1.push(['Итого расходы', rep.exp / 100, rep.exp ? 1 : 0, rep.cats.reduce((s, c) => s + c.count, 0)]);
  s1.push([], ['Доходы по категориям'], ['Категория', 'Сумма, ₽', 'Доля', 'Операций']);
  for (const c of rep.inCats) s1.push([c.name, c.sum / 100, rep.inc ? c.sum / rep.inc : 0, c.count]);
  s1.push(['Итого доходы', rep.inc / 100, rep.inc ? 1 : 0, rep.inCats.reduce((s, c) => s + c.count, 0)]);
  s1.push([], ['Разница (доходы − расходы)', (rep.inc - rep.exp) / 100]);
  const ws1 = XLSX.utils.aoa_to_sheet(s1);
  setFormats(ws1, XLSX, { 1: MONEY, 2: '0.0%' });
  ws1['!cols'] = [{ wch: 32 }, { wch: 16 }, { wch: 9 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'По категориям');

  if (rep.months.length > 1) {
    const head = ['Категория', ...rep.months.map(monthTitle), 'Итого'];
    const s2 = [['Расходы по месяцам'], [period], [], head];
    for (const c of rep.cats) {
      const cm = rep.catMonth.get(c.id) || new Map();
      s2.push([c.name, ...rep.months.map(m => (cm.get(m) || 0) / 100), c.sum / 100]);
    }
    s2.push(['Итого', ...rep.months.map(m => (rep.byMonth.get(m) || 0) / 100), rep.exp / 100]);
    const ws2 = XLSX.utils.aoa_to_sheet(s2);
    const f = {}; for (let i = 1; i <= rep.months.length + 1; i++) f[i] = MONEY;
    setFormats(ws2, XLSX, f);
    ws2['!cols'] = [{ wch: 32 }, ...rep.months.map(() => ({ wch: 14 })), { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'По месяцам');
  }

  const tagNames = (t) => (t.tags || []).map(id => tagMap.get(id) ? tagMap.get(id).name : '').filter(Boolean).join(', ');
  const label = (id) => catLabel(id, catMap);
  const s3 = [['Дата', 'Время', 'Банк', 'Счёт', 'Описание', 'Категория', 'Метки', 'Комментарий', 'Сумма, ₽']];
  for (const t of rep.rows) {
    s3.push([dateDots(t.date), t.time || '', t.bank || '', t.account || '', prettyDesc(t.desc), label(t.category),
      tagNames(t), t.comment || '', t.amount / 100]);
  }
  const ws3 = XLSX.utils.aoa_to_sheet(s3);
  setFormats(ws3, XLSX, { 8: MONEY });
  ws3['!cols'] = [{ wch: 11 }, { wch: 7 }, { wch: 12 }, { wch: 8 }, { wch: 44 }, { wch: 28 }, { wch: 14 }, { wch: 30 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Операции');

  const w = rep.work;
  if (w.list.length) {
    const s4 = [['Рабочие траты — баланс'], [period], [],
      ['Потрачено', w.spent / 100], ['Возмещено', w.back / 100], ['Осталось вернуть', w.left / 100], [],
      ['Подкатегория', 'Сумма, ₽', 'Операций']];
    for (const e of w.subs) s4.push([e.name, e.sum / 100, e.count]);
    s4.push([], ['Дата', 'Время', 'Что', 'Подкатегория', 'Комментарий', 'Сумма, ₽']);
    for (const t of w.list) {
      const c = t.category ? catMap.get(t.category) : null;
      s4.push([dateDots(t.date), t.time || '', prettyDesc(t.desc), c ? (c.parent ? c.name : (t.amount > 0 ? 'Возмещение' : c.name)) : 'Прочее', t.comment || '', t.amount / 100]);
    }
    const ws4 = XLSX.utils.aoa_to_sheet(s4);
    setFormats(ws4, XLSX, { 1: MONEY, 5: MONEY });
    ws4['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 44 }, { wch: 22 }, { wch: 30 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws4, 'Рабочие траты');
  }

  const sal = rep.salary;
  if (sal) {
    const s6 = [['Зарплата — долг компании'], [period], [],
      ['Начислено за период', sal.pAccrued / 100], ['Получено за период', sal.pReceived / 100],
      [sal.debt >= 0 ? `Долг компании на ${dateDots(sal.asOf)}` : `Получено вперёд на ${dateDots(sal.asOf)}`, Math.abs(sal.debt) / 100],
      ['Учёт ведётся с', dateDots(sal.cfg.start)], [],
      ['Срок выплаты', 'За работу', 'Положено, ₽', 'Пришло, ₽', 'Закрыта', 'Задержка, дн.', 'Комментарий']];
    for (const it of sal.pItems) {
      s6.push([dateDots(it.due), `${dateDots(it.from)} – ${dateDots(it.to)}`, it.amount / 100, it.paid / 100,
        it.closedOn ? dateDots(it.closedOn) : 'не закрыта', it.closedOn ? it.delay : it.overdue, it.note || '']);
    }
    s6.push([], ['Поступления зарплаты'], ['Дата', 'Время', 'Сумма, ₽', 'Банк', 'Описание', 'Комментарий']);
    for (const t of sal.pReceipts) s6.push([dateDots(t.date), t.time || '', t.amount / 100, t.bank || '', prettyDesc(t.desc), t.comment || '']);
    const ws6 = XLSX.utils.aoa_to_sheet(s6);
    setFormats(ws6, XLSX, { 1: MONEY, 2: MONEY, 3: MONEY });
    ws6['!cols'] = [{ wch: 30 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 40 }, { wch: 14 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, ws6, 'Зарплата');
  }

  if (rep.ignored.length) {
    const s5 = [['Не учитываются'], [period], ['Эти операции отмечены «не учитывать» и не входят в суммы выше.'], [],
      ['Дата', 'Время', 'Банк', 'Описание', 'Категория', 'Комментарий', 'Сумма, ₽']];
    for (const t of rep.ignored) {
      const c = t.category ? catMap.get(t.category) : null;
      s5.push([dateDots(t.date), t.time || '', t.bank || '', prettyDesc(t.desc), c ? catLabel(t.category, catMap) : '', t.comment || '', t.amount / 100]);
    }
    const ws5 = XLSX.utils.aoa_to_sheet(s5);
    setFormats(ws5, XLSX, { 6: MONEY });
    ws5['!cols'] = [{ wch: 11 }, { wch: 7 }, { wch: 12 }, { wch: 44 }, { wch: 24 }, { wch: 30 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws5, 'Не учитываются');
  }

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return saveFile(blob, `Кошелёк_${rep.from}_${rep.to}.xlsx`);
}

// ---------- картинка графика ----------
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function chartPng(rep) {
  const top = rep.cats.slice(0, 14);
  const restSum = rep.cats.slice(14).reduce((s, c) => s + c.sum, 0);
  if (restSum) top.push({ name: 'Остальные категории', sum: restSum });
  const W = 1080, pad = 64, rowH = 92, headH = 230, footH = 60;
  const H = headH + Math.max(1, top.length) * rowH + footH;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const font = '-apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif';
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#15202B'; ctx.font = `700 52px ${font}`; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Расходы по категориям', pad, 104);
  ctx.fillStyle = '#5D6A77'; ctx.font = `400 32px ${font}`;
  ctx.fillText(`${dateDots(rep.from)} – ${dateDots(rep.to)} · всего ${rub(rep.exp)}`, pad, 156);
  if (!rep.includeWork) ctx.fillText('без рабочих трат', pad, 196);
  const max = top.length ? top[0].sum : 1;
  top.forEach((c, i) => {
    const y = headH + i * rowH;
    const share = rep.exp ? Math.round(c.sum / rep.exp * 100) : 0;
    ctx.fillStyle = '#15202B'; ctx.font = `500 32px ${font}`; ctx.textAlign = 'left';
    let name = c.name; while (ctx.measureText(name).width > 600 && name.length > 4) name = name.slice(0, -2) + '…';
    ctx.fillText(name, pad, y + 36);
    ctx.textAlign = 'right'; ctx.font = `600 32px ${font}`;
    ctx.fillText(rub(c.sum), W - pad - 96, y + 36);
    ctx.fillStyle = '#5D6A77'; ctx.font = `400 30px ${font}`;
    ctx.fillText((share < 1 ? '<1' : share) + '%', W - pad, y + 36);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#E7ECF0'; roundRect(ctx, pad, y + 54, W - 2 * pad, 14, 7); ctx.fill();
    ctx.fillStyle = '#15202B'; roundRect(ctx, pad, y + 54, Math.max(14, (W - 2 * pad) * c.sum / max), 14, 7); ctx.fill();
  });
  ctx.fillStyle = '#5D6A77'; ctx.font = `400 26px ${font}`;
  ctx.fillText('Кошелёк', pad, H - 24);
  const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
  return saveFile(blob, `Расходы_${rep.from}_${rep.to}.png`);
}
