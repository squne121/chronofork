// @vitest-environment jsdom
// 注意: ここでの WorldState は全て「synthetic fixture（架空の型付きテスト入力）」。実シナリオの事実ではない。
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Marriage, Person, Title, WorldState } from '../../../../src/simulation/contracts/index.ts'
import { FamilyTree } from '../../../../src/ui/observation/FamilyTree.tsx'
import { buildFamilyTreeModel } from '../../../../src/ui/observation/family-tree-model.ts'

afterEach(cleanup)

const person = (id: string, over: Partial<Person> = {}): Person => ({
  personId: id,
  name: `名-${id}`,
  sex: 'MALE',
  birthYear: 1200,
  alive: true,
  originGroupId: 'g1',
  houseId: 'h1',
  legalDynasty: { status: 'UNDETERMINED', reasonCodes: [] },
  ...over,
})
const marriage = (id: string, a: string, b: string, over: Partial<Marriage> = {}): Marriage => ({
  marriageId: id,
  personIds: [a, b],
  registeredYear: 1230,
  status: 'ACTIVE',
  ...over,
})
const title = (id: string, holderId: string | undefined, over: Partial<Title> = {}): Title =>
  ({
    titleId: id,
    kind: 'TERRITORIAL',
    regionId: 'r1',
    holder: holderId ? { status: 'HELD', personId: holderId } : { status: 'UNDETERMINED' },
    hereditary: true,
    valid: true,
    grantBasisId: 'gb',
    recognition: { status: 'PENDING' },
    ...over,
  }) as Title

function world(year: number, over: { persons?: Person[]; marriages?: Marriage[]; titles?: Title[] } = {}): WorldState {
  return {
    year,
    countries: [],
    regions: [{ regionId: 'r1', name: '北の地' }],
    groups: [],
    houses: [{ houseId: 'h1', name: '赤の家門' }],
    persons: over.persons ?? [],
    titles: over.titles ?? [],
    legal: { dynasties: [{ dynastyId: 'd1', name: '赤王朝' }], marriages: over.marriages ?? [], cases: [], controlMandates: [], taxMandates: [] },
    resources: [],
    demographics: { cohortSlots: [] },
    deferred: [],
  } as unknown as WorldState
}

const base = () => [
  person('me', { name: '主人公', birthYear: 1220 }),
  person('dad', { name: '父上', birthYear: 1190 }),
  person('mom', { name: '母上', birthYear: 1195, sex: 'FEMALE' }),
  person('wife', { name: '妻', birthYear: 1222, sex: 'FEMALE' }),
  person('kid', { name: '長子', birthYear: 1250, fatherId: 'me', motherId: 'wife' }),
]
const withParents = () => base().map((p) => (p.personId === 'me' ? { ...p, fatherId: 'dad', motherId: 'mom' } : p))

