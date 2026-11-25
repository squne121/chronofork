import { useEffect, useMemo, useRef, useState } from 'react'
import { ObservationPanel } from './observation/ObservationPanel.tsx'
import { DEFAULT_OBSERVATION_MODE, DEFAULT_OBSERVATION_SEED, INTEGRATED_PLAY_DEFAULTS, isObservationMode, playConfigDigest } from './branch-play-source.ts'
import type { ObservationMode, ObservationSlice } from './branch-play-source.ts'
import { DeskDocuments } from './desk/documents/index.tsx'
import type { DeskDocumentsProps, DocumentOpenRequest } from './desk/documents/index.tsx'
import { historyFromObservation, matchesPlayRequest, sameHistoryYearRef } from './desk/data/history.ts'
import type { HistoryYear, HistoryYearRef } from './desk/data/history.ts'
import type { OpenDeskDocument } from './desk/layout/document-link.ts'
import type { DocumentFilter } from './desk/documents/record-filter.ts'
import { DeskInterventionWindow } from './desk/comparison/DeskInterventionWindow.tsx'
import type { DeskComparisonSelection, DeskPair } from './desk/comparison/DeskInterventionWindow.tsx'
import type { EvidenceRequest, InvestigationContext } from './desk/comparison/DeskComparison.tsx'
import { comparisonHistoryAt, comparisonTarget, investigationForIntervention, investigationFromLink } from './desk/comparison/investigation.ts'
import type { ComparisonSource } from './desk/comparison/investigation.ts'
import { createObservationRequests } from './desk/timeline/observation-requests.ts'
import type { PlayProgress } from './play-progress.ts'
import { HistoryPanel, involves } from './HistoryPanel.tsx'
import { InterventionComparePanel } from './InterventionComparePanel.tsx'
import { runPlayComparison } from './branch-play-source.ts'
import type { BranchChoice, PlayInput, PlayView, SecondPlayInput } from './branch-play-source.ts'
import { workerCandidatesRunner, workerPlayRunner } from './play-runner.ts'
import type { CandidatesRunHandle, CandidatesRunner, PlayRunHandle, PlayRunner } from './play-runner.ts'
import { candidateSetMatches } from './play-candidates.ts'
import type { PlayCandidateSet } from './play-candidates.ts'
import type { PlayMode } from './branch-play-source.ts'
import { reduceProgress } from './play-progress.ts'
import type { ProgressEnd } from './InterventionComparePanel.tsx'
import type { ProgressState } from './play-progress.ts'
import type { CalcInfo } from './IntegratedOverview.tsx'
import { Inspector } from './Inspector.tsx'
import { RegionMap } from './RegionMap.tsx'
import { RunPanel } from './RunPanel.tsx'
import { indexWorld, worldWithHistoricPersons } from './inspection-source.ts'
import type { EntityKind, InspectionSource, Selection } from './inspection-source.ts'
import {
  DEFAULT_SEED,
  YEAR_RANGE,
  eventsOfYear,
  goalStatusLabel,
  indexHistory,
  lastComputedYear,
  pendingExperimentalRun,
  runExperimentalTimeline,
  snapshotOf,
} from './timeline-source.ts'
import type { TimelineRun } from './timeline-source.ts'

/** A2のWorker結果を表示中のA0/A1へ接続してよいのは、全て同じ第1介入に基づくときだけ。 */
function sameFirstIntervention(a:PlayInput,b:PlayInput):boolean{
  return a.seed===b.seed&&(a.mode??'FIXED_APPROVAL')===(b.mode??'FIXED_APPROVAL')&&
    a.year===b.year&&a.firstPersonId===b.firstPersonId&&a.secondPersonId===b.secondPersonId&&
    a.signedDelta===b.signedDelta&&a.durationYears===b.durationYears
}

/** WorkerのA2は、表示中のA1を親にした要求どおりの追加介入でなければ接続しない。 */
function matchesFollowup(view:PlayView,parent:PlayView,input:PlayInput,extra:SecondPlayInput):boolean{
  const expected={...input,...extra}
  const source=parent.a1.result
  return view.mode===parent.mode&&sameFirstIntervention(view.input,expected)&&
    view.a0.result.branchId===source.branchId&&view.a0.result.seed===source.seed&&
    view.a0.inputs.configId===parent.a1.inputs.configId&&view.a0.inputs.configDigest===parent.a1.inputs.configDigest
}

function Unconnected({ children }: { children: string }) {
  return <span className="badge badge-off">未接続: {children}</span>
}

function isLegacyEntry():boolean{
  return typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('entry')==='legacy'
}

