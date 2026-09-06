// Собирает www/ — ровно те файлы, что уходят внутрь приложения.
// Копируем выборочно: webDir целиком уезжает в бандл, и корень проекта туда
// класть нельзя — там node_modules, ios/ и сам .git.
import { cp, rm, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');
const ASSETS = ['index.html', 'css', 'js'];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const name of ASSETS) {
  await cp(join(root, name), join(out, name), { recursive: true });
}

// Рантайм Capacitor берём из node_modules, а не держим копию в репозитории:
// иначе он молча разъедется с версией плагинов при обновлении.
const runtime = join(root, 'node_modules/@capacitor/core/dist/capacitor.js');
await cp(runtime, join(out, 'capacitor.js'));
// Вторая копия — в корень проекта: index.html там открывается напрямую с dev-сервера,
// без сборки, и иначе ловил бы 404 на этот скрипт. В git не попадает.
await cp(runtime, join(root, 'capacitor.js'));

console.log(`www/ собран: ${ASSETS.join(', ')}, capacitor.js`);
