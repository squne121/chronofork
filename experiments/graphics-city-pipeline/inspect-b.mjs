/* global process, console, window, URL */
// C0部分検査。A/B比較や人間による評価ではない。
import { chromium } from '@playwright/test'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(process.env.CITY_URL ?? 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.experiment?.b)
  const result = await page.evaluate(() => {
    const { b, city } = window.experiment
    const rows = [...b.objects.entries()].map(([id, obj]) => {
      const mesh = []; obj.traverse(o => { if (o.isMesh) mesh.push({ vertices: o.geometry.attributes.position.count, material: o.material.color.getHexString() }) })
      return { id, kind: obj.userData.kind, position: obj.position.toArray(), scale: obj.scale.toArray(), mesh }
    })
    return { count: rows.length, expected: city.buildings.length, rows }
  })
  if (errors.length || result.count !== 30 || result.rows.some(r => !r.mesh.length || r.mesh.some(m => !m.vertices))) throw new Error(JSON.stringify({ errors, result }))
  await page.screenshot({ path: new URL('./b-only.png', import.meta.url).pathname })
  console.log(JSON.stringify(result, null, 2))
} finally { await browser.close() }
