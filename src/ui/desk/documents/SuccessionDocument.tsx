import type { ReactNode } from 'react'
import type { SuccessionEvidence } from '../../observation/history-digest.ts'
import type { DocumentTarget } from './index.tsx'

type Link = (target: DocumentTarget, text: string, year: number) => ReactNode

export function SuccessionDocument({ evidence, nameOf, open }: Readonly<{
  evidence: SuccessionEvidence; nameOf: (id: string) => string; open: Link
}>) {
  const { year, predecessorId, dynasty, spouse, death, discovery, caseRecord, transfer, proposed, nextHolder, reviews, judgments } = evidence
  const source = (r: NonNullable<SuccessionEvidence['death']>, label = r.text) => open({ kind: r.kind, id: r.id }, label, r.year)
  return <article data-testid="succession-evidence">
    <h3>継承の経緯</h3>
    <ol className="desk-succession">
      <li><strong>{year}年初</strong>：{open({ kind: 'person', id: predecessorId }, nameOf(predecessorId), year)}が保持（法的王朝：{dynasty ?? '未確認'}）。</li>
      <li><strong>{year}年内</strong>：{death ? <>保持者が死亡（{source(death)}）。</> : '保持者が変わる前の死亡記録は未確認。'}
        {caseRecord && <> 相続は承認されず、{source(caseRecord)}。</>}
        {transfer && <> {source(transfer)}。</>}
        {proposed && <p>{proposed.length === 0 ? '当年の探索に挙がった存命の子は0人。' : <>当年の候補：{proposed.map((p, i) => <span key={p.id}>{i > 0 && '、'}{open({ kind: 'person', id: p.id }, nameOf(p.id), year)}（法的王朝：{p.dynasty ?? '未確認'}）</span>)}。</>}
          {discovery && <> {source(discovery, '候補の記録')}</>}</p>}
      </li>
      <li><strong>{year + 1}年初</strong>：{nextHolder === 'UNDETERMINED' ? '保持者は未確定。' : nextHolder === 'HELD' ? '保持者の記録あり。' : '保持者の状態は未取得。'}{' '}
        {open({ kind: 'title', id: evidence.titleId }, '称号', year + 1)}</li>
      {reviews.map(({ first, through, lastId, candidateId }) => <li key={first.id}>
        <strong>{first.year}{through !== first.year && `〜${through}`}年内の再審査</strong>：{first.text}。{' '}
        {candidateId && <>記録された候補：{open({ kind: 'person', id: candidateId }, nameOf(candidateId), first.year)}。{' '}</>}
        {source(first, through === first.year ? '再審査' : `${first.year}年の判断`)}
        {through !== first.year && <> {open({ kind: 'trace', id: lastId }, `${through}年の判断`, through)}</>}
      </li>)}
    </ol>
    {reviews.length > 0 && <p className="note">再審査の記録には、傍系を含む全候補と個別の適格性までは残っていません。</p>}
    <p>{open({ kind: 'family', id: predecessorId }, '前保持者の家系', year)}
      {spouse && <> · {spouse.year}年に{open({ kind: 'person', id: spouse.id }, nameOf(spouse.id), year)}と婚姻</>}</p>
    {judgments.length > 0 && <details><summary>婚姻・出生の判断</summary>
      <ul>{judgments.map(({ first, through }) => <li key={first.id}>{first.year}{through !== first.year && `〜${through}`}年：{source(first)}</li>)}</ul>
      <p>婚姻候補の審査で使う信頼は調整できます。出生・相続の結果を直接指定することはできません。</p>
    </details>}
  </article>
}
