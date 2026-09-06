// Разбор строки быстрого добавления: «позвонить маме завтра в 18:00 !2 #дом»
// → заголовок «позвонить маме», дата, время напоминания, приоритет, теги.
//
// Границы слов через \b тут не работают: \b опирается на ASCII-\w, и для кириллицы
// «завтра» внутри «послезавтра» не отсекается. Поэтому каждое правило само
// захватывает начало строки или пробел (группа 1) и возвращает его на место.

import { todayStr, addDays, formatDate } from './store.js?v=15';

// \w опирается на ASCII и кириллические окончания не ловит — везде используем явный класс
const RU = '[а-яёa-z]';

const WEEKDAYS = [
  { rx: `понедельник${RU}*|пн`, dow: 1 },
  { rx: `вторник${RU}*|вт`,     dow: 2 },
  { rx: 'сред[уаы]|ср',         dow: 3 },
  { rx: `четверг${RU}*|чт`,     dow: 4 },
  { rx: 'пятниц[уые]|пт',       dow: 5 },
  { rx: 'суббот[уаы]|сб',       dow: 6 },
  { rx: 'воскресень[еяю]|вс',   dow: 0 },
];

const MONTHS_GEN = ['январ', 'феврал', 'март', 'апрел', 'ма[ця]', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];

const START = '(^|\\s)';
const END = '(?=\\s|$|[.,;!?])';

// Ближайший день недели: сегодняшний день считаем подходящим — «в пятницу сдать»,
// сказанное в пятницу, обычно означает сегодня, а не через неделю.
function nextWeekday(dow) {
  const now = new Date();
  const diff = (dow - now.getDay() + 7) % 7;
  return addDays(todayStr(), diff);
}

function clampDay(year, month /* 1-12 */, day) {
  const max = new Date(year, month, 0).getDate();
  return Math.min(day, max);
}

// Дата без года: если число уже прошло, имеется в виду следующий год
function dateFromDayMonth(day, month) {
  const now = new Date();
  let year = now.getFullYear();
  let s = `${year}-${String(month).padStart(2, '0')}-${String(clampDay(year, month, day)).padStart(2, '0')}`;
  if (s < todayStr()) {
    year += 1;
    s = `${year}-${String(month).padStart(2, '0')}-${String(clampDay(year, month, day)).padStart(2, '0')}`;
  }
  return s;
}

