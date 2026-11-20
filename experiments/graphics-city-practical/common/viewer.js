/* global document, window, URLSearchParams, ResizeObserver, requestAnimationFrame */
import * as THREE from 'three';
import { city } from './city.js';
import { createCity as createA } from '../route-a/index.js';
import { createCity as createB } from '../routes/b.js';
import './viewer.css';

const direction = new THREE.Vector3(1, 1.15, -1.5).normalize();
const target = new THREE.Vector3(0, 2, 0);
let span = 56;
const views = {};
const api = { ready: false, error: null, views, city, setView };
window.cityComparison = api;

function makeView(variant) {
  const container = document.getElementById(variant);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#deded8');
  scene.add(new THREE.HemisphereLight(0xffffff, 0x77766d, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(-15, 30, -20);
  scene.add(sun);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 250);
  container.appendChild(renderer.domElement);
  const view = { scene, camera, renderer, variant, container };
  views[variant] = view;
  new ResizeObserver(renderAll).observe(container);
  return view;
}

function renderAll() {
  for (const { container, camera, renderer, scene } of Object.values(views)) {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height, false);
    const aspect = width / height;
    camera.left = -span * aspect / 2;
    camera.right = span * aspect / 2;
    camera.top = span / 2;
    camera.bottom = -span / 2;
    camera.position.copy(target).addScaledVector(direction, 100);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
}

function setView(name) {
  if (name !== 'normal' && name !== 'close') throw new Error(`Unknown view: ${name}`);
  span = name === 'normal' ? 56 : 26;
  target.set(0, 2, 0);
  renderAll();
}

for (const variant of ['a', 'b']) {
  const view = makeView(variant);
  let last = null;
  view.renderer.domElement.addEventListener('pointerdown', (event) => {
    last = [event.clientX, event.clientY];
    event.currentTarget.setPointerCapture(event.pointerId);
  });
  view.renderer.domElement.addEventListener('pointermove', (event) => {
    if (!last) return;
    const dx = event.clientX - last[0];
    const dy = event.clientY - last[1];
    last = [event.clientX, event.clientY];
    const scale = span / Math.max(view.container.clientHeight, 1);
    const right = new THREE.Vector3().setFromMatrixColumn(view.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(view.camera.matrix, 1);
    target.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
    renderAll();
  });
  view.renderer.domElement.addEventListener('pointerup', () => { last = null; });
  view.renderer.domElement.addEventListener('pointercancel', () => { last = null; });
  view.renderer.domElement.addEventListener('wheel', (event) => {
    event.preventDefault();
    span = THREE.MathUtils.clamp(span * Math.exp(event.deltaY * 0.001), 12, 100);
    renderAll();
  }, { passive: false });
}
document.getElementById('normal').addEventListener('click', () => setView('normal'));
document.getElementById('close').addEventListener('click', () => setView('close'));
setView(new URLSearchParams(window.location.search).get('view') === 'close' ? 'close' : 'normal');

Promise.all([createA({ THREE, city }), createB({ THREE, city })]).then(([a, b]) => {
  if (!a?.isGroup || !b?.isGroup) throw new Error('Each route must return a THREE.Group');
  views.a.scene.add(a);
  views.b.scene.add(b);
  renderAll();
  requestAnimationFrame(() => {
    renderAll();
    api.ready = true;
    document.getElementById('status').textContent = 'Loaded (human evaluation pending)';
  });
}).catch((error) => {
  api.error = String(error);
  document.getElementById('status').textContent = 'Load failed; see inspection API for details';
});
