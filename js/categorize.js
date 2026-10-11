// Определение категорий: правила пользователя → код MCC → категория банка → спросить.

import { mccCategory, bankCategory } from './catalog.js';
import { uid, today } from './util.js';

// Слова, которые сами по себе ничего не говорят о получателе.
const GENERIC = new Set([
  'ПЕРЕВОД', 'ПЕРЕВОДЫ', 'СБП', 'ПО', 'С', 'НА', 'ДЛЯ', 'ОТ', 'В', 'И', 'ИЗ', 'К',
  'КАРТЫ', 'КАРТУ', 'КАРТА', 'КАРТЕ', 'ОПЛАТА', 'ПОКУПКА', 'ЗАЧИСЛЕНИЕ', 'СПИСАНИЕ',
  'ОПЕРАЦИЯ', 'ОПЕРАЦИИ', 'ПЛАТЕЖ', 'ВНУТРИБАНКОВСКИЙ', 'ВНЕШНИЙ', 'СЧЕТ', 'СЧЕТА', 'СЧЕТУ',
  'ПОПОЛНЕНИЕ', 'ВЫПЛАТА', 'ТЕЛ', 'ПРОЧИЕ', 'ПРОЧЕЕ', 'ДРУГОЕ', 'CARD', 'CCARD', 'C', 'P',
  'ВХОДЯЩИЙ', 'ИСХОДЯЩИЙ', 'КЛИЕНТУ', 'КЛИЕНТА', 'БАНКА', 'БАНК', 'БЕЗ', 'ОПИСАНИЯ', 'НОМЕРУ', 'ТЕЛЕФОНА',
]);

/** Ключ получателя: «PYATEROCHKA 1234 Moscow RUS» → «PYATEROCHKA». По нему работают правила. */
export function merchantKey(desc) {
  let s = String(desc || '').toUpperCase().replace(/Ё/g, 'Е');
  let tel = '';
  s = s.replace(/(?:\+7|\b8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b/g, (m) => {
    if (!tel) tel = 'ТЕЛ ' + m.replace(/\D/g, '').slice(-4);
    return ' ';
  });
  s = s.replace(/ОПЕРАЦИЯ ПО (КАРТЕ|СЧЕТУ)[^A-ZА-Я]*/g, ' ')
    .replace(/[*•]+\s?\d+/g, ' ')
    .replace(/\b(RUS|RU|RUSSIA|MOSCOW|MOSKVA|MOSKOW|SANKT[- ]PETERBU?RG|SPB|Г\.? ?МОСКВА|МОСКВА|САНКТ-ПЕТЕРБУРГ)\b/g, ' ');
  const words = s.replace(/[^A-ZА-Я]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  let key = words.slice(0, 5).join(' ');
  if (tel) key = (key ? key + ' ' : '') + tel;
  return key || 'БЕЗ ОПИСАНИЯ';
}

/** «ПЕРЕВОД ПО СБП» — общий ключ: правило по нему поймало бы все переводы подряд. */
export function isGenericKey(key) {
  return key.split(' ').every(w => GENERIC.has(w) || w.length <= 1);
}

export const dirOf = (tx) => (tx.amount < 0 ? 'out' : 'in');

export function ruleMatches(rule, tx) {
  if (rule.dir !== 'any' && rule.dir !== dirOf(tx)) return false;
  if (rule.op === 'contains') return String(tx.desc || '').toUpperCase().replace(/Ё/g, 'Е').includes(rule.value);
  return tx.key === rule.value;
}

/** Правила «равно» важнее правил «содержит»; среди «содержит» — более длинные. */
export function sortRules(rules) {
  return [...rules].sort((a, b) => {
    if (a.op !== b.op) return a.op === 'equals' ? -1 : 1;
    return b.value.length - a.value.length;
  });
}

export function categoryFits(cat, tx) {
  if (!cat) return false;
  if (cat.type === 'transfer') return true;
  return cat.type === dirOf(tx);
}

/** Предложение категории для операции или null, если надо спросить. */
export function autoCategory(tx, sortedRules, catMap) {
  for (const r of sortedRules) {
    if (ruleMatches(r, tx) && catMap.has(r.category)) {
      return { category: r.category, by: 'rule', ruleId: r.id, tags: r.tags || [] };
    }
  }
  const fromBank = bankCategory(tx.bankCategory);
  const fromMcc = mccCategory(tx.mcc);
  let id = fromBank || fromMcc;
  if (!id) return null;
  let c = catMap.get(id);
  if (c && dirOf(tx) === 'in' && c.type === 'out') { id = 'refund'; c = catMap.get(id); }
  if (!c || !categoryFits(c, tx)) return null;
  return { category: id, by: fromBank ? 'bank' : 'mcc' };
}

export function makeRule(tx, category, tags = []) {
  return { id: uid(), op: 'equals', value: tx.key, dir: dirOf(tx), category, tags, created: today() };
}
