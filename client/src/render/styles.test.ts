import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  SURFACE_PER_VERTEX,
  Surface,
  floorSurface,
  groundSurface,
  madeOf,
  madeOfAll,
  patchStyle,
  surfaceOf,
} from './styles.ts';

const standard = (color: number, roughness = 0.7, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

/** A material's shaders as three.js hands them to `onBeforeCompile`. */
function shaderOf(material: THREE.Material): THREE.WebGLProgramParametersWithUniforms {
  const lib = material instanceof THREE.MeshBasicMaterial ? 'basic' : 'physical';
  const { vertexShader, fragmentShader } = THREE.ShaderLib[lib];
  return { vertexShader, fragmentShader, uniforms: {}, defines: {} } as never;
}

describe('surfaces', () => {
  it('knows the house by its colours, and guesses the rest from colour and finish', () => {
    expect(surfaceOf(standard(0xece4d4))).toBe(Surface.Wall);
    expect(surfaceOf(standard(0x8c4b3a))).toBe(Surface.Roof);
    expect(surfaceOf(standard(0x9a6b43))).toBe(Surface.Wood);
    // Some other brown: wood. Shiny and bright: plastic. Very rough: fabric. Metal: metal.
    expect(surfaceOf(standard(0x7d5a3c))).toBe(Surface.Wood);
    expect(surfaceOf(standard(0xc0392b, 0.4))).toBe(Surface.Plastic);
    expect(surfaceOf(standard(0x9b3d3d, 0.95))).toBe(Surface.Fabric);
    expect(surfaceOf(standard(0x2f3336, 0.45, 0.6))).toBe(Surface.Metal);
    // An orange shirt is not wood.
    expect(surfaceOf(standard(0xe07a2a))).toBe(Surface.Auto);
  });

  it('leaves textured, see-through and unlit surfaces alone', () => {
    expect(surfaceOf(new THREE.MeshStandardMaterial({ map: new THREE.Texture() }))).toBe(
      Surface.None,
    );
    expect(surfaceOf(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5 }))).toBe(
      Surface.None,
    );
    expect(surfaceOf(new THREE.MeshBasicMaterial())).toBe(Surface.None);
  });

  it('takes a tag over any guess, and tags whole models without touching textures', () => {
    expect(surfaceOf(madeOf(standard(0x9a6b43), Surface.Plastic))).toBe(Surface.Plastic);
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(), standard(0xe07a2a));
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.MeshStandardMaterial({ map: new THREE.Texture() }),
    );
    group.add(body, face);
    madeOfAll(group, Surface.Plastic);
    expect(surfaceOf(body.material)).toBe(Surface.Plastic);
    expect(surfaceOf(face.material)).toBe(Surface.None);
  });

  it('tells floors and grounds apart', () => {
    expect(floorSurface(0xa47a52)).toBe(Surface.Planks);
    expect(floorSurface(0xc8c2b4)).toBe(Surface.Tiles);
    expect(floorSurface(0x8e9aa6)).toBe(Surface.Fabric);
    expect(floorSurface(0x9c9890)).toBe(Surface.Concrete);
    expect(groundSurface(undefined)).toBe(Surface.Paving);
    expect(groundSurface(0x7d9b5a)).toBe(Surface.Grass);
    expect(groundSurface(0xd8c79a)).toBe(Surface.Dirt);
  });
});

describe('patchStyle', () => {
  it('leaves the classic look as it was, but for the surface uniform', () => {
    const material = standard(0xece4d4);
    const shader = shaderOf(material);
    const { vertexShader, fragmentShader } = shader;
    patchStyle(shader, material, 'classic');
    expect(shader.vertexShader).toBe(vertexShader);
    expect(shader.fragmentShader).toBe(fragmentShader);
    expect(shader.uniforms.styleSurface!.value).toBe(Surface.Wall);
  });

  it('fits every style into the lit and unlit shaders of this three.js', () => {
    for (const style of ['realistic', 'cartoon', 'retro'] as const) {
      const lit = standard(0x9a6b43);
      const shader = shaderOf(lit);
      patchStyle(shader, lit, style);
      expect(shader.defines![`STYLE_${style.toUpperCase()}`]).toBe('');
      expect(shader.fragmentShader).toContain('styleDetail(');
      expect(shader.vertexShader).toContain('vStyleWorld =');

      // Unlit glows and screens keep their look.
      const glow = new THREE.MeshBasicMaterial();
      const unlit = shaderOf(glow);
      const before = unlit.fragmentShader;
      patchStyle(unlit, glow, style);
      expect(unlit.fragmentShader).toBe(before);
    }
  });

  it('reads the surface from the vertices of a merged mesh', () => {
    const merged = standard(0xffffff);
    merged.userData[SURFACE_PER_VERTEX] = true;
    const shader = shaderOf(merged);
    patchStyle(shader, merged, 'realistic');
    expect(shader.defines!.STYLE_SURFACE_ATTR).toBe('');
  });
});
