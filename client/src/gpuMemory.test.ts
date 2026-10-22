import { describe, expect, it } from 'vitest';
import { GpuMemory, imageBytes } from './gpuMemory.ts';

const TEXTURE_2D = 0x0de1;
const CUBE = 0x8513;
const ARRAY_BUFFER = 0x8892;
const RGBA8 = 0x8058;
const RGBA16F = 0x881a;
const RGBA = 0x1908;
const UNSIGNED_BYTE = 0x1401;
const DEPTH24_STENCIL8 = 0x88f0;

/** Just enough of a WebGL 2 context to bind things and allocate for them. */
function fakeGl(attrs = { antialias: false, depth: false, stencil: false }) {
  const bound = new Map<number, object | null>();
  const listeners: (() => void)[] = [];
  const gl = {
    drawingBufferWidth: 0,
    drawingBufferHeight: 0,
    canvas: { addEventListener: (_: string, f: () => void) => listeners.push(f) },
    getContextAttributes: () => attrs,
    getParameter: (p: number) => bound.get(p) ?? null,
    bindBuffer: (target: number, b: object) =>
      bound.set(target === ARRAY_BUFFER ? 0x8894 : 0x8895, b),
    bindTexture: (target: number, t: object) => bound.set(target === CUBE ? 0x8514 : 0x8069, t),
    bindRenderbuffer: (_: number, r: object) => bound.set(0x8ca7, r),
    bufferData(..._: unknown[]) {},
    texImage2D(..._: unknown[]) {},
    texStorage2D(..._: unknown[]) {},
    generateMipmap(..._: unknown[]) {},
    renderbufferStorageMultisample(..._: unknown[]) {},
    deleteBuffer(..._: unknown[]) {},
    deleteTexture(..._: unknown[]) {},
    deleteRenderbuffer(..._: unknown[]) {},
  };
  const memory = GpuMemory.watch(gl as unknown as WebGL2RenderingContext);
  return { gl, memory, lose: () => listeners.forEach((f) => f()) };
}

describe('the graphics memory estimate', () => {
  it('sizes images by format', () => {
    expect(imageBytes(RGBA8, 4, 4)).toBe(64);
    expect(imageBytes(RGBA16F, 4, 4)).toBe(128);
    expect(imageBytes(RGBA, 4, 4, UNSIGNED_BYTE)).toBe(64);
    expect(imageBytes(0x83f0, 8, 8)).toBe(32); // DXT1: four 8-byte blocks
  });

  it('counts buffers as they are filled and frees them as they are deleted', () => {
    const { gl, memory } = fakeGl();
    const a = {};
    const b = {};
    gl.bindBuffer(ARRAY_BUFFER, a);
    gl.bufferData(ARRAY_BUFFER, new Float32Array(100), 0x88e4);
    gl.bindBuffer(ARRAY_BUFFER, b);
    gl.bufferData(ARRAY_BUFFER, 1000, 0x88e4);
    expect(memory.read().buffers).toBe(1400);
    // Filled again, smaller: replaced, not added.
    gl.bufferData(ARRAY_BUFFER, new Uint16Array(10), 0x88e4);
    expect(memory.read().buffers).toBe(420);
    gl.deleteBuffer(a);
    expect(memory.read().buffers).toBe(20);
  });

  it('counts a texture allocated whole with all its mipmaps, and its cube faces', () => {
    const { gl, memory } = fakeGl();
    const t = {};
    gl.bindTexture(TEXTURE_2D, t);
    gl.texStorage2D(TEXTURE_2D, 3, RGBA8, 4, 4);
    expect(memory.read().textures).toBe(64 + 16 + 4);
    // Its mipmaps are counted already.
    gl.generateMipmap(TEXTURE_2D);
    expect(memory.read().textures).toBe(84);
    const c = {};
    gl.bindTexture(CUBE, c);
    gl.texStorage2D(CUBE, 1, RGBA8, 2, 2);
    expect(memory.read().textures).toBe(84 + 6 * 16);
    gl.deleteTexture(t);
    gl.deleteTexture(c);
    expect(memory.read().textures).toBe(0);
  });

  it('counts uploads level by level, and a third more for generated mipmaps', () => {
    const { gl, memory } = fakeGl();
    gl.bindTexture(TEXTURE_2D, {});
    gl.texImage2D(TEXTURE_2D, 0, RGBA8, 30, 30, 0, RGBA, UNSIGNED_BYTE, null);
    expect(memory.read().textures).toBe(3600);
    gl.texImage2D(TEXTURE_2D, 0, RGBA, RGBA, UNSIGNED_BYTE, {
      naturalWidth: 10,
      naturalHeight: 10,
    });
    expect(memory.read().textures).toBe(400);
    gl.generateMipmap(TEXTURE_2D);
    expect(memory.read().textures).toBe(533);
  });

  it('counts multisampled renderbuffers and the canvas', () => {
    const { gl, memory } = fakeGl({ antialias: true, depth: true, stencil: false });
    gl.bindRenderbuffer(0x8d41, {});
    gl.renderbufferStorageMultisample(0x8d41, 4, DEPTH24_STENCIL8, 10, 10);
    expect(memory.read().renderbuffers).toBe(1600);
    gl.drawingBufferWidth = 10;
    gl.drawingBufferHeight = 10;
    // 4× multisampled colour and depth, then the resolved and front colour buffers.
    expect(memory.read().canvas).toBe(100 * (16 + 16 + 8));
    expect(memory.total).toBe(1600 + 4000);
  });

  it('starts again from nothing when the context is lost', () => {
    const { gl, memory, lose } = fakeGl();
    const b = {};
    gl.bindBuffer(ARRAY_BUFFER, b);
    gl.bufferData(ARRAY_BUFFER, 64, 0x88e4);
    lose();
    expect(memory.read().buffers).toBe(0);
    // Deleting what the lost context held does not count it off twice.
    gl.deleteBuffer(b);
    expect(memory.read().buffers).toBe(0);
  });
});
