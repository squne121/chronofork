// P0 route interface: export async function createCity({ THREE, city }) returning
// a THREE.Group after all route assets are loaded. Both routes consume city.js;
// an offline-generated GLB must reject a mismatched input rather than show stale
// geometry. Positions are world-space [x,y,z], Y-up. Building positions are
// ground contacts; dimensions are full extents. Landmark and building groups
// carry their stable input IDs as names; the terrain group is named 'terrain'.
// Terrain bounds: X -24..24, Z -22..20, low at Z<0 and high at Z>=0.
// The bridge endpoints meet the low approach and the fortress gate. Route-owned
// geometry implements the cliff, bridge, terrain and district details.
// Neutral reference colors: terrain 0x8e8b7b, fortress 0xb4ac9c,
// bridge 0xa09a8c, district 0xaaa390, broad 0xc0b29c, tall 0xaba99e.
export const routeIds = Object.freeze(['a', 'b']);
