"""Generate a reproducible privacy overlay; never edit product sources."""
from pathlib import Path
import hashlib,json,shutil
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p03/device'
DEST=OUT/'build-sources/main'
assert not DEST.exists()
changes={};manifest={}
for p in (ROOT/'android/app/src/main/java').rglob('*'):
 if not p.is_file():continue
 relative=p.relative_to(ROOT/'android/app/src/main/java');data=p.read_bytes();text=data.decode('utf8')
 original=text
 if p.name in {'ThewyjNotificationListenerService.kt','ThewyjPaymentAccessibilityService.kt','ThewyjWebView.kt'}:text=text.replace('\r\n','\n')
 if p.name=='ThewyjNotificationListenerService.kt':
  text=text.replace('        super.onListenerConnected()','        super.onListenerConnected()\n        if (!uk.thewyj.app.qa.finance.FinanceDeviceGate.enabled(this)) return\n        uk.thewyj.app.qa.finance.FinanceDeviceGate.connected(this)')
  text=text.replace('runCatching { activeNotifications }','runCatching { uk.thewyj.app.qa.finance.FinanceDeviceGate.activeSynthetic(this) }')
  start=text.index('        val observer = screenshotObserver');end=text.index('        registerNetworkRetry()',start)
  text=text[:start]+'        // QA: no MediaStore observation or image access.\n'+text[end:]
  # Gate using package/tag metadata before captureInput touches any extras.
  text=text.replace('        val notification = sbn ?: return','        val notification = sbn ?: return\n        if (!uk.thewyj.app.qa.finance.FinanceDeviceGate.allow(this, notification)) return\n        uk.thewyj.app.qa.finance.FinanceDeviceGate.observed(this, notification)',1)
  marker='    override fun onNotificationRemoved(sbn: StatusBarNotification?) {\n        val notification = sbn ?: return'
  assert marker in text
  text=text.replace(marker,marker+'\n        if (!uk.thewyj.app.qa.finance.FinanceDeviceGate.allow(this, notification)) return\n        uk.thewyj.app.qa.finance.FinanceDeviceGate.observed(this, notification, true)')
 if p.name=='ThewyjPaymentAccessibilityService.kt':
  text=text.replace('        val e = event ?: return','        val e = event ?: return\n        if (!uk.thewyj.app.qa.finance.FinanceDeviceGate.allowAccessibility(this, e.packageName?.toString().orEmpty())) return')
  text=text.replace('    private fun queueRead(pkg: String, eventWindow: Int?) {','    private fun queueRead(pkg: String, eventWindow: Int?) {\n        if (!uk.thewyj.app.qa.finance.FinanceDeviceGate.allowAccessibility(this, pkg)) return')
 if p.name=='ThewyjWebView.kt':
  marker='    webViewClient = object : WebViewClient() {'
  assert marker in text
  text=text.replace(marker,marker+'''\n        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): android.webkit.WebResourceResponse? {
            if (request.url.scheme in setOf("http", "https") && request.url.host !in setOf("localhost", "127.0.0.1"))
                return android.webkit.WebResourceResponse("text/plain","UTF-8",403,"QA scope",emptyMap(),java.io.ByteArrayInputStream(byteArrayOf()))
            return super.shouldInterceptRequest(view,request)
        }
''')
 target=DEST/relative;target.parent.mkdir(parents=True,exist_ok=True)
 target.write_bytes(data if text==original else text.encode('utf8'))
 name=p.relative_to(ROOT).as_posix();manifest[name]={'product_sha256':hashlib.sha256(data).hexdigest(),'qa_sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
 if text!=original:changes[name]={'reason':'QA privacy gate only; source pipeline, identity, money and lifecycle implementation retained','copy':target.relative_to(ROOT).as_posix()}
assert len(changes)==3,changes
(OUT/'source-overlay.json').write_text(json.dumps({'baseline':'976eed4644556e70266fe0ef5e54b7c8e419d0ba','files':manifest,'qa_only_changes':changes},indent=2),encoding='utf8')
print(json.dumps({'copied_product_sources':len(manifest),'privacy_overlay_files':len(changes),'MainActivity_unchanged':True}))
