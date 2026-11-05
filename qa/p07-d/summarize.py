"""Publish sanitized evidence summaries; keep all original runs immutable."""
import collections, hashlib, json, os, pathlib, re, shutil, subprocess
ROOT=pathlib.Path(__file__).resolve().parents[2]
RAW=ROOT/'docs/migration-evidence/p07-d'
OUT=ROOT/'docs/p07/evidence/p07-d-independent'
OUT.mkdir(parents=True,exist_ok=True)
def read(label,name):return json.loads((RAW/label/name).read_text(encoding='utf-8-sig'))
def counts(rows):return dict(collections.Counter(x['status'] for x in rows))
def safe(value):
    if isinstance(value,dict):return {k:safe(v) for k,v in value.items()}
    if isinstance(value,list):return [safe(v) for v in value]
    if isinstance(value,str):
        value=value.split('; diagnostic=')[0]
        value=re.sub(r'C:[\\/]+Users[\\/]+[^\\/\s]+','%USERPROFILE%',value,flags=re.I)
        return value
    return value
def source(label):
    p=RAW/label/'source-manifest.json'
    if p.exists():
        data=json.loads(p.read_text());return {'sha':data['sha'],'files':data['files']}
    return None
def suite(label):return read(label,'suites.json')
result={'schema_version':1,'date':'2026-11-04','timezone':'Asia/Hong_Kong',
 'conclusion':'P07_D_QA_PARTIAL','baseline_sha':'337bb32f1ce349f9c5d58bd6120932fa5e61a745',
 'flash_sha':'d2f78e0008d79eff35467424f3748d5d443ef0bc',
 'candidates':{'audit':'c62e833ff0098cacd46e58a919d4668933f81cb6',
               'short_viewport':'91a06fcaa6210dc04834d36678508eae8ad55a75',
               'flash_readability':'qa/p07-d/candidates/flash-readable-tabs.patch'},
 'business':{},'matrices':{},'native_zoom':{},'tools':{},'contracts':read('contracts-r1','results.json'),
 'scope':{'synthetic_local_accounts_only':True,'real_model_calls':0,'production_operations':0,
          'Samsung':'NOT_TESTED','real_speech_quality':'NOT_TESTED','screen_reader':'NOT_TESTED',
          'Hosted_and_CI':'NOT_TESTED_INDEPENDENTLY','P03_P04_implementation_modified':False}}
for label,tier in [
 ('original-ai-off-r3','PR121_ORIGINAL_AI_OFF'),
 ('candidate-business-r1','AUDIT_CANDIDATE_NO_AUDIO_FIXTURE'),
 ('compiled-business-r3','QA_CANDIDATE_SYNTHETIC_FIXTURES'),
 ('flash-business-r1','FLASH_UNPATCHED_SYNTHETIC_FIXTURES'),
 ('flash-candidates-business-r1','FLASH_PLUS_QA_RUNTIME_CANDIDATES_SYNTHETIC_FIXTURES')]:
    data=read(label,'business-results.json'); rows=data['checks'];assert len(rows)==24
    result['business'][label]={'tier':tier,'raw_suites':suite(label),'counts':counts(rows),'checks':safe(rows),
        'source':source(label),'driver':read(label,'business-driver-provenance.json')}
for label in ['v3-candidate-matrix-r1','final-interactions-r1','flash-matrix-r1','flash-interactions-r3']:
    data=read(label,'matrix-results.json'); rows=data['results']
    layout=[x for x in rows if re.fullmatch(r'(home|account|language|english|japanese|wrong|study|finance|tools|text)-(375|390|412|768|1024|1440|1920)-(light|dark)',x['id'])]
    network=read(label,'matrix-network.json')
    result['matrices'][label]={'counts':counts(rows),'layout_combinations':len(layout),'layout_counts':counts(layout),
       'checks':safe(rows),'nonlocal_requests':network['nonlocal'],'runtime_errors':network['runtimeErrors'],'source':source(label)}
