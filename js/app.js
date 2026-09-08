import { store, todayStr, addDays, formatDate, isDateStr, LEAD_OPTIONS, formatLead } from './store.js?v=15';
import { openDatePicker, openTimePicker, closePicker, isPickerOpen } from './wheelpicker.js?v=15';
import { parseQuickInput, describeWhen } from './nlp.js?v=15';
import { createVoiceInput, speechSupported } from './voice.js?v=15';
import { isNativeApp, initNativeNotifications, requestPermission as requestNativeNotifPermission, hasPermission as hasNativeNotifPermission, scheduleSyncSoon } from './notifications.js?v=15';
import { bindDetailBackSwipe, bindSidebarSwipe, EDGE_ZONE } from './edgeswipe.js?v=15';
import { exportBackup } from './backup.js?v=15';
import { tapLight, tapMedium, tapSuccess } from './haptics.js?v=15';
import { askText, askConfirm } from './dialog.js?v=15';

// ---------------- UI state (not persisted) ----------------
let currentView = { type: 'today' };
let selectedTaskId = null;
let collapsedAreas = new Set();
let searchQuery = '';
let calendarDate = new Date();
let calendarSelectedDay = todayStr();

const LIST_META = {
  inbox: { title: 'Входящие', color: 'var(--accent-inbox)', glyph: '▤' },
  today: { title: 'Сегодня', color: 'var(--accent-today)', glyph: '☀' },
  upcoming: { title: 'Скоро', color: 'var(--accent-upcoming)', glyph: '📅' },
  calendar: { title: 'Календарь', color: 'var(--accent-upcoming)', glyph: '🗓' },
  anytime: { title: 'В любое время', color: 'var(--accent-anytime)', glyph: '≡' },
  someday: { title: 'Когда-нибудь', color: 'var(--accent-someday)', glyph: '🌙' },
  overdue: { title: 'Просрочено', color: 'var(--danger)', glyph: '!' },
  logbook: { title: 'Журнал', color: 'var(--accent-logbook)', glyph: '✓' },
  trash: { title: 'Корзина', color: 'var(--accent-trash)', glyph: '🗑' },
};

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function priorityColor(p) {
  return p === 3 ? 'var(--danger)' : p === 2 ? '#d9822b' : p === 1 ? 'var(--accent)' : 'var(--accent-upcoming)';
}

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const esc = s => (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
}

function isOverdue(dateStr) {
  return isDateStr(dateStr) && dateStr < todayStr();
}

// Просрочка не только по дате: у задачи на сегодня время напоминания тоже
// могло пройти. Раньше задача на 10:00 в полдень выглядела как обычная
// сегодняшняя — единственный признак опоздания подсказывали часы на телефоне.
function isTaskOverdue(task) {
  if (isOverdue(task.when)) return true;
  // Дедлайн тоже мог пройти: задача без даты, но с просроченным сроком сдачи
  // не получала никакой отметки вовсе.
  if (isOverdue(task.deadline)) return true;
  const today = todayStr();
  const onToday = task.when === 'today' || task.when === 'evening' || task.when === today;
  if (!onToday || !task.reminderTime) return false;
  const now = new Date();
  const nowHM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  return task.reminderTime < nowHM;
}

// Переименование проекта/области идёт через contentEditable на <h1>, а не через <input>.
// Без этой проверки Backspace во время переименования отправлял выбранную задачу в корзину.
function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

// На телефоне сайдбар — выдвижная панель поверх списка, после выбора её надо убрать.
// На широких экранах класса просто нет, вызов безвреден.
function closeMobileSidebar() {
  $('#app').classList.remove('sidebar-open');
}

// ---------------- Sidebar ----------------
function renderSidebar() {
  const nav = $('#navLists');
  const counts = {
    inbox: store.inboxTasks().length,
    today: store.todayTasks().length,
    overdue: store.overdueTasks().length,
    upcoming: store.upcomingTasks().length,
    anytime: store.anytimeTasks().length,
    someday: store.somedayTasks().length,
    logbook: 0, // архив выполненного растёт бесконечно — счётчик здесь только шумит
    trash: store.trashTasks().length,
  };
  nav.innerHTML = Object.keys(LIST_META).filter(key =>
    // пустой список просрочки — лишняя строка в меню и лишняя тревога
    key !== 'overdue' || counts.overdue > 0 || currentView.type === 'overdue'
  ).map(key => {
    const meta = LIST_META[key];
    const active = currentView.type === key;
    const count = counts[key];
    return `<div class="nav-item ${active ? 'active' : ''}" data-list="${key}">
      <span class="nav-icon" style="background:${meta.color}">${meta.glyph}</span>
      <span>${meta.title}</span>
      ${count ? `<span class="nav-count">${count}</span>` : ''}
    </div>`;
  }).join('');

  nav.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => {
      currentView = { type: el.dataset.list };
      selectedTaskId = null;
      searchQuery = '';
      $('#searchInput').value = '';
      closeMobileSidebar();
      renderAll();
    });
  });

  const tree = $('#areasTree');
  const areas = Object.values(store.state.areas).sort((a, b) => a.createdAt - b.createdAt);
  const unfiledProjects = store.unfiledProjects();

  let html = '';
  areas.forEach(area => {
    const collapsed = collapsedAreas.has(area.id);
    const projects = store.areaProjects(area.id);
    const openCount = store.areaOpenCount(area.id);
    const activeArea = currentView.type === 'area' && currentView.id === area.id;
    html += `<div class="area-block">
      <div class="tree-item area-header ${activeArea ? 'active' : ''}" data-area="${area.id}">
        <span class="chevron" data-toggle-area="${area.id}" style="width:10px;color:var(--text-tertiary);font-size:10px;">${collapsed ? '▸' : '▾'}</span>
        <span class="area-dot"></span>
        <span class="tree-title" style="flex:1">${esc(area.title)}</span>
        ${openCount ? `<span class="tree-count">${openCount}</span>` : ''}
        <span class="tree-delete" data-delete-area="${area.id}" title="Удалить область">✕</span>
      </div>`;
    if (!collapsed) {
      html += `<div class="project-list">`;
      projects.forEach(p => {
        const activeP = currentView.type === 'project' && currentView.id === p.id;
        const c = store.projectOpenCount(p.id);
        html += `<div class="tree-item project-item ${activeP ? 'active' : ''}" data-project="${p.id}">
          <span class="tree-icon">◆</span>
          <span class="tree-title" style="flex:1">${esc(p.title)}</span>
          ${c ? `<span class="tree-count">${c}</span>` : ''}
          <span class="tree-delete" data-delete-project="${p.id}" title="Удалить проект">✕</span>
        </div>`;
      });
      html += `</div>`;
    }
    html += `</div>`;
  });

  if (unfiledProjects.length) {
    html += `<div class="project-list" style="margin-left:0">`;
    unfiledProjects.forEach(p => {
      const activeP = currentView.type === 'project' && currentView.id === p.id;
      const c = store.projectOpenCount(p.id);
      html += `<div class="tree-item project-item ${activeP ? 'active' : ''}" data-project="${p.id}">
        <span class="tree-icon">◆</span>
        <span class="tree-title" style="flex:1">${esc(p.title)}</span>
        ${c ? `<span class="tree-count">${c}</span>` : ''}
        <span class="tree-delete" data-delete-project="${p.id}" title="Удалить проект">✕</span>
      </div>`;
    });
    html += `</div>`;
  }

  tree.innerHTML = html;

  tree.querySelectorAll('[data-toggle-area]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.toggleArea;
      if (collapsedAreas.has(id)) collapsedAreas.delete(id); else collapsedAreas.add(id);
      renderSidebar();
    });
  });
  tree.querySelectorAll('[data-area]').forEach(el => {
    el.addEventListener('click', () => {
      currentView = { type: 'area', id: el.dataset.area };
      selectedTaskId = null;
      closeMobileSidebar();
      renderAll();
    });
  });
  tree.querySelectorAll('[data-project]').forEach(el => {
    el.addEventListener('click', () => {
      currentView = { type: 'project', id: el.dataset.project };
      selectedTaskId = null;
      closeMobileSidebar();
      renderAll();
    });
  });
  tree.querySelectorAll('[data-delete-area]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = el.dataset.deleteArea;
      const area = store.state.areas[id];
      if (!area) return;
      if (await askConfirm({ title: `Удалить область «${area.title}»?`, message: 'Проекты и задачи в ней не удалятся, а станут неразобранными.', confirmLabel: 'Удалить', danger: true })) {
        store.deleteArea(id);
        if (currentView.type === 'area' && currentView.id === id) currentView = { type: 'today' };
        renderAll();
      }
    });
  });
  tree.querySelectorAll('[data-delete-project]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = el.dataset.deleteProject;
      const project = store.state.projects[id];
      if (!project) return;
      if (await askConfirm({ title: `Удалить проект «${project.title}»?`, message: 'Задачи в нём не удалятся, а станут неразобранными.', confirmLabel: 'Удалить', danger: true })) {
        store.deleteProject(id);
        if (currentView.type === 'project' && currentView.id === id) currentView = { type: 'today' };
        renderAll();
      }
    });
  });
}

// ---------------- Task row ----------------
function taskRowHtml(task, opts = {}) {
  // forDate — день календаря, в списке которого строка показывается. Задача
  // попадает туда либо потому, что на этот день назначена, либо потому, что
  // на него приходится срок сдачи; это разные поводы, и выглядеть они должны
  // по-разному.
  const { showProject = false, forDate = null } = opts;
  const byDeadline = forDate && task.deadline === forDate && task.when !== forDate;
  const tags = (task.tags || []).map(id => store.state.tags[id]).filter(Boolean);
  const checklistDone = task.checklist.filter(c => c.completed).length;
  const project = task.projectId ? store.state.projects[task.projectId] : null;
  const area = task.areaId ? store.state.areas[task.areaId] : null;
  const label = showProject ? (project ? project.title : (area ? area.title : '')) : '';

  let metaBits = [];
  if (label) metaBits.push(`<span class="task-project-label">${esc(label)}</span>`);
  tags.forEach(t => metaBits.push(`<span class="tag-pill" data-tag-filter="${t.id}">${esc(t.title)}</span>`));
  if (task.checklist.length) metaBits.push(`<span class="task-meta-item">☑ ${checklistDone}/${task.checklist.length}</span>`);
  if (task.notes && task.notes.trim()) metaBits.push(`<span class="task-meta-item">✎</span>`);
  // Флажок и «до» обязательны: голая дата в красной плашке читалась как дата
  // самой задачи, и задача на сегодня со вчерашним дедлайном выглядела так,
  // будто она вчерашняя и почему-то попала в сегодняшний список.
  if (byDeadline) {
    // на дне самого срока писать «до этого же числа» незачем — говорим, что это он
    metaBits.push(`<span class="deadline-pill">🏁 срок сдачи</span>`);
    if (isDateStr(task.when)) metaBits.push(`<span class="task-meta-item">назначена ${fmtDate(task.when)}</span>`);
  } else if (task.deadline) {
    const late = isOverdue(task.deadline) ? ' late' : '';
    metaBits.push(`<span class="deadline-pill${late}">🏁 до ${fmtDate(task.deadline)}</span>`);
  }
  if (task.when === 'evening') metaBits.push(`<span class="task-meta-item">🌙 вечер</span>`);
  if (task.reminderTime) metaBits.push(`<span class="task-meta-item" title="${task.reminderLeadMinutes ? 'Предупредит за ' + formatLead(task.reminderLeadMinutes) + '. ' : ''}${task.reminderRepeatMinutes ? 'Повторяется каждые ' + task.reminderRepeatMinutes + ' мин.' : 'Однократное напоминание'}">⏰ ${task.reminderTime}${task.reminderRepeatMinutes ? ' ⟳' : ''}</span>`);
  if (task.repeat) metaBits.push(`<span class="task-meta-item" title="Повторяется">🔁</span>`);
  // «Просрочено» относится к дню, на который задача назначена. На дне её срока
  // сдачи, ещё не наступившем, эта метка выглядела бы бессмыслицей.
  if (!byDeadline && isTaskOverdue(task)) metaBits.push(`<span class="deadline-pill late">просрочено</span>`);

  const cls = ['task-row'];
  if (task.status === 'completed') cls.push('completed');
  if (task.status === 'canceled') cls.push('canceled');
  if (task.id === selectedTaskId) cls.push('selected');

  const quickTrash = task.status !== 'trashed'
    ? `<span class="task-quick-trash" data-quick-trash="${task.id}" title="Удалить в корзину">🗑</span>`
    : '';

  // Подложка обязана показывать то, что жест сделает на самом деле: в журнале
  // свайп вправо не выполняет задачу, а возвращает её в работу, и зелёная
  // галочка там читалась ровно наоборот.
  const done = task.status === 'completed' || task.status === 'canceled';
  const swipeRightGlyph = task.status === 'trashed' || done ? '↺' : '✓';
  const laneClass = task.status === 'trashed' ? 'task-swipe no-trash' : (done ? 'task-swipe restore' : 'task-swipe');

  // Обёртка держит подложку с действиями, которая открывается при свайпе строки
  return `<div class="${laneClass}">
    <div class="swipe-bg swipe-bg-done" aria-hidden="true">${swipeRightGlyph}</div>
    <div class="swipe-bg swipe-bg-trash" aria-hidden="true">🗑</div>
    <div class="${cls.join(' ')}" data-id="${task.id}" data-priority="${task.priority || 0}" draggable="true">
      <div class="checkbox" data-checkbox="${task.id}">
        <svg viewBox="0 0 10 10"><path d="M1 5l3 3 5-6" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="task-main">
        <div class="task-title">${esc(task.title)}</div>
        ${metaBits.length ? `<div class="task-meta">${metaBits.join('')}</div>` : ''}
      </div>
      ${quickTrash}
    </div>
  </div>`;
}

