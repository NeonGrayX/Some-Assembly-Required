import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirFiles } from './files.ts';
import { runHost } from './host.ts';

// `npm start` / `npm run dev`: the client comes from client/dist, over plain HTTP by default
// (the Vite dev server proxies to it, and on a VPS a reverse proxy adds HTTPS). The host
// executable (scripts/build-host.ts) embeds the client and defaults to HTTPS instead.
await runHost({
  files: dirFiles(
    resolve(process.env.STATIC_DIR ?? join(fileURLToPath(import.meta.url), '../../../client/dist')),
  ),
  https: false,
  open: false,
  pauseOnError: false,
});
