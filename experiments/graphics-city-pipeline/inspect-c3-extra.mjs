/* global window, structuredClone, process */
import { startC3Server } from './c3-server.mjs'
import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=dirname(fileURLToPath(import.meta.url)), previous=JSON.parse(await readFile(join(root,'c3-results.json'))), temp=previous.temporaryCopy
const report={started:new Date().toISOString(), sourceResults:'c3-results.json', temporaryCopy:temp, failures:[], pending:[]}
const server=await startC3Server(temp)
try {
  const browser=await chromium.launch({headless:true})
  try {
    const page=await browser.newPage({viewport:{width:1400,height:900},deviceScaleFactor:1})
    await page.goto('http://127.0.0.1:5198/',{waitUntil:'networkidle'}); await page.waitForFunction(()=>window.experiment?.a&&window.experiment?.b)
    report.checks=await page.evaluate(async input=>{
      const THREE=await import('/node_modules/three/build/three.module.js'),e=window.experiment,failures=[],pending=[]
      e.setCameraState({position:[28,32,36],target:[0,1,0],zoom:1});e.setCity(input)
      const close=(a,b)=>Math.abs(a-b)<1e-4
      const triangles=o=>{o.updateWorldMatrix(true,true);const out=[];o.traverseVisible(m=>{if(!m.isMesh)return;const g=m.geometry,p=g.attributes.position,idx=g.index,n=idx?idx.count:p.count;for(let i=0;i+2<n;i+=3)out.push([0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,idx?idx.getX(i+k):i+k).applyMatrix4(m.matrixWorld))) });return out}
      const hits=(tris,origin,direction)=>{const ray=new THREE.Ray(new THREE.Vector3(...origin),new THREE.Vector3(...direction)),found=[];for(const t of tris){const p=ray.intersectTriangle(...t,false,new THREE.Vector3());if(p){const d=p.distanceTo(ray.origin);if(!found.some(x=>close(x,d)))found.push(d)}}return found.sort((a,b)=>a-b)}
      let probes=0;for(const b of input.buildings){const a=triangles(e.a.objects.get(b.id)),c=triangles(e.b.objects.get(b.id));for(const level of [0.2,0.5,0.8,0.95])for(const axis of ['x','z']){const origin=axis==='x'?[b.x-b.width,b.y+b.height*level,b.z+b.depth*.13]:[b.x+b.width*.13,b.y+b.height*level,b.z-b.depth],direction=axis==='x'?[1,0,0]:[0,0,1],h1=hits(a,origin,direction),h2=hits(c,origin,direction);probes++;if(h1.length!==h2.length||h1.some((v,i)=>!close(v,h2[i])))failures.push(`${b.id} ${level} ${axis} surface intersections differ`)}}
      const light=v=>v.scene.children.filter(x=>x.isLight).map(x=>({type:x.type,color:x.color.toArray(),groundColor:x.groundColor?.toArray(),intensity:x.intensity,position:x.position.toArray(),visible:x.visible}));const lights={a:light(e.a),b:light(e.b)};if(JSON.stringify(lights.a)!==JSON.stringify(lights.b))failures.push('A/B lighting differs')
      const bridge={};for(const r of ['a','b']){const v=e[r],o=v.scene.getObjectByName('bridge');o.updateWorldMatrix(true,false);const left=[-.5,.5].map(z=>new THREE.Vector3(-.5,.5,z).applyMatrix4(o.matrixWorld).toArray()),right=[-.5,.5].map(z=>new THREE.Vector3(.5,.5,z).applyMatrix4(o.matrixWorld).toArray());const p1=new THREE.Vector3(...left[0]),p2=new THREE.Vector3(...left[1]);if(!close(p1.distanceTo(p2),input.bridge.width))failures.push(`${r} bridge top edge width`);bridge[r]={topFrom:left,topTo:right,width:p1.distanceTo(p2),terrainPlanes:{center:{x:4,y:2,zRange:[-6,6]},east:{x:6,y:4,zRange:[-3,9]}}}}
      pending.push('Full-width deck-to-terrain contact is not established by top edge coordinates; endpoints are centerline positions, and tilted end planes are not flush to vertical terrain faces.')
      const target=structuredClone(input.buildings[0]);target.height+=1.2;target.affiliation='#ee3377';e.updateBuilding(target);const materials={};for(const r of ['a','b']){const rows=[];e[r].objects.get(target.id).traverse(n=>{if(n.isMesh)for(const m of Array.isArray(n.material)?n.material:[n.material])rows.push({color:m.color?.getHexString(),visible:m.visible,type:m.type,roughness:m.roughness})});materials[r]=rows;if(!rows.length||rows.some(m=>m.color!=='ee3377'||!m.visible))failures.push(`${r} target material color/visibility`)}
      return {failures,pending,probes,lights,bridge,target:target.id,materials}
    },previous.result.input)
    report.failures.push(...report.checks.failures); report.pending.push(...report.checks.pending)
    await page.screenshot({path:join(root,'c3-extra-after.png'),fullPage:true})
  } finally {await browser.close()}
} catch(e){report.failures.push(e.stack||String(e))} finally {server.kill()}
report.finished=new Date().toISOString();await writeFile(join(root,'c3-extra-results.json'),JSON.stringify(report,null,2)+'\n');process.exitCode=report.failures.length?1:0