function groupHtml(title) {
  return `<div class="group-heading">${esc(title)}</div>`;
}

function headingHtml(h) {
  return `<div class="heading-row" data-heading-drop="${h.id}">
    <span class="heading-title" data-heading-id="${h.id}">${esc(h.title)}</span>
    <span class="tree-delete" data-delete-heading="${h.id}" title="Удалить раздел">✕</span>
  </div>`;
}

function bindProjectHeadingEvents() {
  const addBtn = $('[data-add-heading]');
  if (addBtn) addBtn.addEventListener('click', async () => {
    const title = await askText({ title: 'Новый раздел', placeholder: 'Название раздела', confirmLabel: 'Создать' });
    if (title && title.trim()) store.createHeading({ title: title.trim(), projectId: addBtn.dataset.addHeading });
  });
  $$('[data-heading-id]').forEach(el => {
    el.addEventListener('dblclick', async () => {
      const h = store.state.headings[el.dataset.headingId];
      if (!h) return;
      const title = await askText({ title: 'Переименовать раздел', value: h.title });
      if (title && title.trim()) store.updateHeading(h.id, { title: title.trim() });
    });
  });
  $$('[data-delete-heading]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (await askConfirm({ title: 'Удалить раздел?', message: 'Задачи останутся в проекте.', confirmLabel: 'Удалить', danger: true })) store.deleteHeading(el.dataset.deleteHeading);
    });
  });
  $$('[data-heading-drop]').forEach(el => {
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const h = store.state.headings[el.dataset.headingDrop];
      // переносим вместе с проектом — раздел чужого проекта иначе «проглатывал» задачу
      if (dragTaskId && h) store.updateTask(dragTaskId, { projectId: h.projectId, headingId: h.id });
      dragTaskId = null;
    });
  });
}

// ---------------- Main panel ----------------
function renderMain() {
  const titleEl = $('#mainTitle');
  const iconEl = $('#mainIcon');
  const subEl = $('#mainSubtitle');
  const listEl = $('#taskList');

  titleEl.contentEditable = 'false';
  titleEl.ondblclick = null;
  titleEl.onblur = null;
  titleEl.onkeydown = null;
  titleEl.title = '';

  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    const results = Object.values(store.state.tasks).filter(t =>
      t.status !== 'trashed' && (t.title.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q))
    );
    titleEl.textContent = 'Поиск';
    iconEl.style.background = 'var(--accent)';
    iconEl.textContent = '🔍';
    subEl.textContent = `${results.length} результатов`;
    listEl.innerHTML = results.length ? results.map(t => taskRowHtml(t, { showProject: true })).join('') : `<div class="empty-state">Ничего не найдено</div>`;
    bindTaskListEvents();
    return;
  }

  let html = '';
  let dateStr = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  if (currentView.type === 'inbox') {
    setHeader('inbox');
    const tasks = store.inboxTasks();
    html = tasks.length ? tasks.map(t => taskRowHtml(t)).join('') : emptyMsg('Входящие пусты', '📥');
  } else if (currentView.type === 'today') {
    setHeader('today', dateStr);
    const all = store.todayTasks();
    const overdue = all.filter(isTaskOverdue);
    // просроченные исключаем из обеих групп, иначе задача покажется дважды
    const today = all.filter(t => t.when !== 'evening' && !isTaskOverdue(t));
    const evening = all.filter(t => t.when === 'evening' && !isTaskOverdue(t));
    if (!all.length) html = emptyMsg('На сегодня ничего не запланировано', '☀️');
    else {
      if (overdue.length) html += groupHtml('Просрочено') + overdue.map(t => taskRowHtml(t, { showProject: true })).join('');
      if (today.length) html += groupHtml('Сегодня') + today.map(t => taskRowHtml(t, { showProject: true })).join('');
      if (evening.length) html += groupHtml('Этим вечером') + evening.map(t => taskRowHtml(t, { showProject: true })).join('');
    }
  } else if (currentView.type === 'calendar') {
    setHeader('calendar');
    subEl.textContent = '';
    html = renderCalendarHtml();
  } else if (currentView.type === 'overdue') {
    setHeader('overdue');
    // от старых к свежим: чем дольше задача висит, тем выше должна быть
    const tasks = store.overdueTasks().sort((a, b) => a.when.localeCompare(b.when));
    if (!tasks.length) html = emptyMsg('Просроченного нет', '👍');
    else {
      let lastDate = null;
      tasks.forEach(t => {
        if (t.when !== lastDate) { html += groupHtml(fmtDate(t.when)); lastDate = t.when; }
        html += taskRowHtml(t, { showProject: true });
      });
    }
  } else if (currentView.type === 'upcoming') {
    setHeader('upcoming');
    const tasks = store.upcomingTasks().sort((a, b) => a.when.localeCompare(b.when));
    if (!tasks.length) html = emptyMsg('Нет запланированных задач', '📅');
    else {
      let lastDate = null;
      tasks.forEach(t => {
        if (t.when !== lastDate) { html += groupHtml(fmtDate(t.when)); lastDate = t.when; }
        html += taskRowHtml(t, { showProject: true });
      });
    }
  } else if (currentView.type === 'anytime') {
    setHeader('anytime');
    html = renderOrganizedList(store.anytimeTasks());
  } else if (currentView.type === 'someday') {
    setHeader('someday');
    html = renderOrganizedList(store.somedayTasks());
  } else if (currentView.type === 'logbook') {
    setHeader('logbook');
    const tasks = store.logbookTasks();
    if (!tasks.length) html = emptyMsg('Журнал пуст', '🗒️');
    else {
      let lastDate = null;
      tasks.forEach(t => {
        // completedAt может отсутствовать у старых/импортированных записей — не показываем «Invalid Date»
        const d = t.completedAt
          ? new Date(t.completedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
          : 'Без даты';
        if (d !== lastDate) { html += groupHtml(d); lastDate = d; }
        html += taskRowHtml(t, { showProject: true });
      });
    }
  } else if (currentView.type === 'trash') {
    setHeader('trash');
    const tasks = store.trashTasks();
    html = tasks.length ? tasks.map(t => taskRowHtml(t, { showProject: true })).join('') : emptyMsg('Корзина пуста', '🗑️');
  } else if (currentView.type === 'project') {
    const p = store.state.projects[currentView.id];
    if (!p) { currentView = { type: 'today' }; return renderMain(); }
    titleEl.textContent = p.title;
    iconEl.style.background = 'var(--accent-anytime)';
    iconEl.textContent = '◆';
    {
      const areaName = p.areaId && store.state.areas[p.areaId] ? store.state.areas[p.areaId].title : '';
      const stats = store.projectStats(p.id);
      const pct = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;
      subEl.innerHTML = (areaName ? esc(areaName) : '') + (stats.total ? `<div class="project-progress"><div class="project-progress-bar"><div class="project-progress-fill" style="width:${pct}%"></div></div><span class="project-progress-text">${stats.completed}/${stats.total}</span></div>` : '');
    }
    makeHeaderRenamable('project', p.id, p.title);
    const noHeadingTasks = store.projectTasksNoHeading(p.id);
    const headings = store.projectHeadings(p.id);
    html += `<div class="add-heading-row"><span class="add-heading-btn" data-add-heading="${p.id}">+ Раздел</span></div>`;
    if (!noHeadingTasks.length && !headings.length) {
      html += emptyMsg('В проекте пока нет задач', '◆');
    } else {
      html += noHeadingTasks.map(t => taskRowHtml(t)).join('');
      headings.forEach(h => {
        const hTasks = store.headingTasks(h.id);
        html += headingHtml(h);
        html += hTasks.length ? hTasks.map(t => taskRowHtml(t)).join('') : `<div class="heading-empty">Пусто — перетащите сюда задачу</div>`;
      });
    }
  } else if (currentView.type === 'area') {
    const a = store.state.areas[currentView.id];
    if (!a) { currentView = { type: 'today' }; return renderMain(); }
    titleEl.textContent = a.title;
    iconEl.style.background = 'var(--accent-anytime)';
    iconEl.textContent = '●';
    subEl.textContent = '';
    makeHeaderRenamable('area', a.id, a.title);
    const projects = store.areaProjects(a.id);
    const direct = store.areaDirectTasks(a.id);
    if (!projects.length && !direct.length) html = emptyMsg('В этой области пока ничего нет', '●');
    else {
      projects.forEach(p => {
        const tasks = store.projectTasks(p.id);
        html += `<div class="project-heading-row" data-project-jump="${p.id}"><span class="tree-icon" style="color:var(--text-secondary)">◆</span>${esc(p.title)}</div>`;
        html += tasks.length ? tasks.map(t => taskRowHtml(t)).join('') : '';
      });
      if (direct.length) {
        html += groupHtml('Без проекта');
        html += direct.map(t => taskRowHtml(t)).join('');
      }
    }
  } else if (currentView.type === 'tag') {
    const tag = store.state.tags[currentView.id];
    titleEl.textContent = tag ? `#${tag.title}` : 'Тег';
    iconEl.style.background = tag ? tag.color : 'var(--accent)';
    iconEl.textContent = '#';
    subEl.textContent = '';
    const tasks = store.allActiveTasks().filter(t => t.tags.includes(currentView.id));
    html = tasks.length ? tasks.map(t => taskRowHtml(t, { showProject: true })).join('') : emptyMsg('Нет задач с этим тегом', '#');
  }

  listEl.innerHTML = html;
  bindTaskListEvents();
  if (currentView.type === 'calendar') bindCalendarEvents();
  if (currentView.type === 'project') bindProjectHeadingEvents();

  function setHeader(key, sub = '') {
    const meta = LIST_META[key];
    titleEl.textContent = meta.title;
    iconEl.style.background = meta.color;
    iconEl.textContent = meta.glyph;
    subEl.textContent = sub;
  }
  function emptyMsg(msg, icon = '✓') { return `<div class="empty-state"><div class="empty-state-icon">${icon}</div>${esc(msg)}</div>`; }

  function makeHeaderRenamable(kind, id, title) {
    titleEl.title = 'Двойной клик — переименовать';
    titleEl.ondblclick = () => {
      titleEl.contentEditable = 'true';
      titleEl.focus();
      const range = document.createRange();
      range.selectNodeContents(titleEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    };
    titleEl.onblur = () => {
      if (titleEl.contentEditable !== 'true') return;
      const val = titleEl.textContent.trim();
      titleEl.contentEditable = 'false';
      if (val && val !== title) {
        if (kind === 'project') store.updateProject(id, { title: val });
        else store.updateArea(id, { title: val });
      } else {
        titleEl.textContent = title;
      }
    };
    titleEl.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
      if (e.key === 'Escape') { titleEl.textContent = title; titleEl.blur(); }
    };
  }
}

