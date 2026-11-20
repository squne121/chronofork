import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { city, type Building, type City, type Kind } from './input'
import { loadBlenderParts } from './route-a'
import { createBuilding as createDirectBuilding } from './route-b'
import './style.css'

type Factory = (kind: Kind) => THREE.Object3D
export interface CameraState {
  position: [number, number, number]
  target: [number, number, number]
  zoom: number
}
const views = document.querySelector<HTMLDivElement>('#views')!

function makeView(label: string, factory: Factory, onCameraChange: (state: CameraState) => void) {
  const section = document.createElement('section')
  const title = document.createElement('h2'); title.textContent = label
  const canvas = document.createElement('canvas'); section.append(title, canvas); views.append(section)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(640, 480, false); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#dce5e8')
  scene.add(new THREE.HemisphereLight(0xffffff, 0x697061, 2))
  const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(-10, 20, 12); scene.add(sun)
  const camera = new THREE.OrthographicCamera(-20, 20, 15, -15, 0.1, 200)
  camera.position.set(28, 32, 36); camera.lookAt(0, 1, 0)
  const controls = new OrbitControls(camera, canvas); controls.target.set(0, 1, 0); controls.enableRotate = false; controls.update()
  const render = () => renderer.render(scene, camera)
  let applyingCamera = false
  function getCameraState(): CameraState {
    return { position: camera.position.toArray(), target: controls.target.toArray(), zoom: camera.zoom }
  }
  function setCameraState(state: CameraState) {
    applyingCamera = true
    try {
      camera.position.fromArray(state.position); controls.target.fromArray(state.target); camera.zoom = state.zoom
      camera.updateProjectionMatrix(); controls.update(); render()
    } finally { applyingCamera = false }
  }
  controls.addEventListener('change', () => {
    render()
    if (!applyingCamera) onCameraChange(getCameraState())
  })
  const stone = new THREE.MeshStandardMaterial({ color: '#999780', roughness: 1 })
  const surroundings = new THREE.Group(); scene.add(surroundings)
  const grounds = new Map<string, THREE.Mesh>()
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), stone)
  bridge.name = 'bridge'; surroundings.add(bridge)
  const objects = new Map<string, THREE.Object3D>()
  function removeBuilding(object: THREE.Object3D) {
    scene.remove(object)
    object.traverse(child => {
      if (child instanceof THREE.Mesh) {
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        materials.forEach(material => material.dispose())
      }
    })
  }
  function updateBuilding(building: Building) {
    let object = objects.get(building.id)
    if (!object || object.userData.kind !== building.kind) {
      if (object) removeBuilding(object)
      object = factory(building.kind); object.name = building.id; object.userData.kind = building.kind
      // Factory materials and geometries are shared templates. Only these new materials are owned by the instance.
      object.traverse(child => { if (child instanceof THREE.Mesh) child.material = new THREE.MeshStandardMaterial({ color: building.affiliation, roughness: 1 }) })
      scene.add(object); objects.set(building.id, object)
    }
    object.position.set(building.x, building.y, building.z); object.scale.set(building.width, building.height, building.depth)
    object.traverse(child => { if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) child.material.color.set(building.affiliation) })
    render()
  }
  function setCity(next: City) {
    const districtIds = new Set(next.districts.map(d => d.id))
    for (const [id, ground] of grounds) if (!districtIds.has(id)) {
      surroundings.remove(ground); ground.geometry.dispose(); grounds.delete(id)
    }
    for (const d of next.districts) {
      // Each district's base depends only on its own height.
      const baseY = Math.min(-2, d.y - 2)
      let ground = grounds.get(d.id)
      if (!ground) {
        ground = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), stone)
        ground.name = `terrain:${d.id}`; grounds.set(d.id, ground); surroundings.add(ground)
      }
      ground.position.set(d.x, (d.y + baseY) / 2, d.z)
      ground.scale.set(d.width, d.y - baseY, d.depth)
    }
    const a = new THREE.Vector3(...next.bridge.from), b = new THREE.Vector3(...next.bridge.to)
    const direction = b.clone().sub(a)
    bridge.position.copy(a).add(b).multiplyScalar(0.5)
    bridge.scale.set(direction.length(), 0.3, next.bridge.width)
    if (direction.lengthSq() > 0) bridge.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction.normalize())
    else bridge.quaternion.identity()
    const ids = new Set(next.buildings.map(building => building.id))
    for (const [id, object] of objects) if (!ids.has(id)) { removeBuilding(object); objects.delete(id) }
    next.buildings.forEach(updateBuilding)
    render()
  }
  return { scene, camera, renderer, objects, updateBuilding, setCity, getCameraState, setCameraState, render }
}

async function start() {
  let a: ReturnType<typeof makeView> | undefined
  let cameraState: CameraState = { position: [28, 32, 36], target: [0, 1, 0], zoom: 1 }
  function setCameraState(state: CameraState) {
    cameraState = { position: [...state.position], target: [...state.target], zoom: state.zoom }
    a?.setCameraState(cameraState); b?.setCameraState(cameraState)
  }
  try {
    const blender = await loadBlenderParts()
    a = makeView('経路 A', blender, setCameraState)
  } catch (error) {
    const message = document.createElement('p')
    message.textContent = `経路 A は未表示です（GLB の読込み失敗）。`
    views.append(message)
    console.error(error)
  }
  const b = makeView('経路 B', createDirectBuilding, setCameraState)
  let currentCity = city
  let order: 'ab' | 'ba' = 'ab'
  function setOrder(next: 'ab' | 'ba') { order = next }
  function eachView(fn: (view: ReturnType<typeof makeView>) => void) {
    for (const view of order === 'ab' ? [a, b] : [b, a]) if (view) fn(view)
  }
  function setCity(next: City) { currentCity = next; eachView(view => view.setCity(next)) }
  function updateBuilding(building: Building) {
    const index = currentCity.buildings.findIndex(item => item.id === building.id)
    currentCity = { ...currentCity, buildings: index < 0 ? [...currentCity.buildings, building] : currentCity.buildings.map((item, i) => i === index ? building : item) }
    eachView(view => view.updateBuilding(building))
  }
  setCity(city); setCameraState(cameraState)
  Object.assign(window, { experiment: { a, b, get city() { return currentCity }, setCity, updateBuilding, setOrder, getCameraState: () => ({ position: [...cameraState.position], target: [...cameraState.target], zoom: cameraState.zoom }), setCameraState } })
}
start().catch(error => { const p = document.createElement('p'); p.textContent = `読込みエラー: ${String(error)}`; document.body.append(p); console.error(error) })
