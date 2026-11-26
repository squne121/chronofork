// Issue #71/#77 B: 相続PENDINGの原因分離（診断のみ）。順位・権限は新規採用しない。CALIBRATION_ONLY。
// 実100年履歴で観測した「同胞が尽きた後、従兄弟だけが存命」「親が記録されない初期保持者」を縮小再現する。
import { describe, expect, it } from 'vitest'
import { createExperimentalWorld } from '../../../src/scenario/experimental/index.ts'
import type { Person, WorldState } from '../../../src/simulation/contracts/index.ts'
import { OUT_OF_SCOPE_KIN_REASON, reviewLandHeir } from '../../../src/simulation/rules/a/index.ts'

const base = (): WorldState => createExperimentalWorld()
const proto = (w: WorldState): Person => w.persons.find(p => p.personId === 'person-exp-02')!
const mk = (w: WorldState, id: string, over: Partial<Person>): Person =>
  ({ ...proto(w), personId: id, name: id, alive: true, deathYear: undefined, ...over }) as Person

/** 祖父G → (長男F: 死亡, 次男U: 死亡) ; F→死亡した保持者H（子なし・同胞全員死亡）; U→存命の従兄弟C。 */
function cousinsOnly(): WorldState {
  const w = base()
  const persons: Person[] = [
    mk(w, 'syn-G', { sex: 'MALE', birthYear: 1200, alive: false, deathYear: 1260, fatherId: undefined, motherId: undefined }),
    mk(w, 'syn-F', { sex: 'MALE', birthYear: 1225, alive: false, deathYear: 1285, fatherId: 'syn-G', motherId: undefined }),
    mk(w, 'syn-U', { sex: 'MALE', birthYear: 1228, alive: false, deathYear: 1288, fatherId: 'syn-G', motherId: undefined }),
    mk(w, 'syn-H', { sex: 'MALE', birthYear: 1250, alive: false, deathYear: 1310, fatherId: 'syn-F', motherId: undefined }),
    mk(w, 'syn-C', { sex: 'MALE', birthYear: 1255, alive: true, fatherId: 'syn-U', motherId: undefined }),
  ]
  return { ...w, persons: [...w.persons.filter(p => !p.personId.startsWith('syn-')), ...persons] }
}

describe('相続PENDINGの原因分離（順位は変えない）', () => {
  it('同胞枝が尽き従兄弟だけが存命でも、従兄弟を後継にせずPENDINGを維持し、範囲外の存命者を診断に残す', () => {
    const r = reviewLandHeir(cousinsOnly(), 'syn-H')
    expect(r.status).toBe('PENDING')
    if (r.status !== 'PENDING') return
    expect(r.reasonCodes).toEqual(['NO_ESTABLISHED_HEIR', OUT_OF_SCOPE_KIN_REASON])
    expect(r.outOfScopeKinIds).toEqual(['syn-C'])
  })

  it('範囲内に存命の同胞がいれば従来どおりREADY（診断は順位に影響しない）', () => {
    const w = cousinsOnly()
    const withSibling: WorldState = { ...w, persons: [...w.persons, mk(w, 'syn-S', { sex: 'FEMALE', birthYear: 1252, fatherId: 'syn-F', motherId: undefined })] }
    expect(reviewLandHeir(withSibling, 'syn-H')).toMatchObject({ status: 'READY', personId: 'syn-S', relation: 'COLLATERAL' })
  })

  it('親が記録されない保持者は従来の COLLATERAL_PARENTAGE_UNDETERMINED（証拠不足）のまま', () => {
    const w = cousinsOnly()
    const orphan: WorldState = { ...w, persons: w.persons.map(p => p.personId === 'syn-H' ? { ...p, fatherId: undefined, motherId: undefined } : p) }
    expect(reviewLandHeir(orphan, 'syn-H')).toMatchObject({ status: 'PENDING', reasonCodes: ['COLLATERAL_PARENTAGE_UNDETERMINED'] })
  })

  it('共通祖先が無い存命者は範囲外診断に含めない（単なる後継不在）', () => {
    const w = cousinsOnly()
    const noKin: WorldState = { ...w, persons: w.persons.map(p => p.personId === 'syn-C' ? { ...p, fatherId: undefined, motherId: undefined } : p) }
    const r = reviewLandHeir(noKin, 'syn-H')
    expect(r).toMatchObject({ status: 'PENDING', reasonCodes: ['NO_ESTABLISHED_HEIR'] })
    expect('outOfScopeKinIds' in r).toBe(false)
  })
})
