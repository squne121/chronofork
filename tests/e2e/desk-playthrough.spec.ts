import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'
import type { DecisionTrace, EventLogEntry } from '../../src/simulation/contracts/index.ts'
import type { WorkerRequest, WorkerResponse } from '../../src/ui/play-worker.ts'

const pair = ['person-exp-03', 'person-exp-04'] as const
const seed = '20260101'
const year = 1251
const firstYear = 1250
const digest = '5090c8485f4b8570'

test.use({ actionTimeout: 15_000 })

type FailureFixture = 'A1_HALTED' | 'WORKER_EXCEPTION'
type TestControl = Window & { nextComparisonFailure?: FailureFixture | 'STALE'; deliverStaleComparison?: () => void }

async function readRecord<T>(dialog: Locator, summary: RegExp): Promise<T> {
  const details = dialog.getByText(summary).and(dialog.locator('summary')).locator('..')
  await expect(details).toHaveCount(1)
  // Read the document's own technical evidence; no simulation calls from the spec.
  return JSON.parse((await details.locator('pre').textContent())!) as T
}

// Reuses the real C1 input and evidence from multi-house-browser. Success is the
// actual usual-entry Worker run, not the old workspace or a replacement view.
test('通常入口の実 v0：年代記から介入し、2枝の実記録を照合して元の調査に戻る', async ({ page }, testInfo) => {
  test.skip(process.env.CHRONOFORK_E2E_DESK_PLAYTHROUGH !== '1', 'CHRONOFORK_E2E_DESK_PLAYTHROUGH=1 で実 v0 の100年を計算する')
  test.setTimeout(10 * 60_000)
  const get = (id: string) => page.getByTestId(id)
  const dialogs = page.getByRole('dialog')
  const documents = (kind: string, id: string) => get('desk-document').and(page.locator(`[data-kind="${kind}"][data-target=${JSON.stringify(id)}]`))
  const person = documents('person', pair[0])
  const back = (doc: Locator) => doc.getByRole('button', { name: '戻る', exact: true }).click()
  const intervention = page.getByRole('dialog', { name: /介入/ })
  const comparison = page.getByRole('dialog', { name: /歴史の比較/ })
  const showComparison = intervention.getByRole('button', { name: '同じ年の歴史を比較', exact: true })
  const run = intervention.getByTestId('branch-run')
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const atYear = async (selected: number) => {
    await expect(get('obs-year-label')).toHaveText(`${selected}年初`, { timeout: 180_000 })
    for (const id of ['obs-chronicle', 'region-map']) {
      await expect(get(id)).toBeVisible()
      await expect(get(id)).toHaveAttribute('data-year', String(selected))
    }
  }
  const reference = async (dialog: Locator, branch: 'A0' | 'A1', referenceYear = year) => {
    await expect(dialog.getByTestId('document-reference')).toHaveText(`${branch} / ${referenceYear}年 / seed ${seed}`)
  }

  // Only the negative submissions are intercepted. A0 observation and the
  // successful A1 request/response use the unmodified Worker, without fixtures.
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (this: Worker, request: WorkerRequest, options?: StructuredSerializeOptions | Transferable[]) {
      const control = window as TestControl
      const code = control.nextComparisonFailure
      if (code && request && 'input' in request) {
        delete control.nextComparisonFailure
        const reply: WorkerResponse = { ok: false, code: code === 'STALE' ? 'WORKER_EXCEPTION' : code, message: `E2E fixture: ${code}`, computeMs: 0 }
        const deliver = () => this.dispatchEvent(new MessageEvent('message', { data: reply }))
        if (code === 'STALE') control.deliverStaleComparison = deliver
        else queueMicrotask(deliver)
        return
      }
      if (Array.isArray(options)) post.call(this, request, { transfer: options })
      else post.call(this, request, options)
    }
  })

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await expect(get('obs-seed-input')).toHaveValue(seed)
  await get('obs-start').click()
  await atYear(firstYear)
  await expect(get('obs-cache-source')).toContainText('実計算済み')
  await get('obs-dev-info').getByText('開発・検証情報', { exact: true }).click()
  await expect(get('obs-source')).toContainText('experimental-multi-house-v0')
  await expect(get('obs-source')).toContainText(digest)
  await get('obs-dev-info').getByText('開発・検証情報', { exact: true }).click()
  await page.getByRole('button', { name: '翌年', exact: true }).click()
  await atYear(year)

  // A0 actually registers a different marriage for this person in the same year.
  // Enter the investigation through that Event in the chronicle, not a dev tab.
  const optionLabel = async (id: string) => (await get('obs-person').locator(`option[value="${id}"]`).textContent() ?? '').trim().split('（')[0]!
  const targetName = await optionLabel(pair[0])
  const partnerName = (await optionLabel(pair[1])).split('・')[0]!
  const chronicle = get('obs-chronicle')
  await chronicle.getByRole('combobox', { name: '種類' }).selectOption('marriage')
  await chronicle.locator('[aria-current=date] ol').getByRole('button').filter({ hasText: targetName.split('・')[0]! }).click()
  const originEvent = dialogs.filter({ has: page.getByRole('heading', { name: /^年内の出来事：/ }) })
  await reference(originEvent, 'A0')
  const originalMarriage = await readRecord<EventLogEntry>(originEvent, /^技術詳細：MARRIAGE_REGISTER/)
  expect(originalMarriage.involvedRefs).toContainEqual(expect.objectContaining({ kind: 'PERSON_PAIR', ids: expect.arrayContaining([pair[0]]) }))
  expect(originalMarriage.involvedRefs).not.toContainEqual({ kind: 'PERSON_PAIR', ids: pair })
  await originEvent.getByTestId(`document-link-person-${pair[0]}`).click()
  await reference(person, 'A0')
  await expect(person).toContainText('参照元: 出来事')

  await person.getByText('生涯の婚姻・称号・過去の判断を調べる', { exact: true }).click()
  const partner = person.getByTestId('history-partner').filter({ has: page.locator('summary').filter({ hasText: partnerName }) })
  await expect(person).toBeVisible()
  await partner.locator('> summary').click()
  await person.getByRole('button', { name: '固定', exact: true }).click()
  await partner.locator('li').filter({ hasText: 'B-005' }).getByTestId('history-open-trace')
    .filter({ hasText: `${year}年の判断記録を開く` }).click()
  const originalTraceDoc = page.getByRole('dialog', { name: /^判断 / })
  await reference(originalTraceDoc, 'A0')
  const originalTrace = await readRecord<DecisionTrace>(originalTraceDoc, /技術詳細（実判断: B-005 \/ DEFER）/)
  expect(originalTrace).toMatchObject({ year, actorRef: { kind: 'PERSON_PAIR', ids: pair }, status: 'DEFER', eventIds: [] })
  expect(originalTrace.reasonCodes).toContain('MUTUAL_UNIQUE_PARTNER_NOT_ESTABLISHED')

  // 資料の参照年は、年代記の年を移動しても維持する。
  await get('obs-year-slider').press('Home')
  await atYear(firstYear)
  await expect(person).toHaveAttribute('data-slot', 'fixed')
  await partner.getByTestId('history-intervene-pair').click()
  await expect(intervention).toBeVisible()
  await expect(intervention.getByTestId('branch-fork-year')).toHaveValue(String(year))
  await expect(intervention.getByTestId('branch-person-one')).toHaveValue(pair[0])
  await expect(intervention.getByTestId('branch-person-two')).toHaveValue(pair[1])
  await expect(intervention.getByTestId('candidate-status')).toContainText(`${year}年初`)
  await expect(get('legacy-workspace')).not.toHaveAttribute('open', '')
  await expect(comparison).toHaveCount(0)
  await intervention.getByTestId('branch-duration').fill('1')
  const delta = intervention.getByTestId('branch-trust-delta')
  await delta.fill('0')
  await expect(run).toBeDisabled()
  await delta.fill('20')
  await expect(run).toBeEnabled()

  await test.step('停止/失敗の応答 fixture を、確定結果や勝敗と取り違えない', async () => {
    for (const [code, progress] of [['A1_HALTED', '歴史計算が停止しました（HALTED）'], ['WORKER_EXCEPTION', '計算に失敗しました']] as const) {
      await page.evaluate(code => { (window as TestControl).nextComparisonFailure = code }, code)
      await run.click()
      await expect(intervention.getByRole('alert')).toContainText(`E2E fixture: ${code}`)
      await expect(intervention.getByTestId('branch-progress')).toContainText(progress)
      await expect(intervention.getByTestId('branch-progress')).toContainText('最終結果・勝敗ではありません')
      await expect(showComparison).not.toBeVisible()
      await expect(comparison).toHaveCount(0)
      await atYear(firstYear)
    }
  })

  await test.step('キャンセルした Worker の遅い応答は新しい計算に混ぜない', async () => {
    await page.evaluate(() => { (window as TestControl).nextComparisonFailure = 'STALE' })
    await run.click()
    await expect(intervention.getByTestId('branch-running')).toBeVisible()
    await intervention.getByTestId('branch-cancel').click()
    await expect(intervention.getByTestId('branch-progress')).toContainText('キャンセルされました')
  })
  await run.click()
  await expect(intervention.getByTestId('branch-running')).toBeVisible()
  await expect(run).toBeDisabled()
  await expect(intervention.getByTestId('branch-progress')).toContainText('途中経過（未確定）')
  await expect(comparison).toHaveCount(0)
  await page.evaluate(() => (window as TestControl).deliverStaleComparison?.())
  await expect(intervention.getByRole('alert')).toHaveCount(0)
  await atYear(firstYear)
  await expect(showComparison).toBeEnabled({ timeout: 240_000 })
  await showComparison.click()
  await expect(comparison.getByRole('heading', { name: '同じ年の歴史を比較' })).toBeVisible()
  await expect(comparison).not.toHaveAttribute('aria-modal', 'true')
  await expect(comparison).toContainText(`介入年 ${year}年／観測年 ${year}年`)
  await expect(comparison).toContainText(/1350年の技術判定（正式勝敗ではありません）：A0 条件に不一致.*A1 条件に不一致/)

  const a0 = comparison.getByRole('region', { name: 'A0の記録', exact: true })
  const a1 = comparison.getByRole('region', { name: 'A1の記録', exact: true })
  for (const [label, branch] of [['A0', a0], ['A1', a1]] as const) {
    await expect(branch.getByRole('heading', { name: `${label}・${year}年` })).toBeVisible()
    await expect(branch).toContainText(`${targetName}：存命`)
  }
  await expect(comparison).toContainText('対象年初状態: 実値に差なし')
  const state = comparison.getByRole('region', { name: '年初の状態差', exact: true })
  const changes = comparison.getByRole('region', { name: '記録差分', exact: true })
  await expect(changes).toContainText('因果を示しません')
  const compareAt = async (selected: number) => {
    const input = comparison.getByRole('spinbutton', { name: '比較する年', exact: true })
    await input.fill(String(selected))
    await input.press('Enter')
    await expect(a0.getByRole('heading', { name: `A0・${selected}年`, exact: true })).toBeVisible()
    await expect(a1.getByRole('heading', { name: `A1・${selected}年`, exact: true })).toBeVisible()
  }

  // 比較年とは独立に、元の年へ観測を進めても比較は維持される。
  await page.getByRole('button', { name: '翌年', exact: true }).press('Enter')
  await atYear(year)
  // Check the two widths with live, non-modal windows, reusing the same real run.
  for (const width of [1280, 960]) {
    await page.setViewportSize({ width, height: 900 })
    await atYear(year)
    const bounds = await comparison.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: testInfo.outputPath(`desk-playthrough-${width}.png`) })
  }

  await test.step('同じ人物・同年の判断と、改変史の確定 Event・状態差分を照合する', async () => {
    await expect(changes.locator('li > div').filter({ hasText: /^A0:/ })
      .getByTestId(`comparison-trace-${originalTrace.traceId}`)).toHaveText(/^保留：/)
    const revised = changes.locator('li > div').filter({ hasText: /^A1:/ })
      .getByTestId(/^comparison-trace-.*:B-005:/).filter({ hasText: /^採用：/ })
    await expect(revised).toHaveCount(1)
    const traceId = (await revised.getAttribute('data-testid'))!.replace('comparison-trace-', '')
    await revised.click()
    const evidence = documents('trace', traceId).last()
    await reference(evidence, 'A1')
    await expect(evidence.getByText('出典')).toHaveCount(1)
    const provenance = evidence.getByText('出典').locator('..')
    expect(await provenance.textContent()).toContain(digest)
    const revisedTrace = await readRecord<DecisionTrace>(evidence, /技術詳細（実判断: B-005 \/ ACCEPT）/)
    expect(revisedTrace).toMatchObject({ traceId, year, actorRef: { kind: 'PERSON_PAIR', ids: pair }, ruleId: 'B-005', status: 'ACCEPT' })
    expect(revisedTrace.reasonCodes).toContain('BOTH_PARTIES_ACCEPT_UNIQUE_CONTRACT')
    expect(revisedTrace.modifierIds).not.toHaveLength(0)
    await evidence.getByRole('button', { name: '比較で絞る', exact: true }).click()
    await expect(changes).toContainText('指定した根拠')
    await expect(a1.getByTestId(`comparison-trace-${traceId}`)).toBeVisible()
    await comparison.getByRole('button', { name: '根拠の絞り込みを解除' }).click()
    await evidence.getByRole('button', { name: '資料を閉じる' }).press('Escape')

    await a1.getByText(/^年内の出来事（直接関与/).click()
    await a1.getByTestId(/^comparison-event-.*:A-LEG-01:/).filter({ hasText: '婚姻' }).click()
    const marriageDoc = page.getByRole('dialog', { name: /^出来事 / }).last()
    await reference(marriageDoc, 'A1')
    const marriage = await readRecord<EventLogEntry>(marriageDoc, /^技術詳細：MARRIAGE_REGISTER/)
    expect(marriage).toMatchObject({ year, eventType: 'MARRIAGE_REGISTER' })
    expect(marriage.eventId).not.toBe(originalMarriage.eventId)
    expect(marriage.involvedRefs).toContainEqual({ kind: 'PERSON_PAIR', ids: pair })
    expect(marriage.stateChanges).toContainEqual(expect.objectContaining({ path: expect.stringMatching(/^\$\.legal\.marriages\[/), before: null,
      after: expect.objectContaining({ personIds: pair, registeredYear: year, status: 'ACTIVE' }) }))
    const legalTrace = marriage.sourceTraceIds.find(id => id.includes('A-LEG-01'))
    expect(legalTrace).toBeDefined()
    await marriageDoc.getByTestId(`document-link-trace-${legalTrace}`).click()
    const legalDoc = documents('trace', legalTrace!)
    await reference(legalDoc, 'A1')
    const legal = await readRecord<DecisionTrace>(legalDoc, /技術詳細（実判断: A-LEG-01 \/ ACCEPT）/)
    expect(legal.eventIds).toContain(marriage.eventId)
    await back(legalDoc)
    await marriageDoc.getByRole('button', { name: '資料を閉じる' }).press('Escape')
  })

  await test.step('翌年初に状態差が見え、介入前に記録差が出ない', async () => {
    await compareAt(year + 1)
    const marriageDifference = state.getByText('有効な婚姻の相手', { exact: true }).locator('..')
    await expect(marriageDifference).toContainText(`A1：${partnerName}`)
    await expect(marriageDifference).not.toContainText(`A0：${partnerName}`)
    await compareAt(firstYear)
    await expect(changes).toContainText('Event 0件／判断Trace 0件')
    await expect(changes).toContainText('表示データ内に該当する記録差はありません')
    // The unchanged B-009 records from the intervention year may be omitted
    // from transfer; the UI must not present a full, authoritative diff.
    await compareAt(year)
    await expect(changes).toContainText('転送省略があるため')
  })

  await test.step('実 A0 の年内登録を年初の存在と混同せず、A1 に別枝の人物を流用しない', async () => {
    await a0.getByText(/^年内の出来事（直接関与/).click()
    await a0.getByTestId(`comparison-event-${originalMarriage.eventId}`).click()
    const event = documents('event', originalMarriage.eventId).last()
    await reference(event, 'A0')
    const supporting = originalMarriage.involvedRefs.find(ref => ref.kind === 'PERSON')
    if (supporting?.kind !== 'PERSON') throw new Error('実 A0 の婚姻 Event に補助人物の参照がない')
    await expect(event).toBeVisible()
    await event.getByTestId(`document-link-person-${supporting.id}`).first().press('Enter')
    const absent = documents('person', supporting.id)
    await reference(absent, 'A0')
    await expect(absent).toContainText('年初に不在（NOT_PRESENT）')
    await expect(absent.getByText('技術詳細：人物の年初状態', { exact: true })).toHaveCount(0)
    await expect(absent).toBeVisible()
    await absent.getByRole('button', { name: '比較で絞る', exact: true }).press('Enter')
    await expect(a1).toContainText('対象は存在しません')
    await expect(a1.getByText('対象の年初状態（実値）', { exact: true })).toHaveCount(0)
    await expect(state).toContainText('両枝での比較はできません')
    await back(absent)
    await event.getByRole('button', { name: '資料を閉じる' }).press('Escape')
  })

  // 比較を閉じて元の資料を復元しても、背景の観測年は変更しない。
  await get('obs-year-slider').press('Home')
  await atYear(firstYear)
  await comparison.getByRole('button', { name: '元の調査へ戻る', exact: true }).press('Enter')
  await expect(comparison).toHaveCount(0)
  await atYear(firstYear)
  await reference(person.last(), 'A0')
  const restored = documents('trace', originalTrace.traceId).last()
  await reference(restored, 'A0')
  expect(await readRecord<DecisionTrace>(restored, /技術詳細（実判断: B-005 \/ DEFER）/)).toEqual(originalTrace)
  await expect(restored).toHaveAttribute('data-slot', 'work')
  await expect(person).toHaveAttribute('data-slot', 'fixed')
  const [workBox, fixedBox] = await Promise.all([restored.boundingBox(), person.boundingBox()])
  expect(workBox!.x + workBox!.width).toBeLessThan(fixedBox!.x)
  await expect(get('obs-goal')).toContainText('正式勝敗：未成立')

  await page.getByRole('button', { name: 'A0とA1の比較を開く', exact: true }).press('Enter')
  await expect(a0.getByRole('heading', { name: `A0・${year}年`, exact: true })).toBeVisible()
  await expect(a1.getByRole('heading', { name: `A1・${year}年`, exact: true })).toBeVisible()
  await expect(intervention).toHaveCount(0)
  await get('obs-seed-input').fill('2026010')
  await expect(comparison).toHaveCount(0)
  await get('obs-seed-input').fill(seed)
  await page.getByRole('button', { name: 'A0とA1の比較を開く', exact: true }).press('Enter')
  await expect(a1.getByRole('heading', { name: `A1・${year}年`, exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
