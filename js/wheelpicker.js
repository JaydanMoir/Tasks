// Барабанный выбор даты и времени в стиле iOS.
// Прокрутка нативная (scroll-snap) — на айфоне это даёт настоящую инерцию
// и отзывчивость, которую вручную на JS не воспроизвести.

const ITEM_H = 34;      // высота строки, px — должна совпадать с --wheel-item-h в CSS
const VISIBLE = 7;      // сколько строк видно; нечётное, чтобы была центральная

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pad2 = n => String(n).padStart(2, '0');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function daysInMonth(year, month /* 0-11 */) {
  return new Date(year, month + 1, 0).getDate();
}

// ---------------------------------------------------------------- одна колонка
class Wheel {
  constructor(root, { items, value, onChange }) {
    this.el = root;
    this.onChange = onChange;
    this.items = [];
    this.value = value;
    this._raf = null;
    this._settleTimer = null;

    this.el.classList.add('wheel'); // не className — иначе слетает picker-col с раскладкой
    this.el.tabIndex = 0;
    this.el.setAttribute('role', 'listbox');
    this.setItems(items, value);

    this.el.addEventListener('scroll', () => this.onScroll(), { passive: true });
    // scrollend есть не везде (Safari получил его поздно) — держим и таймер
    this._hasScrollEnd = 'onscrollend' in window;
    if (this._hasScrollEnd) this.el.addEventListener('scrollend', () => this.settle());

    this.el.addEventListener('click', (e) => {
      const row = e.target.closest('.wheel-item');
      if (row) this.scrollToIndex(Number(row.dataset.idx), true);
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const next = clamp(this.indexOfValue(this.value) + (e.key === 'ArrowDown' ? 1 : -1), 0, this.items.length - 1);
      this.scrollToIndex(next, true);
    });
  }

  setItems(items, value) {
    this.items = items;
    const spacer = `<div class="wheel-pad"></div>`;
    this.el.innerHTML = spacer + items.map((it, i) =>
      `<div class="wheel-item" data-idx="${i}" role="option">${esc(it.label)}</div>`
    ).join('') + spacer;
    this.rows = Array.from(this.el.querySelectorAll('.wheel-item'));
    const idx = Math.max(0, this.items.findIndex(it => it.value === value));
    this.value = this.items[idx] ? this.items[idx].value : null;
    this.scrollToIndex(idx, false);
  }

  indexOfValue(v) {
    const i = this.items.findIndex(it => it.value === v);
    return i === -1 ? 0 : i;
  }

  scrollToIndex(idx, smooth) {
    this.el.scrollTo({ top: idx * ITEM_H, behavior: smooth ? 'smooth' : 'auto' });
    if (!smooth) requestAnimationFrame(() => this.paint());
  }

  onScroll() {
    if (this._raf === null) this._raf = requestAnimationFrame(() => { this._raf = null; this.paint(); });
    if (this._hasScrollEnd) return;
    clearTimeout(this._settleTimer);
    this._settleTimer = setTimeout(() => this.settle(), 110);
  }

  // Наклон и затухание строк по мере удаления от центра — то, что превращает
  // плоский список в барабан. Трогаем только ближние строки, чтобы не тратить
  // кадры на сотню невидимых.
  paint() {
    const centerIdx = this.el.scrollTop / ITEM_H;
    const reach = Math.ceil(VISIBLE / 2) + 1;
    const from = Math.max(0, Math.floor(centerIdx) - reach);
    const to = Math.min(this.rows.length - 1, Math.ceil(centerIdx) + reach);

    this.rows.forEach((row, i) => {
      if (i < from || i > to) {
        // класс снимаем обязательно: уехавшая строка иначе остаётся подсвеченной
        // и в колонке оказывается два «выбранных» значения
        if (row.style.opacity !== '0') {
          row.style.opacity = '0';
          row.style.transform = '';
          row.style.filter = '';
        }
        row.classList.remove('is-selected');
        return;
      }
      const d = i - centerIdx;                       // расстояние в строках, со знаком
      const ad = Math.abs(d);
      const angle = clamp(d * 21, -72, 72);
      row.style.transform = `perspective(340px) rotateX(${angle}deg) scale(${(1 - ad * 0.045).toFixed(3)})`;
      row.style.opacity = Math.max(0, 1 - ad * 0.3).toFixed(3);
      row.style.filter = ad > 1.5 ? `blur(${Math.min(1.1, (ad - 1.5) * 0.9).toFixed(2)}px)` : '';
      row.classList.toggle('is-selected', ad < 0.5);
    });
  }

