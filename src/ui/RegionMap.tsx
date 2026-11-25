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

// 狭い机の右欄でも、名称と支配情報を持つノードが重ならない配置。
const DESK_POSITIONS: typeof POSITIONS = {
  'region-margald-home': [17, 27],
  'region-eldia-west': [50, 27],
  'region-eldia-central': [83, 27],
  'region-eldia-east': [83, 74],
  'region-eldia-south': [50, 74],
  'region-versa-coast': [17, 74],
}

function positionOf(id: Id, fallbackIndex: number, desk?: boolean): readonly [number, number] {
  return (desk ? DESK_POSITIONS : POSITIONS)[id] ?? [10 + fallbackIndex * 15, 95]
}

type Props = Readonly<{
  source: InspectionSource
  desk?: boolean
  index: WorldIndex
  selectedRegionId: Id | undefined
  onSelect: (regionId: Id) => void
}>

export function RegionMap({ source, desk, index, selectedRegionId, onSelect }: Props) {
  const regions = source.world.regions
  const pos = new Map(regions.map((r, i) => [r.regionId, positionOf(r.regionId, i, desk)]))
  const edges: Array<readonly [Id, Id]> = []
  for (const r of regions) {
    for (const adj of r.adjacentRegionIds) {
      if (r.regionId < adj && pos.has(adj)) edges.push([r.regionId, adj])
    }
  }

  const eventCounts = new Map<Id, number>()
  if (desk) for (const event of source.events ?? []) {
    if (event.year !== source.world.year) continue
    const ids = new Set(event.involvedRefs.flatMap(ref => ref.kind === 'REGION' ? [ref.id] : []))
    for (const id of ids) eventCounts.set(id, (eventCounts.get(id) ?? 0) + 1)
  }

  const headingId = desk ? 'desk-map-heading' : 'map-heading'
  return (
    <section aria-labelledby={headingId} className="panel">
      <h2 id={headingId}>{desk ? `簡略世界図・${source.world.year}年初` : '地域の簡略概念図'}</h2>
      <p className="note">暫定表現。線は隣接関係、各地域に上位主権と実効支配を表示します。
        {desk && ' 事件件数は、その年内に地域を直接参照した記録です。'}</p>
      <div className={desk ? "map desk-region-map" : "map"} data-testid="region-map" data-year={desk ? source.world.year : undefined}>
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
          const events = eventCounts.get(r.regionId)
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
              {events !== undefined && <span className="desk-map-events" data-testid="desk-map-events">年内事件 {events}件</span>}
            </button>
          )
        })}
      </div>
      {desk && <details>
        <summary>宗主国・属国関係（年初）</summary>
        {source.world.countries.some(country => country.suzerainCountryId !== undefined)
          ? <ul>{source.world.countries.flatMap(country => country.suzerainCountryId === undefined ? [] :
            <li key={country.countryId}>{country.name}の宗主国：{index.countryName(country.suzerainCountryId)}</li>)}</ul>
          : <p className="note">この年初の国家記録に宗主国の設定はありません。</p>}
      </details>}
    </section>
  )
}
