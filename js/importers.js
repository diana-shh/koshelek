// Чтение выписок: Excel / CSV / PDF → список операций.

import { parseMoney, parseDate, normText, cleanText } from './util.js';

// ---------- библиотеки (лежат рядом, грузятся по требованию) ----------
let xlsxP = null;
export function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxP) {
    xlsxP = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../vendor/xlsx.full.min.js', import.meta.url).href;
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => { xlsxP = null; reject(new Error('Не загрузился модуль чтения Excel')); };
      document.head.append(s);
    });
  }
  return xlsxP;
}
let pdfP = null;
async function loadPdf() {
  if (!pdfP) {
    pdfP = import('../vendor/pdf.min.mjs').then(m => {
      m.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
      return m;
    }).catch(e => { pdfP = null; throw e; });
  }
  return pdfP;
}

// ---------- банк по тексту или имени файла ----------
export function detectBank(text) {
  const s = normText(text);
  if (/сбербанк|sberbank|сбер банк|пао сбер/.test(s)) return 'Сбербанк';
  if (/тинькофф|т-банк|тбанк|tbank|tinkoff|ао «тбанк»|ао "тбанк"/.test(s)) return 'Т-Банк';
  if (/альфа-банк|альфа банк|alfa-bank|alfabank|альфабанк/.test(s)) return 'Альфа-Банк';
  if (/\bвтб\b|vtb/.test(s)) return 'ВТБ';
  return '';
}

function detectAccount(text) {
  let m = text.match(/[*•]{2,}\s?(\d{4})(?!\d)/);
  if (m) return '*' + m[1];
  m = text.match(/(?:сч[её]т[а-я]*|№)\D{0,12}(\d{20})/i);
  if (m) return '*' + m[1].slice(-4);
  return '';
}

// ---------- таблицы (Excel, CSV) ----------
const COLS = {
  date: [/^дата операции/, /^дата и время операции/, /^дата совершения/, /^дата транзакции/, /^дата$/, /^date/],
  dateAlt: [/^дата проводки/, /^дата платежа/, /^дата списания/, /^дата обработки/, /дата/],
  amount: [/^сумма платежа$/, /^сумма в валюте сч[её]та/, /^сумма операции в валюте сч[её]та/, /^сумма в рублях/, /^сумма операции$/, /^сумма$/, /^сумма, ₽/, /^amount/],
  debit: [/^расход/, /^списание/, /^списано/, /^сумма списания/, /^дебет/, /^debit/],
  credit: [/^приход/, /^поступлени/, /^зачислен/, /^сумма зачисления/, /^кредит$/, /^credit/],
  direction: [/^тип операции/, /^тип$/, /^направление/, /^вид операции/],
  desc: [/^описание/, /^назначение/, /^детали/, /^наименование операции/, /^контрагент/, /^получатель/, /^место/, /^комментарий/, /^description/],
  category: [/^категория/],
  mcc: [/^mcc/],
  status: [/^статус/],
  card: [/^номер карты/, /^карта/, /^номер сч[её]та/, /^сч[её]т$/],
  currency: [/^валюта платежа/, /^валюта сч[её]та/, /^валюта$/],
};
export const ROLE_LABELS = {
  date: 'Дата', amount: 'Сумма (со знаком)', debit: 'Расход', credit: 'Приход',
  direction: 'Тип (расход/приход)', desc: 'Описание', category: 'Категория банка', mcc: 'MCC',
};

export function detectColumns(headerCells) {
  const h = headerCells.map(normText);
  const used = new Set();
  const cols = {};
  const pick = (pats) => {
    for (const p of pats) {
      const i = h.findIndex((x, idx) => x && !used.has(idx) && p.test(x));
      if (i >= 0) return i;
    }
    return -1;
  };
  for (const role of ['date', 'amount', 'debit', 'credit', 'direction', 'desc', 'category', 'mcc', 'status', 'card', 'currency']) {
    const i = pick(COLS[role]);
    if (i >= 0) { cols[role] = i; used.add(i); }
  }
  if (cols.date == null) { const i = pick(COLS.dateAlt); if (i >= 0) { cols.date = i; used.add(i); } }
  return cols;
}

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    const cols = detectColumns(rows[i] || []);
    if (cols.date != null && (cols.amount != null || cols.debit != null || cols.credit != null)) return { index: i, cols };
  }
  return null;
}

export const signatureOf = (headerCells) => headerCells.map(normText).filter(Boolean).join('|');