function renderOrganizedList(tasks) {
  const unfiled = tasks.filter(t => !t.projectId && !t.areaId);
  const byProject = {};
  const byAreaDirect = {};
  tasks.forEach(t => {
    if (t.projectId) (byProject[t.projectId] ||= []).push(t);
    else if (t.areaId) (byAreaDirect[t.areaId] ||= []).push(t);
  });

  // отмечаем всё, что уже попало в разметку, чтобы ничего не потерялось между ветками
  const rendered = new Set(unfiled.map(t => t.id));

  let html = '';
  if (unfiled.length) {
    html += groupHtml('Без проекта');
    html += unfiled.map(t => taskRowHtml(t)).join('');
  }

  const renderProjectGroup = (p, headingHtmlStr) => {
    html += headingHtmlStr;
    html += byProject[p.id].map(t => { rendered.add(t.id); return taskRowHtml(t); }).join('');
  };

  const areas = Object.values(store.state.areas).sort((a, b) => a.createdAt - b.createdAt);
  areas.forEach(area => {
    const projects = store.areaProjects(area.id).filter(p => byProject[p.id]);
    const direct = byAreaDirect[area.id] || [];
    if (!projects.length && !direct.length) return;
    html += `<div class="project-heading-row"><span class="area-dot"></span>${esc(area.title)}</div>`;
    projects.forEach(p => renderProjectGroup(p, `<div class="group-heading" style="margin-left:8px">${esc(p.title)}</div>`));
    if (direct.length) html += direct.map(t => { rendered.add(t.id); return taskRowHtml(t); }).join('');
  });

  Object.keys(byProject).forEach(pid => {
    const p = store.state.projects[pid];
    if (!p || p.areaId || byProject[pid].every(t => rendered.has(t.id))) return;
    renderProjectGroup(p, `<div class="project-heading-row"><span class="tree-icon" style="color:var(--text-secondary)">◆</span>${esc(p.title)}</div>`);
  });

  // подстраховка: задачи проектов, не попавших ни в одну ветку выше (например,
  // проект в удалённой/неактивной области), раньше молча исчезали из списка
  const leftover = tasks.filter(t => !rendered.has(t.id));
  if (leftover.length) {
    html += groupHtml('Прочее');
    html += leftover.map(t => taskRowHtml(t, { showProject: true })).join('');
  }

  if (!html) html = `<div class="empty-state">Пусто</div>`;
  return html;
}

