// Планировщик уведомлений для нативной сборки (Capacitor + UNUserNotificationCenter).
//
// В браузере напоминания работали опросом: раз в 20 секунд смотрели, не наступило ли
// время. На телефоне так нельзя — закрытое приложение ничего не опрашивает. Поэтому
// здесь мы, наоборот, заранее отдаём будущие срабатывания системе, а она будит
// пользователя сама, даже когда приложение выгружено и интернета нет.

import { store, todayStr, isDateStr, formatLead } from './store.js?v=15';

// У iOS жёсткий лимит: 64 ожидающих локальных уведомления на приложение.
// Держим запас — часть слотов уходит под «повторять каждые N минут».
const MAX_SCHEDULED = 56;
// «Повторять каждые N минут» — бесконечный по смыслу, но системе нужен конечный список
const MAX_REPEAT_FOLLOWUPS = 6;

// Кнопки прямо в уведомлении: закрыть задачу или отложить, не открывая приложение.
// Ради этого напоминания и существуют — заставлять ради галочки заходить внутрь незачем.
const ACTION_TYPE = 'TASK_REMINDER';
const SNOOZE_MINUTES = 10;
// Отложенные уведомления живут в собственном диапазоне идентификаторов выше
// этой границы. Так они, во-первых, не сталкиваются с плановыми, а во-вторых —
// переживают пересборку расписания, которая отменяет всё остальное.
const SNOOZE_ID_BASE = 2000000000;

