import {currencyDigits} from '../../js/finance/money.js';
import {Task21Error} from './task21-model.mjs';
import {hasCurrencyDecisions} from './finance-money-units.mjs';
import {syncFinance} from './task16-service.mjs';
import {sha256Hex} from './cloudflare-foundation.mjs';

export function explicitReviewCurrency(edits) {
  if(edits.currency===undefined)return null;
  const currency=typeof edits.currency==='string'?edits.currency.trim().toUpperCase():'';
  let digits;try{digits=currencyDigits(currency)}catch{throw new Task21Error('请选择支持的原币币种',400,'currency_unsupported')}
  if(!Number.isSafeInteger(edits.amount_minor)||edits.amount_minor<=0||edits.amount_minor>10000000000000 ||
    (edits.amount_exponent!==undefined&&edits.amount_exponent!==digits) || (currency==='JPY'&&edits.amount_exponent!==0))
    throw new Task21Error('更正币种时须重新输入并确认原币金额',409,'currency_amount_confirmation_required');
  return {currency,amount_exponent:digits};
}

/** A manual decision uses the existing transaction CAS and durable receipt contract. */
export async function finishReviewCurrency(db,account,deviceId,id,choice,amount,direction) {
  if(!choice)return null;
  if(!await hasCurrencyDecisions(db))throw new Task21Error('币种核实结构需要增量迁移',503,'currency_decision_schema_required',true);
  const row=await db.prepare("SELECT * FROM task16_finance_transactions WHERE user_id=?1 AND id=?2 AND status='active'").bind(account.id,id).first();
  if(!row||row.currency!==choice.currency||Number(row.amount_minor)!==amount||row.direction!==direction)
    throw new Task21Error('已有账目与本次币种确认不一致，请核对财务记录',409,'currency_receipt_conflict');
  if(Number(row.currency_review_required)!==1)return row;
  const digest=await sha256Hex(id+':'+row.revision+':'+choice.currency+':'+amount);
  const result=await syncFinance(db,account,{schema_version:1,device_id:deviceId,platform:'web',since_version:0,operations:[{
    operation_id:'currency-confirm:'+digest.slice(0,48),type:'transaction.upsert',entity_id:id,base_revision:Number(row.revision),payload:{
      direction:row.direction,amount_minor:Number(row.amount_minor),currency:row.currency,...(row.currency==='JPY'?{amount_exponent:0}:{}),
      category_id:row.category_id,merchant:row.merchant,counterparty:row.counterparty,note:row.note,occurred_at_ms:Number(row.occurred_at_ms),currency_review_acknowledged:true}}]});
  const outcome=result.operation_results[0];
  if(!outcome.transaction||outcome.status==='conflict')throw new Task21Error('账目已被修改，请重新核对',409,'currency_receipt_conflict');
  return outcome.transaction;
}
