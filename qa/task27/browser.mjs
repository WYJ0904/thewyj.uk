import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {Miniflare} from 'miniflare';
import {CdpClient,openPage,delay} from '../../local-backend/browser_harness.mjs';
import {onRequest as apiRequest} from '../../functions/api/[[path]].js';
import {onRequest as statusRequest} from '../../functions/api/status.js';
import {policyPage} from '../../functions/_lib/task27-policy.mjs';
import {hashSecret} from '../../functions/_lib/task12-crypto.mjs';
import {isAllowedPagesFile} from '../../scripts/stage_pages_deploy.mjs';
import {createAdminMessage} from '../../functions/_lib/task18-service.mjs';
import {userById} from '../../functions/_lib/task12-service.mjs';
import {accountPayload} from '../../functions/_lib/task12-model.mjs';
import {totpAt} from '../../functions/_lib/task27-crypto.mjs';
import {emailCenterIntegrated} from '../../functions/_lib/task27-email-adapter.mjs';

const root=path.resolve(import.meta.dirname,'../..'),run=crypto.randomUUID();
const jsQR=createRequire(import.meta.url)(path.join(root,'.wrangler/task27-reference/otpauth-lab/node_modules/jsqr/dist/jsQR.js'));
const out=path.join(root,'.wrangler/task27-ui',run);await mkdir(out,{recursive:true});
const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('fixture')}}",compatibilityDate:'2026-08-06',d1Databases:['WYJ_DB'],r2Buckets:['WYJ_STORAGE']});
const db=await mf.getD1Database('WYJ_DB');
const config=JSON.parse(await readFile(path.join(root,'wrangler.jsonc'),'utf8'));
const password='Synthetic-Task27-Browser-Password!';
const env={...config.env.preview.vars,WYJ_DB:db,WYJ_STORAGE:await mf.getR2Bucket('WYJ_STORAGE'),WYJ_ENVIRONMENT:'development',WORKERS_AI_ENABLED:'false',TTS_MODE:'cache-only',TASK27_SECURITY_ENABLED:'true',EMAIL_SENDING_ENABLED:'true',
  WYJ_TASK12_PASSWORD_PEPPER:'task27-browser-synthetic-pepper-0123456789',WYJ_TASK14_TEMPORARY_SECRET:'task27-browser-synthetic-share-secret-0123456789',WYJ_TASK20_DEVICE_SESSION_SECRET:'task27-browser-synthetic-device-0123456789',
  WYJ_TASK27_CHALLENGE_SECRET:'task27-browser-synthetic-challenge-0123456789',WYJ_TASK27_TOTP_KEY:Buffer.alloc(32,7).toString('base64url'),EMAIL:{async send(){return {messageId:crypto.randomUUID(),queued:[{}]};}}};
