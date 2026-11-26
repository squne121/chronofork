// Run separately: node --test test-c2-topology.mjs
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { inspectTopology } from './c2-topology.mjs'

// Outward-oriented unit cube with face-local duplicated vertices after serialization.
const p = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]
const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]]
const cube = faces.map(face => face.map(index => [...p[index]]))
test('closed outward cube passes', () => assert.equal(inspectTopology(cube, 1).ok, true))
test('missing triangle fails', () => assert.equal(inspectTopology(cube.slice(1), 1).ok, false))
test('one reversed triangle fails directed edges', () => {
  const triangles = cube.map(triangle => [...triangle])
  triangles[0] = [...triangles[0]].reverse()
  assert.ok(inspectTopology(triangles, 1).badEdges > 0)
})
test('globally reversed winding fails signed volume', () => {
  const result = inspectTopology(cube.map(triangle => [...triangle].reverse()), 1)
  assert.equal(result.badEdges, 0)
  assert.equal(result.volumeOk, false)
})
