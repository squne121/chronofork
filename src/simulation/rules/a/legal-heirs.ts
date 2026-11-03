// G-03/04 を使う土地相続候補の純粋な順位照合（CALIBRATION_ONLY）。
// 明示された親子関係・生死・法的王朝所属だけを使用し、婚外の合法性や権限を補完しない。
import type { Id, Person, WorldState } from '../../contracts/index.ts'

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
