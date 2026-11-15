import { updateCopyrightYear } from './policy-page.js?release=20261115-aeris-s0-p0-release';
import { POLICY_VERSIONS } from './policy-version.js?release=20261115-aeris-s0-p0-release';
import { wireNewPasswordField,wirePasswordVisibility } from './password-fields.js?release=20261115-aeris-s0-p0-release';

const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Date(value).toLocaleString():'尚无记录';
const labels={none:'未开启',email:'邮箱验证码',totp:'TOTP 验证器'};
const eventLabels={password_changed:'登录密码已修改',password_reset:'管理员已重置密码',password_recovered:'账户密码已恢复',email_changed:'绑定邮箱已变更',mfa_enabled:'双重验证已开启',mfa_disabled:'双重验证已关闭',mfa_changed:'双重验证方式已变更',mfa_recovered:'已通过独立程序恢复双重验证',recovery_used:'一次性恢复码已使用',recovery_regenerated:'恢复码已重新生成',session_revoked:'登录会话已撤销',refresh_reuse:'检测到刷新凭据重复使用'};
const mailLabels={draft:'草稿',sending:'处理中，结果待核实',sent:'已提交邮件服务',partial:'部分投递待处理',accepted:'服务已接受',queued:'服务排队中',provider_delivered:'收件服务器已接受',failed:'发送失败，可受控重试',rejected:'服务已拒绝',unknown:'发送结果未知，需人工核实',pending:'待发送'};

export function ownerBoundRequest(request,getOwner) {
  const changed=()=>{const error=new Error('账户已切换，请重新打开账户安全中心');error.code='account_changed';return error;};
  return async(...args)=>{const owner=getOwner();try{const result=await request(...args);if(owner!==getOwner())throw changed();return result;}catch(error){if(owner!==getOwner())throw changed();throw error;}};
}

