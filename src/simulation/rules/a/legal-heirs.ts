// G-03/04 を使う土地相続候補の純粋な順位照合（CALIBRATION_ONLY）。
// 明示された親子関係・生死・法的王朝所属だけを使用し、婚外の合法性や権限を補完しない。
import type { Id, JsonValue, Person, WorldState } from '../../contracts/index.ts'

export type HeirReview =
  | Readonly<{ status: 'READY'; personId: Id; rankedCandidateIds: readonly Id[]; relation: 'DESCENDANT' | 'COLLATERAL' }>
  | Readonly<{ status: 'PENDING'; reasonCodes: readonly string[]; rankedCandidateIds: readonly Id[] }>

const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const childrenOf = (persons: readonly Person[], parentId: Id): Person[] =>
  persons.filter(p => p.fatherId === parentId || p.motherId === parentId)
    .sort((a, b) => (a.sex === b.sex ? 0 : a.sex === 'MALE' ? -1 : 1) ||
      a.birthYear - b.birthYear || cmp(a.personId, b.personId))

/** 年長枝を先に辿る。死亡した上位枝は代襲を評価し、年齢等の未承認適格性を推測しない。 */
export function reviewLandHeir(world: WorldState, predecessorId: Id): HeirReview {
  const byId = new Map(world.persons.map(p => [p.personId, p]))
  const predecessor = byId.get(predecessorId)
  if (!predecessor || predecessor.alive) {
    return { status: 'PENDING', reasonCodes: ['PREDECESSOR_NOT_DECEASED'], rankedCandidateIds: [] }
  }
  const ranked: Id[] = []
  const seen = new Set<Id>()
  let unresolved: string | null = null
  const fromBranch = (id: Id): Person | undefined => {
    if (seen.has(id)) { unresolved = 'KINSHIP_CYCLE'; return undefined }
    seen.add(id)
    const p = byId.get(id)
    if (!p) { unresolved = 'PERSON_NOT_FOUND'; return undefined }
    ranked.push(p.personId)
    if (p.alive) {
      if (p.legalDynasty.status !== 'DETERMINED') { unresolved = 'LEGAL_DYNASTY_UNDETERMINED'; return undefined }
      return p
    }
    return visitChildren(p.personId)
  }
  const visitChildren = (parent: Id): Person | undefined => {
    const kids = childrenOf(world.persons, parent)
    for (let i = 1; i < kids.length; i++) {
      if (kids[i]!.sex === kids[i-1]!.sex && kids[i]!.birthYear === kids[i-1]!.birthYear) {
        unresolved = 'SAME_PRIORITY_BIRTH_YEAR'
        return undefined
      }
    }
    for (const child of kids) {
      const heir = fromBranch(child.personId)
      if (unresolved || heir) return heir
    }
    return undefined
  }
  const descendant = visitChildren(predecessorId)
  if (unresolved) return { status: 'PENDING', reasonCodes: [unresolved], rankedCandidateIds: ranked }
  if (descendant) return { status: 'READY', personId: descendant.personId, rankedCandidateIds: ranked, relation: 'DESCENDANT' }
  // 近い祖先の明示された同胞枝に限って傍系を探す。祖先情報不足なら勝手に補完しない。
  const parentIds = [predecessor.fatherId, predecessor.motherId].filter((id): id is Id => !!id)
  if (parentIds.length === 0) return { status: 'PENDING', reasonCodes: ['COLLATERAL_PARENTAGE_UNDETERMINED'], rankedCandidateIds: ranked }
  const siblings = [...new Map(parentIds.flatMap(id => childrenOf(world.persons, id))
    .filter(p => p.personId !== predecessorId).map(p => [p.personId, p])).values()]
    .sort((a, b) => (a.sex === b.sex ? 0 : a.sex === 'MALE' ? -1 : 1) ||
      a.birthYear - b.birthYear || cmp(a.personId, b.personId))
  for (let i = 1; i < siblings.length; i++) {
    if (siblings[i]!.sex === siblings[i-1]!.sex && siblings[i]!.birthYear === siblings[i-1]!.birthYear) {
      return { status: 'PENDING', reasonCodes: ['SAME_PRIORITY_BIRTH_YEAR'], rankedCandidateIds: ranked }
    }
  }
  for (const s of siblings) {
    const heir = fromBranch(s.personId)
    if (unresolved) return { status: 'PENDING', reasonCodes: [unresolved], rankedCandidateIds: ranked }
    if (heir) return { status: 'READY', personId: heir.personId, rankedCandidateIds: ranked, relation: 'COLLATERAL' }
  }
  return { status: 'PENDING', reasonCodes: ['NO_ESTABLISHED_HEIR'], rankedCandidateIds: ranked }
}

