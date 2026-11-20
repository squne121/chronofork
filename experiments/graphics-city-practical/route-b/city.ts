// Route B: Three.js geometry generated directly from the shared experimental input.
// All positions are world coordinates, Y up. No external mesh assets are used.
type Vec3 = [number, number, number]
type City = {
  id: string
  terrain: { lowY: number; highY: number; cliffZ: number }
  fortress: { id: string; center: Vec3; size: Vec3; gate: Vec3 }
  bridge: { id: string; start: Vec3; end: Vec3; width: number }
  districts: { id: string; center: Vec3; size: [number, number]; groundY: number }[]
  buildings: { id: string; position: Vec3; size: Vec3; type: string }[]
}

// The renderer supplies the same Three.js instance to both routes.
export async function createCity({ THREE, city }: { THREE: typeof import('three'); city: City }) {
  const root = new THREE.Group()
  root.name = city.id
  const material = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 1 })
  const terrainMat = material('#8e8b7b')
  const wallMat = material('#b4ac9c')
  const bridgeMat = material('#a09a8c')
  const districtMat = material('#aaa390')
  const cliffMat = material('#7d7c70')
  const pathMat = material('#989381')
  const broadMat = material('#c0b29c')
  const tallMat = material('#aba99e')
  const roofMat = material('#827d73')
  const box = (parent: import('three').Object3D, size: Vec3, position: Vec3, mat: import('three').Material, name?: string) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat)
    mesh.position.set(...position)
    if (name) mesh.name = name
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const group = (parent: import('three').Object3D, name: string) => {
    const result = new THREE.Group()
    result.name = name
    parent.add(result)
    return result
  }

  // Flat plain and high plateau with a narrow approach cut for the bridge.
  const { lowY, highY, cliffZ } = city.terrain
  const terrain = group(root, 'terrain')
  box(terrain, [48, 3, 42], [0, lowY - 1.5, -1], terrainMat)
  const cutHalf = city.bridge.width / 2 + 0.3
  const platformHeight = highY - lowY
  for (const sign of [-1, 1]) {
    const width = 24 - cutHalf
    box(terrain, [width, platformHeight, 20 - cliffZ],
      [sign * (cutHalf + width / 2), lowY + platformHeight / 2, (20 + cliffZ) / 2], terrainMat)
  }
  const endZ = city.bridge.end[2]
  box(terrain, [cutHalf * 2, platformHeight, 20 - endZ],
    [0, lowY + platformHeight / 2, (20 + endZ) / 2], terrainMat)
  // The cut's inclined floor remains just below the bridge and meets the gate.
  const floorAtCliff = city.bridge.start[1] + (city.bridge.end[1] - city.bridge.start[1]) *
    (cliffZ - city.bridge.start[2]) / (endZ - city.bridge.start[2]) - 0.4
  const section: [number, number][] = [[cliffZ, lowY], [cliffZ, floorAtCliff], [endZ, highY], [endZ, lowY]]
  const vertices: number[] = []
  const triangles: number[] = []
  for (const x of [-cutHalf, cutHalf]) for (const [z, y] of section) vertices.push(x, y, z)
  const n = section.length
  for (let i = 1; i < n - 1; i++) triangles.push(0, i, i + 1, n, n + i + 1, n + i)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    triangles.push(i, n + i, n + j, i, n + j, j)
  }
  const cutGeometry = new THREE.BufferGeometry()
  cutGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  cutGeometry.setIndex(triangles)
  cutGeometry.computeVertexNormals()
  const cutMat = terrainMat.clone()
  cutMat.side = THREE.DoubleSide
  const cut = new THREE.Mesh(cutGeometry, cutMat)
  cut.receiveShadow = true
  terrain.add(cut)
  // Faceted rock spurs break up the cliff face without obstructing the bridge.
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const x = sign * (cutHalf + 2.5 + i * 5.5)
      const height = platformHeight * (0.62 + (i % 3) * 0.12)
      const rock = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 1, 1, 5, 1), cliffMat)
      rock.position.set(x, lowY + height / 2, cliffZ - 0.45)
      rock.scale.set(3.4, height, 1.65)
      rock.rotation.y = 0.2 * (i + 1)
      rock.receiveShadow = true
      rock.castShadow = true
      terrain.add(rock)
    }
  }

  for (const d of city.districts) {
    const district = group(root, d.id)
    box(district, [d.size[0], 0.1, d.size[1]], [d.center[0], d.groundY + 0.05, d.center[2]], districtMat)
    // A cross street makes each settlement read as a connected district.
    box(district, [d.size[0] - 0.4, 0.035, 0.7], [d.center[0], d.groundY + 0.12, d.center[2]], pathMat)
    box(district, [0.7, 0.035, d.size[1] - 0.4], [d.center[0], d.groundY + 0.12, d.center[2]], pathMat)
    if (d.id === 'district-high') {
      // Follow the cliff-facing district edge without moving existing buildings.
      const walkway = group(district, 'district-high-cliff-walk')
      const edge = d.center[2] - d.size[1] / 2
      const points = [[-0.08, 0.23], [0.05, 0.43], [0.18, 0.23], [0.31, 0.43], [0.44, 0.23]]
        .map(([x, z]) => [d.center[0] + x * d.size[0], edge + z])
      for (let i = 1; i < points.length; i++) {
        const [x0, z0] = points[i - 1], [x1, z1] = points[i]
        const dx = x1 - x0, dz = z1 - z0
        const segment = box(walkway, [Math.hypot(dx, dz) + 0.12, 0.08, 0.34],
          [(x0 + x1) / 2, d.groundY + 0.14, (z0 + z1) / 2], pathMat)
        segment.rotation.y = -Math.atan2(dz, dx)
      }
    }
  }
  for (const b of city.buildings) {
    const building = group(root, b.id)
    const [x, y, z] = b.position
    const [w, h, d] = b.size
    const mat = b.type === 'broad' ? broadMat : tallMat
    box(building, [w, h, d], [x, y + h / 2, z], mat)
    if (b.type === 'broad') {
      // A low hipped roof gives broad buildings a distinct silhouette.
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4), roofMat)
      roof.rotation.y = Math.PI / 4
      roof.scale.set(w * 0.75, 0.8, d * 0.75)
      roof.position.set(x, y + h + 0.4, z)
      building.add(roof)
    } else {
      box(building, [w * 0.72, 0.8, d * 0.72], [x, y + h + 0.4, z], mat)
      box(building, [w * 0.84, 0.22, d * 0.84], [x, y + h + 0.91, z], roofMat)
    }
  }

  const f = city.fortress
  const fort = group(root, f.id)
  const [fx, fy, fz] = f.center
  const [fw, fh, fd] = f.size
  const wallThickness = 1
  const gateWidth = 4
  const front = f.gate[2]
  const sideLength = (fw - gateWidth) / 2
  for (const sign of [-1, 1]) {
    box(fort, [sideLength, fh * 0.58, wallThickness], [fx + sign * (gateWidth / 2 + sideLength / 2), fy + fh * 0.29, front], wallMat)
    box(fort, [wallThickness, fh * 0.58, fd], [fx + sign * fw / 2, fy + fh * 0.29, fz], wallMat)
    for (const z of [front, fz + fd / 2]) {
      const tower = box(fort, [2.3, fh, 2.3], [fx + sign * fw / 2, fy + fh / 2, z], wallMat)
      tower.name = `tower-${sign}-${z === front ? 'front' : 'rear'}`
      box(fort, [2.6, 0.35, 2.6], [fx + sign * fw / 2, fy + fh + 0.175, z], roofMat)
    }
  }
  box(fort, [fw, fh * 0.58, wallThickness], [fx, fy + fh * 0.29, fz + fd / 2], wallMat)
  // Lintel leaves an open passage, connecting the bridge with the courtyard.
  box(fort, [gateWidth, 1, 1.3], [fx, fy + 3, front], wallMat)
  box(fort, [5, 4, 4], [fx, fy + 2, fz + 2], wallMat, 'keep')
  box(fort, [5.4, 0.3, 4.4], [fx, fy + 4.15, fz + 2], roofMat)
  // Low polygonal bastions project from both sides of the gate; the middle
  // passage and the pre-existing walls, towers and bridge remain untouched.
  for (const sign of [-1, 1]) {
    const shape = new THREE.Shape()
    const outline = [[2.15, 0.35], [2.15, -1], [3.25, -2.1], [5.4, -2.1], [7, -0.9], [7, 0.35]]
    outline.forEach(([x, z], i) => {
      if (i === 0) shape.moveTo(sign * x, -z)
      else shape.lineTo(sign * x, -z)
    })
    shape.closePath()
    const bastion = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 1.5, bevelEnabled: false }), wallMat)
    bastion.name = sign < 0 ? 'fortress-bastion-west' : 'fortress-bastion-east'
    bastion.rotation.x = -Math.PI / 2
    bastion.position.set(f.gate[0], fy, front)
    bastion.castShadow = true
    bastion.receiveShadow = true
    fort.add(bastion)
  }

  const b = city.bridge
  const bridge = group(root, b.id)
  const [sx, sy, sz] = b.start
  const [ex, ey, ez] = b.end
  const dx = ex - sx, dy = ey - sy, dz = ez - sz
  const horizontal = Math.hypot(dx, dz)
  const length = Math.hypot(horizontal, dy)
  const angle = Math.atan2(dy, horizontal)
  const yaw = Math.atan2(dx, dz)
  const slope = group(bridge, 'deck-and-rails')
  slope.position.set((sx + ex) / 2, (sy + ey) / 2, (sz + ez) / 2)
  slope.rotation.y = yaw
  slope.rotation.x = -angle
  box(slope, [b.width, 0.35, length], [0, -0.175, 0], bridgeMat, 'deck')
  for (const sign of [-1, 1]) {
    box(slope, [0.22, 0.65, length], [sign * (b.width / 2 - 0.11), 0.325, 0], bridgeMat)
  }
  // Supports descend to the low plain; their tops meet the sloping deck.
  for (const t of [0.3, 0.6]) {
    const x = sx + dx * t, z = sz + dz * t, y = sy + dy * t
    if (y > lowY) box(bridge, [b.width * 0.65, y - lowY, 0.8], [x, (y + lowY) / 2, z], bridgeMat)
  }
  return root
}
