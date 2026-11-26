/* global window, structuredClone, process, URL */
import { startC3Server } from './c3-server.mjs'
import { chromium } from '@playwright/test'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
const root = dirname(fileURLToPath(import.meta.url)), prior = JSON.parse(await readFile(join(root, 'c3-results.json'))), temp = prior.temporaryCopy
const report = { started: new Date().toISOString(), temporaryCopy: temp, processes: [], failures: [], pending: [] }
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex')
const assets = ['block.glb', 'taper.glb', 'tiered.glb', 'parts.blend']
try {
  report.originalBefore = Object.fromEntries(await Promise.all(assets.map(async name => [name, await hash(join(root, 'public/a', name))])))
  report.sourceHashes = Object.fromEntries(await Promise.all(['src/main.ts','src/route-a.ts','src/route-b.ts','src/input.ts','route-a/generate.py'].map(async name => [name, {original:await hash(join(root,name)), temporary:await hash(join(temp,name))}])))
  for (const [name, values] of Object.entries(report.sourceHashes)) if (values.original !== values.temporary) report.failures.push(`source hash mismatch: ${name}`)
  report.originalAfter = Object.fromEntries(await Promise.all(assets.map(async name => [name, await hash(join(root, 'public/a', name))])))
  report.regenerated = Object.fromEntries(await Promise.all(assets.map(async name => [name, await hash(join(temp, 'public/a', name))])))
  report.bDist = Object.fromEntries(await Promise.all((await readdir(join(temp, 'node_modules/.cache/city-dist/assets'))).map(async name => [name, await hash(join(temp, 'node_modules/.cache/city-dist/assets', name))])))
  if (JSON.stringify(report.originalBefore) !== JSON.stringify(report.originalAfter)) report.failures.push('original assets changed')
  const server = await startC3Server(temp)
  const browser = await chromium.launch({ headless: true }).catch(error => { server.kill(); throw error })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 })
    page.on('pageerror', error => report.failures.push(String(error)))
    const responses = []
    page.on('response', response => { const url = new URL(response.url()); if (url.pathname.startsWith('/a/') || ['/src/main.ts','/src/route-a.ts','/src/route-b.ts','/src/input.ts'].includes(url.pathname)) responses.push(response) })
    await page.goto('http://127.0.0.1:5198/', { waitUntil: 'networkidle' }); await page.waitForFunction(() => window.experiment?.a && window.experiment?.b)
    report.served = {}
    for (const response of responses) { const path = new URL(response.url()).pathname, body = await response.body(); report.served[path] = {status:response.status(), sha256:createHash('sha256').update(body).digest('hex'), bytes:body.length} }
    for (const name of ['block.glb','taper.glb','tiered.glb']) if (report.served[`/a/${name}`]?.sha256 !== report.regenerated[name]) report.failures.push(`served asset mismatch: ${name}`)
    for (const name of ['main.ts','route-a.ts','route-b.ts','input.ts']) if (!report.served[`/src/${name}`]) report.failures.push(`served source missing: ${name}`)
    report.result = await page.evaluate(async () => {
      const THREE = await import('/node_modules/three/build/three.module.js'), e = window.experiment, original = structuredClone(e.city), next = structuredClone(original)
      for (const d of next.districts) d.z += ({ west: -2, center: 0, east: 3 })[d.id]
      for (const b of next.buildings) { b.z += ({ west: -2, center: 0, east: 3 })[b.district]; if (b.id.endsWith('-1')) b.x += 0.6 }
      next.bridge.to[2] += 3
      next.buildings.find(b => b.id === 'center-1').kind = 'tiered'
      const camera = { position: [28,32,36], target: [0,1,0], zoom: 1 }; e.setCameraState(camera)
      const t = performance.now(); e.setOrder('ba'); e.setCity(next); const setCityMs = performance.now()-t
      const fail = [], check = (ok, msg) => { if (!ok) fail.push(msg) }, near = (a,b) => Math.abs(a-b)<1e-4
      const target = next.buildings[0], measurements = {}
      const snap = view => { view.scene.updateMatrixWorld(true); const rows = []; function visit(n, owner) { if (next.buildings.some(b=>b.id===n.name)) owner=n.name; if(owner!==target.id) { const mats=n.material ? (Array.isArray(n.material)?n.material:[n.material]):[]; rows.push({ node:n, geometry:n.geometry, mats, data:JSON.stringify({name:n.name, kind:n.userData.kind, matrix:n.matrixWorld.toArray(), geometry:n.geometry && { attributes:Object.fromEntries(Object.entries(n.geometry.attributes).map(([k,a])=>[k,Array.from(a.array)])), index:n.geometry.index && Array.from(n.geometry.index.array), groups:n.geometry.groups, drawRange:n.geometry.drawRange }, materials:mats.map(m=>m.toJSON())}) }) } n.children.forEach(c=>visit(c,owner)) } visit(view.scene,null); return rows }
      for (const r of ['a','b']) { const v=e[r]; v.scene.updateMatrixWorld(true); const boxes={}; for(const b of next.buildings) { const o=v.objects.get(b.id); check(!!o && o.name===b.id, `${r} ID ${b.id}`); if(!o) continue; const box=new THREE.Box3().setFromObject(o); boxes[b.id]=[box.min.toArray(),box.max.toArray()]; check(near(box.min.x,b.x-b.width/2)&&near(box.max.x,b.x+b.width/2)&&near(box.min.y,b.y)&&near(box.max.y,b.y+b.height)&&near(box.min.z,b.z-b.depth/2)&&near(box.max.z,b.z+b.depth/2),`${r} bounds ${b.id}`) } const bridge=v.scene.getObjectByName('bridge'); bridge.updateWorldMatrix(true,false); const ends=[new THREE.Vector3(-.5,0,0).applyMatrix4(bridge.matrixWorld).toArray(),new THREE.Vector3(.5,0,0).applyMatrix4(bridge.matrixWorld).toArray()]; check(ends.every((p,i)=>p.every((x,j)=>near(x,[next.bridge.from,next.bridge.to][i][j]))),`${r} bridge endpoints`); measurements[r]={boxes,ends,camera:v.getCameraState()} }
      check(JSON.stringify(measurements.a.camera)===JSON.stringify(measurements.b.camera),'camera differs'); check(JSON.stringify(next)!==JSON.stringify(original),'input unchanged'); check(next.bridge.from[2]!==next.bridge.to[2],'bridge has no Z difference')
      for (const r of ['a','b']) for (const b of next.buildings) { const o=e[r].objects.get(b.id), materials=[]; o.traverse(n=>{if(n.isMesh) materials.push(...(Array.isArray(n.material)?n.material:[n.material]))}); check(materials.length>0 && materials.every(m=>m.visible && m.color?.equals(new THREE.Color(b.affiliation))), `${r}/${b.id} input material color`); check(o.userData.kind===b.kind, `${r}/${b.id} kind`) }
      window.__c3 = { next, target:target.id, before:{a:snap(e.a),b:snap(e.b)}, snap, measurements, fail, original, setCityMs }
      return {input:next, original, target:target.id, measurements, failures:fail, setCityMs}
    })
    await page.screenshot({ path: join(root,'c3-final-alternate.png'), fullPage:true })
    const changed = await page.evaluate(async () => { const THREE=await import('/node_modules/three/build/three.module.js'), e=window.experiment, c=window.__c3, target=structuredClone(c.next.buildings[0]); const targetBefore={}; for(const r of ['a','b']) {const o=e[r].objects.get(target.id), meshes=[]; o.traverse(n=>{if(n.isMesh)meshes.push({node:n,geometry:n.geometry,material:n.material,geometryData:JSON.stringify(n.geometry.toJSON())})}); targetBefore[r]={object:o,position:o.position.toArray(),quaternion:o.quaternion.toArray(),scale:o.scale.toArray(),kind:o.userData.kind,meshes}} target.height += 1.2; target.affiliation='#ee3377'; const t=performance.now(); e.setOrder('ab'); e.updateBuilding(target); const updateMs=performance.now()-t; const failures=[]; for (const r of ['a','b']) { const old=c.before[r], now=c.snap(e[r]); if(old.length!==now.length) failures.push(`${r} node count`); for(let i=0;i<Math.max(old.length,now.length);i++) { const a=old[i],b=now[i]; if(!a||!b||a.node!==b.node||a.geometry!==b.geometry||a.mats.length!==b.mats.length||a.mats.some((m,j)=>m!==b.mats[j])||a.data!==b.data) failures.push(`${r} non-target node ${i}`) } if(JSON.stringify([...e[r].objects.keys()].sort())!==JSON.stringify(c.next.buildings.map(b=>b.id).sort())) failures.push(`${r} ID map`); const o=e[r].objects.get(target.id),before=targetBefore[r],meshes=[];o.traverse(n=>{if(n.isMesh)meshes.push(n)}); if(o!==before.object||o.name!==target.id||o.userData.kind!==before.kind||JSON.stringify(o.position.toArray())!==JSON.stringify(before.position)||JSON.stringify(o.quaternion.toArray())!==JSON.stringify(before.quaternion)||o.scale.x!==before.scale[0]||o.scale.z!==before.scale[2]||o.scale.y!==target.height||meshes.length!==before.meshes.length)failures.push(`${r} target identity/transform`); for(let i=0;i<meshes.length;i++){const n=meshes[i],b=before.meshes[i],mats=Array.isArray(n.material)?n.material:[n.material];if(!b||n!==b.node||n.geometry!==b.geometry||JSON.stringify(n.geometry.toJSON())!==b.geometryData||n.material!==b.material||mats.some(m=>!m.visible||!m.color?.equals(new THREE.Color(target.affiliation)))) failures.push(`${r} target geometry/material`)} } return { target, failures, updateMs } })
    report.result.changed = changed; report.failures.push(...report.result.failures,...changed.failures)
    await page.screenshot({path:join(root,'c3-final-after.png'),fullPage:true})
  } finally { await browser.close(); server.kill() }
} catch (error) { report.failures.push(error.stack || String(error)) }
report.finished = new Date().toISOString()
await writeFile(join(root,'c3-final-results.json'), JSON.stringify(report,null,2)+'\n')
process.exitCode = report.failures.length ? 1 : report.pending.length ? 2 : 0
