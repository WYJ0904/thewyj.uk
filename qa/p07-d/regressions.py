"""Run unchanged isolated API/client contracts; never contact a deployed site."""
import hashlib, json, os, pathlib, re, shutil, subprocess, sys, time
ROOT=pathlib.Path(__file__).resolve().parents[2]
LABEL=sys.argv[1] if len(sys.argv)>1 else 'contracts'
assert re.fullmatch('[a-z0-9-]+',LABEL)
OUT=ROOT/'docs/migration-evidence/p07-d'/LABEL
OUT.mkdir(parents=True,exist_ok=False)
env={k:v for k,v in os.environ.items() if not re.match(r'^(CLOUDFLARE_|CF_API_|CF_ACCOUNT_|OPENAI_|ANTHROPIC_|GEMINI_|WYJ_TEST_ADMIN_)',k,re.I)}
env.update(WRANGLER_SEND_METRICS='false',NO_PROXY='127.0.0.1,localhost',PYTHONIOENCODING='utf-8')
scripts=[
 'local-backend/test_task15_d1_js.mjs',
 'local-backend/test_task17_d1_js.mjs',
 'local-backend/test_task21_notification_js.mjs',
 'local-backend/test_notification_local_ledger_js.mjs',
 'local-backend/test_task25_client_js.mjs',
 'local-backend/test_task25_d1_js.mjs',
 'local-backend/test_task26_feature_refresh.mjs',
 'local-backend/test_task26_client_js.mjs',
 'local-backend/test_tools_js.mjs',
 'qa/p07-phase1/public-ui-policy.test.mjs',
 'scripts/check_js_module_graph.mjs',
 'scripts/check_storage_contract.mjs',
 'scripts/check_task15_cloud_only.mjs',
]
results=[]
for name in scripts:
    started=time.monotonic()
    with (OUT/(pathlib.Path(name).stem+'.log')).open('w',encoding='utf-8') as log:
        try:
            p=subprocess.run([shutil.which('node'),name],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=180)
            code=p.returncode
        except subprocess.TimeoutExpired:code=124
    results.append(dict(script=name,status='PASS' if code==0 else 'FAIL',exit_code=code,
        seconds=round(time.monotonic()-started,2),source_sha256=hashlib.sha256((ROOT/name).read_bytes()).hexdigest()))
    (OUT/'results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
    print(results[-1]['status'],name,flush=True)
sys.exit(int(any(x['exit_code'] for x in results)))