for label in ['v3-candidate-matrix-r1','zoom-candidate-r1','flash-matrix-r1','flash-candidates-zoom-r1']:
    data=read(label,'browser-zoom-400.json'); routes=[x for f in data['results'] for x in f['routeChecks']]
    business=[]
    for factor in [100,200,400]:business.extend(read(label,f'matrix-native-zoom-{factor}.json')['results'])
    result['native_zoom'][label]={'home_login_counts':counts(routes),'business_counts':counts(business),
        'profiles':data['results'],'source':source(label)}
for label in ['tools-r3','flash-tools-r1']:
    text=(RAW/label/'tools-browser.log').read_text(encoding='utf-8-sig'); found=[]
    for match in re.finditer(r'(?m)^\{',text):
        try:value,_=json.JSONDecoder().raw_decode(text[match.start():])
        except json.JSONDecodeError:continue
        if isinstance(value,dict) and 'catalog' in value:found.append(value)
    assert len(found)==1
    data=found[0];data.pop('account',None)
    result['tools'][label]={'raw_suites':suite(label),'summary':data,'source':source(label)}
result['audit']={label:read(label,'audit-regression.json') for label in ['audit-before-r1','audit-after-r2','flash-audit-r1']}
result['home_overlap']={label:read(label,'independent-browser-gaps.json') for label in ['homepage-iqa001-r1','flash-iqa001-r1']}
result['flash_runtime_candidate_provenance']=read('flash-candidates-business-r1','candidate-overlays.json')
result['protected']=read('', 'protected-final-comparison.json' if (RAW/'protected-final-comparison.json').exists() else 'protected-comparison.json')
result['excluded_or_preserved_failures']=[
 {'run':'original-ai-off-r1','class':'DRIVER_FAILURE','reason':'Target moved during wait; original hit assertion failed; retained screenshot.'},
 {'run':'original-ai-off-r2','class':'QA_IMPLEMENTATION_ERROR','reason':'CRLF instrumentation anchor; original failure retained.'},
 {'run':'original-ai-off-r3','class':'FAIL_ENV','reason':'Unlisted artificial vocabulary; real /api/judge 503 ai_unavailable.'},
 {'run':'baseline-matrix-r1','class':'FAIL_ENV','reason':'Inspector port occupied; existing process preserved.'},
 {'run':'baseline-matrix-r2','class':'QA_IMPLEMENTATION_ERROR','reason':'Production UI does not expose test-only state global.'},
 {'run':'baseline-matrix-r3','class':'EXCLUDED_FROM_V3','reason':'Initial captures sampled fail-closed legacy state before authoritative P07 decision. Not V3 PASS evidence.'},
 {'run':'offline-rubric-r1','class':'FAIL_ENV','reason':'Local development service exit / connection refused.'},
 {'run':'offline-rubric-r2','class':'FAIL_PRODUCT','reason':'Stored feedback audit missing from admin audit view.'},
 {'run':'audit-after-r1','class':'FAIL_ENV','reason':'Local migration bad port; later bounded same-ledger continuation supported.'},
 {'run':'candidate-business-r1','class':'FAIL_ENV','reason':'24 scenario groups passed; original aggregate still failed on three uncached TTS 503 responses.'},
 {'run':'candidate-business-audio-r1','class':'DRIVER_FAILURE','reason':'Viewport/media change raced navigation toggle; first assertion failure preserved.'},
 {'run':'candidate-business-audio-r2','class':'FAIL_ENV','reason':'Development proxy exit / connection refused.'},
 {'run':'candidate-business-audio-r3','class':'FAIL_ENV','reason':'Development proxy exit / connection refused during reload.'},
 {'run':'v3-policy-r1','class':'DRIVER_FAILURE','reason':'Favorite assertion ran before actual async save; later waits for real response state.'},
 {'run':'tools-r1','class':'FAIL_ENV','reason':'Windows Path casing dropped Python; no assertion changes.'},
 {'run':'tools-r2','class':'FAIL_ENV','reason':'Missing cv2 verifier dependency; artifacts retained and independently reopened after lab-only venv setup.'},
 {'run':'compiled-business-r1','class':'QA_IMPLEMENTATION_ERROR','reason':'Server adapter syntax; retained startup failure.'},
 {'run':'compiled-business-r2','class':'QA_IMPLEMENTATION_ERROR','reason':'Wrangler upload output is multipart, not raw JS; loader corrected.'},
 {'run':'flash-interactions-r1','class':'FAIL_ENV','reason':'Fixture setup ECONNRESET before business assertions; no POST replay.'},
 {'run':'flash-interactions-r2','class':'FAIL_ENV','reason':'Fixture setup ECONNRESET; fresh independent fixture/new port completed in r3.'},
 {'run':'staging-tests.log','class':'QA_COMMAND_ERROR','reason':'Python module name used for a Node test; correct unchanged Node suite subsequently 28/28.'}]
