// Голосовой ввод задачи через Web Speech API.
// Распознанный текст просто кладётся в поле быстрого добавления — дату, время,
// приоритет и теги из него вычленяет тот же parseQuickInput, что и при наборе руками.

const Impl = window.SpeechRecognition || window.webkitSpeechRecognition;

// Микрофон работает только в защищённом контексте: по http с телефона в локальной
// сети API есть, но кинет not-allowed — лучше сразу спрятать кнопку.
export function speechSupported() {
  return Boolean(Impl) && window.isSecureContext;
}

const ERRORS = {
  'not-allowed': 'Нет доступа к микрофону',
  'service-not-allowed': 'Нет доступа к микрофону',
  'no-speech': 'Не расслышал, попробуйте ещё раз',
  'audio-capture': 'Микрофон не найден',
  network: 'Нет связи с сервисом распознавания',
};

// Речь приходит без пунктуации и с заглавной буквы, а числа диктор произносит
// по-разному — приводим к виду, который понимает разбор строки.
export function normalizeSpeech(text) {
  let s = String(text || '').trim();
  // Хвостовая точка ломает разбор времени: «в 13.30.» из-за неё распадается на 13:00
  s = s.replace(/[.,;!]+$/, '');
  // «в 13 30» → «в 13:30»: распознавание нередко разделяет часы и минуты пробелом
  s = s.replace(/(^|\s)(в|к)\s+(\d{1,2})\s+(\d{2})(?=\s|$)/gi, (full, lead, prep, h, m) =>
    Number(h) < 24 && Number(m) < 60 ? `${lead}${prep} ${h}:${m}` : full);
  // «в 13.30» → «в 13:30»: точка в разборе допустима, но двоеточие надёжнее
  s = s.replace(/(^|\s)(в|к)\s+(\d{1,2})\.(\d{2})(?=\s|$)/gi, (full, lead, prep, h, m) =>
    Number(h) < 24 && Number(m) < 60 ? `${lead}${prep} ${h}:${m}` : full);
  return s.replace(/\s{2,}/g, ' ').trim();
}

// Один сеанс распознавания: старт по кнопке, стоп по паузе в речи или повторному нажатию.
export function createVoiceInput({ lang = 'ru-RU', onInterim, onFinal, onState, onError } = {}) {
  let rec = null;
  let active = false;
  let watchdog = null;

  const setActive = (v) => {
    if (active === v) return;
    active = v;
    onState?.(active);
  };

  // Страховка на случай, когда финальный результат так и не пришёл: без неё
  // микрофон остаётся занятым, а в островке горит оранжевая точка.
  const armWatchdog = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => cancel(), 20000);
  };

  // stop() даёт распознаванию доучесть услышанное и вернуть последний кусок.
  function stop() {
    if (rec) rec.stop();
  }

  // cancel() рвёт сеанс сразу, не дожидаясь результата — так микрофон
  // освобождается быстрее. Для закрытия окна нужен именно он.
  function cancel() {
    clearTimeout(watchdog);
    if (!rec) return;
    const r = rec;
    rec = null;
    try { r.abort(); } catch { /* уже закрыт */ }
    setActive(false);
  }

  function start() {
    if (!speechSupported() || active) return;
    rec = new Impl();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => { setActive(true); armWatchdog(); };

    rec.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (final) {
        onFinal?.(normalizeSpeech(final));
        // iOS не присылает onend сам: с continuous=false сеанс всё равно висит,
        // и микрофон остаётся захваченным до сворачивания приложения. Текст уже
        // получен — обрываем не дожидаясь.
        cancel();
        return;
      }
      armWatchdog();
      if (interim) onInterim?.(interim.trim());
    };

    rec.onerror = (e) => {
      // aborted — это наш собственный stop(), сообщать не о чем
      if (e.error === 'aborted') return;
      onError?.(ERRORS[e.error] || 'Не удалось распознать речь');
    };

    // onend приходит и после ошибки, и после нормального завершения — один выход из режима
    rec.onend = () => { clearTimeout(watchdog); rec = null; setActive(false); };

    try {
      rec.start();
    } catch {
      rec = null;
      setActive(false);
      onError?.('Не удалось включить микрофон');
    }
  }

  return {
    start,
    stop,
    cancel,
    toggle: () => (active ? stop() : start()),
    isActive: () => active,
  };
}