/** Строки таблицы → операции по выбранным колонкам. */
export function tableToTx(table, cols, opts = {}) {
  const { rows, headerIndex } = table;
  const txs = [];
  let skipped = 0;
  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(c => String(c ?? '').trim() === '')) continue;
    const d = parseDate(row[cols.date]);
    if (!d) { skipped++; continue; }
    if (cols.status != null && /fail|отклон|отмен|declin|не исполн/i.test(String(row[cols.status]))) continue;
    let amount = cols.amount != null ? parseMoney(row[cols.amount]) : null;
    if (!amount && (cols.debit != null || cols.credit != null)) {
      const de = cols.debit != null ? parseMoney(row[cols.debit]) : null;
      const cr = cols.credit != null ? parseMoney(row[cols.credit]) : null;
      if (de) amount = -Math.abs(de);
      else if (cr) amount = Math.abs(cr);
    }
    if (!amount) { skipped++; continue; }
    if (cols.direction != null) {
      const t = normText(row[cols.direction]);
      if (/спис|расход|дебет|покупк|оплат|снят/.test(t)) amount = -Math.abs(amount);
      else if (/зачисл|приход|поступ|пополн|кредит|возврат/.test(t)) amount = Math.abs(amount);
    }
    if (opts.invert) amount = -amount;
    const descParts = [];
    if (cols.desc != null) descParts.push(row[cols.desc]);
    txs.push({
      date: d.date, time: d.time, amount,
      desc: cleanText(descParts.join(' ')),
      bankCategory: cols.category != null ? cleanText(row[cols.category]) : '',
      mcc: cols.mcc != null ? (String(row[cols.mcc] ?? '').match(/\d{4}/) || [''])[0] : '',
      account: cols.card != null ? (String(row[cols.card] ?? '').match(/(\d{4})\s*$/) ? '*' + String(row[cols.card]).match(/(\d{4})\s*$/)[1] : '') : '',
    });
  }
  return { txs, skipped };
}

function decodeText(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch { return new TextDecoder('windows-1251').decode(buf); }
}

function parseCsv(text) {
  const sample = text.split(/\r?\n/).slice(0, 15).join('\n');
  let delim = ';', best = -1;
  for (const d of [';', '\t', ',', '|']) {
    const n = sample.split(d).length;
    if (n > best) { best = n; delim = d; }
  }
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"' && field === '') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function readWorkbookRows(file) {
  const XLSX = await loadXLSX();
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  let best = null;
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    if (!best || rows.length > best.length) best = rows;
  }
  return best || [];
}

function parseTable(rows, fileName, profiles) {
  const head = findHeader(rows);
  const topText = rows.slice(0, 15).map(r => (r || []).join(' ')).join(' ');
  const result = {
    kind: 'table', fileName, txs: [], skipped: 0,
    bank: detectBank(topText) || detectBank(fileName),
    account: detectAccount(topText),
    table: { rows, headerIndex: head ? head.index : -1, cols: head ? head.cols : {}, signature: '' },
  };
  if (!head) {
    // Заголовки не узнали — берём первую «широкую» строку, колонки укажет человек.
    const i = rows.findIndex(r => (r || []).filter(c => String(c ?? '').trim()).length >= 3);
    if (i >= 0) { result.table.headerIndex = i; result.table.signature = signatureOf(rows[i]); }
    const prof = i >= 0 && profiles && profiles[result.table.signature];
    if (!prof) { result.needsMapping = true; return result; }
    return finishTable(result, prof);
  }
  const header = rows[head.index];
  const signature = signatureOf(header);
  result.table.signature = signature;
  const h = header.map(normText);
  if (!result.bank && h.includes('дата платежа') && h.some(x => x.includes('кэшбэк'))) result.bank = 'Т-Банк';
  const prof = profiles && profiles[signature];
  if (prof) return finishTable(result, prof);
  result.table.cols = head.cols;
  const { txs, skipped } = tableToTx(result.table, head.cols, {});
  result.txs = txs; result.skipped = skipped;
  if (!txs.length) result.needsMapping = true;
  return result;
}

/** Таблица этого вида уже встречалась: колонки, банк и знак — как в прошлый раз. */
function finishTable(result, prof) {
  result.bank = prof.bank || result.bank;
  result.invert = !!prof.invert;
  result.known = true;
  result.table.cols = { ...prof.cols };
  const { txs, skipped } = tableToTx(result.table, result.table.cols, {});
  result.txs = txs; result.skipped = skipped;
  if (!txs.length) result.needsMapping = true;
  return result;
}

