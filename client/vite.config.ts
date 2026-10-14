import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * The version shown in the corner of the main menu and in Settings, such as "v0.5.5 · f751a35".
 * A release image passes its tag and commit in (SAR_VERSION, SAR_COMMIT; see the Dockerfile);
 * anywhere else it comes from the checkout's latest tag and commit, or "dev" without git.
 */
function appVersion(): string {
  const git = (args: string) => {
    try {
      return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {
      return '';
    }
  };
  const env = (name: string) => process.env[name] ?? '';
  const version = env('SAR_VERSION') || git('describe --tags --abbrev=0') || 'dev';
  const commit = (env('SAR_COMMIT') || git('rev-parse HEAD')).slice(0, 7);
  return commit ? `${version} · ${commit}` : version;
}

export default defineConfig({
  // The bot benchmark's worker shares code with the page, so it is a module like the page.
  worker: { format: 'es' },
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/ws': { target: 'ws://localhost:7777', ws: true },
      '/rooms.json': 'http://localhost:7777',
      '/api': 'http://localhost:7777',
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        editor: fileURLToPath(new URL('editor.html', import.meta.url)),
        frametest: fileURLToPath(new URL('frametest.html', import.meta.url)),
      },
    },
  },
});
