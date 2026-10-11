// Справочники по умолчанию: категории, метки, коды MCC и названия категорий банков.

/** type: out — расход, in — доход, transfer — перевод между своими (не считается ни расходом, ни доходом).
 *  work: true — доход-возмещение рабочих трат (учитывается вместе с рабочими тратами). */
export const DEFAULT_CATEGORIES = [
  { id: 'food', name: 'Продукты', type: 'out' },
  { id: 'cafe', name: 'Кафе и рестораны', type: 'out' },
  { id: 'market', name: 'Маркетплейсы', type: 'out' },
  { id: 'transport', name: 'Общественный транспорт', type: 'out' },
  { id: 'taxi', name: 'Такси', type: 'out' },
  { id: 'auto', name: 'Авто и бензин', type: 'out' },
  { id: 'home', name: 'Дом и ЖКХ', type: 'out' },
  { id: 'connect', name: 'Связь и интернет', type: 'out' },
  { id: 'health', name: 'Здоровье и аптеки', type: 'out' },
  { id: 'beauty', name: 'Красота', type: 'out' },
  { id: 'clothes', name: 'Одежда и обувь', type: 'out' },
  { id: 'fun', name: 'Спорт, развлечения, хобби', type: 'out' },
  { id: 'subs', name: 'Подписки', type: 'out' },
  { id: 'travel', name: 'Путешествия', type: 'out' },
  { id: 'edu', name: 'Образование', type: 'out' },
  { id: 'gifts', name: 'Подарки и цветы', type: 'out' },
  { id: 'p2p_out', name: 'Переводы людям', type: 'out' },
  { id: 'cash', name: 'Снятие наличных', type: 'out' },
  { id: 'loans', name: 'Кредиты и рассрочки', type: 'out' },
  { id: 'gov', name: 'Налоги, штрафы, госуслуги', type: 'out' },
  { id: 'fees', name: 'Комиссии и проценты', type: 'out' },
  { id: 'other', name: 'Прочие расходы', type: 'out' },
  { id: 'salary', name: 'Зарплата', type: 'in' },
  { id: 'side', name: 'Подработка', type: 'in' },
  { id: 'cashback', name: 'Кэшбэк и проценты', type: 'in' },
  { id: 'refund', name: 'Возвраты покупок', type: 'in' },
  { id: 'p2p_in', name: 'Переводы от людей', type: 'in' },
  { id: 'reimb', name: 'Возмещение рабочих трат', type: 'in', work: true },
  { id: 'other_in', name: 'Прочие доходы', type: 'in' },
  { id: 'own', name: 'Между своими счетами', type: 'transfer' },
];

/** reimb: true — траты с этой меткой ждут возмещения. */
export const DEFAULT_TAGS = [
  { id: 'work', name: 'Рабочая', reimb: true },
];

export const BANKS = ['Сбербанк', 'Т-Банк', 'Ozon Банк', 'Альфа-Банк', 'ВТБ'];

// Коды MCC (вид торговой точки) → категория.
const MCC_LIST = [
  ['food', [5411, 5422, 5441, 5451, 5462, 5499, 5297, 5298]],
  ['cafe', [5811, 5812, 5813, 5814]],
  ['taxi', [4121]],
  ['transport', [4111, 4112, 4131, 4011, 4789]],
  ['auto', [5541, 5542, 5983, 5531, 5532, 5533, 7523, 7531, 7534, 7535, 7538, 7542, 7549, 7512, 7513, 5511, 5521]],
  ['connect', [4812, 4814, 4816, 4899]],
  ['health', [5912, 5122, 5047, 8011, 8021, 8031, 8041, 8042, 8043, 8049, 8050, 8062, 8071, 8099]],
  ['beauty', [7230, 7297, 7298, 5977]],
  ['clothes', [5611, 5621, 5631, 5641, 5651, 5655, 5661, 5681, 5691, 5697, 5698, 5699, 5137, 5139, 5948]],
  ['fun', [7832, 7841, 7911, 7922, 7929, 7932, 7933, 7941, 7991, 7996, 7997, 7998, 7999, 5945, 5733, 5735, 5942, 5815, 5816]],
  ['subs', [5817, 5818, 5968]],
  ['travel', [4411, 4511, 4722, 7011, 7012, 7032, 7033]],
  ['edu', [8211, 8220, 8241, 8244, 8249, 8299, 8351, 5943]],
  ['cash', [6010, 6011]],
  ['home', [4900, 5200, 5211, 5231, 5251, 5261, 5712, 5713, 5714, 5718, 5719, 5722, 5039, 1520, 1711, 1731, 1750, 7349]],
  ['gifts', [5992, 5193, 5947]],
];
const MCC = new Map();
for (const [cat, codes] of MCC_LIST) for (const c of codes) MCC.set(c, cat);

