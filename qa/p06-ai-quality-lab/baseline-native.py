"""Run identical native tests on base logic, then restore the owned candidate bytes."""
import hashlib,json,subprocess
import run as lab

source=lab.ROOT/'android/app/src/main/java/uk/thewyj/app/finance/FinanceAiEvidence.kt'
assert source.resolve().is_relative_to(lab.ROOT.resolve())
out=lab.E/'native-control-source'
out.mkdir(exist_ok=False)
candidate=source.read_bytes()
base=subprocess.check_output(['git','show',lab.BASE+':'+source.relative_to(lab.ROOT).as_posix()],cwd=lab.ROOT)
assert candidate!=base
(out/'candidate.kt').write_bytes(candidate)
(out/'base.kt').write_bytes(base)
record=dict(base=lab.BASE,base_sha256=hashlib.sha256(base).hexdigest(),candidate_sha256=hashlib.sha256(candidate).hexdigest(),only_owned_file_replaced=True)
try:
    source.write_bytes(base)
    record['test_exit_code']=lab.command('pinned-native-baseline','android-ai')
finally:
    source.write_bytes(candidate)
    record['candidate_restored']=source.read_bytes()==candidate
    (out/'result.json').write_text(json.dumps(record,indent=2),encoding='utf8')
assert record['candidate_restored']
print(json.dumps(record))
