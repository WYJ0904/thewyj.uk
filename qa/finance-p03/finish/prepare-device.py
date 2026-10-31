"""Fresh privacy QA derivative with unchanged legacy assertions and timed probes."""
from pathlib import Path
import hashlib,json,shutil
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/migration-evidence/finance-p03/finish';SOURCE=ROOT/'qa/finance-p03/device'
code=(SOURCE/'prepare.py').read_text().replace("OUT=ROOT/'docs/migration-evidence/finance-p03/device'","OUT=ROOT/'docs/migration-evidence/finance-p03/finish'")
exec(compile(code,'sealed-prepare-output-path-only.py','exec'),{'__file__':str(SOURCE/'prepare.py'),'__name__':'__main__'})
qaout=OUT/'qa-generated';qaout.mkdir(exist_ok=False)
for name in ['src','test','assets','res']:shutil.copytree(SOURCE/name,qaout/name)
for p in (ROOT/'qa/finance-p03/finish/device-src').glob('*.kt'):shutil.copy2(p,qaout/'src/uk/thewyj/app/qa/finance'/p.name)
for p in (ROOT/'qa/finance-p03/finish/device-test').glob('*.kt'):shutil.copy2(p,qaout/'test/uk/thewyj/app/qa/finance'/p.name)
provider=qaout/'src/uk/thewyj/app/qa/finance/FinanceDeviceInitProvider.kt';text=provider.read_text().replace('        app.registerActivityLifecycleCallbacks','        FinanceFinishProbe.install(app)\n        app.registerActivityLifecycleCallbacks');provider.write_text(text)
main=qaout/'test/uk/thewyj/app/qa/finance/FinanceDeviceMainTest.kt';text=main.read_text().replace('        ActivityScenario.launch<MainActivity>(intent).use{s->','        FinanceFinishProbe.mark("original-main-launch")\n        ActivityScenario.launch<MainActivity>(intent).use{s->')
text=text.replace('s.moveToState(Lifecycle.State.CREATED);s.moveToState(Lifecycle.State.RESUMED)','FinanceFinishProbe.mark("original-$round-stop");s.moveToState(Lifecycle.State.CREATED);FinanceFinishProbe.mark("original-$round-resume");s.moveToState(Lifecycle.State.RESUMED)').replace('        }\n    }\n}', '        }\n        FinanceFinishProbe.mark("idle")\n    }\n}');main.write_text(text)
text=(SOURCE/'AndroidManifest.xml').read_text().replace('  <provider','  <activity android:name="uk.thewyj.app.qa.finance.FinanceFinishPlainActivity" android:exported="false"/>\n  <activity android:name="uk.thewyj.app.qa.finance.FinanceFinishCoverActivity" android:exported="false"/>\n  <provider',1)
text=text.replace('uk.thewyj.app.debug.finance-p03-init','uk.thewyj.app.qa.financep03finish.finance-p03-init')
text=text.replace('  <receiver android:name="uk.thewyj.app.qa.finance.FinanceDeviceControlReceiver"',
    '  <service android:name="uk.thewyj.app.task21.payment.ThewyjPaymentAccessibilityService" android:label="FINANCE P03 QA 金额核实" tools:replace="android:label"/>\n  <receiver android:name="uk.thewyj.app.qa.finance.FinanceDeviceControlReceiver"')
(qaout/'AndroidManifest.xml').write_text(text);shutil.copy2(SOURCE/'TestManifest.xml',qaout/'TestManifest.xml')
for relative in ['src/uk/thewyj/app/qa/finance/FinanceDeviceGate.kt','test/uk/thewyj/app/qa/finance/FinanceDeviceSmokeTest.kt']:
    target=qaout/relative
    text=target.read_text().replace('uk.thewyj.app.debug.p03acceptance','uk.thewyj.app.qa.financep03finish.test').replace('uk.thewyj.app.debug','uk.thewyj.app.qa.financep03finish')
    target.write_text(text)
(OUT/'qa-generation.json').write_text(json.dumps({'source_overlay':'source-overlay.json','privacy_transform_source_sha256':hashlib.sha256((SOURCE/'prepare.py').read_bytes()).hexdigest(),'generated_from':SOURCE.relative_to(ROOT).as_posix(),'changes':['fresh output root and CA','own-process lifecycle/window/public power state/Java stacks probe','plain/cover Activities and thirty-round tests','original Main test stage logging only; original assertions and timeouts unchanged'],'generated_sha256':{p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in qaout.rglob('*') if p.is_file()}},indent=2))
print('Prepared isolated QA privacy sources and bounded own-process diagnostics')