// ---------- PDF ----------
async function pdfLines(file) {
  const pdfjs = await loadPdf();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items
      .filter(it => it.str && it.str.trim())
      .map(it => ({ x: it.transform[4], y: it.transform[5], w: it.width, s: it.str }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    let cur = null;
    for (const it of items) {
      if (!cur || Math.abs(cur.y - it.y) > 2.5) { cur = { page: p, y: it.y, items: [] }; lines.push(cur); }
      cur.items.push(it);
    }
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    const cells = [];
    for (const it of l.items) {
      const last = cells[cells.length - 1];
      if (last && it.x - (last.x + last.w) < 3) { last.s += (it.x - (last.x + last.w) > 0.8 ? ' ' : '') + it.s; last.w = it.x + it.w - last.x; }
      else cells.push({ x: it.x, w: it.w, s: it.s });
    }
    l.cells = cells.map(c => ({ x: c.x, s: cleanText(c.s) }));
    l.text = l.cells.map(c => c.s).join(' ');
  }
  return lines;
}

const P_DATE = /^(\d{2}\.\d{2}\.(?:\d{4}|\d{2}))(?:[\s,]+(\d{2}:\d{2})(?::\d{2})?)?/;
const P_AMT = /(?:^|[\s(])([+\-−–]?\s?\d{1,3}(?:[   ]\d{3})*[.,]\d{2})(?=$|[\s)₽]|RUB|руб)/g;
const P_JUNK = /^(стр(аница)?\.?\s*\d|\d+\s*(из|\/)\s*\d+$|продолжение|итого|всего|остаток|баланс|дата операции|дата проводки|описание операции|сумма в валюте|выписка|расшифровка|для проверки|подлинность)/i;

/** Общий разбор PDF: строка «дата … сумма» начинает операцию, следующие строки дописывают описание. */
function parseGenericPdf(lines, opts = {}) {
  const raw = [];
  let cur = null;
  for (const l of lines) {
    const t = l.text;
    const dm = t.match(P_DATE);
    const amts = dm ? [...t.slice(dm[0].length).matchAll(P_AMT)].map(m => m[1]) : [];
    if (dm && amts.length) {
      const d = parseDate(dm[1] + (dm[2] ? ' ' + dm[2] : ''));
      if (!d) continue;
      let rest = t.slice(dm[0].length);
      const firstAmt = amts[0];
      const cut = rest.indexOf(firstAmt.trim());
      const descPart = (cut >= 0 ? rest.slice(0, cut) : rest)
        .replace(P_DATE, '').replace(/^\s*\d{2}\.\d{2}\.\d{2,4}/, '').replace(/\b\d{6}\b/, '');
      cur = { date: d.date, time: d.time, amtStr: firstAmt.replace(/\s/g, ''), main: cleanText(descPart), desc: '', more: 0 };
      raw.push(cur);
      continue;
    }
    if (!cur || cur.more >= 3 || P_JUNK.test(t)) continue;
    let extra = t;
    const dm2 = t.match(P_DATE);
    if (dm2) extra = t.slice(dm2[0].length).replace(/^\s*\d{6}\b/, '');
    extra = cleanText(extra);
    if (extra) { cur.desc = cleanText(cur.desc + ' ' + extra); cur.more++; }
  }
  const plus = raw.some(r => r.amtStr.startsWith('+'));
  const minus = raw.some(r => /^[-−–]/.test(r.amtStr));
  return raw.map(r => {
    let a = parseMoney(r.amtStr);
    if (a == null) return null;
    const signed = /^[+\-−–]/.test(r.amtStr);
    if (!signed) a = (minus && !plus) ? Math.abs(a) : -Math.abs(a);
    // У Сбера в первой строке операции — категория банка, описание — во второй.
    const desc = opts.catFromMain ? (r.desc || r.main) : cleanText(r.main + ' ' + r.desc);
    const bankCategory = opts.catFromMain && r.desc ? r.main : '';
    return { date: r.date, time: r.time, amount: a, desc, bankCategory, mcc: '', account: '' };
  }).filter(x => x && x.amount);
}

// Отдельные разборы под конкретные банки добавляются сюда по образцам выписок.
const PDF_PARSERS = {
  'Сбербанк': (lines) => parseGenericPdf(lines, { catFromMain: true }),
};
// Пока разбор Сбера не сверен с настоящей выпиской, показываем предупреждение о проверке.
const VERIFIED = new Set();

async function parsePdf(file) {
  const lines = await pdfLines(file);
  const top = lines.slice(0, 40).map(l => l.text).join(' ');
  const bank = detectBank(top) || detectBank(file.name);
  const parser = PDF_PARSERS[bank] || parseGenericPdf;
  const txs = parser(lines);
  return {
    kind: 'pdf', fileName: file.name, bank, account: detectAccount(top), txs, skipped: 0,
    generic: !VERIFIED.has(bank), lineCount: lines.length,
  };
}

// ---------- точка входа ----------
export async function parseFile(file, profiles) {
  const name = file.name.toLowerCase();
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isPdf = name.endsWith('.pdf') || (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46);
  if (isPdf) return parsePdf(file);
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  const isOle = head[0] === 0xd0 && head[1] === 0xcf;
  if (isZip || isOle || /\.(xlsx|xlsm|xls|ods)$/.test(name)) {
    return parseTable(await readWorkbookRows(file), file.name, profiles);
  }
  const text = decodeText(new Uint8Array(await file.arrayBuffer()));
  if (/^\s*<(html|table|\?xml)/i.test(text)) {
    return parseTable(await readWorkbookRows(file), file.name, profiles);
  }
  return parseTable(parseCsv(text), file.name, profiles);
}