export function createSecurityCenter({api,apiGet,publicApi,getSession,getAccount,openModal,closeModal,onInvalidated,onNativeLogout=()=>{}}) {
  const $=id=>document.getElementById(id);
  let pendingPrompt=null,owner='',badgeAt=0,badgePromise=null,filter='all',page=1,inboxState=null,mailState=null,policyConfig=null,consentPromise=null;
  const key=()=>`${getSession() || ''}:${getAccount()?.id || ''}`;
  api=ownerBoundRequest(api,key);apiGet=ownerBoundRequest(apiGet,key);
  function modal(id,title) {
    let node=$(id);
    if (!node) {
      node=document.createElement('div');node.id=id;node.className='modal-layer hidden task27-modal';node.setAttribute('aria-hidden','true');
      node.innerHTML=`<section class="modal-panel task27-panel" role="dialog" aria-modal="true" aria-labelledby="${id}Title"><button class="modal-close" type="button" data-task27-close aria-label="关闭">×</button><h2 id="${id}Title">${esc(title)}</h2><div data-task27-body></div><p class="error" data-task27-status role="status" aria-live="polite"></p></section>`;
      document.body.append(node);
      node.querySelector('[data-task27-close]').addEventListener('click',()=>closeModal(id,true));
      new MutationObserver(()=>{if(node.classList.contains('hidden')){if(id==='task27Prompt'&&pendingPrompt){pendingPrompt.reject(new Error('操作已取消'));pendingPrompt=null;}node.querySelectorAll('input[type=password],input[autocomplete=one-time-code]').forEach(input=>{input.value='';});if(id==='task27Secrets'||id==='task27Prompt')node.querySelector('[data-task27-body]').replaceChildren();}}).observe(node,{attributes:true,attributeFilter:['class']});
    }
    return node;
  }
  const body=node=>node.querySelector('[data-task27-body]');
  const status=(node,text)=>{node.querySelector('[data-task27-status]').textContent=text;};
  function bind(node,selector,callback) {node.querySelectorAll(selector).forEach(button=>button.addEventListener('click',async()=>{if(button.disabled)return;button.disabled=true;status(node,'');try{await callback(button);}catch(error){status(node,error.message);}finally{if(button.isConnected)button.disabled=false;}}));}
  async function prompt(title,fields,{message='',content='',button='继续'}={}) {
    if(pendingPrompt){pendingPrompt.reject(new Error('操作已取消'));pendingPrompt=null;}
    const node=modal('task27Prompt',title);$('task27PromptTitle').textContent=title;status(node,'');
    body(node).innerHTML=`${message?`<p>${esc(message)}</p>`:''}${content}<form class="stack-form">${fields.map(field=>`<label class="field-label"><span>${esc(field.label)}</span><input name="${esc(field.name)}" type="${field.type || 'text'}" ${field.type==='checkbox'?'':'maxlength="256"'} ${field.autocomplete?`autocomplete="${esc(field.autocomplete)}"`:'autocomplete="off"'} ${field.required===false?'':'required'}></label>`).join('')}<button class="primary" type="submit">${esc(button)}</button></form>`;
    const promise=new Promise((resolve,reject)=>{pendingPrompt={resolve,reject};});
    body(node).querySelector('form').addEventListener('submit',event=>{event.preventDefault();const values={};for(const field of fields){const input=body(node).querySelector(`[name="${field.name}"]`);values[field.name]=field.type==='checkbox'?input.checked:input.value;}body(node).querySelectorAll('select[name]').forEach(select=>{values[select.name]=select.value;});const waiting=pendingPrompt;pendingPrompt=null;body(node).querySelectorAll('input').forEach(input=>{input.value='';input.checked=false;});closeModal('task27Prompt',true);waiting?.resolve(values);});
    body(node).querySelectorAll('input[type=password]').forEach(input=>{if(input.name==='new_secret')wireNewPasswordField(input);else wirePasswordVisibility(input);});
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
      body(node).innerHTML=`<div class="task27-security-summary"><article><h3>登录密码</h3><p>${data.password_changed_at?`最近修改：${esc(date(data.password_changed_at))}`:'历史修改时间未知，从功能启用后开始计算提醒。'}</p><p>30 天提醒仅为个人安全建议，不强制修改。</p><button type="button" data-security-password>修改密码</button></article><article><h3>绑定邮箱</h3><p>${esc(data.email || '尚未绑定已验证邮箱')}</p><button type="button" data-security-email>${data.email?'更换邮箱':'绑定并验证邮箱'}</button></article><article><h3>双重验证</h3><p>当前方式：${esc(labels[data.mfa_method])}</p><p>普通用户自主开启，不影响会员权益。</p><div class="action-row">${data.enrollment_enabled?'<button type="button" data-security-mfa="email">使用邮箱</button><button type="button" data-security-mfa="totp">使用验证器</button>':'<p>新的验证方式设置尚未开放。</p>'}${data.mfa_method!=='none'?'<button type="button" data-security-disable>关闭双重验证</button>':''}</div></article><article><h3>一次性恢复码</h3><p>${data.mfa_method==='totp'?`剩余 ${Number(data.recovery_codes_remaining)} 个；已有恢复码无法再次查看。`:'开启 TOTP 后可获得恢复码。'}</p>${data.mfa_method==='totp'?'<button type="button" data-security-recovery>重新生成恢复码</button>':''}</article></div><h3>登录设备与会话</h3><p>Web 会话显示可确认的客户端类型，不推测具体设备型号。</p><div class="task27-session-list">${valid.map(session=>`<article><div><strong>${esc(session.client || '浏览器会话')}${session.current?' · 当前会话':''}</strong><p>创建：${esc(date(session.created_at))}<br>最近活动：${esc(date(session.last_seen_at))}</p></div><button type="button" data-revoke-id="${esc(session.id)}" data-kind="${session.kind}">退出此会话</button></article>`).join('') || '<p>暂无有效会话。</p>'}</div><div class="action-row"><button type="button" data-revoke-mode="others">退出其他设备</button><button type="button" data-revoke-mode="all">退出全部设备</button></div><h3>最近安全活动</h3><ul>${data.events.map(event=>`<li>${esc(eventLabels[event.event_type] || '账户安全操作')} · ${esc(date(event.created_at))}</li>`).join('') || '<li>暂无记录</li>'}</ul>`;
      bind(node,'[data-security-password]',async()=>{
        const grant=await stepup('password_change');
        const values=await prompt('修改登录密码',[{name:'new_secret',label:'新密码（至少 9 位混合密码）',type:'password',autocomplete:'new-password'},{name:'confirm_secret',label:'再次输入新密码',type:'password',autocomplete:'new-password'}]);
        await invalidate(await api('/api/account/secret',{grant,...values}),'密码已修改，请重新登录');
      });
      bind(node,'[data-security-email]',async()=>{
        const email=(await prompt('绑定并验证邮箱',[{name:'email',label:'新邮箱地址',type:'email',autocomplete:'email'}])).email;
        const start=await api('/api/security/email/start',{email,grant:await stepup('email_change')});
        const result=await api('/api/security/email/confirm',{challenge:start.challenge,code:await codePrompt('email')});
        await invalidate(result,'邮箱已验证并更新，请重新登录');
      });
      bind(node,'[data-security-mfa]',async button=>{
        const method=button.dataset.securityMfa,start=await api('/api/security/mfa/start',{method,grant:await stepup('mfa_change')});
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
        } else code=await codePrompt('email','确认开启邮箱双重验证');
        const result=await api('/api/security/mfa/confirm',{challenge:start.challenge,code:code.trim()});
        await invalidate(result,'双重验证已更新，请重新登录');
      });
      bind(node,'[data-security-disable]',async()=>{await prompt('确认关闭双重验证',[{name:'confirm',label:'我确认关闭双重验证',type:'checkbox'}],{button:'继续验证'});await invalidate(await api('/api/security/mfa/disable',{grant:await stepup('mfa_change')}),'双重验证已关闭，请重新登录');});
      bind(node,'[data-security-recovery]',async()=>{const result=await api('/api/security/recovery/regenerate',{grant:await stepup('recovery_regenerate')});await showCodes(result.recovery_codes);});
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
  function setBadge(count){const bell=$('notificationBellBtn'),badge=$('notificationUnreadCount');if(!bell||!badge)return;const n=Math.max(0,Number(count)||0);badge.textContent=n>99?'99+':String(n);badge.classList.toggle('hidden',!n);bell.classList.toggle('has-unread',n>0);bell.setAttribute('aria-label',n?`个人通知，${n} 条未读`:'个人通知，无未读消息');}
  async function refreshBadge(force=false) {
    if(!getSession()||!getAccount()||document.hidden)return;
    if(badgePromise)return badgePromise;if(!force&&Date.now()-badgeAt<30000)return;
    const snapshot=key();badgeAt=Date.now();
    badgePromise=apiGet('/api/notifications?filter=unread').then(data=>{if(snapshot===key())setBadge(data.unread_count);}).catch(()=>{}).finally(()=>{badgePromise=null;});return badgePromise;
  }
  function updateAccount(){const current=key();if(current!==owner){owner=current;badgeAt=0;inboxState=null;mailState=null;setBadge(0);for(const id of ['task27Security','task27Inbox','task27Mail','task27Prompt','task27Secrets'])if($(id))closeModal(id,true);}
    void isSupported().then(supported=>{if(current!==key())return;const authenticated=Boolean(getSession()&&getAccount());$('notificationBellBtn')?.classList.toggle('hidden',!authenticated||!supported);$('securityCenterMenuBtn')?.classList.toggle('hidden',!authenticated||!supported);$('openSecurityCenterBtn')?.classList.toggle('hidden',!supported);$('task27MailOpenBtn')?.classList.toggle('hidden',!getAccount()?.is_admin||!supported||policyConfig?.mail_center_integrated===true);$('forgotPasswordBtn')?.classList.toggle('hidden',!supported);$('adminNewSecretInput')?.closest('.admin-secret-field')?.classList.toggle('hidden',supported);$('adminNewSecretInput')?.closest('.admin-secret-field')?.setAttribute('aria-hidden',String(supported));$('generateAdminSecretBtn')?.classList.toggle('hidden',supported);if($('generateAdminSecretBtn'))$('generateAdminSecretBtn').disabled=supported;if(authenticated&&supported)void refreshBadge();}).catch(()=>{});}
  async function policies(){if(!policyConfig){const response=await fetch('/api/policies',{cache:'no-store'});if(response.status===404){policyConfig={legacy:true,versions:POLICY_VERSIONS,security_center_ready:false};return policyConfig;}if(!response.ok)throw new Error('无法读取当前政策版本，请稍后重试');policyConfig=await response.json();}return policyConfig;}
  async function isSupported(){return (await policies()).security_center_ready===true;}
  async function registrationConsent(){if(!$('registerTermsConsent')?.checked)throw new Error('请主动勾选同意使用条款');return {terms_accepted:true,policy_versions:(await policies()).versions};}
  async function reaccept(){if(consentPromise)return consentPromise;consentPromise=(async()=>{const config=await policies();await prompt('确认更新后的政策',[{name:'terms_accepted',label:'我已阅读并同意当前使用条款，并已获提供隐私政策及安全与隐私说明。',type:'checkbox'}],{content:'<p><a href="/terms" target="_blank" rel="noopener">使用条款</a> · <a href="/privacy" target="_blank" rel="noopener">隐私政策</a> · <a href="/security-privacy" target="_blank" rel="noopener">安全与隐私</a></p>'});await api('/api/policies/accept',{terms_accepted:true,policy_versions:config.versions});})().finally(()=>{consentPromise=null;});return consentPromise;}
  async function forgotPassword(){
    const node=modal('task27Recovery','找回密码与账户恢复');body(node).innerHTML='<p>普通密码重置保留已有双重验证。若同时丢失所有恢复方式，请联系 support@thewyj.uk。</p><button type="button" data-forgot-password>重置密码</button><button type="button" data-lost-mfa>丢失验证器：独立恢复</button>';status(node,'');openModal('task27Recovery');
    bind(node,'[data-forgot-password]',async()=>{
      const values=await prompt('申请重置密码',[{name:'username',label:'用户名'}],{content:'<label>恢复方式 <select name="method" id="task27ResetMethod"><option value="email">已验证邮箱</option><option value="totp">TOTP 验证器</option><option value="recovery">一次性恢复码</option></select></label>'});
      const method=values.method || 'email';const start=await publicApi('/api/security/password/request',{username:values.username,method});
      const result=await prompt('验证并设置新密码',[{name:'code',label:method==='email'?'六位邮件验证码':method==='totp'?'六位 TOTP 验证码':'一次性恢复码',autocomplete:'one-time-code'},{name:'new_secret',label:'新密码',type:'password',autocomplete:'new-password'},{name:'confirm_secret',label:'再次输入新密码',type:'password',autocomplete:'new-password'}],{message:start.message});
      await publicApi('/api/security/password/reset',{challenge:start.challenge,...result});status(node,'密码已重置，原双重验证保留。请关闭此窗口并重新登录。');
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
  $('forgotPasswordBtn')?.addEventListener('click',()=>void forgotPassword());$('task27MailOpenBtn')?.addEventListener('click',()=>void openMail());
  window.addEventListener('focus',()=>void refreshBadge(true));document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshBadge(true);});window.setInterval(()=>void refreshBadge(),60000);
  updateCopyrightYear();
  return {stepup,completeLogin,openSecurity,openInbox,updateAccount,registrationConsent,reaccept,forgotPassword,openMail,refreshBadge,isSupported};
}
