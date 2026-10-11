// Общие помощники: деньги, даты, экранирование, идентификаторы.

export const MINUS = '−';
const NF = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const NF2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Сумма в копейках → «1 234,5 ₽» без знака. */
export const rub = (kop) => (Math.abs(kop) % 100 ? NF2 : NF).format(Math.abs(kop) / 100) + '\u00a0₽';
/** Сумма со знаком: «−1 234 ₽» / «+500 ₽». */
export const money = (kop) => (kop < 0 ? MINUS : kop > 0 ? '+' : '') + rub(kop);
export const rub2 = (kop) => NF2.format(kop / 100);

export const MONTH_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WEEKDAY = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => ymd(new Date());
export const monthOf = (ds) => ds.slice(0, 7);
export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export function monthEnd(key) {
  const [y, m] = key.split('-').map(Number);
  return ymd(new Date(y, m, 0));
}
export const monthTitle = (key) => { const [y, m] = key.split('-').map(Number); return `${MONTH_NOM[m - 1]} ${y}`; };
export const monthShort = (key) => { const [y, m] = key.split('-').map(Number); return `${MONTH_SHORT[m - 1]} ${String(y).slice(2)}`; };
export function dateRu(ds) {
  if (!ds) return '';
  const [y, m, d] = ds.split('-').map(Number);
  return `${d} ${MONTH_GEN[m - 1]} ${y}`;
}
export const dateDots = (ds) => { const [y, m, d] = ds.split('-'); return `${d}.${m}.${y}`; };
export function dayTitle(ds) {
  const t = new Date();
  if (ds === ymd(t)) return 'Сегодня';
  t.setDate(t.getDate() - 1);
  if (ds === ymd(t)) return 'Вчера';
  const d = new Date(ds + 'T12:00:00');
  return `${d.getDate()} ${MONTH_GEN[d.getMonth()]}, ${WEEKDAY[d.getDay()]}`;
}
export function monthsBetween(from, to) {
  const out = [];
  let k = monthOf(from);
  const end = monthOf(to);
  while (k <= end && out.length < 240) { out.push(k); k = addMonths(k, 1); }
  return out;
}

/** Разбор суммы из выписки → копейки (целое, со знаком) или null. */
export function parseMoney(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/[−–—]/g, '-')
    .replace(/[\s   ]/g, '')
    .replace(/(RUB|RUR|руб\.?|₽|р\.)/gi, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  else if (s.startsWith('+')) s = s.slice(1);
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
  if (c > -1 && d > -1) s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (c > -1) s = (s.match(/,/g).length > 1) ? s.replace(/,/g, '') : s.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const k = Math.round(parseFloat(s) * 100);
  return neg ? -k : k;
}

/** Разбор даты из выписки → {date:'YYYY-MM-DD', time:'HH:MM'|''} или null. */
export function parseDate(v) {
  if (v instanceof Date && !isNaN(v)) {
    const t = v.getHours() || v.getMinutes() ? `${pad(v.getHours())}:${pad(v.getMinutes())}` : '';
    return { date: ymd(v), time: t };
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    const frac = v % 1;
    return {
      date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
      time: frac ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : ''
    };
  }
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})(?:[\sT,]+(\d{1,2}):(\d{2}))?/);
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    const mo = +m[2], da = +m[1];
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    return { date: `${y}-${pad(mo)}-${pad(da)}`, time: m[4] ? `${pad(+m[4])}:${m[5]}` : '' };
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[\sT](\d{2}):(\d{2}))?/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}` : '' };
  m = s.toLowerCase().match(/^(\d{1,2})\s+([а-яё]+)\.?\s+(\d{4})/);
  if (m) {
    const mi = MONTH_GEN.findIndex(x => x.startsWith(m[2].slice(0, 3)));
    if (mi >= 0) return { date: `${m[3]}-${pad(mi + 1)}-${pad(+m[1])}`, time: '' };
  }
  return null;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function hash(str) {
  let h1 = 0x811c9dc5, h2 = 0x9747b28c;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822507);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const normText = (v) => String(v ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
export const cleanText = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Описание операции для показа: без «Операция по карте ****1234» и длинных номеров. */
export function prettyDesc(desc) {
  const s = cleanText(desc)
    .replace(/Операция по (карте|сч[её]ту)\s*[*•]+\s*\d+\.?/gi, '')
    .replace(/\b\d{9,}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/([A-Za-zА-Яа-яЁё]{3})\.$/, '$1')
    .replace(/[,;\s]+$/, '')
    .trim();
  return s || 'Без описания';
}

/** Сохранить файл: на iPhone откроется меню «Поделиться» (там «Сохранить в Файлы»). */
export async function saveFile(blob, filename) {
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return true;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return false;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}
