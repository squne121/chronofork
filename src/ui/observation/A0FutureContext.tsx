// 完走済み原史A0の「選択年初」と「1350年初までの確定結果」を並置する。
// A1/A2や独自の生死・相続規則は一切参照しない。
import type { Id } from '../../simulation/contracts/index.ts'
import type { ObservationSlice } from '../branch-play-source.ts'
import { shortPersonName } from '../event-summary.ts'
import { titleLabel } from './title-history.ts'

export type A0FutureContextProps=Readonly<{
  observation:ObservationSlice
  personId:Id
  disabled?:boolean
  onYearSelect:(year:number)=>void
  onTitleSelect:(titleId:Id)=>void
}>

export function A0FutureContext({observation:v,personId,disabled,onYearSelect,onTitleSelect}:A0FutureContextProps){
  const current=v.world.persons.find(p=>p.personId===personId)
  if(!current)return null
  const final=v.knownA0Ending
  const fate=final?.persons.find(p=>p.personId===personId)
  const statusNow=current.alive?'存命':current.deathYear===undefined?'死亡（没年未確認）':'死亡（'+current.deathYear+'年）'
  const statusEnd=!final?'1350年初の確定記録なし'
    :!fate||fate.status==='NOT_RECORDED'?'1350年初の人物記録なし（死亡の証拠ではありません）'
    :fate.status==='ALIVE'?'1350年初も存命'
    :fate.deathYear===undefined?'死亡（没年未確認）':'死亡（'+fate.deathYear+'年）'
  const titlesNow=v.world.titles.filter(t=>t.holder.status==='HELD'&&t.holder.personId===personId)
  const finalHolder=(titleId:Id)=>{
    const h=v.titleHistories.find(t=>t.titleId===titleId)
    return h?.intervals.find(t=>t.fromYear<=1350&&t.throughYear>=1350)?.holder
  }
  const holderText=(holder:ReturnType<typeof finalHolder>)=>{
    if(!holder)return '1350年初の保持記録なし'
    if(holder.status==='NOT_RECORDED')return '称号の記録なし'
    if(holder.status==='UNDETERMINED')return '保持者未確定'
    return shortPersonName(holder.personName)+(holder.life==='DEAD'?'（故人の名義が残存）':
      holder.life==='UNKNOWN'?'（生死未確認）':'')
  }
  return <section className="obs-a0-future" data-testid="obs-future-context" aria-label="選択年と既知の原史A0の結末">
    <h4>この年と原史A0での結末</h4>
    <div className="obs-a0-future-grid">
      <div data-testid="obs-future-current">
        <span className="obs-context-label">選択年初・{v.year}年</span>
        <strong>{statusNow}</strong>
      </div>
      <div data-testid="obs-future-ending">
        <span className="obs-context-label">原史A0の既知の未来・{final?.year??1350}年初</span>
        <strong data-testid="obs-future-fate">{statusEnd}</strong>
        {fate?.status==='DEAD'&&fate.deathYear!==undefined&&
          fate.deathYear>=1250&&fate.deathYear<=1350&&fate.deathYear!==v.year&&
          <button type="button" data-testid="obs-future-death-jump" disabled={disabled}
            onClick={()=>onYearSelect(fate.deathYear!)}>{fate.deathYear}年の記録を見る</button>}
      </div>
    </div>
    {titlesNow.length>0&&<div className="obs-a0-future-titles" data-testid="obs-future-titles">
      <span className="obs-context-label">この年に保持した称号の、原史A0での1350年初の名義</span>
      <ul>{titlesNow.map(title=><li key={title.titleId}>
        <button type="button" disabled={disabled} onClick={()=>onTitleSelect(title.titleId)}>
          {titleLabel(title,v.world)}
        </button>
        <span> → {final?holderText(finalHolder(title.titleId)):'未確認'}</span>
      </li>)}</ul>
    </div>}
  </section>
}
