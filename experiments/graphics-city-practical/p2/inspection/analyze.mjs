/* global console */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const output = join(dirname(fileURLToPath(import.meta.url)), 'output')
const input = JSON.parse(await readFile(join(output, 'normal.json'), 'utf8'))
const report = { source: 'normal.json', capturedAt: input.capturedAt, limitation: 'World-axis bounding-box distance is only a broad-phase candidate, not a surface contact, clearance, walkability or visual-quality test. Missing IDs or unsupported geometry are PENDING. Inspect screenshots manually.', views: {} }
for (const [key, view] of Object.entries(input.views)) {
  const objects = view.objects
  const byUuid = new Map(objects.map(o => [o.uuid, o]))
  const lineage = o => {
    const names = []
    const visited = new Set()
    while (o && !visited.has(o.uuid)) { visited.add(o.uuid); names.push(o.name || ''); o = byUuid.get(o.parent) }
    return names.join('/')
  }
  const groups = Object.fromEntries(Object.entries({ fortress: /fortress/i, bridge: /bridge/i, terrain: /terrain|ground|cliff/i }).map(([name, pattern]) => [name, objects.filter(o => o.geometry?.worldBounds && pattern.test(lineage(o)))]))
  const distance = (a, b) => Math.hypot(...a.min.map((n, i) => Math.max(0, n - b.max[i], b.min[i] - a.max[i])))
  const pairs = {}
  for (const [left, right] of [['bridge', 'fortress'], ['bridge', 'terrain'], ['fortress', 'terrain']]) {
    const candidates = []
    for (const a of groups[left]) for (const b of groups[right]) {
      if (a.uuid !== b.uuid) candidates.push({ left: { name: a.name, uuid: a.uuid, bounds: a.geometry.worldBounds }, right: { name: b.name, uuid: b.uuid, bounds: b.geometry.worldBounds }, aabbDistance: distance(a.geometry.worldBounds, b.geometry.worldBounds) })
    }
    candidates.sort ( (a, b) => a.aabbDistance - b.aabbDistance )
    pairs[`${left}-${right}`] = { status: candidates.length ? 'CANDIDATES_ONLY' : 'PENDING', closest: candidates.slice(0, 5) }
  }
  const expectedIds = [input.city?.fortress?.id, input.city?.bridge?.id, ...(input.city?.districts || []).map(d => d.id), ...(input.city?.buildings || []).map(b => b.id)].filter(Boolean)
  report.views[key] = { expectedIds: expectedIds.map(id => ({ id, matchingNames: objects.filter(o => o.name === id).length })), geometryByRole: Object.fromEntries(Object.entries(groups).map(([name, list]) => [name, list.length])), unsupportedBounds: objects.filter(o => o.geometry?.boundsLimitation).map(o => ({ name: o.name, uuid: o.uuid, reason: o.geometry.boundsLimitation })), pairs }
}
await writeFile(join(output, 'analysis.json'), JSON.stringify(report, null, 2))
console.log('Wrote inspection/output/analysis.json; candidate distances are not a pass/fail verdict.')
