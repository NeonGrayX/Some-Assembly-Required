import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { lanAddresses } from './addresses.ts';
import { runServer } from './app.ts';
import { loadOrCreateCert } from './cert.ts';
import { clientIpHeaderFromEnv } from './limits.ts';
import type { FileSource } from './files.ts';

export interface HostDefaults {
  files: FileSource;
  /** Serve HTTPS unless told `--http`. */
  https: boolean;
  /** Open the game in the browser once running, unless told `--no-open`. */
  open: boolean;
  /** Keep the window open after an error, so someone who double-clicked can read it. */
  pauseOnError: boolean;
}

/** The port the game listens on unless told otherwise (`--port`, or the PORT environment variable). */
export const DEFAULT_PORT = 7777;

const HELP = `Some Assembly Required host

Starts the game on this computer. Everyone on the same network joins from their browser
at the address it prints.

Options:
  --port <n>     Port to use (default ${DEFAULT_PORT}, or the PORT environment variable)
  --http         Plain HTTP instead of HTTPS (no certificate warning; voice chat will
                 need HTTPS once it exists)
  --https        HTTPS with a self-signed certificate
  --open         Open the game in your browser once running
  --no-open      Do not open the browser
  --help         Show this help
`;

interface Options {
  port: number;
  https: boolean;
  open: boolean;
}

/** A port number from the command line or the environment; throws on anything else. */
function portNumber(v: string | undefined): number {
  const port = Number(v);
  if (!v || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`Not a port number: ${v}`);
  return port;
}

/** Reads the command line over the environment and the defaults. Returns null for `--help`. */
export function parseArgs(
  argv: string[],
  defaults: { https: boolean; open: boolean },
  env: NodeJS.ProcessEnv = process.env,
) {
  const o: Options = {
    port: env.PORT === undefined ? DEFAULT_PORT : portNumber(env.PORT),
    ...defaults,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') return null;
    else if (a === '--http') o.https = false;
    else if (a === '--https') o.https = true;
    else if (a === '--open') o.open = true;
    else if (a === '--no-open') o.open = false;
    else if (a === '--port' || a.startsWith('--port=')) {
      o.port = portNumber(a.includes('=') ? a.split('=')[1] : argv[++i]);
    } else throw new Error(`Unknown option: ${a} (try --help)`);
  }
  return o;
}

/** Where the host keeps its certificate and the community page's shared builds between runs. */
export const dataDir = () => process.env.SAR_DATA_DIR ?? join(homedir(), '.some-assembly-required');

/** Starts the game server and tells the person running it how others can join. */
export async function runHost(defaults: HostDefaults): Promise<void> {
  let port: number | null = null;
  try {
    const o = parseArgs(process.argv.slice(2), defaults);
    if (!o) {
      console.log(HELP);
      return;
    }
    port = o.port;
    const lan = lanAddresses();
    const tls = o.https
      ? await loadOrCreateCert(
          dataDir(),
          lan.map((a) => a.address),
        )
      : null;
    const server = await runServer({
      port: o.port,
      files: defaults.files,
      tls,
      forumDir: process.env.SAR_FORUM_DIR ?? join(dataDir(), 'forum'),
      forumAdminKey: process.env.SAR_FORUM_ADMIN_KEY,
      clientIpHeader: clientIpHeaderFromEnv(),
    });
    const scheme = o.https ? 'https' : 'http';
    const url = (host: string) => `${scheme}://${host}:${server.port}`;

    console.log('');
    console.log('  Some Assembly Required is running.');
    console.log('');
    console.log(`  You play at:      ${url('localhost')}`);
    // When nothing looks like a home network, show everything rather than nothing.
    const likely = lan.some((a) => a.likelyLan) ? lan.filter((a) => a.likelyLan) : lan;
    const others = lan.filter((a) => !likely.includes(a));
    likely.forEach((a, i) =>
      console.log(`  ${i ? '                  ' : 'Friends join at:  '}${url(a.address)}`),
    );
    if (!likely.length) console.log('  No network found: only you can play on this computer.');
    if (others.length) {
      console.log('');
      console.log('  Other addresses (VPNs, virtual machines; usually not the one you want):');
      for (const a of others) console.log(`    ${url(a.address)}  (${a.adapter})`);
    }
    console.log('');
    if (o.https) {
      console.log('  Browsers warn about the certificate the first time: it is made by this');
      console.log('  app rather than a certificate authority. Click "Advanced" and then');
      console.log('  "Proceed" (or "Accept the risk") to continue.');
    }
    console.log('  If your firewall asks, allow access on private networks.');
    console.log('  Close this window (or press Ctrl+C) to stop the game.');
    console.log('');
    if (o.open) openBrowser(url('localhost'));

    const stop = () => {
      void server.close().then(() => process.exit(0));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    const message =
      e.code === 'EADDRINUSE'
        ? `port ${port} is already in use. Is the game already running? Close it, or ` +
          'start this one with --port and another number.'
        : e.message;
    console.error(`\n  Could not start: ${message}\n`);
    if (defaults.pauseOnError && process.stdin.isTTY) {
      console.error('  Press Enter to close.');
      process.stdin.once('data', () => process.exit(1));
    } else process.exit(1);
  }
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // No browser to open (a server without a desktop): the printed address is enough.
  }
}
