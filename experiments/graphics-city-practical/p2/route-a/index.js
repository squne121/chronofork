/* global URL, fetch, crypto */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import baseline from './city.json';
import manifest from './manifest.json';

// The GLB is a baked representation of this specific input. Never silently
// display a stale asset for a different city; regenerate it instead.
export async function createCity({ THREE, city }) {
  if (JSON.stringify(city) !== JSON.stringify(baseline)) {
    throw new Error('Route A city input differs from the baked GLB; regenerate route-a assets.');
  }
  if (JSON.stringify(city) !== JSON.stringify(manifest.city)) {
    throw new Error('Route A manifest input differs; regenerate the GLB.');
  }
  const response = await fetch(new URL('./city.glb', import.meta.url).href);
  if (!response.ok) throw new Error(`Route A GLB fetch failed: ${response.status}`);
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== manifest.glbSha256) throw new Error('Route A GLB hash differs from manifest; regenerate.');
  const gltf = await new GLTFLoader().parseAsync(bytes, '');
  const root = new THREE.Group();
  root.name = city.id;
  root.add(gltf.scene);
  return root;
}
