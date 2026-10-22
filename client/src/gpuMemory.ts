/**
 * An estimate of what a WebGL context holds on the graphics card, counted from what is uploaded
 * to it: every texture, buffer and renderbuffer as it is allocated and deleted, plus the canvas's
 * own drawing buffer. No browser reports this itself, so it works the same everywhere (Firefox
 * included). It is an estimate: drivers pad, align and keep copies of their own, and anything
 * allocated before `watch` is not seen. Only the allocating calls are wrapped, never the binds a
 * frame makes, so it costs nothing per frame.
 */

/** Bytes a pixel of each sized internal format takes (RGB formats as drivers store them, padded). */
const SIZED: Record<number, number> = {
  0x8229: 1, // R8
  0x822b: 2, // RG8
  0x8051: 4, // RGB8
  0x8058: 4, // RGBA8
  0x8c41: 4, // SRGB8
  0x8c43: 4, // SRGB8_ALPHA8
  0x8d62: 2, // RGB565
  0x8056: 2, // RGBA4
  0x8057: 2, // RGB5_A1
  0x8059: 4, // RGB10_A2
  0x8c3a: 4, // R11F_G11F_B10F
  0x8c3d: 4, // RGB9_E5
  0x822d: 2, // R16F
  0x822f: 4, // RG16F
  0x881b: 8, // RGB16F
  0x881a: 8, // RGBA16F
  0x822e: 4, // R32F
  0x8230: 8, // RG32F
  0x8815: 16, // RGB32F
  0x8814: 16, // RGBA32F
  0x8232: 1, // R8UI
  0x8234: 2, // R16UI
  0x8236: 4, // R32UI
  0x8d7c: 4, // RGBA8UI
  0x8d70: 16, // RGBA32UI
  0x81a5: 2, // DEPTH_COMPONENT16
  0x81a6: 4, // DEPTH_COMPONENT24
  0x8cac: 4, // DEPTH_COMPONENT32F
  0x88f0: 4, // DEPTH24_STENCIL8
  0x8cad: 8, // DEPTH32F_STENCIL8
  0x8d48: 1, // STENCIL_INDEX8
  0x84f9: 4, // DEPTH_STENCIL (WebGL 1's renderbuffer)
};

/** Channels in each unsized format, for WebGL 1's style of upload. */
const CHANNELS: Record<number, number> = {
  0x1906: 1, // ALPHA
  0x1909: 1, // LUMINANCE
  0x190a: 2, // LUMINANCE_ALPHA
  0x1907: 4, // RGB, padded
  0x1908: 4, // RGBA
  0x1902: 4, // DEPTH_COMPONENT
};

/** Bytes a channel of each type takes; the packed types are a whole pixel each. */
const TYPE: Record<number, number> = {
  0x1401: 1, // UNSIGNED_BYTE
  0x1403: 2, // UNSIGNED_SHORT
  0x1405: 4, // UNSIGNED_INT
  0x1406: 4, // FLOAT
  0x140b: 2, // HALF_FLOAT
  0x8d61: 2, // HALF_FLOAT_OES
};
const PACKED = new Set([0x8033, 0x8034, 0x8363, 0x84fa]);

/** Bytes a 4×4 block takes in the compressed formats a page is likely to use. */
const BLOCK: Record<number, number> = {
  0x83f0: 8, // S3TC DXT1 RGB
  0x83f1: 8, // DXT1 RGBA
  0x83f2: 16, // DXT3
  0x83f3: 16, // DXT5
  0x8c4c: 8, // S3TC sRGB variants
  0x8c4d: 8,
  0x8c4e: 16,
  0x8c4f: 16,
  0x8d64: 8, // ETC1
  0x9274: 8, // ETC2 RGB8
  0x9275: 8, // ETC2 SRGB8
  0x9278: 16, // ETC2 RGBA8 EAC
  0x9279: 16, // ETC2 SRGB8 ALPHA8 EAC
  0x8e8c: 16, // BPTC
  0x8e8d: 16,
  0x8e8e: 16,
  0x8e8f: 16,
  0x8dbb: 8, // RGTC1
  0x8dbc: 8,
  0x8dbd: 16, // RGTC2
  0x8dbe: 16,
  0x93b0: 16, // ASTC 4×4
  0x93d0: 16, // ASTC 4×4 sRGB
};

