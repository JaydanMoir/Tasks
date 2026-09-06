// Выгрузка резервной копии.
//
// В браузере это обычная ссылка со скачиванием. В приложении так нельзя:
// WKWebView не сохраняет файл по <a download> с blob-ссылкой — нажатие просто
// ничего не делает. Поэтому там мы пишем файл во временный каталог приложения
// и отдаём его системному листу «Поделиться»: оттуда его можно положить в
// «Файлы», отправить себе в мессенджер или в iCloud Drive.

import { isNativeApp } from './notifications.js?v=15';

const plugins = {};
function plugin(name) {
  if (!plugins[name]) plugins[name] = window.Capacitor.registerPlugin(name);
  return plugins[name];
}

// Отмена в листе «Поделиться» — не ошибка, показывать её пользователю незачем
const isCancel = (e) => /cancel/i.test(e?.message || '');

export async function exportBackup(json, filename) {
  if (!isNativeApp()) {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { ok: true, via: 'download' };
  }

  try {
    const Filesystem = plugin('Filesystem');
    const Share = plugin('Share');
    // CACHE, а не DOCUMENTS: копия нужна лишь на время показа листа,
    // складывать её внутрь приложения навсегда незачем
    await Filesystem.writeFile({
      path: filename,
      data: json,
      directory: 'CACHE',
      encoding: 'utf8',
    });
    const { uri } = await Filesystem.getUri({ path: filename, directory: 'CACHE' });
    await Share.share({
      title: 'Резервная копия задач',
      files: [uri],
    });
    return { ok: true, via: 'share' };
  } catch (e) {
    if (isCancel(e)) return { ok: true, via: 'cancelled' };
    console.error('Не удалось выгрузить копию', e);
    return { ok: false, error: e };
  }
}
