import { describe, expect, it } from 'vitest'
import { baseDisplayName, personDisplayNames, personIdTag } from '../../../../src/ui/observation/person-display.ts'

const id = 'support:population:["cohort:1260",0]'
const person = { personId: id, name: id, sex: 'FEMALE' as const, birthYear: 1260, interactionRole: 'SUPPORTING' as const }

describe('人口由来SUPPORTING人物の表示名', () => {
  it('実記録の属性から表示する', () => {
    expect(baseDisplayName(person)).toBe('試験人物（補助・1260年生・女）')
    expect(baseDisplayName({ ...person, supporting: true, interactionRole: undefined })).toBe('試験人物（補助・1260年生・女）')
  })
  it('名前・属性・正規の安定IDが揃わない人物を変換しない', () => {
    for (const p of [
      { ...person, name: '実名' },
      { ...person, interactionRole: 'KEY' as const },
      { ...person, interactionRole: undefined },
      { ...person, personId: 'support:population:["cohort:1260",-1]', name: 'support:population:["cohort:1260",-1]' },
      { ...person, personId: 'support:population:["",0]', name: 'support:population:["",0]' },
      { ...person, personId: 'support:population:[ "cohort:1260",0]', name: 'support:population:[ "cohort:1260",0]' },
    ]) expect(baseDisplayName(p)).toBe(p.name)
  })
  it('同じ表示名の人物にはそれぞれ識別タグを付ける', () => {
    const otherId = 'support:population:["cohort:1260",1]'
    const nameOf = personDisplayNames([person, { ...person, personId: otherId, name: otherId }])
    expect(nameOf(id)).toBe(`試験人物（補助・1260年生・女）・識別${personIdTag(id)}`)
    expect(nameOf(otherId)).toBe(`試験人物（補助・1260年生・女）・識別${personIdTag(otherId)}`)
  })
})
