import { useId, type ReactNode } from 'react'
import type { Id, WorldState } from '../../simulation/contracts/index.ts'
import { titleLabel } from './title-history.ts'
import { shortPersonName } from '../event-summary.ts'
import {
  buildFamilyTreeModel,
  type AffiliationView,
  type LifeState,
  type ParentSlot,
  type PersonNode,
  type TitleView,
  type UnconfirmedNode,
} from './family-tree-model.ts'
import './family-tree.css'

export type FamilyTreeProps = Readonly<{
  /** 選択年の年初 WorldState（歴史枝ごとの実 snapshot）。他の枝の状態は渡さない。 */
  world: WorldState
  personId: Id
  /** 人物ノード選択。snapshot で実在を確認できた人物のみ呼ばれる。 */
  onSelectPerson?: (personId: Id) => void
  /** Title 選択。選択人物が HELD の実在 Title のみ呼ばれる。 */
  onSelectTitle?: (titleId: Id) => void
}>

/** 身元IDを含むCALIBRATION_ONLYの仮名だけ短くする。正式名・WorldStateは一切変更しない。 */
const displayPersonName = (name:string) => name.startsWith('試験用自律児 ')
  ? shortPersonName(name) : name

const lifeText = (l: LifeState): string =>
  l.kind === 'ALIVE' ? '存命' : l.deathYear === undefined ? '死亡（没年は記録なし）' : `死亡（${l.deathYear}年）`

const UNCONFIRMED_TEXT: Record<UnconfirmedNode['reason'], string> = {
  NOT_IN_SNAPSHOT: 'この年の記録に人物として確認できない',
  NOT_BORN_YET: 'この年にはまだ出生していない',
  SELF_REFERENCE: '本人を指しており確認できない',
}

function PersonButton({ node, role, onSelect }: { node: PersonNode; role: string; onSelect?: (id: Id) => void }) {
  const dead = node.life.kind === 'DEAD'
  const inner = (
    <>
      <span className="ft-role">{role}</span>
      <span className="ft-name">{displayPersonName(node.name)}</span>
      <span className="ft-sub">
        {node.birthYear}年生・{lifeText(node.life)}
      </span>
    </>
  )
  const cls = `ft-node${dead ? ' ft-dead' : ''}`
  return onSelect ? (
    <button type="button" className={cls} data-testid={`family-node-${node.personId}`} aria-label={`${role} ${displayPersonName(node.name)} ${node.birthYear}年生・${lifeText(node.life)} を選択`} onClick={() => onSelect(node.personId)}>
      {inner}
    </button>
  ) : (
    <span className={cls} data-testid={`family-node-${node.personId}`}>
      {inner}
    </span>
  )
}

function Slot({ slot, role, onSelect }: { slot: ParentSlot; role: string; onSelect?: (id: Id) => void }) {
  if (slot.kind === 'PERSON') return <PersonButton node={slot} role={role} {...(onSelect ? { onSelect } : {})} />
  if (slot.kind === 'NO_RECORD')
    return (
      <span className="ft-node ft-unknown" data-testid={`family-unknown-${role}`}>
        <span className="ft-role">{role}</span>
        <span className="ft-sub">記録なし（不明）</span>
      </span>
    )
  return (
    <span className="ft-node ft-unknown" data-testid={`family-unconfirmed-${slot.refId}`}>
      <span className="ft-role">{role}</span>
      <span className="ft-sub">未確認（ID: {slot.refId}）</span>
      <span className="ft-sub">{UNCONFIRMED_TEXT[slot.reason]}</span>
    </span>
  )
}

function legalText(a: AffiliationView['legalDynasty']): string {
  if (a.status === 'UNDETERMINED') return '未確定（記録上、法的王朝所属は確定していない）'
  if (a.status === 'DETERMINED') return a.name
  return `確定済みだが王朝名を確認できない（ID: ${a.dynastyId}）`
}

function TitleItem({ t, displayName, onSelect }: { t: TitleView; displayName: string; onSelect?: (id: Id) => void }) {
  const label = `${displayName}${t.valid ? '' : '（無効）'}`
  return (
    <li>
      {onSelect ? (
        <button type="button" className="ft-title" data-testid={`family-title-${t.titleId}`} onClick={() => onSelect(t.titleId)}>
          {label}
        </button>
      ) : (
        <span data-testid={`family-title-${t.titleId}`}>{label}</span>
      )}
    </li>
  )
}

function Group({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <ul className="ft-row" aria-label={label} data-testid={testId}>
      {children}
    </ul>
  )
}

