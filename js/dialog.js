// Свои диалоги вместо системных prompt() и confirm().
//
// Браузерные подписывают кнопки по-английски («Ok», «Cancel») и рисуются
// средствами системы — внутри приложения это выглядит чужеродно и никак не
// поддаётся оформлению. Здесь те же два сценария, но своей вёрсткой.

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let openDialog = null;

function close(result, resolve) {
  if (!openDialog) return;
  openDialog.overlay.remove();
  openDialog = null;
  resolve(result);
}

function build({ title, message, inputHtml, confirmLabel, danger }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay dialog-overlay open';
  overlay.innerHTML = `
    <div class="modal dialog" role="dialog" aria-modal="true">
      <div class="dialog-title">${esc(title)}</div>
      ${message ? `<div class="dialog-message">${esc(message)}</div>` : ''}
      ${inputHtml || ''}
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-act="cancel">Отмена</button>
        <button type="button" class="dialog-btn strong ${danger ? 'danger' : ''}" data-act="ok">${esc(confirmLabel)}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  return overlay;
}

// Возвращает введённый текст или null, если отменили
export function askText({ title, value = '', placeholder = '', confirmLabel = 'Готово' }) {
  return new Promise(resolve => {
    const overlay = build({
      title,
      inputHtml: `<input type="text" class="dialog-input" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" enterkeyhint="done">`,
      confirmLabel,
    });
    const input = overlay.querySelector('.dialog-input');
    openDialog = { overlay };

    const done = () => {
      const v = input.value.trim();
      close(v || null, resolve);
    };
    overlay.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'ok') done();
      else if (act === 'cancel' || e.target === overlay) close(null, resolve);
    });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); done(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null, resolve); }
    });
    // задержка — иначе на телефоне клавиатура открывается раньше самого окна
    setTimeout(() => { input.focus(); input.select(); }, 40);
  });
}

// Возвращает true, если подтвердили
export function askConfirm({ title, message = '', confirmLabel = 'Продолжить', danger = false }) {
  return new Promise(resolve => {
    const overlay = build({ title, message, confirmLabel, danger });
    openDialog = { overlay };
    overlay.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'ok') close(true, resolve);
      else if (act === 'cancel' || e.target === overlay) close(false, resolve);
    });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false, resolve); }
      else if (e.key === 'Enter') { e.preventDefault(); close(true, resolve); }
    });
    setTimeout(() => overlay.querySelector('[data-act="ok"]').focus(), 40);
  });
}
