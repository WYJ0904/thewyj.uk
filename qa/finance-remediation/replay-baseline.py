"""Run the unchanged new quality oracle against a065's actual AI module."""
from pathlib import Path
import difflib,hashlib,json,os,re,subprocess
ROOT=Path(__file__).resolve().parents[2]
E=ROOT/'docs/migration-evidence/finance-p04/remediation'
OUT=E/'ai-quality-baseline-r2';OUT.mkdir(exist_ok=False)
module=ROOT/'functions/_lib/finance-ai.mjs'
original=subprocess.check_output(['git','show','a065cd15d48b508c2797b9b563cfd24228b6bed9:functions/_lib/finance-ai.mjs'],cwd=ROOT).decode()
adapted=original
for match in list(re.finditer(r"from (['\"])(\.\.?/[^'\"]+)\1",adapted)):
    adapted=adapted.replace(match[0],'from '+json.dumps((module.parent/match[2]).resolve().as_uri()))
(OUT/'baseline-module.mjs').write_text(adapted)
source=ROOT/'qa/finance-remediation/ai-quality.mjs'
driver=source.read_text()
for match in list(re.finditer(r"from (['\"])(\.\.?/[^'\"]+)\1",driver)):
    target=(source.parent/match[2]).resolve()
    if target==module:target=OUT/'baseline-module.mjs'
    driver=driver.replace(match[0],'from '+json.dumps(target.as_uri()))
(OUT/'driver.mjs').write_text(driver)
(OUT/'adaptations.json').write_text(json.dumps(dict(baseline_commit='a065cd15d48b508c2797b9b563cfd24228b6bed9',
    original_ai_sha256=hashlib.sha256(original.encode()).hexdigest(),current_quality_source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
    changes='Only absolute import URLs; original a065 module, same current 76 test bodies and assertions. No model invocation or frozen-test mutation.'),indent=2))
node=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
with (OUT/'run.log').open('xb') as log:
    p=subprocess.run([str(node),str(OUT/'driver.mjs')],cwd=ROOT,env=dict(os.environ,FINANCE_REMEDIATION_OUTPUT=str(OUT/'result')),stdout=log,stderr=subprocess.STDOUT)
(OUT/'exit.json').write_text(json.dumps({'exit_code':p.returncode,'expected_failures_preserved':True}))
print('Baseline module result exit =',p.returncode)
raise SystemExit(p.returncode)
