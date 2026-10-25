"""Browser integration checks against a running server; isolated browser storage."""
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:8000')
args = parser.parse_args()
BASE = args.base_url.rstrip('/')
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'test-results'
OUT.mkdir(exist_ok=True)
results = {'passed': [], 'layouts': [], 'page_errors': []}

def ok(message):
    results['passed'].append(message)
    print('PASS:', message, flush=True)

def snapshot(page):
    return page.evaluate("JSON.parse(localStorage.getItem('chef.workspace.v2'))")

def goto(page, route):
    page.goto(BASE+'/index.html#'+route, wait_until='networkidle')
    page.wait_for_function('(route)=>document.body.dataset.view===route', arg=route)

def accept_confirmation(page):
    page.locator('#confirmAccept').click()
    page.locator('#confirmDialog').wait_for(state='hidden')

def import_data(page, document):
    page.locator('#fileInput').set_input_files({'name': 'menu.json', 'mimeType': 'application/json', 'buffer': json.dumps(document, ensure_ascii=False).encode()})
    page.locator('#importDialog').wait_for()
    assert page.locator('#acceptImport').is_enabled()
    page.locator('#acceptImport').click()
    if page.locator('#confirmDialog').is_visible(): accept_confirmation(page)
    page.locator('#importDialog').wait_for(state='hidden')
    page.wait_for_function('document.body.dataset.view==="overview"')

