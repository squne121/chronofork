/* global window, structuredClone, URL, process, performance */
import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const report = { started: new Date().toISOString(), camera: { position: [28, 32, 36], target: [0, 1, 0], zoom: 1 }, scenarios: [], errors: [] }
try {
  for (const scenario of ['color', 'dimensions']) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 650 }, deviceScaleFactor: 1 })
    page.on('pageerror', error => report.errors.push(String(error)))
    await page.goto('http://127.0.0.1:5189/', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => window.experiment?.a && window.experiment?.b)
    await page.evaluate(camera => window.experiment.setCameraState(camera), report.camera)
    const result = await page.evaluate(async scenario => {
      const e = window.experiment
      const baseline = structuredClone(e.city)
      const changed = structuredClone(baseline)
      for (const building of changed.buildings) if (building.district === 'center') {
        if (scenario === 'color') building.affiliation = '#49a460'
        else { building.height *= 1.3; building.width *= 1.2 }
      }
      const errors = []
      const snapshot = view => {
        const result = new Map()
        view.scene.updateMatrixWorld(true)
        view.scene.traverse(object => {
          if (!object.name) return
          const meshes = []
          object.traverse(child => { if (child.isMesh) meshes.push({ object: child, geometry: child.geometry, material: child.material, geometryData: JSON.stringify({ attributes: Object.fromEntries(Object.entries(child.geometry.attributes).map(([k,v]) => [k, Array.from(v.array)])), index: child.geometry.index && Array.from(child.geometry.index.array) }), matrix: child.matrixWorld.toArray(), color: child.material.color?.getHexString(), materialData: JSON.stringify(child.material.toJSON()) }) })
          result.set(object.name, { object, name: object.name, matrix: object.matrixWorld.toArray(), meshes })
        })
        return result
      }
      const before = { a: snapshot(e.a), b: snapshot(e.b) }
      const checkUnchanged = (old, now, route, phase) => {
        for (const [id, value] of old) {
          if (id.startsWith('center-')) continue
          const next = now.get(id)
          if (!next || value.object !== next.object || JSON.stringify(value.matrix) !== JSON.stringify(next.matrix) || value.meshes.length !== next.meshes.length) { errors.push(`${phase} ${route} ${id} object`); continue }
          value.meshes.forEach((m, i) => { const n = next.meshes[i]; if (m.object !== n.object || m.geometry !== n.geometry || m.material !== n.material || m.geometryData !== n.geometryData || JSON.stringify(m.matrix) !== JSON.stringify(n.matrix) || m.color !== n.color || m.materialData !== n.materialData) errors.push(`${phase} ${route} ${id} mesh ${i}`) })
        }
      }
      const timings = []
      for (let run = 0; run < 4; run++) {
        e.setOrder(run % 2 ? 'ba' : 'ab')
        e.setCity(structuredClone(baseline))
        const renderTimes = { a: 0, b: 0 }, renderCounts = { a: 0, b: 0 }
        for (const route of ['a', 'b']) {
          const renderer = e[route].renderer, original = renderer.render
          renderer.render = function (...args) { const start = performance.now(); try { return original.apply(this, args) } finally { renderTimes[route] += performance.now() - start; renderCounts[route]++ } }
          renderer.__restore = () => { renderer.render = original }
        }
        const start = performance.now()
        e.setCity(structuredClone(changed))
        const wall = performance.now() - start
        for (const route of ['a', 'b']) e[route].renderer.__restore()
        const now = { a: snapshot(e.a), b: snapshot(e.b) }
        for (const route of ['a', 'b']) {
          checkUnchanged(before[route], now[route], route, `run${run}`)
          for (const building of changed.buildings.filter(b => b.district === 'center')) {
            const obj = e[route].objects.get(building.id)
            if (!obj || obj.name !== building.id || Math.abs(obj.scale.x - building.width) > 1e-8 || Math.abs(obj.scale.y - building.height) > 1e-8) errors.push(`${route} ${building.id} dimensions`)
            obj?.traverse(child => { if (child.isMesh && child.material.color.getHexString() !== building.affiliation.slice(1)) errors.push(`${route} ${building.id} color`) })
          }
        }
        const againBefore = { a: snapshot(e.a), b: snapshot(e.b) }
        e.setCity(structuredClone(changed))
        for (const route of ['a', 'b']) {
          const after = snapshot(e[route])
          // For same-input regeneration all objects, including the target, must remain unchanged.
          for (const [id, value] of againBefore[route]) {
            const next = after.get(id)
            if (!next || value.object !== next.object || JSON.stringify(value.matrix) !== JSON.stringify(next.matrix) || value.meshes.length !== next.meshes.length || value.meshes.some((m, i) => { const n = next.meshes[i]; return m.object !== n.object || m.geometry !== n.geometry || m.material !== n.material || m.geometryData !== n.geometryData || JSON.stringify(m.matrix) !== JSON.stringify(n.matrix) || m.color !== n.color || m.materialData !== n.materialData })) errors.push(`repeat ${route} ${id}`)
          }
        }
        timings.push({ run: run === 0 ? 'warm-remeasurement-1' : `warm-remeasurement-${run + 1}`, order: run % 2 ? 'B,A' : 'A,B', commonSetCityMs: wall, renderTimesMs: renderTimes, renderCounts })
      }
      return { scenario, target: 'center (10 buildings)', errors, timings }
    }, scenario)
    await page.screenshot({ path: new URL(`./c1-${scenario}.png`, import.meta.url).pathname, fullPage: true })
    report.scenarios.push(result)
    await page.close()
  }
} catch (error) { report.errors.push(error.stack || String(error)) }
finally {
  report.finished = new Date().toISOString()
  await browser.close()
  await writeFile(new URL('./c1-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
}
if (report.errors.length || report.scenarios.length !== 2 || report.scenarios.some(s => s.errors.length)) process.exitCode = 1