// ---------------- Calendar ----------------
function renderCalendarHtml() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = (firstOfMonth.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

  const byWhen = store.tasksByDate();
  const byDeadline = store.deadlinesByDate();
  const today = todayStr();

  let cells = '';
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startWeekday + 1;
    let cellDate, dispDay, inMonth = true;
    if (dayNum < 1) { inMonth = false; dispDay = daysInPrevMonth + dayNum; cellDate = formatDate(new Date(year, month - 1, dispDay)); }
    else if (dayNum > daysInMonth) { inMonth = false; dispDay = dayNum - daysInMonth; cellDate = formatDate(new Date(year, month + 1, dispDay)); }
    else { dispDay = dayNum; cellDate = formatDate(new Date(year, month, dayNum)); }

    const items = [...(byWhen[cellDate] || [])];
    (byDeadline[cellDate] || []).forEach(t => { if (!items.find(x => x.id === t.id)) items.push(t); });
    const maxShow = 3;
    const shown = items.slice(0, maxShow);
    const more = items.length - shown.length;
    const isToday = cellDate === today;
    const isSelected = cellDate === calendarSelectedDay;

    cells += `<div class="cal-cell ${inMonth ? '' : 'cal-outside'} ${isToday ? 'cal-today' : ''} ${isSelected ? 'cal-selected' : ''}" data-cal-day="${cellDate}">
      <div class="cal-daynum">${dispDay}</div>
      <div class="cal-events">
        ${shown.map(t => `<div class="cal-event ${t.status === 'completed' ? 'cal-event-done' : ''}" data-cal-task="${t.id}" style="--flag:${priorityColor(t.priority)}">${esc(t.title)}</div>`).join('')}
        ${more > 0 ? `<div class="cal-more">+${more}</div>` : ''}
      </div>
      <!-- На телефоне названия в ячейку не помещаются. Точки там врали: их
           рисовалось не больше трёх, и три задачи выглядели так же, как десять.
           Показываем точное число. Рисуем оба варианта и переключаем в CSS —
           иначе вид зависел бы от ширины на момент отрисовки и ломался при
           повороте экрана. -->
      ${items.length ? `<div class="cal-count ${items.some(t => t.priority === 3) ? 'urgent' : ''}">${items.length}</div>` : '<div class="cal-count empty"></div>'}
    </div>`;
  }

  const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  let dayListHtml = '';
  if (calendarSelectedDay) {
    const tasks = store.tasksOnDate(calendarSelectedDay);
    dayListHtml = `<div class="cal-daylist">
      <div class="group-heading">${fmtDate(calendarSelectedDay)}</div>
      ${tasks.length ? tasks.map(t => taskRowHtml(t, { showProject: true, forDate: calendarSelectedDay })).join('') : `<div class="empty-state" style="margin-top:16px;">Нет задач на этот день</div>`}
    </div>`;
  }

  const anchorYear = new Date().getFullYear();
  const minYear = Math.min(anchorYear - 10, year);
  const maxYear = Math.max(anchorYear + 10, year);
  const yearOptions = [];
  for (let y = minYear; y <= maxYear; y++) yearOptions.push(y);

  return `
    <div class="cal-toolbar">
      <div class="cal-nav-group">
        <button class="cal-nav-btn" id="calPrevYear" title="Предыдущий год">«</button>
        <button class="cal-nav-btn" id="calPrev" title="Предыдущий месяц">‹</button>
      </div>
      <select class="cal-select" id="calMonthSelect" title="Месяц">
        ${MONTH_NAMES.map((m, i) => `<option value="${i}" ${i === month ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
      <select class="cal-select" id="calYearSelect" title="Год">
        ${yearOptions.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('')}
      </select>
      <div class="cal-nav-group">
        <button class="cal-nav-btn" id="calNext" title="Следующий месяц">›</button>
        <button class="cal-nav-btn" id="calNextYear" title="Следующий год">»</button>
      </div>
      <button class="cal-nav-btn cal-today-btn" id="calToday">Сегодня</button>
    </div>
    <div class="cal-grid">
      ${weekDays.map(w => `<div class="cal-weekday">${w}</div>`).join('')}
      ${cells}
    </div>
    ${dayListHtml}
  `;
}

function bindCalendarEvents() {
  const prev = $('#calPrev'), next = $('#calNext'), todayBtn = $('#calToday');
  const prevYear = $('#calPrevYear'), nextYear = $('#calNextYear');
  const monthSelect = $('#calMonthSelect'), yearSelect = $('#calYearSelect');
  if (!prev) return;
  prev.addEventListener('click', () => { calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1); renderMain(); });
  next.addEventListener('click', () => { calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1); renderMain(); });
  prevYear.addEventListener('click', () => { calendarDate = new Date(calendarDate.getFullYear() - 1, calendarDate.getMonth(), 1); renderMain(); });
  nextYear.addEventListener('click', () => { calendarDate = new Date(calendarDate.getFullYear() + 1, calendarDate.getMonth(), 1); renderMain(); });
  monthSelect.addEventListener('change', (e) => { calendarDate = new Date(calendarDate.getFullYear(), Number(e.target.value), 1); renderMain(); });
  yearSelect.addEventListener('change', (e) => { calendarDate = new Date(Number(e.target.value), calendarDate.getMonth(), 1); renderMain(); });
  todayBtn.addEventListener('click', () => { calendarDate = new Date(); calendarSelectedDay = todayStr(); renderMain(); });
  $$('.cal-cell').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-cal-task]')) return;
      calendarSelectedDay = el.dataset.calDay === calendarSelectedDay ? null : el.dataset.calDay;
      renderMain();
    });
  });
  $$('.cal-event').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedTaskId = el.dataset.calTask;
      renderAll(); // renderDetail() в одиночку не обновлял подсветку выбранной задачи
    });
  });
}

let dragTaskId = null;
function bindTaskListEvents() {
  const listEl = $('#taskList');
  listEl.querySelectorAll('[data-checkbox]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasActive = store.state.tasks[el.dataset.checkbox]?.status === 'active';
      store.toggleComplete(el.dataset.checkbox);
      // закрытие задачи ощущается иначе, чем снятие галочки — и должно
      if (wasActive) tapSuccess(); else tapLight();
    });
  });
  listEl.querySelectorAll('[data-tag-filter]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      currentView = { type: 'tag', id: el.dataset.tagFilter };
      renderAll();
    });
  });
  listEl.querySelectorAll('[data-quick-trash]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.quickTrash;
      store.trashTask(id);
      if (selectedTaskId === id) selectedTaskId = null;
      showToast('Задача удалена', () => store.restoreTask(id));
    });
  });
  listEl.querySelectorAll('.task-row').forEach(el => {
    el.addEventListener('click', () => {
      // меню уже открыто удержанием — тот же тап не должен ещё и проваливать в карточку
      if (!$('#taskContextMenu').hidden) return;
      selectedTaskId = el.dataset.id;
      renderAll();
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      selectedTaskId = el.dataset.id;
      renderAll();
      openContextMenu(el.dataset.id, e.clientX, e.clientY);
    });
    el.addEventListener('dragstart', () => { dragTaskId = el.dataset.id; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); });
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => { el.classList.remove('drag-over'); });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      if (dragTaskId && dragTaskId !== el.dataset.id) {
        store.reorderTask(dragTaskId, el.dataset.id);
      }
      dragTaskId = null;
    });
    bindSwipe(el);
  });
}

// ---------------- Свайпы по строке задачи ----------------
// На телефоне удалить задачу было нельзя вовсе: корзина показывалась только по
// :hover, а долгое нажатие открывает контекстное меню не во всех браузерах.
// Влево — в корзину, вправо — выполнить.
const SWIPE_TRIGGER = 72;   // px, после которых действие срабатывает
const SWIPE_MAX = 110;

function bindSwipe(row) {
  const lane = row.parentElement;            // .task-swipe — на нём живёт подложка
  if (!lane || !lane.classList.contains('task-swipe')) return;
  let startX = 0, startY = 0, dx = 0;
  let tracking = false, decided = false, horizontal = false;
  let pressTimer = null;
  const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };

  const reset = (animate = true) => {
    row.style.transition = animate ? 'transform 0.18s ease' : '';
    row.style.transform = '';
    row.classList.remove('swiping');
    lane.classList.remove('swiping', 'at-done', 'at-trash');
    if (animate) setTimeout(() => { row.style.transition = ''; }, 200);
  };

  row.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    // у самого края экрана приоритет за жестом «назад»: иначе строка уезжает
    // вбок вместо того, чтобы выдвинуть меню
    if (e.touches[0].clientX <= EDGE_ZONE) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dx = 0;
    tracking = true; decided = false; horizontal = false;
    row.style.transition = '';

    // Долгое нажатие открывает то же меню, что правый клик на настольном
    // экране: без него быстрые действия на телефоне были недоступны вовсе.
    cancelPress();
    pressTimer = setTimeout(() => {
      pressTimer = null;
      tracking = false;
      reset(false);
      tapMedium();
      openContextMenu(row.dataset.id, startX, startY);
    }, 480);
  }, { passive: true });

  row.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const t = e.touches[0];
    const ddx = t.clientX - startX;
    const ddy = t.clientY - startY;

    // Направление определяем один раз: иначе строка ползёт при обычной
    // вертикальной прокрутке списка.
    if (Math.abs(ddx) > 6 || Math.abs(ddy) > 6) cancelPress();

    if (!decided) {
      if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
      decided = true;
      horizontal = Math.abs(ddx) > Math.abs(ddy) * 1.4;
      if (horizontal) { row.classList.add('swiping'); lane.classList.add('swiping'); }
    }
    if (!horizontal) { tracking = false; return; }

    e.preventDefault();               // забираем жест у прокрутки страницы
    dx = Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, ddx));
    row.style.transform = `translateX(${dx}px)`;
    lane.classList.toggle('at-done', dx >= SWIPE_TRIGGER);
    lane.classList.toggle('at-trash', dx <= -SWIPE_TRIGGER);
  }, { passive: false });

  const finish = () => {
    cancelPress();
    if (!tracking || !horizontal) { tracking = false; return; }
    tracking = false;
    const id = row.dataset.id;
    const task = store.state.tasks[id];
    const trashed = task?.status === 'trashed';
    const done = task?.status === 'completed' || task?.status === 'canceled';

    // В корзине смахивать влево некуда — задача уже там. Удаление навсегда
    // оставлено меню строки: слишком необратимо для мимолётного жеста.
    if (dx <= -SWIPE_TRIGGER && !trashed) {
      reset(false);
      tapMedium();
      store.trashTask(id);
      if (selectedTaskId === id) selectedTaskId = null;
      showToast('Задача удалена', () => store.restoreTask(id));
    } else if (dx >= SWIPE_TRIGGER) {
      reset(false);
      if (trashed) {
        // toggleComplete здесь ставила удалённой задаче статус «выполнена»,
        // и она уезжала из корзины в журнал
        store.restoreTask(id);
        tapLight();
        showToast('Задача восстановлена');
      } else if (done) {
        store.toggleComplete(id);
        tapLight();
        showToast('Возвращена в работу');
      } else {
        store.toggleComplete(id);
        tapSuccess();
      }
    } else {
      reset(true);
    }
  };
  row.addEventListener('touchend', finish);
  row.addEventListener('touchcancel', () => { cancelPress(); tracking = false; reset(true); });
}

// ---------------- Detail panel ----------------
// Кнопка-поле вместо <input type="date"> и пары <select>: на телефоне нативные
// контролы мелкие и выглядят по-разному в каждом браузере, а барабан — привычный жест.
function dateFieldHtml(id, value, placeholder, icon = '📅') {
  const label = value
    ? (isDateStr(value) ? fmtDate(value) : value)
    : placeholder;
  return `<button type="button" class="date-field ${value ? '' : 'empty'}" id="${id}" data-value="${esc(value || '')}">
    <span>${icon} ${esc(label)}</span>
    ${value ? `<span class="date-field-clear" data-clear="${id}" title="Очистить">✕</span>` : ''}
  </button>`;
}

// Общая обвязка поля-кнопки: открытие барабана и крестик «очистить».
function bindDateField(sel, { kind = 'date', title, allowClear = false, clearLabel, min, onPick }) {
  const el = $(sel);
  if (!el) return;
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-clear]')) {   // крестик не должен открывать барабан
      e.stopPropagation();
      onPick(null);
      return;
    }
    const open = kind === 'time' ? openTimePicker : openDatePicker;
    open({ value: el.dataset.value || null, title, allowClear, clearLabel, onPick, min: min?.() });
  });
}

function syncRowTitle(taskId, title) {
  $$(`.task-row[data-id="${taskId}"] .task-title`).forEach(el => { el.textContent = title; });
}

function renderDetail() {
  const panel = $('#detailPanel');
  const task = selectedTaskId ? store.state.tasks[selectedTaskId] : null;
  $('#app').classList.toggle('detail-open', !!task);
  if (!task) {
    // раньше панель просто очищалась и заглушка из index.html пропадала навсегда
    panel.innerHTML = `<div class="detail-empty" id="detailEmpty"><p>Выберите задачу</p></div>`;
    return;
  }

  const projectOptions = `<option value="">— нет —</option>` + Object.values(store.state.projects)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(p => `<option value="${p.id}" ${task.projectId === p.id ? 'selected' : ''}>${esc(p.title)}</option>`).join('');

  const areaOptions = `<option value="">— нет —</option>` + Object.values(store.state.areas)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(a => `<option value="${a.id}" ${task.areaId === a.id && !task.projectId ? 'selected' : ''}>${esc(a.title)}</option>`).join('');

  const whenValue = isDateStr(task.when) ? 'date' : (task.when || '');
  const taskHeadings = task.projectId ? store.projectHeadings(task.projectId) : [];

  panel.innerHTML = `
    <div class="detail-panel-header">
      <!-- На телефоне это отдельный экран, и уместна кнопка возврата;
           в боковой колонке на большом экране — привычный крестик.
           Разводятся стилями, обработчик один. -->
      <button class="detail-back-btn" id="detBack">
        <svg viewBox="0 0 12 20" width="11" height="17" aria-hidden="true"><path d="M10 1L2 10l8 9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Назад
      </button>
      <button class="detail-close-btn" id="detClose" title="Закрыть (Esc)">✕</button>
    </div>
    <div class="detail-head-card">
      <textarea class="detail-title-input" id="detTitle" rows="1">${esc(task.title)}</textarea>
      <textarea class="detail-notes-input" id="detNotes" placeholder="Заметки">${esc(task.notes)}</textarea>
    </div>

    <div class="detail-section">
      <div class="detail-label">Когда</div>
      <select class="detail-select" id="detWhen">
        <option value="" ${whenValue === '' ? 'selected' : ''}>Без даты (в любое время)</option>
        <option value="today" ${whenValue === 'today' ? 'selected' : ''}>Сегодня</option>
        <option value="evening" ${whenValue === 'evening' ? 'selected' : ''}>Этим вечером</option>
        <option value="date" ${whenValue === 'date' ? 'selected' : ''}>Дата…</option>
        <option value="someday" ${whenValue === 'someday' ? 'selected' : ''}>Когда-нибудь</option>
      </select>
      <div id="detWhenDateWrap" style="margin-top:6px; ${whenValue === 'date' ? '' : 'display:none'}">
        ${dateFieldHtml('detWhenDate', whenValue === 'date' ? task.when : null, 'Выбрать дату')}
      </div>
      <div id="detReminderWrap" style="margin-top:6px;">
        <div class="detail-label" style="margin-top:8px;">Напоминание</div>
        ${dateFieldHtml('detReminderTime', task.reminderTime, 'Без напоминания', '⏰')}
        <select class="detail-select" id="detReminderLead" style="margin-top:6px; ${task.reminderTime ? '' : 'display:none'}">
          <option value="" ${!task.reminderLeadMinutes ? 'selected' : ''}>Напомнить вовремя</option>
          ${leadOptionsFor(task.reminderLeadMinutes).map(o => `<option value="${o.value}" ${task.reminderLeadMinutes === o.value ? 'selected' : ''}>Напомнить за ${o.label}</option>`).join('')}
        </select>
        <select class="detail-select" id="detReminderRepeat" style="margin-top:6px; ${task.reminderTime ? '' : 'display:none'}">
          <option value="" ${!task.reminderRepeatMinutes ? 'selected' : ''}>Не повторять</option>
          <option value="15" ${task.reminderRepeatMinutes === 15 ? 'selected' : ''}>Каждые 15 минут</option>
          <option value="30" ${task.reminderRepeatMinutes === 30 ? 'selected' : ''}>Каждые 30 минут</option>
          <option value="60" ${task.reminderRepeatMinutes === 60 ? 'selected' : ''}>Каждый час</option>
          <option value="120" ${task.reminderRepeatMinutes === 120 ? 'selected' : ''}>Каждые 2 часа</option>
          <option value="240" ${task.reminderRepeatMinutes === 240 ? 'selected' : ''}>Каждые 4 часа</option>
        </select>
      </div>

      <div class="detail-label detail-label-sub">Дедлайн</div>
      ${dateFieldHtml('detDeadline', task.deadline, 'Без дедлайна', '🏁')}

      <div class="detail-label detail-label-sub">Повтор</div>
      <select class="detail-select" id="detRepeat">
        <option value="" ${!task.repeat ? 'selected' : ''}>Не повторяется</option>
        <option value="daily" ${task.repeat === 'daily' ? 'selected' : ''}>Каждый день</option>
        <option value="weekly" ${task.repeat === 'weekly' ? 'selected' : ''}>Каждую неделю</option>
        <option value="monthly" ${task.repeat === 'monthly' ? 'selected' : ''}>Каждый месяц</option>
      </select>
      <label class="detail-checkbox-row" id="detRepeatFromCompletionWrap" style="${task.repeat ? '' : 'display:none'}">
        <input type="checkbox" id="detRepeatFromCompletion" ${task.repeatFromCompletion ? 'checked' : ''}>
        <span>Считать от даты выполнения, а не по календарю</span>
      </label>
    </div>

    <div class="detail-section">
      <div class="detail-label">Приоритет</div>
      <div class="priority-picker" id="detPriority">
        <span class="priority-opt ${!task.priority ? 'active' : ''}" data-priority="0">Нет</span>
        <span class="priority-opt p1 ${task.priority === 1 ? 'active' : ''}" data-priority="1">Низкий</span>
        <span class="priority-opt p2 ${task.priority === 2 ? 'active' : ''}" data-priority="2">Средний</span>
        <span class="priority-opt p3 ${task.priority === 3 ? 'active' : ''}" data-priority="3">Высокий</span>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-label">Проект</div>
      <select class="detail-select" id="detProject">${projectOptions}</select>

      ${taskHeadings.length ? `
      <div class="detail-label detail-label-sub">Раздел</div>
      <select class="detail-select" id="detHeading">
        <option value="">— нет —</option>
        ${taskHeadings.map(h => `<option value="${h.id}" ${task.headingId === h.id ? 'selected' : ''}>${esc(h.title)}</option>`).join('')}
      </select>` : ''}

      <div class="detail-label detail-label-sub">Область</div>
      <select class="detail-select" id="detArea" ${task.projectId ? 'disabled' : ''}>${areaOptions}</select>
    </div>

    <div class="detail-section">
      <div class="detail-label">Чек-лист</div>
      <div id="detChecklist">
        ${task.checklist.map(c => `
          <div class="checklist-item ${c.completed ? 'completed' : ''}">
            <div class="checkbox" data-cl-toggle="${c.id}" style="width:14px;height:14px;">
              <svg viewBox="0 0 10 10"><path d="M1 5l3 3 5-6" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <input type="text" value="${esc(c.text)}" data-cl-text="${c.id}">
            <span data-cl-remove="${c.id}" style="cursor:pointer;color:var(--text-tertiary);padding:0 4px;">✕</span>
          </div>`).join('')}
      </div>
      <button class="checklist-add-btn" id="detChecklistAdd">+ Добавить пункт</button>
    </div>

    <div class="detail-section">
      <div class="detail-label">Теги</div>
      <div class="tag-picker" id="detTags">
        ${Object.values(store.state.tags).map(t => `<span class="tag-pill selectable ${task.tags.includes(t.id) ? 'active' : ''}" data-tag-toggle="${t.id}">${esc(t.title)}</span>`).join('')}
        <input type="text" class="tag-input-inline" id="detTagNew" placeholder="+ тег">
      </div>
    </div>

    <div class="detail-actions">
      ${task.status !== 'trashed' ? `<button class="detail-btn" id="detConvertProject">Сделать проектом</button>` : ''}
      <button class="detail-btn" id="detCancelToggle">${task.status === 'canceled' ? 'Вернуть в активные' : 'Отменить задачу'}</button>
      <button class="detail-btn danger" id="detTrash">${task.status === 'trashed' ? 'Восстановить' : 'Удалить в корзину'}</button>
      ${task.status === 'trashed' ? `<button class="detail-btn danger" id="detDeleteForever">Удалить навсегда</button>` : ''}
    </div>
  `;

  const closeDetail = () => { selectedTaskId = null; renderAll(); };
  $('#detClose').addEventListener('click', closeDetail);
  $('#detBack').addEventListener('click', closeDetail);

  autoGrow($('#detTitle'));
  $('#detTitle').addEventListener('input', (e) => {
    task.title = e.target.value;
    store.saveQuiet();
    syncRowTitle(task.id, e.target.value);
    autoGrow(e.target);
  });
  $('#detTitle').addEventListener('blur', commitInlineEdit);
  $('#detNotes').addEventListener('input', (e) => {
    task.notes = e.target.value;
    store.saveQuiet();
  });
  $('#detNotes').addEventListener('blur', commitInlineEdit);

  $('#detWhen').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === 'date') {
      // сначала фиксируем дату, потом открываем барабан: если его закрыть по «Отмена»,
      // состояние всё равно остаётся согласованным с выбранным пунктом списка
      const start = isDateStr(task.when) ? task.when : todayStr();
      store.updateTask(task.id, { when: start, notifiedOn: null });
      openDatePicker({
        value: start,
        title: 'Когда',
        onPick: (d) => d && store.updateTask(task.id, { when: d, notifiedOn: null }),
      });
    } else {
      $('#detWhenDateWrap').style.display = 'none';
      store.updateTask(task.id, { when: v || null, notifiedOn: null });
    }
  });
  bindDateField('#detWhenDate', {
    title: 'Когда',
    onPick: (d) => store.updateTask(task.id, { when: d || todayStr(), notifiedOn: null }),
  });
  bindDateField('#detDeadline', {
    title: 'Дедлайн',
    allowClear: true,
    clearLabel: 'Убрать дедлайн',
    // Срок сдачи не может быть раньше дня, на который задача назначена:
    // «сделать десятого, сдать до восьмого» — противоречие.
    min: () => {
      const t = store.state.tasks[task.id];
      if (!t) return null;
      if (isDateStr(t.when)) return t.when;
      return (t.when === 'today' || t.when === 'evening') ? todayStr() : null;
    },
    onPick: (d) => store.updateTask(task.id, { deadline: d }),
  });
  bindDateField('#detReminderTime', {
    kind: 'time',
    title: 'Напоминание',
    allowClear: true,
    // снятие времени убирает и повтор, и предварительное — они без него бессмысленны
    onPick: (t) => store.updateTask(task.id, t
      ? { reminderTime: t, notifiedOn: null, lastNotifiedAt: null, leadNotifiedOn: null }
      : { reminderTime: null, reminderRepeatMinutes: null, reminderLeadMinutes: null,
          notifiedOn: null, lastNotifiedAt: null, leadNotifiedOn: null }),
  });
  const reminderRepeatInput = $('#detReminderRepeat');
  if (reminderRepeatInput) reminderRepeatInput.addEventListener('change', (e) => {
    store.updateTask(task.id, { reminderRepeatMinutes: e.target.value ? Number(e.target.value) : null });
  });
  const reminderLeadInput = $('#detReminderLead');
  if (reminderLeadInput) reminderLeadInput.addEventListener('change', (e) => {
    store.updateTask(task.id, {
      reminderLeadMinutes: e.target.value ? Number(e.target.value) : null,
      leadNotifiedOn: null, // сменили отступ — предварительное должно сработать заново
    });
  });
  $('#detRepeat').addEventListener('change', (e) => {
    const wrap = $('#detRepeatFromCompletionWrap');
    if (wrap) wrap.style.display = e.target.value ? '' : 'none';
    store.updateTask(task.id, { repeat: e.target.value || null });
  });
  const repeatFromCompletionInput = $('#detRepeatFromCompletion');
  if (repeatFromCompletionInput) repeatFromCompletionInput.addEventListener('change', (e) => {
    store.updateTask(task.id, { repeatFromCompletion: e.target.checked });
  });
  panel.querySelectorAll('#detPriority [data-priority]').forEach(el => {
    el.addEventListener('click', () => store.updateTask(task.id, { priority: Number(el.dataset.priority) }));
  });
  $('#detProject').addEventListener('change', (e) => {
    const projectId = e.target.value || null;
    const project = projectId ? store.state.projects[projectId] : null;
    store.updateTask(task.id, { projectId, areaId: project ? project.areaId : task.areaId, headingId: null });
  });
  $('#detArea').addEventListener('change', (e) => {
    store.updateTask(task.id, { areaId: e.target.value || null });
  });
  const detHeading = $('#detHeading');
  if (detHeading) detHeading.addEventListener('change', (e) => {
    store.updateTask(task.id, { headingId: e.target.value || null });
  });
  const convertBtn = $('#detConvertProject');
  if (convertBtn) convertBtn.addEventListener('click', async () => {
    if (await askConfirm({ title: 'Сделать проектом?', message: 'Пункты чек-листа станут отдельными задачами нового проекта.', confirmLabel: 'Превратить' })) {
      const project = store.convertTaskToProject(task.id);
      selectedTaskId = null;
      currentView = { type: 'project', id: project.id };
      renderAll();
    }
  });

  $('#detChecklistAdd').addEventListener('click', async () => {
    const text = await askText({ title: 'Новый пункт', placeholder: 'Что нужно сделать', confirmLabel: 'Добавить' });
    if (text && text.trim()) store.addChecklistItem(task.id, text.trim());
  });
  panel.querySelectorAll('[data-cl-toggle]').forEach(el => {
    el.addEventListener('click', () => store.toggleChecklistItem(task.id, el.dataset.clToggle));
  });
  panel.querySelectorAll('[data-cl-remove]').forEach(el => {
    el.addEventListener('click', () => store.removeChecklistItem(task.id, el.dataset.clRemove));
  });
  panel.querySelectorAll('[data-cl-text]').forEach(el => {
    el.addEventListener('input', (e) => store.updateChecklistItem(task.id, el.dataset.clText, e.target.value));
    el.addEventListener('blur', commitInlineEdit);
  });

  panel.querySelectorAll('[data-tag-toggle]').forEach(el => {
    el.addEventListener('click', () => store.toggleTaskTag(task.id, el.dataset.tagToggle));
  });
  $('#detTagNew').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      const tag = store.createTag(e.target.value.trim());
      store.toggleTaskTag(task.id, tag.id);
      e.target.value = '';
    }
  });

  $('#detCancelToggle').addEventListener('click', () => store.toggleCancel(task.id));
  $('#detTrash').addEventListener('click', () => {
    if (task.status === 'trashed') store.restoreTask(task.id);
    else {
      const id = task.id;
      store.trashTask(id);
      selectedTaskId = null;
      showToast('Задача удалена', () => store.restoreTask(id));
    }
  });
  const delForever = $('#detDeleteForever');
  if (delForever) delForever.addEventListener('click', async () => {
    if (await askConfirm({ title: 'Удалить навсегда?', message: 'Отменить это будет нельзя.', confirmLabel: 'Удалить', danger: true })) {
      store.deleteTaskPermanently(task.id);
      selectedTaskId = null;
      renderAll();
    }
  });
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// Текст полей панели уже записан посимвольно через saveQuiet(). Полный store.save()
// здесь вызвал бы emit() → renderDetail(), а тот перестраивает innerHTML панели и
// выбрасывает фокус при переходе между полями. Поэтому обновляем только сайдбар и список.
function commitInlineEdit() {
  store.saveQuiet();
  // saveQuiet не оповещает подписчиков — иначе перерисовка забирала бы фокус
  // на каждой букве. Но на этом оповещении висит пересборка уведомлений, и без
  // явного вызова в напоминании навсегда оставалось прежнее название задачи.
  scheduleSyncSoon();
  renderSidebar();
  renderMain();
}

// Готовые варианты плюс уже сохранённый у задачи, если он из них выпадает —
// иначе продиктованное «за 20 минут» пропадало бы при открытии карточки.
function leadOptionsFor(value) {
  const opts = LEAD_OPTIONS.slice();
  if (value && !opts.some(o => o.value === value)) {
    opts.push({ value, label: formatLead(value) });
    opts.sort((a, b) => a.value - b.value);
  }
  return opts;
}

// ---------------- Quick Add ----------------

// Клавиатура на iOS не сжимает раскладочный вьюпорт: окно быстрого добавления
// прижато к низу экрана и уезжало под клавиатуру вместе с чипами дат и кнопкой
// «Добавить». visualViewport знает настоящую видимую высоту — приподнимаем окно
// ровно на закрытую часть. Работает и в браузере, и в приложении.
function bindKeyboardInset() {
  const vv = window.visualViewport;
  if (!vv) return;
  const apply = () => {
    const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--keyboard-inset', `${Math.round(hidden)}px`);
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  apply();
}


function populateQuickAddProjects() {
  const sel = $('#quickAddProject');
  const opts = ['<option value="">Входящие</option>'];
  Object.values(store.state.areas).sort((a, b) => a.createdAt - b.createdAt).forEach(area => {
    store.areaProjects(area.id).forEach(p => opts.push(`<option value="${p.id}">${esc(area.title)} / ${esc(p.title)}</option>`));
  });
  store.unfiledProjects().forEach(p => opts.push(`<option value="${p.id}">${esc(p.title)}</option>`));
  sel.innerHTML = opts.join('');
}

// Ручной выбор даты (селект или чип) перебивает распознанное из текста:
// пользователь, ткнувший «Завтра», не должен получить другую дату из-за слова в названии.
let quickAddWhenTouched = false;
let quickAddParsed = null;
let quickAddDefaultWhen = '';

// ---------------- Голосовой ввод в быстром добавлении ----------------
// Промежуточный результат показываем прямо в поле, но поверх текста, набранного
// до нажатия на микрофон: иначе повторная диктовка затирала бы уже введённое.
let voiceBaseText = '';
let voiceInput = null;

function setVoiceStatus(msg, kind = '') {
  const el = $('#quickAddVoiceStatus');
  el.textContent = msg || '';
  el.className = 'voice-status' + (kind ? ' ' + kind : '');
  el.hidden = !msg;
}

function applyVoiceText(chunk, isFinal) {
  const merged = voiceBaseText ? `${voiceBaseText} ${chunk}` : chunk;
  $('#quickAddTitle').value = merged;
  if (isFinal) {
    voiceBaseText = merged;
    // после финального куска разбираем строку — так время из «в 13:30» попадает в поля
    renderQuickAddParse();
  }
}

function initVoiceInput() {
  if (voiceInput || !speechSupported()) return;
  // свернули приложение во время диктовки — сеанс надо оборвать,
  // иначе микрофон остаётся захваченным в фоне
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopVoiceInput();
  });
  voiceInput = createVoiceInput({
    onInterim: (t) => applyVoiceText(t, false),
    onFinal: (t) => applyVoiceText(t, true),
    onState: (active) => {
      $('#btnQuickAddMic').classList.toggle('recording', active);
      if (active) {
        voiceBaseText = $('#quickAddTitle').value.trim();
        setVoiceStatus('Слушаю… говорите, например «встретить брата в 13:30»');
      } else if (!$('#quickAddVoiceStatus').classList.contains('error')) {
        setVoiceStatus('');
        $('#quickAddTitle').focus();
      }
    },
    onError: (msg) => setVoiceStatus(msg, 'error'),
  });
  $('#btnQuickAddMic').hidden = false;
}

function stopVoiceInput() {
  // именно cancel: stop() ждёт, пока распознавание доучтёт услышанное,
  // и всё это время микрофон остаётся занятым
  voiceInput?.cancel();
  setVoiceStatus('');
  $('#btnQuickAddMic').classList.remove('recording');
}

function openQuickAdd() {
  closePalette();
  closePicker();
  closeMobileSidebar();
  populateQuickAddProjects();
  $('#quickAddTitle').value = '';
  $('#quickAddNotes').value = '';
  // В календаре выбранный день виден прямо на экране — логично, чтобы новая
  // задача попадала именно на него, а не оказывалась без даты.
  quickAddDefaultWhen = currentView.type === 'today' ? 'today'
    : currentView.type === 'someday' ? 'someday'
    : (currentView.type === 'calendar' && isDateStr(calendarSelectedDay)) ? calendarSelectedDay
    : '';
  // конкретную дату селект не примет — её выставит renderQuickAddParse ниже
  $('#quickAddWhen').value = isDateStr(quickAddDefaultWhen) ? 'date' : quickAddDefaultWhen;
  // Значение селекта по умолчанию — это не «выбор пользователя»: набранное «завтра»
  // должно его перебивать. Флаг взводится только от реального касания.
  quickAddWhenTouched = false;
  quickAddParsed = null;
  setQuickAddDate(null);
  $('#quickAddLead').value = '';
  $('#quickAddLead').hidden = true;
  $('#quickAddWhenDate').hidden = true;
  if (currentView.type === 'project') $('#quickAddProject').value = currentView.id;
  initVoiceInput();
  stopVoiceInput();
  voiceBaseText = '';
  renderQuickAddParse();
  $('#quickAddOverlay').classList.add('open');
  setTimeout(() => $('#quickAddTitle').focus(), 30);
}

// Показываем разобранное явно — иначе непонятно, почему из названия пропали слова
function renderQuickAddParse() {
  const raw = $('#quickAddTitle').value;
  quickAddParsed = parseQuickInput(raw);

  // Селект и поле даты подтягиваем к распознанному: иначе чипс показывал «Завтра»,
  // а список под ним — «Сегодня», и было неясно, что в итоге сохранится.
  if (!quickAddWhenTouched) {
    const w = quickAddParsed.when;
    const sel = $('#quickAddWhen');
    // распознанное из текста важнее подставленного по умолчанию:
    // набранное «завтра» перебивает день, выбранный в календаре
    const fallback = w || quickAddDefaultWhen;
    if (isDateStr(fallback)) {
      sel.value = 'date';
      setQuickAddDate(fallback);
      $('#quickAddWhenDate').hidden = false;
    } else {
      sel.value = fallback;
      setQuickAddDate(null);
      $('#quickAddWhenDate').hidden = true;
    }
    syncQuickChipState();
  }
  syncQuickAddDateSlot();

  // «Напомнить за» имеет смысл только при заданном времени — иначе не от чего отсчитывать
  const leadSel = $('#quickAddLead');
  leadSel.hidden = !quickAddParsed.time;
  if (quickAddParsed.time) {
    // Сказанное вслух не обязано совпадать с готовыми вариантами: «за 20 минут»
    // такого пункта не имеет. Добавляем распознанное значение отдельным пунктом,
    // вместо того чтобы молча округлить его до ближайшего.
    const opts = LEAD_OPTIONS.slice();
    if (quickAddParsed.lead && !opts.some(o => o.value === quickAddParsed.lead)) {
      opts.push({ value: quickAddParsed.lead, label: formatLead(quickAddParsed.lead) });
      opts.sort((a, b) => a.value - b.value);
    }
    const signature = String(quickAddParsed.lead || '');
    if (leadSel.dataset.filled !== signature) {
      // подписи короткие: поле теперь делит строку с «когда» и «куда»
      // «не заранее» читалось как «не уведомлять вовсе», хотя напоминание
      // в назначенное время всё равно придёт — просто без запаса
      leadSel.innerHTML = `<option value="">🔔 вовремя</option>` +
        opts.map(o => `<option value="${o.value}">🔔 за ${o.label}</option>`).join('');
      leadSel.dataset.filled = signature;
      leadSel.value = quickAddParsed.lead ? String(quickAddParsed.lead) : '';
    }
  }

  const chips = [];
  if (quickAddParsed.when) {
    chips.push(`<span class="parse-chip when">📅 ${esc(describeWhen(quickAddParsed.when))}</span>`);
  }
  if (quickAddParsed.time) chips.push(`<span class="parse-chip time">⏰ ${esc(quickAddParsed.time)}</span>`);
  if (quickAddParsed.lead) chips.push(`<span class="parse-chip lead">🔔 за ${esc(formatLead(quickAddParsed.lead))}</span>`);
  if (quickAddParsed.priority) {
    const names = { 1: 'Низкий', 2: 'Средний', 3: 'Высокий' };
    chips.push(`<span class="parse-chip p${quickAddParsed.priority}">❗ ${names[quickAddParsed.priority]}</span>`);
  }
  quickAddParsed.tags.forEach(t => chips.push(`<span class="parse-chip tag">#${esc(t)}</span>`));
  // заголовок показываем всегда, когда из строки что-то вырезано — иначе непонятно,
  // куда делись слова, особенно если распознанную дату потом переопределили чипом
  if (quickAddParsed.title && quickAddParsed.title !== raw.trim()) {
    chips.unshift(`<span class="parse-chip title">${esc(quickAddParsed.title)}</span>`);
  }
  const box = $('#quickAddChips');
  box.innerHTML = chips.join('');
  box.hidden = !chips.length;
}