  settle() {
    const idx = clamp(Math.round(this.el.scrollTop / ITEM_H), 0, this.items.length - 1);
    const v = this.items[idx] ? this.items[idx].value : null;
    if (v === this.value) return;
    this.value = v;
    this.onChange?.(v);
  }

  destroy() {
    clearTimeout(this._settleTimer);
    if (this._raf !== null) cancelAnimationFrame(this._raf);
  }
}

// ---------------------------------------------------------------- общий пикер
let openSheet = null;

function openPicker({ title, columns, allowClear, clearLabel = 'Очистить', onPick, onColumnChange }) {
  closePicker();

  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay';
  overlay.innerHTML = `
    <div class="picker-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="picker-head">
        <button type="button" class="picker-btn" data-act="cancel">Отмена</button>
        <span class="picker-title">${esc(title)}</span>
        <button type="button" class="picker-btn strong" data-act="done">Готово</button>
      </div>
      <div class="picker-wheels" style="height:${ITEM_H * VISIBLE}px">
        <div class="picker-band" style="height:${ITEM_H}px"></div>
        ${columns.map(c => `<div class="picker-col" data-key="${esc(c.key)}" style="flex:${c.flex || 1}"></div>`).join('')}
      </div>
      ${allowClear ? `<button type="button" class="picker-clear" data-act="clear">${esc(clearLabel)}</button>` : ''}
    </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('picker-open');

  const wheels = {};
  columns.forEach(c => {
    const host = overlay.querySelector(`.picker-col[data-key="${CSS.escape(c.key)}"]`);
    wheels[c.key] = new Wheel(host, {
      items: c.items,
      value: c.value,
      onChange: (v) => onColumnChange?.(c.key, v, wheels),
    });
  });

  const values = () => Object.fromEntries(Object.entries(wheels).map(([k, w]) => [k, w.value]));

  const finish = (result) => { closePicker(); onPick?.(result); };

  overlay.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') closePicker();
    else if (act === 'done') finish(values());
    else if (act === 'clear') finish(null);
    else if (e.target === overlay) closePicker();
  });

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePicker(); }
    else if (e.key === 'Enter' && !e.target.closest('.wheel')) { e.preventDefault(); finish(values()); }
  };
  overlay.addEventListener('keydown', onKey);

  requestAnimationFrame(() => {
    overlay.classList.add('open');
    overlay.querySelector('.wheel')?.focus({ preventScroll: true });
  });

  openSheet = { overlay, wheels };
  return openSheet;
}

export function closePicker() {
  if (!openSheet) return;
  Object.values(openSheet.wheels).forEach(w => w.destroy());
  openSheet.overlay.remove();
  document.body.classList.remove('picker-open');
  openSheet = null;
}

export function isPickerOpen() {
  return !!openSheet;
}

// ---------------------------------------------------------------- дата
// Барабан для даты не прижился: чтобы попасть в «седьмое», надо было прокрутить
// три колонки, и при этом не видно ни дня недели, ни того, что рядом. Сетка
// месяца отвечает на оба вопроса сразу, а нужное число — одно касание.

const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const fmtDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const shiftDays = (dateStr, n) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return fmtDay(dt);
};

export function openDatePicker({ value, title = 'Дата', allowClear = false, clearLabel = 'Очистить', onPick }) {
  closePicker();

  const today = fmtDay(new Date());
  let selected = isDay(value) ? value : today;
  // месяц, показанный в сетке; листается независимо от выбранного дня
  let [viewY, viewM] = selected.split('-').map(Number);

  // ближайшая суббота; сегодняшнюю субботу считаем подходящей
  const weekendDate = () => {
    const now = new Date();
    return shiftDays(today, (6 - now.getDay() + 7) % 7);
  };

  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay';
  overlay.innerHTML = `
    <div class="picker-sheet cal-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="picker-head">
        <button type="button" class="picker-btn" data-act="cancel">Отмена</button>
        <span class="picker-title">${esc(title)}</span>
        <button type="button" class="picker-btn strong" data-act="done">Готово</button>
      </div>

      <div class="cal-sheet-quick">
        <button type="button" class="cal-sheet-chip" data-jump="today">Сегодня</button>
        <button type="button" class="cal-sheet-chip" data-jump="tomorrow">Завтра</button>
        <button type="button" class="cal-sheet-chip" data-jump="weekend">Выходные</button>
        <button type="button" class="cal-sheet-chip" data-jump="week">+7 дней</button>
      </div>

      <div class="cal-sheet-nav">
        <button type="button" class="cal-sheet-arrow" data-move="-1" aria-label="Предыдущий месяц">‹</button>
        <span class="cal-sheet-month" data-role="month"></span>
        <button type="button" class="cal-sheet-arrow" data-move="1" aria-label="Следующий месяц">›</button>
      </div>

      <div class="cal-sheet-weekdays">
        ${WEEKDAYS_SHORT.map(w => `<span>${w}</span>`).join('')}
      </div>
      <div class="cal-sheet-grid" data-role="grid"></div>

      ${allowClear ? `<button type="button" class="picker-clear" data-act="clear">${esc(clearLabel)}</button>` : ''}
    </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('picker-open');

  const monthEl = overlay.querySelector('[data-role="month"]');
  const gridEl = overlay.querySelector('[data-role="grid"]');

  function render() {
    monthEl.textContent = `${MONTHS[viewM - 1]} ${viewY}`;

    const firstWeekday = (new Date(viewY, viewM - 1, 1).getDay() + 6) % 7; // Пн = 0
    const total = daysInMonth(viewY, viewM - 1);
    const prevTotal = daysInMonth(viewY, viewM - 2);
    const cells = Math.ceil((firstWeekday + total) / 7) * 7;

    let html = '';
    for (let i = 0; i < cells; i++) {
      const dayNum = i - firstWeekday + 1;
      let date, label, outside = false;
      if (dayNum < 1) {
        outside = true; label = prevTotal + dayNum;
        date = fmtDay(new Date(viewY, viewM - 2, label));
      } else if (dayNum > total) {
        outside = true; label = dayNum - total;
        date = fmtDay(new Date(viewY, viewM, label));
      } else {
        label = dayNum;
        date = `${viewY}-${pad2(viewM)}-${pad2(dayNum)}`;
      }
      const cls = ['cal-sheet-day'];
      if (outside) cls.push('outside');
      if (date === today) cls.push('today');
      if (date === selected) cls.push('selected');
      html += `<button type="button" class="${cls.join(' ')}" data-day="${date}">${label}</button>`;
    }
    gridEl.innerHTML = html;

    overlay.querySelectorAll('.cal-sheet-chip').forEach(chip => {
      const target = { today, tomorrow: shiftDays(today, 1), weekend: weekendDate(), week: shiftDays(today, 7) }[chip.dataset.jump];
      chip.classList.toggle('active', target === selected);
    });
  }

  const finish = (result) => { closePicker(); onPick?.(result); };

  overlay.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') return closePicker();
    if (act === 'done') return finish(selected);
    if (act === 'clear') return finish(null);

    const move = e.target.closest('[data-move]')?.dataset.move;
    if (move) {
      const dt = new Date(viewY, viewM - 1 + Number(move), 1);
      viewY = dt.getFullYear(); viewM = dt.getMonth() + 1;
      return render();
    }

    const jump = e.target.closest('[data-jump]')?.dataset.jump;
    if (jump) {
      selected = { today, tomorrow: shiftDays(today, 1), weekend: weekendDate(), week: shiftDays(today, 7) }[jump];
      [viewY, viewM] = selected.split('-').map(Number);
      return render();
    }

    const day = e.target.closest('[data-day]')?.dataset.day;
    if (day) {
      selected = day;
      // тап по «хвосту» соседнего месяца перелистывает сетку туда же
      const [y, m] = day.split('-').map(Number);
      if (y !== viewY || m !== viewM) { viewY = y; viewM = m; }
      return render();
    }

    if (e.target === overlay) closePicker();
  });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePicker(); }
    else if (e.key === 'Enter') { e.preventDefault(); finish(selected); }
  });

  render();
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    overlay.querySelector('.cal-sheet-day.selected')?.focus({ preventScroll: true });
  });

  // closePicker перебирает wheels — у календаря барабанов нет, но ключ нужен
  openSheet = { overlay, wheels: {} };
  return openSheet;
}

// ---------------------------------------------------------------- время
export function openTimePicker({ value, title = 'Напоминание', allowClear = true, clearLabel, onPick }) {
  const m = /^(\d{2}):(\d{2})$/.exec(value || '');
  const now = new Date();
  const h0 = m ? Number(m[1]) : now.getHours();
  const min0 = m ? Number(m[2]) : 0;

  openPicker({
    title,
    allowClear,
    clearLabel: clearLabel || 'Убрать напоминание',
    columns: [
      { key: 'hour', items: Array.from({ length: 24 }, (_, i) => ({ value: i, label: pad2(i) })), value: h0 },
      { key: 'minute', items: Array.from({ length: 60 }, (_, i) => ({ value: i, label: pad2(i) })), value: min0 },
    ],
    onPick: (v) => onPick(v ? `${pad2(v.hour)}:${pad2(v.minute)}` : null),
  });
}
