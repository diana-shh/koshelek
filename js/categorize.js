// Определение категорий: правила пользователя → свои переводы → смысл описания → категория банка →
// код MCC → известные магазины → спросить.

import { mccCategory, bankCategory, descCategory, knownCategory } from './catalog.js';
import { uid, today, normText } from './util.js';

// Слова, которые сами по себе ничего не говорят о получателе: в ключ не попадают.
const GENERIC = new Set([
  'ПЕРЕВОД', 'ПЕРЕВОДЫ', 'СБП', 'SBP', 'ПО', 'С', 'НА', 'ДЛЯ', 'ОТ', 'В', 'И', 'ИЗ', 'К', 'ЗА', 'ЧЕРЕЗ',
  'КАРТЫ', 'КАРТУ', 'КАРТА', 'КАРТЕ', 'ОПЛАТА', 'ОПЛАТЫ', 'ПОКУПКА', 'ПОКУПКИ', 'ЗАЧИСЛЕНИЕ', 'СПИСАНИЕ',
  'ОПЕРАЦИЯ', 'ОПЕРАЦИИ', 'ПЛАТЕЖ', 'ПЛАТЕЖА', 'ПЛАТЕЖЕЙ', 'ВНУТРИБАНКОВСКИЙ', 'ВНУТРЕННИЙ', 'ВНЕШНИЙ',
  'СЧЕТ', 'СЧЕТА', 'СЧЕТУ', 'ДОГОВОР', 'ДОГОВОРА', 'ПОПОЛНЕНИЕ', 'ВЫПЛАТА', 'ТЕЛ', 'ПРОЧИЕ', 'ПРОЧЕЕ', 'ДРУГОЕ',
  'CARD', 'ВХОДЯЩИЙ', 'ИСХОДЯЩИЙ', 'КЛИЕНТУ', 'КЛИЕНТА', 'БАНКА', 'БАНК', 'БАНКУ', 'BANK', 'БЕЗ', 'ОПИСАНИЯ',
  'НОМЕРУ', 'ТЕЛЕФОНА', 'СИСТЕМА', 'БЫСТРЫХ', 'ПОЛУЧАТЕЛЬ', 'ОТПРАВИТЕЛЬ', 'ТОВАРОВ', 'ТОВАРЫ', 'УСЛУГ', 'УСЛУГИ',
  'ПЛАТФОРМЕ', 'ЗАКАЗ', 'КУПЛЕННЫЕ', 'ВОЗВРАТ', 'ВОЗВРАТА', 'ОТМЕНА', 'QR', 'КОДУ', 'PAY', 'SBERPAY', 'ТСТ',
  'СБЕРБАНКА', 'ВНЕСЕНИЕ', 'НАЛИЧНЫХ', 'БАНКОМАТ', 'БАНКОМАТА', 'СНЯТИЕ', 'ВЫДАЧА', 'СЕБЕ', 'НДС', 'ОБЛАГАЕТСЯ', 'НЕ',
  'ООО', 'OOO', 'ИП', 'IP', 'АО', 'AO', 'ПАО', 'PAO', 'ЗАО', 'ZAO', 'LLC', 'ОАО',
  'RUS', 'RU', 'RUSSIA', 'BLR', 'MOSCOW', 'MOSKVA', 'MOSKOW', 'МОСКВА', 'BALASHIKHA', 'BALASHIHA', 'БАЛАШИХА',
  'SANKT', 'PETERBURG', 'PETERBU', 'PETE', 'SPB', 'KHIMKI', 'ХИМКИ', 'MKR', 'МКР', 'RUSSIA', 'Г', 'G',
]);
const isPlaceWord = (w) => /^ZHELEZNOD/.test(w) || /^ЖЕЛЕЗНОД/.test(w);

/** Ключ получателя: «Оплата в PEREKRESTOK ZHELEZNOD. Balashikha RUS» → «PEREKRESTOK». По нему работают правила.
 *  Одинаковый для разных банков: «IP ORIPOV M. SH.» у Сбера и Т-Банка даёт один ключ «ORIPOV SH». */
