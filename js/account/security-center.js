import { updateCopyrightYear } from './policy-page.js?release=20261117-aeris-task28-release';
import { POLICY_VERSIONS } from './policy-version.js?release=20261117-aeris-task28-release';
import { wireNewPasswordField,wirePasswordVisibility } from './password-fields.js?release=20261117-aeris-task28-release';

const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Date(value).toLocaleString():'尚无记录';
const labels={none:'未开启',email:'邮箱验证码',totp:'TOTP 验证器'};
const eventLabels={password_changed:'登录密码已修改',password_reset:'管理员已重置密码',password_recovered:'账户密码已恢复',email_changed:'绑定邮箱已变更',mfa_enabled:'双重验证已开启',mfa_disabled:'双重验证已关闭',mfa_changed:'双重验证方式已变更',mfa_recovered:'已通过独立程序恢复双重验证',recovery_used:'一次性恢复码已使用',recovery_regenerated:'恢复码已重新生成',session_revoked:'登录会话已撤销',refresh_reuse:'检测到刷新凭据重复使用'};
const mailLabels={draft:'草稿',sending:'处理中，结果待核实',sent:'已提交邮件服务',partial:'部分投递待处理',accepted:'服务已接受',queued:'服务排队中',provider_delivered:'收件服务器已接受',failed:'发送失败，可受控重试',rejected:'服务已拒绝',unknown:'发送结果未知，需人工核实',pending:'待发送'};

const BACKUP_FORMAT='aeris-encrypted-backup';
const BACKUP_CONTAINER_VER=1;
const BACKUP_SCHEMA_VER='aeris.backup.v1';
const BACKUP_MAX_BYTES=16*1024*1024;
const backupEnc=new TextEncoder();
const backupDec=new TextDecoder('utf-8',{fatal:true});

