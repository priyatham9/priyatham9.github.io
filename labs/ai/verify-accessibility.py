"""WCAG 2 AA state audit. Pass a local axe.min.js path as the first argument."""
from playwright.sync_api import sync_playwright
import json,sys,os
if len(sys.argv) != 2:
    raise SystemExit('Usage: python verify-accessibility.py /path/to/axe.min.js')
axe_path=sys.argv[1]
base_url=os.environ.get('AI_STUDIO_URL', 'http://localhost:8140/labs/ai/').rstrip('/')+'/'
results=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
    for width in [1440,390,320]:
        page=browser.new_page(viewport={'width':width,'height':1000})
        for state in ['evidence','pair','rubric','category','empty']:
            query='?item=prd-010' if state=='category' else '?item=cs-001&tab='+('evidence' if state=='empty' else state)
            page.goto(base_url+query)
            page.wait_for_selector('.case[aria-current=true]')
            if state=='rubric':page.locator('.concepts summary').click()
            if state=='empty':page.locator('#search').fill('no-matching-case-xxxxx')
            page.add_script_tag(path=axe_path)
            audit=page.evaluate("async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));}")
            results.append({'width':width,'state':state,'violations':audit})
        page.close()
    browser.close()
print(json.dumps(results,indent=2))
assert all(not r['violations'] for r in results),'Accessibility violations found'
