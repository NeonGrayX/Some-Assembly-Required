/**
 * The desktop app: starts the game server inside the app, the same one the host executable
 * runs, and shows the game in its own window. Friends on the same network can still join
 * from their browser at the address in the window's title.
 *
 * Bundled into dist/main.cjs by scripts/bundle.mjs; electron-builder packs that and the
 * built client (client/dist) into the installer.
 */
import { createServer } from 'node:net';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, Menu, session, shell } from 'electron';
import { lanAddresses } from '../../server/src/addresses.ts';
import { runServer } from '../../server/src/app.ts';
import type { RunningServer } from '../../server/src/app.ts';
import { loadOrCreateCert } from '../../server/src/cert.ts';
import { dirFiles } from '../../server/src/files.ts';
import { dataDir } from '../../server/src/host.ts';

/** The host app's port, so friends type the same address whichever one is running. */
const FIRST_PORT = Number(process.env.PORT ?? 7777);
/** Ports to try after it when it is taken (by the host app, say). */
const SPARE_PORTS = 10;
/**
 * Permissions the game asks for: the microphone for voice chat, pointer lock for the mouse
 * look, the clipboard for "Copy link", and fullscreen. Everything else is refused.
 */
const ALLOWED = new Set(['media', 'pointerLock', 'clipboard-sanitized-write', 'fullscreen']);

const clientDir = app.isPackaged
  ? join(process.resourcesPath, 'client')
  : join(__dirname, '../../client/dist');

let server: RunningServer | null = null;
let win: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  // A second start would only find the port taken: show the window that is already open.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(start, (err: Error) => fatal(err));
}

async function start(): Promise<void> {
  try {
    const lan = lanAddresses();
    // HTTPS, like the host app, so friends joining from a browser get voice chat too.
    const tls = await loadOrCreateCert(
      dataDir(),
      lan.map((a) => a.address),
    );
    server = await runServer({ port: await freePort(), files: dirFiles(clientDir), tls });
    const port = server.port;

    // The certificate is the one made above, which no authority signed. Trust exactly it.
    const ours = normalise(tls.cert);
    app.on('certificate-error', (event, _contents, _url, _error, certificate, callback) => {
      const trusted = normalise(certificate.data) === ours;
      if (trusted) event.preventDefault();
      callback(trusted);
    });
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(ALLOWED.has(permission)),
    );
    session.defaultSession.setPermissionCheckHandler((_contents, permission) =>
      ALLOWED.has(permission),
    );

    const likely = lan.find((a) => a.likelyLan);
    const title = likely
      ? `Some Assembly Required (friends join at https://${likely.address}:${port})`
      : 'Some Assembly Required';
    Menu.setApplicationMenu(null);
    win = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 800,
      minHeight: 500,
      title,
      backgroundColor: '#000000',
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    // The page sets its own title; keep the one with the address.
    win.on('page-title-updated', (event) => event.preventDefault());
    // Links out of the game (a help page, say) open in the player's browser, not in here.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).host === `localhost:${port}`) return;
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    });
    win.webContents.on('did-finish-load', () => console.log(`window loaded ${url(port)}`));
    win.on('closed', () => (win = null));
    await win.loadURL(url(port));
  } catch (err) {
    fatal(err as Error);
  }
}

const url = (port: number) => `https://localhost:${port}/`;

/** The first port from FIRST_PORT on that nothing else is listening on. */
async function freePort(): Promise<number> {
  for (let port = FIRST_PORT; port <= FIRST_PORT + SPARE_PORTS; port++) {
    const free = await new Promise<boolean>((done) => {
      const probe = createServer();
      probe.once('error', () => done(false));
      probe.listen(port, () => probe.close(() => done(true)));
    });
    if (free) return port;
  }
  throw new Error(
    `ports ${FIRST_PORT} to ${FIRST_PORT + SPARE_PORTS} are all in use. Is the game already running?`,
  );
}

const normalise = (pem: string) => pem.replace(/\s+/g, '');

function fatal(err: Error): void {
  console.error(err);
  dialog.showErrorBox('Some Assembly Required could not start', err.message);
  app.exit(1);
}

app.on('window-all-closed', () => app.quit());

let stopping = false;
app.on('before-quit', (event) => {
  if (!server || stopping) return;
  // Let the server say goodbye to anyone still connected before the app goes.
  event.preventDefault();
  stopping = true;
  void server.close().finally(() => app.quit());
});
