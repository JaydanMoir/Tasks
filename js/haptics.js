// Тактильная отдача.
//
// В вебе на iOS её нет вовсе: navigator.vibrate в Safari не реализован. В
// нативной сборке отдаём в Taptic Engine через плагин, в браузере — тихо ничего.

let plugin = null;
function haptics() {
  if (!window.Capacitor?.isNativePlatform?.()) return null;
  if (!plugin) plugin = window.Capacitor.registerPlugin('Haptics');
  return plugin;
}

// Ошибку глушим намеренно: отдача — украшение, ронять из-за неё действие нельзя
const quiet = (p) => { p?.catch?.(() => {}); };

// лёгкий щелчок — подтверждение мелкого действия (галочка, выбор в списке)
export function tapLight() {
  quiet(haptics()?.impact({ style: 'LIGHT' }));
}

// более весомый — необратимое или заметное действие (удаление, добавление)
export function tapMedium() {
  quiet(haptics()?.impact({ style: 'MEDIUM' }));
}

// системный «успех» — двойной, отличается от простого удара на ощупь
export function tapSuccess() {
  quiet(haptics()?.notification({ type: 'SUCCESS' }));
}