export function isNativeApp() {
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

let plugin = null;
function localNotifications() {
  if (!isNativeApp()) return null;
  // registerPlugin ругается на повторную регистрацию — держим единственный экземпляр
  if (!plugin) plugin = window.Capacitor.registerPlugin('LocalNotifications');
  return plugin;
}

// ---------------- вспомогательное ----------------

// id уведомления обязан быть 32-битным числом, а у задач id строковые.
// FNV-1a даёт стабильное значение: пересчёт расписания не сдвигает существующие id.
function notifId(taskId, kind, seq = 0) {
  const s = `${taskId}|${kind}|${seq}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // остаток удерживает значение ниже диапазона отложенных
  return (h >>> 1) % SNOOZE_ID_BASE;
}

function hm(time) {
  const [h, m] = time.split(':').map(Number);
  return { hour: h, minute: m };
}

function dateAt(dayStr, time) {
  const [y, mo, d] = dayStr.split('-').map(Number);
  const { hour, minute } = hm(time);
  return new Date(y, mo - 1, d, hour, minute, 0, 0);
}

function shiftTime(time, deltaMin) {
  const { hour, minute } = hm(time);
  const total = hour * 60 + minute + deltaMin;
  if (total >= 24 * 60) return null; // за полночь не переносим — это уже другой день
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function bodyFor(task, kind) {
  if (kind === 'lead') return `Через ${formatLead(task.reminderLeadMinutes)} — в ${task.reminderTime}`;
  const notes = task.notes && task.notes.trim();
  return notes || `Напоминание на ${task.reminderTime}`;
}

// ---------------- построение расписания ----------------

// Повторяет ли напоминание каждый день. Совпадает с условием dueReminders():
// задача без даты, на сегодня/вечер или просроченная напоминает о себе ежедневно,
// пока её не закроют.
function isDaily(task, today) {
  return !task.when || task.when === 'today' || task.when === 'evening'
    || (isDateStr(task.when) && task.when <= today);
}

// Ближайшее срабатывание — нужно, чтобы при нехватке слотов отсечь дальние
function nextFireAt(daily, dayStr, time) {
  if (!daily) return dateAt(dayStr, time);
  const todayAt = dateAt(todayStr(), time);
  if (todayAt > new Date()) return todayAt;
  const t = new Date(todayAt);
  t.setDate(t.getDate() + 1);
  return t;
}

function entriesForTask(task, today) {
  const out = [];
  const daily = isDaily(task, today);
  // у задачи с будущей датой всё привязано к этой дате, у ежедневной — к сегодня
  const day = daily ? todayStr() : task.when;

  const add = (kind, time, seq = 0) => {
    if (!time) return;
    const fireAt = nextFireAt(daily, day, time);
    // разовое уведомление в прошлом система отвергает — такие просто пропускаем
    if (!daily && fireAt <= new Date()) return;
    out.push({
      id: notifId(task.id, kind, seq),
      title: task.title,
      body: bodyFor(task, kind),
      // повторяющиеся отдаём календарным триггером: один слот вместо копии на каждый день
      schedule: daily ? { on: hm(time) } : { at: fireAt },
      actionTypeId: ACTION_TYPE,
      extra: { taskId: task.id, kind },
      sortAt: fireAt.getTime(),
    });
  };

  add('lead', store.leadTimeFor(task));
  add('main', task.reminderTime);

  // «Повторять каждые N минут» календарным триггером не выразить — разворачиваем
  // в конечную серию разовых. Список обновляется при каждом пересчёте расписания.
  if (task.reminderRepeatMinutes) {
    for (let i = 1; i <= MAX_REPEAT_FOLLOWUPS; i++) {
      const time = shiftTime(task.reminderTime, task.reminderRepeatMinutes * i);
      if (!time) break;
      const fireAt = nextFireAt(daily, day, time);
      if (fireAt <= new Date()) continue;
      out.push({
        id: notifId(task.id, 'repeat', i),
        title: task.title,
        body: bodyFor(task, 'main'),
        schedule: { at: fireAt },
        actionTypeId: ACTION_TYPE,
        extra: { taskId: task.id, kind: 'repeat' },
        sortAt: fireAt.getTime(),
      });
    }
  }

  return out;
}

export function buildSchedule() {
  const today = todayStr();
  const all = [];
  store.allActiveTasks().forEach(task => {
    if (!task.reminderTime) return;
    // «Когда-нибудь» — сознательно отложенная задача, она не должна напоминать о себе
    if (task.when === 'someday') return;
    all.push(...entriesForTask(task, today));
  });
  // при нехватке слотов жертвуем дальними — ближайшие срабатывания важнее
  all.sort((a, b) => a.sortAt - b.sortAt);
  return all.slice(0, MAX_SCHEDULED).map(({ sortAt, ...n }) => n);
}

// ---------------- синхронизация с системой ----------------

export async function hasPermission() {
  const ln = localNotifications();
  if (!ln) return false;
  const res = await ln.checkPermissions();
  return res.display === 'granted';
}

export async function requestPermission() {
  const ln = localNotifications();
  if (!ln) return false;
  const res = await ln.requestPermissions();
  return res.display === 'granted';
}

let syncTimer = null;
let syncing = false;

// Пересчитываем всё расписание целиком, а не разницу: задач немного, а частичное
// обновление легко расходится с реальностью после правок в нескольких местах.
export async function syncSchedule() {
  const ln = localNotifications();
  if (!ln || syncing) return;
  if (!(await hasPermission())) return;
  syncing = true;
  try {
    const pending = await ln.getPending();
    // Отложенные вручную не трогаем: они не выводятся из состояния задач,
    // и пересборка расписания их бы просто стёрла.
    const stale = pending.notifications.filter(n => n.id < SNOOZE_ID_BASE);
    if (stale.length) {
      await ln.cancel({ notifications: stale.map(n => ({ id: n.id })) });
    }
    const notifications = buildSchedule();
    if (notifications.length) await ln.schedule({ notifications });
  } catch (e) {
    console.error('Не удалось обновить расписание уведомлений', e);
  } finally {
    syncing = false;
  }
}

// store.subscribe дёргается на каждое изменение — переспрашивать систему на каждый
// чих незачем, схлопываем серию правок в один пересчёт
export function scheduleSyncSoon() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncSchedule, 400);
}

// Отложить: одноразовое уведомление через SNOOZE_MINUTES. В расписание задачи
// оно не входит и переживает пересборку только до ближайшего syncSchedule —
// поэтому ставим его отдельным id, который планировщик не занимает.
async function snooze(notification) {
  const ln = localNotifications();
  if (!ln) return;
  const at = new Date(Date.now() + SNOOZE_MINUTES * 60000);
  await ln.schedule({
    notifications: [{
      id: SNOOZE_ID_BASE + (notification.id % 100000000),
      title: notification.title,
      body: notification.body,
      schedule: { at },
      actionTypeId: ACTION_TYPE,
      extra: notification.extra,
    }],
  });
}

// ---------------- подключение ----------------

export async function initNativeNotifications({ onOpenTask, onCompleteTask } = {}) {
  const ln = localNotifications();
  if (!ln) return { granted: false, available: false };

  await ln.registerActionTypes({
    types: [{
      id: ACTION_TYPE,
      actions: [
        { id: 'complete', title: 'Выполнить' },
        { id: 'snooze', title: `Отложить на ${SNOOZE_MINUTES} мин` },
      ],
    }],
  });

  await ln.addListener('localNotificationActionPerformed', async (event) => {
    const taskId = event?.notification?.extra?.taskId;
    if (!taskId) return;
    // 'tap' — обычное нажатие на само уведомление, остальное — наши кнопки
    if (event.actionId === 'complete') {
      onCompleteTask?.(taskId);
    } else if (event.actionId === 'snooze') {
      await snooze(event.notification);
    } else {
      onOpenTask?.(taskId);
    }
  });

  // расписание живо ровно до следующего запуска: пока приложение было закрыто,
  // разовые «повторы» отработали, а день мог смениться — пересобираем на возврате
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleSyncSoon();
  });

  const granted = await hasPermission() || await requestPermission();
  if (granted) await syncSchedule();
  return { granted, available: true };
}