export function merchantKey(desc) {
  let s = String(desc || '').toUpperCase().replace(/Ё/g, 'Е');
  const tails = [];
  s = s.replace(/(?:\+7|\b8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b/g, (m) => {
    if (!tails.some(t => t.startsWith('ТЕЛ'))) tails.push('ТЕЛ ' + m.replace(/\D/g, '').slice(-4));
    return ' ';
  });
  s = s.replace(/ДОГОВОР[А-Я]*\s*№?\s*(\d{6,})/g, (m, d) => {
    if (!tails.some(t => t.startsWith('ДОГ'))) tails.push('ДОГ ' + d.slice(-4));
    return ' ';
  });
  s = s.replace(/ОПЕРАЦИЯ ПО (КАРТЕ|СЧЕТУ)[^A-ZА-Я]*/g, ' ')
    .replace(/[*•]+\s?\d+/g, ' ')
    .replace(/\b([A-ZА-Я])-([A-ZА-Я]{3,})/g, '$1$2');   // T-Bank → TBANK
  const words = s.replace(/[^A-ZА-Я]+/g, ' ').trim().split(/\s+/)
    .filter(w => w && w.length > 1 && !GENERIC.has(w) && !isPlaceWord(w));
  const key = words.slice(0, 4).concat(tails).join(' ');
  return key;
}

/** Пустой ключ — в описании нет ничего о получателе («Пополнение. Система быстрых платежей»). */
export function isGenericKey(key) { return !key; }

const AMBIG_FIRST = new Set(['YANDEX', 'ЯНДЕКС', 'SBER', 'СБЕР', 'TBANK', 'ТБАНК', 'ALFA', 'АЛЬФА', 'VTB', 'ВТБ', 'MOSCOW', 'EVO', 'TPP']);
const isPatronymic = (w) => /(ВНА|ВИЧ|ИЧНА|ОГЛЫ|КЫЗЫ)$/.test(w);

/** Варианты охвата правила: «PEREKRESTOK» (вся сеть) … «PEREKRESTOK YUBIL» (один магазин). */
export function ruleScopes(key) {
  const w = key.split(' ').filter(Boolean);
  const out = [];
  for (let i = 1; i <= w.length; i++) out.push(w.slice(0, i).join(' '));
  return out;
}
export function suggestScope(key) {
  const w = key.split(' ').filter(Boolean);
  if (w.length <= 1) return key;
  if (w.some(isPatronymic) || /ТЕЛ|ДОГ/.test(key)) return key;
  if (w[0].length >= 5 && !AMBIG_FIRST.has(w[0])) return w[0];
  return w.slice(0, 2).join(' ');
}

export const dirOf = (tx) => (tx.amount < 0 ? 'out' : 'in');

export function ruleMatches(rule, tx) {
  if (rule.dir !== 'any' && rule.dir !== dirOf(tx)) return false;
  if (rule.op === 'contains') return String(tx.desc || '').toUpperCase().replace(/Ё/g, 'Е').includes(rule.value);
  if (rule.op === 'prefix') return tx.key === rule.value || (tx.key || '').startsWith(rule.value + ' ');
  return tx.key === rule.value;
}

/** Точные правила важнее; среди остальных — более длинные. */
export function sortRules(rules) {
  const rank = { equals: 0, prefix: 1, contains: 2 };
  return [...rules].sort((a, b) => (rank[a.op] - rank[b.op]) || (b.value.length - a.value.length));
}

export function categoryFits(cat, tx) {
  if (!cat) return false;
  if (cat.type === 'transfer') return true;
  return cat.type === dirOf(tx);
}

const TRANSFER_LIKE = /ПЕРЕВОД|ПОПОЛНЕНИЕ|ВНЕСЕНИЕ|ЗАЧИСЛЕНИЕ СРЕДСТВ/;

/** Перевод самой себе: «Перевод себе», своё имя и отчество в описании, номер своего договора или счёта. */
export function isOwnTransfer(tx, ctx = {}) {
  const text = (tx.raw || '') + ' ' + (tx.desc || '');
  const s = normText(text);
  if (/перевод себе|между своими (сч|карт)|перевод между (своими )?счетами|на свой сч|со своего сч/.test(s)) return true;
  if (/перевод|получатель|отправитель|пополнение/.test(s)) {
    for (const o of ctx.owners || []) {
      if (o.first && o.middle && s.includes(normText(o.first + ' ' + o.middle))) return true;
    }
  }
  const nums = text.replace(/(\d)[ ](?=\d)/g, '$1').match(/\d{10,}/g) || [];
  for (const n of nums) for (const own of ctx.ownNumbers || []) if (own === n || (n.length >= 10 && own.endsWith(n))) return true;
  return false;
}

/** Предложение категории для операции или null, если надо спросить. */
export function autoCategory(tx, sortedRules, catMap, ctx = {}) {
  for (const r of sortedRules) {
    if (!ruleMatches(r, tx)) continue;
    if (r.ignore) return { ignore: true, by: 'rule', ruleId: r.id };
    if (catMap.has(r.category) && categoryFits(catMap.get(r.category), tx)) return { category: r.category, by: 'rule', ruleId: r.id, tags: r.tags || [] };
  }
  if (catMap.has('own') && isOwnTransfer(tx, ctx)) return { category: 'own', by: 'own' };
  const text = tx.desc + ' ' + (tx.raw || '');
  const transferLike = TRANSFER_LIKE.test(text.toUpperCase().replace(/Ё/g, 'Е')) || /перевод|пополнени/i.test(tx.bankCategory || '');
  const tries = [
    ['desc', descCategory(text)],
    ['bank', bankCategory(tx.bankCategory)],
    ['mcc', transferLike ? null : mccCategory(tx.mcc)],
    ['known', transferLike ? null : knownCategory(tx.desc)],
  ];
  for (const [by, id0] of tries) {
    let id = id0;
    if (!id) continue;
    let c = catMap.get(id);
    if (c && dirOf(tx) === 'in' && c.type === 'out') { id = 'refund'; c = catMap.get(id); }
    if (c && categoryFits(c, tx)) return { category: id, by };
  }
  return null;
}

/** ignore: true — правило «не учитывать» вместо категории. */
export function makeRule(tx, category, scope, ignore = false) {
  const value = scope || tx.key;
  return { id: uid(), op: value === tx.key ? 'equals' : 'prefix', value, dir: dirOf(tx), category: ignore ? null : category, ignore, tags: [], created: today() };
}

// ---------- переводы между своими счетами: поиск встречной операции ----------
export const BANK_ALIASES = [
  ['Т-Банк', /T-?BANK|Т-?БАНК|TINKOFF|ТИНЬКОФФ/], ['Ozon Банк', /OZON|ОЗОН/], ['Сбербанк', /SBER|СБЕР/],
  ['ВТБ', /(^|[^A-ZА-Я])(VTB|ВТБ)([^A-ZА-Я]|$)/], ['Альфа-Банк', /ALFA|АЛЬФА/], ['Яндекс', /YANDEX|ЯНДЕКС/],
  ['Газпромбанк', /GAZPROM|ГАЗПРОМ/], ['Райффайзен', /RAIFF|РАЙФ/], ['МТС Банк', /MTS ?BANK|МТС ?БАНК/],
];
const up = (s) => String(s || '').toUpperCase().replace(/Ё/g, 'Е');
/** Один и тот же банк под разными названиями: «Яндекс Банк», «Яндекс», «Yandex» → «Яндекс». */
export function bankCanon(name) {
  const u = up(name);
  for (const [b, re] of BANK_ALIASES) if (b.toUpperCase() === u || re.test(u)) return b;
  return name || '';
}
/** Какой чужой банк назван в описании перевода («Перевод в T-Bank»). */
export function mentionedBank(t) {
  const own = bankCanon(t.bank);
  const u = up(t.desc + ' ' + (t.raw || ''));
  for (const [b, re] of BANK_ALIASES) if (b !== own && re.test(u)) return b;
  return null;
}
export const transferLike = (t) => /ПЕРЕВОД|ПОПОЛНЕНИЕ|СБП|ЗАЧИСЛЕНИЕ/.test(up(t.desc + ' ' + (t.raw || ''))) || /перевод|пополн/i.test(t.bankCategory || '');
/** Назван другой человек (по отчеству): «Перевод от М. Кристина Олеговна» — это не свой перевод. */
export function mentionsOtherPerson(t, owners = []) {
  const words = up(t.desc + ' ' + (t.raw || '')).replace(/[^A-ZА-Я]+/g, ' ').split(' ');
  const mine = new Set(owners.map(o => up(o.middle)));
  return words.some(w => w.length > 4 && /(ВНА|ВИЧ|ИЧНА|ОГЛЫ|КЫЗЫ)$/.test(w) && !mine.has(w));
}
const stamp = (t) => new Date(t.date + 'T' + (t.time || '12:00') + ':00').getTime();

/** Похожа ли пара t ↔ o на перевод самой себе.
 *  strict — для автоматической отметки: та же сумма (или с комиссией до 1,5% при разнице до 15 минут), до 15 минут
 *           по времени, а если времени нет — до суток. loose — для подсказки в «Разобрать»: та же сумма, до 3 дней. */
export function isPair(t, o, ctx = {}, loose = false) {
  if (o.id === t.id || o.ignored || t.ignored) return false;
  if ((t.amount < 0) === (o.amount < 0)) return false;
  if (t.bank === 'Вручную' || o.bank === 'Вручную') return false;
  const bt = bankCanon(t.bank), bo = bankCanon(o.bank);
  const sameBank = bt === bo;
  if (sameBank && (!t.account || !o.account || t.account === o.account)) return false;
  if (!transferLike(t) || !transferLike(o)) return false;
  const mt = mentionedBank(t), mo = mentionedBank(o);
  if (mt && mt !== bo) return false;
  if (mo && mo !== bt) return false;
  if (mentionsOtherPerson(t, ctx.owners) || mentionsOtherPerson(o, ctx.owners)) return false;
  const dt = Math.abs(stamp(o) - stamp(t));
  const bothTimes = !!(t.time && o.time);
  const exact = o.amount === -t.amount;
  if (loose) return exact && dt <= 3 * 86400000;
  if (exact) return dt <= (bothTimes ? 15 * 60000 : 86400000);
  // Комиссия за перевод: отправлено немного больше, чем пришло.
  const out = t.amount < 0 ? t : o, inn = t.amount < 0 ? o : t;
  const fee = -out.amount - inn.amount;
  return bothTimes && dt <= 15 * 60000 && fee > 0 && fee <= -out.amount * 0.015;
}

/** Встречная операция среди list (ещё без категории или уже «между своими»), ближайшая по времени. */
export function findCounterpart(t, list, ctx = {}, { used = new Set(), loose = false } = {}) {
  let best = null, bestDt = Infinity;
  for (const o of list) {
    if (used.has(o.id) || (o.category && o.category !== 'own')) continue;
    if (!isPair(t, o, ctx, loose)) continue;
    const d = Math.abs(stamp(o) - stamp(t));
    if (d < bestDt) { best = o; bestDt = d; }
  }
  return best;
}
