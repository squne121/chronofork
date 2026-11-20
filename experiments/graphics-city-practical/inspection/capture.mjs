/* global process, console, window, location, requestAnimationFrame */
// From experiments/graphics-city-practical, start the existing Vite dependency:
// ./node_modules/.bin/vite --config inspection/vite.config.mjs --configLoader native
// In another shell, use an existing Playwright installation (no downloads):
// NODE_PATH=/path/to/existing/node_modules node inspection/capture.mjs http://127.0.0.1:5178/
// node inspection/analyze.mjs
// Outputs and the Vite cache stay under inspection/. Capture overwrites prior outputs.
// Material fingerprints cover only the recorded fields, not textures or shader code.
// Fingerprints are non-cryptographic; IDs and matrices must also be compared.
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const here = dirname(fileURLToPath(import.meta.url))
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const output = join(here, 'output')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.cityComparison?.ready || window.cityComparison?.error, null, { timeout: 30000 })
  const error = await page.evaluate(() => window.cityComparison.error || null)
  if (error) throw new Error(`Comparison load failed: ${error}`)
  for (const mode of ['normal', 'close']) {
    await page.evaluate(mode => window.cityComparison.setView(mode), mode)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const record = await page.evaluate(() => {
      const api = window.cityComparison
      const vec = v => v ? [v.x, v.y, v.z] : null
      // Stable, non-cryptographic fingerprints support comparisons, not proof of equality.
      const fingerprint = text => {
        let h = 2166136261
        for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) }
        return (h >>> 0).toString(16).padStart(8, '0')
      }
      const attributeFingerprint = a => {
        const parts = [a.itemSize, a.count, a.normalized]
        for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) parts.push(a.getComponent(i, c))
        return fingerprint(JSON.stringify(parts))
      }
      const result = { capturedAt: new Date().toISOString(), url: location.href, city: api.city, views: {} }
      for (const [variant, view] of Object.entries(api.views)) {
        const { scene, camera, renderer } = view
        scene.updateMatrixWorld(true)
        camera.updateMatrixWorld(true)
        const objects = []
        scene.traverse(object => {
          const geometry = object.geometry
          const attribute = geometry?.attributes?.position
          let bounds = null
          if (attribute && !object.isInstancedMesh && !object.isSkinnedMesh) {
            const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
            const e = object.matrixWorld.elements
            for (let i = 0; i < attribute.count; i++) {
              const x = attribute.getX(i), y = attribute.getY(i), z = attribute.getZ(i)
              const p = [e[0]*x + e[4]*y + e[8]*z + e[12], e[1]*x + e[5]*y + e[9]*z + e[13], e[2]*x + e[6]*y + e[10]*z + e[14]]
              for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], p[axis]); max[axis] = Math.max(max[axis], p[axis]) }
            }
            if (attribute.count) bounds = { min, max }
          }
          const materials = object.material ? (Array.isArray(object.material) ? object.material : [object.material]).map(m => ({ name: m.name, type: m.type, color: m.color?.getHexString(), opacity: m.opacity, transparent: m.transparent, visible: m.visible, side: m.side, wireframe: m.wireframe })) : []
          objects.push({ id: object.id, uuid: object.uuid, name: object.name, type: object.type, parent: object.parent?.uuid || null, visible: object.visible, position: vec(object.position), rotation: object.rotation ? [object.rotation.x, object.rotation.y, object.rotation.z, object.rotation.order] : null, scale: vec(object.scale), matrixWorld: object.matrixWorld.elements.slice(), userData: object.userData, geometry: geometry ? { type: geometry.type, parameters: geometry.parameters || null, vertexCount: attribute?.count || 0, indexCount: geometry.index?.count || 0, attributeFingerprints: Object.fromEntries(Object.entries(geometry.attributes).map(([name, value]) => [name, attributeFingerprint(value)])), indexFingerprint: geometry.index ? attributeFingerprint(geometry.index) : null, worldBounds: bounds, boundsLimitation: object.isInstancedMesh || object.isSkinnedMesh ? 'instance/skin transforms not evaluated' : null } : null, materials, materialFingerprint: fingerprint(JSON.stringify(materials)) })
        })
        result.views[variant] = { variant: view.variant, camera: { type: camera.type, position: vec(camera.position), matrixWorld: camera.matrixWorld.elements.slice(), projectionMatrix: camera.projectionMatrix.elements.slice() }, canvas: { width: renderer.domElement.width, height: renderer.domElement.height, clientWidth: renderer.domElement.clientWidth, clientHeight: renderer.domElement.clientHeight }, objects }
      }
      return result
    })
    record.pageErrors = errors
    await writeFile(join(output, `${mode}.json`), JSON.stringify(record, null, 2))
    await page.screenshot({ path: join(output, `${mode}.png`), animations: 'disabled' })
    for (const variant of ['a', 'b']) {
      const handle = await page.evaluateHandle(variant => window.cityComparison.views[variant].renderer.domElement, variant)
      await handle.asElement().screenshot({ path: join(output, `${mode}-${variant}.png`), animations: 'disabled' })
      await handle.dispose()
    }
    console.log(`${mode}: captured ${Object.keys(record.views).join(', ')}`)
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`)
} finally {
  await browser.close()
}
