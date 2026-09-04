const STORAGE_KEY = 'tasksApp.v1';

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
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return Object.assign(defaultState(), parsed);
    } catch (e) {
      console.error('Failed to load state', e);
      return defaultState();
    }
  }

  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
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
  createTask({ title, notes = '', when = null, projectId = null, areaId = null, headingId = null, tags = [], deadline = null, priority = 0, repeat = null, repeatFromCompletion = false } = {}) {
    const id = uid();
    const now = Date.now();
    const task = {
      id, title: title || 'Новая задача', notes,
      checklist: [],
      tags,
      when, // null | 'today' | 'evening' | 'someday' | 'YYYY-MM-DD'
      deadline, // null | 'YYYY-MM-DD'
      priority, // 0 none | 1 low | 2 medium | 3 high
      repeat, // null | 'daily' | 'weekly' | 'monthly'
      repeatFromCompletion, // true: next occurrence counts from completion day, not the scheduled day
      reminderTime: null, // null | 'HH:MM' — fires a notification on the scheduled day
      reminderRepeatMinutes: null, // null | number — re-fire every N minutes after reminderTime, same day
      notifiedOn: null, // 'YYYY-MM-DD' of the last date a reminder notification fired
      lastNotifiedAt: null, // timestamp of the last notification, used to space out repeat reminders
      projectId, areaId, headingId,
      inInbox: !projectId && !areaId && !when,
      status: 'active', // active | completed | canceled | trashed
      createdAt: now,
      completedAt: null,
      order: now,
    };
    this.state.tasks[id] = task;
    this.state.order.tasks.push(id);
    this.save();
    return task;
  }

  updateTask(id, patch) {
    const t = this.state.tasks[id];
    if (!t) return;
    Object.assign(t, patch);
    // clear inbox flag once organized
    if (patch.projectId !== undefined || patch.areaId !== undefined || patch.when !== undefined) {
      if (t.projectId || t.areaId || t.when) t.inInbox = false;
    }
    // heading only makes sense within its own project
    if (patch.projectId !== undefined && t.headingId) {
      const h = this.state.headings[t.headingId];
      if (!h || h.projectId !== t.projectId) t.headingId = null;
    }
    this.save();
  }

  markNotified(id, dateStr) {
    const t = this.state.tasks[id];
    if (!t) return;
    t.notifiedOn = dateStr;
    t.lastNotifiedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }

  dueReminders() {
    const today = todayStr();
    const now = new Date();
    const nowHM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    return this.allActiveTasks().filter(t => {
      if (!t.reminderTime) return false;
      // a reminder without a future-scheduled date (no when, 'today', 'evening', 'someday', or today's date) applies today
      const onToday = !t.when || t.when === 'today' || t.when === 'evening' || t.when === 'someday' || t.when === today;
      if (!onToday) return false;
      if (nowHM < t.reminderTime) return false;
      if (t.notifiedOn !== today) return true; // hasn't fired yet today
      if (!t.reminderRepeatMinutes) return false; // already fired once, no repeat requested
      const elapsedMin = t.lastNotifiedAt ? (Date.now() - t.lastNotifiedAt) / 60000 : Infinity;
      return elapsedMin >= t.reminderRepeatMinutes;
    });
  }

  toggleComplete(id) {
    const t = this.state.tasks[id];
    if (!t) return;
    if (t.status === 'completed') {
      t.status = 'active';
      t.completedAt = null;
    } else {
      t.status = 'completed';
      t.completedAt = Date.now();
      if (t.repeat) {
        const base = (!t.repeatFromCompletion && /^\d{4}-\d{2}-\d{2}$/.test(t.when)) ? t.when : todayStr();
        this.createTask({
          title: t.title, notes: t.notes, when: nextRepeatDate(base, t.repeat),
          projectId: t.projectId, areaId: t.areaId, headingId: t.headingId,
          tags: t.tags.slice(), priority: t.priority, repeat: t.repeat, repeatFromCompletion: t.repeatFromCompletion,
        });
      }
    }
    this.save();
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
    t.status = 'trashed';
    this.save();
  }

  restoreTask(id) {
    const t = this.state.tasks[id];
    if (!t) return;
    t.status = 'active';
    this.save();
  }

  duplicateTask(id) {
    const t = this.state.tasks[id];
    if (!t) return null;
    const copy = this.createTask({
      title: t.title, notes: t.notes, when: t.when, projectId: t.projectId, areaId: t.areaId,
      headingId: t.headingId, tags: t.tags.slice(), deadline: t.deadline, priority: t.priority,
      repeat: t.repeat, repeatFromCompletion: t.repeatFromCompletion,
    });
    copy.checklist = t.checklist.map(c => ({ id: uid(), text: c.text, completed: false }));
    this.save();
    return copy;
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
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
      if (t.projectId === id) { t.projectId = null; t.headingId = null; t.inInbox = false; }
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
    return this.orderedTasks(Object.values(this.state.tasks).filter(t => t.headingId === headingId && t.status === 'active'));
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
    Object.values(this.state.tasks).forEach(t => { if (t.areaId === id) { t.areaId = null; t.inInbox = false; } });
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
  orderedTasks(list) {
    const order = this.state.order.tasks;
    return list.slice().sort((a, b) => {
      const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
      return ia - ib;
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
      if (t.when && /^\d{4}-\d{2}-\d{2}$/.test(t.when) && t.when <= today) return true;
      return false;
    }));
  }

  upcomingTasks() {
    const today = todayStr();
    return this.orderedTasks(this.allActiveTasks().filter(t => {
      if (t.inInbox) return false;
      return t.when && /^\d{4}-\d{2}-\d{2}$/.test(t.when) && t.when > today;
    }));
  }

  somedayTasks() {
    return this.orderedTasks(this.allActiveTasks().filter(t => !t.inInbox && t.when === 'someday'));
  }

  anytimeTasks() {
    return this.orderedTasks(this.allActiveTasks().filter(t => !t.inInbox && !t.when));
  }

  tasksByDate() {
    const map = {};
    this.allActiveTasks().forEach(t => {
      if (t.when && /^\d{4}-\d{2}-\d{2}$/.test(t.when)) (map[t.when] ||= []).push(t);
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
    return this.orderedTasks(Object.values(this.state.tasks).filter(t => t.projectId === projectId && !t.headingId && t.status === 'active'));
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

export const store = new Store();
export { uid, todayStr, formatDate, addDays, nextRepeatDate };