function setQuickChip(kind) {
  quickAddWhenTouched = true;
  const sel = $('#quickAddWhen');
  if (kind === 'today') { sel.value = 'today'; $('#quickAddWhenDate').hidden = true; }
  else if (kind === 'evening') { sel.value = 'evening'; $('#quickAddWhenDate').hidden = true; }
  else if (kind === 'tomorrow') { sel.value = 'date'; setQuickAddDate(addDays(todayStr(), 1)); $('#quickAddWhenDate').hidden = false; }
  else if (kind === 'weekend') {
    const now = new Date();
    sel.value = 'date';
    setQuickAddDate(addDays(todayStr(), (6 - now.getDay() + 7) % 7));
    $('#quickAddWhenDate').hidden = false;
  } else if (kind === 'pick') {
    sel.value = 'date';
    $('#quickAddWhenDate').hidden = false;
    openQuickAddDatePicker();
  }
  syncQuickChipState();
  syncQuickAddDateSlot();
  renderQuickAddParse();
}

function syncQuickChipState() {
  const sel = $('#quickAddWhen').value;
  const date = $('#quickAddWhenDate').dataset.value;
  const now = new Date();
  // подсвечиваем чип по фактическому состоянию полей — неважно, задано оно
  // вручную или подтянуто из распознанного текста
  const active = sel === 'today' ? 'today'
    : sel === 'evening' ? 'evening'
    : sel === 'date' && date === addDays(todayStr(), 1) ? 'tomorrow'
    : sel === 'date' && date === addDays(todayStr(), (6 - now.getDay() + 7) % 7) ? 'weekend'
    : sel === 'date' ? 'pick' : null;
  $$('#quickAddQuickChips .quick-chip').forEach(el => {
    el.classList.toggle('active', el.dataset.when === active);
  });
}
function closeQuickAdd() {
  // микрофон должен глохнуть вместе с модалкой, иначе слушает в фоне
  stopVoiceInput();
  $('#quickAddOverlay').classList.remove('open');
}
// Поле даты в быстром добавлении: значение живёт в data-value, подпись — человекочитаемая
// Дата и список «когда» делят одну ячейку сетки: показываем что-то одно.
function syncQuickAddDateSlot() {
  $('#quickAddWhen').hidden = !$('#quickAddWhenDate').hidden;
}

