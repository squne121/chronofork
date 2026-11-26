/* global process, console, window */
// Reproduction of the independent C0 mesh and bridge-vertex measurements.
// Start the experiment server first, then run:
// CITY_URL=http://127.0.0.1:5189/ node inspect-c0-independent-mesh.mjs
// This reports measurements; it does not itself assert bridge contact or C0 PASS.
import { chromium } from '@playwright/test'

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await page.goto(process.env.CITY_URL ?? 'http://127.0.0.1:5189/', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.experiment?.a && window.experiment?.b)
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js')
    const out = {}
    for (const [name, view] of [['A', window.experiment.a], ['B', window.experiment.b]]) {
      const buildings = []
      for (const [id, object] of view.objects) {
        object.updateWorldMatrix(true, true)
        const edges = new Map()
        let triangles = 0
        let volume = 0
        object.traverse(child => {
          if (!child.isMesh) return
          const geometry = child.geometry
          const position = geometry.attributes.position
          const index = geometry.index
          const count = index ? index.count : position.count
          const key = point => point.toArray().map(value => value.toFixed(5)).join(',')
          for (let i = 0; i < count; i += 3) {
            const points = [0, 1, 2].map(j => new THREE.Vector3()
              .fromBufferAttribute(position, index ? index.getX(i + j) : i + j)
              .applyMatrix4(child.matrixWorld))
            if (points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).lengthSq() < 1e-14) continue
            triangles++
            volume += points[0].dot(points[1].clone().cross(points[2])) / 6
            for (let j = 0; j < 3; j++) {
              const edge = [key(points[j]), key(points[(j + 1) % 3])].sort().join('|')
              edges.set(edge, (edges.get(edge) || 0) + 1)
            }
          }
        })
        buildings.push({ id, tri: triangles, openEdges: [...edges.values()].filter(count => count !== 2).length, volume: +volume.toFixed(5) })
      }
      const bridge = view.scene.getObjectByName('bridge')
      bridge.updateWorldMatrix(true, true)
      const position = bridge.geometry.attributes.position
      const bridgeVertices = []
      for (let i = 0; i < position.count; i++) {
        const vertex = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(bridge.matrixWorld)
          .toArray().map(value => +value.toFixed(5))
        if (!bridgeVertices.some(existing => JSON.stringify(existing) === JSON.stringify(vertex))) bridgeVertices.push(vertex)
      }
      out[name] = { buildings, bridgeVertices }
    }
    return out
  })
  console.log(JSON.stringify(results, null, 2))
} finally {
  await browser.close()
}
