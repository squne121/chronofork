import {expect,test} from '@playwright/test'
import {writeFile,readFile} from 'node:fs/promises'

// DEC-106監査: 実際のA0を一度だけ計算し、画面の到達性と表示事実を収集する。
// これはUXの採否テストではない。検出した問題を隠さずJSONと画像に残す。
const enabled=process.env.CHRONOFORK_DEC106_AUDIT==='1'
test.describe('DEC-106: 原史の結末から遡る試遊可能性の証拠収集',()=>{
  test.skip(!enabled,'CHRONOFORK_DEC106_AUDIT=1 の明示指定時のみ実100年A0を実計算')
  test.setTimeout(15*60_000)

  test('原史の結果・称号・変化年・Event・Trace・内部ID露出を確認する',async({page},testInfo)=>{
    await page.setViewportSize({width:1280,height:900})
    await page.goto('/?run=legacy-integrated')
    const result:{
      revision:string; seed:number; viewport:string; checks:Record<string,unknown>; evidence:string[]
    }={revision:process.env.CHRONOFORK_AUDIT_REVISION??'working-tree',
      seed:20260101,viewport:'1280x900 and 960x900',checks:{},evidence:[]}
    const screenshot=async(name:string,fullPage=false)=>{
      await page.screenshot({path:testInfo.outputPath(name),fullPage})
      result.evidence.push(name)
    }
    const viewportPresence=async(locator:ReturnType<typeof page.getByTestId>)=>{
      return locator.evaluate(el=>{
        const b=el.getBoundingClientRect()
        return {top:Math.round(b.top),bottom:Math.round(b.bottom),
          viewport:window.innerHeight,inViewport:b.bottom>0&&b.top<window.innerHeight}
      })
    }

    result.checks['initial_debug_banner']={
      text:(await page.getByTestId('experimental-banner').innerText()).slice(0,260),
      display:'DEFAULT_VISIBLE'}
    result.checks['initial_goal_question']=(await page.getByTestId('observation-main').innerText()).slice(0,460)
    await screenshot('00-first-view.png')
    await page.getByTestId('obs-start').click()
    await expect(page.getByTestId('obs-year-label')).toContainText('1250年初',{timeout:12*60_000})
    const goal=page.getByTestId('obs-goal')
    result.checks['a0_goal']={text:(await goal.innerText()).slice(0,1150),position:await viewportPresence(goal)}
    result.checks['a0_history']={year:await page.getByTestId('obs-year-label').innerText(),
      yearHints:await page.getByTestId('obs-year-hints').getByRole('button').count()}
    await screenshot('01-a0-top.png')
    const sel=page.getByTestId('obs-title-select')
    await sel.selectOption('title-exp-central')
    const history=page.getByTestId('obs-title-history')
    await expect(history).toBeVisible()
    result.checks['title_history']={text:(await history.innerText()).slice(0,2600),
      position:await viewportPresence(history)}
    await screenshot('02-title-history.png')
    // 実年次移動。年Y内のEventとY+1年初の保持者を混同しない。
    const allYears=page.getByText('すべての年の記録件数を見る（Event・Trace）')
    await allYears.click()
    await page.getByRole('button',{name:/^1268年・事件/}).click()
    await expect(page.getByTestId('obs-year-label')).toContainText('1268年初',{timeout:90_000})
    const filter=page.getByTestId('obs-event-type')
    await filter.selectOption('LEGAL_TITLE_TRANSFER')
    const buttons=page.getByTestId('obs-event-list').getByRole('button')
    result.checks['title_transfer_year']={year:await page.getByTestId('obs-year-label').innerText(),
      eventButtons:await buttons.count(),items:(await page.getByTestId('obs-event-list').innerText()).slice(0,1300)}
    if(await buttons.count()){
      await buttons.first().click()
      const detail=page.getByTestId('obs-event-detail')
      result.checks['event_evidence']={text:(await detail.innerText()).slice(0,2000),
        linkedReasons:await page.getByTestId('obs-event-reasons').count()}
      await detail.scrollIntoViewIfNeeded()
      await screenshot('03-transfer-evidence.png')
      const reasonButton=detail.getByRole('button',{name:'根拠を詳しく見る'}).first()
      if(await reasonButton.count()){
        await reasonButton.click()
        result.checks['reason_drilldown']=(await page.getByTestId('obs-trace-detail').innerText()).slice(0,1000)
      }else result.checks['reason_drilldown']='NO_DIRECT_TRACE_LINK'
    }
    await page.getByRole('button',{name:/^1252年・事件/}).click()
    await expect(page.getByTestId('obs-year-label')).toContainText('1252年初',{timeout:90_000})
    await page.getByTestId('obs-event-type').selectOption('LEGAL_DYNASTY_SET')
    const events=await page.getByTestId('obs-event-list').innerText()
    result.checks['born_same_year_name']={
      items:events.slice(0,1800),rawInternalId:/person:|参照不明/.test(events+'\n'+await page.locator('main').innerText()),
      type:'LEGAL_DYNASTY_SET'}
    await page.getByTestId('obs-event-list').scrollIntoViewIfNeeded()
    await screenshot('04-name-evidence.png')
    await page.setViewportSize({width:960,height:900})
    await screenshot('05-960px.png')
    const file=testInfo.outputPath('dec106-evidence.json')
    await writeFile(file,JSON.stringify(result,null,2),'utf-8')
    console.info('DEC106_EVIDENCE='+JSON.stringify(result.checks))
    // 監査を実施したAIが実画面を確認できるように、2画像を分割してCIログへ出す。
    for(const name of ['01-a0-top.png','04-name-evidence.png']){
      const base64=(await readFile(testInfo.outputPath(name))).toString('base64')
      const parts=base64.match(/.{1,4096}/g)??[]
      parts.forEach((part,i)=>console.info('DEC106_IMAGE|'+name+'|'+i+'|'+parts.length+'|'+part))
    }
    expect(result.checks['a0_history']).toBeTruthy()
    // 客観的な回帰: 内部IDを出さない／原史の結果が初期表示の画面内にある。
    expect((result.checks['born_same_year_name'] as {rawInternalId:boolean}).rawInternalId).toBe(false)
    const goalCheck=result.checks['a0_goal'] as {text:string;position:{inViewport:boolean}}
    expect(goalCheck.text).toContain('正式勝敗：未成立')
    expect(goalCheck.position.inViewport).toBe(true)
    // 画像・JSONの保存に成功したことと、UXの合格を混同しない。
  })
})