// Один вход для всех трёх мест, откуда открывается календарь. Раньше они
// расходились: из одного дату можно было выбрать, но не снять.
function openQuickAddDatePicker() {
  openDatePicker({
    value: $('#quickAddWhenDate').dataset.value || todayStr(),
    title: 'Когда',
    allowClear: true,
    clearLabel: 'Без даты',
    onPick: (d) => {
      if (d) {
        setQuickAddDate(d);
        $('#quickAddWhenDate').hidden = false;
      } else {
        $('#quickAddWhen').value = '';
        setQuickAddDate(null);
        $('#quickAddWhenDate').hidden = true;
      }
      syncQuickAddDateSlot();
      syncQuickChipState();
    },
  });
}

function setQuickAddDate(value) {
  const el = $('#quickAddWhenDate');
  el.dataset.value = value || '';
  el.classList.toggle('empty', !value);
  el.textContent = value ? `📅 ${fmtDate(value)}` : '📅 Выбрать дату';
}
function submitQuickAdd() {
  const raw = $('#quickAddTitle').value.trim();
  if (!raw) { closeQuickAdd(); return; }
  const parsed = parseQuickInput(raw);
  // если из строки ничего не вычленилось, заголовком остаётся вся строка
  const title = parsed.title || raw;

  const whenSel = $('#quickAddWhen').value;
  const manualWhen = whenSel === 'date' ? ($('#quickAddWhenDate').dataset.value || todayStr()) : (whenSel || null);
  const when = quickAddWhenTouched ? manualWhen : (parsed.when ?? manualWhen);

  const projectId = $('#quickAddProject').value || null;
  let areaId = null;
  if (projectId) {
    const p = store.state.projects[projectId];
    areaId = p ? p.areaId : null;
  } else if (currentView.type === 'area') {
    areaId = currentView.id;
  }

  const tags = parsed.tags.map(name => store.createTag(name).id);

  store.createTask({
    title,
    notes: $('#quickAddNotes').value.trim(),
    when, projectId, areaId, tags,
    priority: parsed.priority,
    reminderTime: parsed.time,
    reminderLeadMinutes: parsed.time
      ? (Number($('#quickAddLead').value) || parsed.lead || null)
      : null,
  });
  closeQuickAdd();
  tapLight();
  showToast(`Добавлено: ${title}`);
}

// ---------------- Command Palette ----------------
function pickViewForTask(t) {
  if (t.projectId) return { type: 'project', id: t.projectId };
  if (t.areaId) return { type: 'area', id: t.areaId };
  if (t.inInbox) return { type: 'inbox' };
  if (t.when === 'today' || t.when === 'evening') return { type: 'today' };
  if (t.when === 'someday') return { type: 'someday' };
  if (isDateStr(t.when)) {
    // «Скоро» — это только будущее. Раньше сюда уходили и прошедшие даты,
    // и переход из уведомления открывал экран, где задачи заведомо нет.
    const today = todayStr();
    if (t.when < today) return { type: 'overdue' };
    if (t.when === today) return { type: 'today' };
    return { type: 'upcoming' };
  }
  return { type: 'anytime' };
}

function paletteTypeLabel(type) {
  return { list: 'список', area: 'область', project: 'проект', tag: 'тег', task: 'задача' }[type] || '';
}

let paletteItemsCache = [];

function paletteItems(query) {
  const q = query.trim().toLowerCase();
  const items = [];
  Object.keys(LIST_META).forEach(key => {
    if (!q || LIST_META[key].title.toLowerCase().includes(q)) {
      items.push({ type: 'list', label: LIST_META[key].title, icon: LIST_META[key].glyph, action: () => { currentView = { type: key }; selectedTaskId = null; } });
    }
  });
  Object.values(store.state.areas).forEach(a => {
    if (!q || a.title.toLowerCase().includes(q)) items.push({ type: 'area', label: a.title, icon: '●', action: () => { currentView = { type: 'area', id: a.id }; selectedTaskId = null; } });
  });
  Object.values(store.state.projects).filter(p => p.status === 'active').forEach(p => {
    if (!q || p.title.toLowerCase().includes(q)) items.push({ type: 'project', label: p.title, icon: '◆', action: () => { currentView = { type: 'project', id: p.id }; selectedTaskId = null; } });
  });
  Object.values(store.state.tags).forEach(t => {
    if (!q || t.title.toLowerCase().includes(q)) items.push({ type: 'tag', label: '#' + t.title, icon: '#', action: () => { currentView = { type: 'tag', id: t.id }; selectedTaskId = null; } });
  });
  if (q) {
    Object.values(store.state.tasks)
      .filter(t => t.status !== 'trashed' && t.title.toLowerCase().includes(q))
      .slice(0, 30)
      .forEach(t => {
        items.push({ type: 'task', label: t.title, icon: '☐', action: () => { currentView = pickViewForTask(t); selectedTaskId = t.id; } });
      });
  }
  return items.slice(0, 40);
}

function renderPalette() {
  const q = $('#paletteInput').value;
  const items = paletteItems(q);
  paletteItemsCache = items;
  const resultsEl = $('#paletteResults');
  resultsEl.innerHTML = items.length
    ? items.map((it, i) => `<div class="palette-item ${i === 0 ? 'active' : ''}" data-idx="${i}">
        <span class="palette-icon">${it.icon}</span>
        <span>${esc(it.label)}</span>
        <span class="palette-type">${paletteTypeLabel(it.type)}</span>
      </div>`).join('')
    : `<div class="palette-empty">Ничего не найдено</div>`;
  resultsEl.querySelectorAll('.palette-item').forEach(el => {
    el.addEventListener('click', () => runPaletteItem(Number(el.dataset.idx)));
  });
}

function runPaletteItem(idx) {
  const it = paletteItemsCache[idx];
  if (!it) return;
  it.action();
  closePalette();
  closeMobileSidebar();
  renderAll();
}

function paletteSetActive(idx) {
  const items = $$('#paletteResults .palette-item');
  items.forEach(el => el.classList.remove('active'));
  if (items[idx]) { items[idx].classList.add('active'); items[idx].scrollIntoView({ block: 'nearest' }); }
}

function openPalette() {
  closeQuickAdd();
  closePicker();
  $('#paletteInput').value = '';
  renderPalette();
  $('#paletteOverlay').classList.add('open');
  setTimeout(() => $('#paletteInput').focus(), 30);
}
function closePalette() {
  $('#paletteOverlay').classList.remove('open');
}

// ---------------- Тема оформления ----------------
// По умолчанию следуем системе. Явный выбор пишем атрибутом на корне — CSS
// разводит три состояния: системное, принудительно светлое и принудительно тёмное.
const THEME_KEY = 'tasksApp.theme';

function currentTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (_) { return 'system'; }
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  const order = ['system', 'light', 'dark'];
  $$('.theme-opt').forEach(el => el.classList.toggle('active', el.dataset.themeSet === theme));
  // позицию бегунка отдаём в CSS числом — так анимация остаётся его заботой
  $$('.theme-switch').forEach(el => el.style.setProperty('--theme-index', Math.max(0, order.indexOf(theme))));
}

function setTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) { /* переживём */ }
  applyTheme(theme);
  tapLight();
}

// ---------------- Notifications ----------------
// закрытие баннера запоминаем — иначе он возвращается при каждой перезагрузке
const NOTIF_DISMISS_KEY = 'tasksApp.notifBannerDismissed';
let notifBannerDismissed = localStorage.getItem(NOTIF_DISMISS_KEY) === '1';
// В нативной сборке window.Notification нет вовсе — разрешение спрашивает система,
// поэтому состояние баннера приходится держать отдельным флагом.
let nativeNotifGranted = false;

function updateNotifBanner() {
  const banner = $('#notifBanner');
  if (!banner) return;
  const textEl = $('#notifBannerText');
  const btn = $('#btnEnableNotif');

  if (isNativeApp()) {
    if (nativeNotifGranted || notifBannerDismissed) { banner.hidden = true; return; }
    banner.hidden = false;
    // повторный запрос система молча отклоняет, дальше только через Настройки
    textEl.textContent = '🔕 Уведомления выключены — включите их в Настройках iOS для «Задач».';
    btn.hidden = true;
    return;
  }

  if (!('Notification' in window) || Notification.permission === 'granted' || notifBannerDismissed) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  if (Notification.permission === 'denied') {
    textEl.textContent = '🔕 Уведомления заблокированы в браузере — включи их в настройках сайта.';
    btn.hidden = true;
  } else {
    textEl.textContent = '🔔 Включить уведомления о напоминаниях?';
    btn.hidden = false;
  }
}

function requestNotifPermission() {
  if (isNativeApp()) {
    requestNativeNotifPermission().then(granted => {
      nativeNotifGranted = granted;
      updateNotifBanner();
      if (granted) scheduleSyncSoon();
    });
    return;
  }
  if (!('Notification' in window)) return;
  Notification.requestPermission().then(updateNotifBanner);
}

// Расписание в системе должно отражать актуальные задачи: любое изменение —
// повод пересобрать его заново.
function setupNativeNotifications() {
  if (!isNativeApp()) return;
  store.subscribe(scheduleSyncSoon);
  initNativeNotifications({
    // Раньше нажатие открывало карточку задачи — экран настроек поверх всего,
    // хотя от напоминания обычно нужно просто увидеть дело в списке и отметить
    // его. Открываем список, где задача живёт, и подсвечиваем её саму.
    onOpenTask: (taskId) => {
      const t = store.state.tasks[taskId];
      if (!t) return;
      currentView = pickViewForTask(t);
      selectedTaskId = null;
      renderAll();
      flashTask(taskId);
    },
    // «Выполнить» из уведомления: задача закрывается сразу, приложение лишь
    // догоняет состояние. Тоста не показываем — его всё равно никто не увидит.
    onCompleteTask: (taskId) => {
      const t = store.state.tasks[taskId];
      if (!t || t.status === 'completed') return;
      store.toggleComplete(taskId);
      renderAll();
    },
  }).then(({ granted }) => {
    nativeNotifGranted = granted;
    updateNotifBanner();
  });
}

function fireReminderNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const today = todayStr();
  store.dueReminders().forEach(({ task: t, kind }) => {
    const body = kind === 'lead'
      ? `Через ${formatLead(t.reminderLeadMinutes)} — в ${t.reminderTime}`
      : (t.notes && t.notes.trim() ? t.notes.trim() : `Напоминание на ${t.reminderTime}`);
    const n = new Notification(t.title, {
      body,
      // разные tag: предварительное не должно заменять собой основное
      tag: `task-${t.id}-${kind}`,
    });
    n.onclick = () => {
      window.focus();
      currentView = { type: 'today' };
      selectedTaskId = t.id;
      renderAll();
      n.close();
    };
    store.markNotified(t.id, today, kind);
  });
}

// ---------------- Toast / Undo ----------------
let toastTimer = null;
// Таймеры в WKWebView замирают вместе с приложением: свернули через секунду
// после удаления, вернулись через час — подсказка всё ещё висит с недоигранным
// остатком. Поэтому держим не только таймер, но и срок по часам, и сверяемся
// с ним при возвращении.
let toastDeadline = 0;

function showToast(message, onUndo) {
  const toast = $('#toast');
  $('#toastMsg').textContent = message;
  const undoBtn = $('#toastUndo');
  undoBtn.style.display = onUndo ? '' : 'none';
  const newUndoBtn = undoBtn.cloneNode(true);
  undoBtn.replaceWith(newUndoBtn);
  if (onUndo) newUndoBtn.addEventListener('click', () => {
    onUndo();
    $('#toastMsg').textContent = 'Восстановлено';
    $('#toastUndo').style.display = 'none';
    clearTimeout(toastTimer);
    toastDeadline = Date.now() + 3000;
    toastTimer = setTimeout(hideToast, 3000);
  });
  toast.hidden = false;
  clearTimeout(toastTimer);
  // 8 секунд вместо пятнадцати: вернуть задачу можно и позже, удержанием на
  // пустом месте списка, так что подсказке незачем стоять так долго
  toastDeadline = Date.now() + 8000;
  toastTimer = setTimeout(hideToast, 8000);
}
function hideToast() {
  $('#toast').hidden = true;
  toastDeadline = 0;
  clearTimeout(toastTimer);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden || $('#toast').hidden) return;
  if (Date.now() >= toastDeadline) hideToast();
  else { clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, toastDeadline - Date.now()); }
});

// Удержание на свободном месте списка. Строки обрабатывают жест сами, поэтому
// касания по ним сюда не доходят.
function bindListLongPress(listEl) {
  let timer = null, sx = 0, sy = 0;
  const cancel = () => { clearTimeout(timer); timer = null; };

  listEl.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('.task-row')) return;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      // отдача только если меню открылось — иначе палец получает отклик впустую
      if (openListMenu(sx, sy)) tapMedium();
    }, 480);
  }, { passive: true });

  // прокрутка списка не должна оборачиваться меню
  listEl.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (Math.abs(t.clientX - sx) > 6 || Math.abs(t.clientY - sy) > 6) cancel();
  }, { passive: true });
  listEl.addEventListener('touchend', cancel);
  listEl.addEventListener('touchcancel', cancel);

  // на настольном экране тот же набор — по правому клику
  listEl.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.task-row')) return;
    e.preventDefault();
    openListMenu(e.clientX, e.clientY);
  });
}

// ---------------- Task context menu ----------------
let contextMenuTaskId = null;
function closeContextMenu() {
  $('#taskContextMenu').hidden = true;
  contextMenuTaskId = null;
}
function openContextMenu(taskId, x, y) {
  const task = store.state.tasks[taskId];
  if (!task) return;
  contextMenuTaskId = taskId;
  const menu = $('#taskContextMenu');
  const items = [];
  // Набор пунктов зависит от того, где задача лежит. В корзине переносить её
  // «на завтра» бессмысленно, а в журнале главное действие — вернуть в работу,
  // и ради него не должно приходиться открывать карточку и листать до низа.
  if (task.status === 'trashed') {
    items.push({ icon: '↺', label: 'Восстановить', action: () => { store.restoreTask(taskId); tapLight(); } });
    items.push({ sep: true });
    items.push({ icon: '⌫', label: 'Удалить навсегда', danger: true, action: () => {
      store.deleteTaskPermanently(taskId);
      if (selectedTaskId === taskId) selectedTaskId = null;
      tapMedium();
    } });
  } else {
    const done = task.status === 'completed' || task.status === 'canceled';
    items.push({
      icon: done ? '↺' : '✓',
      label: done ? 'Вернуть в активные' : 'Выполнить',
      action: () => { store.toggleComplete(taskId); done ? tapLight() : tapSuccess(); },
    });
    if (!done) {
      items.push({ sep: true });
      // notifiedOn сбрасываем вместе с датой, иначе перенесённая задача не напомнит о себе заново
      const setWhen = when => { store.updateTask(taskId, { when, notifiedOn: null, lastNotifiedAt: null }); tapLight(); };
      items.push({ icon: '☀', label: 'Сегодня', action: () => setWhen('today') });
      items.push({ icon: '📆', label: 'Завтра', action: () => setWhen(addDays(todayStr(), 1)) });
      items.push({ icon: '🌙', label: 'Этим вечером', action: () => setWhen('evening') });
      items.push({ icon: '🌒', label: 'Когда-нибудь', action: () => setWhen('someday') });
      items.push({ icon: '≡', label: 'Без даты', action: () => setWhen(null) });
    }
    // Порядок меняли только перетаскиванием мышью — на телефоне это было
    // недоступно вовсе. Показываем пункт лишь когда двигать действительно есть куда.
    const up = canMoveTask(taskId, -1);
    const down = canMoveTask(taskId, 1);
    if (up || down) {
      items.push({ sep: true });
      if (up) items.push({ icon: '↑', label: 'Переместить выше', action: () => moveTask(taskId, -1) });
      if (down) items.push({ icon: '↓', label: 'Переместить ниже', action: () => moveTask(taskId, 1) });
    }

    items.push({ sep: true });
    items.push({ icon: '⧉', label: 'Дублировать', action: () => { const c = store.duplicateTask(taskId); if (c) { selectedTaskId = c.id; renderAll(); } } });
    items.push({ icon: '🗑', label: 'Удалить в корзину', danger: true, action: () => {
      store.trashTask(taskId);
      if (selectedTaskId === taskId) selectedTaskId = null;
      tapMedium();
      showToast('Задача удалена', () => store.restoreTask(taskId));
    } });
  }

  showMenu(items, x, y);
}

// Отрисовка и размещение — общие: меню задачи и меню пустого места списка
// отличаются только набором пунктов.
function showMenu(items, x, y) {
  const menu = $('#taskContextMenu');
  menu.innerHTML = items.map((it, i) => it.sep
    ? `<div class="ctx-sep"></div>`
    : `<div class="ctx-item ${it.danger ? 'danger' : ''}" data-ctx-idx="${i}"><span class="ctx-icon">${it.icon}</span><span>${esc(it.label)}</span></div>`
  ).join('');

  menu.querySelectorAll('[data-ctx-idx]').forEach(el => {
    el.addEventListener('click', () => {
      const it = items[Number(el.dataset.ctxIdx)];
      if (it && it.action) it.action();
      closeContextMenu();
    });
  });

  // На узком экране меню показывается шторкой снизу — там его удобнее достать
  // большим пальцем, чем всплывающим окошком под точкой касания.
  menu.hidden = false;
  if (window.matchMedia('(max-width: 700px)').matches) {
    menu.style.left = menu.style.top = '';
    menu.style.visibility = '';
    return;
  }

  // измеряем скрытым, иначе меню на кадр вспыхивает на прошлой позиции
  menu.style.visibility = 'hidden';
  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  menu.style.left = Math.max(8, Math.min(x, maxX)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, maxY)) + 'px';
  menu.style.visibility = '';
}

// Перестановка задачи относительно соседа по экрану, а не по глобальному
// массиву порядка: список сгруппирован, и «сосед сверху» в данных запросто
// окажется в другой группе — тогда перестановка не даст видимого эффекта.
// Границей служит заголовок группы: за неё не переносим, там правит дата.
function neighbourLane(taskId, dir) {
  const row = document.querySelector(`.task-row[data-id="${taskId}"]`);
  const lane = row?.closest('.task-swipe');
  if (!lane) return null;
  const sib = dir < 0 ? lane.previousElementSibling : lane.nextElementSibling;
  return sib?.classList?.contains('task-swipe') ? sib : null;
}

function canMoveTask(taskId, dir) {
  return Boolean(neighbourLane(taskId, dir));
}

function moveTask(taskId, dir) {
  const sib = neighbourLane(taskId, dir);
  if (!sib) return;
  if (dir < 0) {
    store.reorderTask(taskId, sib.querySelector('.task-row').dataset.id);
  } else {
    // вниз — значит встать перед тем, кто идёт следом за соседом;
    // если следом никого, задача уходит в конец своей группы
    const after = sib.nextElementSibling?.classList?.contains('task-swipe')
      ? sib.nextElementSibling.querySelector('.task-row').dataset.id
      : null;
    store.reorderTask(taskId, after);
  }
  tapLight();
}

// Относится ли задача к открытому сейчас экрану. Повторяет отбор, по которому
// строится сам список: без этого меню возврата предлагало последнее удалённое
// вообще — стоишь в «Скоро», а тебе возвращают задачу из «Сегодня».
function taskFitsView(task, view) {
  const today = todayStr();
  // Куда задача вернётся, если её восстановить: у лежащей в корзине это
  // прежний статус, у остальных — нынешний.
  const target = task.status === 'trashed' ? (task.statusBeforeTrash || 'active') : task.status;

  // В журнале возвращать имеет смысл только удалённое оттуда же: «снять отметку»
  // там убрало бы задачу с экрана вместо того, чтобы вернуть.
  if (view.type === 'logbook') {
    return task.status === 'trashed' && (target === 'completed' || target === 'canceled');
  }
  if (view.type === 'trash') return false;
  // Ограничение касается только корзины: оттуда выполненная задача вернётся
  // в журнал, а не в открытый список. Просто выполненную снять отметкой можно —
  // она сразу окажется здесь же.
  if (task.status === 'trashed' && target !== 'active') return false;

  switch (view.type) {
    case 'inbox':    return Boolean(task.inInbox);
    case 'today':    return !task.inInbox && (task.when === 'today' || task.when === 'evening'
                       || task.when === today);
    case 'overdue':  return !task.inInbox && isDateStr(task.when) && task.when < today;
    case 'upcoming': return !task.inInbox && isDateStr(task.when) && task.when > today;
    case 'someday':  return !task.inInbox && task.when === 'someday';
    case 'anytime':  return !task.inInbox && !task.when;
    case 'calendar': return isDateStr(task.when) || Boolean(task.deadline)
                       || task.when === 'today' || task.when === 'evening';
    case 'project':  return task.projectId === view.id;
    case 'area':     return task.areaId === view.id;
    case 'tag':      return (task.tags || []).includes(view.id);
    default:         return false;
  }
}

// Меню по удержанию на пустом месте списка. Отдельная кнопка «отменить» жила
// только в тосте и пропадала через несколько секунд — вернуть случайно закрытую
// задачу после этого было нечем, кроме похода в корзину или журнал.
// Это меню — исключительно отмена только что сделанного. Если возвращать нечего,
// оно не открывается вовсе: пустая шторка на пустом месте и «Новая задача»
// рядом с кнопкой «+» были шумом, а в журнале и корзине — ещё и бессмыслицей.
function openListMenu(x, y) {
  const { trashed, completed } = store.lastRemoved(task => taskFitsView(task, currentView));
  const short = (t) => (t.length > 26 ? t.slice(0, 25) + '…' : t);
  const items = [];
  if (trashed) {
    items.push({ icon: '↺', label: `Вернуть: ${short(trashed.title)}`, action: () => {
      store.restoreTask(trashed.id);
      tapLight();
      showToast('Задача возвращена');
    } });
  }
  if (completed) {
    items.push({ icon: '○', label: `Снять отметку: ${short(completed.title)}`, action: () => {
      store.toggleComplete(completed.id);
      tapLight();
    } });
  }

  // Очистка целиком — только там, где она осмысленна. Это необратимо для
  // корзины, поэтому спрашиваем подтверждение.
  if (currentView.type === 'logbook') {
    const n = store.logbookTasks().length;
    if (n) {
      if (items.length) items.push({ sep: true });
      items.push({ icon: '🗑', label: `Очистить журнал (${n})`, danger: true, action: async () => {
        if (!await askConfirm({ title: `Очистить журнал (${n})?`, message: 'Задачи переедут в корзину — оттуда их ещё можно вернуть.', confirmLabel: 'Очистить' })) return;
        store.clearLogbook();
        tapMedium();
        showToast('Журнал очищен');
      } });
    }
  } else if (currentView.type === 'trash') {
    const n = store.trashTasks().length;
    if (n) {
      items.push({ icon: '⌫', label: `Очистить корзину (${n})`, danger: true, action: async () => {
        if (!await askConfirm({ title: `Очистить корзину (${n})?`, message: 'Задачи будут удалены навсегда, отменить это будет нельзя.', confirmLabel: 'Удалить', danger: true })) return;
        store.emptyTrash();
        if (selectedTaskId && !store.state.tasks[selectedTaskId]) selectedTaskId = null;
        tapMedium();
        showToast('Корзина очищена');
      } });
    }
  }

  if (!items.length) return false;
  showMenu(items, x, y);
  return true;
}

