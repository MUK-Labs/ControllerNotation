import { copyFile, mkdir } from 'node:fs/promises';
await mkdir(new URL('../web/vendor/', import.meta.url), {recursive:true});
for (const [source,target] of [['esm/browser.js','fflate.js'],['LICENSE','fflate-LICENSE.txt']]) {
  await copyFile(new URL(`../node_modules/fflate/${source}`,import.meta.url),new URL(`../web/vendor/${target}`,import.meta.url));
}