function backupCanonicalJson(value) {
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(backupCanonicalJson).join(',')}]`;
  const pairs=[];
  for(const k of Object.keys(value).sort()) {
    if(value[k]===undefined)continue;
    pairs.push(`${JSON.stringify(k)}:${backupCanonicalJson(value[k])}`);
  }
  return `{${pairs.join(',')}}`;
}
async function backupSha256Hex(input) {
  const bytes=typeof input==='string'?backupEnc.encode(input):new Uint8Array(input);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
function backupBytesToB64(bytes) {
  const view=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  let bin='';
  for(let i=0;i<view.length;i+=0x8000)bin+=String.fromCharCode(...view.subarray(i,i+0x8000));
  return btoa(bin);
}
function backupB64ToBytes(b64) {
  const bin=atob(String(b64||'').trim());
  const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i+=1)bytes[i]=bin.charCodeAt(i);
  return bytes;
}
function backupAad(h) {
  return backupEnc.encode(backupCanonicalJson({
    format:String(h.format||''),
    container_version:Number(h.container_version||0),
    schema_version:String(h.schema_version||''),
    account_id_sha256:String(h.account_id_sha256||''),
    export_id:String(h.export_id||''),
    created_at:String(h.created_at||''),
    manifest_sha256:String(h.manifest_sha256||''),
  }));
}
async function deriveClientBackupKey(passphrase,salt,iterations,usages) {
  if(iterations<=100000) {
    const base=await crypto.subtle.importKey('raw',backupEnc.encode(passphrase),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations},base,{name:'AES-GCM',length:256},false,usages);
  }
  let rem=iterations,cur=backupEnc.encode(passphrase);
  while(rem>0) {
    const chunk=Math.min(100000,rem);
    const key=await crypto.subtle.importKey('raw',cur,'PBKDF2',false,['deriveBits']);
    cur=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:chunk},key,256));
    rem-=chunk;
  }
  return crypto.subtle.importKey('raw',cur,{name:'AES-GCM',length:256},false,usages);
}
async function clientEncryptEnvelope(envelope,passphrase) {
  if(typeof passphrase!=='string'||passphrase.length<10||passphrase.length>256)throw new Error('备份口令需在 10 到 256 个字符之间');
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const iterations=100000;
  const key=await deriveClientBackupKey(passphrase,salt,iterations,['encrypt']);
  const header={
    format:BACKUP_FORMAT,
    container_version:BACKUP_CONTAINER_VER,
    schema_version:String(envelope.schema_version||BACKUP_SCHEMA_VER),
    account_id_sha256:String(envelope.account_binding?.account_id_sha256||''),
    export_id:String(envelope.export_id||''),
    created_at:String(envelope.created_at||''),
    manifest_sha256:String(envelope.manifest_sha256||''),
  };
  const plain=backupEnc.encode(JSON.stringify(envelope));
  if(plain.byteLength>BACKUP_MAX_BYTES)throw new Error('备份体积超过 16 MiB 单包上限');
  const cipherBuf=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:backupAad(header),tagLength:128},key,plain);
  return {
    format:BACKUP_FORMAT,
    container_version:BACKUP_CONTAINER_VER,
    schema_version:header.schema_version,
    export_id:header.export_id,
    created_at:header.created_at,
    account_binding:{account_id_sha256:header.account_id_sha256,binding_version:1},
    manifest_sha256:header.manifest_sha256,
    privacy_declaration:envelope.privacy_declaration||{},
    crypto:{
      cipher:'AES-256-GCM',
      kdf:'PBKDF2-HMAC-SHA256',
      iterations,
      salt_b64:backupBytesToB64(salt),
      iv_b64:backupBytesToB64(iv),
      tag_bits:128,
      aad_fields:['format','container_version','schema_version','account_id_sha256','export_id','created_at','manifest_sha256'],
    },
    ciphertext_b64:backupBytesToB64(new Uint8Array(cipherBuf)),
  };
}
async function clientDecryptContainer(container,passphrase) {
  if(!container||container.format!==BACKUP_FORMAT)throw new Error('不是有效的 Aeris 加密备份容器');
  if(container.container_version!==BACKUP_CONTAINER_VER)throw new Error(`不支持的加密容器版本：${container.container_version}`);
  if(typeof passphrase!=='string'||passphrase.length<10)throw new Error('请输入至少 10 位解密口令');
  const cm=container.crypto||{};
  if(cm.cipher!=='AES-256-GCM'||cm.kdf!=='PBKDF2-HMAC-SHA256')throw new Error('加密算法 metadata 无效');
  const iterations=Number(cm.iterations);
  if(!Number.isSafeInteger(iterations)||iterations<100000||iterations>600000)throw new Error('KDF 迭代参数不在安全允许范围内');
  const salt=backupB64ToBytes(cm.salt_b64),iv=backupB64ToBytes(cm.iv_b64),cipher=backupB64ToBytes(container.ciphertext_b64);
  if(salt.byteLength!==16||iv.byteLength!==12||cipher.byteLength<16)throw new Error('加密容器头部参数损坏');
  const aad=backupAad({
    format:container.format,
    container_version:container.container_version,
    schema_version:container.schema_version,
    account_id_sha256:container.account_binding?.account_id_sha256,
    export_id:container.export_id,
    created_at:container.created_at,
    manifest_sha256:container.manifest_sha256,
  });
  const key=await deriveClientBackupKey(passphrase,salt,iterations,['decrypt']);
  let buf;
  try{buf=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},key,cipher);}
  catch(_){throw new Error('本地解密验证失败：备份口令错误、密文或认证标签已损坏');}
  let env;
  try{env=JSON.parse(backupDec.decode(new Uint8Array(buf)));}
  catch(_){throw new Error('解密后的备份数据格式损坏');}
  const recomputedManifest=await backupSha256Hex(backupCanonicalJson(env.manifest));
  if(recomputedManifest!==container.manifest_sha256)throw new Error('清单摘要与加密容器头签名不匹配');
  return env;
}
function triggerBrowserDownload(filename,content,mime) {
  const blob=new Blob([content],{type:mime});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=filename;a.rel='noopener';
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
}

export function ownerBoundRequest(request,getOwner) {
  const changed=()=>{const error=new Error('账户已切换，请重新打开账户安全中心');error.code='account_changed';return error;};
  return async(...args)=>{const owner=getOwner();try{const result=await request(...args);if(owner!==getOwner())throw changed();return result;}catch(error){if(owner!==getOwner())throw changed();throw error;}};
}

export function createSecurityCenter({api,apiGet,publicApi,getSession,getAccount,openModal,closeModal,onInvalidated,onNativeLogout=()=>{}}) {
  const $=id=>document.getElementById(id);
  let pendingPrompt=null,owner='',badgeAt=0,badgePromise=null,filter='all',page=1,inboxState=null,mailState=null,policyConfig=null,consentPromise=null,backupPrecheckState=null;
  const key=()=>`${getSession() || ''}:${getAccount()?.id || ''}`;
  api=ownerBoundRequest(api,key);apiGet=ownerBoundRequest(apiGet,key);
  function modal(id,title) {
    let node=$(id);
    if (!node) {
      node=document.createElement('div');node.id=id;node.className='modal-layer hidden task27-modal';node.setAttribute('aria-hidden','true');
      node.innerHTML=`<section class="modal-panel task27-panel" role="dialog" aria-modal="true" aria-labelledby="${id}Title"><button class="modal-close" type="button" data-task27-close aria-label="关闭">×</button><h2 id="${id}Title">${esc(title)}</h2><p class="error task27-status" data-task27-status data-tone="error" role="status" aria-live="polite" hidden></p><div data-task27-body></div></section>`;
      document.body.append(node);
      node.querySelector('[data-task27-close]').addEventListener('click',()=>closeModal(id,true));
      new MutationObserver(()=>{if(node.classList.contains('hidden')){if(id==='task27Prompt'&&pendingPrompt){pendingPrompt.reject(new Error('操作已取消'));pendingPrompt=null;}node.querySelectorAll('input[type=password],input[autocomplete=one-time-code]').forEach(input=>{input.value='';});if(id==='task29BackupModal'){backupPrecheckState=null;const fi=node.querySelector('#backupRestoreFileInput');if(fi)fi.value='';}if(id==='task27Secrets'||id==='task27Prompt')node.querySelector('[data-task27-body]').replaceChildren();}}).observe(node,{attributes:true,attributeFilter:['class']});
    }
    return node;
  }
  const body=node=>node.querySelector('[data-task27-body]');
  const status=(node,text,tone='error')=>{const box=node?.querySelector?.('[data-task27-status]');if(!box)return;box.textContent=text||'';box.dataset.tone=tone;box.className=tone==='info'?'task27-status is-info':'error task27-status is-error';box.hidden=!text;if(text){const panel=node.querySelector('.modal-panel');if(panel)panel.scrollTop=0;if(typeof box.scrollIntoView==='function')box.scrollIntoView({block:'nearest'});}};
  function bind(node,selector,callback) {node.querySelectorAll(selector).forEach(button=>button.addEventListener('click',async()=>{if(button.disabled)return;button.disabled=true;status(node,'');try{await callback(button);}catch(error){const cancelled=error?.message==='操作已取消';status(node,cancelled?'已取消当前验证步骤，未保存任何更改（当前登录状态保持不变）。':(error?.message||'操作失败'),cancelled?'info':'error');}finally{if(button.isConnected)button.disabled=false;}}));}
  async function prompt(title,fields,{message='',content='',button='继续',onMount=null}={}) {
    if(pendingPrompt){pendingPrompt.reject(new Error('操作已取消'));pendingPrompt=null;}
    const node=modal('task27Prompt',title);$('task27PromptTitle').textContent=title;status(node,'');
    body(node).innerHTML=`${message?`<p>${esc(message)}</p>`:''}${content}<form class="stack-form">${fields.map(field=>`<label class="field-label"><span>${esc(field.label)}</span><input name="${esc(field.name)}" type="${field.type || 'text'}" ${field.type==='checkbox'?'':'maxlength="256"'} ${field.autocomplete?`autocomplete="${esc(field.autocomplete)}"`:'autocomplete="off"'} ${field.required===false?'':'required'}></label>`).join('')}<button class="primary" type="submit">${esc(button)}</button></form>`;
    const promise=new Promise((resolve,reject)=>{pendingPrompt={resolve,reject};});
    body(node).querySelector('form').addEventListener('submit',event=>{event.preventDefault();const values={};for(const field of fields){const input=body(node).querySelector(`[name="${field.name}"]`);values[field.name]=field.type==='checkbox'?input.checked:input.value;}body(node).querySelectorAll('select[name]').forEach(select=>{values[select.name]=select.value;});const waiting=pendingPrompt;pendingPrompt=null;body(node).querySelectorAll('input').forEach(input=>{input.value='';input.checked=false;});closeModal('task27Prompt',true);waiting?.resolve(values);});
    body(node).querySelectorAll('input[type=password]').forEach(input=>{if(input.name==='new_secret')wireNewPasswordField(input);else wirePasswordVisibility(input);});
    if(typeof onMount==='function')onMount(body(node));
    openModal('task27Prompt');return promise;
  }
  async function codePrompt(method,title='完成安全验证') {return (await prompt(title,[{name:'code',label:method==='totp'?'六位验证器验证码或一次性恢复码':'六位邮件验证码',autocomplete:'one-time-code'}],{message:method==='email'?'验证码已交给邮件服务发送，请检查绑定邮箱。有效期约五分钟。':'请输入验证器当前验证码；无法使用验证器时，可输入一个未使用的恢复码。'})).code.trim();}
  async function stepup(scope,password) {
    const snapshot=key();
    if(password===undefined)password=(await prompt('重新验证身份',[{name:'password',label:'当前登录密码',type:'password',autocomplete:'current-password'}],{message:'本次授权仅用于当前操作，约五分钟有效，只能使用一次。'})).password;
    let result=await api('/api/security/stepup',{password,scope});password='';
    if(result.challenge)result=await api('/api/security/stepup/verify',{challenge:result.challenge,code:await codePrompt(result.method)});
    if(snapshot!==key())throw new Error('账户已切换，请重新开始');
    return result.grant;
  }
  async function completeLogin(result) {
    if(result.mfa_required)result=await publicApi('/api/security/login/verify',{challenge:result.challenge,code:await codePrompt(result.method,'登录双重验证')});
    if(result.password_change_required){
      const values=await prompt('设置新的登录密码',[{name:'new_secret',label:'新密码（至少 9 位混合密码）',type:'password',autocomplete:'new-password'},{name:'confirm_secret',label:'再次输入新密码',type:'password',autocomplete:'new-password'}],{message:'临时密码只能用于设置新密码。完成后请重新登录。'});
      await publicApi('/api/security/password/complete',{challenge:result.password_change_token,...values});
      throw new Error('密码已修改，请使用新密码重新登录');
    }
    return result;
  }
  async function showCodes(codes) {
    const node=modal('task27Secrets','妥善保存一次性恢复码');
    body(node).innerHTML=`<p>恢复码只显示这一次。每个码只能使用一次；重新生成会撤销全部旧码。请保存到安全位置。</p><pre class="task27-codes" tabindex="0">${codes.map(esc).join('\n')}</pre><button type="button" data-copy-codes>复制恢复码</button><label class="admin-checkbox"><input type="checkbox" data-saved-codes>我已安全保存恢复码</label><button type="button" class="primary" data-finish-codes disabled>完成</button>`;
    status(node,'');
    body(node).querySelector('[data-copy-codes]').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(codes.join('\n'));status(node,'已复制，请保存到安全位置。');}catch(_){status(node,'无法复制，请手动安全保存。');}});
    const done=body(node).querySelector('[data-finish-codes]');body(node).querySelector('[data-saved-codes]').addEventListener('change',event=>{done.disabled=!event.target.checked;});
    const finished=new Promise(resolve=>{const observer=new MutationObserver(()=>{if(node.classList.contains('hidden')){observer.disconnect();resolve();}});observer.observe(node,{attributes:true,attributeFilter:['class']});done.addEventListener('click',()=>closeModal('task27Secrets',true));});
    openModal('task27Secrets');await finished;
  }
  async function invalidate(result,message) {
    for(const id of ['task27Security','task27Inbox','task27Mail'])if($(id))closeModal(id,true);
    onInvalidated(message,{deferNative:Boolean(result.recovery_codes?.length)});
    if(result.recovery_codes?.length){await showCodes(result.recovery_codes);onNativeLogout();}
  }
  async function openSecurity() {
    const snapshot=key(),node=modal('task27Security','账户安全');body(node).textContent='正在读取安全状态…';status(node,'');openModal('task27Security');
    try {
      const data=await apiGet('/api/security/overview');if(snapshot!==key())return;
      const valid=data.sessions.filter(session=>session.valid);
      body(node).innerHTML=`<div class="task27-security-summary"><article><h3>登录密码</h3><p>${data.password_changed_at?`最近修改：${esc(date(data.password_changed_at))}`:'历史修改时间未知，从功能启用后开始计算提醒。'}</p><p>30 天提醒仅为个人安全建议，不强制修改。</p><button type="button" data-security-password>修改密码</button></article><article><h3>绑定邮箱</h3><p>${esc(data.email || '尚未绑定已验证邮箱')}</p>${data.email_test_allowlist_active?'<p class="task27-note">测试环境仅允许向授权测试邮箱发送验证码。</p>':''}<button type="button" data-security-email>${data.email?'更换邮箱':'绑定并验证邮箱'}</button></article><article><h3>双重验证</h3><p>当前方式：${esc(labels[data.mfa_method])}</p><p>普通用户自主开启，不影响会员权益。</p>${data.enrollment_enabled&&!data.email?'<p class="task27-note">需先完成“绑定并验证邮箱”，才能切换为邮箱双重验证。</p>':''}<div class="action-row">${data.enrollment_enabled?'<button type="button" data-security-mfa="email">使用邮箱</button><button type="button" data-security-mfa="totp">使用验证器</button>':'<p>新的验证方式设置尚未开放。</p>'}${data.mfa_method!=='none'?'<button type="button" data-security-disable>关闭双重验证</button>':''}</div></article><article><h3>一次性恢复码</h3><p>${data.mfa_method==='totp'?`剩余 ${Number(data.recovery_codes_remaining)} 个；已有恢复码无法再次查看。`:'开启 TOTP 后可获得恢复码。'}</p>${data.mfa_method==='totp'?'<button type="button" data-security-recovery>重新生成恢复码</button>':''}</article><article><h3>数据导出与加密备份</h3><p>导出云端财务账目、审核候选与云端结构化通知（不含 Android 本地原始正文），支持加密恢复与只读预检。</p><button type="button" data-security-backup>打开数据备份中心</button></article></div><h3>登录设备与会话</h3><p>Web 会话显示可确认的客户端类型，不推测具体设备型号。</p><div class="task27-session-list">${valid.map(session=>`<article><div><strong>${esc(session.client || '浏览器会话')}${session.current?' · 当前会话':''}</strong><p>创建：${esc(date(session.created_at))}<br>最近活动：${esc(date(session.last_seen_at))}</p></div><button type="button" data-revoke-id="${esc(session.id)}" data-kind="${session.kind}">退出此会话</button></article>`).join('') || '<p>暂无有效会话。</p>'}</div><div class="action-row"><button type="button" data-revoke-mode="others">退出其他设备</button><button type="button" data-revoke-mode="all">退出全部设备</button></div><h3>最近安全活动</h3><ul>${data.events.map(event=>`<li>${esc(eventLabels[event.event_type] || '账户安全操作')} · ${esc(date(event.created_at))}</li>`).join('') || '<li>暂无记录</li>'}</ul>`;
      bind(node,'[data-security-password]',async()=>{
        const grant=await stepup('password_change');
        const values=await prompt('修改登录密码',[{name:'new_secret',label:'新密码（至少 9 位混合密码）',type:'password',autocomplete:'new-password'},{name:'confirm_secret',label:'再次输入新密码',type:'password',autocomplete:'new-password'}]);
        await invalidate(await api('/api/account/secret',{grant,...values}),'密码已修改，请重新登录');
      });
      bind(node,'[data-security-email]',async()=>{
        const allowlistHint=data.email_test_allowlist_active?'步骤 1/3：请输入要绑定的邮箱。完成身份验证并输入 6 位邮箱验证码前，邮箱不会保存。（注意：当前测试环境启用了收件人白名单限制，仅授权测试邮箱可收信。）':'步骤 1/3：请输入要绑定的邮箱。完成身份验证并输入 6 位邮箱验证码前，邮箱不会保存。';
        const email=(await prompt('绑定并验证邮箱',[{name:'email',label:'新邮箱地址',type:'email',autocomplete:'email'}],{message:allowlistHint,button:'下一步：验证身份'})).email;
        const grant=await stepup('email_change');
        status(node,`步骤 2/3：已完成身份验证，正在向 ${email} 请求发送 6 位验证码（当前尚未绑定邮箱），请稍候。`,'info');
        const start=await api('/api/security/email/start',{email,grant});
        const sentHint=`步骤 3/3：验证码已提交邮件服务（状态：${start.delivery_status||'accepted'}，尚未确认送达收件箱）。请输入发往 ${email} 的 6 位数字验证码确认绑定；取消不会保存。`;
        status(node,sentHint,'info');
        const result=await api('/api/security/email/confirm',{challenge:start.challenge,code:await codePrompt('email','步骤 3/3：确认邮箱验证码')});
        await invalidate(result,'邮箱已验证并更新，旧会话已撤销，请重新登录');
      });
      bind(node,'[data-security-mfa]',async button=>{
        const method=button.dataset.securityMfa;
        if(method==='email'&&!data.email){status(node,'无法切换为邮箱双重验证：请先点击“绑定并验证邮箱”。现有双重验证保持不变，请勿提前删除验证器。','error');return;}
        const grant=await stepup('mfa_change');
        if(method==='email')status(node,`步骤 2/3：已完成身份验证，正在向已验证邮箱 ${data.email} 请求发送开启验证码（当前双重验证方式尚未变更），请稍候。`,'info');
        const start=await api('/api/security/mfa/start',{method,grant});
        let code;
        if(method==='totp') {
          const uri=new URL(start.otpauth_uri);
          if(uri.protocol!=='otpauth:'||uri.hostname!=='totp'||uri.searchParams.get('secret')!==start.secret||uri.searchParams.get('issuer')!=='Aeris'||uri.searchParams.get('algorithm')!=='SHA1'||uri.searchParams.get('digits')!=='6'||uri.searchParams.get('period')!=='30')throw new Error('验证器配置无效，请重新开始');
          const answer=prompt('绑定 TOTP 验证器',[{name:'code',label:'验证器当前六位验证码',autocomplete:'one-time-code'}],{message:'任选二维码、验证器链接或手动密钥添加账户。输入正确验证码后才会启用；取消不会改变现有登录保护。',content:`<div class="task27-qr" id="task27TotpQr"></div><p><a id="task27OpenAuthenticator" rel="noreferrer noopener" class="button-secondary">在验证器 App 中打开</a></p><p id="task27AuthenticatorFallback" role="status">如未打开验证器或提示没有可处理的应用，请扫描二维码，或复制下面密钥手动添加。</p><p>账户标签：Aeris · ${esc(getAccount()?.username || '')}<br>参数：TOTP · SHA-1 · 6 位验证码 · 30 秒周期</p><p class="task27-key" tabindex="0">${esc(start.secret)}</p><button type="button" id="task27CopyTotpSecret">复制设置密钥</button><p class="meta-line">若复制不可用，可选中密钥手动复制；添加后验证码仍不匹配时，请确认验证器时间自动同步并重新输入当前验证码。</p>`});
          const target=$('task27TotpQr');
          if(typeof window.qrcode==='function'){const qr=window.qrcode(0,'M');qr.addData(start.otpauth_uri);qr.make();target.innerHTML=qr.createSvgTag({cellSize:4,margin:16});target.setAttribute('role','img');target.setAttribute('aria-label','Aeris 验证器绑定二维码');}
          else target.textContent='二维码暂不可用，请使用验证器链接或手动密钥。';
          $('task27OpenAuthenticator').href=start.otpauth_uri;
          $('task27OpenAuthenticator').addEventListener('click',()=>{$('task27AuthenticatorFallback').textContent='已请求系统打开验证器；如没有打开，请使用二维码或手动复制密钥。此步骤尚未启用双重验证。';});
          $('task27CopyTotpSecret').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(start.secret);$('task27AuthenticatorFallback').textContent='设置密钥已复制。请在验证器中手动添加 Aeris 账户，然后输入当前六位验证码。';}catch(_){$('task27AuthenticatorFallback').textContent='当前环境无法自动复制，请选中上方设置密钥手动复制。';}});
          code=(await answer).code;
        } else {
          status(node,`步骤 3/3：验证码已提交邮件服务（状态：${start.delivery_status||'accepted'}，尚未确认送达收件箱），请输入发往 ${data.email} 的 6 位验证码确认切换；确认前原有双重验证不会改变。`,'info');
          code=await codePrompt('email','步骤 3/3：确认开启邮箱双重验证');
        }
        const result=await api('/api/security/mfa/confirm',{challenge:start.challenge,code:code.trim()});
        await invalidate(result,'双重验证已更新，请重新登录');
      });
      bind(node,'[data-security-disable]',async()=>{await prompt('确认关闭双重验证',[{name:'confirm',label:'我确认关闭双重验证',type:'checkbox'}],{button:'继续验证'});await invalidate(await api('/api/security/mfa/disable',{grant:await stepup('mfa_change')}),'双重验证已关闭，请重新登录');});
      bind(node,'[data-security-recovery]',async()=>{const result=await api('/api/security/recovery/regenerate',{grant:await stepup('recovery_regenerate')});await showCodes(result.recovery_codes);});
      bind(node,'[data-security-backup]',()=>{closeModal('task27Security',true);void openBackupCenter();});
      const revoke=async payload=>{await prompt('确认退出登录会话',[{name:'confirm',label:'我确认退出所选设备',type:'checkbox'}]);const result=await api('/api/security/sessions/revoke',{...payload,grant:await stepup('sessions_revoke')});if(result.session_invalidated)await invalidate(result,'会话已退出，请重新登录');else await openSecurity();};
      bind(node,'[data-revoke-id]',button=>revoke({mode:'single',id:button.dataset.revokeId,kind:button.dataset.kind}));
      bind(node,'[data-revoke-mode]',button=>revoke({mode:button.dataset.revokeMode}));
    } catch(error){status(node,error.message);}
  }
  async function drawInbox() {
    const snapshot=key(),node=modal('task27Inbox','个人通知收件箱');status(node,'');
    const data=await apiGet(`/api/notifications?filter=${filter}&page=${page}`);if(snapshot!==key())return;inboxState=data;setBadge(data.unread_count);
    body(node).innerHTML=`<div class="task27-inbox-toolbar"><label>显示 <select data-inbox-filter><option value="all">全部消息</option><option value="unread">未读消息</option><option value="read">已读消息</option></select></label><button type="button" data-read-all ${data.unread_count?'':'disabled'}>全部标记已读（${data.unread_count}）</button></div><p>广播不会增加个人未读数。明确确认与普通已读分别记录。</p><div class="task27-inbox-list">${data.messages.map(message=>`<article class="${message.read_at?'':'is-unread'}"><span class="status-badge">${esc(message.type)} · ${message.read_at?'已读':'未读'}</span><h3>${esc(message.title)}</h3><time>${esc(date(message.created_at))}</time><p class="task27-message-body">${esc(message.body)}</p><div class="action-row">${!message.read_at?`<button type="button" data-read-source="${message.source}" data-read-id="${esc(message.id)}">标记已读</button>`:''}${message.requires_confirmation&&!message.acknowledged_at?`<button type="button" class="primary" data-ack-id="${esc(message.id)}">明确确认</button>`:''}${message.acknowledged_at?'<span>已明确确认</span>':''}</div></article>`).join('') || '<p>此筛选下暂无消息。</p>'}</div><div class="action-row"><button type="button" data-inbox-prev ${page===1?'disabled':''}>上一页</button><span>第 ${page} 页</span><button type="button" data-inbox-next ${data.messages.length<30?'disabled':''}>下一页</button></div>`;
    body(node).querySelector('[data-inbox-filter]').value=filter;
    body(node).querySelector('[data-inbox-filter]').addEventListener('change',event=>{filter=event.target.value;page=1;void drawInbox().catch(error=>status(node,error.message));});
    bind(node,'[data-read-id]',async button=>{await api('/api/notifications/read',{source:button.dataset.readSource,id:button.dataset.readId});await drawInbox();});
    bind(node,'[data-ack-id]',async button=>{await prompt('明确确认消息',[{name:'confirm',label:'我已阅读并明确确认这条消息',type:'checkbox'}]);await api('/api/messages/receipt',{message_id:button.dataset.ackId,action:'acknowledge'});await drawInbox();});
    bind(node,'[data-read-all]',async()=>{const preview=await api('/api/notifications/read-all/preview',{});if(!preview.count){await drawInbox();return;}await prompt('确认全部已读',[{name:'confirm',label:`将 ${preview.count} 条消息标记为已读`,type:'checkbox'}],{message:'此操作只更新普通阅读状态。需要明确确认的消息仍需逐条确认。',button:'确认标记已读'});await api('/api/notifications/read-all',{confirmation:preview.confirmation,confirm:true});await drawInbox();});
    bind(node,'[data-inbox-prev]',async()=>{page--;await drawInbox();});bind(node,'[data-inbox-next]',async()=>{page++;await drawInbox();});
  }
  async function openInbox(){const node=modal('task27Inbox','个人通知收件箱');body(node).textContent='正在同步通知…';openModal('task27Inbox');try{await drawInbox();}catch(error){status(node,error.message);}}
  function renderBackupDiffItems(preview) {
    const groups=[
      ['added','将新增（Added）','is-add'],
      ['skipped_identical','将跳过相同项（Skipped）','is-skip'],
      ['conflicts','冲突已拦截（Conflict）','is-conflict'],
      ['rejected','不合法已拒绝（Rejected）','is-reject'],
    ];
    const html=[];
    for(const [k,label,cls] of groups) {
      const list=Array.isArray(preview?.[k])?preview[k]:[];
      for(const item of list.slice(0,25)) {
        const desc=item.detail||`${item.summary||item.section} ${item.currency||''} ${item.amount_minor??''}`;
        html.push(`<li class="sc-backup-diff-item ${cls}"><span class="sc-backup-badge ${cls}">${esc(label)}</span><strong>${esc(item.section)}</strong> <code>${esc(item.id)}</code> — <span>${esc(desc)}</span></li>`);
      }
      if(list.length>25)html.push(`<li class="sc-backup-diff-item">……该类别其余 ${list.length-25} 条省略展示</li>`);
    }
    return html.length?`<ul class="sc-backup-diff-list" tabindex="0" aria-label="备份差异明细">${html.join('')}</ul>`:'<p class="task27-note">该备份与当前云端数据一致，无新增或变更差异。</p>';
  }
  async function openBackupCenter() {
    const snapshot=key();
    const node=modal('task29BackupModal','数据导出、加密备份与可验证恢复');
    backupPrecheckState=null;
    body(node).innerHTML='<p class="task27-note">正在读取当前账户的数据范围与导出摘要…</p>';
    status(node,'');
    openModal('task29BackupModal');
    let overview;
    try {
      overview=await apiGet('/api/backup/v1/scopes');
      if(snapshot!==key())return;
    } catch(error) {
      status(node,error?.message||'无法读取备份范围');
      return;
    }
    const counts=overview.scope_counts||{};
    const notice=overview.privacy_declaration?.notice||'';
    body(node).innerHTML=`
      <div class="sc-backup-privacy-banner" role="note" aria-label="隐私边界声明">
        <strong>云端与本地隐私边界声明</strong>
        <p>${esc(notice)}</p>
        <ul>
          <li><span class="sc-backup-badge is-add">已包含</span> 云端财务账目与汇总规则（<code>${Number(counts.finance_core?.total||0)}</code> 条） / 审核候选与提示（<code>${Number(counts.finance_review?.total||0)}</code> 条） / 云端结构化通知事件摘要（<code>${Number(counts.notifications_cloud?.total||0)}</code> 条）</li>
          <li><span class="sc-backup-badge is-reject">不包含</span> Android 设备本地 Room 原始通知标题与正文、短信原文、验证码原文及本地截图（从未上传至云端，不会伪造已备份）。</li>
        </ul>
      </div>
      <div class="sc-backup-grid">
        <section class="sc-backup-card" aria-labelledby="backupExportHeading">
          <h3 id="backupExportHeading">1. 导出当前账户数据</h3>
          <p class="task27-note">JSON 与加密备份包包含完整校验清单与关系外键；CSV 仅供查看与统计分析（已防公式注入与浮点误差），不可直接无损恢复。</p>
          <fieldset class="sc-backup-scopes">
            <legend>选择导出数据范围</legend>
            <label class="admin-checkbox"><input type="checkbox" id="backupScopeFinanceCore" checked> 财务账目与规则（${Number(counts.finance_core?.total||0)}）</label>
            <label class="admin-checkbox"><input type="checkbox" id="backupScopeFinanceReview" checked> 财务审核候选与待确认（${Number(counts.finance_review?.total||0)}）</label>
            <label class="admin-checkbox"><input type="checkbox" id="backupScopeNotificationsCloud" checked> 云端结构化通知事件（${Number(counts.notifications_cloud?.total||0)}）</label>
          </fieldset>
          <label class="field-label"><span>导出格式</span>
            <select id="backupExportFormat">
              <option value="encrypted">加密备份包 (.aeris-backup.json · 推荐)</option>
              <option value="json">结构化 JSON (.json · 明文归档)</option>
              <option value="csv">CSV 表格 (.csv · 仅分析不可恢复)</option>
            </select>
          </label>
          <div id="backupExportPassphraseBox" class="stack-form">
            <label class="field-label"><span>设置备份口令（至少 10 个字符）</span>
              <input id="backupExportPassphrase" type="password" minlength="10" maxlength="256" autocomplete="new-password" placeholder="用于本地 Web Crypto AES-256-GCM 加密">
            </label>
            <label class="field-label"><span>再次确认备份口令</span>
              <input id="backupExportPassphraseConfirm" type="password" minlength="10" maxlength="256" autocomplete="new-password" placeholder="请牢记口令，系统不存储、无法找回">
            </label>
            <p class="task27-note">加密密钥在浏览器本地通过 Web Crypto API (PBKDF2-HMAC-SHA256 + AES-256-GCM) 派生，口令绝不上传或写入服务器。遗失口令后无法解密或恢复。</p>
          </div>
          <div class="action-row">
            <button type="button" class="primary" id="backupExportSubmitBtn">生成并下载导出文件</button>
          </div>
          <p class="task27-note" id="backupExportStatus" role="status" aria-live="polite"></p>
        </section>

        <section class="sc-backup-card" aria-labelledby="backupRestoreHeading">
          <h3 id="backupRestoreHeading">2. 验证、预检与可控制恢复</h3>
          <p class="task27-note">上传备份文件后先执行严格只读模拟预检，确认差异预览后再通过 Step-up 身份核验写入。同账户重复恢复严格幂等，冲突项默认拒绝覆盖。</p>
          <label class="field-label"><span>选择备份文件 (.aeris-backup.json 或 .json)</span>
            <input id="backupRestoreFileInput" type="file" accept=".json,.aeris-backup.json,application/json">
          </label>
          <label class="field-label"><span>解密口令（若为加密备份包）</span>
            <input id="backupRestorePassphrase" type="password" maxlength="256" autocomplete="off" placeholder="加密备份包需输入导出时的口令">
          </label>
          <label class="field-label"><span>冲突处理策略</span>
            <select id="backupConflictPolicy">
              <option value="skip_identical_reject_conflict">仅跳过一致记录，发现冲突则拦截恢复（推荐）</option>
              <option value="skip_all_existing">跳过所有已存在/冲突记录（绝不静默覆盖）</option>
            </select>
          </label>
          <div class="action-row">
            <button type="button" id="backupPrecheckBtn">验证并预览恢复结果（只读预检）</button>
          </div>
          <div id="backupPrecheckResult" hidden>
            <div class="sc-backup-summary-grid" id="backupPrecheckSummary"></div>
            <div id="backupPrecheckWarnings"></div>
            <div id="backupPrecheckDiffList"></div>
            <label class="admin-checkbox"><input type="checkbox" id="backupConfirmCheckbox"> 我已核对预检差异结果，确认通过身份重新验证后仅写入新增项（绝不覆盖现有记录）。</label>
            <div class="action-row">
              <button type="button" class="primary" id="backupCommitRestoreBtn" disabled>确认身份并执行恢复</button>
              <button type="button" id="backupCancelJobBtn">取消预检作业</button>
            </div>
          </div>
          <div id="backupRestoreReport" hidden></div>
        </section>
      </div>
    `;

    const exportPassBox=$('backupExportPassphraseBox');
    const formatSel=$('backupExportFormat');
    const togglePassBox=()=>{if(exportPassBox)exportPassBox.hidden=formatSel.value!=='encrypted';};
    formatSel.addEventListener('change',togglePassBox);
    togglePassBox();
    wirePasswordVisibility($('backupExportPassphrase'));
    wirePasswordVisibility($('backupExportPassphraseConfirm'));
    wirePasswordVisibility($('backupRestorePassphrase'));

    const selectedScopes=()=>{
      const out=[];
      if($('backupScopeFinanceCore')?.checked)out.push('finance_core');
      if($('backupScopeFinanceReview')?.checked)out.push('finance_review');
      if($('backupScopeNotificationsCloud')?.checked)out.push('notifications_cloud');
      return out;
    };

    $('backupExportSubmitBtn').addEventListener('click',async()=>{
      const btn=$('backupExportSubmitBtn');
      const expStatus=$('backupExportStatus');
      const fmt=formatSel.value;
      const scopes=selectedScopes();
      if(!scopes.length){status(node,'请至少勾选一个导出范围。');return;}
      let passphrase='',confirmPass='';
      if(fmt==='encrypted'){
        passphrase=$('backupExportPassphrase').value;
        confirmPass=$('backupExportPassphraseConfirm').value;
        if(passphrase.length<10){status(node,'备份口令长度不能少于 10 个字符。');return;}
        if(passphrase!==confirmPass){status(node,'两次输入的备份口令不一致，请检查后重试。');return;}
      }
      btn.disabled=true;status(node,'');
      if(expStatus)expStatus.textContent='正在获取账户一致快照并校验隐私边界…';
      try {
        if(fmt==='encrypted'){
          const res=await api('/api/backup/v1/export',{format:'json',scopes});
          if(snapshot!==key())return;
          if(expStatus)expStatus.textContent='正在浏览器本地使用 Web Crypto AES-256-GCM 加密打包…';
          const container=await clientEncryptEnvelope(res.envelope,passphrase);
          if(snapshot!==key())return;
          const filename=`aeris-encrypted-backup-${String(res.export_id||'').slice(0,12)}.aeris-backup.json`;
          triggerBrowserDownload(filename,JSON.stringify(container,null,2),'application/json; charset=utf-8');
          if(expStatus)expStatus.textContent=`已生成并下载加密备份包 ${filename}（共 ${Number(res.manifest?.total_records||0)} 条记录）。口令未上传服务器。`;
          status(node,'加密备份包已通过浏览器 Web Crypto 生成并触发下载，请妥善保管备份文件与口令。','info');
          $('backupExportPassphrase').value='';$('backupExportPassphraseConfirm').value='';
        } else if(fmt==='csv'){
          const res=await api('/api/backup/v1/export',{format:'csv',scopes});
          if(snapshot!==key())return;
          triggerBrowserDownload(res.filename,res.csv,'text/csv; charset=utf-8');
          if(expStatus)expStatus.textContent=`已下载 CSV ${res.filename}（仅供分析查看，不可直接无损恢复复杂关系）。`;
          status(node,'CSV 文件已下载。请注意 CSV 仅用于查看统计，完整恢复请使用加密备份包。','info');
        } else {
          const res=await api('/api/backup/v1/export',{format:'json',scopes});
          if(snapshot!==key())return;
          triggerBrowserDownload(res.filename,JSON.stringify(res.envelope,null,2),'application/json; charset=utf-8');
          if(expStatus)expStatus.textContent=`已下载结构化 JSON ${res.filename}（共 ${Number(res.manifest?.total_records||0)} 条记录）。`;
          status(node,'结构化 JSON 归档已下载。','info');
        }
      } catch(error) {
        if(expStatus)expStatus.textContent='';
        status(node,error?.message||'导出失败');
      } finally {
        if(btn.isConnected)btn.disabled=false;
      }
    });

    const commitBtn=$('backupCommitRestoreBtn');
    const confirmCb=$('backupConfirmCheckbox');
    const updateCommitEnabled=()=>{
      if(!commitBtn)return;
      commitBtn.disabled=!(backupPrecheckState?.can_restore && backupPrecheckState?.job_id && confirmCb?.checked);
    };
    confirmCb?.addEventListener('change',updateCommitEnabled);

    $('backupPrecheckBtn').addEventListener('click',async()=>{
      const btn=$('backupPrecheckBtn');
      const file=$('backupRestoreFileInput')?.files?.[0];
      const pass=$('backupRestorePassphrase')?.value||'';
      const policy=$('backupConflictPolicy')?.value||'skip_identical_reject_conflict';
      if(!file){status(node,'请先选择要预检的备份文件。');return;}
      if(file.size>BACKUP_MAX_BYTES){status(node,'备份文件超过 16 MiB 安全大小限制，已拒绝读取。');return;}
      btn.disabled=true;status(node,'');
      $('backupRestoreReport').hidden=true;
      try {
        const rawText=await file.text();
        if(snapshot!==key())return;
        const cleanText=rawText.replace(/^\uFEFF/,'').trim();
        if(cleanText.startsWith('record_section,')){
          throw new Error('所选文件为 CSV 分析导出文件，不支持无损关系恢复；请选择加密备份包 (.aeris-backup.json) 或结构化 JSON。');
        }
        let parsed;
        try{parsed=JSON.parse(cleanText);}catch(_){throw new Error('备份文件不是有效的 JSON / 加密容器格式。');}
        let pkgForPrecheck=parsed;
        if(parsed?.format===BACKUP_FORMAT){
          pkgForPrecheck=await clientDecryptContainer(parsed,pass);
          if(snapshot!==key())return;
        }
        const precheck=await api('/api/backup/v1/precheck',{package:pkgForPrecheck,conflict_policy:policy,create_job:true});
        if(snapshot!==key())return;
        backupPrecheckState=precheck;
        const sum=precheck.summary||{};
        $('backupPrecheckSummary').innerHTML=`
          <article><span>将新增</span><strong>${Number(sum.added||0)}</strong></article>
          <article><span>跳过一致</span><strong>${Number(sum.skipped_identical||0)}</strong></article>
          <article><span>冲突拦截</span><strong>${Number(sum.conflicts||0)}</strong></article>
          <article><span>不合法拒绝</span><strong>${Number(sum.rejected||0)}</strong></article>
        `;
        const warnList=[...(precheck.warnings||[]).map(w=>w.detail),...(precheck.limitations||[])];
        $('backupPrecheckWarnings').innerHTML=warnList.length?`<div class="sc-backup-limitations"><strong>预检提示与 P03-P06 范围说明</strong><ul>${warnList.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></div>`:'';
        $('backupPrecheckDiffList').innerHTML=renderBackupDiffItems(precheck.diff_preview);
        confirmCb.checked=false;
        $('backupPrecheckResult').hidden=false;
        updateCommitEnabled();
        status(node,precheck.can_restore?'只读预检完成：校验与账户归属全部通过，可勾选确认后执行 Step-up 恢复。':'只读预检完成：存在冲突或校验未通过项目，已阻止写入（不会破坏当前账户任何账目）。',precheck.can_restore?'info':'error');
      } catch(error) {
        backupPrecheckState=null;
        $('backupPrecheckResult').hidden=true;
        status(node,error?.message||'预检失败');
      } finally {
        if(btn.isConnected)btn.disabled=false;
      }
    });

    commitBtn.addEventListener('click',async()=>{
      if(!backupPrecheckState?.job_id||!backupPrecheckState?.can_restore)return;
      const jobId=backupPrecheckState.job_id;
      commitBtn.disabled=true;status(node,'');
      try {
        const grant=await stepup(`backup_restore:${jobId}`);
        if(snapshot!==key())return;
        const result=await api(`/api/backup/v1/restore/jobs/${encodeURIComponent(jobId)}/commit`,{grant});
        if(snapshot!==key())return;
        const rs=result.result_summary||{};
        $('backupRestoreReport').hidden=false;
        $('backupRestoreReport').innerHTML=`
          <div class="sc-backup-privacy-banner" role="status">
            <strong>${result.idempotent_replay?'幂等重放完成（未重复记账）':'备份恢复已完成'}</strong>
            <p>作业编号：<code>${esc(result.job_id)}</code> · 财务同步版本：<code>v${Number(rs.finance_server_version||0)}</code></p>
            <p>新写入：<strong>${Number(rs.inserted_total||0)}</strong> 条 · 跳过一致：<strong>${Number(rs.skipped_identical||0)}</strong> 条 · 跳过冲突：<strong>${Number(rs.conflicts_skipped||0)}</strong> 条 · 拒绝：<strong>${Number(rs.rejected||0)}</strong> 条</p>
          </div>
        `;
        $('backupRestorePassphrase').value='';
        confirmCb.checked=false;
        updateCommitEnabled();
        window.dispatchEvent(new CustomEvent('aeris:finance-data-restored',{detail:result}));
        status(node,result.idempotent_replay?'该备份已执行过相同恢复，本次为幂等重放，未生成重复账目或消耗额外配额。':'数据恢复成功！已保留原有记录并同步推进版本号。','info');
      } catch(error) {
        status(node,error?.message==='操作已取消'?'已取消身份核验，未写入任何数据。':(error?.message||'恢复提交失败'));
        updateCommitEnabled();
      }
    });

    $('backupCancelJobBtn').addEventListener('click',async()=>{
      if(!backupPrecheckState?.job_id)return;
      const btn=$('backupCancelJobBtn');btn.disabled=true;
      try {
        await api(`/api/backup/v1/restore/jobs/${encodeURIComponent(backupPrecheckState.job_id)}/cancel`,{});
        if(snapshot!==key())return;
        backupPrecheckState=null;
        $('backupPrecheckResult').hidden=true;
        status(node,'已取消该次预检作业，未写入任何业务数据。','info');
      } catch(error) {
        status(node,error?.message||'取消作业失败');
      } finally {
        if(btn.isConnected)btn.disabled=false;
      }
    });
  }
  function setBadge(count){const bell=$('notificationBellBtn'),badge=$('notificationUnreadCount');if(!bell||!badge)return;const n=Math.max(0,Number(count)||0);badge.textContent=n>99?'99+':String(n);badge.classList.toggle('hidden',!n);bell.classList.toggle('has-unread',n>0);bell.setAttribute('aria-label',n?`个人通知，${n} 条未读`:'个人通知，无未读消息');}
  async function refreshBadge(force=false) {
    if(!getSession()||!getAccount()||document.hidden)return;
    const capabilityOwner=key();
    let supported;try{supported=await isSupported();}catch(_){return;}
    if(!supported||capabilityOwner!==key()||!getSession()||!getAccount())return;
    if(badgePromise)return badgePromise;if(!force&&Date.now()-badgeAt<30000)return;
    const snapshot=key();badgeAt=Date.now();
    badgePromise=apiGet('/api/notifications?filter=unread').then(data=>{if(snapshot===key())setBadge(data.unread_count);}).catch(()=>{}).finally(()=>{badgePromise=null;});return badgePromise;
  }
  function updateAccount(){const current=key();if(current!==owner){owner=current;badgeAt=0;inboxState=null;mailState=null;backupPrecheckState=null;setBadge(0);for(const id of ['task27Security','task27Inbox','task27Mail','task27Prompt','task27Secrets','task29BackupModal'])if($(id))closeModal(id,true);}
    void isSupported().then(supported=>{if(current!==key())return;const authenticated=Boolean(getSession()&&getAccount());$('notificationBellBtn')?.classList.toggle('hidden',!authenticated||!supported);$('securityCenterMenuBtn')?.classList.toggle('hidden',!authenticated||!supported);$('openSecurityCenterBtn')?.classList.toggle('hidden',!supported);$('accountBackupOpen')?.classList.toggle('hidden',!authenticated);$('finOpenBackupBtn')?.classList.toggle('hidden',!authenticated);$('task27MailOpenBtn')?.classList.toggle('hidden',!getAccount()?.is_admin||!supported||policyConfig?.mail_center_integrated===true);$('forgotPasswordBtn')?.classList.toggle('hidden',!supported);$('adminNewSecretInput')?.closest('.admin-secret-field')?.classList.toggle('hidden',supported);$('adminNewSecretInput')?.closest('.admin-secret-field')?.setAttribute('aria-hidden',String(supported));$('generateAdminSecretBtn')?.classList.toggle('hidden',supported);if($('generateAdminSecretBtn'))$('generateAdminSecretBtn').disabled=supported;if(authenticated&&supported)void refreshBadge();}).catch(()=>{});}
  async function policies(){if(!policyConfig){const response=await fetch('/api/policies',{cache:'no-store'});if(response.status===404){policyConfig={legacy:true,versions:POLICY_VERSIONS,security_center_ready:false};return policyConfig;}if(!response.ok)throw new Error('无法读取当前政策版本，请稍后重试');policyConfig=await response.json();}return policyConfig;}
  async function isSupported(){return (await policies()).security_center_ready===true;}
  async function registrationConsent(){if(!$('registerTermsConsent')?.checked)throw new Error('请主动勾选同意使用条款');return {terms_accepted:true,policy_versions:(await policies()).versions};}
  async function reaccept(){if(consentPromise)return consentPromise;consentPromise=(async()=>{const config=await policies();await prompt('确认更新后的政策',[{name:'terms_accepted',label:'我已阅读并同意当前使用条款，并已获提供隐私政策及安全与隐私说明。',type:'checkbox'}],{content:'<p><a href="/terms" target="_blank" rel="noopener">使用条款</a> · <a href="/privacy" target="_blank" rel="noopener">隐私政策</a> · <a href="/security-privacy" target="_blank" rel="noopener">安全与隐私</a></p>'});await api('/api/policies/accept',{terms_accepted:true,policy_versions:config.versions});})().finally(()=>{consentPromise=null;});return consentPromise;}
  async function forgotPassword(){
    const node=modal('task27Recovery','找回密码与账户恢复');body(node).innerHTML='<p>普通密码重置保留已有双重验证。若同时丢失所有恢复方式，请联系 support@thewyj.uk。</p><button type="button" data-forgot-password>重置密码</button><button type="button" data-lost-mfa>丢失验证器：独立恢复</button>';status(node,'');openModal('task27Recovery');
    bind(node,'[data-forgot-password]',async()=>{
      const values=await prompt('申请重置密码',[{name:'username',label:'用户名',autocomplete:'username'},{name:'email',label:'绑定的已验证邮箱',type:'email',autocomplete:'email'}],{
        content:'<label>恢复方式 <select name="method" id="task27ResetMethod"><option value="email">已验证邮箱</option><option value="totp">TOTP 验证器</option><option value="recovery">一次性恢复码</option></select></label><p class="task27-note">选择“已验证邮箱”时必须填写与该用户名绑定的邮箱；仅当信息完全匹配且满足发送条件时才会尝试发信，响应不泄露账户状态。</p>',
        onMount:panel=>{
          const select=panel.querySelector('#task27ResetMethod'),emailInput=panel.querySelector('[name="email"]'),emailWrap=emailInput?.closest('label');
          const sync=()=>{const byEmail=(select?.value||'email')==='email';if(emailInput){emailInput.required=byEmail;if(!byEmail)emailInput.value='';}if(emailWrap)emailWrap.hidden=!byEmail;};
          select?.addEventListener('change',sync);sync();
        }
      });
      const method=values.method || 'email';
      const start=await publicApi('/api/security/password/request',{username:values.username,email:method==='email'?(values.email||''):'',method});
      const result=await prompt('验证并设置新密码',[{name:'code',label:method==='email'?'六位邮件验证码':method==='totp'?'六位 TOTP 验证码':'一次性恢复码',autocomplete:'one-time-code'},{name:'new_secret',label:'新密码',type:'password',autocomplete:'new-password'},{name:'confirm_secret',label:'再次输入新密码',type:'password',autocomplete:'new-password'}],{message:start.message});
      await publicApi('/api/security/password/reset',{challenge:start.challenge,...result});status(node,'密码已重置，原双重验证保留。请关闭此窗口并重新登录。','info');
    });
    bind(node,'[data-lost-mfa]',async()=>{const values=await prompt('独立恢复双重验证',[{name:'username',label:'用户名'},{name:'password',label:'当前密码',type:'password',autocomplete:'current-password'}],{message:'此流程需要当前密码及一个未使用的恢复码，成功后关闭原验证器并撤销全部旧会话。'});const start=await publicApi('/api/security/mfa/recover/request',values);const code=(await prompt('验证一次性恢复码',[{name:'code',label:'恢复码',autocomplete:'one-time-code'}])).code;await publicApi('/api/security/mfa/recover/confirm',{challenge:start.challenge,code});status(node,'双重验证已通过独立程序恢复。请重新登录并重新配置。');});
  }
  async function openMail(){
    if((await policies()).mail_center_integrated){
      const tab=document.querySelector('[data-admin-view="adminEmailView"]');
      if(!tab||!policyConfig.mail_center_ready)throw new Error('邮件中心尚未就绪，请稍后重试');
      tab.click();return;
    }
    const node=modal('task27Mail','服务邮件管理');openModal('task27Mail');body(node).textContent='正在读取发送记录…';status(node,'');
    try{mailState=await apiGet('/api/admin/email/drafts');await renderMail(node);}catch(error){status(node,error.message);}
  }
  async function renderMail(node){
    body(node).innerHTML=`<p>发件：${esc(mailState.from)} · 回复：${esc(mailState.reply_to)}</p><p>仅向已验证邮箱发送必要的服务通信，每次最多 20 个账户。发送状态不代表抵达收件箱。当前没有站内入站邮件读取功能。</p><form class="stack-form" id="task27MailForm"><label class="field-label"><span>搜索已验证邮箱的用户</span><input id="task27MailSearch" type="search" maxlength="40"></label><button type="button" data-mail-search>搜索用户</button><div class="task27-mail-recipients" id="task27MailRecipients"></div><label class="field-label"><span>主题</span><input name="subject" maxlength="120" required></label><label class="field-label"><span>正文（纯文本）</span><textarea name="body" maxlength="4000" required></textarea></label><button class="primary" type="submit">保存草稿</button></form><h3>草稿与发送记录</h3><div class="task27-mail-records">${mailState.drafts.map(draft=>`<article><h4>${esc(draft.subject)}</h4><p>${esc(mailLabels[draft.status])} · ${draft.recipient_ids.length} 个收件用户</p><p>通信编号：${esc(draft.thread_id)}</p><div>${mailState.jobs.filter(job=>job.draft_id===draft.id).map(job=>`<p>${esc(mailLabels[job.status])} · 尝试 ${job.attempts}/3${job.error_code?' · '+esc(job.error_code):''}</p>`).join('')}</div>${draft.status==='draft'||draft.status==='partial'?`<button type="button" data-mail-preview="${esc(draft.id)}">预览${draft.status==='partial'?'与受控重试':'并发送'}</button>`:''}</article>`).join('') || '<p>暂无草稿或发送记录。</p>'}</div>`;
    bind(node,'[data-mail-search]',async()=>{const result=await apiGet(`/api/admin/email/recipients?q=${encodeURIComponent($('task27MailSearch').value)}`);$('task27MailRecipients').innerHTML=result.recipients.map(user=>`<label class="admin-checkbox"><input type="checkbox" value="${esc(user.id)}">${esc(user.username)}</label>`).join('')||'<p>没有符合条件的已验证邮箱账户。</p>';});
    $('task27MailForm').addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{const form=new FormData(event.currentTarget);await api('/api/admin/email/drafts',{subject:form.get('subject'),body:form.get('body'),recipient_ids:[...$('task27MailRecipients').querySelectorAll('input:checked')].map(input=>input.value)});await openMail();}catch(error){status(node,error.message);}finally{button.disabled=false;}});
    bind(node,'[data-mail-preview]',async button=>{const preview=await api('/api/admin/email/preview',{id:button.dataset.mailPreview});const draft=preview.draft;await prompt(draft.status==='partial'?'确认受控重试':'确认发送服务邮件',[{name:'confirm',label:`确认向 ${preview.recipients.length} 个已验证邮箱发送`,type:'checkbox'}],{message:'已接受、排队或结果未知的投递不会重复发送。失败投递至少等待一分钟，最多尝试三次。',content:`<article><h3>${esc(draft.subject)}</h3><p>${preview.recipients.map(r=>esc(r.username+' · '+r.email_masked)).join('<br>')}</p><p class="task27-message-body">${esc(draft.body)}</p></article>`,button:'继续身份验证'});await api('/api/admin/email/send',{id:draft.id,revision:draft.revision,preview:preview.preview,confirm:true,retry:draft.status==='partial',grant:await stepup(`email_send:${draft.id}:${draft.revision}`)});await openMail();});
  }
  $('notificationBellBtn')?.addEventListener('click',()=>void openInbox());
  wireNewPasswordField($('registerSecretInput'));wirePasswordVisibility($('registerConfirmInput'));wireNewPasswordField($('newSecretInput'));
  $('securityCenterMenuBtn')?.addEventListener('click',()=>void openSecurity());$('openSecurityCenterBtn')?.addEventListener('click',()=>void openSecurity());
  $('accountBackupOpen')?.addEventListener('click',()=>void openBackupCenter());$('finOpenBackupBtn')?.addEventListener('click',()=>void openBackupCenter());
  $('forgotPasswordBtn')?.addEventListener('click',()=>void forgotPassword());$('task27MailOpenBtn')?.addEventListener('click',()=>void openMail());
  window.addEventListener('focus',()=>void refreshBadge(true));document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshBadge(true);});window.setInterval(()=>void refreshBadge(),60000);
  updateCopyrightYear();
  return {stepup,completeLogin,openSecurity,openBackupCenter,openInbox,updateAccount,registrationConsent,reaccept,forgotPassword,openMail,refreshBadge,isSupported};
}
