"""Run with the portfolio served on localhost:8140; requires Python Playwright."""
from playwright.sync_api import sync_playwright
import json,os
base_url=os.environ.get('AI_STUDIO_URL', 'http://localhost:8140/labs/ai/').rstrip('/')+'/'
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1080},device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base_url)
    page.wait_for_selector('.case[aria-current=true]')
    assert page.locator('#result-count').inner_text()=='68 / 68'
    assert sum(int(v) for v in page.locator('.domain-bar b').all_text_contents())==68
    assert all(int(v)>0 for v in page.locator('.domain-bar b').all_text_contents())
    assert 'cs-001' in page.url
    page.screenshot(path='/tmp/ai-studio-desktop.png',full_page=True)
    page.locator('#tab-pair').click()
    assert page.locator('.pair-card').count()==2
    page.locator('[data-select="cs-002"]').click()
    assert 'item=cs-002' in page.url
    page.locator('#tab-pair').focus();page.keyboard.press('ArrowRight')
    assert page.locator('#tab-rubric').get_attribute('aria-selected')=='true'
    page.locator('.concepts summary').click()
    assert 'eliminat' in page.locator('.concepts').inner_text()
    with page.expect_download() as downloaded:page.locator('#export').click()
    brief=json.loads(open(downloaded.value.path()).read())
    assert brief['item']['id']=='cs-002'
    assert brief['paired_item']['id']=='cs-001'
    assert brief['provenance']['commit']=='b6debdd9e76aedaa658ec18ad40f9d2df896ce16'
    assert len(brief['source_verification']['records'])==2
    assert '/on/2026-08-01/' in brief['dated_sources'][0]['url']
    assert brief['inspection_context']['view']=='rubric'
    assert len(brief['inspection_context']['matching_cases'])==68
    page.locator('#search').fill('zx-no-cases')
    assert page.locator('#result-count').inner_text()=='0 / 68'
    assert page.locator('#export').count()==0
    page.locator('#reset-list').click()
    page.locator('#type').select_option('category_error')
    assert page.locator('#result-count').inner_text()=='5 / 68'
    page.locator('#tab-evidence').click()
    assert 'REJECT THE PREMISE' in page.locator('.reference').inner_text()
    page.locator('#paired').check()
    assert page.locator('#result-count').inner_text()=='0 / 68'
    page.locator('#reset-list').click()
    page.locator('[data-domain="confined_space"]').click()
    assert page.locator('#result-count').inner_text()=='8 / 68'
    page.goto(base_url+'?item=cs-004&tab=evidence')
    page.wait_for_selector('.evidence-foot')
    assert 'Anchor found in source section' in page.locator('.evidence-foot').inner_text()
    assert '/on/2026-08-01/' in page.locator('.evidence-top a').get_attribute('href')
    page.goto(base_url+'?item=cs-001&tab=pair&domain=confined_space')
    page.wait_for_selector('.pair-card')
    assert page.locator('#domain').input_value()=='confined_space'
    assert page.locator('.case[aria-current=true]').get_attribute('data-item')=='cs-001'
    page.locator('#search').fill('cs-001')
    page.locator('#tab-pair').click()
    page.locator('[data-select="cs-002"]').click()
    assert page.locator('.case[aria-current=true]').get_attribute('data-item')=='cs-002'
    assert page.locator('#search').input_value()==''
    page.locator('[data-step="1"]').click()
    assert page.locator('.case[aria-current=true]').get_attribute('data-item')=='cs-003'
    page.locator('[data-start="prd-010"]').click()
    assert page.locator('.case[aria-current=true]').get_attribute('data-item')=='prd-010'
    assert 'REJECT THE PREMISE' in page.locator('.reference').inner_text()
    page.set_viewport_size({'width':390,'height':844})
    page.goto(base_url+'?item=cs-001&domain=confined_space')
    page.wait_for_selector('.case[aria-current=true]')
    assert not page.locator('.coverage').evaluate('(el)=>el.open')
    page.locator('[data-item="cs-002"]').click()
    assert page.locator('#case-inspector').bounding_box()['y']<25
    assert page.locator('.inspector-mobilebar').is_visible()
    page.evaluate('window.scrollBy(0,600)')
    assert abs(page.locator('.inspector-mobilebar').bounding_box()['y'])<2
    page.locator('[data-return]').click()
    assert page.locator('#domain').input_value()=='confined_space'
    assert page.locator('.case[aria-current=true]').get_attribute('data-item')=='cs-002'
    assert page.locator('#case-browser').bounding_box()['y']>=0
    page.locator('[data-start="cs-001"]').click()
    assert page.locator('#case-inspector').bounding_box()['y']<25
    page.evaluate('window.scrollTo(0,0)')
    assert page.locator('body').evaluate('(el)=>el.scrollWidth<=innerWidth')
    page.screenshot(path='/tmp/ai-studio-mobile.png',full_page=True)
    page.locator('#tab-evidence').click()
    assert page.locator('body').evaluate('(el)=>el.scrollWidth<=innerWidth')
    page.set_viewport_size({'width':320,'height':700})
    assert page.locator('body').evaluate('(el)=>el.scrollWidth<=innerWidth')
    assert not errors,errors
    print('Passed: loading, selection, pair navigation, keyboard tabs, export content, empty states, composed filters, source locality, dated citations, deep links, 390/320px overflow. No browser errors.')
    browser.close()
