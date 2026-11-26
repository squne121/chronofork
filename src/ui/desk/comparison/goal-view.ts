import type { GoalEvaluation } from '../../../simulation/goal.ts'

/** 表示専用。勝敗は再計算せず、runTimeline/forkWorldの厳格なGoal結果だけを読む。 */
export const trialGoalStatus=(g:GoalEvaluation|null):string=>{
  if(g===null)return '未検証'
  if(g.status==='ACHIEVED')return '条件に一致（技術検証）'
  if(g.status==='NOT_ACHIEVED')return '条件に不一致（技術検証）'
  return g.status==='INVALID_INPUT'?'データ不正で評価不能':'対象年ではない'
}
