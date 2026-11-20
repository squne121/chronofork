/* global window, structuredClone, URL, process */
import { chromium } from '@playwright/test'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

const errors = [], runs = []
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const started = new Date().toISOString()
async function launch() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1400, height: 650 } })
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto('http://127.0.0.1:5189/', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.experiment?.a && window.experiment?.b)
  return { browser, page }
}
// Separate browser processes reconstruct both views from the same C0 input and artifacts.
for (let run = 0; run < 2; run++) {
  const { browser, page } = await launch()
  try {
    const data = await page.evaluate(() => {
      const e = window.experiment
      const serialize = view => {
        view.scene.updateMatrixWorld(true)
        const rows = []
        function visit(o, path) {
          const row = { path, name: o.name, type: o.type, kind: o.userData.kind ?? null, matrix: o.matrixWorld.toArray() }
          if (o.isMesh) {
            row.geometry = { attributes: Object.fromEntries(Object.entries(o.geometry.attributes).map(([k,v]) => [k, { itemSize: v.itemSize, values: Array.from(v.array) }])), index: o.geometry.index && Array.from(o.geometry.index.array) }
            const material = Array.isArray(o.material) ? o.material : [o.material]
            row.material = material.map(m => { const json = m.toJSON(); delete json.uuid; return json })
          }
          rows.push(row)
          o.children.forEach((child, i) => visit(child, `${path}/${i}`))
        }
        visit(view.scene, 'root')
        return rows
      }
      return { input: structuredClone(e.city), a: serialize(e.a), b: serialize(e.b) }
    })
    const path = new URL(`./c1-regeneration-${run}.json`, import.meta.url)
    await writeFile(path, JSON.stringify(data))
    runs.push({ input: hash(data.input), a: hash(data.a), b: hash(data.b), counts: { a: data.a.length, b: data.b.length } })
  } finally { await browser.close() }
}
for (const key of ['input', 'a', 'b']) if (runs[0][key] !== runs[1][key]) errors.push(`fresh process mismatch ${key}`)
const { browser, page } = await launch()
try {
  const result = await page.evaluate(() => {
    const e = window.experiment, errors = [], base = structuredClone(e.city)
    function capture(view) {
      const rows = []
      view.scene.updateMatrixWorld(true)
      function visit(o, path, owner) {
        const building = base.buildings.find(b => b.id === o.name)
        owner = building?.id ?? owner
        const meshes = o.isMesh ? { geometry: o.geometry, attrs: JSON.stringify({ a: Object.fromEntries(Object.entries(o.geometry.attributes).map(([k,v]) => [k, Array.from(v.array)])), i: o.geometry.index && Array.from(o.geometry.index.array) }), material: o.material, materialData: JSON.stringify(o.material.toJSON()) } : null
        rows.push({ o, path, owner, name: o.name, kind: o.userData.kind, matrix: JSON.stringify(o.matrixWorld.toArray()), local: JSON.stringify(o.matrix.toArray()), rotation: JSON.stringify(o.quaternion.toArray()), meshes })
        o.children.forEach((child, i) => visit(child, `${path}/${i}`, owner))
      }
      visit(view.scene, 'root', null)
      return rows
    }
    const original = { a: capture(e.a), b: capture(e.b) }
    for (const route of ['a','b']) {
      const view = e[route], all = original[route]
      if (view.objects.size !== base.buildings.length) errors.push(`${route} map size`)
      for (const b of base.buildings) {
        const found = all.filter(row => row.name === b.id)
        if (found.length !== 1 || view.objects.get(b.id) !== found[0]?.o) errors.push(`${route} ${b.id} missing/duplicate`)
      }
    }
    for (const scenario of ['color','dimensions']) {
      e.setCity(structuredClone(base))
      const changed = structuredClone(base)
      for (const b of changed.buildings) if (b.district === 'center') {
        if (scenario === 'color') b.affiliation = '#49a460'
        else { b.width *= 1.2; b.height *= 1.3 }
      }
      e.setCity(changed)
      for (const route of ['a','b']) {
        const view = e[route], old = original[route], now = capture(view)
        if (old.length !== now.length) errors.push(`${scenario} ${route} scene count`)
        for (let i = 0; i < Math.max(old.length, now.length); i++) {
          const a = old[i], b = now[i]
          if (!a || !b || a.o !== b.o || a.path !== b.path || a.name !== b.name || a.owner !== b.owner || a.kind !== b.kind) { errors.push(`${scenario} ${route} scene identity ${i}`); continue }
          const target = a.owner?.startsWith('center-')
          if ((!target || scenario === 'color') && a.matrix !== b.matrix) errors.push(`${scenario} ${route} transform ${i}`)
          if (target && scenario === 'dimensions' && (a.name === a.owner ? a.rotation !== b.rotation : a.local !== b.local)) errors.push(`${scenario} ${route} target local transform ${i}`)
          if (a.meshes && (!b.meshes || a.meshes.geometry !== b.meshes.geometry || a.meshes.attrs !== b.meshes.attrs || a.meshes.material !== b.meshes.material || (!target && a.meshes.materialData !== b.meshes.materialData))) errors.push(`${scenario} ${route} mesh ${i}`)
        }
        for (const b of changed.buildings.filter(b => b.district === 'center')) {
          const obj = view.objects.get(b.id), found = now.filter(row => row.owner === b.id && row.meshes)
          if (!obj || !found.length || obj.name !== b.id || obj.userData.kind !== b.kind || JSON.stringify(obj.position.toArray()) !== JSON.stringify([b.x,b.y,b.z]) || JSON.stringify(obj.scale.toArray()) !== JSON.stringify([b.width,b.height,b.depth])) errors.push(`${scenario} ${route} target ${b.id}`)
          for (const row of found) if (row.o.material.color.getHexString() !== b.affiliation.slice(1)) errors.push(`${scenario} ${route} target color ${b.id}`)
        }
      }
      const prior = { a: capture(e.a), b: capture(e.b) }
      e.setCity(structuredClone(changed))
      for (const route of ['a', 'b']) {
        const before = prior[route], after = capture(e[route])
        if (before.length !== after.length) errors.push(`${scenario} ${route} repeat scene count`)
        for (let i = 0; i < Math.max(before.length, after.length); i++) {
          const a = before[i], b = after[i]
          if (!a || !b || a.o !== b.o || a.path !== b.path || a.owner !== b.owner || a.name !== b.name || a.kind !== b.kind || a.matrix !== b.matrix || a.local !== b.local || a.rotation !== b.rotation || Boolean(a.meshes) !== Boolean(b.meshes) || (a.meshes && (a.meshes.geometry !== b.meshes.geometry || a.meshes.attrs !== b.meshes.attrs || a.meshes.material !== b.meshes.material || a.meshes.materialData !== b.meshes.materialData))) errors.push(`${scenario} ${route} repeat scene ${i}`)
        }
      }
    }
    return { errors, sceneCounts: { a: original.a.length, b: original.b.length } }
  })
  errors.push(...result.errors)
  runs.push(result)
} finally { await browser.close() }
const report = { started, finished: new Date().toISOString(), runs, errors }
await writeFile(new URL('./c1-expanded-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
if (errors.length) process.exitCode = 1
