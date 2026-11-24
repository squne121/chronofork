import {expect,test} from '@playwright/test'

// 実100年A0を一度だけ計算し、出生Event→翌年初の人物と王位/国家統治者の表示を確認。
const heavy=process.env.CHRONOFORK_E2E_INTEGRATED==='1'
test.describe('PR #118 統合後の王位・国家統治者と出生人物導線（opt-in）',()=>{
  test.skip(!heavy,'CHRONOFORK_E2E_INTEGRATED=1で100年A0を実計算する')
  test.setTimeout(15*60_000)

  test('実WorldStateを根拠に出生→翌年の人物、王位移転、国家統治者更新/未確定を辿る',async({page})=>{
    await page.setViewportSize({width:1280,height:900})
    await page.goto('/?run=legacy-integrated')
    await page.getByTestId('obs-start').click()
    await expect(page.getByTestId('obs-year-label')).toContainText('1250年初',{timeout:12*60_000})

    // 新ID世界の1251年に実記録された出生は、1251年初にはまだ存在しない。
    await page.getByRole('button',{name:'翌年',exact:true}).click()
    await expect(page.getByTestId('obs-year-label')).toContainText('1251年初',{timeout:90_000})
    await page.getByTestId('obs-event-type').selectOption('PERSON_BIRTH')
    const birth=page.getByTestId('obs-event-list').locator('button',{hasText:'生まれた'}).first()
    await expect(birth).toBeVisible()
    await birth.click()
    const next=page.locator('[data-testid^="obs-newborn-next-year-"]').first()
    await expect(next).toBeVisible()
    const testId=await next.getAttribute('data-testid')
    if(!testId?.startsWith('obs-newborn-next-year-'))throw new Error('BIRTH_LINK_NOT_EVIDENCED')
    const childId=testId.slice('obs-newborn-next-year-'.length)
    await expect(next).toContainText('1252年初')
    await next.click()
    await expect(page.getByTestId('obs-year-label')).toContainText('1252年初',{timeout:90_000})
    await expect(page.getByTestId('obs-person')).toHaveValue(childId)
    await expect(page.getByTestId('family-tree')).toBeVisible()

    // 同じA0キャッシュから年次を移動する。1268年の実死亡後、称号保持者と国家統治者は別々のEvent。
    await page.getByText('すべての年の記録件数を見る（Event・Trace）').click()
    await page.getByRole('button',{name:/^1268年・事件/}).click()
    await expect(page.getByTestId('obs-year-label')).toContainText('1268年初',{timeout:90_000})
    const eventType=page.getByTestId('obs-event-type')
    const eventList=page.getByTestId('obs-event-list')
    const eventDetail=page.getByTestId('obs-event-detail')
    const rulerUpdate=eventList.getByRole('button',{name:'エルディアの統治者記録が試験人物02に更新（1268年）',exact:true})
    await eventType.selectOption('COUNTRY_RULER_SET')
    await expect(eventList.getByRole('button',{name:/の保持者が/})).toHaveCount(0)
    await rulerUpdate.click()
    await expect(eventDetail.locator('summary')).toContainText('COUNTRY_RULER_SET')
    await expect(eventDetail.getByText('変更前の統治者: 試験人物01',{exact:true})).toBeVisible()
    await expect(eventDetail.getByText('変更後: 試験人物02',{exact:true})).toBeVisible()

    await eventType.selectOption('LEGAL_TITLE_TRANSFER')
    await expect(rulerUpdate).toHaveCount(0)
    const crown='エルディア王位（王冠称号）'
    const territory='エルディア中央の領主権（領地称号）'
    for(const {title,after} of [{title:crown,after:'試験人物02'},{title:territory,after:'未確定'}]){
      const headline=`${title}の保持者が試験人物01から${after}に変更（1268年）`
      await eventList.getByRole('button',{name:headline,exact:true}).click()
      await expect(eventDetail.getByRole('heading',{name:headline,exact:true})).toBeVisible()
      await expect(eventDetail.locator('summary')).toContainText('LEGAL_TITLE_TRANSFER')
      await expect(eventDetail.getByText(`対象称号: ${title}`,{exact:true})).toBeVisible()
      await expect(eventDetail.getByText('変更前の保持者: 試験人物01',{exact:true})).toBeVisible()
      const afterDetail=after==='未確定'?'未確定（後継者を推定しません）':after
      await expect(eventDetail.getByText(`変更後の保持者: ${afterDetail}`,{exact:true})).toBeVisible()
    }

    // 1272年のマルガルドにはCROWNがない。死者ruler参照の解除は継承の成立ではない。
    await page.getByRole('button',{name:/^1272年・事件/}).click()
    await expect(page.getByTestId('obs-year-label')).toContainText('1272年初',{timeout:90_000})
    await eventType.selectOption('COUNTRY_RULER_VACATE')
    await expect(eventList.getByRole('button',{name:/の保持者が/})).toHaveCount(0)
    await eventList.getByRole('button',{name:'マルガルドの統治者記録が未確定になった（1272年）',exact:true}).click()
    await expect(eventDetail.locator('summary')).toContainText('COUNTRY_RULER_VACATE')
    await expect(eventDetail.getByText('変更前の統治者: 試験人物08',{exact:true})).toBeVisible()
    await expect(eventDetail.getByText('変更後: 未確定（後継者を推定しません）',{exact:true})).toBeVisible()
    await expect(page.getByTestId('obs-goal')).toContainText('正式勝敗：未成立')
  })
})
