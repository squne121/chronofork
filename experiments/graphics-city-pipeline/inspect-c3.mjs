/* global window, structuredClone, process */
import { startC3Server } from './c3-server.mjs'
import { chromium } from '@playwright/test'
import { mkdtemp, cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
const root = dirname(fileURLToPath(import.meta.url)), temp = await mkdtemp(join(tmpdir(), 'city-c3-'))
const report = { started: new Date().toISOString(), temporaryCopy: temp, processes: [], failures: [], pending: [] }
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex')
const assets = ['block.glb', 'taper.glb', 'tiered.glb', 'parts.blend']
try {
  await mkdir(join(temp, 'route-a'), { recursive: true }); await mkdir(join(temp, 'public/a'), { recursive: true })
  await cp(join(root, 'route-a/generate.py'), join(temp, 'route-a/generate.py'))
  for (const name of ['src', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json']) await cp(join(root, name), join(temp, name), { recursive: true })
  await cp(join(root, 'node_modules'), join(temp, 'node_modules'), { recursive: true })
  report.originalBefore = Object.fromEntries(await Promise.all(assets.map(async name => [name, await hash(join(root, 'public/a', name))])))
  const blender = '/home/squne/.local/opt/chronofork-blender-5.2.4.uUPgtwDV/blender-5.2.4-linux-x64/blender'
  const libs = '/home/squne/.local/opt/chronofork-blender-libs.GxcyFo8m/usr/lib/x86_64-linux-gnu'
  for (let i = 0; i < 4; i++) for (const route of i % 2 ? ['b', 'a'] : ['a', 'b']) {
    const start = performance.now(), began = new Date().toISOString()
    const result = route === 'a' ? spawnSync(blender, ['--background', '--python', join(temp, 'route-a/generate.py')], { cwd: temp, encoding: 'utf8', env: { ...process.env, LD_LIBRARY_PATH: libs }, maxBuffer: 20_000_000 }) : spawnSync('npm', ['run', 'build'], { cwd: temp, encoding: 'utf8', maxBuffer: 20_000_000 })
    report.processes.push({ route, iteration: i === 0 ? 'first' : `repeat-${i}`, began, elapsedMs: performance.now() - start, status: result.status, error: result.error?.message, stdout: result.stdout, stderr: result.stderr })
    if (result.status !== 0) report.failures.push(`${route} ${i} process failed`)
  }
  report.originalAfter = Object.fromEntries(await Promise.all(assets.map(async name => [name, await hash(join(root, 'public/a', name))])))
  report.regenerated = Object.fromEntries(await Promise.all(assets.map(async name => [name, await hash(join(temp, 'public/a', name))])))
  report.bDist = Object.fromEntries(await Promise.all((await readdir(join(temp, 'node_modules/.cache/city-dist/assets'))).map(async name => [name, await hash(join(temp, 'node_modules/.cache/city-dist/assets', name))])))
  if (JSON.stringify(report.originalBefore) !== JSON.stringify(report.originalAfter)) report.failures.push('original assets changed')
  const server = await startC3Server(temp)
  const browser = await chromium.launch({ headless: true }).catch(error => { server.kill(); throw error })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 })
    page.on('pageerror', error => report.failures.push(String(error)))
    await page.goto('http://127.0.0.1:5198/', { waitUntil: 'networkidle' }); await page.waitForFunction(() => window.experiment?.a && window.experiment?.b)
    report.result = await page.evaluate(async () => {
      const THREE = await import('/node_modules/three/build/three.module.js'), e = window.experiment, original = structuredClone(e.city), next = structuredClone(original)
      for (const d of next.districts) d.z += ({ west: -2, center: 0, east: 3 })[d.id]
      for (const b of next.buildings) { b.z += ({ west: -2, center: 0, east: 3 })[b.district]; if (b.id.endsWith('-1')) b.x += 0.6 }
      next.bridge.to[2] += 3
      const camera = { position: [28,32,36], target: [0,1,0], zoom: 1 }; e.setCameraState(camera)
      const t = performance.now(); e.setOrder('ba'); e.setCity(next); const setCityMs = performance.now()-t
      const fail = [], check = (ok, msg) => { if (!ok) fail.push(msg) }, near = (a,b) => Math.abs(a-b)<1e-4
      const target = next.buildings[0], measurements = {}
      const snap = view => { view.scene.updateMatrixWorld(true); const rows = []; function visit(n, owner) { if (next.buildings.some(b=>b.id===n.name)) owner=n.name; if(owner!==target.id) { const mats=n.material ? (Array.isArray(n.material)?n.material:[n.material]):[]; rows.push({ node:n, geometry:n.geometry, mats, data:JSON.stringify({name:n.name, kind:n.userData.kind, matrix:n.matrixWorld.toArray(), geometry:n.geometry && { attributes:Object.fromEntries(Object.entries(n.geometry.attributes).map(([k,a])=>[k,Array.from(a.array)])), index:n.geometry.index && Array.from(n.geometry.index.array), groups:n.geometry.groups, drawRange:n.geometry.drawRange }, materials:mats.map(m=>m.toJSON())}) }) } n.children.forEach(c=>visit(c,owner)) } visit(view.scene,null); return rows }
      for (const r of ['a','b']) { const v=e[r]; v.scene.updateMatrixWorld(true); const boxes={}; for(const b of next.buildings) { const o=v.objects.get(b.id); check(!!o && o.name===b.id, `${r} ID ${b.id}`); if(!o) continue; const box=new THREE.Box3().setFromObject(o); boxes[b.id]=[box.min.toArray(),box.max.toArray()]; check(near(box.min.x,b.x-b.width/2)&&near(box.max.x,b.x+b.width/2)&&near(box.min.y,b.y)&&near(box.max.y,b.y+b.height)&&near(box.min.z,b.z-b.depth/2)&&near(box.max.z,b.z+b.depth/2),`${r} bounds ${b.id}`) } const bridge=v.scene.getObjectByName('bridge'); bridge.updateWorldMatrix(true,false); const ends=[new THREE.Vector3(-.5,0,0).applyMatrix4(bridge.matrixWorld).toArray(),new THREE.Vector3(.5,0,0).applyMatrix4(bridge.matrixWorld).toArray()]; check(ends.every((p,i)=>p.every((x,j)=>near(x,[next.bridge.from,next.bridge.to][i][j]))),`${r} bridge endpoints`); measurements[r]={boxes,ends,camera:v.getCameraState()} }
      check(JSON.stringify(measurements.a.camera)===JSON.stringify(measurements.b.camera),'camera differs'); check(JSON.stringify(next)!==JSON.stringify(original),'input unchanged'); check(next.bridge.from[2]!==next.bridge.to[2],'bridge has no Z difference')
      window.__c3 = { next, target:target.id, before:{a:snap(e.a),b:snap(e.b)}, snap, measurements, fail, original, setCityMs }
      return {input:next, original, target:target.id, measurements, failures:fail, setCityMs}
    })
    await page.screenshot({ path: join(root,'c3-alternate.png'), fullPage:true })
    const changed = await page.evaluate(() => { const e=window.experiment, c=window.__c3, target=structuredClone(c.next.buildings[0]); target.height += 1.2; target.affiliation='#ee3377'; const t=performance.now(); e.setOrder('ab'); e.updateBuilding(target); const updateMs=performance.now()-t; const failures=[]; for (const r of ['a','b']) { const old=c.before[r], now=c.snap(e[r]); if(old.length!==now.length) failures.push(`${r} node count`); for(let i=0;i<Math.max(old.length,now.length);i++) { const a=old[i],b=now[i]; if(!a||!b||a.node!==b.node||a.geometry!==b.geometry||a.mats.length!==b.mats.length||a.mats.some((m,j)=>m!==b.mats[j])||a.data!==b.data) failures.push(`${r} non-target node ${i}`) } if(JSON.stringify([...e[r].objects.keys()].sort())!==JSON.stringify(c.next.buildings.map(b=>b.id).sort())) failures.push(`${r} ID map`); const o=e[r].objects.get(target.id); if(o.scale.y!==target.height || !o.children.length && !o.isMesh) failures.push(`${r} target update`) } return { target, failures, updateMs } })
    report.result.changed = changed; report.failures.push(...report.result.failures,...changed.failures)
    await page.screenshot({path:join(root,'c3-after.png'),fullPage:true})
  } finally { await browser.close(); server.kill() }
} catch (error) { report.failures.push(error.stack || String(error)) }
report.finished = new Date().toISOString()
await writeFile(join(root,'c3-results.json'), JSON.stringify(report,null,2)+'\n')
process.exitCode = report.failures.length ? 1 : report.pending.length ? 2 : 0
