// 比較専用の仮入力。ゲーム状態とは無関係。
export type Kind = 'block' | 'taper' | 'tiered'
export interface Building { id: string; district: string; kind: Kind; x: number; y: number; z: number; width: number; depth: number; height: number; affiliation: string }
export interface District { id: string; x: number; y: number; z: number; width: number; depth: number }
export interface City { districts: District[]; buildings: Building[]; bridge: { from: [number, number, number]; to: [number, number, number]; width: number } }
export const city: City = {
  districts: [
    { id: 'west', x: -10, y: 0, z: 0, width: 8, depth: 12 },
    { id: 'center', x: 0, y: 2, z: 0, width: 8, depth: 12 },
    { id: 'east', x: 10, y: 4, z: 0, width: 8, depth: 12 },
  ],
  buildings: [],
  bridge: { from: [4, 2, 0], to: [6, 4, 0], width: 1.5 },
}
for (const [d, district] of city.districts.entries()) {
  for (let i = 0; i < 10; i++) {
    city.buildings.push({ id: `${district.id}-${i + 1}`, district: district.id, kind: (i + d) % 2 ? 'taper' : 'block', x: district.x + (i % 2 ? 1.8 : -1.8), y: district.y, z: district.z + (Math.floor(i / 2) - 2) * 2.05, width: 1.25, depth: 1.2, height: 1.5 + (i % 3) * 0.55, affiliation: ['#b65749', '#4e7b9b', '#c0964b'][d] })
  }
}
