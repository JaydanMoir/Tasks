const STORAGE_KEY = 'tasksApp.v1';

// Сколько времени задача считается «только что убранной» и предлагается к возврату
const LAST_REMOVED_WINDOW_MS = 15 * 60 * 1000;

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
}

function todayStr() {
  const d = new Date();
  return formatDate(d);
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return formatDate(dt);
}

function daysBetween(fromStr, toStr) {
  const [y1, m1, d1] = fromStr.split('-').map(Number);
  const [y2, m2, d2] = toStr.split('-').map(Number);
  // округление гасит сдвиг на час при переходе на летнее время
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
}

const isDateStr = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');

// Запоминаем, какой день подразумевался под словом. Для конкретных дат
// и «когда-нибудь» отметка не нужна — там день уже задан или не задан вовсе.
function stampWhenDay(task) {
  task.whenSetOn = (task.when === 'today' || task.when === 'evening') ? todayStr() : null;
}

function nextRepeatDate(dateStr, repeat) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (repeat === 'daily') dt.setDate(dt.getDate() + 1);
  else if (repeat === 'weekly') dt.setDate(dt.getDate() + 7);
  else if (repeat === 'monthly') dt.setMonth(dt.getMonth() + 1);
  return formatDate(dt);
}

function defaultState() {
  return {
    tasks: {},
    projects: {},
    areas: {},
    tags: {},
    headings: {},
    order: { tasks: [] }, // global order list of task ids, used for manual ordering within groups
  };
}

