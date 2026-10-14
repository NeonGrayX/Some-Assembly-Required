import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  SHORES,
  SURFACE_PER_VERTEX,
  Surface,
  floorSurface,
  groundSurface,
  madeAs,
  madeOf,
  madeOfAll,
  madeOfBox,
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
  it('takes what the level says, and guesses the rest from colour and finish', () => {
    expect(surfaceOf(madeAs(standard(0xece4d4), 'wall'))).toBe(Surface.Wall);
    expect(surfaceOf(madeAs(standard(0x8c4b3a), 'roof'))).toBe(Surface.Roof);
    expect(surfaceOf(madeAs(standard(0x8c4b3a), undefined))).toBe(Surface.Wood);
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

  it("tags the parts of a box's model in its colour as made of what the box is", () => {
    const g = new THREE.Group();
    const bark = new THREE.Mesh(new THREE.BoxGeometry(), standard(0x5b4027, 0.95));
    const needles = new THREE.Mesh(new THREE.BoxGeometry(), standard(0x2f5a2a, 0.95));
    g.add(bark, needles);
    madeOfBox(g, { colour: 0x5b4027, surface: 'wood' });
    expect(surfaceOf(bark.material)).toBe(Surface.Wood);
    expect(surfaceOf(needles.material)).toBe(Surface.Fabric);
  });

  it('tells floors and grounds apart', () => {
    expect(floorSurface({ colour: 0xa47a52 })).toBe(Surface.Planks);
    expect(floorSurface({ colour: 0xc8c2b4 })).toBe(Surface.Tiles);
    expect(floorSurface({ colour: 0x8e9aa6 })).toBe(Surface.Fabric);
    expect(floorSurface({ colour: 0x9c9890 })).toBe(Surface.Concrete);
    expect(floorSurface({ colour: 0xb9a27a, surface: 'tiles' })).toBe(Surface.Tiles);
    // A wooden floor is boards.
    expect(floorSurface({ colour: 0xb9a27a, surface: 'wood' })).toBe(Surface.Planks);
    expect(groundSurface({})).toBe(Surface.Paving);
    expect(groundSurface({ groundColour: 0x7d9b5a, groundSurface: 'grass' })).toBe(Surface.Grass);
    expect(groundSurface({ groundColour: 0xd8c79a })).toBe(Surface.Dirt);
  });
});

describe('patchStyle', () => {
  it('fits into the lit and unlit shaders of this three.js', () => {
    const lit = madeOf(standard(0x9a6b43), Surface.Wood);
    const shader = shaderOf(lit);
    patchStyle(shader, lit);
    expect(shader.fragmentShader).toContain('styleDetail(');
    expect(shader.vertexShader).toContain('vStyleWorld =');
    expect(shader.uniforms.styleSurface!.value).toBe(Surface.Wood);

    // Unlit glows and screens keep their look.
    const glow = new THREE.MeshBasicMaterial();
    const unlit = shaderOf(glow);
    const { vertexShader, fragmentShader } = unlit;
    patchStyle(unlit, glow);
    expect(unlit.vertexShader).toBe(vertexShader);
    expect(unlit.fragmentShader).toBe(fragmentShader);
  });

  it("keeps a program's defines off the material's own", () => {
    const water = madeOf(standard(0x3f8fc9), Surface.Water);
    const shader = shaderOf(water);
    // As three.js hands them over: the material's own object.
    shader.defines = water.defines as typeof shader.defines;
    patchStyle(shader, water);
    expect(shader.defines!.STYLE_WATER).toBe('');
    expect(water.defines).not.toHaveProperty('STYLE_WATER');
  });

  it('hands the water its shores, and slopes them in its own program', () => {
    const water = madeOf(standard(0x3f8fc9), Surface.Water);
    water.userData[SHORES] = [{ x0: -5, x1: 5, z0: 2, z1: 1e4 }];
    const shader = shaderOf(water);
    patchStyle(shader, water);
    expect(shader.defines!.STYLE_WATER).toBe('');
    const shores = shader.uniforms.styleShores!.value as THREE.Vector4[];
    expect(shores[0]!.toArray()).toEqual([-5, 2, 5, 1e4]);
    // The rest lie far outside the level, so no point of the water is ever near them.
    expect(shores.slice(1).every((r) => r.x > r.z)).toBe(true);
    expect(shader.vertexShader).toMatch(/#ifdef STYLE_WATER\s+\{\s+vec3 styleAt/);
  });

  it('reads the surface from the vertices of a merged mesh', () => {
    const merged = standard(0xffffff);
    merged.userData[SURFACE_PER_VERTEX] = true;
    const shader = shaderOf(merged);
    patchStyle(shader, merged);
    expect(shader.defines!.STYLE_SURFACE_ATTR).toBe('');
  });
});