assert result['business']['compiled-business-r3']['counts']=={'PASS':24}
assert result['business']['flash-business-r1']['counts']=={'PASS':12,'FAIL':1,'NOT_TESTED':11}
assert result['business']['flash-candidates-business-r1']['counts']=={'PASS':24}
assert result['matrices']['flash-matrix-r1']['layout_counts']=={'PASS':140}
assert result['native_zoom']['flash-candidates-zoom-r1']['home_login_counts']=={'PASS':12}
result=safe(result)
(OUT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

# Copy a bounded, explicitly selected set of real screenshots. All larger raw
# runs and local account artifacts stay in ignored paths and remain unchanged.
selections=[
 ('v3-candidate-matrix-r1','screenshots/home-1440-light.png','baseline-home-1440-light.png','PR121 visual baseline'),
 ('v3-candidate-matrix-r1','screenshots/english-1440-light.png','baseline-english-1440-light.png','PR121 visual baseline'),
 ('v3-candidate-matrix-r1','screenshots/finance-390-light.png','baseline-finance-390-light.png','PR121 visual baseline'),
 ('flash-matrix-r1','screenshots/home-1440-light.png','flash-home-1440-light.png','Flash unpatched'),
 ('flash-matrix-r1','screenshots/english-1440-light.png','flash-english-1440-light.png','Flash unpatched'),
 ('flash-matrix-r1','screenshots/study-1440-light.png','flash-study-1440-light.png','Flash unpatched'),
 ('flash-matrix-r1','screenshots/finance-390-light.png','flash-finance-390-light.png','Flash unpatched'),
 ('flash-business-r1','business-failure.png','flash-disabled-tab-failure.png','Flash contrast FAIL'),
 ('flash-matrix-r1','focus-200-login-light-loginSubmitBtn.png','flash-login-200-before.png','Flash native zoom FAIL'),
 ('flash-candidates-zoom-r1','login-native-zoom-200-light.png','flash-login-200-after-candidate.png','Flash plus runtime candidates PASS'),
 ('flash-matrix-r1','focus-400-home-light-learning.png','flash-home-400-before.png','Flash native zoom FAIL'),
 ('flash-candidates-zoom-r1','home-native-zoom-400-light.png','flash-home-400-after-candidate.png','Flash plus runtime candidates PASS; final focus is tools'),
 ('flash-iqa001-r1','keyboard-overlap-learning.png','flash-iqa001-learning.png','Flash custom overlap PASS')]
for name in ['hydrated-tools-1440-light','hydrated-tools-390-dark','hydrated-text-1440-light','hydrated-text-390-light',
             'actual-rule-quiz-1440-light','actual-rule-feedback-1440-light','actual-rule-wrong-1440-light',
             'actual-rule-wrong-390-light','actual-rule-study-1440-light','manual-cny-long-merchant-375-light',
             'local-task25-global_off','local-task25-kill_switch']:
    selections.append(('flash-interactions-r3','screenshots/'+name+'.png','flash-'+name+'.png','Flash unpatched; actual isolated local data'))
images=[]
for label,name,target,tier in selections:
    original=RAW/label/name;assert original.is_file(),original
    data=original.read_bytes();assert data.startswith(b'\x89PNG\r\n\x1a\n')
    (OUT/target).write_bytes(data)
    images.append({'file':target,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),
        'source_run':label,'source_relative':name,'tier':tier,'capture':'actual headless Chrome screenshot; no generated image'})
(OUT/'evidence-manifest.json').write_text(json.dumps({'images':images,'raw_root':'docs/migration-evidence/p07-d',
    'design_references':'design-references.json','results':'results.json','synthetic_accounts_only':True},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Published',len(images),'real screenshots and sanitized independent results')