describe('FamilyTree モデル/表示', () => {
  it('親・有効な婚姻の配偶者・子・所属・Titleが snapshot の実データと一致する', () => {
    const w = world(1260, {
      persons: withParents().map((p) => (p.personId === 'me' ? { ...p, legalDynasty: { status: 'DETERMINED', dynastyId: 'd1' } as const } : p)),
      marriages: [marriage('m1', 'me', 'wife')],
      titles: [title('t1', 'me'), title('t2', 'dad')],
    })
    render(<FamilyTree world={w} personId="me" />)
    expect(within(screen.getByTestId('family-parents')).getByTestId('family-node-dad').textContent).toContain('父上')
    expect(within(screen.getByTestId('family-parents')).getByTestId('family-node-mom').textContent).toContain('母上')
    expect(within(screen.getByTestId('family-self-row')).getByTestId('family-node-wife').textContent).toContain('妻')
    expect(within(screen.getByTestId('family-children')).getByTestId('family-node-kid').textContent).toContain('長子')
    expect(screen.getByTestId('family-house').textContent).toContain('赤の家門')
    expect(screen.getByTestId('family-legal-dynasty').textContent).toContain('赤王朝')
    expect(screen.getByTestId('family-title-t1').textContent).toContain('北の地')
    expect(screen.queryByTestId('family-title-t2')).toBeNull()
  })

  it('別年の snapshot へ切り替えると関係が更新される（出生前の子を出さない）', () => {
    const persons = withParents()
    const marriages = [marriage('m1', 'me', 'wife')]
    const { rerender } = render(<FamilyTree world={world(1240, { persons, marriages })} personId="me" />)
    expect(screen.queryByTestId('family-node-kid')).toBeNull()
    expect(screen.getByTestId('family-no-children')).toBeTruthy()
    rerender(<FamilyTree world={world(1255, { persons, marriages })} personId="me" />)
    expect(screen.getByTestId('family-node-kid')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3 }).textContent).toContain('1255年初')
  })

  it('婚姻開始前・終了後は配偶者を現在の関係として出さない', () => {
    const persons = base()
    const dissolved = world(1260, { persons, marriages: [marriage('m1', 'me', 'wife', { status: 'DISSOLVED', dissolvedYear: 1255 })] })
    expect(buildFamilyTreeModel(dissolved, 'me')).toMatchObject({ status: 'OK', spouses: [] })
    const future = world(1225, { persons, marriages: [marriage('m1', 'me', 'wife', { registeredYear: 1230 })] })
    expect(buildFamilyTreeModel(future, 'me')).toMatchObject({ status: 'OK', spouses: [] })
    const staleActive = world(1260, { persons, marriages: [marriage('m1', 'me', 'wife', { dissolvedYear: 1250 })] })
    expect(buildFamilyTreeModel(staleActive, 'me')).toMatchObject({ spouses: [] })
    render(<FamilyTree world={dissolved} personId="me" />)
    expect(screen.getByTestId('family-no-spouse')).toBeTruthy()
    expect(screen.queryByTestId('family-node-wife')).toBeNull()
  })

  it('出生前の選択人物は関係を表示せず、出生前の親/配偶者参照は未確認として扱う', () => {
    const w = world(1215, { persons: base() })
    render(<FamilyTree world={w} personId="me" />)
    expect(screen.getByTestId('family-tree-unavailable').textContent).toContain('未出生')
    expect(screen.queryByTestId('family-parents')).toBeNull()

    const w2 = world(1260, {
      persons: [person('me', { birthYear: 1220, fatherId: 'future' }), person('future', { birthYear: 1300 })],
      marriages: [marriage('m1', 'me', 'future')],
    })
    const m = buildFamilyTreeModel(w2, 'me')
    expect(m).toMatchObject({ status: 'OK', father: { kind: 'UNCONFIRMED', reason: 'NOT_BORN_YET' }, spouses: [{ kind: 'UNCONFIRMED', reason: 'NOT_BORN_YET' }] })
  })

  it('死亡後の人物は消さず死亡状態を表示し、死亡年が無ければ不明と示す', () => {
    const persons = withParents().map((p) =>
      p.personId === 'dad' ? { ...p, alive: false, deathYear: 1250 } : p.personId === 'mom' ? { ...p, alive: false } : p,
    )
    render(<FamilyTree world={world(1260, { persons })} personId="me" />)
    expect(screen.getByTestId('family-node-dad').textContent).toContain('死亡（1250年）')
    expect(screen.getByTestId('family-node-mom').textContent).toContain('没年は記録なし')
    expect(screen.getByTestId('family-node-me').textContent).toContain('存命')
  })

  it('法的王朝が未確定なら未確定と表示し、血統・家門から確定させない', () => {
    const persons = base().map((p) => (p.personId === 'me' ? { ...p, bloodlineDynastyId: 'd1' } : p))
    render(<FamilyTree world={world(1260, { persons })} personId="me" />)
    expect(screen.getByTestId('family-legal-dynasty').textContent).toContain('未確定')
    expect(screen.getByTestId('family-legal-dynasty').textContent).not.toContain('赤王朝')
    expect(screen.getByTestId('family-bloodline').textContent).toContain('赤王朝')
    expect(screen.getByTestId('family-affiliation').textContent).toContain('血統記録（法的王朝とは別）')
    expect(screen.getByTestId('family-house').textContent).toContain('赤の家門')
  })

  it('Titleを持たない人物や継承未確定のTitleに架空の保持を出さない', () => {
    const w = world(1260, { persons: base(), titles: [title('t9', undefined), title('t1', 'dad')] })
    render(<FamilyTree world={w} personId="me" />)
    expect(screen.getByTestId('family-no-title')).toBeTruthy()
    expect(screen.queryByTestId('family-titles')).toBeNull()
  })

  it('別の歴史枝の人物・婚姻・Titleを混入させない', () => {
    const a0 = world(1260, { persons: base(), marriages: [marriage('m1', 'me', 'wife')], titles: [title('t1', 'me')] })
    const a1 = world(1260, {
      persons: base().filter((p) => p.personId !== 'wife' && p.personId !== 'kid').concat(person('other', { name: '分岐の妻' })),
      marriages: [marriage('m2', 'me', 'other')],
      titles: [],
    })
    const { rerender } = render(<FamilyTree world={a0} personId="me" />)
    expect(screen.queryByText(/分岐の妻/)).toBeNull()
    rerender(<FamilyTree world={a1} personId="me" />)
    expect(screen.getByTestId('family-node-other')).toBeTruthy()
    expect(screen.queryByTestId('family-node-wife')).toBeNull()
    expect(screen.queryByTestId('family-node-kid')).toBeNull()
    expect(screen.queryByTestId('family-title-t1')).toBeNull()
  })

  it('参照が欠落してもクラッシュせず未確認として扱う', () => {
    const w = world(1260, {
      persons: [person('me', { fatherId: 'ghost', motherId: 'me', houseId: 'nohouse', legalDynasty: { status: 'DETERMINED', dynastyId: 'dX' } })],
      marriages: [marriage('m1', 'me', 'ghost2')],
      titles: [title('t1', 'me', { regionId: 'rX' })],
    })
    render(<FamilyTree world={w} personId="me" />)
    expect(screen.getByTestId('family-unconfirmed-ghost').textContent).toContain('未確認')
    expect(screen.getByTestId('family-unconfirmed-ghost2')).toBeTruthy()
    expect(screen.getByTestId('family-unconfirmed-me')).toBeTruthy()
    expect(screen.getByTestId('family-house').textContent).toContain('確認できない')
    expect(screen.getByTestId('family-legal-dynasty').textContent).toContain('王朝名を確認できない')
    expect(screen.getByTestId('family-title-t1').textContent).toContain('地域ID: rX')
  })

  it('存在しない人物IDでもクラッシュしない', () => {
    render(<FamilyTree world={world(1260, { persons: base() })} personId="nobody" />)
    expect(screen.getByTestId('family-tree-unavailable').textContent).toContain('確認できません')
  })

  it('人物・Titleの選択で正しいIDをcallbackに渡す。未確認ノードや選択中ノードは操作対象にならない', () => {
    const onPerson = vi.fn()
    const onTitle = vi.fn()
    const w = world(1260, {
      persons: withParents().map((p) => (p.personId === 'me' ? { ...p, motherId: 'ghost' } : p)),
      marriages: [marriage('m1', 'me', 'wife')],
      titles: [title('t1', 'me')],
    })
    render(<FamilyTree world={w} personId="me" onSelectPerson={onPerson} onSelectTitle={onTitle} />)
    fireEvent.click(screen.getByRole('button', { name: /父.*父上.*選択/ }))
    fireEvent.click(screen.getByTestId('family-node-wife'))
    fireEvent.click(screen.getByTestId('family-node-kid'))
    fireEvent.click(screen.getByTestId('family-title-t1'))
    expect(onPerson.mock.calls.map((c) => c[0])).toEqual(['dad', 'wife', 'kid'])
    expect(onTitle).toHaveBeenCalledWith('t1')
    expect(screen.queryByTestId('family-node-me')?.tagName).toBe('SPAN')
    expect(screen.getByTestId('family-unconfirmed-ghost').tagName).toBe('SPAN')
    expect(screen.getAllByRole('button')).toHaveLength(4)
  })

  it('callback未指定ならボタンを出さず、スクリーンリーダー向け要約を持つ', () => {
    render(<FamilyTree world={world(1260, { persons: withParents(), titles: [title('t1', 'me')] })} personId="me" />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByTestId('family-tree-summary').textContent).toContain('父: 父上、母: 母上')
    expect(screen.getByRole('list', { name: '親' })).toBeTruthy()
  })

  it('同一人物を2つ並べてもheading idが重複しない（A0/A1並置）', () => {
    const w = world(1260, { persons: base() })
    const { container } = render(
      <>
        <FamilyTree world={w} personId="me" />
        <FamilyTree world={w} personId="me" />
      </>,
    )
    const ids = [...container.querySelectorAll('h3')].map((h) => h.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('確認できる親・子がないとき接続線を描かない', () => {
    const { container } = render(<FamilyTree world={world(1260, { persons: [person('me')] })} personId="me" />)
    expect(container.querySelectorAll('.ft-link')).toHaveLength(0)
  })

  it('子は出生年→ID順、同一相手への二重ACTIVE婚姻は重複せず、死亡した配偶者も状態付きで表示する', () => {
    const persons = [
      person('me'),
      person('wife', { alive: false, deathYear: 1259 }),
      person('c2', { birthYear: 1240, fatherId: 'me' }),
      person('c1', { birthYear: 1240, fatherId: 'me' }),
      person('c0', { birthYear: 1235, motherId: 'me' }),
    ]
    const w = world(1260, { persons, marriages: [marriage('m1', 'me', 'wife'), marriage('m2', 'me', 'wife')] })
    const m = buildFamilyTreeModel(w, 'me')
    expect(m.status === 'OK' && m.children.map((c) => c.personId)).toEqual(['c0', 'c1', 'c2'])
    expect(m.status === 'OK' && m.spouses).toHaveLength(1)
    render(<FamilyTree world={w} personId="me" />)
    expect(screen.getByTestId('family-node-wife').textContent).toContain('死亡（1259年）')
  })

  it('内部marriageIdを含む自律児の仮名を家系図・読み上げから隠し、人物IDは選択に保持する', () => {
    const rawName='試験用自律児 1269 (marriage:normal:[\\"key\\",\\"person-exp-02\\"])'
    const child=person('child-synthetic',{name:rawName,birthYear:1269,fatherId:'me'})
    const onPerson=vi.fn()
    render(<FamilyTree world={world(1270,{persons:[...base(),child]})}
      personId="me" onSelectPerson={onPerson}/>)
    const node=screen.getByTestId('family-node-child-synthetic')
    expect(node.textContent).toContain('試験用自律児 1269')
    expect(node.textContent).not.toContain('marriage:normal')
    expect(node.getAttribute('aria-label')).not.toContain('marriage:normal')
    expect(screen.getByTestId('family-tree-summary').textContent).not.toContain('marriage:normal')
    fireEvent.click(node)
    expect(onPerson).toHaveBeenCalledWith('child-synthetic')
  })
  it('入力snapshotを変更しない', () => {
    const w = world(1260, { persons: withParents(), marriages: [marriage('m1', 'me', 'wife')] })
    const before = JSON.stringify(w)
    buildFamilyTreeModel(w, 'me')
    expect(JSON.stringify(w)).toBe(before)
  })
})
