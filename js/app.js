import { store, todayStr, addDays, formatDate } from './store.js?v=10';

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
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && dateStr < todayStr();
}

// ---------------- Sidebar ----------------
function renderSidebar() {
  const nav = $('#navLists');
  const counts = {
    inbox: store.inboxTasks().length,
    today: store.todayTasks().length,
    upcoming: store.upcomingTasks().length,
    anytime: store.anytimeTasks().length,
    someday: store.somedayTasks().length,
    logbook: store.logbookTasks().length,
    trash: store.trashTasks().length,
  };
  nav.innerHTML = Object.keys(LIST_META).map(key => {
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
      renderAll();
    });
  });
  tree.querySelectorAll('[data-project]').forEach(el => {
    el.addEventListener('click', () => {
      currentView = { type: 'project', id: el.dataset.project };
      selectedTaskId = null;
      renderAll();
    });
  });
  tree.querySelectorAll('[data-delete-area]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.deleteArea;
      const area = store.state.areas[id];
      if (!area) return;
      if (confirm(`Удалить область «${area.title}»? Проекты и задачи в ней не удалятся, а станут неразобранными.`)) {
        store.deleteArea(id);
        if (currentView.type === 'area' && currentView.id === id) currentView = { type: 'today' };
        renderAll();
      }
    });
  });
  tree.querySelectorAll('[data-delete-project]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.deleteProject;
      const project = store.state.projects[id];
      if (!project) return;
      if (confirm(`Удалить проект «${project.title}»? Задачи в нём не удалятся, а станут неразобранными.`)) {
        store.deleteProject(id);
        if (currentView.type === 'project' && currentView.id === id) currentView = { type: 'today' };
        renderAll();
      }
    });
  });
}

