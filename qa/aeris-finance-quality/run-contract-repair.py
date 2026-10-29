"""One coordinated native replay plus declared DOM; preserve all original reds."""
from common import *
import sys
OUT=E/'contract-repair-r1';assert OUT.is_dir()
rows=json.loads((OUT/'commands.json').read_text())
assert len(rows)==1 and rows[0]['exit_code']==0
lock=E/'gradle.lock'
with lock.open('x') as stream:json.dump(dict(pid=os.getpid(),base=str(OUT)),stream)
def run(name,cmd,extra):
    row=dict(name=name,command=cmd,started_utc=utc())
    with (OUT/(name+'.log')).open('xb') as log:
        p=subprocess.run(cmd,cwd=ROOT,env=dict(environment(),**extra),stdout=log,stderr=subprocess.STDOUT)
    row.update(exit_code=p.returncode,finished_utc=utc(),log=(OUT/(name+'.log')).relative_to(ROOT).as_posix())
    rows.append(row);write(OUT/'commands.json',rows);print(json.dumps(row),flush=True)
try:
    run('declared-native',[sys.executable,str(E/'drivers/android.py'),'--qa-root',str(OUT/'contract-input-drivers/native'),
        '--qa-output',str(OUT/'declared-native'),'--tests','*FinanceP02MatrixTest.D_parserCurrencyTarget'],
        dict(FINANCE_P04_OUTPUT=str(OUT/'declared-native-command')))
    run('declared-dom',[str(NODE),str(OUT/'contract-input-drivers/web-dom-declared-inputs.mjs')],
        dict(FINANCE_P03_OUTPUT=str(OUT/'contract-input-drivers'),FINANCE_P04_OUTPUT=str(OUT/'contract-input-drivers'),
             AERIS_TEST_CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe'))
finally:
    if json.loads(lock.read_text())['pid']==os.getpid():lock.unlink()
    resume=E/'final-r3/extra-commands-resume-r1.json';assert not resume.exists()
    write(resume,rows)
raise SystemExit(int(any(row['exit_code'] for row in rows)))
