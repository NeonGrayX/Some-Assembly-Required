import * as THREE from 'three';
import { Surface, madeOf } from '../render/styles.ts';

/**
 * Block lettering for the car scene's signs: a 5 × 7 pixel face, every letter and figure, drawn
 * as the bus's "SCHOOL BUS" is, crisp squares of ink on a ground.
 */

/** Each glyph's rows from the top, `#` inked. */
const FACE: Record<string, string> = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####',
  F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.####',
  H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '.###.|..#..|..#..|..#..|..#..|..#..|.###.',
  J: '..###|...#.|...#.|...#.|#..#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
  N: '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
  R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
  '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  '2': '.###.|#...#|....#|...#.|..#..|.#...|#####',
  '3': '####.|....#|....#|.###.|....#|....#|####.',
  '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.',
  '5': '#####|#....|####.|....#|....#|#...#|.###.',
  '6': '.###.|#....|#....|####.|#...#|#...#|.###.',
  '7': '#####|....#|...#.|..#..|.#...|.#...|.#...',
  '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  '9': '.###.|#...#|#...#|.####|....#|....#|.###.',
  ' ': '.....|.....|.....|.....|.....|.....|.....',
  '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..',
  '-': '.....|.....|.....|.###.|.....|.....|.....',
  '.': '.....|.....|.....|.....|.....|.....|..#..',
  '%': '##..#|##..#|...#.|..#..|.#...|#..##|#..##',
  '/': '....#|....#|...#.|..#..|.#...|#....|#....',
};

/**
 * `lines` of text in `ink` on `ground`, one under another and each centred, as a texture, and
 * how wide it is for its height. Lit signs pass white ink on black, as an emissive map.
 */
export function lettering(
  lines: string | string[],
  ink: number,
  ground: number,
): { map: THREE.DataTexture; aspect: number } {
  const rows = typeof lines === 'string' ? [lines] : lines;
  const k = 8;
  const cols = Math.max(...rows.map((t) => t.length)) * 6 - 1 + 4;
  const height = rows.length * 9 - 2 + 4;
  const [W, H] = [cols * k, height * k];
  const data = new Uint8Array(W * H * 4);
  const rgb = (c: number) => {
    const s = new THREE.Color(c).convertLinearToSRGB();
    return [s.r * 255, s.g * 255, s.b * 255, 255];
  };
  const [inkRGB, groundRGB] = [rgb(ink), rgb(ground)];
  for (let i = 0; i < W * H; i++) data.set(groundRGB, i * 4);
  for (const [line, text] of rows.entries()) {
    const left = 2 + Math.floor((cols - 4 - (text.length * 6 - 1)) / 2);
    for (const [n, ch] of [...text.toUpperCase()].entries()) {
      const glyph = (FACE[ch] ?? FACE[' ']!).split('|');
      for (let r = 0; r < 7; r++)
        for (let c = 0; c < 5; c++) {
          if (glyph[r]![c] !== '#') continue;
          const x0 = (left + n * 6 + c) * k;
          // Rows count down from the top; the texture's from the bottom.
          const y0 = (height - 3 - line * 9 - r) * k;
          for (let y = y0; y < y0 + k; y++)
            for (let x = x0; x < x0 + k; x++) data.set(inkRGB, (y * W + x) * 4);
        }
    }
  }
  const map = new THREE.DataTexture(data, W, H);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 8;
  map.needsUpdate = true;
  return { map, aspect: W / H };
}

/** A painted sign of `text`, `width` wide, facing +z. */
export function paintedSign(
  text: string | string[],
  ink: number,
  ground: number,
  width: number,
): THREE.Mesh {
  const { map, aspect } = lettering(text, ink, ground);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width / aspect),
    madeOf(new THREE.MeshStandardMaterial({ map, roughness: 0.45 }), Surface.None),
  );
  m.receiveShadow = true;
  return m;
}

/**
 * A lit sign of `text` glowing `colour` on dark glass, `width` wide, facing +z: the cars'
 * screens' look.
 */
export function litSign(
  text: string | string[],
  colour: number,
  width: number,
  intensity = 2.4,
): THREE.Mesh {
  const { map, aspect } = lettering(text, 0xffffff, 0x000000);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, width / aspect),
    madeOf(
      new THREE.MeshStandardMaterial({
        color: 0x0b0d0e,
        roughness: 0.25,
        emissive: colour,
        emissiveMap: map,
        emissiveIntensity: intensity,
      }),
      Surface.None,
    ),
  );
}

/**
 * `text` as geometry rather than a texture: a square for each inked pixel of its face, a little
 * gap round each, in the x-y plane facing +z, centred, `height` tall: for lettering that is only
 * light, as the cones' holograms.
 */
export function letterPixels(text: string, height: number): THREE.BufferGeometry {
  const k = height / 7;
  const s = k * 0.82;
  const width = (text.length * 6 - 1) * k;
  const pos: number[] = [];
  for (const [n, ch] of [...text.toUpperCase()].entries()) {
    const glyph = (FACE[ch] ?? FACE[' ']!).split('|');
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 5; c++) {
        if (glyph[r]![c] !== '#') continue;
        const x = -width / 2 + (n * 6 + c + 0.5) * k;
        const y = height / 2 - (r + 0.5) * k;
        const [x0, x1, y0, y1] = [x - s / 2, x + s / 2, y - s / 2, y + s / 2];
        pos.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0);
      }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}