export function mccCategory(mcc) {
  const n = parseInt(mcc, 10);
  if (!n) return null;
  if (MCC.has(n)) return MCC.get(n);
  if (n >= 3000 && n <= 3350) return 'travel';  // авиакомпании
  if (n >= 3351 && n <= 3500) return 'auto';    // прокат машин
  if (n >= 3501 && n <= 3999) return 'travel';  // гостиницы
  return null;
}

// Названия категорий, которые банки пишут в выписках → наша категория.
// Размытые («Переводы», «Прочие операции», «Пополнения») не сопоставляются — по ним приложение спросит.
const BANK_CAT = [
  [/супермаркет|продукт|гипермаркет/, 'food'],
  [/ресторан|кафе|фастфуд|фаст-фуд|кофейн|бары/, 'cafe'],
  [/маркетплейс/, 'market'],
  [/такси/, 'taxi'],
  [/^транспорт|метро|ж\/д|железнодорож|автобус/, 'transport'],
  [/топливо|азс|бензин|автоуслуг|автомобил|парковк|каршеринг/, 'auto'],
  [/^жкх$|квартплат|дом и ремонт|ремонт|мебел|хозтовар|товары для дома|все для дома/, 'home'],
  [/^связь|мобильн|^интернет|телеком/, 'connect'],
  [/аптек|медицин|здоровье|клиник|стоматолог/, 'health'],
  [/красота|салон|косметик|парфюм/, 'beauty'],
  [/одежда|обувь|аксессуар/, 'clothes'],
  [/развлечен|отдых|кино|театр|музе|хобби|спорт|книг/, 'fun'],
  [/подписк|цифровые товары/, 'subs'],
  [/путешеств|отел|гостиниц|авиа|туризм|турагент/, 'travel'],
  [/образован|обучен|курсы/, 'edu'],
  [/цвет|подарк|сувенир/, 'gifts'],
  [/выдача наличных|снятие наличн|наличные в банкомат/, 'cash'],
  [/налог|штраф|госуслуг|государств/, 'gov'],
  [/комисси|проценты по кредит|обслуживание/, 'fees'],
  [/кэшбэк|кешбэк|кешбек|бонус|начисление процентов|проценты на остаток|проценты по вклад/, 'cashback'],
  [/зарплат|заработн/, 'salary'],
  [/возврат/, 'refund'],
];
// Сводные категории банка, по которым нельзя понять суть («Коммунальные платежи, связь, интернет» — это и ЖКХ, и телефон).
const BANK_CAT_AMBIGUOUS = /коммунальные платежи, связь|прочие|перевод|пополнени|внесение наличных|оплата по qr/;

export function bankCategory(name) {
  const s = String(name ?? '').toLowerCase().replace(/ё/g, 'е').trim();
  if (!s || BANK_CAT_AMBIGUOUS.test(s)) return null;
  for (const [re, cat] of BANK_CAT) if (re.test(s)) return cat;
  return null;
}

