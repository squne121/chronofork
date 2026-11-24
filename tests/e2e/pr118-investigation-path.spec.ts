import {expect,test} from '@playwright/test'

// 画面の記録から候補を辿り、その人物と年を使って実A1を計算・比較する。
const heavy=process.env.CHRONOFORK_E2E_INTEGRATED==='1'
test.describe('PR #118 理由を調べて介入へ進む探索経路（opt-in）',()=>{
  test.skip(!heavy,'CHRONOFORK_E2E_INTEGRATED=1で100年A0を実計算する')
  test.setTimeout(30*60_000)

  test('終点の不足から喪失記録・人物履歴・婚姻候補の理由を画面だけで辿り、候補の2人を介入フォームへ渡せる',async({page})=>{
    await page.setViewportSize({width:1280,height:900})
    page.setDefaultTimeout(60_000)
    await page.goto('/?run=legacy-integrated')
    await page.getByTestId('obs-start').click()
    await expect(page.getByTestId('obs-year-label')).toContainText('1250年初',{timeout:12*60_000})

    // 終点の不足 → 保持者を失った称号の記録。年・人物は画面の実記録から選ぶ。
    const loss=page.getByTestId('obs-loss-records')
    await expect(loss).toBeVisible()
    await loss.getByTestId('obs-loss-person').first().click()
    await expect(page.getByTestId('person-history')).toBeVisible({timeout:90_000})
    await expect(page.getByTestId('history-no-birth-judgment')).toContainText('判断の対象外')
    await expect(page.getByTestId('history-judgments')).toContainText('きょうだい')
    await expect(page.getByTestId('history-judgments')).toContainText('共通の祖先が2世代以内')
    // 死亡の年の翌年初は、選択人物にも打消し線が付く。
    await page.getByRole('button',{name:'翌年',exact:true}).click()
    await expect(page.getByTestId('family-tree').locator('.ft-self.ft-dead')).toBeVisible({timeout:90_000})

    const lostPerson=await page.getByTestId('obs-person').inputValue()
    for(const width of [1280,960]){
      await page.setViewportSize({width,height:900})
      const year=Number((await page.getByTestId('obs-year-label').innerText()).match(/\d+/)![0])
      await page.getByRole('button',{name:'前年',exact:true}).click()
      await expect(page.getByTestId('obs-year-label')).toHaveText(`${year-1}年初`,{timeout:90_000})
      await expect(page.getByTestId('obs-person')).toHaveValue(lostPerson)
      const titleEntry=page.getByTestId('history-titles').locator('li').first()
      const titleYear=(await titleEntry.innerText()).match(/(\d{4})(?:〜\d{4})?年初/)![1]
      await titleEntry.getByRole('button').click()
      await expect(page.getByTestId('obs-year-label')).toHaveText(`${titleYear}年初`,{timeout:90_000})
      await expect(page.getByTestId('obs-context-line')).toContainText(`${titleYear}年初`)
      await expect(page.getByTestId('obs-title-history')).toBeVisible()
      const ctx=await page.getByTestId('obs-context-line').innerText()
      await page.getByTestId('obs-tab-world').click()
      await expect(page.getByTestId('obs-context-line')).toHaveText(ctx)
      await expect(page.getByTestId('region-map')).toBeVisible()
      await expect(page.getByTestId('person-history')).toBeHidden()
      await page.getByTestId('obs-tab-investigate').click()
      await expect(page.getByTestId('obs-context-line')).toHaveText(ctx)
      await expect(page.getByTestId('obs-title-history')).toBeVisible()
      await page.getByTestId('history-parents').getByRole('button').first().click()
      await expect(page.getByTestId('obs-person')).not.toHaveValue(lostPerson,{timeout:90_000})
      await expect(page.getByTestId('history-judgments')).toContainText('親の年齢が出生判定の対象範囲外')
      await page.getByTestId('obs-person').selectOption(lostPerson)
      await expect(page.getByTestId('obs-person')).toHaveValue(lostPerson)
      await expect(page.getByTestId('history-no-birth-judgment')).toContainText('判断の対象外')
    }

    // 両親へ移動すると、別人へ黙って切り替わらず、親の婚姻・出生判断の理由を読める。
    const before=await page.getByTestId('obs-person').inputValue()
    await page.getByTestId('history-parents').getByRole('button').first().click()
    await expect(page.getByTestId('obs-person')).not.toHaveValue(before,{timeout:90_000})
    await expect(page.getByTestId('history-judgments')).toContainText('親の年齢が出生判定の対象範囲外')

    // 調査した親の候補だけを使い、リンクの年と画面の人物ペアを引き継ぐ。
    const person=await page.getByTestId('obs-person').inputValue()
    const partner=page.getByTestId('history-partner').filter({has:page.getByTestId('history-intervene-pair')}).first()
    await expect(partner).toHaveCount(1)
    await partner.locator('> summary').click()
    const intervene=partner.getByTestId('history-intervene-pair')
    await expect(intervene).toBeVisible()
    const year=(await intervene.innerText()).match(/(\d{4})年/)![1]
    const partnerName=(await partner.locator('> summary').evaluate(el=>el.firstChild?.textContent ?? '')).trim()
    const option=page.getByTestId('obs-person').locator('option').filter({hasText:partnerName})
    await expect(option).toHaveCount(1)
    const partnerId=await option.getAttribute('value')
    expect(partnerId).toBeTruthy()
    const judgment=partner.locator('li').filter({hasText:'婚姻候補の判断（B-004）'})
      .filter({has:page.getByTestId('history-open-trace').filter({hasText:`${year}年の判断記録を開く`})})
    await expect(judgment).toHaveCount(1)
    await judgment.getByTestId('history-open-trace').click()
    const trace=page.getByTestId('obs-trace-detail')
    await expect(trace).toContainText('規則 B-004')
    await expect(page.getByTestId('obs-year-label')).toHaveText(`${year}年初`)
    const traceStatus=(await trace.innerText()).match(/規則 B-004（(ACCEPT|REJECT|DEFER)）/)![1]
    await intervene.click()
    await expect(page.getByTestId('branch-fork-year')).toHaveValue(year)
    await expect(page.getByTestId('branch-person-one')).toHaveValue(person)
    await expect(page.getByTestId('branch-person-two')).toHaveValue(partnerId!)
    await expect(page.getByTestId('branch-run')).toBeEnabled()
    await page.getByTestId('branch-run').click()
    await expect(page.getByTestId('branch-results')).toBeVisible({timeout:20*60_000})
    await expect(page.getByTestId('effect-input')).toContainText(`${year}年から`)
    await expect(page.getByTestId('effect-judgement')).toContainText(`対象の判断（${year}年）`)
    await expect(page.getByTestId('effect-judgement')).toContainText(`A0 ${traceStatus}`)
    await expect(page.getByTestId('effect-judgement')).toContainText(/ → A1 /)
    await expect(page.getByTestId('branch-snapshot-a0')).toBeVisible()
    await expect(page.getByTestId('branch-snapshot-a1')).toBeVisible()
    await expect(page.getByTestId('effect-goal-line')).toContainText(/A0 .*A1 /)
    await page.setViewportSize({width:1280,height:900})
    await expect(page.getByTestId('effect-input')).toContainText(`${year}年から`)
    await expect(page.getByTestId('effect-judgement')).toContainText(`A0 ${traceStatus}`)
    await expect(page.getByTestId('effect-goal-line')).toBeVisible()
    await expect(page.getByTestId('branch-snapshot-a0')).toBeVisible()
    await expect(page.getByTestId('branch-snapshot-a1')).toBeVisible()
    console.log('実画面の介入・比較', JSON.stringify({
      year, person, partnerId, partnerName,
      personName:await page.getByTestId('branch-person-one').locator('option:checked').innerText(),
      input:await page.getByTestId('effect-input').innerText(),
      judgment:await page.getByTestId('effect-judgement').innerText(),
      goal:await page.getByTestId('effect-goal-line').innerText(),
    }))
  })
})