export function parseQuickInput(raw) {
  const out = { title: '', when: null, time: null, lead: null, priority: 0, tags: [], hits: [] };
  if (!raw) return out;
  let text = raw;

  // одно правило срабатывает один раз; matched — что показать пользователю чипсом
  const apply = (pattern, handler, kind) => {
    if (out.hits.some(h => h.kind === kind)) return;
    // шаблон обязательно оборачиваем: иначе «а|б» разрывает группу START,
    // m[1] приходит undefined и подставляется в заголовок строкой "undefined"
    const re = new RegExp(START + '(?:' + pattern + ')' + END, 'i');
    const m = re.exec(text);
    if (!m) return;
    const value = handler(m);
    if (value === null || value === undefined) return;
    out.hits.push({ kind, label: m[0].trim(), value });
    text = text.slice(0, m.index) + m[1] + text.slice(m.index + m[0].length);
  };

  // ---- время: «в 18:00», «в 18.30», «18:00», «в 9 утра», «в 7 вечера» ----
  const asTime = m => {
    const h = Number(m[2]), min = Number(m[3]);
    return h < 24 && min < 60 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` : null;
  };
  // хвост (?![.\d]) не даёт «15.03.2027» превратиться во время 15:03
  apply('(?:в|к)\\s+(\\d{1,2})[:.](\\d{2})(?![.\\d])', asTime, 'time');
  // без предлога принимаем только двоеточие: точка неотличима от даты «15.03»
  apply('(\\d{1,2}):(\\d{2})', asTime, 'time');
  // «в 18» без минут — только с предлогом, иначе «купить 18 яблок» распадётся
  apply('(?:в|к)\\s+(\\d{1,2})\\s*(утра|дня|вечера|ночи)?', m => {
    let h = Number(m[2]);
    const part = (m[3] || '').toLowerCase();
    if (h > 23) return null;
    if (part === 'вечера' && h < 12) h += 12;
    if (part === 'дня' && h < 12) h += 12;
    if (part === 'ночи' && h === 12) h = 0;
    if (!part && h > 23) return null;
    return `${String(h).padStart(2, '0')}:00`;
  }, 'time');

  // ---- предварительное напоминание: «напомнить за 15 минут», «за полчаса» ----
  // Смысл есть только при заданном времени: «за 15 минут» до чего-то, чего нет,
  // ничего не значит. Без этой проверки «сделать за 20 минут» — про длительность
  // работы, а не про напоминание — превращалось бы в будильник.
  const asLead = (n, unit) => {
    const minutes = /^час/i.test(unit) ? n * 60 : n;
    return minutes > 0 && minutes <= 24 * 60 ? minutes : null;
  };
  const hasTime = () => out.hits.some(h => h.kind === 'time');

  apply(`(?:напомн${RU}*|предупред${RU}*)\\s+(?:за\\s+)?(\\d{1,3})\\s*(мин${RU}*|час${RU}*)`,
    m => (hasTime() ? asLead(Number(m[2]), m[3]) : null), 'lead');
  apply(`(?:напомн${RU}*\\s+)?за\\s+(\\d{1,3})\\s*(мин${RU}*|час${RU}*)`,
    m => (hasTime() ? asLead(Number(m[2]), m[3]) : null), 'lead');
  // «за час» и «за полчаса» — без числа
  apply(`(?:напомн${RU}*\\s+)?за\\s+(полчаса|час)`,
    m => (hasTime() ? (/^полчаса/i.test(m[2]) ? 30 : 60) : null), 'lead');
  // одинокое «напомнить» без отступа — просто убираем из названия
  apply(`напомн${RU}*`, () => (hasTime() ? 0 : null), 'reminderword');

  // ---- дата ----
  apply('послезавтра', () => addDays(todayStr(), 2), 'when');
  apply('завтра', () => addDays(todayStr(), 1), 'when');
  apply('(?:сегодня\\s+)?вечером', () => 'evening', 'when');
  apply('сегодня', () => 'today', 'when');
  apply('(?:как[- ]нибудь|когда[- ]нибудь|потом)', () => 'someday', 'when');
  apply(`через\\s+(\\d{1,3})\\s*(дн[еяй]${RU}*|день|недел${RU}+|месяц${RU}*)`, m => {
    const n = Number(m[2]);
    const unit = m[3].toLowerCase();
    if (unit.startsWith('недел')) return addDays(todayStr(), n * 7);
    if (unit.startsWith('месяц')) {
      const [y, mo, d] = todayStr().split('-').map(Number);
      const dt = new Date(y, mo - 1 + n, 1);
      return formatDate(new Date(dt.getFullYear(), dt.getMonth(), clampDay(dt.getFullYear(), dt.getMonth() + 1, d)));
    }
    return addDays(todayStr(), n);
  }, 'when');
  apply(`(?:на\\s+)?выходн${RU}+`, () => nextWeekday(6), 'when');
  apply(`(?:на\\s+)?следующ${RU}+\\s+недел${RU}+`, () => nextWeekday(1), 'when');
  WEEKDAYS.forEach(w => apply(`(?:в|во)\\s+(?:${w.rx})`, () => nextWeekday(w.dow), 'when'));
  WEEKDAYS.forEach(w => apply(`(?:${w.rx})`, () => nextWeekday(w.dow), 'when'));
  // «15 марта»
  apply(`(\\d{1,2})\\s+(${MONTHS_GEN.join('|')})${RU}*`, m => {
    const day = Number(m[2]);
    const idx = MONTHS_GEN.findIndex(mn => new RegExp('^' + mn, 'i').test(m[3]));
    return idx === -1 || day < 1 || day > 31 ? null : dateFromDayMonth(day, idx + 1);
  }, 'when');
  // «15.03», «15.03.2026», «15/03»
  apply('(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{2,4}))?', m => {
    const day = Number(m[2]), mon = Number(m[3]);
    if (day < 1 || day > 31 || mon < 1 || mon > 12) return null;
    if (m[4]) {
      let y = Number(m[4]);
      if (y < 100) y += 2000;
      return `${y}-${String(mon).padStart(2, '0')}-${String(clampDay(y, mon, day)).padStart(2, '0')}`;
    }
    return dateFromDayMonth(day, mon);
  }, 'when');

  // ---- приоритет: !1 !2 !3 либо !! !!! ----
  // одиночный «!» намеренно не ловим — он слишком часто просто знак препинания
  apply('!([1-3])', m => Number(m[2]), 'priority');
  apply('(!{2,3})', m => (m[2].length === 3 ? 3 : 2), 'priority');

  // ---- теги: #дом (можно несколько) ----
  const tagRe = new RegExp(START + '#([\\p{L}\\p{N}_-]{1,30})' + END, 'giu');
  text = text.replace(tagRe, (full, lead, tag) => { out.tags.push(tag); return lead; });
  if (out.tags.length) out.hits.push({ kind: 'tags', label: out.tags.map(t => '#' + t).join(' '), value: out.tags });

  out.title = text.replace(/\s{2,}/g, ' ').trim();
  out.when = out.hits.find(h => h.kind === 'when')?.value ?? null;
  out.time = out.hits.find(h => h.kind === 'time')?.value ?? null;
  out.priority = out.hits.find(h => h.kind === 'priority')?.value ?? 0;
  out.lead = out.hits.find(h => h.kind === 'lead')?.value ?? null;
  return out;
}

// Человекочитаемая подпись для чипса «что распозналось»
export function describeWhen(when) {
  if (!when) return null;
  if (when === 'today') return 'Сегодня';
  if (when === 'evening') return 'Этим вечером';
  if (when === 'someday') return 'Когда-нибудь';
  const [y, m, d] = when.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const today = todayStr();
  if (when === today) return 'Сегодня';
  if (when === addDays(today, 1)) return 'Завтра';
  // год показываем, только если он отличается от текущего — иначе шум
  const opts = { weekday: 'short', day: 'numeric', month: 'long' };
  if (y !== new Date().getFullYear()) opts.year = 'numeric';
  return dt.toLocaleDateString('ru-RU', opts);
}