// Известные магазины и сервисы → категория. Сверяется по словам описания (латиница и кириллица).
const KNOWN = [
  ['taxi', ['YANDEX 4121', 'YANDEX GO', 'YANDEX TAXI', 'ЯНДЕКС ТАКСИ', 'ЯНДЕКС GO', 'UBER', 'CITYMOBIL', 'MAXIM']],
  ['transport', ['METRO', 'LK METRO', 'MOSMETRO', 'CPPK', 'ЦППК', 'MOSGORTRANS', 'TROIKA', 'ТРОЙКА', 'AEROEXPRESS', 'AEROEXPRESS TRAIN', 'RZD', 'РЖД', 'YANDEX 4111', 'МЕТРОПОЛИТЕН']],
  ['food', ['PEREKRESTOK', 'ПЕРЕКРЕСТОК', 'PYATEROCHKA', 'PYATYOROCHKA', 'ПЯТЕРОЧКА', 'MAGNIT MM', 'MAGNIT', 'МАГНИТ', 'VKUSVILL', 'ВКУСВИЛЛ', 'VV KKM', 'SAMOKAT', 'САМОКАТ', 'AUCHAN', 'АШАН', 'LENTA', 'ЛЕНТА', 'DIXY', 'DIKSI', 'ДИКСИ', 'SPAR', 'AZBUKA VKUSA', 'CHIZHIK', 'ЧИЖИК', 'EVO PRODUKTY', 'PRODUKTY', 'ПРОДУКТЫ', 'OVOSCHI', 'FRUKTY', 'ОВОЩИ', 'EVO KONDITERKA', 'BELKA ORESHKI', 'METRO CC', 'GLOBUS', 'ГЛОБУС', 'VERNYJ', 'ВЕРНЫЙ', 'MAGNOLIYA', 'KRASNOE BELOE', 'КРАСНОЕ БЕЛОЕ']],
  ['cafe', ['KAFE', 'CAFE', 'CAFFE', 'КАФЕ', 'KOFE', 'COFFEE', 'КОФЕ', 'COFIX', 'KOFEJNYA', 'KOFEYNYA', 'КОФЕЙНЯ', 'DODO PIZZA', 'PIZZA', 'ПИЦЦА', 'BURGER', 'VKUSNO I TOCHKA', 'ВКУСНО И ТОЧКА', 'TEREMOK', 'ТЕРЕМОК', 'SHOKOLADNITSA', 'STARBUCKS', 'BRATYA KARAVAEVY', 'KAFETERIY', 'RESTORAN', 'РЕСТОРАН', 'SUSHI', 'СУШИ', 'STOLOVAYA', 'СТОЛОВАЯ', 'KFC', 'ROSTICS']],
  ['connect', ['T2', 'TELE2', 'ТЕЛЕ2', 'Т2', 'BEELINE', 'БИЛАЙН', 'MEGAFON', 'МЕГАФОН', 'MGTS', 'МГТС', 'ROSTELECOM', 'РОСТЕЛЕКОМ', 'MTS MOBILE', 'МТС']],
  ['health', ['APTEKA', 'АПТЕКА', 'APTECHNOE', 'APTECHNYJ', 'RIGLA', 'РИГЛА', 'GORZDRAV', 'ГОРЗДРАВ', 'STOLICHKI', 'СТОЛИЧКИ', 'ZDOROV RU', 'ZDRAVSITI', 'INVITRO', 'ИНВИТРО', 'GEMOTEST', 'KLINIKA', 'КЛИНИКА', 'STOMATOLOG', 'СТОМАТОЛОГ']],
  ['beauty', ['PARIKMAKHERSKAYA', 'ПАРИКМАХЕРСКАЯ', 'BARBERSHOP', 'BARBER', 'SALON KRASOTY', 'САЛОН КРАСОТЫ', 'ZOLOTOE YABLOKO', 'ЗОЛОТОЕ ЯБЛОКО', 'LETUAL', 'ЛЭТУАЛЬ']],
  ['market', ['OZON', 'ОЗОН', 'ПЛАТФОРМЕ OZON', 'WILDBERRIES', 'WB WILDBERRIES', 'ВАЙЛДБЕРРИЗ', 'LAMODA', 'ЛАМОДА', 'AVITO', 'АВИТО', 'YANDEX MARKET', 'ЯНДЕКС МАРКЕТ', 'MEGAMARKET', 'ALIEXPRESS']],
  ['travel', ['KUPIBILET', 'ONETWOTRIP', 'AVIASALES', 'AEROFLOT', 'АЭРОФЛОТ', 'POBEDA', 'ПОБЕДА', 'OSTROVOK', 'TUTU', 'YANDEX TRAVEL', 'S7']],
  ['home', ['LEMANA', 'LEMANAPRO', 'LEMANAPROGPB', 'LEROY MERLIN', 'ЛЕРУА', 'OBI', 'IKEA', 'HOFF', 'GALAMART', 'ГАЛАМАРТ', 'FIX PRICE', 'ФИКС ПРАЙС']],
  ['subs', ['YANDEX PLUS', 'ЯНДЕКС ПЛЮС', 'KINOPOISK', 'КИНОПОИСК', 'IVI', 'OKKO', 'APPLE COM BILL', 'ITUNES', 'SPOTIFY']],
  ['fun', ['SPORT', 'СПОРТ', 'SQUASH', 'FITNESS', 'ФИТНЕС', 'KINO', 'CINEMA', 'КИНОТЕАТР', 'TEATR', 'ТЕАТР', 'MUZEJ', 'МУЗЕЙ', 'PLATFORMA SPORT']],
  ['gov', ['GOSUSLUGI', 'ГОСУСЛУГИ', 'FNS', 'ФНС', 'GIBDD', 'ГИБДД', 'НАЛОГ']],
];
const KNOWN_LIST = [];
for (const [cat, phrases] of KNOWN) for (const p of phrases) KNOWN_LIST.push([' ' + p + ' ', cat]);
KNOWN_LIST.sort((a, b) => b[0].length - a[0].length);

