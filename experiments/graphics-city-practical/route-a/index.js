/* global URL */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import baseline from './city.json';

// The GLB is a baked representation of this specific input. Never silently
// display a stale asset for a different city; regenerate it instead.
export async function createCity({ THREE, city }) {
  if (JSON.stringify(city) !== JSON.stringify(baseline)) {
    throw new Error('Route A city input differs from the baked GLB; regenerate route-a assets.');
  }
  const gltf = await new GLTFLoader().loadAsync(new URL('./city.glb', import.meta.url).href);
  const root = new THREE.Group();
  root.name = city.id;
  root.add(gltf.scene);
  return root;
}
