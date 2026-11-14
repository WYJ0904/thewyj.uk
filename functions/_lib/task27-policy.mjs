import { POLICY_CONTENT } from './task27-policy-content.mjs';
import { POLICY_ARCHIVE } from './task27-policy-archive.mjs';
import { fail, first, stmt, nowIso, hasTask27 } from './task27-store.mjs';

export const POLICY_VERSIONS = Object.freeze(Object.fromEntries(Object.entries(POLICY_CONTENT).map(([k,v])=>[k,v.version])));
export function validateConsent(payload) {
  if (payload.terms_accepted !== true || !payload.policy_versions || Array.isArray(payload.policy_versions)
    || Object.keys(payload.policy_versions).length !== 3
    || Object.entries(POLICY_VERSIONS).some(([key,value])=>payload.policy_versions[key] !== value)) {
    fail('policy_consent_required','请主动同意当前使用条款，并阅读所提供的隐私政策和安全说明',428);
  }
}
export function consentStatement(db, userId, requestId = '') {
  return stmt(db, `INSERT OR IGNORE INTO task27_policy_consents(user_id,terms_version,privacy_version,security_version,accepted_at,request_id)
    VALUES(?1,?2,?3,?4,?5,?6)`, [userId,POLICY_VERSIONS.terms,POLICY_VERSIONS.privacy,POLICY_VERSIONS.security,nowIso(),String(requestId).slice(0,120)]);
}
export async function policyReacceptRequired(db, userId) {
  if (!await hasTask27(db)) return false;
  const required = await first(db,"SELECT value FROM task12_metadata WHERE key='task27_require_policy_reaccept'");
  if (required?.value !== '1') return false;
  return !await first(db, `SELECT 1 FROM task27_policy_consents WHERE user_id=?1 AND terms_version=?2 AND privacy_version=?3 AND security_version=?4`,
    [userId,POLICY_VERSIONS.terms,POLICY_VERSIONS.privacy,POLICY_VERSIONS.security]);
}
export function publicPolicyConfig() {
  return {versions:POLICY_VERSIONS,links:{terms:'/terms',privacy:'/privacy',security:'/security-privacy'},status:'draft',effective_date:null};
}
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function markdownBody(body) {
  return body.split(/\n\n+/).map(block=>{
    const lines=block.split('\n');
    if (lines[0].startsWith('# ')) return `<h1>${escape(lines[0].slice(2))}</h1>`;
    if (lines[0].startsWith('## ')) return `<h2>${escape(lines[0].slice(3))}</h2>`;
    if (lines.every(line=>line.startsWith('- '))) return `<ul>${lines.map(line=>`<li>${escape(line.slice(2))}</li>`).join('')}</ul>`;
    if (lines.every(line=>/^\d+\. /.test(line))) return `<ol>${lines.map(line=>`<li>${escape(line.replace(/^\d+\. /,''))}</li>`).join('')}</ol>`;
    return `<p>${lines.map(escape).join('<br>')}</p>`;
  }).join('\n');
}
export function policyPage(context, key) {
  const version=new URL(context.request.url).searchParams.get('version');
  const policy=version?POLICY_ARCHIVE[version]?.[key]:POLICY_CONTENT[key];
  if (!policy) return new Response('政策版本不存在',{status:404});
  const year=Math.max(2025,new Date().getUTCFullYear());
  const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(policy.title)} · Aeris</title><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/design-system.css"><link rel="stylesheet" href="/product-ui.css"></head><body class="policy-document"><header class="policy-nav"><a href="/" aria-label="Aeris 首页">Aeris</a><nav aria-label="政策"><a href="/terms">使用条款</a><a href="/privacy">隐私政策</a><a href="/security-privacy">安全与隐私</a></nav></header><main class="policy-article">${markdownBody(policy.body)}<p class="meta-line">版本归档：<a href="?version=${policy.version}">${policy.version}</a>。当前为待正式发布草案。</p></main><footer class="site-help-footer"><p>© 2025–<span data-copyright-year>${year}</span> Aeris. All rights reserved.</p><p>遇到问题？请联系 <a href="mailto:support@thewyj.uk">support@thewyj.uk</a></p><p>回复邮件可能使用其他邮箱地址。</p></footer><script type="module" src="/js/account/policy-page.js"></script></body></html>`;
  return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}
