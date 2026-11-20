/* global URL */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import baseline from './city.json';

// Compare the input with the saved snapshot. This does not verify that the GLB
// was generated from that snapshot; updating JSON alone can leave a stale GLB.
export async function createCity({ THREE, city }) {
  if (JSON.stringify(city) !== JSON.stringify(baseline)) {
    throw new Error('Route A city input differs from the saved snapshot; regenerate route-a assets.');
  }
  const gltf = await new GLTFLoader().loadAsync(new URL('./city.glb', import.meta.url).href);
  const root = new THREE.Group();
  root.name = city.id;
  root.add(gltf.scene);
  return root;
}
