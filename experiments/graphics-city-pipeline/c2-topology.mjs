// Triangle coordinates are in world space. Weld duplicated face vertices before checking edges.
export function inspectTopology(triangles, expectedVolume, epsilon = 1e-5) {
  const vertices = [], edges = new Map()
  let volume = 0
  const weld = point => {
    let index = vertices.findIndex(vertex => vertex.every((value, i) => Math.abs(value - point[i]) <= epsilon))
    if (index < 0) { index = vertices.length; vertices.push(point) }
    return index
  }
  for (const triangle of triangles) {
    const [a, b, c] = triangle
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
    const ids = triangle.map(weld)
    for (let i = 0; i < 3; i++) {
      const from = ids[i], to = ids[(i + 1) % 3], key = `${Math.min(from, to)},${Math.max(from, to)}`
      const edge = edges.get(key) ?? { count: 0, direction: 0 }
      edge.count++
      edge.direction += from < to ? 1 : -1
      edges.set(key, edge)
    }
  }
  const badEdges = [...edges.values()].filter(edge => edge.count !== 2 || edge.direction !== 0).length
  const volumeOk = Math.abs(volume - expectedVolume) <= Math.max(epsilon, Math.abs(expectedVolume) * 1e-4)
  return { triangles: triangles.length, vertices: vertices.length, badEdges, volume, expectedVolume, volumeOk, ok: triangles.length > 0 && badEdges === 0 && volumeOk }
}
