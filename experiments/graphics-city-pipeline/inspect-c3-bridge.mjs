/* global window, process */
import { startC3Server } from './c3-server.mjs'
import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=dirname(fileURLToPath(import.meta.url)), previous=JSON.parse(await readFile(join(root,'c3-results.json'))), temp=previous.temporaryCopy
const server=await startC3Server(temp)
const result={started:new Date().toISOString(),source:'c3-results.json',failures:[],pending:[]}
try {
 const browser=await chromium.launch({headless:true});try {
  const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto('http://127.0.0.1:5198/',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.experiment?.a&&window.experiment?.b)
  result.measurements=await page.evaluate(async city=>{
   const THREE=await import('/node_modules/three/build/three.module.js'), {OBB}=await import('/node_modules/three/examples/jsm/math/OBB.js'),e=window.experiment; e.setCity(city);e.setCameraState({position:[28,32,36],target:[0,1,0],zoom:1})
   const rows={};for(const route of ['a','b']){const scene=e[route].scene;scene.updateMatrixWorld(true);const bridge=scene.getObjectByName('bridge');const obb=o=>{o.geometry.computeBoundingBox();return new OBB().fromBox3(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)};const box=obb(bridge),endpoint=[];for(const [i,name] of ['center','east'].entries()){const ground=scene.getObjectByName('terrain:'+name),gb=obb(ground),inputPoint=new THREE.Vector3(...(i?city.bridge.to:city.bridge.from));const centerTop=new THREE.Vector3(i?.5:-.5,.5,0).applyMatrix4(bridge.matrixWorld);const centerBottom=new THREE.Vector3(i?.5:-.5,-.5,0).applyMatrix4(bridge.matrixWorld);const corners=[];for(const y of [-.5,.5])for(const z of [-.5,.5])corners.push(new THREE.Vector3(i?.5:-.5,y,z).applyMatrix4(bridge.matrixWorld).toArray());endpoint.push({terrain:name,intersects:box.intersectsOBB(gb),centerline:inputPoint.toArray(),topCenter:centerTop.toArray(),bottomCenter:centerBottom.toArray(),terrainTop:city.districts.find(d=>d.id===name).y,topCenterOffset:centerTop.y-city.districts.find(d=>d.id===name).y,endFaceCorners:corners,terrainWorldBounds:new THREE.Box3().setFromObject(ground).toArray?.()??[new THREE.Box3().setFromObject(ground).min.toArray(),new THREE.Box3().setFromObject(ground).max.toArray()]})}rows[route]=endpoint}return rows
  },previous.result.input)
  for(const [r,ends] of Object.entries(result.measurements))for(const end of ends)if(!end.intersects)result.failures.push(`${r}: bridge does not intersect ${end.terrain} terrain`)
  result.pending.push('OBB overlap is volume collision of loaded box meshes, not a quantified walkable contact area or a proof of seamless top-surface connection. Centerline uses the input and deck thickness produces step offsets.')
  await page.screenshot({path:join(root,'c3-bridge-contact.png'),fullPage:true})
 }finally{await browser.close()}
}catch(e){result.failures.push(e.stack||String(e))}finally{server.kill()}
result.finished=new Date().toISOString();await writeFile(join(root,'c3-bridge-results.json'),JSON.stringify(result,null,2)+'\n');process.exitCode=result.failures.length?1:0
