// Жест «назад» от левого края экрана.
//
// Приложение одностраничное: «экран задачи» и боковое меню — это состояния CSS,
// а не переходы по истории. Поэтому системный свайп WebView тут ничего не листает,
// и жест приходится вести самим: тянуть панель за пальцем и доводить анимацией.

const EDGE = 24;          // ширина зоны у левого края, где жест считается «назад»
const DECIDE = 8;         // на сколько надо сдвинуться, чтобы определить направление
const RATIO = 0.35;       // доля ширины панели, после которой жест засчитан
const FLICK = 0.5;        // px/мс — быстрый бросок засчитываем, не дотянув до порога
const EASE = 'transform 0.24s cubic-bezier(0.32, 0.72, 0, 1)';

export const EDGE_ZONE = EDGE;

const isPhoneLayout = () => window.matchMedia('(max-width: 700px)').matches;

// Общая механика: определяем направление один раз, тянем за пальцем, на отпускании
// доводим до ближайшего состояния — либо по порогу пути, либо по скорости броска.
function track(el, { onStart, onMove, onEnd, canStart }) {
  let startX = 0, startY = 0, startT = 0, dx = 0;
  let tracking = false, decided = false, horizontal = false;

  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || !canStart(e.touches[0])) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startT = e.timeStamp;
    dx = 0;
    tracking = true; decided = false; horizontal = false;
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const t = e.touches[0];
    const ddx = t.clientX - startX;
    const ddy = t.clientY - startY;

    if (!decided) {
      if (Math.abs(ddx) < DECIDE && Math.abs(ddy) < DECIDE) return;
      decided = true;
      // порог 1.4 — тот же, что у свайпа по строке: вертикальная прокрутка важнее
      horizontal = Math.abs(ddx) > Math.abs(ddy) * 1.4;
      if (horizontal) onStart();
    }
    if (!horizontal) { tracking = false; return; }

    e.preventDefault();   // забираем жест у прокрутки
    dx = ddx;
    onMove(dx);
  }, { passive: false });

  const finish = (e) => {
    if (!tracking) { return; }
    tracking = false;
    if (!horizontal) return;
    const elapsed = Math.max(1, (e?.timeStamp ?? performance.now()) - startT);
    onEnd(dx, dx / elapsed);
  };
  el.addEventListener('touchend', finish);
  el.addEventListener('touchcancel', () => { tracking = false; onEnd(0, 0); });
}

// ---- «Назад» из карточки задачи ----
export function bindDetailBackSwipe(panel, { isOpen, onClose }) {
  let width = 0;

  track(panel, {
    canStart: (t) => isPhoneLayout() && isOpen() && t.clientX <= EDGE,
    onStart: () => {
      width = panel.offsetWidth || window.innerWidth;
      panel.style.transition = 'none';
    },
    onMove: (dx) => {
      panel.style.transform = `translateX(${Math.max(0, dx)}px)`;
    },
    onEnd: (dx, v) => {
      const done = dx > width * RATIO || v > FLICK;
      panel.style.transition = EASE;
      panel.style.transform = done ? `translateX(${width}px)` : '';
      if (!done) {
        setTimeout(() => { panel.style.transition = ''; }, 260);
        return;
      }
      // снимаем сдвиг только после закрытия, иначе панель на кадр прыгает обратно
      setTimeout(() => {
        onClose();
        panel.style.transition = '';
        panel.style.transform = '';
      }, 240);
    },
  });
}

// ---- Выдвижное меню: открыть от края, закрыть свайпом влево ----
export function bindSidebarSwipe(app, sidebar, scrim) {
  let width = 0;
  let opening = false;

  const paint = (offset) => {              // offset: 0 — закрыто, width — открыто
    const clamped = Math.max(0, Math.min(width, offset));
    sidebar.style.transform = `translateX(${clamped - width}px)`;
    scrim.style.opacity = String(clamped / width);
  };

  const settle = (open) => {
    sidebar.style.transition = EASE;
    scrim.style.transition = 'opacity 0.24s ease';
    paint(open ? width : 0);
    setTimeout(() => {
      app.classList.toggle('sidebar-open', open);
      // инлайновые стили обязательно снимаем: дальше состоянием управляет класс
      sidebar.style.transition = sidebar.style.transform = '';
      scrim.style.transition = scrim.style.opacity = scrim.style.pointerEvents = '';
    }, 250);
  };

  const start = () => {
    width = sidebar.offsetWidth || Math.min(window.innerWidth * 0.84, 300);
    opening = !app.classList.contains('sidebar-open');
    sidebar.style.transition = scrim.style.transition = 'none';
    scrim.style.pointerEvents = 'auto';
    // на время жеста классом не управляем — панель ведём вручную от текущей позиции
    app.classList.remove('sidebar-open');
  };

  track(app, {
    canStart: (t) => {
      if (!isPhoneLayout()) return false;
      // Панель деталей лежит внутри #app, и её жест всплывает сюда же. Пока
      // карточка открыта, левый край принадлежит только «назад» — иначе одно
      // движение закрывало карточку и тут же выдвигало меню.
      if (app.classList.contains('detail-open')) return false;
      const open = app.classList.contains('sidebar-open');
      return open ? true : t.clientX <= EDGE;
    },
    onStart: start,
    onMove: (dx) => paint(opening ? dx : width + dx),
    onEnd: (dx, v) => {
      if (!width) return;
      const from = opening ? 0 : width;
      const offset = from + dx;
      const open = opening
        ? (offset > width * RATIO || v > FLICK)
        : !(offset < width * (1 - RATIO) || v < -FLICK);
      settle(open);
    },
  });
}
