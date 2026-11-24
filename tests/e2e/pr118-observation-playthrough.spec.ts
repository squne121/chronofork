import {expect,test} from '@playwright/test'

// 旧統合の明示入口から: 原史A0を観測 → 人物を調べる → 1269年へ移動 → 介入・再計算 →
// 結果が初期視点で見つかり、1350年の技術Goal・TERRITORIAL Title・CONTROL_MANDATEを画面から確認する。
// 技術検証であり正式勝敗ではない。正解値のヒントはUIへ埋め込まず、試験側の入力としてのみ使う。
const heavy=process.env.CHRONOFORK_E2E_INTEGRATED==='1'
test.describe('PR #118 観測→介入→結果比較の通し試験（opt-in）',()=>{
  test.skip(!heavy,'CHRONOFORK_E2E_INTEGRATED=1で100年A0とA1を実計算する')
  test.setTimeout(30*60_000)

  test('旧統合入口で原史A0観測→人物調査→1269年へ移動→介入→1350年の技術Goalまで画面で確認',async({page})=>{
    await page.setViewportSize({width:1280,height:800})
    await page.goto('/?run=legacy-integrated')
    await page.getByTestId('obs-start').click()
    await expect(page.getByTestId('obs-year-label')).toContainText('1250年初',{timeout:12*60_000})
    await expect(page.getByTestId('obs-future-ending')).toContainText('原史A0')

    // 任意の年へ移動できる: 年候補リスト。
    await page.getByText('すべての年の記録件数を見る（Event・Trace）').click()
    await page.getByRole('button',{name:/^1269年/}).click()
    await expect(page.getByTestId('obs-year-label')).toContainText('1269年初',{timeout:90_000})
    // 既存スライダーでも前後に動かせる(キーボード)。戻して1269年へ。
    await page.locator('#obs-year').focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('obs-year-label')).toContainText('1270年初',{timeout:90_000})
    // 観測取得中はスライダーが無効化されフォーカスが外れるため、再度フォーカスして操作する。
    await page.locator('#obs-year').focus()
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByTestId('obs-year-label')).toContainText('1269年初',{timeout:90_000})

    // 人物を調べる（1251年生まれ）。
    const opt=page.getByTestId('obs-person').locator('option',{hasText:'1251年生'}).first()
    const personId=await opt.getAttribute('value')
    expect(personId).toBeTruthy()
    await page.getByTestId('obs-person').selectOption(personId!)
    await expect(page.getByTestId('family-tree')).toBeVisible()
    await page.getByTestId('obs-to-intervention').click()
    await expect(page.getByTestId('branch-fork-year')).toHaveValue('1269')

    await page.getByTestId('branch-person-two').selectOption('person:experimental-census:east-cardon-1249')
    await page.getByTestId('branch-trust-delta').fill('-200')
    await page.getByTestId('branch-duration').fill('60')
    await page.getByTestId('branch-run').click()
    await expect(page.getByTestId('branch-results')).toBeVisible({timeout:20*60_000})

    // 再計算成功後、スクロール操作なしでA0/A1の結果と技術Goalが初期ビューポートに見える。
    const goalLine=page.getByTestId('effect-goal-line')
    await expect(goalLine).toBeInViewport({timeout:10_000})
    await expect(goalLine).toContainText('A0 条件に不一致（技術検証）')
    await expect(goalLine).toContainText('A1 条件に一致（技術検証）')
    await expect(page.getByTestId('effect-summary')).toBeInViewport({ratio:0.1})
    await expect(page.getByTestId('goal-status')).toContainText('正式な勝敗は未成立')

    // 詳細: 1350年のTERRITORIAL(中央世襲所領)の判定根拠。
    await goalLine.getByRole('button',{name:'判定の詳細へ移動'}).click()
    await expect(page.getByTestId('trial-goal-a1')).toBeInViewport()
    await page.getByTestId('trial-goal-summary').locator('summary',{hasText:'中央世襲所領'}).click()
    await expect(page.getByTestId('trial-goal-reasons-a1')).toContainText('中央世襲所領は条件に一致')

    // CONTROL_MANDATE（統治委任の設定）がA1にだけ記録されている。
    const list=page.getByTestId('integrated-list-mandate')
    await list.scrollIntoViewIfNeeded()
    await list.locator('summary').click()
    const a1Only=list.locator('p',{hasText:'A1で追加'}).locator('xpath=following-sibling::ul[1]').getByRole('button').first()
    await expect(a1Only).toBeVisible()
  })
})
