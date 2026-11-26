/* global process, console */
// Compare baseline objects by named hierarchy and occurrence. New P1 objects are
// listed separately; unmatched/changed baseline entries are never treated as PASS.
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), 'snapshots')
const [baseName, currentName] = process.argv.slice(2)
if (![baseName, currentName].every(x => x && /^[\w.-]+$/.test(x) && x !== '.' && x !== '..')) throw new Error('Usage: node compare.mjs BASE_SNAPSHOT CURRENT_SNAPSHOT')
const base = JSON.parse(await readFile(join(root, baseName, 'normal.json'), 'utf8'))
const current = JSON.parse(await readFile(join(root, currentName, 'normal.json'), 'utf8'))
const pathIndex = objects => {
  const paths = new Map(), occurrences = new Map(), result = new Map()
  for (const o of objects) {
    const parent = paths.get(o.parent) || ''
    const label = `${o.type}:${o.name}`
    const key = `${parent}/${label}`
    const count = occurrences.get(key) || 0
    occurrences.set(key, count + 1)
    const path = `${key}[${count}]`
    paths.set(o.uuid, path)
    result.set(path, o)
  }
  return result
}
const select = o => ({ name: o.name, type: o.type, matrixWorld: o.matrixWorld, visible: o.visible, geometry: o.geometry, materials: o.materials, materialFingerprint: o.materialFingerprint, userData: o.userData })
const report = { baseline: baseName, current: currentName, limitation: 'Hierarchy/occurrence matching can be ambiguous for duplicate or unnamed siblings; changes are reported, not judged. FNV attribute hashes can collide. Material records omit textures/shaders; cannot establish complete equality. Runtime numeric IDs/UUIDs are not stable semantic IDs.', views: {} }
for (const v of ['a', 'b']) {
  const before = pathIndex(base.views[v].objects), after = pathIndex(current.views[v].objects)
  const missing = [], changed = [], added = []
  let unchanged = 0
  for (const [path, o] of before) {
    const next = after.get(path)
    if (!next) { missing.push(path); continue }
    const left = select(o), right = select(next)
    const fields = Object.keys(left).filter(k => JSON.stringify(left[k]) !== JSON.stringify(right[k]))
    if (fields.length) changed.push({ path, fields })
    else unchanged++
  }
  for (const path of after.keys()) if (!before.has(path)) added.push(path)
  report.views[v] = { baselineObjects: before.size, currentObjects: after.size, unchanged, missing, changed, added, cameraEqual: JSON.stringify(base.views[v].camera) === JSON.stringify(current.views[v].camera), canvasEqual: JSON.stringify(base.views[v].canvas) === JSON.stringify(current.views[v].canvas), errors: current.pageErrors }
}
const destination = resolve(root, currentName, 'p0-comparison.json')
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify(report, null, 2))