// DEC-189 / MVP§8.5: 直系・同胞枝で確立しない場合だけ、記録済みの近い共通祖先へ段階的に遡る。
// 旧reviewLandHeirは既存構成の再現性のため変更しない。選択は評価器構成の明示オプトイン。
export const ANCESTRAL_HEIR_SEARCH_VERSION = 'dec189-recorded-common-ancestor-7:CALIBRATION_ONLY'
export type HeirSearchMode = 'SIBLING_BRANCH' | 'RECORDED_COMMON_ANCESTOR'
export const HEIR_SEARCH_MODES: readonly HeirSearchMode[] = ['SIBLING_BRANCH', 'RECORDED_COMMON_ANCESTOR']

/** 探索の段階。0=直系子孫、1=父母（同胞枝）、2=祖父母、3=曾祖父母…。 */
export type HeirSearchStep = Readonly<{
  depth: number
  commonAncestorIds: readonly Id[]
  branchHeadIds: readonly Id[]
}>
export type HeirSearchDetail = Readonly<{
  version: typeof ANCESTRAL_HEIR_SEARCH_VERSION
  /** 結論を出した段階。候補不在で探索し尽くした場合はnull。 */
  decisiveDepth: number | null
  steps: readonly HeirSearchStep[]
  /** 順位順に審査した人物と結果（死亡枝は代襲として子孫へ進む）。 */
  reviewed: readonly Readonly<{
    personId: Id; depth: number; parentIds: readonly Id[]
    outcome: 'SELECTED' | 'DECEASED_REPRESENTATION' | 'LEGAL_DYNASTY_UNDETERMINED' | 'KINSHIP_CYCLE'
  }>[]
  /** 候補にしない人物。祖先自身と複数経路の再出現を区別する（前保持者本人は記録しない）。 */
  excluded: readonly Readonly<{ personId: Id; depth: number; reason: 'ANCESTOR_OF_PREDECESSOR' | 'DUPLICATE_PATH' }>[]
  /** 同順位で保留した枝。親（死亡枝本人または段階の共通祖先）、順位順の枝頭、競合した人物を残す。 */
  samePriority: readonly Readonly<{
    depth: number; parentIds: readonly Id[]; branchHeadIds: readonly Id[]; tiedPersonIds: readonly Id[]
    candidateIds?: readonly Id[]
  }>[]
  /** 同順位で個別審査した代襲枝。空枝・収束・競合を問わず、枝内の根拠を全体順位と分けて残す。 */
  representationGroups: readonly Readonly<{
    depth: number
    parentIds: readonly Id[]
    branches: readonly IndependentBranchReview[]
  }>[]
  /** 異なる祖先の枝を別々に調べた根拠。枝内READYは全体の後継確定ではない。 */
  independentStages: readonly Readonly<{
    depth: number
    branches: readonly IndependentBranchReview[]
    possibleTopBranchIds: readonly Id[]
  }>[]
}>
export type AncestralHeirReview = HeirReview & Readonly<{ search: HeirSearchDetail }>
type IndependentBranchReview = Readonly<{
  branchHeadId: Id
  parentIds: readonly Id[]
  candidateId: Id | null
  reasonCode: string | null
  rankedCandidateIds: readonly Id[]
  reviewed: HeirSearchDetail['reviewed']
  excluded: HeirSearchDetail['excluded']
  samePriority: HeirSearchDetail['samePriority']
}>

const compareRank = (a: Person, b: Person) => (a.sex === b.sex ? 0 : a.sex === 'MALE' ? -1 : 1) || a.birthYear - b.birthYear
const byPriority = (a: Person, b: Person) => compareRank(a, b) || cmp(a.personId, b.personId)
const tiedWithPrevious = (sorted: readonly Person[], i: number) =>
  i > 0 && i < sorted.length && compareRank(sorted[i]!, sorted[i-1]!) === 0

