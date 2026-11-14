import {Task16Error} from './task16-model.mjs';

const ROLES=['actual_paid','actual_received','original','discount','balance','fee','refund','unknown'];
const REASONS=['none','ambiguous','insufficient_evidence','conflict','non_transaction','unsafe_input'];
const CATEGORIES=['food','transport','shopping','housing','health','education','entertainment','income','transfer','refund','other'];
const invalid=()=>{throw new Task16Error('模型角色结果无法核验',503,'finance_ai_provider_schema_invalid');};
/** Provider answers roles/IDs, never generates a financial amount. */
export const FINANCE_AI_ROLE_SCHEMA={type:'object',additionalProperties:false,required:['schema_version','amount_roles','selected_candidate_id','currency','direction','confidence_per_mille','refusal_reason','merchant_normalized','category'],properties:{
  schema_version:{type:'integer',enum:[2]},
  amount_roles:{type:'array',maxItems:6,items:{type:'object',additionalProperties:false,required:['candidate_id','role'],properties:{candidate_id:{type:'string',pattern:'^m[0-5]$'},role:{type:'string',enum:ROLES}}}},
  selected_candidate_id:{type:['string','null'],description:'Evidence ID for the current net payment/receipt/refund, excluding original price, discount, fee and balance. Null if no role is supported.'},
  currency:{type:'string',enum:['CNY','USD','EUR','HKD','GBP','JPY']},direction:{type:'string',enum:['expense','income','refund','unknown']},
  confidence_per_mille:{type:'integer',minimum:0,maximum:1000,description:'Semantic interpretation confidence in per mille: 0 means none, 1000 means very confident. 900 means 90 percent; 1 means 0.1 percent. It is not payment-authentication confidence.'},
  refusal_reason:{type:'string',enum:REASONS},merchant_normalized:{type:['string','null']},category:{type:['string','null'],enum:[...CATEGORIES,null]},
}};
export function normalizeFinanceAiRoles(raw,input){
  if(!raw||Array.isArray(raw)||typeof raw!=='object')invalid();
  const fields=Object.keys(FINANCE_AI_ROLE_SCHEMA.properties).sort();
  if(JSON.stringify(Object.keys(raw).sort())!==JSON.stringify(fields)||raw.schema_version!==2||
    !Array.isArray(raw.amount_roles)||raw.amount_roles.length>6||!Number.isSafeInteger(raw.confidence_per_mille)||raw.confidence_per_mille<0||raw.confidence_per_mille>1000||
    !REASONS.includes(raw.refusal_reason)||![...CATEGORIES,null].includes(raw.category))invalid();
  const source=new Map(input.candidates.map(c=>[c.id,c]));const seen=new Set();
  const amounts=raw.amount_roles.map(value=>{
    if(!value||JSON.stringify(Object.keys(value).sort())!==JSON.stringify(['candidate_id','role'])||!ROLES.includes(value.role)||seen.has(value.candidate_id)||!source.has(value.candidate_id))invalid();
    seen.add(value.candidate_id);const fact=source.get(value.candidate_id);
    // Copy only the exact source number/unit. A generated number is never used.
    return {candidate_id:value.candidate_id,amount_minor:fact.amount_minor,currency:fact.currency,role:value.role,evidence_refs:[value.candidate_id]};
  });
  if(raw.selected_candidate_id!==null&&!seen.has(raw.selected_candidate_id))invalid();
  return {schema_version:1,decision:['non_transaction','unsafe_input'].includes(raw.refusal_reason)?'reject':raw.selected_candidate_id&&raw.refusal_reason==='none'&&raw.confidence_per_mille>=800?'suggest':'review',
    amount_candidates:amounts,selected_candidate_id:raw.selected_candidate_id,currency:raw.currency,direction:raw.direction,evidence_refs:[...seen],
    confidence:raw.confidence_per_mille,refusal_reason:raw.refusal_reason,merchant_normalized:raw.merchant_normalized,category:raw.category};
}
