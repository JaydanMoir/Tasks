// Значок с числом на иконке приложения.
//
// Плагин уведомлений его не умеет вовсе — у него нет ни поля badge в схеме,
// ни метода установки. Поэтому отдельный плагин, и только в нативной сборке:
// в браузере иконки нет и ставить значок некуда.

let plugin = null;
function badge() {
  if (!window.Capacitor?.isNativePlatform?.()) return null;
  if (!plugin) plugin = window.Capacitor.registerPlugin('Badge');
  return plugin;
}

// Ошибки глушим: значок — украшение, ронять из-за него ничего нельзя.
// Разрешение спрашиваем один раз, дальше плагин помнит ответ сам.
let asked = false;

export async function setBadge(count) {
  const b = badge();
  if (!b) return;
  try {
    if (!asked) { asked = true; await b.checkPermissions().then(r => r.display === 'granted' ? null : b.requestPermissions()); }
    if (count > 0) await b.set({ count });
    else await b.clear();
  } catch (_) { /* значок не главное */ }
}
