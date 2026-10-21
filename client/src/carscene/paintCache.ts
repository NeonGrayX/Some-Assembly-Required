import * as THREE from 'three';

/**
 * The big painted textures (see `paintedOnce`) kept in the browser between visits, so a map's
 * ground is painted on its first visit only, not on every page load. Each is stored with the
 * game's version: a new version (a new commit) may paint them differently, so it paints them
 * afresh and the old ones are cleared out. Without storage (a private window, or none at all)
 * they are painted every time, as before.
 */

const DB = 'sar-painted';
const STORE = 'textures';
/** The build the textures were painted by; without a commit to tell builds apart, none are kept. */
const VERSION =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__.includes('·') ? __APP_VERSION__ : '';

/** A painted texture as stored: its pixels and how it is sampled. */
interface Stored {
  key: string;
  version: string;
  width: number;
  height: number;
  data: Uint8Array;
  colorSpace: string;
  magFilter: THREE.MagnificationTextureFilter;
  minFilter: THREE.MinificationTextureFilter;
  wrapS: THREE.Wrapping;
  wrapT: THREE.Wrapping;
  anisotropy: number;
  generateMipmaps: boolean;
}

/** What was stored on earlier visits, once it is read (see `loadPaintings`). */
const stored = new Map<string, Stored>();
let db: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  db ??= new Promise((resolve) => {
    if (!VERSION || typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return db;
}

/**
 * Reads the textures painted on earlier visits, dropping those an older version painted. Never
 * fails: whatever cannot be read is painted again when it is needed.
 */
export async function loadPaintings(): Promise<void> {
  const d = await open();
  if (!d) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = d.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const s = cursor.value as Stored;
        if (s.version === VERSION) stored.set(s.key, s);
        else cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** The texture stored for `key` on an earlier visit, made anew, or null. */
export function storedPainting(key: string): THREE.DataTexture | null {
  const s = stored.get(key);
  if (!s) return null;
  stored.delete(key);
  const t = new THREE.DataTexture(s.data, s.width, s.height, THREE.RGBAFormat);
  t.colorSpace = s.colorSpace;
  t.magFilter = s.magFilter;
  t.minFilter = s.minFilter;
  t.wrapS = s.wrapS;
  t.wrapT = s.wrapT;
  t.anisotropy = s.anisotropy;
  t.generateMipmaps = s.generateMipmaps;
  t.needsUpdate = true;
  return t;
}

/** Keeps a freshly painted texture for the next visit, in the background. */
export function storePainting(key: string, t: THREE.DataTexture): void {
  const { data, width, height } = t.image as { data: Uint8Array; width: number; height: number };
  void open().then((d) => {
    if (!d) return;
    const s: Stored = {
      key,
      version: VERSION,
      width,
      height,
      data,
      colorSpace: t.colorSpace,
      magFilter: t.magFilter,
      minFilter: t.minFilter,
      wrapS: t.wrapS,
      wrapT: t.wrapT,
      anisotropy: t.anisotropy,
      generateMipmaps: t.generateMipmaps,
    };
    try {
      d.transaction(STORE, 'readwrite').objectStore(STORE).put(s);
    } catch {
      // Out of room, or storage turned off: painted again next time.
    }
  });
}
