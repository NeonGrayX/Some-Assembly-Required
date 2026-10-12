// Bundles the app's main process, the game server included, into one file, so the installer
// needs no node_modules. The built client is added separately (electron-builder.yml).
import { build } from 'esbuild';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../../client/dist/index.html', import.meta.url))) {
  throw new Error('The client is not built: run `npm run build` in the repository root first.');
}

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  minify: true,
  // ws loads these native speed-ups only if they are installed; they are not.
  external: ['electron', 'bufferutil', 'utf-8-validate'],
  logLevel: 'info',
});