/** 選択人物を中心にした小さな家系・関係表示。App の state に依存せず、props のみで動く。 */
export function FamilyTree({ world, personId, onSelectPerson, onSelectTitle }: FamilyTreeProps) {
  const model = buildFamilyTreeModel(world, personId)
  const headingId = useId()

  if (model.status !== 'OK') {
    return (
      <section className="ft" aria-labelledby={headingId} data-testid="family-tree">
        <h3 id={headingId}>人物の家系・関係（{model.year}年初）</h3>
        <p className="ft-note" data-testid="family-tree-unavailable">
          {model.status === 'PERSON_NOT_FOUND'
            ? `ID ${model.personId} の人物は、この年の記録に確認できません。`
            : `ID ${model.personId} の人物は${model.year}年初には未出生です（${model.birthYear}年生）。関係は表示しません。`}
        </p>
      </section>
    )
  }

  const { self, father, mother, spouses, children, affiliation, titles } = model
  const sel = onSelectPerson
  const summary =
    `${displayPersonName(self.name)}（${model.year}年初、${lifeText(self.life)}）。` +
    `父: ${father.kind === 'PERSON' ? displayPersonName(father.name) : father.kind === 'NO_RECORD' ? '記録なし' : '未確認'}、` +
    `母: ${mother.kind === 'PERSON' ? displayPersonName(mother.name) : mother.kind === 'NO_RECORD' ? '記録なし' : '未確認'}、` +
    `有効な婚姻の配偶者 ${spouses.length}人、確認できる子 ${children.length}人、Title ${titles.length}件。`

  return (
    <section className="ft" aria-labelledby={headingId} data-testid="family-tree">
      <h3 id={headingId}>人物の家系・関係（{model.year}年初）</h3>
      <p className="ft-note">{model.year}年初の記録に確認できる関係のみを表示します。不明な関係は線を引かず、不明と示します。</p>
      <p className="ft-sr" data-testid="family-tree-summary">
        {summary}
      </p>

      <div className="ft-diagram">
        <Group label="親" testId="family-parents">
          <li><Slot slot={father} role="父" {...(sel ? { onSelect: sel } : {})} /></li>
          <li><Slot slot={mother} role="母" {...(sel ? { onSelect: sel } : {})} /></li>
        </Group>
        {(father.kind === 'PERSON' || mother.kind === 'PERSON') && <div className="ft-link" aria-hidden="true" />}
        <Group label="本人と配偶者" testId="family-self-row">
          <li>
            <span className="ft-node ft-self" aria-current="true" data-testid={`family-node-${self.personId}`}>
              <span className="ft-role">選択中</span>
              <span className="ft-name">{displayPersonName(self.name)}</span>
              <span className="ft-sub">
                {self.birthYear}年生・{lifeText(self.life)}
              </span>
            </span>
          </li>
          {spouses.length === 0 ? (
            <li><span className="ft-node ft-unknown" data-testid="family-no-spouse"><span className="ft-role">配偶者</span><span className="ft-sub">この年に有効な婚姻の記録なし（生涯未婚とは限りません）</span></span></li>
          ) : (
            spouses.map((s) => (
              <li key={s.kind === 'PERSON' ? s.personId : s.refId}>
                <Slot slot={s} role="配偶者" {...(sel ? { onSelect: sel } : {})} />
              </li>
            ))
          )}
        </Group>
        {children.length > 0 && <div className="ft-link" aria-hidden="true" />}
        <Group label="子" testId="family-children">
          {children.length === 0 ? (
            <li><span className="ft-node ft-unknown" data-testid="family-no-children"><span className="ft-role">子</span><span className="ft-sub">この年に確認できる子はいない</span></span></li>
          ) : (
            children.map((c) => (
              <li key={c.personId}>
                <Slot slot={c} role="子" {...(sel ? { onSelect: sel } : {})} />
              </li>
            ))
          )}
        </Group>
      </div>

      <dl className="ft-facts" data-testid="family-affiliation">
        <dt>家門</dt>
        <dd data-testid="family-house">
          {affiliation.house.status === 'CONFIRMED' ? affiliation.house.name : `確認できない（ID: ${affiliation.house.houseId}）`}
        </dd>
        <dt>法的王朝</dt>
        <dd data-testid="family-legal-dynasty">{legalText(affiliation.legalDynasty)}</dd>
        {affiliation.bloodlineDynasty && (
          <>
            <dt>血統記録（法的王朝とは別）</dt>
            <dd data-testid="family-bloodline">
              {affiliation.bloodlineDynasty.status === 'CONFIRMED' ? affiliation.bloodlineDynasty.name : `王朝名を確認できない（ID: ${affiliation.bloodlineDynasty.dynastyId}）`}
            </dd>
          </>
        )}
        <dt>記録上のTitle保持</dt>
        <dd>
          {titles.length === 0 ? (
            <span data-testid="family-no-title">この年に保持が確認できるTitleはない</span>
          ) : (
            <ul className="ft-titles" aria-label="記録上のTitle保持" data-testid="family-titles">
              {titles.map((t) => {
                const record=world.titles.find(x=>x.titleId===t.titleId)
                return <TitleItem key={t.titleId} t={t}
                  displayName={record?titleLabel(record,world):t.titleId}
                  {...(onSelectTitle ? { onSelect: onSelectTitle } : {})}/>
              })}
            </ul>
          )}
        </dd>
      </dl>
    </section>
  )
}