/** Bytes for one image `w × h` of `format` (a sized or compressed one, or unsized with `type`). */
export function imageBytes(format: number, w: number, h: number, type?: number): number {
  const block = BLOCK[format];
  if (block) return Math.ceil(w / 4) * Math.ceil(h / 4) * block;
  let px = SIZED[format];
  if (px === undefined && type !== undefined) {
    px = PACKED.has(type) ? 2 : (CHANNELS[format] ?? 4) * (TYPE[type] ?? 1);
    if (type === 0x84fa) px = 4; // UNSIGNED_INT_24_8
  }
  return w * h * (px ?? 4);
}

/** Which binding to ask the context for, to find what a target's call allocates for. */
const TEXTURE_BINDING: Record<number, number> = {
  0x0de1: 0x8069, // TEXTURE_2D
  0x8513: 0x8514, // TEXTURE_CUBE_MAP
  0x806f: 0x806a, // TEXTURE_3D
  0x8c1a: 0x8c1d, // TEXTURE_2D_ARRAY
};
const CUBE_FACE = 0x8515;
const BUFFER_BINDING: Record<number, number> = {
  0x8892: 0x8894, // ARRAY_BUFFER
  0x8893: 0x8895, // ELEMENT_ARRAY_BUFFER
  0x8a11: 0x8a28, // UNIFORM_BUFFER
  0x8f36: 0x8f36, // COPY_READ_BUFFER
  0x8f37: 0x8f37, // COPY_WRITE_BUFFER
  0x88eb: 0x88ed, // PIXEL_PACK_BUFFER
  0x88ec: 0x88ef, // PIXEL_UNPACK_BUFFER
  0x8c8e: 0x8c8f, // TRANSFORM_FEEDBACK_BUFFER
};
const RENDERBUFFER_BINDING = 0x8ca7;

type Kind = 'textures' | 'buffers' | 'renderbuffers';

/** One object's share: a texture's by face and level, as each is uploaded. */
interface Held {
  kind: Kind;
  bytes: number;
  levels?: Map<number, number>;
  /** Allocated whole by `texStorage*`: its mipmaps are counted already. */
  immutable?: boolean;
  /** Deleted, or counted before the context was lost: no longer in the totals. */
  gone?: boolean;
  /** Which life of the context it was counted in (see `lives`). */
  life: number;
}

/** What a context holds on the graphics card, in bytes. */
export interface GpuBytes {
  textures: number;
  buffers: number;
  renderbuffers: number;
  /** The canvas's own drawing buffer: colour and depth, multisampled where it is. */
  canvas: number;
  total: number;
}

type GL = WebGLRenderingContext | WebGL2RenderingContext;
type Source = {
  width?: number;
  height?: number;
  naturalWidth?: number;
  naturalHeight?: number;
  videoWidth?: number;
  videoHeight?: number;
  displayWidth?: number;
  displayHeight?: number;
};

/** The size of a texture upload's source (an image, video, canvas, bitmap or pixels). */
function sourceSize(s: Source): [number, number] {
  return [
    s.videoWidth || s.naturalWidth || s.displayWidth || s.width || 0,
    s.videoHeight || s.naturalHeight || s.displayHeight || s.height || 0,
  ];
}

/** The bytes a `bufferData` call's data takes. */
function dataBytes(data: unknown, srcOffset?: number, length?: number): number {
  if (typeof data === 'number') return data;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) {
    const each = (data as unknown as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1;
    if (length) return length * each;
    return data.byteLength - (srcOffset ?? 0) * each;
  }
  return 0;
}

export class GpuMemory {
  private readonly totals = { textures: 0, buffers: 0, renderbuffers: 0 };
  private held = new WeakMap<object, Held>();
  /** How many times the context has been lost: what was counted before is gone with it. */
  private lives = 0;
  /** An object the page dropped without deleting is freed when it is collected. */
  private readonly freed = new FinalizationRegistry<Held>((h) => this.drop(h));

