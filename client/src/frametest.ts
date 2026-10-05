import * as THREE from 'three';
import { mergeStatic } from './render/merge.ts';
import { PerfPanel } from './ui/perf.ts';
import './style.css';

// A bare page with the game's frame-time panel, to tell hitches the game causes apart from
// ones the browser, graphics driver or system cause. It allocates nothing per frame.

const status = document.getElementById('status')!;
const perf = new PerfPanel(status, () => null, false);
perf.toggle();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.getElementById('game')!.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc9e8);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(0, 6, 10);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x6b5b45, 1.4));
const sun = new THREE.DirectionalLight(0xfff3dd, 2.2);
sun.position.set(8, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.MeshStandardMaterial({ color: 0xc9b48f }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const boxes = new THREE.Group();
for (let i = 0; i < 80; i++) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(i / 80, 0.6, 0.5) }),
  );
  m.position.set(((i % 10) - 4.5) * 1.1, 0.25, (Math.floor(i / 10) - 3.5) * 1.1);
  m.castShadow = m.receiveShadow = true;
  boxes.add(m);
}
scene.add(boxes);

// The same boxes baked into a single mesh: one draw call (two with shadows) instead of 80.
const merged = new THREE.Group();
merged.add(boxes.clone());
mergeStatic(merged);
merged.visible = false;
scene.add(merged);

const resize = () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
};
window.addEventListener('resize', resize);
resize();

let mode = 'empty';
for (const input of document.querySelectorAll<HTMLInputElement>('input[name=mode]')) {
  input.addEventListener('change', () => {
    mode = input.value;
    renderer.domElement.style.visibility = mode === 'empty' ? 'hidden' : 'visible';
    boxes.visible = mode === 'scene' || mode === 'noshadow';
    merged.visible = mode === 'merged';
    sun.castShadow = mode !== 'noshadow';
  });
}
renderer.domElement.style.visibility = 'hidden';

function frame(now: number): void {
  const started = performance.now();
  perf.frame(now);
  if (mode === 'clear') {
    renderer.clear();
  } else if (mode !== 'empty') {
    boxes.rotation.y = merged.rotation.y = now / 4000;
    renderer.render(scene, camera);
  }
  status.textContent = `${perf.currentFps(now).toFixed(0)} fps · frame test`;
  const done = performance.now();
  perf.work(started, started, started, done);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
