/* global process, console, window, structuredClone */
// Independent browser inspection of the displayed C0 scene; not a visual review.
// Run with a Vite server running: CITY_URL=http://127.0.0.1:5173/ node inspect-c0.mjs
import { chromium } from '@playwright/test'

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto(process.env.CITY_URL ?? 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.experiment?.b, null, { timeout: 15000 })
  const report = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js')
    const experiment = window.experiment
    const { a, b } = experiment
    const originalCity = experiment.city
    let city
    const failures = [], pending = [], checked = []
    const near = (a, b, eps = 1e-4) => Number.isFinite(a) && Math.abs(a - b) <= eps
    const check = (condition, message) => { if (!condition) failures.push(message) }
    const vec = (actual, expected, message) => check(actual.length === expected.length && actual.every((v, i) => near(v, expected[i])), `${message}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`)
    const vertices = object => {
      const points = []
      object.updateWorldMatrix(true, true)
      object.traverseVisible(child => {
        if (!child.isMesh || !child.geometry?.attributes.position) return
        const geometry = child.geometry, p = geometry.attributes.position, index = geometry.index
        const count = index ? index.count : p.count
        const range = geometry.drawRange
        const start = Math.max(0, range.start), end = Math.min(count, range.start + range.count)
        const groups = Array.isArray(child.material) ? geometry.groups : [{ start: 0, count, materialIndex: 0 }]
        for (const group of groups) {
          const material = Array.isArray(child.material) ? child.material[group.materialIndex] : child.material
          if (!material?.visible) continue
          const first = Math.max(start, group.start), last = Math.min(end, group.start + group.count)
          for (let i = first; i + 2 < last; i += 3) {
            const indices = [0, 1, 2].map(j => index ? index.getX(i + j) : i + j)
            if (indices.some(vertex => vertex < 0 || vertex >= p.count)) continue
            const triangle = indices.map(vertex => new THREE.Vector3().fromBufferAttribute(p, vertex).applyMatrix4(child.matrixWorld))
            const area = triangle[1].clone().sub(triangle[0]).cross(triangle[2].clone().sub(triangle[0])).lengthSq()
            if (area > 1e-16) points.push(...triangle)
          }
        }
      })
      return points
    }
    const bounds = points => {
      const box = new THREE.Box3().setFromPoints(points)
      return [box.min.toArray(), box.max.toArray()]
    }
    const alternateCity = structuredClone(originalCity)
    alternateCity.districts[0].y = -3
    for (const building of alternateCity.buildings) if (building.district === alternateCity.districts[0].id) building.y = -3
    const [fromDistrict, toDistrict] = alternateCity.districts
    alternateCity.bridge = { from: [fromDistrict.x + fromDistrict.width / 2, fromDistrict.y, -2], to: [toDistrict.x - toDistrict.width / 2, toDistrict.y, 2], width: 1.3 }
    const snapshot = object => {
      const nodes = []
      object.updateWorldMatrix(true, true)
      object.traverse(node => {
        const geometry = node.geometry
        const materials = node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []
        nodes.push({ node, geometry, materials, data: JSON.stringify({ name: node.name, kind: node.userData.kind, matrix: node.matrixWorld.toArray(), visible: node.visible, geometry: geometry && { index: geometry.index && Array.from(geometry.index.array), attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([key, attr]) => [key, Array.from(attr.array)])), drawRange: geometry.drawRange, groups: geometry.groups }, materials: materials.map(m => m.toJSON()) }) })
      })
      return nodes
    }
    try {
    for (const [caseName, input] of [['original', originalCity], ['alternate', alternateCity]]) {
    city = input
    experiment.setCity(city)
    check(city.districts.length === 3 && city.buildings.length === 30, 'input must contain 3 districts and 30 buildings')
    check(new Set(city.buildings.map(x => x.id)).size === city.buildings.length, 'input building IDs must be unique')
    for (const district of city.districts) check(city.buildings.filter(x => x.district === district.id).length === 10, `${district.id}: expected 10 buildings`)
    for (const [label, view] of [['A', a], ['B', b]]) {
      if (!view) { pending.push(`${label}: scene unavailable (GLB load may have failed)`); continue }
      const ids = city.buildings.map(x => x.id).sort()
      check(JSON.stringify([...view.objects.keys()].sort()) === JSON.stringify(ids), `${label}: object IDs differ from input`)
      for (const building of city.buildings) {
        const prefix = `${label}/${building.id}`
        const object = view.objects.get(building.id)
        if (!object) { failures.push(`${prefix}: missing`); continue }
        check(object.name === building.id && object.userData.kind === building.kind, `${prefix}: ID or kind mismatch`)
        check(object.parent === view.scene, `${prefix}: object is not in the scene`)
        const points = vertices(object)
        if (!points.length) { failures.push(`${prefix}: no mesh vertices`); continue }
        const [min, max] = bounds(points)
        vec(min, [building.x - building.width / 2, building.y, building.z - building.depth / 2], `${prefix} minimum world bounds`)
        vec(max, [building.x + building.width / 2, building.y + building.height, building.z + building.depth / 2], `${prefix} maximum world bounds`)
        // The contract describes the corners of each horizontal face, not vertex order or triangulation.
        for (const [height, factor] of [[0, 1], [1, building.kind === 'taper' ? 0.6 : 1]]) {
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            const expected = [building.x + sx * building.width * factor / 2, building.y + height * building.height, building.z + sz * building.depth * factor / 2]
            check(points.some(p => p.toArray().every((v, i) => near(v, expected[i]))), `${prefix}: missing ${height ? 'top' : 'base'} corner ${expected}`)
          }
        }
        const expectedColor = new THREE.Color(building.affiliation)
        let meshCount = 0
        object.traverse(child => {
          if (!child.isMesh) return
          meshCount++
          for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
            check(!!material?.color && near(material.color.r, expectedColor.r) && near(material.color.g, expectedColor.g) && near(material.color.b, expectedColor.b), `${prefix}: material color mismatch`)
          }
        })
        check(meshCount > 0, `${prefix}: no mesh`)
      }
      for (const d of city.districts) {
        const terrain = view.scene.getObjectByName(`terrain:${d.id}`)
        if (!terrain) { failures.push(`${label}: missing terrain ${d.id}`); continue }
        const [min, max] = bounds(vertices(terrain))
        vec(min, [d.x - d.width / 2, Math.min(-2, d.y - 2), d.z - d.depth / 2], `${label}/${d.id} terrain minimum`)
        vec(max, [d.x + d.width / 2, d.y, d.z + d.depth / 2], `${label}/${d.id} terrain maximum`)
      }
      const bridge = view.scene.getObjectByName('bridge')
      if (!bridge) failures.push(`${label}: missing bridge`)
      else {
        bridge.updateWorldMatrix(true, true)
        const p = bridge.geometry?.parameters
        if (!p || !Number.isFinite(p.width)) pending.push(`${label}: bridge geometry does not expose local dimensions`)
        else {
          const endpoints = [-p.width / 2, p.width / 2].map(x => new THREE.Vector3(x, 0, 0).applyMatrix4(bridge.matrixWorld).toArray())
          vec(endpoints[0], city.bridge.from, `${label} bridge from center`)
          vec(endpoints[1], city.bridge.to, `${label} bridge to center`)
          const edgeA = new THREE.Vector3(0, 0, -p.depth / 2).applyMatrix4(bridge.matrixWorld)
          const edgeB = new THREE.Vector3(0, 0, p.depth / 2).applyMatrix4(bridge.matrixWorld)
          check(near(edgeA.distanceTo(edgeB), city.bridge.width), `${label}: bridge world width mismatch`)
          check(vertices(bridge).length > 0, `${label}: bridge has no visible drawn triangles`)
          for (const [index, endpoint] of [city.bridge.from, city.bridge.to].entries()) {
            check(city.districts.some(d => near(endpoint[1], d.y) && endpoint[0] >= d.x - d.width / 2 - 1e-4 && endpoint[0] <= d.x + d.width / 2 + 1e-4 && endpoint[2] >= d.z - d.depth / 2 - 1e-4 && endpoint[2] <= d.z + d.depth / 2 + 1e-4), `${label}: bridge endpoint ${index} does not meet a district top`)
          }
        }
      }
      // Exercise a second placement on the actual scene, preserving all other instances.
      const original = city.buildings[0]
      if (original && view.objects.has(original.id)) {
        const before = new Map(view.objects)
        const snapshots = new Map([...before].filter(([id]) => id !== original.id).map(([id, obj]) => [id, snapshot(obj)]))
        const moved = { ...original, x: original.x + 0.37, z: original.z - 0.29, width: original.width * 1.2, height: original.height * 1.1 }
        try {
          experiment.updateBuilding(moved)
          check(experiment.city.buildings.find(item => item.id === moved.id)?.x === moved.x, `${label}: common API city not updated`)
          const object = view.objects.get(original.id)
          check(object === before.get(original.id), `${label}: changed placement replaced target`)
          for (const [id, old] of before) if (id !== original.id) {
            check(view.objects.get(id) === old && old.parent === view.scene, `${label}: unrelated object ${id} replaced or removed`)
            const previous = snapshots.get(id), current = snapshot(old)
            check(previous.length === current.length && previous.every((entry, i) => entry.node === current[i].node && entry.geometry === current[i].geometry && entry.materials.length === current[i].materials.length && entry.materials.every((m, j) => m === current[i].materials[j]) && entry.data === current[i].data), `${label}: unrelated object ${id} geometry, transform, material or ID changed`)
          }
          const [min, max] = bounds(vertices(object))
          vec(min, [moved.x - moved.width / 2, moved.y, moved.z - moved.depth / 2], `${label}: alternate placement minimum`)
          vec(max, [moved.x + moved.width / 2, moved.y + moved.height, moved.z + moved.depth / 2], `${label}: alternate placement maximum`)
        } finally { experiment.updateBuilding(original) }
      }
      checked.push(`${caseName}/${label}`)
    }
    }
    } finally { experiment.setCity(originalCity) }
    return { checked, failures, pending }
  })
  report.failures.push(...errors.map(error => `pageerror: ${error}`))
  console.log(JSON.stringify(report, null, 2))
  if (report.failures.length) process.exitCode = 1
  else if (report.pending.length) process.exitCode = 2
} finally {
  await browser.close()
}
