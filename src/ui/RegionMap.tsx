import type { Id } from '../simulation/contracts/index.ts'
import type { InspectionSource, WorldIndex } from './inspection-source.ts'

// 暫定の簡略配置（%）。地理的な正確さや確定した視覚デザインではない。未知の地域は下段に並べる。
const POSITIONS: Readonly<Record<Id, readonly [number, number]>> = {
  'region-margald-home': [11, 50],
  'region-eldia-west': [32, 50],
  'region-eldia-central': [53, 50],
  'region-eldia-east': [74, 22],
  'region-eldia-south': [74, 78],
  'region-versa-coast': [92, 50],
}

function positionOf(id: Id, fallbackIndex: number): readonly [number, number] {
  return POSITIONS[id] ?? [10 + fallbackIndex * 15, 95]
}

type Props = Readonly<{
  source: InspectionSource
  index: WorldIndex
  selectedRegionId: Id | undefined
  onSelect: (regionId: Id) => void
}>

export function RegionMap({ source, index, selectedRegionId, onSelect }: Props) {
  const regions = source.world.regions
  const pos = new Map(regions.map((r, i) => [r.regionId, positionOf(r.regionId, i)]))
  const edges: Array<readonly [Id, Id]> = []
  for (const r of regions) {
    for (const adj of r.adjacentRegionIds) {
      if (r.regionId < adj && pos.has(adj)) edges.push([r.regionId, adj])
    }
  }

  return (
    <section aria-labelledby="map-heading" className="panel">
      <h2 id="map-heading">地域の簡略概念図</h2>
      <p className="note">暫定表現。線は隣接関係、各地域に上位主権と実効支配を表示します。</p>
      <div className="map" data-testid="region-map">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          {edges.map(([a, b]) => {
            const [x1, y1] = pos.get(a)!
            const [x2, y2] = pos.get(b)!
            return <line key={`${a}|${b}`} x1={x1} y1={y1} x2={x2} y2={y2} vectorEffect="non-scaling-stroke" />
          })}
        </svg>
        {regions.map((r) => {
          const [x, y] = pos.get(r.regionId)!
          const sovereign = index.countryName(r.sovereignCountryId)
          const controller = index.controller(r.deFactoControllerRef)
          const selected = r.regionId === selectedRegionId
          return (
            <button
              key={r.regionId}
              type="button"
              className="region-node"
              style={{ left: `${x}%`, top: `${y}%` }}
              aria-pressed={selected}
              data-testid={`region-node-${r.regionId}`}
              onClick={() => onSelect(r.regionId)}
            >
              <strong>{r.name}</strong>
              <span>主権: {sovereign}</span>
              <span>実効支配: {controller.label}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