// Only this synthetic transport is enabled. A configured Preview recipient
// allowlist must never be edited in order to run the local fixture.
env.EMAIL_TEST_RECIPIENTS='fixture@example.test';env.EMAIL_TRANSPORT='binding';
for(const name of (await readdir(path.join(root,'cloudflare/migrations'))).filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort())await db.exec((await readFile(path.join(root,'cloudflare/migrations',name),'utf8')).replace(/\r?\n/g,' '));
const when=new Date().toISOString();
for(const [id,role]of [['fixture-owner','super_admin'],['mail-fixture','user']])await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at) VALUES(?1,?1,?1,?2,'pbkdf2_sha256',310000,?3,?4,?4,?4,?4)`).bind(id,await hashSecret(password,env.WYJ_TASK12_PASSWORD_PEPPER),role,when).run();
await db.prepare(`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at) VALUES('legacy-browser','legacy-browser','legacy-browser',?1,'pbkdf2_sha256',310000,'user','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')`).bind(await hashSecret('123456',env.WYJ_TASK12_PASSWORD_PEPPER)).run();
await db.prepare("INSERT INTO task27_security(user_id,verified_email,email_verified_at,password_age_start_at) VALUES('mail-fixture','fixture@example.test',?1,?1)").bind(when).run();
let registerCalls=0;
let lastEnrollment=null;
let profileDelayMs=0;
const apiErrors=[];
const spa=new Set(['/','/login','/register','/account','/admin','/forgot-password','/changelog','/language','/recharge']);
const csp=(await readFile(path.join(root,'_headers'),'utf8')).match(/Content-Security-Policy: (.+)/)[1].trim();
let base;
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,base);
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    if(url.pathname.startsWith('/api/') || ['/terms','/privacy','/security-privacy'].includes(url.pathname)) {
      if(url.pathname==='/api/account/profile' && profileDelayMs)await delay(profileDelayMs);
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const request=new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
      const tasks=[],context={request,env,data:{requestId:crypto.randomUUID()},waitUntil(p){tasks.push(p);}};
      if(url.pathname==='/api/register')registerCalls++;
      const response=url.pathname==='/api/status'?await statusRequest(context):url.pathname==='/terms'?policyPage(context,'terms'):url.pathname==='/privacy'?policyPage(context,'privacy'):url.pathname==='/security-privacy'?policyPage(context,'security'):await apiRequest(context);
      if(url.pathname==='/api/security/mfa/start'&&response.ok){const enrollment=await response.clone().json();if(enrollment.method==='totp')lastEnrollment={secret:enrollment.secret,uri:enrollment.otpauth_uri};}
      if(response.status>=500)apiErrors.push({path:url.pathname,status:response.status,code:(await response.clone().json()).code});
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));await Promise.all(tasks);return;
    }
    const file=spa.has(url.pathname)?'index.html':url.pathname.slice(1);
    if(!isAllowedPagesFile(file)||file.startsWith('functions/')){res.writeHead(404);res.end();return;}
    const mime=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.png')?'image/png':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.webmanifest')?'application/manifest+json':'application/octet-stream';
    res.writeHead(200,{'Content-Type':mime,'Content-Security-Policy':csp,'Cache-Control':'no-store','Service-Worker-Allowed':'/'});res.end(await readFile(path.join(root,file)));
  } catch(error){res.writeHead(500);res.end('isolated fixture error');console.error(error.name+': '+error.message);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(path.join(os.tmpdir(),'aeris-task27-chrome-'));
const chrome=process.env.AERIS_TEST_CHROME || process.env.CHROME_BIN || (process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'google-chrome');
const child=spawn(chrome,['--headless=new',...(process.platform==='linux'?['--no-sandbox','--disable-dev-shm-usage']:[]),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','about:blank'],{windowsHide:true,stdio:'ignore'});
let browser,page;
const proof={scope:'loopback Chrome, actual application UI, Node API dispatcher and isolated Miniflare D1; synthetic mail only',run,checks:[],screenshots:[],real_email:'NOT_TESTED',android_device:'OWNER_OPERATED_NOT_TESTED',hosted:'NOT_TESTED',production:'NOT_TOUCHED'};
async function check(name,fn){await fn();proof.checks.push({name,status:'PASS'});console.log('PASS '+name);}
async function screenshot(name){const capture=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(out,name+'.png'),Buffer.from(capture.data,'base64'));proof.screenshots.push(name+'.png');}
async function closeBroadcast(){await page.evaluate("(()=>{const b=document.querySelector('#siteMessageCloseBtn');if(b&&b.getClientRects().length)b.click();return true})()");}
async function prompt(fields={}){await page.waitFor("!document.querySelector('#task27Prompt')?.classList.contains('hidden')",15000,'security prompt');if(Object.keys(fields).length)await page.setFields(Object.fromEntries(Object.entries(fields).map(([name,value])=>[`#task27Prompt [name=${name}]`,value])));await page.click('#task27Prompt button[type=submit]');}
try {
  let port;for(let i=0;i<100&&!port;i++){try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch(_){await delay(100);}}
  assert.ok(port,'isolated Chrome starts');const cdpUrl=`http://127.0.0.1:${port}`;
  const version=await fetch(cdpUrl+'/json/version').then(r=>r.json());proof.browser=version.Browser;browser=new CdpClient(version.webSocketDebuggerUrl);await browser.connect();
  page=await openPage({cdpUrl,baseUrl:base,width:1440,height:1000,mobile:false});
  await check('registration consent is unchecked, required and linked to full policies',async()=>{
    await page.navigate('/register');await page.waitFor("document.querySelector('#registerForm')?.checkVisibility()",15000);
    assert.equal(await page.evaluate("document.querySelector('#registerTermsConsent').checked"),false);
    assert.equal(await page.evaluate("document.querySelectorAll('.task27-policy-consent a[href]').length"),3);
    await page.setFields({'#registerUsernameInput':'browser-fixture','#registerSecretInput':'Abcde1!x','#registerConfirmInput':'Abcde1!x'});await page.click('#registerTermsConsent');await page.click('#registerSubmitBtn');await delay(200);assert.equal(registerCalls,0);assert.equal(await page.evaluate("document.getElementById('registerSecretInput').checkValidity()"),false);
    assert.equal(await page.evaluate("document.querySelectorAll('#registerSecretInputRequirements li').length"),5);
    for(const value of ['abcdef12!','ABCDEF12!','Abcdefgh!','Abcdef123']){await page.setFields({'#registerSecretInput':value});assert.equal(await page.evaluate("document.getElementById('registerSecretInput').checkValidity()"),false);}
    await page.setFields({'#registerSecretInput':'Abcdef1!x'});assert.equal(await page.evaluate("document.querySelectorAll('#registerSecretInputRequirements li[data-met=true]').length"),5);assert.equal(await page.evaluate("document.getElementById('registerSecretInput').checkValidity()"),true);
    await page.click('#registerSecretInput + button');assert.equal(await page.evaluate("document.getElementById('registerSecretInput').type"),'text');await page.click('#registerSecretInput + button');assert.equal(await page.evaluate("document.getElementById('registerSecretInput').type"),'password');assert.equal(await page.evaluate("document.getElementById('registerSecretInput').autocomplete"),'new-password');
    assert.equal(await page.evaluate("(()=>{const input=document.getElementById('registerSecretInput'),event=new Event('paste',{bubbles:true,cancelable:true});return input.dispatchEvent(event)&&!event.defaultPrevented;})()"),true);
    await page.setFields({'#registerSecretInput':password,'#registerConfirmInput':password});await page.click('#registerTermsConsent');await page.click('#registerSubmitBtn');await delay(200);assert.equal(registerCalls,0);
    await page.evaluate("document.getElementById('registerForm').scrollIntoView({block:'center',behavior:'instant'})");await screenshot('password-policy-desktop');
    await page.send('Emulation.setDeviceMetricsOverride',{width:375,height:900,deviceScaleFactor:1,mobile:true});assert.equal(await page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),false);
    await page.evaluate(await readFile(path.join(root,'qa/p07-f/vendor/axe.min.js'),'utf8'));assert.deepEqual(await page.evaluate("axe.run(document.getElementById('registerForm')).then(r=>r.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})))"),[]);await screenshot('password-policy-mobile');
    await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await page.click('#registerTermsConsent');await page.click('#registerSubmitBtn');await page.waitFor("location.pathname==='/login'&&document.querySelector('#loginError').textContent.includes('注册成功')",30000);
    assert.equal(registerCalls,1);
  });
  await check('support footer, policy navigation and automatic copyright year',async()=>{
    const text=await page.evaluate("document.getElementById('siteHelpFooter').textContent");assert.ok(text.includes('回复邮件可能使用其他邮箱地址。'));assert.ok(text.includes('© 2025–2026 Aeris. All rights reserved.'));
    assert.equal(await page.evaluate("document.getElementById('siteHelpEmail').getAttribute('href')"),'mailto:support@thewyj.uk');
    assert.equal(await page.evaluate("document.getElementById('siteHelpFooter').textContent.includes('@gmail.com')"),false);
    await page.evaluate("import('/js/account/policy-page.js').then(m=>m.updateCopyrightYear(document,new Date('2031-02-01T00:00:00Z')))");assert.ok((await page.evaluate("document.getElementById('siteHelpFooter').textContent")).includes('© 2025–2031 Aeris. All rights reserved.'));
    await screenshot('registration-desktop');
  });
  await check('ordinary login and account security render in the existing shell',async()=>{
    await page.setFields({'#usernameInput':'browser-fixture','#secretInput':password});await page.click('#loginSubmitBtn');await page.waitFor("location.pathname==='/'&&document.getElementById('notificationBellBtn').checkVisibility()",45000);
    await closeBroadcast();await page.navigate('/account');await page.waitFor("document.getElementById('accountTabSecurity')?.checkVisibility()",20000);await page.click('#accountTabSecurity');await page.waitFor("document.getElementById('openSecurityCenterBtn').checkVisibility()",20000);await closeBroadcast();await page.click('#openSecurityCenterBtn');await page.waitFor("document.querySelector('[data-security-mfa=totp]')",20000);await screenshot('security-desktop');
  });
  let codes,secret;
  await check('TOTP setup uses local QR, requires confirmation and shows recovery codes once',async()=>{
    await page.click('[data-security-mfa=totp]');await prompt({password});await page.waitFor("document.querySelector('#task27TotpQr svg')",15000);
    secret=await page.evaluate("document.querySelector('.task27-key').textContent");
    assert.ok(lastEnrollment&&lastEnrollment.secret===secret,'manual key must be the actual server enrollment key');
    const qrPixels=await page.evaluate("(async()=>{const svg=document.querySelector('#task27TotpQr svg'),blob=new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}),url=URL.createObjectURL(blob);try{const img=new Image();img.src=url;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0);return{width:canvas.width,height:canvas.height,pixels:Array.from(ctx.getImageData(0,0,canvas.width,canvas.height).data)};}finally{URL.revokeObjectURL(url);}})()");
    const decoded=jsQR(new Uint8ClampedArray(qrPixels.pixels),qrPixels.width,qrPixels.height);assert.ok(decoded?.data===lastEnrollment.uri,'actual displayed QR must decode to the canonical URI');
    assert.ok((await page.evaluate("document.getElementById('task27OpenAuthenticator').getAttribute('href')"))===lastEnrollment.uri,'link must use exactly the displayed QR URI');
    assert.equal(await page.evaluate("document.getElementById('task27OpenAuthenticator').rel.includes('noreferrer')"),true);
    await page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__syntheticCopiedTotp=value;}}});true");await page.click('#task27CopyTotpSecret');await page.waitFor("window.__syntheticCopiedTotp!==undefined",5000);assert.ok((await page.evaluate('window.__syntheticCopiedTotp'))===secret,'copy action must use the canonical setup key');await page.evaluate('delete window.__syntheticCopiedTotp;true');
    const historyBefore=await page.send('Page.getNavigationHistory');await page.evaluate("document.getElementById('task27OpenAuthenticator').addEventListener('click',event=>event.preventDefault(),{once:true});true");await page.click('#task27OpenAuthenticator');assert.ok((await page.evaluate("document.getElementById('task27AuthenticatorFallback').textContent")).includes('手动复制密钥'));const historyAfter=await page.send('Page.getNavigationHistory');assert.equal(historyAfter.entries.length,historyBefore.entries.length);
    proof.authenticator_link='canonical URI and manual fallback verified; OS launch intentionally handed to owner/device acceptance';
    await prompt({code:await totpAt(secret,Math.floor(Date.now()/30000))});
    await page.waitFor("document.querySelector('#task27Secrets .task27-codes')",20000);
    codes=(await page.evaluate("document.querySelector('#task27Secrets .task27-codes').textContent")).split('\n');assert.equal(codes.length,10);
    await page.click('[data-saved-codes]');await page.click('[data-finish-codes]');
    await page.waitFor("location.pathname==='/login'",15000);
    assert.equal(await page.evaluate("document.querySelector('#task27Secrets .task27-codes')===null"),true);
  });
  await check('MFA login completes before the application stores a full session',async()=>{
    await page.setFields({'#usernameInput':'browser-fixture','#secretInput':password});await page.click('#loginSubmitBtn');
    await page.waitFor("!document.querySelector('#task27Prompt')?.classList.contains('hidden')",20000);
    assert.equal(await page.evaluate("Boolean(localStorage.getItem('wyjAccountSession'))"),false);
    await prompt({code:codes[0]});await page.waitFor("location.pathname==='/'&&document.getElementById('notificationBellBtn').checkVisibility()",45000);await closeBroadcast();
  });
  await check('read-all confirms the server count and preserves explicit acknowledgement',async()=>{
    const user=await db.prepare("SELECT id FROM task12_users WHERE username_normalized='browser-fixture'").first();
    await createAdminMessage(db,accountPayload(await userById(db,'fixture-owner')),{title:'Synthetic policy change',body:'Synthetic material policy notice',message_type:'important',target_scope:'single',target_user_ids:[user.id],delivery_channel:'inbox',purpose:'policy_change',requires_confirmation:true,idempotency_key:crypto.randomUUID()});
    await page.click('#notificationBellBtn');await page.waitFor("document.querySelector('[data-ack-id]')",20000);await page.click('[data-read-all]');
    await page.waitFor("document.querySelector('#task27Prompt input[type=checkbox]')",15000);assert.ok((await page.evaluate("document.querySelector('#task27Prompt').textContent")).includes('条消息'));
    await page.click('#task27Prompt input[type=checkbox]');await page.click('#task27Prompt button[type=submit]');await page.waitFor("document.querySelector('#task27Inbox .task27-inbox-list')&&!document.querySelector('#task27Inbox .is-unread')",15000);
    assert.ok(await page.evaluate("Boolean(document.querySelector('[data-ack-id]'))"));const receipt=await db.prepare("SELECT acknowledged_at,read_at FROM admin_message_receipts WHERE user_id=?1 AND read_at!='' LIMIT 1").bind(user.id).first();assert.equal(receipt.acknowledged_at,'');await screenshot('inbox-desktop');
  });
  await check('375px and 390px light and dark security layout wraps full status banner with zero clipping or horizontal overflow and passes axe',async()=>{
    await page.click('#task27Inbox [data-task27-close]');await page.navigate('/account');
    await page.waitFor("document.getElementById('accountTabSecurity')?.checkVisibility()",20000);await page.click('#accountTabSecurity');
    profileDelayMs=2400;
    await page.click('#openSecurityCenterBtn');await page.waitFor("document.querySelector('[data-security-mfa=totp]')",20000);
    await page.click('[data-security-mfa=email]');
    await page.waitFor("!document.querySelector('#task27Security [data-task27-status]').hidden&&document.querySelector('#task27Security [data-task27-status]').textContent.includes('绑定并验证邮箱')",10000);
    await page.waitFor("document.querySelector('[data-security-profile]')",12000);
    profileDelayMs=0;
    assert.equal(await page.evaluate("document.querySelector('#task27Prompt')?.checkVisibility() || false"),false);
    const assertStatusGeometry=async()=>{
      const geom=await page.evaluate(`(()=>{
        const box=document.querySelector('#task27Security [data-task27-status]'),panel=document.querySelector('#task27Security .task27-panel'),cs=getComputedStyle(box),br=box.getBoundingClientRect(),pr=panel.getBoundingClientRect();
        return{text:box.textContent.trim(),scrollW:box.scrollWidth,clientW:box.clientWidth,scrollH:box.scrollHeight,clientH:box.clientHeight,height:br.height,lineH:parseFloat(cs.lineHeight)||16,whiteSpace:cs.whiteSpace,textOverflow:cs.textOverflow,rightOk:br.right<=pr.right+1,leftOk:br.left>=pr.left-1};
      })()`);
      assert.equal(geom.whiteSpace,'normal');assert.equal(geom.textOverflow,'clip');
      assert.ok(geom.scrollW<=geom.clientW+1,'status banner must not horizontally clip');
      assert.ok(geom.scrollH<=geom.clientH+1,'status banner must not vertically clip');
      assert.ok(geom.height>geom.lineH*1.6,'long status banner must wrap across multiple lines');
      assert.ok(geom.rightOk&&geom.leftOk,'status banner must fit inside panel bounds');
      assert.ok(!geom.text.endsWith('…')&&!geom.text.endsWith('...'),'status banner must not end with truncation ellipsis');
    };
    await assertStatusGeometry();
    await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await assertStatusGeometry();await screenshot('security-status-390-light');
    await page.send('Emulation.setDeviceMetricsOverride',{width:375,height:900,deviceScaleFactor:1,mobile:true});
    for(const theme of ['light','dark']){
      await page.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      await page.evaluate("(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.all(document.getElementById('task27Security').getAnimations({subtree:true}).filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation=>animation.finished.catch(()=>{})));return true;})()");
      const colors=await page.evaluate("(()=>{const button=document.querySelector('[data-security-password]'),style=getComputedStyle(button);return{theme:document.documentElement.dataset.theme,color:style.color,background:style.backgroundColor};})()");(proof.theme_states||=[]).push(colors);
      assert.equal(await page.evaluate("document.documentElement.scrollWidth>innerWidth+1"),false);
      await assertStatusGeometry();
      await page.evaluate("(()=>{const box=document.querySelector('#task27Security [data-task27-status]');box.dataset.orig=box.textContent;box.textContent='步骤 2/3：已完成身份验证，正在向已验证邮箱 very.long.qa.verification+task27@example.test 请求发送开启验证码（当前双重验证方式尚未变更），请稍候。';return true;})()");
      await assertStatusGeometry();
      await page.evaluate("(()=>{const box=document.querySelector('#task27Security [data-task27-status]');if(box.dataset.orig){box.textContent=box.dataset.orig;delete box.dataset.orig;}return true;})()");
      await page.evaluate(await readFile(path.join(root,'qa/p07-f/vendor/axe.min.js'),'utf8'));
      const axe=await page.evaluate("axe.run(document.querySelector('#task27Security')).then(r=>r.violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)})))");assert.deepEqual(axe,[]);await screenshot('security-mobile-'+theme);
    }
  });
  await check('three full policy pages are readable without authentication',async()=>{
    for(const [route,title]of [['/terms','Aeris 使用条款'],['/privacy','Aeris 隐私政策'],['/security-privacy','Aeris 安全与隐私说明']]){
      await page.send('Page.navigate',{url:base+route});await page.waitFor('document.querySelector(".policy-article h1")',15000);
      assert.equal(await page.evaluate('document.querySelector(".policy-article h1").textContent'),title);
      assert.equal(await page.evaluate('document.body.textContent.includes("第四部分")'),false);
      assert.equal(await page.evaluate('document.body.textContent.includes("@gmail.com")'),false);
      assert.equal(await page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),false);
    }
    await screenshot('policy-mobile');
  });
  await page.close();page=await openPage({cdpUrl,baseUrl:base,width:1440,height:1000,mobile:false});
  await check('public recovery route offers password and lost-factor recovery with all three proof methods',async()=>{
    await page.navigate('/forgot-password');await page.waitFor("document.getElementById('task27Recovery')?.checkVisibility()",15000);
    assert.equal(await page.evaluate("document.querySelectorAll('#task27Recovery [data-forgot-password],#task27Recovery [data-lost-mfa]').length"),2);
    await page.click('#task27Recovery [data-forgot-password]');await page.waitFor("document.getElementById('task27ResetMethod')",15000);
    assert.deepEqual(await page.evaluate("[...document.getElementById('task27ResetMethod').options].map(option=>option.value)"),['email','totp','recovery']);
    assert.equal(await page.evaluate("Boolean(document.querySelector('#task27Prompt [name=email]')?.required&&document.querySelector('#task27Prompt [name=email]')?.checkVisibility())"),true);
    await page.evaluate("(()=>{const s=document.getElementById('task27ResetMethod');s.value='totp';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
    assert.equal(await page.evaluate("Boolean(document.querySelector('#task27Prompt [name=email]')?.required||document.querySelector('#task27Prompt [name=email]')?.checkVisibility())"),false);
    await page.evaluate("(()=>{const s=document.getElementById('task27ResetMethod');s.value='email';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
    assert.equal(await page.evaluate("Boolean(document.querySelector('#task27Prompt [name=email]')?.required&&document.querySelector('#task27Prompt [name=email]')?.checkVisibility())"),true);
    await screenshot('recovery-route-desktop');await page.close();page=await openPage({cdpUrl,baseUrl:base,width:1440,height:1000,mobile:false});
  });
  await check('old six-character password stays usable in the actual Web login form without MFA enforcement',async()=>{
    await page.navigate('/login');await page.setFields({'#usernameInput':'legacy-browser','#secretInput':'123456'});await page.click('#loginSubmitBtn');await page.waitFor("location.pathname==='/'&&document.getElementById('notificationBellBtn').checkVisibility()",45000);await closeBroadcast();assert.equal(await page.evaluate("document.querySelector('#task27Prompt')?.checkVisibility() || false"),false);await page.close();page=await openPage({cdpUrl,baseUrl:base,width:1440,height:1000,mobile:false});
  });
  await check('administrator mail draft, preview, confirmation and queued status work in the selected canonical UI',async()=>{
    await page.navigate('/login');await page.setFields({'#usernameInput':'fixture-owner','#secretInput':password});await page.click('#loginSubmitBtn');await page.waitFor("location.pathname==='/'&&document.getElementById('notificationBellBtn').checkVisibility()",45000);await closeBroadcast();
    await page.navigate('/admin');await page.waitFor("document.getElementById('adminMessagesTab').checkVisibility()",25000);
    if(emailCenterIntegrated()){
      await page.click('#adminMessagesTab');assert.equal(await page.evaluate("document.getElementById('task27MailOpenBtn').checkVisibility()"),false);
      await page.click('[data-admin-view="adminEmailView"]');await page.waitFor("document.querySelector('[data-email-subtab=compose]')",20000);await page.click('[data-email-subtab=compose]');
      await page.waitFor("document.querySelector('[data-select-recipient=mail-fixture]')",20000);await page.click('[data-select-recipient=mail-fixture]');
      await page.setFields({'#adminEmailSubjectInput':'Synthetic service notice','#adminEmailBodyInput':'Synthetic UI communication only.'});await page.click('#adminEmailSaveDraftBtn');
      await page.waitFor("document.getElementById('adminEmailCenterStatus').textContent.includes('已保存')",15000);await page.click('#adminEmailPreviewBtn');await page.waitFor("document.getElementById('adminEmailConfirmCheckbox')",15000);await page.click('#adminEmailConfirmCheckbox');await page.click('#adminEmailConfirmSendBtn');await prompt({password});
      await page.waitFor("document.getElementById('adminEmailCenterStatus').textContent.includes('排队 1')",20000);assert.equal(await page.evaluate("Boolean(document.getElementById('task27MailForm'))"),false);await screenshot('mail-center-desktop');return;
    }
    await page.click('#adminMessagesTab');await page.click('#task27MailOpenBtn');await page.waitFor("document.getElementById('task27MailForm')",20000);
    await page.setFields({'#task27MailSearch':'mail-fixture'});await page.click('[data-mail-search]');await page.waitFor("document.querySelector('#task27MailRecipients input')",15000);await page.click('#task27MailRecipients input');
    await page.setFields({'#task27MailForm [name=subject]':'Synthetic service notice','#task27MailForm [name=body]':'Synthetic UI communication only.'});await page.click('#task27MailForm button[type=submit]');await page.waitFor("document.querySelector('[data-mail-preview]')",15000);await page.click('[data-mail-preview]');await page.waitFor("document.querySelector('#task27Prompt input[type=checkbox]')",15000);await page.click('#task27Prompt input[type=checkbox]');await page.click('#task27Prompt button[type=submit]');await prompt({password});
    await page.waitFor("document.querySelector('.task27-mail-records')?.textContent.includes('服务排队中')",20000);assert.ok((await page.evaluate("document.querySelector('#task27Mail').textContent")).includes('发送状态不代表抵达收件箱'));await screenshot('mail-desktop');
  });
  proof.status='PASS';
} catch(error){proof.status='FAIL';proof.error=error.message;process.exitCode=1;if(page)await screenshot('failure').catch(()=>{});console.error(error.stack);}
finally {
  proof.runtime_errors=page?.runtimeErrors || [];proof.api_errors=apiErrors;
  await writeFile(path.join(out,'result.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({status:proof.status,checks:proof.checks.length,evidence:path.relative(root,out),error:proof.error}));
  await page?.close().catch(()=>{});browser?.close();child.kill();await new Promise(resolve=>server.close(resolve));await mf.dispose();await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:300}).catch(()=>{});
}
