// Starts the packed app, waits for its window to load the game over the app's own
// certificate, then has the server's smoke test join a room. Exits non-zero on failure.
//
//   node desktop/scripts/smoke.mjs <path to the app's executable>
//
// Without a display (a Linux runner), run it under `xvfb-run -a`.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exe = process.argv[2];
if (!exe) throw new Error('usage: smoke.mjs <path to the app executable>');
const port = 7700 + Math.floor(Math.random() * 90);
const dataDir = mkdtempSync(join(tmpdir(), 'sar-'));
const env = { ...process.env, PORT: String(port), SAR_DATA_DIR: dataDir };
// Chromium's sandbox needs user namespaces, which Ubuntu runners' AppArmor rules deny.
const app = spawn(exe, process.platform === 'linux' ? ['--no-sandbox'] : [], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
const done = (code, why) => {
  if (code) console.error(`desktop smoke test failed: ${why}\n--- app output ---\n${output}`);
  app.kill();
  process.exit(code);
};
setTimeout(() => done(1, 'the window never loaded the game'), 90_000).unref();
app.on('exit', (code) => done(1, `the app exited with ${code}`));
const onOutput = (d) => {
  output += d;
  if (!output.includes(`window loaded https://localhost:${port}/`)) return;
  app.stdout.off('data', onOutput);
  const smoke = spawnSync(
    'npm',
    // Trusting the certificate the app made, as the app's own window does.
    [
      'run',
      'smoke',
      '-w',
      '@sar/server',
      '--',
      `https://localhost:${port}`,
      '--ca',
      join(dataDir, 'cert.pem'),
    ],
    {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  );
  app.removeAllListeners('exit');
  done(smoke.status ?? 1, 'the server smoke test failed');
};
app.stdout.on('data', onOutput);
app.stderr.on('data', (d) => (output += d));
