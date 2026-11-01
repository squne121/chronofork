import { useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { Id, Person, PopulationGroup, Region, Title } from '../simulation/contracts/index.ts'
import {
  RECOGNITION_LABEL,
  TITLE_KIND_LABEL,
  bpsToPercent,
  missingLabel,
} from './inspection-source.ts'
import type { EntityKind, InspectionSource, Link, Selection, WorldIndex } from './inspection-source.ts'

export const TABS: ReadonlyArray<Readonly<{ kind: EntityKind; label: string }>> = [
  { kind: 'region', label: '地域' },
  { kind: 'group', label: '人口集団' },
  { kind: 'person', label: '人物' },
  { kind: 'title', label: '称号' },
]

type Props = Readonly<{
  source: InspectionSource
  index: WorldIndex
  tab: EntityKind
  selection: Selection | undefined
  onTab: (kind: EntityKind) => void
  onSelect: (selection: Selection) => void
}>

function listItems(source: InspectionSource, index: WorldIndex, kind: EntityKind) {
  const w = source.world
  switch (kind) {
    case 'region':
      return w.regions.map((r) => ({ id: r.regionId, label: r.name }))
    case 'group':
      return w.groups.map((g) => ({ id: g.groupId, label: g.name }))
    case 'person':
      return w.persons.map((p) => ({ id: p.personId, label: p.name }))
    case 'title':
      return w.titles.map((t) => ({ id: t.titleId, label: index.link('title', t.titleId).label }))
  }
}

export function Inspector({ source, index, tab, selection, onTab, onSelect }: Props) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const items = listItems(source, index, tab)
  const selectedId = selection?.kind === tab ? selection.id : undefined

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next: number
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    else return
    e.preventDefault()
    onTab(TABS[next].kind)
    tabRefs.current[next]?.focus()
  }

  return (
    <section aria-labelledby="inspector-heading" className="panel">
      <h2 id="inspector-heading">選択年の状態（閲覧のみ）</h2>
      <div role="tablist" aria-label="閲覧対象" className="tabs">
        {TABS.map((t, i) => (
          <button
            key={t.kind}
            ref={(el) => {
              tabRefs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`tab-${t.kind}`}
            aria-selected={tab === t.kind}
            aria-controls="inspector-panel"
            tabIndex={tab === t.kind ? 0 : -1}
            onClick={() => onTab(t.kind)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="inspector-panel" aria-labelledby={`tab-${tab}`}>
        <ul className="entity-list" aria-label={`${TABS.find((t) => t.kind === tab)?.label}一覧`}>
          {items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                aria-pressed={it.id === selectedId}
                data-testid={`item-${tab}-${it.id}`}
                onClick={() => onSelect({ kind: tab, id: it.id })}
              >
                {it.label}
              </button>
            </li>
          ))}
        </ul>
        <div data-testid="detail" className="detail" aria-live="polite">
          {selection ? (
            <Detail selection={selection} source={source} index={index} onSelect={onSelect} />
          ) : (
            <p className="note">地域・集団・人物・称号を選ぶと詳細を表示します。</p>
          )}
        </div>
      </div>
    </section>
  )
}

type DetailProps = Readonly<{
  selection: Selection
  source: InspectionSource
  index: WorldIndex
  onSelect: (selection: Selection) => void
}>

function LinkView({ link, onSelect }: { link: Link; onSelect: (s: Selection) => void }) {
  if (!link.resolved) return <span className="missing">{link.label}</span>
  if (link.kind === 'country' || link.kind === 'house') return <span>{link.label}</span>
  const kind = link.kind
  return (
    <button type="button" className="link" onClick={() => onSelect({ kind, id: link.id })}>
      {link.label}
    </button>
  )
}

function LinkList({ links, onSelect }: { links: readonly Link[]; onSelect: (s: Selection) => void }) {
  if (links.length === 0) return <span>なし</span>
  return (
    <ul className="inline-list">
      {links.map((l) => (
        <li key={`${l.kind}:${l.id}`}>
          <LinkView link={l} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

function Detail({ selection, source, index, onSelect }: DetailProps) {
  switch (selection.kind) {
    case 'region': {
      const r = index.region(selection.id)
      return r ? <RegionDetail r={r} source={source} index={index} onSelect={onSelect} /> : <Missing id={selection.id} />
    }
    case 'group': {
      const g = index.group(selection.id)
      return g ? <GroupDetail g={g} index={index} onSelect={onSelect} /> : <Missing id={selection.id} />
    }
    case 'person': {
      const p = index.person(selection.id)
      return p ? <PersonDetail p={p} source={source} index={index} onSelect={onSelect} /> : <Missing id={selection.id} />
    }
    case 'title': {
      const t = index.title(selection.id)
      return t ? <TitleDetail t={t} index={index} onSelect={onSelect} /> : <Missing id={selection.id} />
    }
  }
}

function Missing({ id }: { id: Id }) {
  return <p className="missing">{missingLabel(id)}</p>
}

type Ctx = Readonly<{ source: InspectionSource; index: WorldIndex; onSelect: (s: Selection) => void }>

function RegionDetail({ r, source, index, onSelect }: Ctx & { r: Region }) {
  const w = source.world
  const groups = w.groups.filter((g) => g.regionId === r.regionId)
  const titles = w.titles.filter((t) => t.regionId === r.regionId)
  const controlMandates = w.legal.controlMandates.filter((m) => m.regionId === r.regionId)
  const taxMandates = w.legal.taxMandates.filter((m) => m.regionId === r.regionId)
  const total = groups.reduce((sum, g) => sum + g.population, 0)
  return (
    <>
      <h3>{r.name}</h3>
      <dl>
        <Row label="上位主権">{index.countryName(r.sovereignCountryId)}</Row>
        <Row label="実効支配">{index.controller(r.deFactoControllerRef).label}</Row>
        <Row label="隣接地域">
          <LinkList links={r.adjacentRegionIds.map((id) => index.link('region', id))} onSelect={onSelect} />
        </Row>
        <Row label="人口集団">
          <LinkList links={groups.map((g) => index.link('group', g.groupId))} onSelect={onSelect} />
        </Row>
        <Row label="人口（集団の合計）">{total.toLocaleString('ja-JP')}</Row>
        <Row label="称号">
          <LinkList links={titles.map((t) => index.link('title', t.titleId))} onSelect={onSelect} />
        </Row>
        <Row label="統治委任">
          {controlMandates.length === 0 ? 'なし' : controlMandates.map((m) => m.mandateId).join('、')}
        </Row>
        <Row label="徴税権">
          {taxMandates.length === 0
            ? 'なし'
            : taxMandates.map((m) => `${index.countryName(m.collectorCountryId)}（${m.effectiveFromYear}年〜）`).join('、')}
        </Row>
      </dl>
    </>
  )
}

function GroupDetail({ g, index, onSelect }: Omit<Ctx, 'source'> & { g: PopulationGroup }) {
  const rows = Object.entries(g.support.houseBps)
  return (
    <>
      <h3>{g.name}</h3>
      <dl>
        <Row label="地域">
          <LinkView link={index.link('region', g.regionId)} onSelect={onSelect} />
        </Row>
        <Row label="人口">{g.population.toLocaleString('ja-JP')}</Row>
        <Row label="繁栄度">{g.prosperity} / 100</Row>
        <Row label="不満">{g.unrest} / 100</Row>
      </dl>
      <h4>家門支持</h4>
      <table>
        <thead>
          <tr>
            <th scope="col">家門</th>
            <th scope="col">支持</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([houseId, bps]) => (
            <tr key={houseId}>
              <th scope="row">{index.houseName(houseId)}</th>
              <td>{bpsToPercent(bps)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">未定</th>
            <td>{bpsToPercent(g.support.undecidedBps)}</td>
          </tr>
        </tbody>
      </table>
    </>
  )
}

function PersonDetail({ p, source, index, onSelect }: Ctx & { p: Person }) {
  const held = source.world.titles.filter((t) => t.holder.status === 'HELD' && t.holder.personId === p.personId)
  const ruled = source.world.countries.filter((c) => c.rulerPersonId === p.personId)
  const dynastyName = (id: Id) => source.world.legal.dynasties.find((d) => d.dynastyId === id)?.name ?? missingLabel(id)
  const ld = p.legalDynasty
  const dynasty =
    ld.status === 'DETERMINED' ? dynastyName(ld.dynastyId) : `未確定（${ld.reasonCodes.join('、') || '理由コードなし'}）`
  const bloodline = p.bloodlineDynastyId ? dynastyName(p.bloodlineDynastyId) : '記録なし'
  return (
    <>
      <h3>{p.name}</h3>
      <dl>
        <Row label="性別">{p.sex === 'MALE' ? '男性' : '女性'}</Row>
        <Row label="生年">{p.birthYear}年</Row>
        <Row label="生死">{p.alive ? '存命' : `死亡${p.deathYear !== undefined ? `（${p.deathYear}年）` : ''}`}</Row>
        <Row label="家門">{index.houseName(p.houseId)}</Row>
        <Row label="法的王朝">{dynasty}</Row>
        <Row label="血統王朝">{bloodline}</Row>
        <Row label="父">
          {p.fatherId ? <LinkView link={index.link('person', p.fatherId)} onSelect={onSelect} /> : '記録なし'}
        </Row>
        <Row label="母">
          {p.motherId ? <LinkView link={index.link('person', p.motherId)} onSelect={onSelect} /> : '記録なし'}
        </Row>
        <Row label="出身集団">
          <LinkView link={index.link('group', p.originGroupId)} onSelect={onSelect} />
        </Row>
        <Row label="保有称号">
          <LinkList links={held.map((t) => index.link('title', t.titleId))} onSelect={onSelect} />
        </Row>
        <Row label="統治する国">{ruled.length === 0 ? 'なし' : ruled.map((c) => c.name).join('、')}</Row>
      </dl>
    </>
  )
}

function TitleDetail({ t, index, onSelect }: Omit<Ctx, 'source'> & { t: Title }) {
  const rec = t.recognition
  return (
    <>
      <h3>{index.link('title', t.titleId).label}</h3>
      <dl>
        <Row label="種別">{TITLE_KIND_LABEL[t.kind]}</Row>
        <Row label="地域">
          <LinkView link={index.link('region', t.regionId)} onSelect={onSelect} />
        </Row>
        <Row label="保有者">
          {t.holder.status === 'HELD' ? (
            <LinkView link={index.link('person', t.holder.personId)} onSelect={onSelect} />
          ) : (
            '継承未確定（PENDING）'
          )}
        </Row>
        <Row label="世襲">{t.hereditary ? '世襲' : '非世襲'}</Row>
        <Row label="有効">{t.valid ? '有効' : '無効'}</Row>
        <Row label="承認状態">{RECOGNITION_LABEL[rec.status]}</Row>
        <Row label="承認の権限者">{rec.authority ? index.controller(rec.authority).label : '記録なし'}</Row>
        <Row label="承認対象の主権">{rec.sovereignCountryId ? index.countryName(rec.sovereignCountryId) : '記録なし'}</Row>
      </dl>
    </>
  )
}