// Смысл операции по самому описанию — для банков, которые не пишут категорию.
const DESC_PATTERNS = [
  [/ПОГАШЕНИЕ КРЕДИТА|РЕГУЛЯРНЫЙ ПЛАТЕЖ|ПЛАТЕЖ ПО КРЕДИТУ|ПОГАШЕНИЕ ЗАДОЛЖЕННОСТИ ПО КРЕДИТУ/, 'loans'],
  [/СНЯТИЕ НАЛИЧНЫХ|ВЫДАЧА НАЛИЧНЫХ/, 'cash'],
  [/КЭШБЭК|КЕШБЭК|КЕШБЕК|CASHBACK|ПРОЦЕНТЫ НА ОСТАТОК|НАЧИСЛЕНИЕ ПРОЦЕНТОВ|ВЫПЛАТА ПРОЦЕНТОВ/, 'cashback'],
  [/ЗАРАБОТНАЯ ПЛАТА|ЗАРПЛАТА|АВАНС ЗА|ОПЛАТА ТРУДА/, 'salary'],
  [/ВОЗВРАТ ОПЛАТЫ|ВОЗВРАТ ПОКУПКИ|ОТМЕНА ПОКУПКИ|ОТМЕНА ВОЗВРАТА/, 'refund'],
];

export const wordsOf = (desc) => ' ' + String(desc ?? '').toUpperCase().replace(/Ё/g, 'Е').replace(/[^A-ZА-Я0-9]+/g, ' ').trim() + ' ';

export function descCategory(desc) {
  const u = String(desc ?? '').toUpperCase().replace(/Ё/g, 'Е');
  for (const [re, cat] of DESC_PATTERNS) if (re.test(u)) return cat;
  return null;
}
export function knownCategory(desc) {
  const w = wordsOf(desc);
  for (const [p, cat] of KNOWN_LIST) if (w.includes(p)) return cat;
  return null;
}
