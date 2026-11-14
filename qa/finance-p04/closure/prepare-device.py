"""Create a current-source isolated Samsung host, with all QA overlays audited."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import argparse
import re

ROOT = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser()
parser.add_argument('--name', default='device')
parser.add_argument('--reuse-ca',action='store_true')
parser.add_argument('--backup-suffix')
args = parser.parse_args()
assert re.fullmatch('[a-z0-9-]+',args.name)
assert args.backup_suffix is None or re.fullmatch('[a-z0-9-]+',args.backup_suffix)
OUT = ROOT / 'docs/migration-evidence/finance-p04/closure-current' / args.name
OUT.mkdir(exist_ok=False)
QA = OUT / 'qa'
QA.mkdir()
shutil.copytree(ROOT/'android/app/schemas',OUT/'generated-schemas')
PKG = 'uk.thewyj.app.qa.financep04closure'
old = ROOT / 'qa/finance-p03/device'
for directory in ['src', 'test', 'res', 'assets']:
    shutil.copytree(old / directory, QA / directory)
for name in ['AndroidManifest.xml', 'TestManifest.xml', 'qa.init.gradle']:
    shutil.copy2(old / name, QA / name)
adaptations = []
for path in QA.rglob('*'):
    if not path.is_file(): continue
    before = path.read_bytes()
    text = before.decode('utf8').replace('\r\n','\n')
    text = text.replace('uk.thewyj.app.debug', PKG).replace('FINANCE_P03_', 'FINANCE_P04_')
    text = text.replace('finance-p03-device', 'finance-p04-closure').replace('FINANCE P03', 'FINANCE P04')
    if path.name == 'FinanceDeviceSmokeTest.kt': text = text.replace('assertEquals(14,NotificationDatabase.SCHEMA_VERSION)', 'assertEquals(16,NotificationDatabase.SCHEMA_VERSION)')
    if path.name == 'FinanceDeviceSetupTest.kt':
        text = text.replace('FinanceDeviceGate.enable(c,true)', 'uk.thewyj.app.finance.CurrencyRuntimePreferences.save(c,FinanceDeviceSupport.OWNER,"CNY")\n        FinanceDeviceGate.enable(c,true)')
    if path.name == 'FinanceDeviceMigrationTest.kt':
        text = text.replace('broken?:NotificationDatabase.MIGRATION_13_14).build()', 'broken?:NotificationDatabase.MIGRATION_13_14,NotificationDatabase.MIGRATION_14_15,NotificationDatabase.MIGRATION_15_16).build()')
        text = text.replace('assertEquals(14,','assertEquals(16,').replace('inspect(f,14)','inspect(f,16)').replace('inspect(backup,14)','inspect(backup,16)')
        text = text.replace('NineToFourteen','NineToSixteen').replace('DEVICE-MIGRATION-9-14','DEVICE-MIGRATION-9-16').replace('.put("new_schema",14)', '.put("new_schema",16)').replace('.put("retry",14)', '.put("retry",16)')
    if path.name == 'qa.init.gradle':
        text = text.replace("d.defaultConfig.testApplicationId=", "d.buildTypes.getByName('debug').applicationIdSuffix='.qa.financep04closure'\n    d.defaultConfig.testApplicationId=")
    path.write_text(text,encoding='utf8',newline='\n')
    adaptations.append({'file':path.relative_to(OUT).as_posix(),'original_sha256':hashlib.sha256(before).hexdigest(),
                        'qa_sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
tests = QA/'test/uk/thewyj/app/qa/finance'
shutil.copy2(ROOT/'qa/finance-p04/closure/FinanceP04MoneyDeviceTest.kt',tests/'FinanceP04MoneyDeviceTest.kt')
backup_source = ROOT/'docs/migration-evidence/finance-p04/local/backup-proof-source/kotlin/CurrencyP04BackupTest.kt'
backup = backup_source.read_text(encoding='utf8')
backup = backup.replace('import org.robolectric.RobolectricTestRunner','import androidx.test.ext.junit.runners.AndroidJUnit4').replace('import org.robolectric.RuntimeEnvironment','import androidx.test.platform.app.InstrumentationRegistry').replace('import org.robolectric.annotation.Config\n','')
backup = backup.replace('@RunWith(RobolectricTestRunner::class)\n@Config(sdk=[34],application=Application::class)','@RunWith(AndroidJUnit4::class)')
backup = backup.replace('RuntimeEnvironment.getApplication()','InstrumentationRegistry.getInstrumentation().targetContext')
backup = backup.replace('File(System.getProperty("finance.p02.output"))','File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir,"finance-p04-closure/cold-proof")')
if args.backup_suffix:
    assert backup.count('finance-p04-closure/cold-proof')==1
    backup=backup.replace('finance-p04-closure/cold-proof','finance-p04-closure/cold-proof-'+args.backup_suffix)
backup = backup.replace('ProcessHandle.current().pid()','android.os.Process.myPid().toLong()').replace('independentJvm','independentDeviceProcess')
backup = backup.replace('formal personal backup and device restore NOT_TESTED','synthetic Samsung cold restore; formal personal backup NOT_TESTED')
needle='target.writeText(manifest.toString(2))'
assert needle in backup
backup = backup.replace(needle,needle+'\n  assertEquals(setOf("$BACKUP_OWNER:default"),context.getSharedPreferences("wyj-currency-context",0).all.keys)\n  assertTrue(context.deleteSharedPreferences("wyj-currency-context")) // Owned QA fixture only, before session setup.')
backup = backup.replace('val mainFile=File(context.cacheDir,"m.db");val fxFile=File(context.cacheDir,"f.db");val queueFile=File(context.cacheDir,"q.queue")', 'val mainFile=File(context.cacheDir,"m-${android.os.Process.myPid()}.db");val fxFile=File(context.cacheDir,"f-${android.os.Process.myPid()}.db");val queueFile=File(context.cacheDir,"q-${android.os.Process.myPid()}.queue")')
(tests/'CurrencyP04BackupTest.kt').write_text(backup,encoding='utf8')
adaptations.append({'file':(tests/'CurrencyP04BackupTest.kt').relative_to(OUT).as_posix(),'original_sha256':hashlib.sha256(backup_source.read_bytes()).hexdigest(),'qa_sha256':hashlib.sha256(backup.encode()).hexdigest(),'reason':'Real Android runner, two process IDs, app-private paths; delete only backup-owned preference fixture before normal login; all money/receipt/manifest assertions retained'})
sources = OUT / 'build-sources/main'
changes = {}
manifest = {}
for path in (ROOT/'android/app/src/main/java').rglob('*'):
    if not path.is_file(): continue
    before = path.read_bytes()
    text = before.decode('utf8')
    original = text
    if path.name in {'ThewyjNotificationListenerService.kt','ThewyjPaymentAccessibilityService.kt','ThewyjWebView.kt'}:
        text = text.replace('\r\n','\n')
    if path.name == 'ThewyjNotificationListenerService.kt':
        text = text.replace('        super.onListenerConnected()', '        super.onListenerConnected()\n        if (!uk.thewyj.app.qa.finance.FinanceDeviceGate.enabled(this)) return\n        uk.thewyj.app.qa.finance.FinanceDeviceGate.connected(this)')
        text = text.replace('runCatching { activeNotifications }','runCatching { uk.thewyj.app.qa.finance.FinanceDeviceGate.activeSynthetic(this) }')
        start = text.index('        val observer = screenshotObserver')
        end = text.index('        registerNetworkRetry()', start)
        text = text[:start]+'        // QA: exclude MediaStore and unrelated image access.\n'+text[end:]
        marker = '        val notification = sbn ?: return'
        text = text.replace(marker, marker+'\n        if (!uk.thewyj.app.qa.finance.FinanceDeviceGate.allow(this, notification)) return\n        uk.thewyj.app.qa.finance.FinanceDeviceGate.observed(this, notification)',1)
        marker = '    override fun onNotificationRemoved(sbn: StatusBarNotification?) {\n        val notification = sbn ?: return'
        assert marker in text
        text = text.replace(marker, marker+'\n        if (!uk.thewyj.app.qa.finance.FinanceDeviceGate.allow(this, notification)) return\n        uk.thewyj.app.qa.finance.FinanceDeviceGate.observed(this, notification, true)')
    if path.name == 'ThewyjPaymentAccessibilityService.kt':
        text = text.replace('        val e = event ?: return','        val e = event ?: return\n        if (!uk.thewyj.app.qa.finance.FinanceDeviceGate.allowAccessibility(this, e.packageName?.toString().orEmpty())) return')
        text = text.replace('    private fun queueRead(pkg: String, eventWindow: Int?) {','    private fun queueRead(pkg: String, eventWindow: Int?) {\n        if (!uk.thewyj.app.qa.finance.FinanceDeviceGate.allowAccessibility(this, pkg)) return')
    if path.name == 'ThewyjWebView.kt':
        marker = '    webViewClient = object : WebViewClient() {'
        assert marker in text
        text = text.replace(marker, marker+'''\n        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): android.webkit.WebResourceResponse? {
            if (request.url.scheme in setOf("http", "https") && request.url.host !in setOf("localhost", "127.0.0.1"))
                return android.webkit.WebResourceResponse("text/plain","UTF-8",403,"QA scope",emptyMap(),java.io.ByteArrayInputStream(byteArrayOf()))
            return super.shouldInterceptRequest(view,request)
        }
''')
    target = sources / path.relative_to(ROOT/'android/app/src/main/java')
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_bytes(before if text == original else text.encode('utf8'))
    name = path.relative_to(ROOT).as_posix()
    manifest[name] = {'product_sha256':hashlib.sha256(before).hexdigest(),'qa_sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
    if text != original: changes[name] = 'QA entry privacy restriction only'
assert len(changes) == 3
assert manifest['android/app/src/main/java/uk/thewyj/app/MainActivity.kt']['product_sha256'] == manifest['android/app/src/main/java/uk/thewyj/app/MainActivity.kt']['qa_sha256']
generated = OUT/'generated-res/raw'
generated.mkdir(parents=True)
private = OUT/'private'
private.mkdir()
openssl = Path('C:/Program Files/Git/usr/bin/openssl.exe')
if args.reuse_ca:
    previous=ROOT/'docs/migration-evidence/finance-p04/closure-current/device-final'
    subprocess.run([str(openssl),'x509','-checkend','1','-noout','-in',str(previous/'generated-res/raw/p03_device_ca.pem')],check=True,stdout=subprocess.DEVNULL)
    shutil.copy2(previous/'private/localhost.key',private/'localhost.key')
    shutil.copy2(previous/'generated-res/raw/p03_device_ca.pem',generated/'p03_device_ca.pem')
else:
    subprocess.run([str(openssl),'req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(private/'localhost.key'),
                    '-out',str(generated/'p03_device_ca.pem'),'-days','2','-subj','/CN=localhost',
                    '-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
result = {'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
          'package':PKG,'test_package':PKG+'.p03acceptance','main_activity_unchanged':True,
          'source_files':manifest,'qa_only_product_overlays':changes,'harness_adaptations':adaptations,
          'current_privacy_scope':'Synthetic owned tags and own windows only; real WeChat gate not yet enabled',
          'private_key_logged':False,'formal_app_touched':False}
(OUT/'source-overlay.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps({'sources':len(manifest),'overlays':len(changes),'package':PKG,'MainActivity':'unchanged'}))
