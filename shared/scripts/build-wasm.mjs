/**
 * Compiles the walking map's searches (assembly/nav.ts, AssemblyScript) to WebAssembly and
 * writes them into src/bots/navcore.wasm.ts, so every runtime loads them from the code itself.
 *
 *   npm run build:wasm -w @sar/shared
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import asc from 'assemblyscript/asc';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const out = here('../src/bots/navcore.wasm.ts');
const { error, stderr } = await asc.main([
  here('../assembly/nav.ts'),
  '-O3',
  '--runtime',
  'stub',
  '--noAssert',
  '--outFile',
  here('../assembly/nav.wasm'),
]);
if (error) {
  console.error(stderr.toString());
  process.exit(1);
}
const bytes = readFileSync(here('../assembly/nav.wasm'));
writeFileSync(
  out,
  '// Made by `npm run build:wasm -w @sar/shared` from assembly/nav.ts: do not edit.\n' +
    `export const NAV_WASM =\n  '${bytes.toString('base64')}';\n`,
);
console.log(`${bytes.length} bytes of WebAssembly written to src/bots/navcore.wasm.ts`);
