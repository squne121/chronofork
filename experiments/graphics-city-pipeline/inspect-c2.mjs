/* global window, structuredClone, process, URL, requestAnimationFrame */
// Start the experiment server separately, after integrating both C2 implementations.
// CITY_URL=http://127.0.0.1:5173/ node inspect-c2.mjs
// Writes artifacts into a new, uniquely named directory beside this file.
import { chromium } from '@playwright/test'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
async function provenance() {
  async function files(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]))).flat()
  }
  const paths = [join(root, 'inspect-c2.mjs'), join(root, 'c2-topology.mjs'), join(root, 'test-c2-topology.mjs'), join(root, 'route-a/generate.py'), ...await files(join(root, 'src')), ...(await files(join(root, 'public/a'))).filter(path => /\.(glb|blend)$/.test(path))].sort()
  const hashes = Object.fromEntries(await Promise.all(paths.map(async path => [relative(root, path), createHash('sha256').update(await readFile(path)).digest('hex')])))
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trimEnd()
  return { head: git('rev-parse', 'HEAD'), status: git('status', '--porcelain=v1', '--untracked-files=normal'), hashes }
}

const output = await mkdtemp(new URL('./c2-artifacts-', import.meta.url).pathname)
const report = { started: new Date().toISOString(), camera: { position: [28, 32, 36], target: [0, 1, 0], zoom: 1 }, failures: [], pending: [] }
let browser
try {
  report.provenanceBefore = await provenance()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 })
  page.on('pageerror', error => report.failures.push(`page error: ${error}`))
  await page.goto(process.env.CITY_URL ?? 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
  try { await page.waitForFunction(() => window.experiment?.a && window.experiment?.b, null, { timeout: 15000 }) }
  catch { report.pending.push('Both A and B views must load before C2 can be inspected') }
  if (!report.pending.length) {
    await page.evaluate(camera => window.experiment.setCameraState(camera), report.camera)
    const setup = await page.evaluate(() => {
      const e = window.experiment
      const baseline = structuredClone(e.city)
      const target = baseline.buildings.find(building => building.district === 'center') ?? baseline.buildings[0]
      if (!target) throw new Error('No building available for C2')
      window.__c2Baseline = baseline
      window.__c2Target = target.id
      return { target: target.id, originalKind: target.kind }
    })
    report.target = setup
    const cameraState = () => page.evaluate(() => Object.fromEntries(['a', 'b'].map(route => {
      const view = window.experiment[route], camera = view.camera
      if (!camera) return [route, null]
      camera.updateMatrixWorld(true)
      return [route, { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), direction: camera.getWorldDirection(camera.position.clone()).toArray(), zoom: camera.zoom, projection: camera.projectionMatrix.toArray() }]
    })))
    const publicCameraState = () => page.evaluate(() => Object.fromEntries(['experiment', 'a', 'b'].map(key => {
      const owner = key === 'experiment' ? window.experiment : window.experiment[key]
      return [key, typeof owner.getCameraState === 'function' ? owner.getCameraState() : null]
    })))
    const publicBefore = await publicCameraState()
    report.publicCameraBefore = publicBefore
    const cameraMatches = (actual, expected) => actual && ['position', 'target'].every(key => Array.isArray(actual[key]) && actual[key].length === 3 && actual[key].every((value, i) => Number.isFinite(value) && Math.abs(value - expected[key][i]) < 1e-5)) && Number.isFinite(actual.zoom) && Math.abs(actual.zoom - expected.zoom) < 1e-5
    for (const [key, state] of Object.entries(publicBefore)) {
      if (!state) report.pending.push(`${key}: public camera state unavailable`)
      else if (!cameraMatches(state, report.camera)) report.failures.push(`${key}: public camera state differs from requested state`)
    }
    const cameraBefore = await cameraState()
    report.cameraBefore = cameraBefore
    const compareCameras = (cameras, phase) => {
      const a = cameras.a, b = cameras.b
      if (!a || !b) return
      const near = (x, y) => Math.abs(x - y) < 1e-5
      if (!a.projection.every((value, i) => near(value, b.projection[i]))) report.failures.push(`${phase}: A/B projection differs`)
      const dot = a.quaternion.reduce((sum, value, i) => sum + value * b.quaternion[i], 0)
      if (!near(Math.abs(dot), 1)) report.failures.push(`${phase}: A/B quaternion differs`)
    }
    compareCameras(cameraBefore, 'before')
    for (const route of ['a', 'b']) {
      const camera = cameraBefore[route]
      if (!camera) report.pending.push(`${route}: camera state unavailable`)
      else {
        const direction = report.camera.target.map((value, i) => value - report.camera.position[i])
        const length = Math.hypot(...direction)
        if (!camera.position.every((value, i) => Math.abs(value - report.camera.position[i]) < 1e-5) || Math.abs(camera.zoom - report.camera.zoom) > 1e-5 || !camera.direction.every((value, i) => Math.abs(value - direction[i] / length) < 1e-5)) report.failures.push(`${route}: requested camera state not applied`)
      }
    }
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.screenshot({ path: join(output, 'c2-before.png'), fullPage: true })
    const canvases = page.locator('canvas')
    const canvasCount = await canvases.count()
    const beforeImages = []
    for (let i = 0; i < canvasCount; i++) beforeImages.push(await canvases.nth(i).screenshot())
    const result = await page.evaluate(async () => {
      const THREE = await import('/node_modules/three/build/three.module.js')
      const { inspectTopology } = await import('/c2-topology.mjs')
      const e = window.experiment, baseline = window.__c2Baseline, id = window.__c2Target
      const failures = [], measurements = {}
      const check = (condition, message) => { if (!condition) failures.push(message) }
      const close = (a, b, tolerance = 1e-4) => Number.isFinite(a) && Math.abs(a - b) <= tolerance
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
      const materials = node => node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []
      const capture = view => {
        view.scene.updateMatrixWorld(true)
        const rows = []
        function visit(node, owner) {
          if (baseline.buildings.some(building => building.id === node.name)) owner = node.name
          if (owner !== id) {
            const geometry = node.geometry, mats = materials(node)
            rows.push({ node, geometry, mats, data: JSON.stringify({ name: node.name, kind: node.userData.kind, matrix: node.matrixWorld.toArray(), local: node.matrix.toArray(), visible: node.visible, geometry: geometry && { attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([key, attr]) => [key, { itemSize: attr.itemSize, normalized: attr.normalized, values: Array.from(attr.array) }])), index: geometry.index && Array.from(geometry.index.array), groups: geometry.groups, drawRange: geometry.drawRange }, materials: mats.map(material => material.toJSON()) }) })
          }
          node.children.forEach(child => visit(child, owner))
        }
        visit(view.scene, null)
        return rows
      }
      const before = { a: capture(e.a), b: capture(e.b) }
      const changed = structuredClone(baseline)
      const target = changed.buildings.find(building => building.id === id)
      target.kind = 'tiered'
      target.width = 2.37
      target.depth = 1.43
      target.height = 4.17
      target.affiliation = '#e13a80'
      e.setCity(changed)
      for (const route of ['a', 'b']) {
        const view = e[route], after = capture(view), old = before[route]
        check(old.length === after.length, `${route}: non-target scene node count changed`)
        for (let i = 0; i < Math.max(old.length, after.length); i++) {
          const a = old[i], b = after[i]
          if (!a || !b || a.node !== b.node || a.geometry !== b.geometry || a.mats.length !== b.mats.length || a.mats.some((m, j) => m !== b.mats[j]) || a.data !== b.data) failures.push(`${route}: non-target node ${i} changed`)
        }
        const ids = changed.buildings.map(building => building.id).sort()
        check(same([...view.objects.keys()].sort(), ids), `${route}: building ID map changed`)
        for (const building of changed.buildings) {
          const object = view.objects.get(building.id)
          check(Boolean(object) && object.name === building.id && object.userData.kind === building.kind, `${route}/${building.id}: ID or kind`)
        }
        const object = view.objects.get(id)
        if (!object) { failures.push(`${route}: tiered object missing`); continue }
        object.updateWorldMatrix(true, true)
        const triangles = [], points = [], color = new THREE.Color(target.affiliation)
        let meshCount = 0
        object.traverseVisible(mesh => {
          if (!mesh.isMesh) return
          meshCount++
          const geometry = mesh.geometry, position = geometry?.attributes.position, index = geometry?.index
          if (!position) { failures.push(`${route}: mesh has no position`); return }
          const mats = materials(mesh)
          check(mats.length > 0 && mats.every(material => material.visible && material.color?.equals(color)), `${route}: tiered material color or visibility`)
          const count = index ? index.count : position.count
          const groups = Array.isArray(mesh.material) ? geometry.groups : [{ start: 0, count, materialIndex: 0 }]
          for (const group of groups) {
            if (!mats[group.materialIndex]?.visible) continue
            const start = Math.max(group.start, geometry.drawRange.start), end = Math.min(group.start + group.count, geometry.drawRange.start + geometry.drawRange.count, count)
            for (let i = start; i + 2 < end; i += 3) {
              const vertices = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(i + offset) : i + offset).applyMatrix4(mesh.matrixWorld))
              if (vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).lengthSq() < 1e-16) continue
              points.push(...vertices)
              triangles.push(vertices)
            }
          }
        })
        check(meshCount > 0 && triangles.length > 0, `${route}: no visible tiered triangles`)
        if (!points.length) continue
        const box = new THREE.Box3().setFromPoints(points)
        const expectedMin = [target.x - target.width / 2, target.y, target.z - target.depth / 2]
        const expectedMax = [target.x + target.width / 2, target.y + target.height, target.z + target.depth / 2]
        check(box.min.toArray().every((v, i) => close(v, expectedMin[i])) && box.max.toArray().every((v, i) => close(v, expectedMax[i])), `${route}: world bounds`)
        // Probe triangle intersections, independent of vertex ordering, winding and tessellation.
        // Horizontal and vertical rays sample the lower/upper walls, roof, floor and shoulder.
        const probe = (origin, direction, expected, label, optional = []) => {
          const ray = new THREE.Ray(new THREE.Vector3(...origin), new THREE.Vector3(...direction))
          const distances = []
          for (const tri of triangles) {
            const hit = ray.intersectTriangle(...tri, false, new THREE.Vector3())
            if (hit) {
              const d = hit.distanceTo(ray.origin)
              if (!distances.some(value => close(value, d))) distances.push(d)
            }
          }
          distances.sort((a, b) => a - b)
          const required = distances.filter(value => !optional.some(allowed => close(value, allowed)))
          check(required.length === expected.length && required.every((value, i) => close(value, expected[i])), `${route}: ${label} intersections ${JSON.stringify(distances)} expected ${JSON.stringify(expected)}`)
        }
        const { x, y, z, width: w, height: h, depth: d } = target
        for (const [level, factor] of [[0.2, 1], [0.5, 1], [0.8, 0.55], [0.95, 0.55]]) {
          probe([x - w, y + h * level, z + d * 0.13], [1, 0, 0], [w * (1 - factor / 2), w * (1 + factor / 2)], `x section ${level}`)
          probe([x + w * 0.13, y + h * level, z - d], [0, 0, 1], [d * (1 - factor / 2), d * (1 + factor / 2)], `z section ${level}`)
        }
        probe([x + w * 0.13, y - h, z + d * 0.13], [0, 1, 0], [h, 2 * h], 'central floor/roof', [1.7 * h])
        probe([x + w * 0.39, y - h, z + d * 0.13], [0, 1, 0], [h, 1.7 * h], 'shoulder height')
        probe([x + w * 0.13, y - h, z + d * 0.39], [0, 1, 0], [h, 1.7 * h], 'other shoulder height')
        const topology = inspectTopology(triangles.map(triangle => triangle.map(point => point.toArray())), w * h * d * (0.7 + 0.3 * 0.55 ** 2))
        check(topology.ok, `${route}: topology ${JSON.stringify(topology)}`)
        measurements[route] = { bounds: [box.min.toArray(), box.max.toArray()], meshes: meshCount, triangles: triangles.length, topology }
      }
      return { failures, measurements, changed: target }
    })
    report.failures.push(...result.failures)
    report.measurements = result.measurements
    report.changed = result.changed
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    report.publicCameraAfter = await publicCameraState()
    for (const [key, state] of Object.entries(report.publicCameraAfter)) {
      if (!state) report.pending.push(`${key}: public camera state unavailable after update`)
      else if (!cameraMatches(state, report.camera) || (publicBefore[key] && !cameraMatches(state, publicBefore[key]))) report.failures.push(`${key}: public camera state changed during update`)
    }
    report.cameraAfter = await cameraState()
    compareCameras(report.cameraAfter, 'after')
    for (const route of ['a', 'b']) if (JSON.stringify(cameraBefore[route]) !== JSON.stringify(report.cameraAfter[route])) report.failures.push(`${route}: camera changed during update`)
    await page.screenshot({ path: join(output, 'c2-after.png'), fullPage: true })
    if (canvasCount !== 2 || await canvases.count() !== 2) report.pending.push('Expected two visible canvases for independent screen-change checks')
    else for (let i = 0; i < 2; i++) {
      const after = await canvases.nth(i).screenshot()
      if (beforeImages[i].equals(after)) report.failures.push(`canvas ${i}: no screen change after tiered update`)
    }
  }
} catch (error) { report.failures.push(error.stack || String(error)) }
finally {
  if (browser) await browser.close()
  try {
    report.provenanceAfter = await provenance()
    if (report.provenanceBefore && (report.provenanceBefore.head !== report.provenanceAfter.head || JSON.stringify(report.provenanceBefore.hashes) !== JSON.stringify(report.provenanceAfter.hashes))) report.failures.push('Source, artifacts or HEAD changed during inspection')
  } catch (error) { report.failures.push(`Final provenance: ${error}`) }
  report.finished = new Date().toISOString()
  await writeFile(join(output, 'c2-results.json'), JSON.stringify(report, null, 2) + '\n')
}
if (report.failures.length) process.exitCode = 1
else if (report.pending.length) process.exitCode = 2