  /** Bytes each pixel of the canvas's drawing buffer takes: fixed as the context is made. */
  private readonly perPixel: number;

  private constructor(private readonly gl: GL) {
    const a = gl.getContextAttributes();
    const samples = a?.antialias ? 4 : 1;
    // The back buffer (multisampled), its depth, and the resolved and front buffers.
    this.perPixel = 4 * samples + (a?.depth || a?.stencil ? 4 * samples : 0) + 8;
  }

  /** Starts counting what `gl` allocates. */
  static watch(gl: GL): GpuMemory {
    const m = new GpuMemory(gl);
    m.wrap();
    const canvas = gl.canvas as HTMLCanvasElement | OffscreenCanvas;
    // A lost context has freed everything; what the page restores is uploaded again.
    canvas.addEventListener?.('webglcontextlost', () => {
      m.totals.textures = m.totals.buffers = m.totals.renderbuffers = 0;
      m.held = new WeakMap();
      m.lives++;
    });
    return m;
  }

  /** All it holds now, in bytes, without allocating: for every frame. */
  get total(): number {
    const { textures, buffers, renderbuffers } = this.totals;
    return textures + buffers + renderbuffers + this.canvas;
  }

  private get canvas(): number {
    return this.gl.drawingBufferWidth * this.gl.drawingBufferHeight * this.perPixel;
  }

  /** What the context holds now. */
  read(): GpuBytes {
    const canvas = this.canvas;
    const { textures, buffers, renderbuffers } = this.totals;
    return {
      textures,
      buffers,
      renderbuffers,
      canvas,
      total: textures + buffers + renderbuffers + canvas,
    };
  }

  private set(obj: object | null, kind: Kind, bytes: number): Held | null {
    if (!obj) return null;
    let h = this.held.get(obj);
    if (!h) {
      h = { kind, bytes: 0, life: this.lives };
      this.held.set(obj, h);
      this.freed.register(obj, h, h);
    }
    this.totals[kind] += bytes - h.bytes;
    h.bytes = bytes;
    return h;
  }

  private drop(h: Held | undefined): void {
    if (!h || h.gone || h.life !== this.lives) return;
    h.gone = true;
    this.totals[h.kind] -= h.bytes;
    this.freed.unregister(h);
  }

  private bound(binding: number | undefined): object | null {
    return binding === undefined ? null : (this.gl.getParameter(binding) as object | null);
  }

  /** The texture bound for `target`, and which face of it a cube map's target is. */
  private texture(target: number): [object | null, number] {
    const face = target >= CUBE_FACE && target < CUBE_FACE + 6 ? target - CUBE_FACE : 0;
    const binding = TEXTURE_BINDING[face || target === CUBE_FACE ? 0x8513 : target];
    return [this.bound(binding), face];
  }

  /** Counts one level of one face of the texture bound for `target`. */
  private level(target: number, level: number, bytes: number): void {
    const [tex, face] = this.texture(target);
    if (!tex) return;
    const h = this.held.get(tex);
    if (h?.immutable) return;
    const levels = h?.levels ?? new Map<number, number>();
    levels.set(face * 32 + level, bytes);
    let sum = 0;
    for (const b of levels.values()) sum += b;
    const now = this.set(tex, 'textures', sum)!;
    now.levels = levels;
  }

  /** Counts a texture allocated whole: `levels` mipmaps of `faces` faces of `depth` layers. */
  private storage(
    target: number,
    levels: number,
    format: number,
    w: number,
    h: number,
    depth: number,
  ): void {
    const [tex] = this.texture(target);
    const faces = target === 0x8513 ? 6 : 1;
    const shrinks = target === 0x806f; // a 3D texture's depth halves with each level too
    let sum = 0;
    for (let l = 0; l < levels; l++) {
      const d = shrinks ? Math.max(1, depth >> l) : depth;
      sum += imageBytes(format, Math.max(1, w >> l), Math.max(1, h >> l)) * d * faces;
    }
    const held = this.set(tex, 'textures', sum);
    if (held) held.immutable = true;
  }

