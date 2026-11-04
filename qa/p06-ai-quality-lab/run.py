"""Owned offline evaluation runner. No remote/model/deploy/device commands exist here."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
E = ROOT / 'docs/migration-evidence/p06-ai-quality-lab'
BASE = '5f4e6df5b9d9a031dafa013249c2aa5ac3a2b006'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def environment():
    result = dict(os.environ, JAVA_HOME='C:/Program Files/Android/Android Studio/jbr',
                  ANDROID_HOME=str(Path(os.environ['LOCALAPPDATA']) / 'Android/Sdk'),
                  WRANGLER_SEND_METRICS='false', CI='true')
    result['ANDROID_SDK_ROOT'] = result['ANDROID_HOME']
    for key in list(result):
        if key.upper().startswith(('CLOUDFLARE_', 'CF_', 'OPENAI_', 'ANTHROPIC_', 'GEMINI_')) or any(
                word in key.upper() for word in ['SIGNING', 'KEYSTORE', 'STORE_PASSWORD', 'KEY_PASSWORD', 'KEY_ALIAS']):
            result.pop(key)
    return result


def snapshot(prefixes=('android/', 'functions/_lib/finance-ai', 'js/finance/ai-assistance.js', 'qa/p06-ai-quality-lab/')):
    names = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=ROOT).decode('utf8').split('\0')
    return {name: sha(ROOT / name) for name in sorted(set(names)) if name and name.startswith(prefixes) and (ROOT / name).is_file()}


def protected():
    result = []
    for folder in ['Desktop/编程/thewyj.uk', '.codex/worktrees/p05-ocr-exactness-lab/thewyj.uk',
                   '.codex/worktrees/finance-release-convergence/thewyj.uk']:
        source = Path.home() / folder
        names = subprocess.check_output(['git', '-C', str(source), 'ls-files', '-z', '--modified', '--others', '--exclude-standard']).decode('utf8').split('\0')
        result.append(dict(root=folder, head=subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip(),
            status=subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain=v1'], text=True),
            files={name: sha(source/name) for name in names if name and name != '访问口令.txt' and (source/name).is_file()}))
    return result


def prepare(history, older):
    out = E / 'history'
    out.mkdir(parents=True, exist_ok=False)
    src = history / 'docs/migration-evidence/finance-p04/convergence/live-models'
    budget = json.loads((src/'budget.json').read_bytes())
    assert budget['synthetic_only'] and budget['maximum_new_binding_invocations'] == 12
    calls = json.loads((src/'calls.json').read_bytes())
    cases = json.loads((src/'cases.json').read_bytes())
    assert len(calls) == len(cases) == 12
    manifest = []
    dest = out/'convergence-12'
    dest.mkdir()
    for name in ['budget.json', 'calls.json', 'cases.json', 'result.json'] + [f'response-{n}.json' for n in range(1,13)]:
        shutil.copy2(src/name, dest/name)
        manifest.append(dict(cohort='convergence-12', file=name, sha256=sha(src/name)))
    # Preserve the older cohort separately. Do not copy binding config, credentials or private errors.
    src = older / 'docs/migration-evidence/finance-p06/provider'
    for n in range(1,8):
        source = src/f'live-r{n}'; dest = out/'original-15'/source.name
        dest.mkdir(parents=True)
        for file in sorted(source.iterdir()):
            if file.name not in ['calls.json','cases.json','result.json','raw.json','ERROR_EVIDENCE_LIMITATION.json'] and not file.name.startswith('provider-'):
                continue
            if not file.is_file() or file.suffix != '.json':
                continue
            if file.name.startswith('provider-'):
                assert json.loads(file.read_bytes())['synthetic_only'] is True
            shutil.copy2(file,dest/file.name)
            manifest.append(dict(cohort='original-15/'+source.name, file=file.name, sha256=sha(file)))
    # Locate the exact historical adapter source by its saved byte hash, allowing Git's CRLF checkout form.
    before = json.loads((out/'convergence-12/result.json').read_bytes())['source_before']
    found = {}
    for name, digest in before.items():
        revisions = subprocess.check_output(['git','log','--all','--format=%H','--',name],cwd=ROOT,text=True).splitlines()
        for revision in revisions:
            content = subprocess.check_output(['git','show',revision+':'+name],cwd=ROOT)
            for ending, data in [('git',content),('crlf',content.replace(b'\r\n',b'\n').replace(b'\n',b'\r\n'))]:
                if hashlib.sha256(data).hexdigest() == digest:
                    target=out/('historical-'+Path(name).name);target.write_bytes(data)
                    found[name]=dict(commit=revision,sha256=digest,ending=ending,file=target.name)
                    break
            if name in found:
                break
    (out/'manifest.json').write_text(json.dumps(dict(files=manifest,historical_source=found,real_model_calls_this_run=0),indent=2),encoding='utf8')
    print(json.dumps(dict(copied=len(manifest),historical_sources=len(found),new_model_calls=0)))


def command(label, action):
    out = E/label
    out.mkdir(parents=True,exist_ok=False)
    before = snapshot(('android/',)) if action.startswith('android') else snapshot()
    commands = {
        'deps': ['cmd.exe','/d','/c','npm','ci','--ignore-scripts','--no-audit','--no-fund','--prefer-offline'],
        'evaluate': ['node','qa/p06-ai-quality-lab/evaluate.mjs','--output',str(out)],
        'evaluate-base': ['node','qa/p06-ai-quality-lab/evaluate.mjs','--baseline','--output',str(out)],
        'replay': ['node','qa/p06-ai-quality-lab/replay.mjs','--output',str(out)],
        'replay-portable': ['node','qa/p06-ai-quality-lab/replay.mjs','--portable-only','--output',str(out)],
        'functions-build': ['cmd.exe','/d','/c','npm','run','cf:check'],
        'api': ['node','qa/p06-ai-quality-lab/api.mjs','--output',str(out)],
        'score-tests': ['node','--test','qa/p06-ai-quality-lab/scoring.test.mjs'],
    }
    if action.startswith('android'):
        tasks = [':app:testDebugUnitTest','--tests','*FinanceAi*Test'] if action=='android-ai' else [
            ':app:lintDebug',':app:assembleDebug',':app:assembleDebugAndroidTest'] if action=='android-build' else [
            ':app:testDebugUnitTest',':app:lintDebug',':app:assembleDebug',':app:assembleDebugAndroidTest']
        cmd=['cmd.exe','/d','/c',str(ROOT/'android/gradlew.bat'),'-p',str(ROOT/'android'),*tasks,
             '--no-daemon','--max-workers=2','--console=plain','--stacktrace','-PTHEWYJ_BASE_URL=https://isolated-finance.invalid']
    else:
        cmd=commands[action]
    with (out/'console.log').open('xb') as log:
        p=subprocess.run(cmd,cwd=ROOT,env=environment(),stdout=log,stderr=subprocess.STDOUT)
    after = snapshot(('android/',)) if action.startswith('android') else snapshot()
    record=dict(command=cmd,exit_code=p.returncode,source_before=before,source_after=after,source_stable=before==after,
                base=BASE,head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),real_model_calls=0)
    if action.startswith('android') and (ROOT/'android/app/build/test-results/testDebugUnitTest').exists():
        shutil.copytree(ROOT/'android/app/build/test-results/testDebugUnitTest',out/'junit')
    (out/'command.json').write_text(json.dumps(record,indent=2),encoding='utf8')
    print(json.dumps({k:v for k,v in record.items() if k not in ['source_before','source_after']}))
    return p.returncode if before==after else 1


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['protect','prepare','deps','evaluate','evaluate-base','api','replay','replay-portable','functions-build','score-tests','android-ai','android-full','android-build'])
    parser.add_argument('--label',default='baseline')
    parser.add_argument('--history',type=Path)
    parser.add_argument('--older',type=Path)
    args=parser.parse_args()
    import re
    assert re.fullmatch('[a-z0-9-]+',args.label)
    E.mkdir(parents=True,exist_ok=True)
    if args.action=='protect':
        file=E/(args.label+'.json');assert not file.exists();file.write_text(json.dumps(protected(),indent=2),encoding='utf8')
    elif args.action=='prepare':
        prepare(args.history,args.older)
    else:
        raise SystemExit(command(args.label,args.action))
