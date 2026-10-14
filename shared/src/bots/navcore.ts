import { NAV_WASM } from './navcore.wasm.ts';

/**
 * The walking map's searches compiled to WebAssembly (from `shared/assembly/nav.ts`, built with
 * `npm run build:wasm -w @sar/shared`). They work out exactly what `NavGrid`'s own JavaScript
 * does, sum for sum, so the bots move the same either way; it only goes faster. Until
 * `loadNavCore` has finished (and wherever WebAssembly is missing) the JavaScript is used.
 */

/** What the module exports (see `shared/assembly/nav.ts`). */
export interface NavCore {
  memory: { buffer: ArrayBuffer };
  MAX_OTHERS: { value: number };
  MAX_PLATES: { value: number };
  MAX_LOOSE: { value: number };
  setup(
    nodes: number,
    links: number,
    cols: number,
    x0: number,
    z0: number,
    nx: number,
    nz: number,
  ): number;
  setMain(main: number): void;
  setPlates(count: number): void;
  crossesPlate(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number;
  straight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number;
  path(
    from: number,
    goals: number,
    withCosts: number,
    blocked: number,
    others: number,
    loose: number,
    trip: number,
    feet: number,
  ): number;
}

// Just what is used of WebAssembly, so the shared code needs neither the DOM's types nor Node's.
interface Wasm {
  compile(bytes: Uint8Array): Promise<object>;
  instantiate(module: object, imports: object): Promise<{ exports: object }>;
  Instance: new (module: object, imports: object) => { exports: object };
}
declare const WebAssembly: Wasm | undefined;
declare const atob: (s: string) => string;
declare const window: unknown;
declare const document: unknown;

let module: object | null = null;
let loading: Promise<void> | null = null;

const imports = {
  env: {
    abort: () => {
      throw new Error('The walking map module stopped.');
    },
  },
};

/** Compiles the module, once; resolves (without it) if this runtime cannot. */
export function loadNavCore(): Promise<void> {
  loading ??= (async () => {
    try {
      if (typeof WebAssembly === 'undefined') return;
      const bytes = Uint8Array.from(atob(NAV_WASM), (c) => c.charCodeAt(0));
      module = await WebAssembly.compile(bytes);
    } catch {
      module = null;
    }
  })();
  return loading;
}

/**
 * A fresh instance of the module for one walking map, handed to `ready`: right away where that
 * is allowed, or as soon as it is made on a page's main thread (browsers only make small modules
 * there without waiting). Nothing happens if the module is not loaded.
 */
export function makeNavCore(ready: (core: NavCore) => void): void {
  if (!module || typeof WebAssembly === 'undefined') return;
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      ready(new WebAssembly.Instance(module, imports).exports as NavCore);
    } else {
      void WebAssembly.instantiate(module, imports).then(
        (i) => ready(i.exports as NavCore),
        () => {},
      );
    }
  } catch {
    // The JavaScript does the work.
  }
}