/**
 * 直系・同胞枝では従来順位を維持。祖父母以上では共通の親が記録された枝頭の間だけ
 * 男子優先・年長の順位を比較する。比較不能な独立枝は別々に審査し、候補が競合すれば保留。
 * 同順位・上位候補の資格未確定・記録欠落・循環も保留。
 */
export function reviewAncestralHeir(world: WorldState, predecessorId: Id): AncestralHeirReview {
  const byId = new Map(world.persons.map(p => [p.personId, p]))
  const kids = new Map<Id, Person[]>()
  for (const p of world.persons) {
    for (const parent of new Set([p.fatherId, p.motherId].filter((id): id is Id => !!id))) {
      const list = kids.get(parent) ?? []
      list.push(p)
      kids.set(parent, list)
    }
  }
  const childrenOfId = (id: Id) => [...(kids.get(id) ?? [])].sort(byPriority)
  const steps: HeirSearchStep[] = []
  const reviewed: HeirSearchDetail['reviewed'][number][] = []
  const excluded: { personId: Id; depth: number; reason: HeirSearchDetail['excluded'][number]['reason'] }[] = []
  const samePriority: HeirSearchDetail['samePriority'][number][] = []
  const independentStages: HeirSearchDetail['independentStages'][number][] = []
  const representationGroups: HeirSearchDetail['representationGroups'][number][] = []
  const ranked: Id[] = []
  const done = (r: HeirReview, decisiveDepth: number | null): AncestralHeirReview => ({
    ...r, search: { version: ANCESTRAL_HEIR_SEARCH_VERSION, decisiveDepth, steps, reviewed, excluded, samePriority, representationGroups, independentStages },
  })
  const pending = (code: string, depth: number | null, extra: readonly string[] = []) =>
    done({ status: 'PENDING', reasonCodes: [code, ...extra], rankedCandidateIds: ranked }, depth)
  const predecessor = byId.get(predecessorId)
  if (!predecessor || predecessor.alive) return pending('PREDECESSOR_NOT_DECEASED', null)

  // 祖先の最短段階を保持する。同じ祖先への合流は系譜の循環ではない。
  const ancestorDepth = new Map<Id, number>()
  const ancestorStages: Id[][] = []
  let firstMissingDepth = Infinity
  let frontier: Id[] = [predecessorId]
  for (let depth = 1; frontier.length > 0; depth++) {
    const next: Id[] = []
    for (const id of frontier) {
      const p = byId.get(id)
      if (!p) { firstMissingDepth = Math.min(firstMissingDepth, depth - 1); continue }
      for (const parent of [p.fatherId, p.motherId]) {
        if (parent === predecessorId) return pending('KINSHIP_CYCLE', null)
        if (!parent || ancestorDepth.has(parent)) continue
        ancestorDepth.set(parent, depth)
        next.push(parent)
      }
    }
    if (next.length > 0) ancestorStages.push(next.sort(cmp))
    frontier = next
  }

  // 審査に使う人物自身が循環の一部かを調べる。未使用の遠い祖先の矛盾で近い枝を落とさない。
  const cycleByPerson = new Map<Id, boolean>([[predecessorId, false]])
  const inCycle = (start: Id): boolean => {
    const cached = cycleByPerson.get(start)
    if (cached !== undefined) return cached
    const seen = new Set<Id>([start])
    const queue = [start]
    for (let i = 0; i < queue.length; i++) {
      const p = byId.get(queue[i]!)
      if (!p) continue
      for (const parent of [p.fatherId, p.motherId]) {
        if (parent === start) { cycleByPerson.set(start, true); return true }
        if (!parent || seen.has(parent) || cycleByPerson.get(parent) === false) continue
        seen.add(parent)
        queue.push(parent)
      }
    }
    cycleByPerson.set(start, false)
    return false
  }

  const visited = new Set<Id>([predecessorId])
  const linksTo = (p: Person, parentIds: readonly Id[]) => parentIds.filter(id => p.fatherId === id || p.motherId === id)
  let unresolved: string | null = null
  // 未探索の子を順位順に並べ、除外理由を記録する。同順位は旧規則どおり一意に定まらないとして保留。
  const availableHeads = (candidates: readonly Person[], depth: number): Person[] => {
    const open: Person[] = []
    for (const p of [...new Map(candidates.map(c => [c.personId, c])).values()].sort(byPriority)) {
      if (p.personId === predecessorId) continue
      const reason = ancestorDepth.has(p.personId) ? 'ANCESTOR_OF_PREDECESSOR' as const
        : visited.has(p.personId) ? 'DUPLICATE_PATH' as const : null
      if (reason) { excluded.push({ personId: p.personId, depth, reason }); continue }
      open.push(p)
    }
    return open
  }
  const rejectTies = (open: readonly Person[], depth: number, parentIds: readonly Id[]): boolean => {
    const tied = open.filter((_p, i) => tiedWithPrevious(open, i) || tiedWithPrevious(open, i + 1))
    if (tied.length > 0) {
      samePriority.push({ depth, parentIds: [...parentIds], branchHeadIds: open.map(p => p.personId), tiedPersonIds: tied.map(p => p.personId) })
      unresolved = 'SAME_PRIORITY_BIRTH_YEAR'
      return true
    }
    return false
  }
  const checkpoint = () => ({ ranked: ranked.length, reviewed: reviewed.length, excluded: excluded.length, samePriority: samePriority.length })
  const isolate = (from: ReturnType<typeof checkpoint>, head: Person, parentIds: readonly Id[], heir: Person | undefined): IndependentBranchReview => {
    const evidence = {
      branchHeadId: head.personId, parentIds: linksTo(head, parentIds), candidateId: heir?.personId ?? null,
      reasonCode: unresolved, rankedCandidateIds: ranked.slice(from.ranked), reviewed: reviewed.slice(from.reviewed),
      excluded: excluded.slice(from.excluded), samePriority: samePriority.slice(from.samePriority),
    }
    for (const id of evidence.rankedCandidateIds) visited.delete(id)
    ranked.length = from.ranked; reviewed.length = from.reviewed; excluded.length = from.excluded
    samePriority.length = from.samePriority; unresolved = null
    return evidence
  }
  const retain = (evidence: IndependentBranchReview) => {
    for (const id of evidence.rankedCandidateIds) if (!visited.has(id)) { visited.add(id); ranked.push(id) }
    for (const entry of evidence.reviewed) reviewed.push(entry)
    for (const entry of evidence.excluded) excluded.push(entry)
    for (const entry of evidence.samePriority) samePriority.push(entry)
  }
  type BranchRequest = { open: readonly Person[]; parentIds: readonly Id[] }
  function* traverse({ open, parentIds }: BranchRequest, depth: number): Generator<BranchRequest, Person | undefined, Person | undefined> {
    // 明示スタックで代襲を辿る。同順位枝の独立審査も反復ドライバに渡す。
    const stack = [{ open, parentIds, next: 0 }]
    while (stack.length > 0) {
      const frame = stack.at(-1)!
      const p = frame.open[frame.next++]
      if (!p) { stack.pop(); continue }
      const personId = p.personId
      // 上位候補の重複は先の経路で審査済み。順位の低い経路で再評価しない。
      if (visited.has(personId)) { excluded.push({ personId, depth, reason: 'DUPLICATE_PATH' }); continue }
      if (depth > 1 && tiedWithPrevious(frame.open, frame.next)) {
        const group = [p]
        while (tiedWithPrevious(frame.open, frame.next)) {
          const next = frame.open[frame.next++]!
          if (!visited.has(next.personId)) group.push(next)
        }
        const attempts = []
        for (const head of group) {
          const from = checkpoint()
          const heir = yield { open: [head], parentIds: frame.parentIds }
          attempts.push({ heir, evidence: isolate(from, head, frame.parentIds, heir) })
        }
        representationGroups.push({ depth, parentIds: frame.parentIds, branches: attempts.map(a => a.evidence) })
        const contenders = attempts.filter(a => a.heir || a.evidence.reasonCode)
        const first = contenders[0]
        if (!first) {
          for (const a of attempts) retain(a.evidence)
          continue
        }
        if (contenders.length === 1) {
          retain(first.evidence)
          unresolved = first.evidence.reasonCode
          return first.heir
        }
        const heir = first.heir
        if (heir && contenders.every(a => a.heir?.personId === heir.personId)) {
          const parents = contenders.flatMap(a => a.evidence.reviewed.filter(r => r.personId === heir.personId).flatMap(r => r.parentIds))
          visited.add(heir.personId); ranked.push(heir.personId)
          reviewed.push({ personId: heir.personId, depth, parentIds: [...new Set(parents)].sort(cmp), outcome: 'SELECTED' })
          return heir
        }
        const ids = contenders.map(a => a.evidence.branchHeadId)
        const candidateIds = [...new Set(contenders.flatMap(a => a.heir ? [a.heir.personId] : [
          ...a.evidence.reviewed.filter(r => r.outcome === 'LEGAL_DYNASTY_UNDETERMINED').map(r => r.personId),
          ...a.evidence.samePriority.flatMap(tie => tie.candidateIds ?? []),
        ]))].sort(cmp)
        samePriority.push({ depth, parentIds: frame.parentIds, branchHeadIds: ids, tiedPersonIds: ids, candidateIds })
        unresolved = 'SAME_PRIORITY_BIRTH_YEAR'
        return undefined
      }
      visited.add(personId)
      ranked.push(personId)
      const entry = { personId, depth, parentIds: linksTo(p, frame.parentIds) }
      if (inCycle(personId)) {
        reviewed.push({ ...entry, outcome: 'KINSHIP_CYCLE' })
        unresolved = 'KINSHIP_CYCLE'
        return undefined
      }
      if (p.alive) {
        if (p.legalDynasty.status !== 'DETERMINED') {
          reviewed.push({ ...entry, outcome: 'LEGAL_DYNASTY_UNDETERMINED' })
          unresolved = 'LEGAL_DYNASTY_UNDETERMINED'
          return undefined
        }
        reviewed.push({ ...entry, outcome: 'SELECTED' })
        return p
      }
      reviewed.push({ ...entry, outcome: 'DECEASED_REPRESENTATION' })
      const children = availableHeads(childrenOfId(personId), depth)
      if (depth <= 1 && rejectTies(children, depth, [personId])) return undefined
      if (children.length > 0) stack.push({ open: children, parentIds: [personId], next: 0 })
    }
    return undefined
  }

  const orderedBranches = (open: readonly Person[], depth: number, parentIds: readonly Id[]): Person | undefined => {
    const tasks = [traverse({ open, parentIds }, depth)]
    let heir: Person | undefined
    while (tasks.length > 0) {
      const result = tasks.at(-1)!.next(heir)
      if (result.done) { heir = result.value; tasks.pop() }
      else { tasks.push(traverse(result.value, depth)); heir = undefined }
    }
    return heir
  }

  const branches = (candidates: readonly Person[], depth: number, parentIds: readonly Id[]): Person | undefined => {
    const open = availableHeads(candidates, depth)
    return rejectTies(open, depth, parentIds) ? undefined : orderedBranches(open, depth, parentIds)
  }

  // 祖父母以上では、別々の祖先の子を単に性別・生年で合算しない。
  const distantBranches = (candidates: readonly Person[], depth: number, parentIds: readonly Id[]): Person | undefined => {
    const open = availableHeads(candidates, depth)
    if (open.length === 0) return undefined
    const parentsOf = (p: Person) => linksTo(p, parentIds)
    const sharedParents = (heads: readonly Person[]) => parentsOf(heads[0]!).filter(id => heads.every(p => p.fatherId === id || p.motherId === id))
    // すべての枝の親集合が同じ場合だけ、単一の順位列で審査できる。
    const common = sharedParents(open)
    if (open.every(head => parentsOf(head).length === common.length) && !open.some((_head, i) => tiedWithPrevious(open, i))) {
      return orderedBranches(open, depth, parentIds)
    }
    // 別の枝の訪問履歴で候補を消さない。枝ごとに今回追加した訪問だけを巻き戻す。
    const attempts = open.map(head => {
      const from = checkpoint()
      const heir = orderedBranches([head], depth, parentIds)
      return { head, heir, evidence: isolate(from, head, parentIds, heir) }
    })
    // 候補も未確定事項も残らなかった枝を除き、記録された共通親ごとに上位枝を求める。
    const viable = attempts.filter(a => a.heir || a.evidence.reasonCode)
    const bestByParent = new Map<Id, Person>()
    for (const a of viable) for (const id of a.evidence.parentIds) {
      const best = bestByParent.get(id)
      if (!best || compareRank(a.head, best) < 0) bestByParent.set(id, a.head)
    }
    // 別の親で下位でも、この親で上位なら候補を消さない。親をまたぐ優先関係は推論しない。
    const possibleTop = viable.filter(a => a.evidence.parentIds.some(id => compareRank(a.head, bestByParent.get(id)!) === 0))
    independentStages.push({ depth, branches: attempts.map(a => a.evidence), possibleTopBranchIds: possibleTop.map(a => a.head.personId) })
    if (possibleTop.length === 0) {
      for (const a of attempts) for (const id of a.evidence.rankedCandidateIds) visited.add(id)
      return undefined
    }
    const first = possibleTop[0]!
    if (possibleTop.length === 1) {
      const evidence = first.evidence
      retain(evidence)
      unresolved = evidence.reasonCode
      return first.heir
    }
    // 同一人物に収束しても枝同士の優先は決まらない。全体には人だけを、経路は枝内に残す。
    const heir = first.heir
    if (heir && possibleTop.every(a => a.heir?.personId === heir.personId)) {
      ranked.push(heir.personId)
      // 各経路の親子リンクは枝内審査を参照する。全体に単一の親枝を割り当てない。
      reviewed.push({ personId: heir.personId, depth, parentIds: [], outcome: 'SELECTED' })
      return heir
    }
    const topHeads = possibleTop.map(a => a.head)
    for (const id of new Set(possibleTop.flatMap(a => a.evidence.parentIds))) {
      rejectTies(topHeads.filter(p => p.fatherId === id || p.motherId === id), depth, [id])
    }
    if (!unresolved || sharedParents(topHeads).length === 0 || topHeads.some(h => compareRank(topHeads[0]!, h) !== 0)) {
      unresolved = 'COLLATERAL_BRANCH_PRIORITY_UNDETERMINED'
    }
    return undefined
  }

  const directKids = childrenOfId(predecessorId)
  steps.push({ depth: 0, commonAncestorIds: [], branchHeadIds: directKids.map(p => p.personId) })
  const descendant = branches(directKids, 0, [predecessorId])
  if (unresolved) return pending(unresolved, 0)
  if (descendant) return done({ status: 'READY', personId: descendant.personId, rankedCandidateIds: ranked, relation: 'DESCENDANT' }, 0)
  if (![predecessor.fatherId, predecessor.motherId].some(Boolean)) return pending('COLLATERAL_PARENTAGE_UNDETERMINED', null)
  for (const [i, commonAncestorIds] of ancestorStages.entries()) {
    const depth = i + 1
    // 同胞は従来どおり同じ親IDで照合できる。拡張段階には実在する祖先レコードが必要。
    if (depth > 1 && firstMissingDepth <= depth) return pending('ANCESTOR_RECORD_MISSING', depth)
    const candidates = commonAncestorIds.flatMap(childrenOfId)
    steps.push({ depth, commonAncestorIds, branchHeadIds: [...new Set(candidates.map(p => p.personId))].sort(cmp) })
    if (commonAncestorIds.some(inCycle)) return pending('KINSHIP_CYCLE', depth)
    const heir = depth === 1 ? branches(candidates, depth, commonAncestorIds) : distantBranches(candidates, depth, commonAncestorIds)
    if (unresolved) return pending(unresolved, depth)
    if (heir) return done({ status: 'READY', personId: heir.personId, rankedCandidateIds: ranked, relation: 'COLLATERAL' }, depth)
  }
  if (Number.isFinite(firstMissingDepth)) return pending('ANCESTOR_RECORD_MISSING', null)
  return pending('NO_ESTABLISHED_HEIR', null, ['RECORDED_ANCESTRY_EXHAUSTED'])
}

/** 評価器構成で選ぶ相続順位の照合器。既定は旧同胞枝までの探索。 */
export function heirReviewerFor(mode: HeirSearchMode | undefined): (world: WorldState, predecessorId: Id) => HeirReview | AncestralHeirReview {
  return mode === 'RECORDED_COMMON_ANCESTOR' ? reviewAncestralHeir : reviewLandHeir
}

/** DEC-189構成だけが探索した段階・候補・除外理由をTraceへ公開する。旧構成のTraceは不変。 */
export const heirSearchInputs = (heir: HeirReview | AncestralHeirReview | null): Readonly<Record<string, JsonValue>> =>
  heir && 'search' in heir ? {
    heirSearch: structuredClone(heir.search) as unknown as JsonValue,
    heirReviewStatus: heir.status, heirReasonCodes: [...(heir.status === 'PENDING' ? heir.reasonCodes : [])],
    rankedCandidateIds: [...heir.rankedCandidateIds],
    heirRelation: heir.status === 'READY' ? heir.relation : null,
  } : {}