// Короткая подсветка строки: после перехода из уведомления в списке из десятка
// задач иначе непонятно, о которой шла речь.
let flashTimer = null;
function flashTask(taskId) {
  clearTimeout(flashTimer);
  $$('.task-row.flash').forEach(el => el.classList.remove('flash'));
  // ждём кадр: строки появляются в разметке только после renderAll выше
  requestAnimationFrame(() => {
    const row = document.querySelector(`.task-row[data-id="${taskId}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('flash');
    flashTimer = setTimeout(() => row.classList.remove('flash'), 2600);
  });
}

// ---------------- Смена суток ----------------
// Всё, что зависит от «сегодня» — списки, просрочка, выделение дня в календаре —
// вычислялось только при отрисовке. Приложение, оставленное открытым или просто
// свёрнутым на ночь, наутро показывало вчерашнюю картину: вчерашние задачи не
// выглядели просроченными, а сегодняшние ещё не переехали на новый день.
let renderedDay = todayStr();

function refreshIfDayChanged() {
  const now = todayStr();
  if (now === renderedDay) return;
  renderedDay = now;
  // вчерашние «сегодня» закрепляем за вчерашним числом, а не тащим за собой
  store.rolloverStaleToday();
  // выбранный в календаре день тянем за собой, только если он был «сегодня»
  if (!isDateStr(calendarSelectedDay) || calendarSelectedDay < now) calendarSelectedDay = now;
  renderAll();
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshIfDayChanged();
});
// на случай, если приложение просто лежит открытым и полночь наступает при нас
setInterval(refreshIfDayChanged, 60000);

// ---------------- Global render ----------------
function renderAll() {
  renderSidebar();
  renderMain();
  renderDetail();
}

store.subscribe(renderAll);

// ---------------- Event wiring ----------------
function seedIfEmpty() {
  const s = store.state;
  if (Object.keys(s.tasks).length || Object.keys(s.projects).length || Object.keys(s.areas).length) return;

  const work = store.createArea({ title: 'Работа' });
  const life = store.createArea({ title: 'Личное' });
  const launch = store.createProject({ title: 'Запуск сайта', areaId: work.id });
  const home = store.createProject({ title: 'Ремонт квартиры', areaId: life.id });

  const urgent = store.createTag('срочно', '#e0473e');
  const idea = store.createTag('идея', '#8a6fd4');

  store.createTask({ title: 'Написать план на день', when: 'today', repeat: 'daily' });
  store.createTask({ title: 'Позвонить в поддержку хостинга', when: 'today', deadline: todayStr(), priority: 3 });
  const t1 = store.createTask({ title: 'Согласовать макет главной страницы', projectId: launch.id, when: 'today', priority: 2 });
  store.toggleTaskTag(t1.id, urgent.id);
  store.createTask({ title: 'Настроить домен и SSL', projectId: launch.id });
  store.createTask({ title: 'Написать тексты для лендинга', projectId: launch.id, when: addDays(todayStr(), 2) });
  store.createTask({ title: 'Выбрать плитку для ванной', projectId: home.id });
  const t2 = store.createTask({ title: 'Заказать штору для душа', projectId: home.id, when: 'someday' });
  store.toggleTaskTag(t2.id, idea.id);
  store.createTask({ title: 'Прочитать книгу вечером', when: 'evening' });
  store.createTask({ title: 'Разобрать входящие письма' });
  store.createTask({ title: 'Оплатить счёт за интернет', when: addDays(todayStr(), -1) });
  store.createTask({ title: 'Еженедельная планёрка', when: addDays(todayStr(), 3), repeat: 'weekly' });
}

document.addEventListener('DOMContentLoaded', () => {
  seedIfEmpty();
  // приложение могло не открываться несколько дней — разбираем накопившееся
  store.rolloverStaleToday();
  renderAll();

  applyTheme(currentTheme());
  $$('.theme-opt').forEach(el => el.addEventListener('click', () => setTheme(el.dataset.themeSet)));

  updateNotifBanner();
  const btnEnableNotif = $('#btnEnableNotif');
  if (btnEnableNotif) btnEnableNotif.addEventListener('click', requestNotifPermission);
  const btnDismissNotif = $('#btnDismissNotif');
  if (btnDismissNotif) btnDismissNotif.addEventListener('click', () => {
    notifBannerDismissed = true;
    try { localStorage.setItem(NOTIF_DISMISS_KEY, '1'); } catch (_) { /* не критично */ }
    updateNotifBanner();
  });
  // В нативной сборке опрос не нужен и вреден: уведомления уже стоят в системе,
  // и он показал бы их второй раз поверх системного.
  if (isNativeApp()) {
    setupNativeNotifications();
  } else {
    setTimeout(fireReminderNotifications, 2000);
    setInterval(fireReminderNotifications, 20000);
  }

  bindListLongPress($('#taskList'));

  // Быстрый переход ищет и по задачам, и по спискам, и показывает результат
  // поверх экрана — на телефоне это удобнее, чем поле в выдвижной панели,
  // которое само же результат и загораживает.
  $('#btnHeaderSearch').addEventListener('click', openPalette);

  $('#btnMenu').addEventListener('click', () => $('#app').classList.toggle('sidebar-open'));
  $('#sidebarScrim').addEventListener('click', closeMobileSidebar);

  // Жесты от левого края. Панель деталей и сайдбар переживают перерисовку —
  // внутри меняется только innerHTML, так что привязываемся один раз.
  bindDetailBackSwipe($('#detailPanel'), {
    isOpen: () => $('#app').classList.contains('detail-open'),
    onClose: () => { selectedTaskId = null; renderAll(); },
  });
  bindSidebarSwipe($('#app'), $('.sidebar'), $('#sidebarScrim'));

  bindKeyboardInset();
  $('#btnQuickAdd').addEventListener('click', openQuickAdd);
  $('#btnFab').addEventListener('click', openQuickAdd);
  $('#quickAddSubmit').addEventListener('click', submitQuickAdd);
  $('#quickAddTitle').addEventListener('input', renderQuickAddParse);
  $('#btnQuickAddMic').addEventListener('click', () => {
    setVoiceStatus('');
    voiceInput?.toggle();
  });
  $('#quickAddQuickChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.quick-chip');
    if (chip) setQuickChip(chip.dataset.when);
  });

  $('#quickAddWhen').addEventListener('change', (e) => {
    quickAddWhenTouched = true;
    syncQuickChipState();
    renderQuickAddParse();
    const isDate = e.target.value === 'date';
    $('#quickAddWhenDate').hidden = !isDate;
    if (!isDate) return;
    if (!$('#quickAddWhenDate').dataset.value) setQuickAddDate(todayStr());
    openQuickAddDatePicker();
  });
  $('#quickAddWhenDate').addEventListener('click', openQuickAddDatePicker);
  $('#quickAddOverlay').addEventListener('click', (e) => { if (e.target.id === 'quickAddOverlay') closeQuickAdd(); });
  // Escape/Enter на всём окне: глобальный обработчик сюда не доходит, а раньше
  // обработчик висел только на поле названия — из «Заметок» окно было не закрыть
  $('#quickAddOverlay').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeQuickAdd(); }
    else if (e.key === 'Enter' && e.target.tagName !== 'SELECT') { e.preventDefault(); submitQuickAdd(); }
  });

  $('#btnAddArea').addEventListener('click', async () => {
    const title = await askText({ title: 'Новая область', placeholder: 'Название области', confirmLabel: 'Создать' });
    if (title && title.trim()) store.createArea({ title: title.trim() });
  });
  $('#btnAddProject').addEventListener('click', async () => {
    const title = await askText({ title: 'Новый проект', placeholder: 'Название проекта', confirmLabel: 'Создать' });
    if (title && title.trim()) {
      let areaId = currentView.type === 'area' ? currentView.id : null;
      const p = store.createProject({ title: title.trim(), areaId });
      currentView = { type: 'project', id: p.id };
      closeMobileSidebar();
      renderAll();
    }
  });

  $('#btnExport').addEventListener('click', async () => {
    const data = JSON.stringify(store.state, null, 2);
    const res = await exportBackup(data, `tasks-backup-${todayStr()}.json`);
    if (!res.ok) showToast('Не удалось выгрузить копию');
    else if (res.via === 'share') closeMobileSidebar();
  });
  $('#btnImport').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== 'object' || !parsed.tasks) throw new Error('bad format');
        if (await askConfirm({ title: 'Заменить все данные?', message: 'Импорт заменит текущие задачи, проекты и области содержимым файла.', confirmLabel: 'Импортировать', danger: true })) {
          selectedTaskId = null;
          currentView = { type: 'today' };
          store.importState(parsed);
        }
      } catch (err) {
        alert('Не удалось прочитать файл — это должен быть JSON-файл, экспортированный из этого приложения.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  $('#searchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderMain();
  });
  // значок ⌘K обещал быстрый переход, но кликом ничего не открывалось
  $('.search-kbd').addEventListener('click', (e) => { e.stopPropagation(); openPalette(); });

  window.addEventListener('tasks:save-error', () => {
    showToast('Не удалось сохранить: хранилище браузера переполнено');
  });

  $('#paletteOverlay').addEventListener('click', (e) => { if (e.target.id === 'paletteOverlay') closePalette(); });
  $('#paletteInput').addEventListener('input', renderPalette);
  $('#paletteInput').addEventListener('keydown', (e) => {
    const items = $$('#paletteResults .palette-item');
    let idx = items.findIndex(el => el.classList.contains('active'));
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteSetActive(Math.min(items.length - 1, idx + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); paletteSetActive(Math.max(0, idx - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (idx >= 0) runPaletteItem(idx); }
    else if (e.key === 'Escape') { closePalette(); }
  });

  document.addEventListener('click', (e) => {
    if (!$('#taskContextMenu').hidden && !e.target.closest('#taskContextMenu')) closeContextMenu();
  });
  document.addEventListener('scroll', closeContextMenu, true);
  window.addEventListener('resize', closeContextMenu);

  document.addEventListener('keydown', (e) => {
    const typing = isTypingTarget(document.activeElement);
    if (!$('#taskContextMenu').hidden && e.key === 'Escape') { closeContextMenu(); return; }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if ($('#paletteOverlay').classList.contains('open')) closePalette(); else openPalette();
      return;
    }
    if (isPickerOpen()) return; // барабан обрабатывает клавиши сам
    if ($('#paletteOverlay').classList.contains('open')) return;
    if ($('#quickAddOverlay').classList.contains('open')) return;

    const mod = e.metaKey || e.ctrlKey; // Ctrl на Windows/Linux, Cmd на macOS

    if (!typing && !mod && e.key.toLowerCase() === 'n') { e.preventDefault(); openQuickAdd(); }
    if (e.key === 'Escape' && $('#app').classList.contains('sidebar-open')) { closeMobileSidebar(); return; }
    if (!typing && e.key === 'Escape' && selectedTaskId) { selectedTaskId = null; renderAll(); }
    if (!typing && !mod && (e.key === 'Delete' || e.key === 'Backspace') && selectedTaskId) {
      e.preventDefault();
      const id = selectedTaskId;
      store.trashTask(id);
      selectedTaskId = null;
      showToast('Задача удалена', () => store.restoreTask(id));
    }
    // Ctrl+T перехватывает браузер, поэтому дублируем голой «t»
    if (!typing && e.key.toLowerCase() === 't' && selectedTaskId && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      store.updateTask(selectedTaskId, { when: 'today', notifiedOn: null });
    }
    if (mod && !typing && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && selectedTaskId) {
      const ids = $$('#taskList .task-row').map(el => el.dataset.id);
      const idx = ids.indexOf(selectedTaskId);
      if (idx !== -1) {
        e.preventDefault();
        if (e.key === 'ArrowUp' && idx > 0) store.reorderTask(selectedTaskId, ids[idx - 1]);
        else if (e.key === 'ArrowDown' && idx < ids.length - 1) store.reorderTask(selectedTaskId, ids[idx + 2] || null);
      }
    }
    if (mod && !typing && e.key === '/') {
      e.preventDefault();
      $('#app').classList.toggle('sidebar-collapsed');
    }
  });
});