  private wrap(): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the wrappers' own `this` is the context
    const m = this;
    const gl = this.gl as GL & Record<string, unknown>;
    const after = (name: string, count: (a: unknown[]) => void) => {
      const f = gl[name] as ((...a: unknown[]) => unknown) | undefined;
      if (typeof f !== 'function') return;
      gl[name] = function (this: GL) {
        // eslint-disable-next-line prefer-rest-params -- passed straight on, not copied
        const a = arguments as unknown as unknown[];
        const result = f.apply(this, a);
        try {
          count(a);
        } catch {
          // Counting never gets in the way of drawing.
        }
        return result;
      };
    };
    const n = (v: unknown) => v as number;

    after('bufferData', (a) => {
      const buf = m.bound(BUFFER_BINDING[n(a[0])]);
      m.set(buf, 'buffers', dataBytes(a[1], a[3] as number, a[4] as number));
    });
    after('texImage2D', (a) => {
      if (a.length >= 8) m.level(n(a[0]), n(a[1]), imageBytes(n(a[2]), n(a[3]), n(a[4]), n(a[7])));
      else {
        const [w, h] = sourceSize((a[5] ?? {}) as Source);
        m.level(n(a[0]), n(a[1]), imageBytes(n(a[2]), w, h, n(a[4])));
      }
    });
    after('texImage3D', (a) => {
      m.level(n(a[0]), n(a[1]), imageBytes(n(a[2]), n(a[3]), n(a[4]), n(a[8])) * n(a[5]));
    });
    after('copyTexImage2D', (a) => {
      m.level(n(a[0]), n(a[1]), imageBytes(n(a[2]), n(a[5]), n(a[6]), 0x1401));
    });
    const compressed = (a: unknown[], depth: number, data: unknown) => {
      const bytes =
        typeof data === 'number' || ArrayBuffer.isView(data)
          ? dataBytes(data)
          : imageBytes(n(a[2]), n(a[3]), n(a[4])) * depth;
      m.level(n(a[0]), n(a[1]), bytes);
    };
    after('compressedTexImage2D', (a) => compressed(a, 1, a[6]));
    after('compressedTexImage3D', (a) => compressed(a, n(a[5]), a[7]));
    after('texStorage2D', (a) => m.storage(n(a[0]), n(a[1]), n(a[2]), n(a[3]), n(a[4]), 1));
    after('texStorage3D', (a) => m.storage(n(a[0]), n(a[1]), n(a[2]), n(a[3]), n(a[4]), n(a[5])));
    // A full chain of mipmaps is a third more than the image it is made from.
    after('generateMipmap', (a) => {
      const [tex] = m.texture(n(a[0]));
      const h = tex && m.held.get(tex);
      if (!h || h.immutable || !h.levels) return;
      const faces = n(a[0]) === 0x8513 ? 6 : 1;
      for (let f = 0; f < faces; f++) {
        const base = h.levels.get(f * 32) ?? 0;
        for (let l = 1; l < 32; l++) h.levels.delete(f * 32 + l);
        h.levels.set(f * 32 + 31, Math.round(base / 3));
      }
      let sum = 0;
      for (const b of h.levels.values()) sum += b;
      m.set(tex, 'textures', sum);
    });
    after('renderbufferStorage', (a) => {
      m.set(m.bound(RENDERBUFFER_BINDING), 'renderbuffers', imageBytes(n(a[1]), n(a[2]), n(a[3])));
    });
    after('renderbufferStorageMultisample', (a) => {
      const bytes = imageBytes(n(a[2]), n(a[3]), n(a[4])) * Math.max(1, n(a[1]));
      m.set(m.bound(RENDERBUFFER_BINDING), 'renderbuffers', bytes);
    });
    for (const name of ['deleteBuffer', 'deleteTexture', 'deleteRenderbuffer'])
      after(name, (a) => {
        if (a[0]) m.drop(m.held.get(a[0]));
      });
  }
}