def timer_fixture():
    recipes = []
    for suffix, portions in [('a', 2), ('b', 3)]:
        recipes.append({'id': 'meal-'+suffix, 'revision': 1, 'name': 'Testgericht '+suffix.upper(), 'baseServings': portions,
            'ingredients': [{'id': 'onion', 'foodId': 'onion', 'name': 'Zwiebel', 'quantity': {'kind':'exact','value':100,'unit':'g'}}],
            'tasks': [
                {'id':'wait','instruction':'Garzustand '+suffix.upper()+' prüfen','phase':'cook','mode':'passive','duration':{'seconds':60,'scaling':'fixed'},'dependsOn':[],'uses':[]},
                {'id':'pack','instruction':'Gericht '+suffix.upper()+' portionieren','phase':'pack','mode':'active','duration':{'seconds':30,'scaling':'fixed'},'dependsOn':['wait'],'uses':[]}
            ],
            'reservations':[{'id':'pot','kind':'pot','units':1,'fromTask':'wait','throughTask':'pack'}],
            'storage':{'freezable':True,'notes':['Hinweis aus Testdaten']},
            'packaging':{'containersPerServing':1,'separateComponents':['Sauce'] if suffix=='a' else []}})
    return {'schemaVersion':'2.0','title':'Testmenü','recipes':recipes,
        'selection':[{'recipeId':r['id'],'servings':r['baseServings']} for r in recipes],
        'kitchen':{'cooks':1,'resources':[{'id':'pot-1','kind':'pot','capacity':1},{'id':'pot-2','kind':'pot','capacity':1}]}}

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHEF_CHROMIUM', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':390,'height':844}, timezone_id='Europe/Zurich')
    page = context.new_page()
    page.on('pageerror', lambda error: results['page_errors'].append(str(error)))
    goto(page, 'overview')
    assert page.locator('.recipe').count() == 3
    page.evaluate('window.scrollTo(0,0)')
    page.screenshot(path=str(OUT/'overview-iphone.png'), full_page=True)
    page.locator('[data-action="portion"][data-id="tuerkische-haehnchen-bowl"][data-delta="1"]').click()
    page.wait_for_function("JSON.parse(localStorage.getItem('chef.workspace.v2')).current.document.selection[0].servings===6")
    assert snapshot(page)['current']['document']['selection'][1]['servings'] == 5
    ok('Three recipes load; portions change independently')
    assert page.locator('.navigation a').count() == 4
    assert not page.locator('[data-action="kitchen"]').count()
    assert not page.get_by_role('link',name='Einkauf',exact=True).count()
    page.locator('.navigation a[href="#cook"]').click()
    page.wait_for_function('document.body.dataset.view==="cook"')
    assert page.locator('.navigation a[aria-current="page"]').inner_text() == 'Kochmodus'
    assert not page.locator('#cookStepsDialog').is_visible()
    page.locator('[data-action="cook-steps"]').click()
    page.locator('#cookStepsContent').evaluate('(e)=>e.scrollTop=200')
    assert page.locator('#cookStepsContent').evaluate('(e)=>e.scrollTop')>0
    assert page.evaluate('window.scrollY')==0
    page.locator('[data-close="cookStepsDialog"]').click()
    page.locator('.navigation a[href="#overview"]').click()
    page.wait_for_function('document.body.dataset.view==="overview"')
    ok('Four navigation destinations work without shopping or kitchen setup')
    one_pot = snapshot(page)['current']['document']
    one_pot['kitchen']['resources'] = [r for r in one_pot['kitchen']['resources'] if r['kind']!='pot' or r['id']=='pot-1']
    import_data(page, one_pot)
    goto(page, 'plan')
    assert page.locator('.schedule-list>li').count() > 30
    assert not page.get_by_text('Kein ausführbarer Ablauf gefunden', exact=False).count()
    ok('Imported equipment still produces a valid one-pot plan without a setup dialog')
    goto(page, 'cook')
    assert not snapshot(page)['current']['checks']['ready']
    assert not snapshot(page)['current']['checks']['equipment']
    page.locator('[data-action="start-task"]').click()
    page.locator('[data-action="complete-task"]').wait_for()
    assert not snapshot(page)['current']['session']['timers']
    page.locator('[data-action="start-timer"]').click()
    page.locator('.timer-chip').wait_for()
    assert not page.locator('#confirmDialog').is_visible()
    assert not snapshot(page)['current']['checks']['ready']
    initial = snapshot(page)['current']['session']
    timer_id = next(iter(initial['timers']))
    page.locator('[data-action="following-task"]').click()
    assert snapshot(page)['current']['session']==initial
    page.locator('[data-action="previous-task"]').click()
    assert snapshot(page)['current']['session']==initial
    page.locator('.cook-options > summary').click()
    ok('Back and next only browse; starting a step does not start a timer until explicitly requested')
    page.locator('[data-action="adjust-timer"][data-seconds="60"]').click()
    page.wait_for_timeout(100)
    deadline = snapshot(page)['current']['session']['timers'][timer_id]['endsAt']
    assert deadline == initial['timers'][timer_id]['endsAt']+60000
    page.locator('.timer-chip').focus()
    page.wait_for_timeout(1200)
    assert page.evaluate('document.activeElement.classList.contains("timer-chip")')
    ok('Timer extension preserves deadline arithmetic; timer rail retains keyboard focus')
    assert page.locator('.timeline-step').count()>30
    assert page.locator('.timeline-step[style*="linear-gradient"]').count()>=1
    active=page.locator('.timeline-step[data-pulsing="true"] .timeline-dash')
    assert active.count()==1
    assert active.evaluate('(e)=>getComputedStyle(e).animationName')=='timeline-pulse'
    page.emulate_media(reduced_motion='reduce')
    assert active.evaluate('(e)=>getComputedStyle(e).animationName')=='none'
    page.emulate_media(reduced_motion='no-preference')
    sequence=page.locator('.timeline-step').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.id)')
    page.locator('.cook-timeline').evaluate('(e)=>e.scrollLeft=120')
    scroll_left=page.locator('.cook-timeline').evaluate('(e)=>e.scrollLeft')
    page.locator('[data-action="adjust-timer"][data-seconds="-60"]').click()
    page.wait_for_timeout(100)
    assert abs(page.locator('.cook-timeline').evaluate('(e)=>e.scrollLeft')-scroll_left)<2
    page.locator('[data-action="adjust-timer"][data-seconds="60"]').click()
    page.locator('.timeline-step').last.click()
    assert page.locator('.timeline-step').last.get_attribute('aria-current')=='step'
    page.locator('[data-action="next-ready"]').click()
    assert snapshot(page)['current']['session']['timers'][timer_id]['endsAt']==deadline
    assert page.locator('.timeline-step').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.id)')==sequence
    ok('Colored timeline opens steps, combines recipe colors, preserves horizontal position and honors reduced motion')
    page.goto(BASE+'/kochmodus.html#mise', wait_until='networkidle')
    assert snapshot(page)['current']['session']['timers'][timer_id]['endsAt'] == deadline
    assert not snapshot(page)['current']['checks']['ready']
    goto(page, 'cook')
    page.reload(wait_until='networkidle')
    assert snapshot(page)['current']['session']['timers'][timer_id]['endsAt'] == deadline
    assert page.locator('.timer-chip').count() == 1
    page.evaluate('window.scrollTo(0,0)')
    page.screenshot(path=str(OUT/'cooking-iphone.png'))
    ok('Preparation compatibility URL, view changes and reload retain progress and timers')
    before = page.evaluate("localStorage.getItem('chef.workspace.v2')")
    page.locator('#fileInput').set_input_files({'name':'invalid.json','mimeType':'application/json','buffer':b'{"schemaVersion":"2.0"}'})
    page.locator('#importDialog').wait_for()
    assert page.locator('#acceptImport').is_disabled()
    assert page.evaluate("localStorage.getItem('chef.workspace.v2')") == before
    page.locator('[data-close="importDialog"]').click()
    ok('Invalid import gives a reviewable error and preserves the entire previous snapshot')
    data = timer_fixture()
    data['recipes'][0]['name']='<img src=x onerror="window.CHEF_PWNED=true">'
    import_data(page, data)
    assert page.locator('#viewRoot img').count() == 0
    assert page.evaluate('window.CHEF_PWNED===undefined')
    assert '<img' in page.locator('.recipe h2').first.inner_text()
    ok('Imported names render as text rather than executable HTML')
    data = timer_fixture()
    import_data(page, data)
    goto(page, 'prep'); page.locator('[data-action="all-ready"]').click()
    page.clock.install(time=datetime(2026,10,24,12,tzinfo=timezone.utc))
    goto(page, 'cook')
    timeline_order=page.locator('.timeline-step').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.id)')
    assert page.locator('.timeline-step[data-state="pending"]').count()==4
    assert page.locator('.timeline-step[data-id="meal-a/wait"]').evaluate('(e)=>getComputedStyle(e).getPropertyValue("--step-fill")')!=page.locator('.timeline-step[data-id="meal-b/wait"]').evaluate('(e)=>getComputedStyle(e).getPropertyValue("--step-fill")')
    page.locator('[data-action="cook-steps"]').click()
    page.locator('#cookStepsContent [data-action="select-task"][data-id="meal-a/wait"]').click()
    assert not page.locator('#cookStepsDialog').is_visible()
    page.locator('[data-action="start-timer"]').click()
    page.locator('[data-action="cook-steps"]').click()
    page.locator('#cookStepsContent [data-action="select-task"][data-id="meal-b/wait"]').click()
    page.locator('[data-action="start-timer"]').click()
    page.locator('.timer-chip').nth(1).wait_for()
    assert page.locator('.timer-chip').count() == 2
    assert page.locator('.timeline-step[data-pulsing="true"]').count()==2
    assert page.url.endswith('#cook')
    page.locator('[data-action="cook-steps"]').click()
    page.clock.fast_forward(61000)
    page.locator('#alarmDialog').wait_for()
    assert not page.locator('#cookStepsDialog').is_visible()
    assert page.locator('.timeline-step[data-state="elapsed"]').count()==2
    assert page.locator('.timeline-step[data-pulsing="true"]').count()==0
    first_title = page.locator('#alarmTitle').inner_text()
    page.locator('#ackTimer').click()
    page.wait_for_function("Object.values(JSON.parse(localStorage.getItem('chef.workspace.v2')).current.session.timers).filter(t=>t.state==='elapsed').length===1")
    page.wait_for_timeout(100)
    assert page.locator('#alarmDialog').is_visible()
    assert page.locator('#alarmTitle').inner_text() != first_title
    page.locator('#ackTimer').click()
    page.locator('#alarmDialog').wait_for(state='hidden')
    assert snapshot(page)['current']['session']['tasks']['meal-a/wait']['status'] == 'elapsed'
    assert page.locator('.timeline-step[data-state="completed"]').count()==0
    goto(page, 'finish')
    assert page.get_by_role('heading',name='Es sind noch Schritte offen.').is_visible()
    ok('Two simultaneous alarms are acknowledged individually; elapsed timers do not finish the meal')
    for suffix in ['a','b']:
        goto(page, 'plan')
        page.locator(f'#viewRoot [data-action="select-task"][data-id="meal-{suffix}/wait"]').click()
        page.locator('[data-action="complete-task"]').click()
        if suffix=='a':
            assert page.locator('.timeline-step[data-id="meal-a/wait"]').get_attribute('data-state')=='completed'
            assert page.locator('.timeline-step').evaluate_all('(nodes)=>nodes.map(e=>e.dataset.id)')==timeline_order
            assert page.locator('.timeline-step[data-id="meal-b/wait"]').get_attribute('data-state')=='elapsed'
        page.locator('[data-action="start-task"]').click()
        page.locator('[data-action="complete-task"]').click()
    page.wait_for_function('document.body.dataset.view==="finish"')
    assert page.get_by_role('heading',name='Gut gekocht. Gut vorbereitet.').is_visible()
    page.locator('[data-pack-mass]').first.fill('500')
    page.locator('[data-pack-mass]').first.press('Tab')
    page.wait_for_timeout(100)
    assert '250 g' in page.locator('#viewRoot').inner_text()
    assert '5 Hauptbehälter' in page.locator('#viewRoot').inner_text()
    assert 'Keine geprüfte Kühlschrankdauer' in page.locator('#viewRoot').inner_text()
    ok('Full task flow finishes explicitly and calculates boxes and measured portion weights')
    ok('Parallel timeline timers pulse independently; acknowledgement stays distinct from completed steps and order stays stable')
    goto(page, 'overview')
    page.locator('details.tools').evaluate('(d)=>d.open=true')
    with page.expect_download() as download: page.locator('[data-action="export"]').click()
    assert json.loads(Path(download.value.path()).read_text()) == snapshot(page)['current']['document']
    with page.expect_download() as download: page.locator('[data-action="backup"]').click()
    backup = json.loads(Path(download.value.path()).read_text())
    assert backup['kind'] == 'chef-backup'
    import_data(page, backup)
    assert snapshot(page)['current']['session']['cookedAt']
    goto(page, 'archive')
    assert page.locator('.archive-card').count() >= 2
    page.locator('[data-action="favorite"]').first.click()
    page.wait_for_timeout(100)
    assert page.locator('[data-action="favorite"][aria-pressed="true"]').count() == 1
    ok('Menu export, full backup restore and archive favorites preserve data')
    page.evaluate('navigator.serviceWorker.ready')
    page.reload(wait_until='networkidle')
    assert page.evaluate('!!navigator.serviceWorker.controller')
    page.evaluate("caches.open('unrelated-cache')")
    context.set_offline(True)
    goto(page, 'overview')
    assert page.locator('.recipe').count() == 2
    page.goto(BASE+'/kochmodus.html',wait_until='networkidle')
    assert page.get_by_role('heading',name='Dein Menü ist gekocht.').is_visible()
    assert 'unrelated-cache' in page.evaluate('caches.keys()')
    context.set_offline(False)
    ok('Offline reload and compatibility navigation use the complete cached app')
    context.close()

    legacy_context = browser.new_context(viewport={'width':1024,'height':768},has_touch=True,is_mobile=True)
    page = legacy_context.new_page()
    page.on('pageerror',lambda error:results['page_errors'].append(str(error)))
    goto(page,'overview')
    legacy = json.loads((ROOT/'examples/legacy-menu.json').read_text())
    page.evaluate("""async source => {
      const {importMenu}=await import('./src/data/validate.js');
      const {snapshot}=await import('./src/session/store.js');
      const current=snapshot(importMenu(JSON.stringify(source)).document);
      localStorage.setItem('batchcooking_recipes',JSON.stringify(source));
      localStorage.setItem('chef.workspace.v2',JSON.stringify({version:2,current,archive:[],initialized:true}));
    }""",legacy)
    page.reload(wait_until='networkidle')
    assert not page.get_by_text('Noch nicht planbar',exact=True).count()
    original = snapshot(page)['current']['document']
    assert any(t['duration'] is None for r in original['recipes'] for t in r['tasks'])
    page.screenshot(path=str(OUT/'legacy-menu-ipad.png'),full_page=True)
    page.locator('.summary [data-route="cook"]').click()
    page.wait_for_function('document.body.dataset.view==="cook"')
    first = page.locator('[data-action="start-task"]').get_attribute('data-id')
    page.locator('[data-action="start-task"]').click()
    page.wait_for_function('(id)=>JSON.parse(localStorage.getItem("chef.workspace.v2")).current.session.tasks[id]?.status==="running"',arg=first)
    assert not page.locator('#confirmDialog').is_visible()
    assert not snapshot(page)['current']['session']['timers']
    assert page.locator('.timeline-step[data-state="running"]').count()==1
    assert page.locator('.timeline-step[data-pulsing="true"]').count()==0
    page.reload(wait_until='networkidle')
    assert page.locator('[data-action="complete-task"]').is_enabled()
    assert snapshot(page)['current']['session']['tasks'][first]['status']=='running'
    assert not page.locator('[data-main-timer]').count()
    page.screenshot(path=str(OUT/'legacy-cooking-ipad.png'),full_page=True)
    page.clock.install(time=datetime(2026,10,25,12,tzinfo=timezone.utc))
    page.locator('[data-action="start-timer"]').click()
    page.locator('#timerDialog').wait_for()
    page.locator('#timerMinutes').fill('2');page.locator('#timerSeconds').fill('30')
    page.locator('#timerForm button[type="submit"]').click()
    page.locator('[data-action="pause-timer"]').wait_for()
    assert snapshot(page)['current']['session']['timers'][first]['durationSeconds']==150
    page.locator('[data-action="pause-timer"]').click()
    page.locator('[data-action="resume-timer"]').wait_for()
    remaining=snapshot(page)['current']['session']['timers'][first]['remainingMs']
    frozen=page.locator('[data-main-timer]').inner_text()
    page.clock.fast_forward(120000)
    assert page.locator('[data-main-timer]').inner_text()==frozen
    assert not page.locator('#alarmDialog').is_visible()
    assert page.locator('.timeline-step[data-state="paused"]').count()==1
    page.reload(wait_until='networkidle')
    assert snapshot(page)['current']['session']['timers'][first]['remainingMs']==remaining
    assert page.locator('[data-action="resume-timer"]').is_visible()
    page.locator('[data-action="following-task"]').click()
    assert snapshot(page)['current']['session']['tasks'][first]['status']=='running'
    page.locator('[data-action="previous-task"]').click()
    page.locator('[data-action="resume-timer"]').click()
    page.locator('[data-action="pause-timer"]').wait_for()
    assert page.locator('.timeline-step[data-pulsing="true"]').count()==1
    ok('Custom timers on untimed steps pause without expiring, survive reload, and resume after browsing')
    page.locator('[data-action="complete-task"]').click()
    page.wait_for_function('(id)=>JSON.parse(localStorage.getItem("chef.workspace.v2")).current.session.tasks[id]?.status==="completed"',arg=first)
    assert snapshot(page)['current']['document']==original
    assert json.loads(page.evaluate("localStorage.getItem('batchcooking_recipes')"))==legacy
    assert not snapshot(page)['current']['checks']['ready']
    ok('Existing migrated menus cook without missing prep times, checklist gates or invented timers; reload preserves manual steps')
    missing = timer_fixture()
    missing['recipes'][0]['tasks'][0]['duration']=None
    import_data(page,missing)
    page.locator('.navigation a[href="#cook"]').click()
    page.wait_for_function('document.body.dataset.view==="cook"')
    page.locator('[data-action="show-missing"]').click()
    field = page.locator('[data-required-time]')
    assert field.is_visible()
    assert field.evaluate('(e)=>document.activeElement===e')
    field.fill('1');field.press('Tab')
    page.wait_for_function('JSON.parse(localStorage.getItem("chef.workspace.v2")).current.document.recipes[0].tasks[0].duration?.seconds===60')
    page.locator('.summary [data-route="cook"]').click()
    page.wait_for_function('document.body.dataset.view==="cook"')
    page.locator('[data-action="start-timer"]').click()
    page.locator('.timer-chip').wait_for()
    assert not page.locator('#confirmDialog').is_visible()
    ok('Missing passive time leads straight to an editable field and starts a real timer after correction')
    assert page.evaluate("!document.dispatchEvent(new Event('gesturestart',{cancelable:true}))")
    assert page.evaluate("getComputedStyle(document.documentElement).touchAction")=='pan-x pan-y'
    assert 'user-scalable=no' in page.locator('meta[name="viewport"]').get_attribute('content')
    ok('Touch zoom gestures are blocked while single-finger scrolling remains available')
    for inset in [24,59]:
        page.evaluate('(inset)=>document.documentElement.style.setProperty("--safe-top",inset+"px")',inset)
        page.evaluate('window.scrollTo(0,600)')
        page.wait_for_function('''() => {
          const header=document.querySelector('.topbar').getBoundingClientRect();
          const timer=document.querySelector('#timerRail').getBoundingClientRect();
          return timer.top >= header.bottom-1;
        }''')
        geometry=page.evaluate('''() => {
          const controls=[document.querySelector('.brand'),...document.querySelectorAll('.navigation a')].filter(e=>e.getClientRects().length);
          return {top:Math.min(...controls.map(e=>e.getBoundingClientRect().top)),
            reachable:[...document.querySelectorAll('.navigation a')].filter(e=>e.getClientRects().length).every(e=>{
              const r=e.getBoundingClientRect();
              return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('a')===e;
            })};
        }''')
        assert geometry['top']>=inset+9 and geometry['reachable'],(inset,geometry)
    ok('Changing iPad status-bar insets keeps navigation reachable and the timer rail below the header')
    page.evaluate('document.documentElement.style.removeProperty("--safe-top")')
    long_menu=timer_fixture()
    long_menu['recipes'][0]['tasks'][0]['instruction']='Garzustand prüfen. '+('Lange Anleitung mit einzelnen Handgriffen und Hinweisen.\n'*30)
    import_data(page,long_menu)
    page.set_viewport_size({'width':320,'height':568})
    goto(page,'cook')
    assert not page.locator('#cookStepsDialog').is_visible()
    assert not page.locator('#viewRoot .task-item').count()
    page.locator('[data-action="start-timer"]').click()
    page.locator('[data-action="pause-timer"]').wait_for()
    step_body=page.locator('.cook-step-body')
    step_body.evaluate('(e)=>e.scrollTop=200')
    before_scroll=step_body.evaluate('(e)=>e.scrollTop')
    assert before_scroll>0
    page.locator('[data-action="pause-timer"]').click()
    page.wait_for_timeout(100)
    assert abs(step_body.evaluate('(e)=>e.scrollTop')-before_scroll)<2
    assert page.evaluate('window.scrollY')==0
    primary=page.locator('.cook-primary').bounding_box()
    assert primary['y']>=0 and primary['y']+primary['height']<=568
    ok('Long instructions scroll independently; timer changes preserve reading position and the main action stays visible')
    page.locator('[data-action="resume-timer"]').click()
    page.locator('[data-action="cook-steps"]').click()
    assert page.locator('#cookStepsContent .task-item').count()==4
    page.locator('#cookStepsContent [data-id="meal-b/wait"]').click()
    assert not page.locator('#cookStepsDialog').is_visible()
    assert page.locator('.cook-instruction').inner_text()=='Garzustand B prüfen'
    assert step_body.evaluate('(e)=>e.scrollTop')==0
    assert page.locator('.timer-chip').count()==1
    assert page.url.endswith('#cook')
    ok('Optional step drawer changes the current task on the same page while existing timers keep running')
    legacy_context.close()
    for name,width,height in [('iphone-se',320,568),('iphone',390,844),('iphone-landscape',844,390),('ipad-landscape',1024,768),('ipad-portrait',768,1024)]:
        context = browser.new_context(viewport={'width':width,'height':height},is_mobile=True,has_touch=True)
        page=context.new_page();page.on('pageerror',lambda error:results['page_errors'].append(str(error)))
        for route in ['overview','prep','cook','plan','archive']:
            goto(page,route)
            geometry=page.evaluate('''() => ({overflow:document.documentElement.scrollWidth>innerWidth+1,
              small:[...document.querySelectorAll('button,summary,.navigation a')].filter(x=>x.getClientRects().length&&!x.disabled).map(x=>({label:x.textContent.trim().slice(0,25),w:x.getBoundingClientRect().width,h:x.getBoundingClientRect().height})).filter(x=>x.w<44||x.h<44)})''')
            assert not geometry['overflow'],(name,route,'horizontal overflow')
            assert not geometry['small'],(name,route,geometry['small'])
            if route=='cook':
                focus_geometry=page.evaluate('''() => {
                  const action=document.querySelector('.cook-primary').getBoundingClientRect();
                  return {pageOverflow:document.documentElement.scrollHeight>innerHeight+1,
                    actionVisible:action.top>=0&&action.bottom<=innerHeight,
                    actionReachable:document.elementFromPoint(action.x+action.width/2,action.y+action.height/2)?.closest('button')?.classList.contains('cook-primary')};
                }''')
                assert not focus_geometry['pageOverflow'] and focus_geometry['actionVisible'] and focus_geometry['actionReachable'],(name,focus_geometry)
            results['layouts'].append({'viewport':name,'route':route,**geometry})
        if name=='ipad-landscape':
            goto(page,'overview');page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(OUT/'overview-ipad.png'),full_page=True)
            goto(page,'cook');page.locator('[data-action="start-timer"]').click();page.screenshot(path=str(OUT/'cooking-focus-ipad.png'))
        context.close()
    ok('Five mobile/tablet viewport sizes: five views fit and buttons have at least 44px targets')
    for profile,agent,platform in [
        ('ipad-mobile','Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1','iPad'),
        ('ipad-desktop','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1','MacIntel')
    ]:
        context=browser.new_context(viewport={'width':1280,'height':882},is_mobile=True,has_touch=True,user_agent=agent)
        context.add_init_script(f"Object.defineProperty(navigator,'platform',{{get:()=>{json.dumps(platform)}}});Object.defineProperty(navigator,'maxTouchPoints',{{get:()=>5}});")
        page=context.new_page();page.on('pageerror',lambda error:results['page_errors'].append(str(error)))
        for route in ['overview','cook']:
            goto(page,route)
            geometry=page.evaluate('''() => {
              const links=[...document.querySelectorAll('.navigation a')].filter(e=>e.getClientRects().length);
              return {top:Math.min(...links.map(e=>e.getBoundingClientRect().top)),
                reachable:links.every(e=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('a')===e;})};
            }''')
            assert geometry['top']>=64 and geometry['reachable'],(profile,route,geometry)
        page.locator('[data-action="start-timer"]').click()
        for width,height in [(1280,882),(768,1024),(844,390)]:
            page.set_viewport_size({'width':width,'height':height})
            page.mouse.move(30,80);page.mouse.wheel(0,-500)
            geometry=page.evaluate('''() => {
              const action=document.querySelector('.cook-primary').getBoundingClientRect();
              const nav=document.querySelector('.nav-cook').getBoundingClientRect();
              const header=document.querySelector('.topbar').getBoundingClientRect();
              return {top:nav.top,scroll:scrollY,timerTop:document.querySelector('#timerRail').getBoundingClientRect().top,headerBottom:header.bottom,
                actionVisible:action.top>=0&&action.bottom<=innerHeight,
                actionReachable:document.elementFromPoint(action.x+action.width/2,action.y+action.height/2)?.closest('button')?.classList.contains('cook-primary')};
            }''')
            assert geometry['top']>=64 and geometry['scroll']==0 and geometry['timerTop']>=geometry['headerBottom']-1, (profile,width,height,geometry)
            assert geometry['actionVisible'] and geometry['actionReachable'],(profile,width,height,geometry)
            if profile=='ipad-desktop' and width==1280:
                page.screenshot(path=str(OUT/'ipad-status-clearance.png'))
        context.close()
    ok('iPad mobile and desktop identifiers keep controls below status-bar blur even with zero reported safe inset and after rotation')
    browser.close()

assert not results['page_errors'],results['page_errors']
(OUT/'browser-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(f"Completed {len(results['passed'])} browser workflow checks and {len(results['layouts'])} layout checks without page errors.",flush=True)
