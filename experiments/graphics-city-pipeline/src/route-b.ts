import * as THREE from 'three'
import type { Kind } from './input'

// The display owns placement, scaling and affiliation material. These geometries
// are immutable templates, shared by instances so updates need not rebuild them.
const block = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
const indexedTaper = new THREE.CylinderGeometry(0.6 / Math.SQRT2, 1 / Math.SQRT2, 1, 4, 1)
const taper = indexedTaper.toNonIndexed()
indexedTaper.dispose()
taper.rotateY(Math.PI / 4).translate(0, 0.5, 0)
taper.computeVertexNormals()
// Build only the exposed surface: the ledge is four strips, not a hidden
// box top beneath the upper tier. Each quad is wound counterclockwise outside.
function makeTiered(): THREE.BufferGeometry {
  const vertices: number[] = []
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    vertices.push(...a, ...b, ...c, ...a, ...c, ...d)
  }
  const walls = (r: number, bottom: number, top: number) => {
    quad([-r, bottom, r], [r, bottom, r], [r, top, r], [-r, top, r])
    quad([r, bottom, -r], [-r, bottom, -r], [-r, top, -r], [r, top, -r])
    quad([r, bottom, r], [r, bottom, -r], [r, top, -r], [r, top, r])
    quad([-r, bottom, -r], [-r, bottom, r], [-r, top, r], [-r, top, -r])
  }
  const r = 0.275
  walls(0.5, 0, 0.7)
  walls(r, 0.7, 1)
  quad([-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5])
  quad([-r, 1, r], [r, 1, r], [r, 1, -r], [-r, 1, -r])
  quad([-0.5, 0.7, 0.5], [0.5, 0.7, 0.5], [r, 0.7, r], [-r, 0.7, r])
  quad([0.5, 0.7, -0.5], [-0.5, 0.7, -0.5], [-r, 0.7, -r], [r, 0.7, -r])
  quad([0.5, 0.7, 0.5], [0.5, 0.7, -0.5], [r, 0.7, -r], [r, 0.7, r])
  quad([-0.5, 0.7, -0.5], [-0.5, 0.7, 0.5], [-r, 0.7, r], [-r, 0.7, -r])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  return geometry
}
const tiered = makeTiered()
const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 })

export function createBuilding(kind: Kind): THREE.Object3D {
  return new THREE.Mesh(kind === 'block' ? block : kind === 'tiered' ? tiered : taper, material)
}