class Store {
  constructor() {
    this.state = this.load();
    this.listeners = [];
    this._stamp = 0;      // растёт при каждом save(), инвалидирует индекс порядка
    this._orderIndex = null;
    this._orderIndexStamp = -1;
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return Object.assign(defaultState(), parsed);
    } catch (e) {
      console.error('Failed to load state', e);
      // не затираем повреждённые данные молча: приложение иначе просто пересоздаёт
      // демо-набор поверх них, и восстановить исходное уже нечем
      try {
        localStorage.setItem(STORAGE_KEY + '.corrupt.' + Date.now(), localStorage.getItem(STORAGE_KEY));
      } catch (_) { /* места может не хватить — тогда просто продолжаем */ }
      return defaultState();
    }
  }

  // запись без перерисовки — для посимвольного ввода, где ре-рендер сбил бы фокус
  saveQuiet() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      return true;
    } catch (e) {
      console.error('Не удалось сохранить состояние', e);
      window.dispatchEvent(new CustomEvent('tasks:save-error', { detail: e }));
      return false;
    }
  }

  save() {
    this._stamp++;
    this.saveQuiet();
    this.emit();
  }

  importState(newState) {
    this.state = Object.assign(defaultState(), newState);
    this.save();
  }

  subscribe(fn) {
    this.listeners.push(fn);
  }

  emit() {
    this.listeners.forEach(fn => fn(this.state));
  }

  // ---------------- Tasks ----------------
  createTask({ title, notes = '', when = null, projectId = null, areaId = null, headingId = null, tags = [], deadline = null, priority = 0, repeat = null, repeatFromCompletion = false, checklist = [], reminderTime = null, reminderRepeatMinutes = null, reminderLeadMinutes = null } = {}) {
    const id = uid();
    const now = Date.now();
    const task = {
      id, title: title || 'Новая задача', notes,
      checklist,
      tags,
      when, // null | 'today' | 'evening' | 'someday' | 'YYYY-MM-DD'
      whenSetOn: null, // какой день имелся в виду под «сегодня»/«вечером»
      deadline, // null | 'YYYY-MM-DD'
      priority, // 0 none | 1 low | 2 medium | 3 high
      repeat, // null | 'daily' | 'weekly' | 'monthly'
      repeatFromCompletion, // true: next occurrence counts from completion day, not the scheduled day
      reminderTime, // null | 'HH:MM' — fires a notification on the scheduled day
      reminderRepeatMinutes, // null | number — re-fire every N minutes after reminderTime, same day
      reminderLeadMinutes, // null | number — extra early ping N minutes before reminderTime
      notifiedOn: null, // 'YYYY-MM-DD' of the last date a reminder notification fired
      leadNotifiedOn: null, // 'YYYY-MM-DD' of the last date the early ping fired
      lastNotifiedAt: null, // timestamp of the last notification, used to space out repeat reminders
      spawnedTaskId: null, // id of the occurrence created when this repeating task was completed
      projectId, areaId, headingId,
      inInbox: !projectId && !areaId && !when,
      status: 'active', // active | completed | canceled | trashed
      createdAt: now,
      completedAt: null,
      order: now,
    };
    stampWhenDay(task);
    this.state.tasks[id] = task;
    this.state.order.tasks.push(id);
    this.save();
    return task;
  }

  updateTask(id, patch) {
    const t = this.state.tasks[id];
    if (!t) return;
    Object.assign(t, patch);
    if (patch.when !== undefined) stampWhenDay(t);
    // clear inbox flag once organized
    if (patch.projectId !== undefined || patch.areaId !== undefined || patch.when !== undefined) {
      if (t.projectId || t.areaId || t.when) t.inInbox = false;
    }
    // heading only makes sense within its own project
    if ((patch.projectId !== undefined || patch.headingId !== undefined) && t.headingId) {
      const h = this.state.headings[t.headingId];
      if (!h || h.projectId !== t.projectId) t.headingId = null;
    }
    this.save();
  }

  // kind: 'main' — напоминание в назначенное время, 'lead' — предварительное «за N минут»
  markNotified(id, dateStr, kind = 'main') {
    const t = this.state.tasks[id];
    if (!t) return;
    if (kind === 'lead') {
      t.leadNotifiedOn = dateStr;
    } else {
      t.notifiedOn = dateStr;
      t.lastNotifiedAt = Date.now();
    }
    this.saveQuiet();
  }

  // Предварительное напоминание считаем от времени задачи назад. Если отступ
  // уводит за полночь, прижимаем к 00:00 того же дня — на предыдущий день
  // напоминание не переносим, иначе оно приходит когда задачи ещё «нет».
  leadTimeFor(t) {
    if (!t.reminderTime || !t.reminderLeadMinutes) return null;
    const [h, m] = t.reminderTime.split(':').map(Number);
    const total = Math.max(0, h * 60 + m - t.reminderLeadMinutes);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  // Возвращает список {task, kind}: у одной задачи за день может сработать
  // и предварительное напоминание, и основное.
  dueReminders() {
    const today = todayStr();
    const now = new Date();
    const nowHM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const due = [];

    this.allActiveTasks().forEach(t => {
      if (!t.reminderTime) return;
      // «Когда-нибудь» — сознательно отложенная задача, она не должна напоминать о себе сегодня
      if (t.when === 'someday') return;
      // напоминание срабатывает у задач без даты, на сегодня/вечер и у просроченных
      const onToday = !t.when || t.when === 'today' || t.when === 'evening'
        || (isDateStr(t.when) && t.when <= today);
      if (!onToday) return;

      // предварительное — только пока основное ещё не наступило
      const lead = this.leadTimeFor(t);
      if (lead && nowHM >= lead && nowHM < t.reminderTime && t.leadNotifiedOn !== today) {
        due.push({ task: t, kind: 'lead' });
      }

      if (nowHM < t.reminderTime) return;
      if (t.notifiedOn !== today) { due.push({ task: t, kind: 'main' }); return; }
      if (!t.reminderRepeatMinutes) return; // already fired once, no repeat requested
      const elapsedMin = t.lastNotifiedAt ? (Date.now() - t.lastNotifiedAt) / 60000 : Infinity;
      if (elapsedMin >= t.reminderRepeatMinutes) due.push({ task: t, kind: 'main' });
    });

    return due;
  }

  toggleComplete(id) {
    const t = this.state.tasks[id];
    if (!t) return;
    if (t.status === 'completed') {
      t.status = 'active';
      t.completedAt = null;
      // снятие галочки отменяет и следующее вхождение, созданное при выполнении,
      // но только если его ещё не успели изменить
      const spawned = t.spawnedTaskId ? this.state.tasks[t.spawnedTaskId] : null;
      if (spawned && spawned.status === 'active' && !spawned.completedAt) {
        delete this.state.tasks[spawned.id];
        this.state.order.tasks = this.state.order.tasks.filter(x => x !== spawned.id);
      }
      t.spawnedTaskId = null;
    } else {
      t.status = 'completed';
      t.completedAt = Date.now();
      if (t.repeat) {
        const next = this.spawnNextOccurrence(t);
        t.spawnedTaskId = next ? next.id : null;
      }
    }
    this.save();
  }

  // Следующее вхождение повторяющейся задачи: переносит и дедлайн, и напоминание,
  // и чек-лист (со сброшенными галочками) — иначе повтор терял бы половину настроек.
  spawnNextOccurrence(t) {
    if (!t.repeat) return null;
    const base = (!t.repeatFromCompletion && isDateStr(t.when)) ? t.when : todayStr();
    const when = nextRepeatDate(base, t.repeat);
    const shift = daysBetween(base, when);
    return this.createTask({
      title: t.title, notes: t.notes, when,
      projectId: t.projectId, areaId: t.areaId, headingId: t.headingId,
      tags: t.tags.slice(), priority: t.priority,
      repeat: t.repeat, repeatFromCompletion: t.repeatFromCompletion,
      deadline: isDateStr(t.deadline) ? addDays(t.deadline, shift) : t.deadline,
      checklist: t.checklist.map(c => ({ id: uid(), text: c.text, completed: false })),
      reminderTime: t.reminderTime,
      reminderRepeatMinutes: t.reminderRepeatMinutes,
      reminderLeadMinutes: t.reminderLeadMinutes,
    });
  }

  toggleCancel(id) {
    const t = this.state.tasks[id];
    if (!t) return;
    t.status = t.status === 'canceled' ? 'active' : 'canceled';
    t.completedAt = t.status === 'canceled' ? Date.now() : null;
    this.save();
  }

  trashTask(id) {
    const t = this.state.tasks[id];
    if (!t) return;
    // Запоминаем, откуда задача попала в корзину. Без этого выполненная задача,
    // удалённая из журнала, возвращалась живой: статус затирался, и восстановление
    // всегда делало её активной — с датой выполнения, но снова в работе.
    if (t.status !== 'trashed') t.statusBeforeTrash = t.status;
    t.status = 'trashed';
    // время удаления нужно, чтобы находить последнюю выброшенную задачу:
    // порядок в корзине по нему, а не по дате создания
    t.trashedAt = Date.now();
    this.save();
  }

  restoreTask(id) {
    const t = this.state.tasks[id];
    if (!t) return;
    // возвращаем ровно туда, откуда взяли: выполненная — в журнал, живая — в списки
    t.status = t.statusBeforeTrash || 'active';
    t.statusBeforeTrash = null;
    t.trashedAt = null;
    this.save();
  }

  // Последнее, что пользователь убрал с глаз: удалил или отметил выполненным.
  // Нужно для возврата случайно закрытой задачи из меню пустого места списка.
  lastRemoved(fits = () => true) {
    // Это отмена только что сделанного, а не разбор архива: без окна меню
    // предлагало снять отметку с задачи, закрытой неделю назад.
    const since = Date.now() - LAST_REMOVED_WINDOW_MS;
    let trashed = null, completed = null;
    Object.values(this.state.tasks).forEach(t => {
      if (!fits(t)) return;
      if (t.status === 'trashed' && t.trashedAt > since) {
        if (!trashed || t.trashedAt > trashed.trashedAt) trashed = t;
      } else if (t.status === 'completed' && t.completedAt > since) {
        // Выполнение повторяющейся задачи — не удаление, а переход к следующему
        // вхождению: оно уже стоит в списке, и снятие отметки его уничтожит.
        if (t.spawnedTaskId) return;
        if (!completed || t.completedAt > completed.completedAt) completed = t;
      }
    });
    return { trashed, completed };
  }

  duplicateTask(id) {
    const t = this.state.tasks[id];
    if (!t) return null;
    return this.createTask({
      title: t.title, notes: t.notes, when: t.when, projectId: t.projectId, areaId: t.areaId,
      headingId: t.headingId, tags: t.tags.slice(), deadline: t.deadline, priority: t.priority,
      repeat: t.repeat, repeatFromCompletion: t.repeatFromCompletion,
      checklist: t.checklist.map(c => ({ id: uid(), text: c.text, completed: false })),
      reminderTime: t.reminderTime, reminderRepeatMinutes: t.reminderRepeatMinutes,
      reminderLeadMinutes: t.reminderLeadMinutes,
    });
  }

  deleteTaskPermanently(id) {
    delete this.state.tasks[id];
    this.state.order.tasks = this.state.order.tasks.filter(x => x !== id);
    this.save();
  }

  reorderTask(id, beforeId) {
    const arr = this.state.order.tasks;
    const idx = arr.indexOf(id);
    if (idx !== -1) arr.splice(idx, 1);
    if (beforeId) {
      const bIdx = arr.indexOf(beforeId);
      arr.splice(bIdx === -1 ? arr.length : bIdx, 0, id);
    } else {
      arr.push(id);
    }
    this.save();
  }

  // «Сегодня» — это конкретный день, а не вечное свойство задачи. Пока слово
  // хранилось само по себе, задача переезжала вместе с календарём и не могла
  // стать просроченной в принципе. Наутро превращаем её в задачу с той датой,
  // которая тогда и подразумевалась, — дальше она живёт как обычная просроченная.
  rolloverStaleToday() {
    const today = todayStr();
    let moved = 0;
    Object.values(this.state.tasks).forEach(t => {
      if (t.status !== 'active') return;
      if (t.when !== 'today' && t.when !== 'evening') return;
      // У задач, созданных до появления отметки, её нет. Лучшее приближение —
      // день создания: задача, заведённая шестого с пометкой «сегодня», шестым
      // числом и была. Дальше отметка ставится точно, при каждом изменении.
      if (!t.whenSetOn) t.whenSetOn = formatDate(new Date(t.createdAt || Date.now()));
      if (t.whenSetOn >= today) return;
      t.when = t.whenSetOn;
      t.whenSetOn = null;
      // напоминание должно сработать заново на новом месте
      t.notifiedOn = null;
      t.leadNotifiedOn = null;
      moved++;
    });
    if (moved) this.save();
    return moved;
  }

  // Пакетные действия для журнала и корзины. Журнал чистим в корзину, а не
  // насовсем: выполненные задачи — это история, и стирать её одним касанием
  // без пути назад слишком резко. Корзина же и есть последний рубеж.
  clearLogbook() {
    const now = Date.now();
    let n = 0;
    Object.values(this.state.tasks).forEach(t => {
      if (t.status !== 'completed' && t.status !== 'canceled') return;
      t.statusBeforeTrash = t.status;
      t.status = 'trashed';
      t.trashedAt = now;
      n++;
    });
    if (n) this.save();
    return n;
  }

  emptyTrash() {
    const ids = Object.values(this.state.tasks).filter(t => t.status === 'trashed').map(t => t.id);
    ids.forEach(id => { delete this.state.tasks[id]; });
    this.state.order.tasks = this.state.order.tasks.filter(id => !ids.includes(id));
    if (ids.length) this.save();
    return ids.length;
  }

  addChecklistItem(taskId, text) {
    const t = this.state.tasks[taskId];
    if (!t) return;
    t.checklist.push({ id: uid(), text, completed: false });
    this.save();
  }

  toggleChecklistItem(taskId, itemId) {
    const t = this.state.tasks[taskId];
    if (!t) return;
    const item = t.checklist.find(c => c.id === itemId);
    if (item) item.completed = !item.completed;
    this.save();
  }

  updateChecklistItem(taskId, itemId, text) {
    const t = this.state.tasks[taskId];
    if (!t) return;
    const item = t.checklist.find(c => c.id === itemId);
    if (item) item.text = text;
    this.saveQuiet();
  }

  removeChecklistItem(taskId, itemId) {
    const t = this.state.tasks[taskId];
    if (!t) return;
    t.checklist = t.checklist.filter(c => c.id !== itemId);
    this.save();
  }

  toggleTaskTag(taskId, tagId) {
    const t = this.state.tasks[taskId];
    if (!t) return;
    if (t.tags.includes(tagId)) t.tags = t.tags.filter(x => x !== tagId);
    else t.tags.push(tagId);
    this.save();
  }

  // ---------------- Projects ----------------
  createProject({ title, areaId = null } = {}) {
    const id = uid();
    this.state.projects[id] = {
      id, title: title || 'Новый проект', notes: '',
      areaId, when: null, deadline: null,
      status: 'active', createdAt: Date.now(),
    };
    this.save();
    return this.state.projects[id];
  }

  updateProject(id, patch) {
    const p = this.state.projects[id];
    if (!p) return;
    Object.assign(p, patch);
    this.save();
  }

  deleteProject(id) {
    delete this.state.projects[id];
    Object.values(this.state.headings).forEach(h => { if (h.projectId === id) delete this.state.headings[h.id]; });
    Object.values(this.state.tasks).forEach(t => {
      if (t.projectId !== id) return;
      t.projectId = null;
      t.headingId = null;
      // осиротевшая задача без даты и области действительно неразобрана — её место во «Входящих»
      t.inInbox = !t.when && !t.areaId;
    });
    this.save();
  }

  convertTaskToProject(taskId) {
    const t = this.state.tasks[taskId];
    if (!t) return null;
    const project = this.createProject({ title: t.title, areaId: t.areaId });
    project.notes = t.notes;
    t.checklist.forEach(c => {
      const nt = this.createTask({ title: c.text, projectId: project.id, areaId: t.areaId });
      if (c.completed) { nt.status = 'completed'; nt.completedAt = Date.now(); }
    });
    delete this.state.tasks[taskId];
    this.state.order.tasks = this.state.order.tasks.filter(x => x !== taskId);
    this.save();
    return project;
  }

  // ---------------- Headings ----------------
  createHeading({ title, projectId } = {}) {
    const id = uid();
    this.state.headings[id] = { id, title: title || 'Новый раздел', projectId, createdAt: Date.now() };
    this.save();
    return this.state.headings[id];
  }

  updateHeading(id, patch) {
    const h = this.state.headings[id];
    if (!h) return;
    Object.assign(h, patch);
    this.save();
  }

  deleteHeading(id) {
    delete this.state.headings[id];
    Object.values(this.state.tasks).forEach(t => { if (t.headingId === id) t.headingId = null; });
    this.save();
  }

  projectHeadings(projectId) {
    return Object.values(this.state.headings).filter(h => h.projectId === projectId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  headingTasks(headingId) {
    const h = this.state.headings[headingId];
    if (!h) return [];
    // проверяем и проект: иначе задача из другого проекта могла осесть в чужом разделе
    return this.orderedTasks(Object.values(this.state.tasks)
      .filter(t => t.headingId === headingId && t.projectId === h.projectId && t.status === 'active'));
  }

  // ---------------- Areas ----------------
  createArea({ title } = {}) {
    const id = uid();
    this.state.areas[id] = { id, title: title || 'Новая область', createdAt: Date.now() };
    this.save();
    return this.state.areas[id];
  }

  updateArea(id, patch) {
    const a = this.state.areas[id];
    if (!a) return;
    Object.assign(a, patch);
    this.save();
  }

  deleteArea(id) {
    delete this.state.areas[id];
    Object.values(this.state.projects).forEach(p => { if (p.areaId === id) p.areaId = null; });
    Object.values(this.state.tasks).forEach(t => {
      if (t.areaId !== id) return;
      t.areaId = null;
      t.inInbox = !t.when && !t.projectId;
    });
    this.save();
  }

  // ---------------- Tags ----------------
  createTag(title, color = '#4a7dfc') {
    const existing = Object.values(this.state.tags).find(t => t.title.toLowerCase() === title.toLowerCase());
    if (existing) return existing;
    const id = uid();
    this.state.tags[id] = { id, title, color };
    this.save();
    return this.state.tags[id];
  }

  // ---------------- Selectors ----------------
  // Позиции всех задач одной картой: без неё сравнение через indexOf делало
  // сортировку квадратичной и заметно тормозило на сотнях задач.
  orderIndex() {
    if (this._orderIndexStamp !== this._stamp) {
      this._orderIndex = new Map(this.state.order.tasks.map((id, i) => [id, i]));
      this._orderIndexStamp = this._stamp;
    }
    return this._orderIndex;
  }

  orderedTasks(list) {
    const pos = this.orderIndex();
    const last = Number.MAX_SAFE_INTEGER;
    return list.slice().sort((a, b) => {
      const ia = pos.has(a.id) ? pos.get(a.id) : last;
      const ib = pos.has(b.id) ? pos.get(b.id) : last;
      return ia !== ib ? ia - ib : a.createdAt - b.createdAt;
    });
  }

  allActiveTasks() {
    return Object.values(this.state.tasks).filter(t => t.status === 'active');
  }

  inboxTasks() {
    return this.orderedTasks(this.allActiveTasks().filter(t => t.inInbox));
  }

  todayTasks() {
    const today = todayStr();
    return this.orderedTasks(this.allActiveTasks().filter(t => {
      if (t.inInbox) return false;
      if (t.when === 'today' || t.when === 'evening') return true;
      // Просрочка живёт на своём дне, а не сваливается сюда: иначе «Сегодня»
      // превращается в свалку всего несделанного и перестаёт быть планом на день.
      if (t.when === today) return true;
      return false;
    }));
  }

  // Задачи прошедших дней. Сегодняшние сюда не берём: у них своё место
  // в «Сегодня», в группе «Просрочено», и дублировать их незачем.
  overdueTasks() {
    const today = todayStr();
    return this.orderedTasks(this.allActiveTasks().filter(t =>
      !t.inInbox && isDateStr(t.when) && t.when < today));
  }

  upcomingTasks() {
    const today = todayStr();
    return this.orderedTasks(this.allActiveTasks().filter(t => {
      if (t.inInbox) return false;
      return isDateStr(t.when) && t.when > today;
    }));
  }

  somedayTasks() {
    return this.orderedTasks(this.allActiveTasks().filter(t => !t.inInbox && t.when === 'someday'));
  }

  anytimeTasks() {
    return this.orderedTasks(this.allActiveTasks().filter(t => !t.inInbox && !t.when));
  }

  tasksByDate() {
    const today = todayStr();
    const map = {};
    this.allActiveTasks().forEach(t => {
      if (isDateStr(t.when)) (map[t.when] ||= []).push(t);
      // «Сегодня» и «Этим вечером» — это тоже сегодняшнее число, просто хранится
      // словом. Без этой строки счётчик в календаре показывал одну задачу там,
      // где список под ним показывал шесть: он-то считает по tasksOnDate().
      else if (t.when === 'today' || t.when === 'evening') (map[today] ||= []).push(t);
    });
    return map;
  }

  deadlinesByDate() {
    const map = {};
    this.allActiveTasks().forEach(t => {
      if (t.deadline) (map[t.deadline] ||= []).push(t);
    });
    return map;
  }

  tasksOnDate(dateStr) {
    const today = todayStr();
    return this.orderedTasks(this.allActiveTasks().filter(t =>
      t.when === dateStr || t.deadline === dateStr ||
      (dateStr === today && (t.when === 'today' || t.when === 'evening'))
    ));
  }

  logbookTasks() {
    return Object.values(this.state.tasks)
      .filter(t => t.status === 'completed' || t.status === 'canceled')
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  }

  trashTasks() {
    return Object.values(this.state.tasks).filter(t => t.status === 'trashed');
  }

  projectTasks(projectId) {
    return this.orderedTasks(Object.values(this.state.tasks).filter(t => t.projectId === projectId && t.status === 'active'));
  }

  projectTasksNoHeading(projectId) {
    return this.orderedTasks(Object.values(this.state.tasks).filter(t => {
      if (t.projectId !== projectId || t.status !== 'active') return false;
      if (!t.headingId) return true;
      // задача с «повисшим» разделом должна показываться вверху, а не пропадать
      const h = this.state.headings[t.headingId];
      return !h || h.projectId !== projectId;
    }));
  }

  areaDirectTasks(areaId) {
    return this.orderedTasks(Object.values(this.state.tasks).filter(t => t.areaId === areaId && !t.projectId && t.status === 'active'));
  }

  areaProjects(areaId) {
    return Object.values(this.state.projects).filter(p => p.areaId === areaId && p.status === 'active')
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  unfiledProjects() {
    return Object.values(this.state.projects).filter(p => !p.areaId && p.status === 'active')
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  projectOpenCount(projectId) {
    return this.projectTasks(projectId).length;
  }

  projectStats(projectId) {
    const all = Object.values(this.state.tasks).filter(t => t.projectId === projectId && (t.status === 'active' || t.status === 'completed'));
    const completed = all.filter(t => t.status === 'completed').length;
    return { total: all.length, completed };
  }

  areaOpenCount(areaId) {
    const projIds = this.areaProjects(areaId).map(p => p.id);
    return Object.values(this.state.tasks).filter(t =>
      t.status === 'active' && (t.areaId === areaId || projIds.includes(t.projectId))
    ).length;
  }
}

// Варианты предварительного напоминания. По умолчанию его нет — задача пингует
// ровно в назначенное время. Живут здесь, а не в UI: подпись нужна и планировщику
// нативных уведомлений, который про DOM ничего не знает.
export const LEAD_OPTIONS = [
  { value: 5, label: '5 минут' },
  { value: 10, label: '10 минут' },
  { value: 15, label: '15 минут' },
  { value: 30, label: '30 минут' },
  { value: 60, label: '1 час' },
  { value: 120, label: '2 часа' },
  { value: 180, label: '3 часа' },
];

export function formatLead(min) {
  return LEAD_OPTIONS.find(o => o.value === min)?.label || `${min} мин.`;
}

export const store = new Store();
export { uid, todayStr, formatDate, addDays, daysBetween, nextRepeatDate, isDateStr, STORAGE_KEY };
