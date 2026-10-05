import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

/** A file of the game's client, ready to send. */
export interface StaticFile {
  data: Buffer;
  type: string;
  /** Built files with a content hash in their name never change, so browsers may keep them. */
  immutable: boolean;
}

/** Looks up a client file by its path relative to the site root ('' is the root). */
export type FileSource = (path: string) => StaticFile | null;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
};

const file = (rel: string, data: Buffer): StaticFile => ({
  data,
  type: MIME[extname(rel)] ?? 'application/octet-stream',
  immutable: rel.startsWith('assets/'),
});

/** Cleans a URL path into a relative path, or null if it tries to leave the site. */
export function relativePath(urlPath: string): string | null {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/\\/g, '/').replace(/^\/+/, '');
  if (rel.split('/').includes('..')) return null;
  return rel;
}

/** Serves the client from a folder on disk (the client's `dist` after `npm run build`). */
export function dirFiles(dir: string): FileSource {
  const root = resolve(dir);
  return (rel) => {
    const path = join(root, rel);
    if (path !== root && !path.startsWith(root + sep)) return null;
    if (!existsSync(path) || statSync(path).isDirectory()) return null;
    return file(rel, readFileSync(path));
  };
}

/**
 * Serves the client from files embedded in the host executable: `paths` maps each site path
 * to where the executable's bundled file system keeps it.
 */
export function embeddedFiles(paths: Record<string, string>): FileSource {
  const cache = new Map<string, StaticFile>();
  return (rel) => {
    const path = paths[rel];
    if (path === undefined) return null;
    let f = cache.get(rel);
    if (!f) cache.set(rel, (f = file(rel, readFileSync(path))));
    return f;
  };
}
