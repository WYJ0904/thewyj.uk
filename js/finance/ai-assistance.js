import {currencyDigits,moneyText,SUPPORTED_CURRENCIES} from './money.js';
import {formatFinanceMoney} from './format.js';

const ROLES=['actual_paid','actual_received','original','discount','balance','fee','refund','unknown'];
const CATEGORIES=['food','transport','shopping','housing','health','education','entertainment','income','transfer','refund','other'];
/** Browser rechecks supplied evidence. No model response is a transaction fact. */
export function financeAiAdvice(response,candidate,clock=Date.now()){
  try{
    if(!['suggestion','review'].includes(response?.status)||response.requires_manual_confirmation!==true||response.canonical_hint_id!==String(candidate.id)||
       !Number.isSafeInteger(response.expires_at_ms)||response.expires_at_ms<=clock||Number(candidate.correction_count)>0||candidate.local_evidence?.conflict)return null;
    const input=response.evidence,advice=response.suggestion;
    const expected=['schema_version','decision','amount_candidates','selected_candidate_id','currency','direction','evidence_refs','confidence','refusal_reason','merchant_normalized','category','requires_manual_confirmation'].sort();
    if(!advice||JSON.stringify(Object.keys(advice).sort())!==JSON.stringify(expected)||advice.schema_version!==1||advice.requires_manual_confirmation!==true||
       !['suggest','review','reject'].includes(advice.decision)||!SUPPORTED_CURRENCIES.includes(advice.currency)||advice.currency!==input.currency||
       advice.direction!==input.direction||!['expense','income','refund','unknown'].includes(advice.direction)||
       !Number.isInteger(advice.confidence)||advice.confidence<0||advice.confidence>1000||![...CATEGORIES,null].includes(advice.category))return null;
    if(response.status==='suggestion'&&(advice.decision!=='suggest'||advice.confidence<800))return null;
    if(!['none','ambiguous','insufficient_evidence','conflict','non_transaction','unsafe_input'].includes(advice.refusal_reason))return null;
    if(candidate.currency!==input.currency||(candidate.direction&&candidate.direction!=='unknown'&&candidate.direction!==input.direction))return null;
    if(advice.merchant_normalized!==null&&!input.merchant_tokens.includes(advice.merchant_normalized))return null;
    const facts=new Map(input.candidates.map(c=>[c.id,c]));
    if(facts.size!==input.candidates.length||facts.size>6||!Array.isArray(advice.amount_candidates)||advice.amount_candidates.length>6)return null;
    const refs=value=>Array.isArray(value)&&value.length<=6&&new Set(value).size===value.length&&value.every(id=>facts.has(id));
    if(!refs(advice.evidence_refs))return null;
    const seen=new Set();
    for(const amount of advice.amount_candidates){
      if(JSON.stringify(Object.keys(amount).sort())!==JSON.stringify(['candidate_id','amount_minor','currency','role','evidence_refs'].sort()))return null;
      const source=facts.get(amount.candidate_id);if(!source||seen.has(amount.candidate_id)||!Number.isSafeInteger(amount.amount_minor)||amount.amount_minor<=0||amount.amount_minor>1e13||
          source.amount_minor!==amount.amount_minor||source.currency!==amount.currency||source.amount_exponent!==currencyDigits(source.currency)||!ROLES.includes(amount.role)||
          !refs(amount.evidence_refs)||!amount.evidence_refs.includes(amount.candidate_id))return null;
      seen.add(amount.candidate_id);
      const known=source.phrases.includes('余额')?'balance':source.phrases.some(p=>['手续费','服务费'].includes(p))?'fee':source.phrases.some(p=>['优惠','减免','折扣'].includes(p))?'discount':source.phrases.includes('原价')?'original':null;
      if(known&&amount.role!==known)return null;
    }
    const selected=advice.amount_candidates.find(c=>c.candidate_id===advice.selected_candidate_id)||null;
    if(advice.selected_candidate_id!==null&&!selected)return null;
    if(advice.decision==='suggest'&&(!selected||advice.refusal_reason!=='none'||!advice.evidence_refs.includes(selected.candidate_id)))return null;
    if(selected){
      if(selected.role!==(advice.direction==='refund'?'refund':advice.direction==='income'?'actual_received':'actual_paid'))return null;
      if(facts.get(selected.candidate_id).phrases.some(p=>['原价','优惠','减免','折扣','余额','手续费','服务费'].includes(p)))return null;
      if(Number(candidate.amount_minor)>0&&Number(candidate.amount_minor)!==selected.amount_minor)return null;
    }
    return {advice,selected};
  }catch{return null;}
}
export function financeAiMessage(status){
  return ({suggestion:'AI建议仅供核对，尚未写账',review:'AI仍无法确定，请人工核实',rejected:'AI建议不采用，原交易保留',evidence_required:'请先在Android核实页面读取这笔交易的金额候选',
    consent_required:'需先同意发送脱敏候选字段',running:'AI正在分析，可稍后刷新',disabled:'AI尚未启用，可继续人工核实',rule_determined:'已有规则证据，继续按原流程处理',
    hard_amount_conflict:'金额证据冲突，请人工核实',timed_out:'AI请求超时，原交易未改变',invalidated:'来源或授权已变化，旧建议不再采用',failed:'AI暂不可用，可继续人工核实',invalid:'AI结果无法核验，请人工核实'})[status]||'';
}
export function financeAiMarkup(id,config,response,consentPending,escape,candidate){
  if(config?.available!==true)return Number(config?.consent?.enabled)===1?`<div class="finance-ai-assistance"><p>AI已暂停，可继续人工核实。</p><button type="button" data-finance-ai-action="disable" data-finance-ai-id="${escape(id)}">停用AI授权</button></div>`:'';
  const key=escape(id);const enabled=Number(config.consent?.enabled)===1;
  const checked=candidate&&response?financeAiAdvice(response,candidate):null;
  const category=({food:'餐饮',transport:'交通',shopping:'购物',housing:'居住',health:'医疗',education:'教育',entertainment:'娱乐',income:'收入',transfer:'转账',refund:'退款',other:'其他'})[checked?.advice.category];
  const details=checked?.selected?`建议原币金额：${formatFinanceMoney(checked.selected.amount_minor,checked.selected.currency)}${category?' · 分类建议：'+category:''}${checked.advice.merchant_normalized?' · 商户建议：'+checked.advice.merchant_normalized:''}`:'';
  return `<div class="finance-ai-assistance"><p>可选AI仅分析脱敏金额候选，建议仍需人工确认。</p>
    ${consentPending?`<p>仅发送金额、币种和角色词，不发送聊天、姓名或订单号。</p><button type="button" data-finance-ai-action="consent" data-finance-ai-id="${key}">同意并分析</button><button type="button" data-finance-ai-action="cancel" data-finance-ai-id="${key}">取消</button>`:
      `<button type="button" data-finance-ai-action="request" data-finance-ai-id="${key}">${enabled?'分析候选金额':'启用脱敏AI建议'}</button>`}
    <p role="status">${escape(financeAiMessage(response?.status))}</p>
    ${details?`<p>${escape(details)}</p>`:''}
    ${response?.status==='suggestion'?`<button type="button" data-finance-ai-action="use" data-finance-ai-id="${key}">核对建议</button>`:''}
    ${enabled?`<button type="button" data-finance-ai-action="disable" data-finance-ai-id="${key}">停用AI建议</button>`:''}</div>`;
}
/** Fill the existing editor only after explicit adoption; never submits it. */
export function fillFinanceAiEditor(form,result){
  if(!form||!result?.selected)return false;
  if(!form.classList.contains('hidden')){
    for(const field of Array.from(form.elements)){
      const initial=field.tagName==='SELECT'?Array.from(field.options).find(o=>o.defaultSelected)?.value??'':field.defaultValue;
      if(initial!==undefined&&String(field.value)!==String(initial))return false;
    }
  }
  form.classList.remove('hidden');form.elements.currency.value=result.selected.currency;
  form.elements.amount.value=moneyText(result.selected.amount_minor,result.selected.currency);form.elements.direction.value=result.advice.direction;
  if(form.elements.merchant&&!form.elements.merchant.value&&result.advice.merchant_normalized)form.elements.merchant.value=result.advice.merchant_normalized;
  form.elements.amount.focus();return true;
}