// ---------------- Task row ----------------
function taskRowHtml(task, opts = {}) {
  const { showProject = false } = opts;
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
  if (task.deadline) metaBits.push(`<span class="deadline-pill">${fmtDate(task.deadline)}</span>`);
  if (task.when === 'evening') metaBits.push(`<span class="task-meta-item">🌙 вечер</span>`);
  if (task.reminderTime) metaBits.push(`<span class="task-meta-item" title="${task.reminderRepeatMinutes ? 'Повторяется каждые ' + task.reminderRepeatMinutes + ' мин.' : 'Однократное напоминание'}">⏰ ${task.reminderTime}${task.reminderRepeatMinutes ? ' ⟳' : ''}</span>`);
  if (task.repeat) metaBits.push(`<span class="task-meta-item" title="Повторяется">🔁</span>`);
  if (isOverdue(task.when)) metaBits.push(`<span class="deadline-pill">просрочено</span>`);

  const cls = ['task-row'];
  if (task.status === 'completed') cls.push('completed');
  if (task.status === 'canceled') cls.push('canceled');
  if (task.id === selectedTaskId) cls.push('selected');

  const quickTrash = task.status !== 'trashed'
    ? `<span class="task-quick-trash" data-quick-trash="${task.id}" title="Удалить в корзину">🗑</span>`
    : '';

  return `<div class="${cls.join(' ')}" data-id="${task.id}" data-priority="${task.priority || 0}" draggable="true">
    <div class="checkbox" data-checkbox="${task.id}">
      <svg viewBox="0 0 10 10"><path d="M1 5l3 3 5-6" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <div class="task-main">
      <div class="task-title">${esc(task.title)}</div>
      ${metaBits.length ? `<div class="task-meta">${metaBits.join('')}</div>` : ''}
    </div>
    ${quickTrash}
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
  if (addBtn) addBtn.addEventListener('click', () => {
    const title = prompt('Название раздела:');
    if (title && title.trim()) store.createHeading({ title: title.trim(), projectId: addBtn.dataset.addHeading });
  });
  $$('[data-heading-id]').forEach(el => {
    el.addEventListener('dblclick', () => {
      const h = store.state.headings[el.dataset.headingId];
      if (!h) return;
      const title = prompt('Название раздела:', h.title);
      if (title && title.trim()) store.updateHeading(h.id, { title: title.trim() });
    });
  });
  $$('[data-delete-heading]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('Удалить раздел? Задачи останутся в проекте.')) store.deleteHeading(el.dataset.deleteHeading);
    });
  });
  $$('[data-heading-drop]').forEach(el => {
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      if (dragTaskId) store.updateTask(dragTaskId, { headingId: el.dataset.headingDrop });
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
    const overdue = all.filter(t => isOverdue(t.when));
    const today = all.filter(t => t.when !== 'evening' && !isOverdue(t.when));
    const evening = all.filter(t => t.when === 'evening');
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
        const d = new Date(t.completedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
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

  let html = '';
  if (unfiled.length) {
    html += groupHtml('Без проекта');
    html += unfiled.map(t => taskRowHtml(t)).join('');
  }

  const areas = Object.values(store.state.areas).sort((a, b) => a.createdAt - b.createdAt);
  areas.forEach(area => {
    const projects = store.areaProjects(area.id).filter(p => byProject[p.id]);
    const direct = byAreaDirect[area.id] || [];
    if (!projects.length && !direct.length) return;
    html += `<div class="project-heading-row"><span class="area-dot"></span>${esc(area.title)}</div>`;
    projects.forEach(p => {
      html += `<div class="group-heading" style="margin-left:8px">${esc(p.title)}</div>`;
      html += byProject[p.id].map(t => taskRowHtml(t)).join('');
    });
    if (direct.length) html += direct.map(t => taskRowHtml(t)).join('');
  });

  Object.keys(byProject).forEach(pid => {
    const p = store.state.projects[pid];
    if (!p || p.areaId) return;
    html += `<div class="project-heading-row"><span class="tree-icon" style="color:var(--text-secondary)">◆</span>${esc(p.title)}</div>`;
    html += byProject[pid].map(t => taskRowHtml(t)).join('');
  });

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
    </div>`;
  }

  const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  let dayListHtml = '';
  if (calendarSelectedDay) {
    const tasks = store.tasksOnDate(calendarSelectedDay);
    dayListHtml = `<div class="cal-daylist">
      <div class="group-heading">${fmtDate(calendarSelectedDay)}</div>
      ${tasks.length ? tasks.map(t => taskRowHtml(t, { showProject: true })).join('') : `<div class="empty-state" style="margin-top:16px;">Нет задач на этот день</div>`}
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
      renderDetail();
    });
  });
}

let dragTaskId = null;
function bindTaskListEvents() {
  const listEl = $('#taskList');
  listEl.querySelectorAll('[data-checkbox]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      store.toggleComplete(el.dataset.checkbox);
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
  });
}

// ---------------- Detail panel ----------------
function syncRowTitle(taskId, title) {
  $$(`.task-row[data-id="${taskId}"] .task-title`).forEach(el => { el.textContent = title; });
}

function renderDetail() {
  const panel = $('#detailPanel');
  const task = selectedTaskId ? store.state.tasks[selectedTaskId] : null;
  $('#app').classList.toggle('detail-open', !!task);
  if (!task) {
    panel.innerHTML = '';
    return;
  }

  const projectOptions = `<option value="">— нет —</option>` + Object.values(store.state.projects)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(p => `<option value="${p.id}" ${task.projectId === p.id ? 'selected' : ''}>${esc(p.title)}</option>`).join('');

  const areaOptions = `<option value="">— нет —</option>` + Object.values(store.state.areas)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(a => `<option value="${a.id}" ${task.areaId === a.id && !task.projectId ? 'selected' : ''}>${esc(a.title)}</option>`).join('');

  const whenValue = task.when && /^\d{4}-\d{2}-\d{2}$/.test(task.when) ? 'date' : (task.when || '');
  const taskHeadings = task.projectId ? store.projectHeadings(task.projectId) : [];
  const [reminderH, reminderM] = (task.reminderTime || '').split(':');
  const reminderHours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
  const reminderMinuteSet = new Set([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  if (reminderM !== undefined) reminderMinuteSet.add(Number(reminderM));
  const reminderMinutes = Array.from(reminderMinuteSet).sort((a, b) => a - b).map(m => String(m).padStart(2, '0'));

  panel.innerHTML = `
    <div class="detail-panel-header">
      <button class="detail-close-btn" id="detClose" title="Закрыть (Esc)">✕</button>
    </div>
    <textarea class="detail-title-input" id="detTitle" rows="1">${esc(task.title)}</textarea>
    <textarea class="detail-notes-input" id="detNotes" placeholder="Заметки">${esc(task.notes)}</textarea>

    <div class="detail-section">
      <div class="detail-label">Когда</div>
      <select class="detail-select" id="detWhen">
        <option value="" ${whenValue === '' ? 'selected' : ''}>Без даты (в любое время)</option>
        <option value="today" ${whenValue === 'today' ? 'selected' : ''}>Сегодня</option>
        <option value="evening" ${whenValue === 'evening' ? 'selected' : ''}>Этим вечером</option>
        <option value="date" ${whenValue === 'date' ? 'selected' : ''}>Дата…</option>
        <option value="someday" ${whenValue === 'someday' ? 'selected' : ''}>Когда-нибудь</option>
      </select>
      <input type="date" class="detail-date" id="detWhenDate" style="margin-top:6px; ${whenValue === 'date' ? '' : 'display:none'}" value="${whenValue === 'date' ? task.when : ''}">
      <div id="detReminderWrap" style="margin-top:6px;">
        <div class="detail-label" style="margin-top:8px;">Напоминание</div>
        <div class="reminder-time-picker">
          <select class="detail-select" id="detReminderHour">
            <option value="">—</option>
            ${reminderHours.map(h => `<option value="${h}" ${reminderH === h ? 'selected' : ''}>${h}</option>`).join('')}
          </select>
          <span class="reminder-time-sep">:</span>
          <select class="detail-select" id="detReminderMinute">
            <option value="">—</option>
            ${reminderMinutes.map(m => `<option value="${m}" ${reminderM === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>
        <select class="detail-select" id="detReminderRepeat" style="margin-top:6px; ${task.reminderTime ? '' : 'display:none'}">
          <option value="" ${!task.reminderRepeatMinutes ? 'selected' : ''}>Не повторять</option>
          <option value="15" ${task.reminderRepeatMinutes === 15 ? 'selected' : ''}>Каждые 15 минут</option>
          <option value="30" ${task.reminderRepeatMinutes === 30 ? 'selected' : ''}>Каждые 30 минут</option>
          <option value="60" ${task.reminderRepeatMinutes === 60 ? 'selected' : ''}>Каждый час</option>
          <option value="120" ${task.reminderRepeatMinutes === 120 ? 'selected' : ''}>Каждые 2 часа</option>
          <option value="240" ${task.reminderRepeatMinutes === 240 ? 'selected' : ''}>Каждые 4 часа</option>
        </select>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-label">Дедлайн</div>
      <input type="date" class="detail-date" id="detDeadline" value="${task.deadline || ''}">
    </div>

    <div class="detail-section">
      <div class="detail-label">Повтор</div>
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
    </div>

    ${taskHeadings.length ? `
    <div class="detail-section">
      <div class="detail-label">Раздел</div>
      <select class="detail-select" id="detHeading">
        <option value="">— нет —</option>
        ${taskHeadings.map(h => `<option value="${h.id}" ${task.headingId === h.id ? 'selected' : ''}>${esc(h.title)}</option>`).join('')}
      </select>
    </div>` : ''}

    <div class="detail-section">
      <div class="detail-label">Область</div>
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

  $('#detClose').addEventListener('click', () => {
    selectedTaskId = null;
    renderAll();
  });

  autoGrow($('#detTitle'));
  $('#detTitle').addEventListener('input', (e) => {
    task.title = e.target.value;
    localStorage.setItem('tasksApp.v1', JSON.stringify(store.state));
    syncRowTitle(task.id, e.target.value);
    autoGrow(e.target);
  });
  $('#detTitle').addEventListener('blur', () => store.save());
  $('#detNotes').addEventListener('input', (e) => {
    task.notes = e.target.value;
    localStorage.setItem('tasksApp.v1', JSON.stringify(store.state));
  });
  $('#detNotes').addEventListener('blur', () => store.save());

  $('#detWhen').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === 'date') {
      $('#detWhenDate').style.display = '';
      const d = $('#detWhenDate').value || todayStr();
      store.updateTask(task.id, { when: d, notifiedOn: null });
    } else {
      $('#detWhenDate').style.display = 'none';
      store.updateTask(task.id, { when: v || null, notifiedOn: null });
    }
  });
  $('#detWhenDate').addEventListener('change', (e) => {
    store.updateTask(task.id, { when: e.target.value, notifiedOn: null });
  });
  function commitReminderTime() {
    const h = $('#detReminderHour').value;
    const m = $('#detReminderMinute').value;
    const repeatWrap = $('#detReminderRepeat');
    if (h && m) {
      if (repeatWrap) repeatWrap.style.display = '';
      store.updateTask(task.id, { reminderTime: `${h}:${m}`, notifiedOn: null, lastNotifiedAt: null });
    } else {
      if (repeatWrap) repeatWrap.style.display = 'none';
      store.updateTask(task.id, { reminderTime: null, reminderRepeatMinutes: null, notifiedOn: null, lastNotifiedAt: null });
    }
  }
  const reminderHourInput = $('#detReminderHour');
  const reminderMinuteInput = $('#detReminderMinute');
  if (reminderHourInput) reminderHourInput.addEventListener('change', commitReminderTime);
  if (reminderMinuteInput) reminderMinuteInput.addEventListener('change', commitReminderTime);
  const reminderRepeatInput = $('#detReminderRepeat');
  if (reminderRepeatInput) reminderRepeatInput.addEventListener('change', (e) => {
    store.updateTask(task.id, { reminderRepeatMinutes: e.target.value ? Number(e.target.value) : null });
  });
  $('#detDeadline').addEventListener('change', (e) => {
    store.updateTask(task.id, { deadline: e.target.value || null });
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
  if (convertBtn) convertBtn.addEventListener('click', () => {
    if (confirm('Превратить задачу в проект? Пункты чек-листа станут отдельными задачами нового проекта.')) {
      const project = store.convertTaskToProject(task.id);
      selectedTaskId = null;
      currentView = { type: 'project', id: project.id };
      renderAll();
    }
  });

  $('#detChecklistAdd').addEventListener('click', () => {
    const text = prompt('Пункт чек-листа:');
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
    el.addEventListener('blur', () => store.save());
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
  if (delForever) delForever.addEventListener('click', () => {
    if (confirm('Удалить задачу навсегда? Это действие необратимо.')) {
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

// ---------------- Quick Add ----------------
function populateQuickAddProjects() {
  const sel = $('#quickAddProject');
  const opts = ['<option value="">Входящие</option>'];
  Object.values(store.state.areas).sort((a, b) => a.createdAt - b.createdAt).forEach(area => {
    store.areaProjects(area.id).forEach(p => opts.push(`<option value="${p.id}">${esc(area.title)} / ${esc(p.title)}</option>`));
  });
  store.unfiledProjects().forEach(p => opts.push(`<option value="${p.id}">${esc(p.title)}</option>`));
  sel.innerHTML = opts.join('');
}

function openQuickAdd() {
  closePalette();
  populateQuickAddProjects();
  $('#quickAddTitle').value = '';
  $('#quickAddNotes').value = '';
  $('#quickAddWhen').value = currentView.type === 'today' ? 'today' : (currentView.type === 'someday' ? 'someday' : '');
  $('#quickAddWhenDate').hidden = true;
  $('#quickAddWhenDate').value = '';
  if (currentView.type === 'project') $('#quickAddProject').value = currentView.id;
  $('#quickAddOverlay').classList.add('open');
  setTimeout(() => $('#quickAddTitle').focus(), 30);
}
function closeQuickAdd() {
  $('#quickAddOverlay').classList.remove('open');
}
function submitQuickAdd() {
  const title = $('#quickAddTitle').value.trim();
  if (!title) { closeQuickAdd(); return; }
  const notes = $('#quickAddNotes').value.trim();
  const whenSel = $('#quickAddWhen').value;
  const when = whenSel === 'date' ? ($('#quickAddWhenDate').value || todayStr()) : (whenSel || null);
  const projectId = $('#quickAddProject').value || null;
  let areaId = null;
  if (projectId) {
    const p = store.state.projects[projectId];
    areaId = p ? p.areaId : null;
  } else if (currentView.type === 'area') {
    areaId = currentView.id;
  }
  store.createTask({ title, notes, when, projectId, areaId });
  closeQuickAdd();
}

// ---------------- Command Palette ----------------
function pickViewForTask(t) {
  if (t.projectId) return { type: 'project', id: t.projectId };
  if (t.areaId) return { type: 'area', id: t.areaId };
  if (t.inInbox) return { type: 'inbox' };
  if (t.when === 'today' || t.when === 'evening') return { type: 'today' };
  if (t.when === 'someday') return { type: 'someday' };
  if (t.when && /^\d{4}-\d{2}-\d{2}$/.test(t.when)) return { type: 'upcoming' };
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
  renderAll();
}

function paletteSetActive(idx) {
  const items = $$('#paletteResults .palette-item');
  items.forEach(el => el.classList.remove('active'));
  if (items[idx]) { items[idx].classList.add('active'); items[idx].scrollIntoView({ block: 'nearest' }); }
}

function openPalette() {
  closeQuickAdd();
  $('#paletteInput').value = '';
  renderPalette();
  $('#paletteOverlay').classList.add('open');
  setTimeout(() => $('#paletteInput').focus(), 30);
}
function closePalette() {
  $('#paletteOverlay').classList.remove('open');
}

// ---------------- Notifications ----------------
let notifBannerDismissed = false;
function updateNotifBanner() {
  const banner = $('#notifBanner');
  if (!banner) return;
  if (!('Notification' in window) || Notification.permission === 'granted' || notifBannerDismissed) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  const textEl = $('#notifBannerText');
  const btn = $('#btnEnableNotif');
  if (Notification.permission === 'denied') {
    textEl.textContent = '🔕 Уведомления заблокированы в браузере — включи их в настройках сайта.';
    btn.hidden = true;
  } else {
    textEl.textContent = '🔔 Включить уведомления о напоминаниях?';
    btn.hidden = false;
  }
}

function requestNotifPermission() {
  if (!('Notification' in window)) return;
  Notification.requestPermission().then(updateNotifBanner);
}

function fireReminderNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const today = todayStr();
  store.dueReminders().forEach(t => {
    const n = new Notification(t.title, {
      body: t.notes && t.notes.trim() ? t.notes.trim() : `Напоминание на ${t.reminderTime}`,
      tag: 'task-' + t.id,
    });
    n.onclick = () => {
      window.focus();
      currentView = { type: 'today' };
      selectedTaskId = t.id;
      renderAll();
      n.close();
    };
    store.markNotified(t.id, today);
  });
}

// ---------------- Toast / Undo ----------------
let toastTimer = null;
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
    toastTimer = setTimeout(hideToast, 1800);
  });
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}
function hideToast() {
  $('#toast').hidden = true;
  clearTimeout(toastTimer);
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
  items.push({ icon: task.status === 'completed' ? '↺' : '✓', label: task.status === 'completed' ? 'Вернуть в активные' : 'Выполнить', action: () => store.toggleComplete(taskId) });
  items.push({ sep: true });
  items.push({ icon: '☀', label: 'Сегодня', action: () => store.updateTask(taskId, { when: 'today' }) });
  items.push({ icon: '📆', label: 'Завтра', action: () => store.updateTask(taskId, { when: addDays(todayStr(), 1) }) });
  items.push({ icon: '🌙', label: 'Этим вечером', action: () => store.updateTask(taskId, { when: 'evening' }) });
  items.push({ icon: '🌒', label: 'Когда-нибудь', action: () => store.updateTask(taskId, { when: 'someday' }) });
  items.push({ icon: '≡', label: 'Без даты', action: () => store.updateTask(taskId, { when: null }) });
  items.push({ sep: true });
  items.push({ icon: '⧉', label: 'Дублировать', action: () => { const c = store.duplicateTask(taskId); if (c) { selectedTaskId = c.id; renderAll(); } } });
  items.push({ icon: '🗑', label: 'Удалить в корзину', danger: true, action: () => {
    store.trashTask(taskId);
    if (selectedTaskId === taskId) selectedTaskId = null;
    showToast('Задача удалена', () => store.restoreTask(taskId));
  } });

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

  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  menu.style.left = Math.min(x, maxX) + 'px';
  menu.style.top = Math.min(y, maxY) + 'px';
}

// ---------------- Global render ----------------
function renderAll() {
  renderSidebar();
  renderMain();
  renderDetail();
}

store.subscribe(() => {
  renderSidebar();
  renderMain();
  renderDetail();
});

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
  renderAll();

  updateNotifBanner();
  const btnEnableNotif = $('#btnEnableNotif');
  if (btnEnableNotif) btnEnableNotif.addEventListener('click', requestNotifPermission);
  const btnDismissNotif = $('#btnDismissNotif');
  if (btnDismissNotif) btnDismissNotif.addEventListener('click', () => {
    notifBannerDismissed = true;
    updateNotifBanner();
  });
  setTimeout(fireReminderNotifications, 2000);
  setInterval(fireReminderNotifications, 20000);

  $('#btnQuickAdd').addEventListener('click', openQuickAdd);
  $('#btnFab').addEventListener('click', openQuickAdd);
  $('#quickAddSubmit').addEventListener('click', submitQuickAdd);
  $('#quickAddWhen').addEventListener('change', (e) => {
    $('#quickAddWhenDate').hidden = e.target.value !== 'date';
    if (e.target.value === 'date' && !$('#quickAddWhenDate').value) $('#quickAddWhenDate').value = todayStr();
  });
  $('#quickAddOverlay').addEventListener('click', (e) => { if (e.target.id === 'quickAddOverlay') closeQuickAdd(); });
  $('#quickAddTitle').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitQuickAdd();
    if (e.key === 'Escape') closeQuickAdd();
  });

  $('#btnAddArea').addEventListener('click', () => {
    const title = prompt('Название области:');
    if (title && title.trim()) store.createArea({ title: title.trim() });
  });
  $('#btnAddProject').addEventListener('click', () => {
    const title = prompt('Название проекта:');
    if (title && title.trim()) {
      let areaId = currentView.type === 'area' ? currentView.id : null;
      const p = store.createProject({ title: title.trim(), areaId });
      currentView = { type: 'project', id: p.id };
      renderAll();
    }
  });

  $('#btnExport').addEventListener('click', () => {
    const data = JSON.stringify(store.state, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tasks-backup-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
  $('#btnImport').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== 'object' || !parsed.tasks) throw new Error('bad format');
        if (confirm('Импорт заменит все текущие данные приложения этим файлом. Продолжить?')) {
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
    const tag = document.activeElement.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (!$('#taskContextMenu').hidden && e.key === 'Escape') { closeContextMenu(); return; }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if ($('#paletteOverlay').classList.contains('open')) closePalette(); else openPalette();
      return;
    }
    if ($('#paletteOverlay').classList.contains('open')) return;
    if ($('#quickAddOverlay').classList.contains('open')) return;

    if (!typing && e.key.toLowerCase() === 'n') { e.preventDefault(); openQuickAdd(); }
    if (!typing && e.key === 'Escape' && selectedTaskId) { selectedTaskId = null; renderAll(); }
    if (!typing && (e.key === 'Delete' || e.key === 'Backspace') && selectedTaskId) {
      e.preventDefault();
      const id = selectedTaskId;
      store.trashTask(id);
      selectedTaskId = null;
      showToast('Задача удалена', () => store.restoreTask(id));
    }
    if (e.metaKey && !typing && e.key.toLowerCase() === 't' && selectedTaskId) {
      e.preventDefault();
      store.updateTask(selectedTaskId, { when: 'today', notifiedOn: null });
    }
    if (e.metaKey && !typing && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && selectedTaskId) {
      const ids = $$('#taskList .task-row').map(el => el.dataset.id);
      const idx = ids.indexOf(selectedTaskId);
      if (idx !== -1) {
        e.preventDefault();
        if (e.key === 'ArrowUp' && idx > 0) store.reorderTask(selectedTaskId, ids[idx - 1]);
        else if (e.key === 'ArrowDown' && idx < ids.length - 1) store.reorderTask(selectedTaskId, ids[idx + 2] || null);
      }
    }
    if (e.metaKey && !typing && e.key === '/') {
      e.preventDefault();
      $('#app').classList.toggle('sidebar-collapsed');
    }
  });
});