/** run は試験用の注入口。未指定なら通常入口では旧試験計算を行わず、?entry=legacy または旧試験を開いたときに計算する。 */
export default function App({ run: injected, playRunner = workerPlayRunner, candidatesRunner = workerCandidatesRunner }:
  Readonly<{ run?: TimelineRun; playRunner?: PlayRunner; candidatesRunner?: CandidatesRunner }>) {
  const [runState, setRun] = useState<TimelineRun>(() => injected ?? (isLegacyEntry() ? runExperimentalTimeline(DEFAULT_SEED) : pendingExperimentalRun(DEFAULT_SEED)))
  const [seedText, setSeedText] = useState(String(runState.inputs.seed))
  const [observationMode]=useState<ObservationMode>(()=>typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('run')==='legacy-integrated'
    ?'INTEGRATED_EXPERIMENTAL':DEFAULT_OBSERVATION_MODE)
  const [observationSeedText,setObservationSeedText]=useState(String(observationMode==='INTEGRATED_EXPERIMENTAL'
    ?INTEGRATED_PLAY_DEFAULTS.seed:DEFAULT_OBSERVATION_SEED))
  const [comparison, setComparison] = useState<PlayView | undefined>(undefined)
  const [running, setRunning] = useState<{ startedAt: number } | undefined>(undefined)
  const [elapsedSec, setElapsedSec] = useState(0)
  // 確定済みの年次進捗（A0/A1別）と、最後に止まった理由。結果ではなく途中経過。
  const [progress, setProgress] = useState<ProgressState>({})
  const [progressEnd, setProgressEnd] = useState<ProgressEnd | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [calc, setCalc] = useState<CalcInfo | undefined>(undefined)
  // 古い結果で上書きしないための世代番号と、キャンセル用の実行ハンドル。
  const tokenRef = useRef(0)
  const handleRef = useRef<PlayRunHandle | undefined>(undefined)
  const [a0Reused, setA0Reused] = useState(false)
  // 初回は実A0の観測を主入口にする。旧試験UIは明示的な「開発用」入口でのみ開く。
  const [workspaceOpen,setWorkspaceOpen]=useState(isLegacyEntry)
  type ObservedYear = { slice: ObservationSlice; history: HistoryYear; calc: CalcInfo }
  const [observed, setObservation] = useState<ObservedYear>()
  const observation = observed?.slice
  const observationYear = observed?.history
  const observationSources = useRef(new WeakMap<HistoryYear, ObservedYear>())
  const desk = !injected && !isLegacyEntry() && observationMode === DEFAULT_OBSERVATION_MODE
  const [deskPlaying, setDeskPlaying] = useState(false)
  const [documentRequest, setDocumentRequest] = useState<DocumentOpenRequest>()
  const documentSerial = useRef(0)
  const [documentSession, setDocumentSession] = useState(0)
  const [documentNavigation, setDocumentNavigation] = useState(0)
  const [documentFilter, setDocumentFilter] = useState<DocumentFilter>()
  const [historyUpdate, setHistoryUpdate] = useState<DeskDocumentsProps['historyUpdate']>()
  const [deskDraft, setDeskDraft] = useState<{ context: InvestigationContext; personId: string; year: number; partner?: string; serial: number }>()
  const [deskResult, setDeskResult] = useState<{ view: PlayView; context: InvestigationContext; serial: number }>()
  const [deskWindow, setDeskWindow] = useState<'intervention' | DeskComparisonSelection>()
  const comparisonSources = useRef(new WeakMap<HistoryYear, ComparisonSource & { context: InvestigationContext }>())
  const [deskWindowFront, setDeskWindowFront] = useState(false)
  const investigationLinks = useRef(new Map<string, InvestigationContext[]>())
  const pendingInvestigationLinks = useRef(new Map<string, DocumentOpenRequest>())
  const resetDeskIntervention = () => {
    setDeskDraft(undefined)
    setDeskResult(undefined)
    setDeskWindow(undefined)
  }
  const resetDocuments = () => {
    resetDeskIntervention()
    setHistoryUpdate(undefined)
    comparisonSources.current = new WeakMap()
    observationSources.current = new WeakMap()
    investigationLinks.current.clear()
    pendingInvestigationLinks.current.clear()
    setDocumentSession(n => n + 1)
    setDocumentRequest(undefined)
    setDocumentFilter(undefined)
    setDeskPlaying(false)
  }
  const [obsCalc,setObsCalc]=useState<CalcInfo>()
  const [obsPendingYear,setObsPendingYear]=useState<number>()
  const obsLoading = obsPendingYear !== undefined
  const [obsError,setObsError]=useState<{code:string;message:string}>()
  const [obsProgress,setObsProgress]=useState<PlayProgress>()
  const [obsTarget,setObsTarget]=useState<{year:number;personId:string;secondPersonId?:string;seed:number;token:number}>()
  const [obsDraining, setObsDraining] = useState(false)
  const [observationRequests] = useState(() => createObservationRequests(() => setObsDraining(false)))
  // 人物選択用のA0候補（明示操作で取得）。seed・モードを持ち、条件が変わると使われない。
  const [candidateSet, setCandidateSet] = useState<PlayCandidateSet | undefined>(undefined)
  const [fetchingCandidates, setFetchingCandidates] = useState(false)
  const [candidateError, setCandidateError] = useState<{ code: string; message: string } | undefined>(undefined)
  const candTokenRef = useRef(0)
  const candHandleRef = useRef<CandidatesRunHandle | undefined>(undefined)
  const [playError, setPlayError] = useState<{code:string;message:string} | undefined>(undefined)
  const [activeBranch, setActiveBranch] = useState<BranchChoice|'A2'>('A1')
  // 固定 ID を持つ既存 Inspector は、観測と比較の一方にだけ置く。
  const [inspectObservationWorld, setInspectObservationWorld] = useState(false)
  // 旧試験を開いた時点で初めて旧試験計算を行う（通常の初期表示では実行しない）。
  const needLegacyRun = workspaceOpen && !!runState.pending && !observation && !comparison
  const run = useMemo(() => (needLegacyRun ? runExperimentalTimeline(DEFAULT_SEED) : runState), [needLegacyRun, runState])
  const { result } = run
  const history = useMemo(() => indexHistory(result), [result])

  const last = lastComputedYear(result)
  const [requestedYear, setYear] = useState<number>(YEAR_RANGE.min)
  // 未計算の年は選べない: 範囲外の要求は計算済みの最終年へ丸める。
  const year = last === undefined ? run.initialWorld.year : Math.min(Math.max(requestedYear, YEAR_RANGE.min), last)
  const world = snapshotOf(result, year) ?? run.initialWorld
  const index = useMemo(() => indexWorld(world), [world])
  // 年内Eventが指す新生児など、年初snapshotに無い人物を他年snapshotから補って参照解決する。
  const refIndex = useMemo(() => indexWorld(worldWithHistoricPersons(world, result.snapshots)), [world, result.snapshots])

  const [tab, setTab] = useState<EntityKind>('region')
  const [selection, setSelection] = useState<Selection | undefined>(undefined)
  const [scope, setScope] = useState<'year' | 'all'>('year')
  const [targetKey, setTargetKey] = useState('')
  const [eventId, setEventId] = useState<string | undefined>(undefined)
  const [traceId, setTraceId] = useState<string | undefined>(undefined)

  const select = (s: Selection) => {
    setInspectObservationWorld(false)
    setTab(s.kind)
    setSelection(s)
  }
  // タブ操作（クリック/キーボード）: カテゴリが変わるときは古い選択を解除する
  const changeTab = (kind: EntityKind) => {
    if (kind === tab) return
    setTab(kind)
    setSelection(undefined)
  }
  const changeYear = (y: number) => {
    setYear(y)
    setEventId(undefined)
    setTraceId(undefined)
  }
  const openEvent = (id: string) => {
    const e = history.event(id)
    if (e && snapshotOf(result, e.year)) setYear(e.year)
    setEventId(id)
    // 現在の Trace が新しい Event を参照していなければ解除する（無関係な判断根拠を残さない）。
    setTraceId((cur) => (cur !== undefined && history.trace(cur)?.eventIds.includes(id) ? cur : undefined))
  }
  const changeTarget = (key: string) => {
    setTargetKey(key)
    // 新しい対象に関与しない Event/Trace の詳細は解除する。
    const e = eventId ? history.event(eventId) : undefined
    if (key && !(e && involves(e, key))) {
      setEventId(undefined)
      setTraceId(undefined)
    }
  }
  // 計算中の経過秒(実測できる値のみ)。進捗率・残り時間は出さない。
  const startedAt = running?.startedAt
  useEffect(() => {
    if (startedAt === undefined) return
    const id = setInterval(() => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(id)
  }, [startedAt])
  // 画面を離れるときは計算を中断してWorkerを解放する。
  useEffect(() => () => {
    tokenRef.current++
    handleRef.current?.cancel()
    observationRequests.cancel()
    playRunner.reset?.() // 保持中のA0とWorkerを破棄する
    candTokenRef.current++
    candHandleRef.current?.cancel()
  }, [playRunner, observationRequests])
  const cancelObservation=()=>{
    observationRequests.cancel()
    setObsDraining(false)
    setObsPendingYear(undefined)
    setObsProgress(undefined)
  }
  const changeSelectedSeed=(text:string)=>{
    // 計算中にseedが変わったときは旧Workerを止め、古い結果で新seedを上書きしない。
    if(observationRequests.busy)cancelObservation()
    if (desk && (!/^\d+$/.test(text.trim()) || Number(text.trim()) !== observation?.seed)) {
      if (deskDraft && handleRef.current && !workspaceOpen) cancelRun()
      setDeskWindow(undefined)
    }
    setSeedText(text)
    setObservationSeedText(text)
  }
  const clearProgress = () => { setProgress({}); setProgressEnd(undefined); setA0Reused(false) }
  const loadObservation=(year:number, playback=false, expectedRef?:HistoryYearRef)=>{
    if(handleRef.current||candHandleRef.current){
      setObsError({code:'RUN_IN_PROGRESS',message:'進行中の計算が終了してから観測してください'})
      return
    }
    if(!playRunner.observe){
      setObsError({code:'WORKER_UNAVAILABLE',message:'この実行経路には原史の非同期観測がありません'})
      return
    }
    const seedStr=observationSeedText.trim()
    if(!/^\d+$/.test(seedStr)||!Number.isSafeInteger(Number(seedStr))||Number(seedStr)<0){
      setObsError({code:'INVALID_SEED',message:'seedには0以上の安全な整数を指定してください'})
      return
    }
    const seed=Number(seedStr)
    const digest=playConfigDigest(observationMode)
    if((observation&&(observation.seed!==seed||observation.mode!==observationMode||observation.configDigest!==digest))||
      (comparison&&(comparison.input.seed!==seed||comparison.mode!==observationMode||comparison.a0.inputs.configDigest!==digest))){
      // 原史を切り替えるときは旧枝の計算結果だけでなく、選択中の地図・年表・詳細も破棄する。
      cancelObservation()
      playRunner.reset?.()
      setObservation(undefined)
      resetDocuments()
      setObsCalc(undefined)
      setComparison(undefined)
      setRun(pendingExperimentalRun(seed))
      setWorkspaceOpen(false)
      setActiveBranch('A1')
      setYear(YEAR_RANGE.min)
      setSelection(undefined)
      setScope('year')
      setTargetKey('')
      setEventId(undefined)
      setTraceId(undefined)
      setCandidateSet(undefined)
      setCandidateError(undefined)
      setObsTarget(undefined)
      setPlayError(undefined)
      setNotice(undefined)
      setCalc(undefined)
      clearProgress()
    }
    setObsPendingYear(year)
    setObsProgress(undefined)
    setObsError(undefined)
    observationRequests.request({
      input: { seed, mode: observationMode, year }, expectedRef, playback, observe: playRunner.observe,
      progress: setObsProgress,
      success: (view, computeMs, wallMs) => {
        setObsPendingYear(undefined)
        setObsProgress(undefined)
        const entry = { slice: view, history: historyFromObservation(view).at(view.year), calc: { computeMs, wallMs } }
        observationSources.current.set(entry.history, entry)
        for (const [id, request] of pendingInvestigationLinks.current) {
          if (!sameHistoryYearRef(request.ref, entry.history.ref)) continue
          rememberInvestigation(entry.history, request)
          pendingInvestigationLinks.current.delete(id)
        }
        setObservation(entry)
        setObsCalc(entry.calc)
        setSeedText(String(view.seed))
        // 単年の候補で全期間の存在区間を上書きしない。
        setCandidateSet(view.candidates)
      },
      failure: error => {
        setObsPendingYear(undefined)
        setObsProgress(undefined)
        setObsError(error)
      },
    })
  }
  const pauseObservation = () => {
    if (observationRequests.pause()) {
      setObsDraining(observationRequests.busy)
      setObsPendingYear(undefined)
      setObsProgress(undefined)
    }
  }
  const observationToIntervene=(year:number,personId:string,secondPersonId?:string,evidence?:InvestigationContext['evidence'])=>{
    if(!observation||observation.seed!==Number(observationSeedText.trim()))return
    if (desk && observationYear) {
      beginDeskIntervention({ history: observationYear, target: { kind: 'person', id: personId }, evidence }, year, secondPersonId)
      return
    }
    setSeedText(String(observation.seed))
    setObsTarget(old=>({year,personId,...(secondPersonId===undefined?{}:{secondPersonId}),seed:observation.seed,token:(old?.token??0)+1}))
    setWorkspaceOpen(true)
    setNotice(secondPersonId===undefined?'観測年・人物を介入フォームへ反映しました。2人目と補正値を確認してください。':'観測年と婚姻候補の2人を介入フォームへ反映しました。補正値と期間を確認してください。')
    setTimeout(()=>document.getElementById('branch-heading')?.scrollIntoView?.({block:'start'}),0)
  }
  const inCurrentA0 = (ref: HistoryYearRef) => observationYear !== undefined &&
    observationYear.ref.origin.seed === Number(observationSeedText.trim()) && /^\d+$/.test(observationSeedText.trim()) &&
    sameHistoryYearRef(ref, { ...observationYear.ref, year: ref.year })
  const stopDeskPlayback = () => { setDeskPlaying(false); pauseObservation() }
  const rememberInvestigation = (history: HistoryYear, request: Pick<DocumentOpenRequest, 'ref' | 'target' | 'source'>) => {
    const context = investigationFromLink(history, request)
    if (context?.target?.kind !== 'person') return
    const key = `${request.ref.year}:${context.target.id}`
    const known = investigationLinks.current.get(key) ?? []
    if (!known.some(x => x.history === context.history && x.evidence?.kind === context.evidence?.kind && x.evidence?.id === context.evidence?.id)) {
      investigationLinks.current.set(key, [...known, context])
    }
  }
  const openDocument: OpenDeskDocument = (target, ref, source) => {
    if (!observationYear || obsLoading || !inCurrentA0(ref) || !sameHistoryYearRef(ref, observationYear.ref)) return
    rememberInvestigation(observationYear, { ref, target, source })
    setDocumentRequest({ requestId: String(++documentSerial.current), ref, target, source })
  }
  const goToDocumentYear: NonNullable<DeskDocumentsProps['onYear']> = (ref, { windowId, sourceHistory }) => {
    if (sourceHistory) {
      // 明示比較の窓には、元 DTO と同じ比較・同じ側の年だけを返す。
      const source = comparisonSources.current.get(sourceHistory)
      const history = source && comparisonHistoryAt(source, ref)
      if (history) setHistoryUpdate({ windowId, history })
      return
    }
    if (!inCurrentA0(ref) || !Number.isInteger(ref.year) || ref.year < YEAR_RANGE.min || ref.year > YEAR_RANGE.max) return
    stopDeskPlayback()
    setDocumentNavigation(n => n + 1)
    if (observationYear?.ref.year !== ref.year || obsLoading || obsError) loadObservation(ref.year, false, ref)
  }
  const filterFromDocument: NonNullable<DeskDocumentsProps['onFilter']> = (target, ref, context) => {
    if (context?.sourceHistory) {
      const source = comparisonSources.current.get(context.sourceHistory)
      const original = source && inCurrentA0(source.context.history.ref) && !handleRef.current && comparisonHistoryAt(source, ref)
      if (source && original) {
        const focus = target.kind === 'event' || target.kind === 'trace' ? { ...target, branch: ref.origin.branch } : undefined
        setWorkspaceOpen(false)
        setDeskWindowFront(true)
        setDeskWindow({ ...source, year: ref.year, target: comparisonTarget(target) ?? source.context.target, focus })
      }
      return
    }
    if (!inCurrentA0(ref)) return
    setDocumentFilter({ target, ref })
    goToDocumentYear(ref, { windowId: '' })
    const chronicle = document.getElementById('obs-desk-chronicle')
    chronicle?.scrollIntoView?.({ block: 'nearest' })
  }
  const beginDeskIntervention = (context: InvestigationContext, year: number, partner?: string) => {
    if (context.target?.kind !== 'person' || !inCurrentA0(context.history.ref) || handleRef.current || candHandleRef.current || obsLoading) return
    stopDeskPlayback()
    setWorkspaceOpen(false)
    setPlayError(undefined)
    clearProgress()
    setNotice(undefined)
    setDeskDraft({ context, personId: context.target.id, year, partner, serial: ++documentSerial.current })
    setDeskWindow('intervention')
    setDeskWindowFront(true)
  }
  const interveneFromDocument: NonNullable<DeskDocumentsProps['onIntervene']> = (year, personId, secondPersonId, ref) => {
    if (!inCurrentA0(ref) || ref.year !== year || obsLoading || running || fetchingCandidates) return
    if (!observationYear) return
    const links = investigationLinks.current.get(`${ref.year}:${personId}`) ?? []
    const source = links.find(link => sameHistoryYearRef(ref, link.history.ref))?.history ?? observationYear
    beginDeskIntervention(investigationForIntervention(source, links, personId, secondPersonId), year, secondPersonId)
  }
  const openComparisonEvidence = ({ history, kind, id }: EvidenceRequest) => {
    if (typeof deskWindow !== 'object') return
    setDeskWindowFront(false)
    comparisonSources.current.set(history, { view: deskWindow.view, pair: deskWindow.pair, context: deskWindow.context })
    setDocumentRequest({ requestId: String(++documentSerial.current), ref: history.ref, history, target: { kind, id } })
  }
  const returnToInvestigation = (context: InvestigationContext) => {
    if (!inCurrentA0(context.history.ref)) return
    setDeskWindow(undefined)
    setDeskWindowFront(false)
    stopDeskPlayback()
    cancelObservation()
    setObsError(undefined)
    setDocumentNavigation(n => n + 1)
    const original = observationSources.current.get(context.history)
    if (original) {
      setObservation(original)
      setObsCalc(original.calc)
      setCandidateSet(original.slice.candidates)
    }
    const target = context.evidence ?? context.target
    if (target && target.kind !== 'house') setDocumentRequest({
      requestId: String(++documentSerial.current), ref: context.history.ref, target,
      source: context.evidence && context.target?.kind === 'person' ? context.target : undefined,
    })
  }
  const openDeskComparison = (pair: DeskPair) => {
    if (!deskResult || !inCurrentA0(deskResult.context.history.ref) || handleRef.current || (pair === 'A1_A2' && !deskResult.view.second)) return
    setWorkspaceOpen(false)
    setDeskWindowFront(true)
    setDeskWindow({ ...deskResult, pair, year: deskResult.context.history.ref.year, target: deskResult.context.target })
  }
  const stopCandidates = () => {
    candTokenRef.current++
    candHandleRef.current?.cancel()
    candHandleRef.current = undefined
    setFetchingCandidates(false)
  }
  // 重いA0計算はWorkerで行い、人物の選択・年の入力のたびには再計算しない（この明示操作でだけ取得する）。
  const fetchCandidates = (seed: number, mode: PlayMode) => {
    if (candHandleRef.current || handleRef.current || observationRequests.busy) return
    if(candidateSetMatches(observation?.candidates,seed,mode)){
      setCandidateSet(observation?.candidates)
      setCandidateError(undefined)
      return // 同じA0を別Workerで再計算しない
    }
    const token = ++candTokenRef.current
    setCandidateError(undefined)
    setFetchingCandidates(true)
    let handle: CandidatesRunHandle
    try {
      handle = candidatesRunner(seed, mode)
    } catch (error) {
      setFetchingCandidates(false)
      setCandidateError({ code: 'WORKER_START_FAILED', message: error instanceof Error ? error.message : String(error) })
      return
    }
    candHandleRef.current = handle
    void handle.promise.then((o) => {
      if (token !== candTokenRef.current) return
      candHandleRef.current = undefined
      setFetchingCandidates(false)
      if (o.kind === 'CANCELLED') { setNotice('人物候補の取得を中断しました。'); return }
      if (o.kind === 'FAILED') { setCandidateError({ code: o.code, message: o.message }); return }
      if (!o.result.ok) { setCandidateError({ code: o.result.code, message: o.result.message }); return }
      if(!candidateSetMatches(o.result.set,seed,mode)){
        setCandidateError({code:'CANDIDATE_IDENTITY_MISMATCH',message:'候補のseed・実行構成が一致しません'})
        return
      }
      setCandidateSet(o.result.set)
    })
  }
  const stopRunning = () => {
    tokenRef.current++
    handleRef.current?.cancel()
    handleRef.current = undefined
    setRunning(undefined)
    setElapsedSec(0)
  }
  const rerun = () => {
    stopRunning()
    cancelObservation()
    stopCandidates()
    setCandidateSet(undefined)
    setObservation(undefined)
    resetDocuments()
    setObsTarget(undefined)
    playRunner.reset?.() // 新規ゲーム/seed変更では前の世界線のA0を引き継がない
    clearProgress()
    setNotice(undefined)
    setCalc(undefined)
    const seedStr=seedText.trim()
    if(!/^\d+$/.test(seedStr)||!Number.isSafeInteger(Number(seedStr))||Number(seedStr)<0){
      setObsError({code:'INVALID_SEED',message:'seedには0以上の安全な整数を指定してください'})
      return
    }
    const seed=Number(seedStr)
    setRun(runExperimentalTimeline(seed))
    setWorkspaceOpen(true)
    setComparison(undefined)
    setPlayError(undefined)
    setEventId(undefined)
    setTraceId(undefined)
  }

  const applyView = (c:PlayView, input:PlayInput) => {
    setPlayError(undefined)
    setComparison(c)
    setInspectObservationWorld(false)
    setWorkspaceOpen(true)
    setActiveBranch(c.second?'A2':'A1')
    setRun(c.second?c.second.a1:c.a1)
    setYear(input.year)
    setScope('year')
    setTargetKey('')
    setEventId(undefined)
    setTraceId(undefined)
    setSelection(undefined)
  }
  // 計算完了後は実際の差分要約へ移動し、技術ログの海で迷わせない。
  // 結果DOMがcommitされた後に移動する必要があるため、applyViewのタイマーではなくA1結果の更新へ連動させる。
  const resultReveal=comparison?.a1
  useEffect(()=>{
    if(!resultReveal)return
    const id=requestAnimationFrame(()=>document.getElementById('effect-summary')?.scrollIntoView?.({block:'start'}))
    return()=>cancelAnimationFrame(id)
  },[resultReveal])
  const runComparison = (input:PlayInput, draft?: { context: InvestigationContext; serial: number }) => {
    const context = draft?.context
    if (context && (!inCurrentA0(context.history.ref) || input.mode !== observationMode || input.seed !== context.history.ref.origin.seed)) return
    const parent = context ? deskResult?.view : comparison
    setNotice(undefined)
    if (candHandleRef.current || observationRequests.busy) {setPlayError({code:'RUN_IN_PROGRESS',message:'原史の観測・候補取得が終了してから介入してください'});return}
    if(input.mode==='MULTI_HOUSE_EXPERIMENTAL'&&!candidateSetMatches(observation?.candidates,input.seed,input.mode)){
      setPlayError({code:'OBSERVATION_REQUIRED',message:'介入するseedの原史を先に観測してください'})
      return
    }
    const mode=input.mode
    if (!isObservationMode(mode)) clearProgress()
    if (isObservationMode(mode)) {
      // 100年のA0/A1はWorkerで再計算する。計算中の二重起動は無視し、古い結果は破棄する。
      if (handleRef.current) return
      const token = ++tokenRef.current
      const started = Date.now()
      setPlayError(undefined)
      clearProgress()
      setElapsedSec(0)
      setRunning({ startedAt: started })
      let handle: PlayRunHandle
      try {
        handle = playRunner(input, (p) => { if (token === tokenRef.current) setProgress((s) => reduceProgress(s, p)) },
          { onA0Reused: () => { if (token === tokenRef.current) setA0Reused(true) } })
      } catch (error) {
        setRunning(undefined)
        setProgressEnd('FAILED')
        setPlayError({ code: 'WORKER_START_FAILED', message: error instanceof Error ? error.message : String(error) })
        return
      }
      handleRef.current = handle
      void handle.promise.then((o) => {
        if (token !== tokenRef.current) return
        handleRef.current = undefined
        setRunning(undefined)
        if (o.kind === 'CANCELLED') { setProgressEnd('CANCELLED'); setNotice('計算を中断しました。表示中の結果は変わっていません。'); return }
        if (o.kind === 'FAILED') { setProgressEnd('FAILED'); setPlayError({ code: o.code, message: o.message }); return }
        if (!o.result.ok) {
          setProgressEnd(/^A[012]_HALTED$/.test(o.result.code) ? 'HALTED' : 'FAILED')
          setPlayError({ code: o.result.code, message: o.result.message })
          return
        }
        const view='secondView' in o.result
          ?parent&&input.second&&sameFirstIntervention(parent.input,input)&&
            sameFirstIntervention(o.result.parentInput,parent.input)&&
            matchesFollowup(o.result.secondView,parent,input,input.second)
            ?{...parent,second:o.result.secondView,a0Source:o.result.a0Source}
            :undefined
          :input.second?undefined:o.result.view
        if(!view){
          setProgressEnd('FAILED')
          setPlayError({code:'A2_PARENT_MISMATCH',message:'前回のA1と第2介入の条件が一致しません'})
          return
        }
        if((context && !matchesPlayRequest(input, view)) || view.mode!==mode||!sameFirstIntervention(view.input,input)||
          view.a0.inputs.configDigest!==playConfigDigest(mode)||view.a1.inputs.configDigest!==view.a0.inputs.configDigest||
          (view.second&&view.second.a1.inputs.configDigest!==view.a0.inputs.configDigest)){
          setProgressEnd('FAILED')
          setPlayError({code:'COMPARISON_IDENTITY_MISMATCH',message:'要求した介入と結果の実行構成が一致しません'})
          return
        }
        clearProgress()
        setCalc({ computeMs: o.computeMs, wallMs: Date.now() - started })
        if (draft) {
          setDeskResult({ view, context: draft.context, serial: draft.serial })
          setNotice(input.second ? '第2介入の計算が完了しました。A1とA2の比較を開けます。' : '介入の計算が完了しました。原史と改変史の比較を開けます。')
        } else applyView(view,input)
      })
      return
    }
    const outcome = runPlayComparison(input)
    if (!outcome.ok) {
      setPlayError({code:outcome.code,message:outcome.message})
      return
    }
    applyView(outcome.comparison, input)
  }
  const cancelRun = () => {
    stopRunning()
    setProgressEnd('CANCELLED')
    setNotice('計算をキャンセルしました。表示中の結果は変わっていません。')
  }
  const switchBranch = (choice:BranchChoice|'A2') => {
    if (!comparison || (choice==='A2'&&!comparison.second)) return
    setActiveBranch(choice)
    setRun(choice==='A0'?comparison.a0:choice==='A1'?comparison.a1:comparison.second!.a1)
    setTargetKey('')
    setEventId(undefined)
    setTraceId(undefined)
    setSelection(undefined)
  }
  const openComparisonEvent = (choice:BranchChoice,id:string) => {
    if (!comparison) return
    const other=choice==='A0'?comparison.a0:comparison.a1
    const e=other.result.eventLog.find(x=>x.eventId===id)
    if (!e) return
    setActiveBranch(choice)
    setRun(other)
    setYear(e.year)
    setScope('year')
    setTargetKey('')
    setEventId(id)
    setTraceId(undefined)
    setSelection(undefined)
    // 幅が狭く1列になる場合でも詳細へ辿れるよう、理由欄へ移動する。
    setTimeout(() => document.getElementById('reasons')?.scrollIntoView?.({ block: 'start' }), 0)
  }

  // Eventが確定しなかった判断も、実際に記録されたDecisionTraceから直接検証できる。
  const openComparisonTrace = (choice:BranchChoice,id:string) => {
    if (!comparison) return
    const chosen=choice==='A0'?comparison.a0:comparison.a1
    const trace=chosen.result.decisionTraces.find(t=>t.traceId===id)
    if (!trace || !snapshotOf(chosen.result,trace.year)) return
    setActiveBranch(choice)
    setRun(chosen)
    setYear(trace.year)
    setScope('year')
    setTargetKey('')
    setEventId(undefined)
    setTraceId(trace.traceId)
    setSelection(undefined)
    // 縦長の比較欄から、年表の下にあるTrace詳細そのものへ移動する。
    // Reactの描画完了後にスクロールし、HistoryPanel側のフォーカスも維持する。
    setTimeout(() => document.querySelector('[data-testid="trace-detail"]')?.scrollIntoView?.({ block: 'start' }), 0)
  }

  const source: InspectionSource = {
    label: run.inputs.scenarioId,
    world,
    experimental: true,
    events: result.eventLog,
    traces: result.decisionTraces,
  }
  const allEvents = scope === 'all' ? result.eventLog : eventsOfYear(result, year)
  const shown = targetKey ? allEvents.filter((e) => involves(e, targetKey)) : allEvents

  const branchLabel = comparison
    ?activeBranch==='A0'?'A0（介入なしの歴史）':activeBranch==='A1'?'A1（第1介入の歴史）':'A2（第2介入までの歴史）'
    :observation?(observation.mode==='MULTI_HOUSE_EXPERIMENTAL'?'A0（複数家門の原史を観測）':'A0（統合試験の原史を観測）'):'原史（旧・C004試験計算）'
  const activeDeskResult = deskResult?.serial === deskDraft?.serial ? deskResult : undefined
  const deskSeedMatches = deskDraft && inCurrentA0(deskDraft.context.history.ref)
  const interventionProps = {
    seedText, year, comparison, error: playError, running: running ? { elapsedSec } : undefined,
    progress, a0Reused, progressEnd, notice, calc, onCancel: cancelRun, onSeedText: changeSelectedSeed,
    candidateSet, fetchingCandidates, observationLoading: obsLoading || obsDraining, candidateError,
    onFetchCandidates: fetchCandidates, onCancelCandidates: () => { stopCandidates(); setNotice('人物候補の取得を中断しました。') },
    activeBranch, onRun: runComparison, onViewBranch: switchBranch, onInspectEvent: openComparisonEvent, onInspectTrace: openComparisonTrace,
  }
  return (
    <div className="app">
      <header className={desk ? "topbar desk-status" : "topbar"}>
        {!desk && <h1>Project Chronofork</h1>}
        <div className="badge badge-warn" role="status" data-testid="experimental-banner">
          試験計算（仮データ・一部のみ実装）
          <details className="dev-details"><summary>技術情報</summary>EXPERIMENTAL / CALIBRATION_ONLY</details>
        </div>
        <dl className="status-list">
          {(!observation||!!comparison)&&<div>
            <dt>観測中の年</dt>
            <dd data-testid="current-year">{comparison?world.year+'年（年初の状態）':workspaceOpen?world.year+'年（旧試験計算）':'1250〜1350年・原史は未観測'}</dd>
          </div>}
          <div>
            <dt>観測中の歴史</dt>
            <dd data-testid="history-status">{!comparison&&!observation&&!workspaceOpen?'原史A0（未観測）':branchLabel}</dd>
          </div>
          <div>
            <dt>1350年の正式勝敗</dt>
            <dd data-testid="goal-status">{!comparison&&!workspaceOpen?'正式な勝敗は未成立（試験版）':observation&&!comparison?'正式な勝敗は未成立（参考判定は原史欄に表示）':goalStatusLabel(result)}</dd>
          </div>
        </dl>
        {desk && deskSeedMatches && <div aria-label="編纂机の介入と比較">
          <button type="button" onClick={() => { setWorkspaceOpen(false); setDeskWindowFront(true); setDeskWindow('intervention') }}>介入の資料を開く</button>{' '}
          {deskResult && <button type="button" disabled={!!running} onClick={() => openDeskComparison('A0_A1')}>A0とA1の比較を開く</button>}{' '}
          {deskResult?.view.second && <button type="button" disabled={!!running} onClick={() => openDeskComparison('A1_A2')}>A1とA2の比較を開く</button>}
        </div>}
        <details className="trial-help" data-testid="trial-guide-details">
          <summary>試験構成と現在できること</summary>
          <p className="lead" data-testid="trial-guide">
            この試験版でできること: 人物間信頼へ介入してA1を作り、同年の別ペアへ追加介入してA2まで再計算できます。A0/A1/A2の実Eventと判断根拠を観測します。正式な歴史・勝敗はまだ評価できません。
          </p>
        </details>
      </header>

      <main className="layout">
        <div className="obs-main">
          <ObservationPanel desk={desk}
            {...(desk ? { historyYear: observationYear, onOpenDocument: openDocument,
              documentNavigation, documentFilter, onClearDocumentFilter: () => setDocumentFilter(undefined),
              playing: deskPlaying, onPlayingChange: setDeskPlaying } : {})}
            worldInspectorVisible={!desk || !comparison || inspectObservationWorld}
            onInspectWorld={()=>setInspectObservationWorld(true)} draining={obsDraining} pendingYear={obsPendingYear} blocked={!!running || fetchingCandidates} onPause={pauseObservation} mode={observationMode} calc={obsCalc} observation={observation} loading={obsLoading} progress={obsProgress} error={obsError}
            seedText={observationSeedText} onSeedText={changeSelectedSeed} onReset={rerun}
            onLoad={loadObservation} onCancel={()=>{cancelObservation();setObsError({code:'CANCELLED',message:'計算を中断しました'})}} onIntervene={observationToIntervene}/>
        </div>
        <details className="obs-main obs-workspace" data-testid="legacy-workspace" open={workspaceOpen}
          onToggle={e=>{ setWorkspaceOpen(e.currentTarget.open); if (e.currentTarget.open && desk) setDeskWindow(undefined) }}>
          <summary data-testid="legacy-toggle">
            {comparison?'介入結果とA0/A1/A2の比較を確認する':!desk&&observation?'調べた人物から介入・比較する':'開発用：旧試験と直接介入の操作を開く'}
          </summary>
          <div className="layout obs-workspace-layout">
        <div className="flow-col">
          <InterventionComparePanel {...interventionProps}
            key={`${observation?.mode??'dev'}:${obsTarget?.token??0}`} observationMode={observation?.mode==='MULTI_HOUSE_EXPERIMENTAL'||obsTarget?observation?.mode:undefined}
            observationTarget={obsTarget} />
        </div>

        {(!observation || !!comparison) && <>
        <div className="reason-col" id="reasons">
          <section aria-labelledby="year-heading" className="panel">
            <h2 id="year-heading"><span className="step-no">4</span>理由を確認する: 年を選ぶ</h2>
            <label htmlFor="year-slider">観測する年</label>
            <input
              id="year-slider"
              type="range"
              min={YEAR_RANGE.min}
              max={last ?? YEAR_RANGE.min}
              step={1}
              value={year}
              disabled={last === undefined || last === YEAR_RANGE.min}
              aria-describedby="year-note"
              aria-valuetext={`${year}年`}
              onChange={(e) => changeYear(Number(e.target.value))}
            />
            <output data-testid="slider-year">{year}</output>
            <p id="year-note" className="note" data-testid="year-note">
              計算済み: {YEAR_RANGE.min}〜{last ?? '—'}年（年初の状態）。
              {last !== undefined && last < YEAR_RANGE.max
                ? `${last + 1}〜${YEAR_RANGE.max}年は未計算のため選べません。`
                : `${YEAR_RANGE.max}年は評価専用の年で、年内の事件はありません。`}
            </p>
          </section>
          <HistoryPanel
            result={result}
            history={history}
            index={index}
            refIndex={refIndex}
            year={year}
            scope={scope}
            targetKey={targetKey}
            events={shown}
            allEvents={result.eventLog}
            eventId={eventId}
            traceId={traceId}
            onScope={(s) => {
              setScope(s)
              setEventId(undefined)
              setTraceId(undefined)
            }}
            onTarget={changeTarget}
            onEvent={openEvent}
            onTrace={setTraceId}
            onSelect={select}
          />
        </div>

        <div className="world-row">
          <RegionMap
            source={source}
            index={index}
            selectedRegionId={selection?.kind === 'region' ? selection.id : undefined}
            onSelect={(id) => select({ kind: 'region', id })}
          />
          {desk && comparison && inspectObservationWorld
            ? <button type="button" onClick={()=>setInspectObservationWorld(false)}>比較欄で選択中の歴史の資料を表示</button>
            : <Inspector source={source} index={index} tab={tab} selection={selection} onTab={changeTab} onSelect={select} />}
        </div>

        <div className="dev-row">
          <details className="panel dev-details" data-testid="dev-info">
            <summary>開発・検証情報（RuleID・バージョン・seed・未実装ルール）</summary>
            <RunPanel inputs={run.inputs} result={result} seedText={seedText} onSeedText={changeSelectedSeed} onRerun={rerun} />
          </details>

          <section aria-labelledby="reserved-heading" className="panel">
            <h2 id="reserved-heading">未実装の機能</h2>
            <ul className="reserved" data-testid="reserved-areas">
              <li>介入・A0/A1/A2の3枝比較: <span className="badge badge-off">試験版で接続済み（CALIBRATION_ONLY）</span></li>
              <li>保存・A3以降の介入: <Unconnected>未実装</Unconnected></li>
              <li>人物・法制の正式自律判断: <Unconnected>未承認</Unconnected></li>
            </ul>
          </section>
        </div>
        </>}
          </div>
        </details>
      </main>
      {desk && <div onPointerDownCapture={() => setDeskWindowFront(false)} onFocusCapture={() => setDeskWindowFront(false)}><DeskDocuments key={documentSession} history={observationYear} slice={observation}
        openRequest={documentRequest} interventionDisabled={!observationYear || !inCurrentA0(observationYear.ref) || obsLoading || !!running || fetchingCandidates}
        historyUpdate={historyUpdate} onOpenRelated={request => {
          if (request.sourceHistory || !inCurrentA0(request.ref)) return
          if (request.history) rememberInvestigation(request.history, request)
          else if (request.target.kind === 'person') pendingInvestigationLinks.current.set(request.requestId, request)
        }} onYear={goToDocumentYear} onFilter={filterFromDocument} onIntervene={interveneFromDocument} /></div>}
      {desk && deskDraft && !workspaceOpen && <DeskInterventionWindow open={!!deskSeedMatches && deskWindow !== undefined}
        front={deskWindowFront} onFront={() => setDeskWindowFront(true)}
        comparison={typeof deskWindow === 'object' ? deskWindow : undefined} onCompare={setDeskWindow}
        onClose={() => setDeskWindow(undefined)} onReturn={returnToInvestigation} onEvidence={openComparisonEvidence}>
        <InterventionComparePanel {...interventionProps} key={deskDraft.serial} desk observationMode={observationMode}
          year={deskDraft.context.history.ref.year} comparison={activeDeskResult?.view}
          observationTarget={{ year: deskDraft.year, personId: deskDraft.personId, secondPersonId: deskDraft.partner,
            seed: deskDraft.context.history.ref.origin.seed, token: deskDraft.serial }}
          onRun={input => {
            const draft = input.second ? activeDeskResult : deskDraft
            if (draft) runComparison(input, draft)
          }}
          onDeskCompare={openDeskComparison} />
      </DeskInterventionWindow>}
    </div>
  )
}
