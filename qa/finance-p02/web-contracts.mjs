import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {calculateFinanceSummary} from '../../js/finance/app.js';
import {formatFinanceMoney} from '../../js/finance/format.js';

const root=path.resolve(import.meta.dirname,'../..');
const output=path.join(root,'docs/migration-evidence/finance-p02/matrix');fs.mkdirSync(output,{recursive:true});
const rows=[];
function run(id,layer,kind,input,expected,fn){
  const start=performance.now();let actual,error;
  try{actual=fn();assert.deepEqual(actual,expected);}catch(e){error=e;}
  rows.push({case_id:id,group:kind.startsWith('preauth')?'C':'D',layer,kind,source:'SYNTHETIC_ONLY',fixture:input,expected,actual,
    status:error?(layer==='TARGET_SPEC'?'EXPECTED_RED':'FAIL'):'PASS',error:error?.stack||'',elapsed_ms:performance.now()-start,
    coverage:'REAL_PRODUCT_JS_PURE_FUNCTION_NO_BACKEND'});
}
const transaction=(id,currency,amount,direction='expense',more={})=>({id,currency,amount_minor:amount,direction,status:'active',occurred_at_ms:Date.UTC(2026,9,18,12),...more});
for(const [currency,digits] of [['CNY',2],['USD',2],['EUR',2],['HKD',2],['GBP',2],['JPY',0]]){
  for(const minor of [10000,12345]){
    const expected=new Intl.NumberFormat('zh-CN',{style:'currency',currency,minimumFractionDigits:digits,maximumFractionDigits:digits}).format(minor/10**digits);
    run(`DW-FMT-${currency}-${minor}`,currency==='JPY'?'TARGET_SPEC':'CURRENT_BASELINE','currency_format',{currency,minor,iso_digits:digits},expected,()=>formatFinanceMoney(minor,currency));
  }
}
const cny=[transaction('synthetic-cny','CNY',10000),transaction('synthetic-income','CNY',20000,'income'),transaction('synthetic-refund','CNY',500,'refund')];
run('DW-CNY-SUM','CURRENT_BASELINE','summary',{transactions:cny},{income_minor:20000,expense_minor:10000,refund_minor:500,balance_minor:10500,count:3},()=>calculateFinanceSummary(cny));
for(const [currency,rate] of [['USD',7],['EUR',8],['HKD',0.9],['GBP',9.5],['JPY',0.05]]){
  const tx=[transaction('synthetic-cny','CNY',10000),transaction('synthetic-foreign',currency,currency==='JPY'?10000:10000)];
  const expected=10000+Math.round((currency==='JPY'?10000:100)*rate*100);
  run(`DW-MIX-${currency}`,'TARGET_SPEC','mixed_currency_summary',{transactions:tx,synthetic_rate:rate,rate_date:'2026-10-18',rates_are_market_data:false},expected,
    ()=>calculateFinanceSummary(tx,{month:'2026-10',display_currency:'CNY',rate_snapshot:{date:'2026-10-18',rates:{[currency]:rate}}}).expense_minor);
}
for(const queryDate of ['2026-10-18','2026-10-19']){
  const tx=[transaction('synthetic-history','USD',10000,'expense',{fx_snapshot:{date:'2026-10-18',rate:'7.000000',display_currency:'CNY',converted_minor:70000}})];
  run(`DW-HISTORY-${queryDate}`,'TARGET_SPEC','historical_fx',{transactions:tx,query_date:queryDate,today_rate:'7.200000',synthetic:true},70000,
    ()=>calculateFinanceSummary(tx,{as_of:queryDate,display_currency:'CNY',rates:{USD:queryDate.endsWith('19')?7.2:7}}).expense_minor);
}
run('DW-FX-MISSING-OFFLINE','TARGET_SPEC','missing_fx',{currency:'USD',offline:true,historical_snapshot:null},'missing_historical_rate',
  ()=>calculateFinanceSummary([transaction('missing-fx','USD',10000)],{display_currency:'CNY',offline:true}).conversion_status);
const authorization=[transaction('auth','USD',20000,'expense',{payment_state:'pending_authorization',provider_reference:'SYNTH-P02-AUTH'}),
  transaction('posted','USD',17000,'expense',{payment_state:'posted_settlement',provider_reference:'SYNTH-P02-AUTH'}),
  transaction('release','USD',20000,'authorization_release',{provider_reference:'SYNTH-P02-AUTH'})];
run('CW-AUTH-POST-RELEASE','TARGET_SPEC','preauth_summary',{transactions:authorization},17000,()=>calculateFinanceSummary(authorization).expense_minor);
run('CW-HOLD-ONLY','TARGET_SPEC','preauth_summary',{transactions:[authorization[0]]},0,()=>calculateFinanceSummary([authorization[0]]).expense_minor);
fs.writeFileSync(path.join(output,'web-pure.ndjson'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');

// Acceptance-oracle examples only: there is no production financial AI adapter.
// This double is not connected to the app and its green self-checks are not product PASS.
const ai=[];const fixtures=JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'fixtures/matrix.json'),'utf8')).cases.filter(c=>c.group==='F');
for(const f of fixtures){
  const call=f.consent&&f.ambiguous;
  const request=call?{source_package:f.original_fields.source_package,amount_candidates:f.original_fields.amount_candidates,currency:f.original_fields.currency}:null;
  let decision='no_call';let error;
  try{
    if(call){
      try {
        if(['timeout','http_error','offline'].includes(f.scenario))throw Error('SIMULATED_'+f.scenario);
        const response=JSON.parse(f.scenario==='invalid_json'?'{':JSON.stringify(f.response));
        decision=(!f.expected.candidate_amounts.includes(response.amount_minor)||response.currency!==f.original_fields.currency||response.state==='settled')?'review':'accept';
      } catch (_) { decision='review'; }
    }
    assert.equal(decision,f.expected.decision);
    assert.ok(!JSON.stringify(request).includes('SYNTHETIC_RAW_NEVER_SEND'));
    assert.ok(!JSON.stringify(request).includes('SYNTHETIC_CARD_NEVER_SEND'));
    assert.ok(!JSON.stringify(request).includes('SYNTHETIC_OTP_NEVER_SEND'));
  }catch(e){error=e;}
  ai.push({case_id:f.case_id,group:'F',layer:'TARGET_SPEC',fixture:f,actual:{example_request:request,example_decision:decision,simulated_call_count:call?1:0},
    status:'NOT_TESTED',module_status:'NOT_IMPLEMENTED',contract_self_check:error?'FAIL':'PASS',error:error?.stack||'',coverage:'MOCK_CONTRACT_ORACLE_ONLY_NO_PRODUCTION_INTEGRATION'});
}
for(const [index,scenario,stimulus,expected] of [
  [13,'rule_ai_conflict',{rule_minor:64800,mock_ai_minor:69800,completion_proven:true},'retain_conflict_evidence_and_review'],
  [14,'credible_candidate_uncertain_ai',{credible_candidates:[64800],mock_ai:'uncertain',completion_proven:true},'book_credible_candidate_with_review_marker'],
  [15,'consent_revoked_while_inflight',{consent_before:true,consent_after:false,mock_body:'{"amount_minor":64800}'},'discard_late_response_and_stop_further_calls']]) {
  const wire=JSON.stringify(stimulus);const decoded=JSON.parse(wire);
  ai.push({case_id:'F'+String(index).padStart(3,'0'),group:'F',layer:'TARGET_SPEC',fixture:{scenario,stimulus,expected},
    actual:{mock_response:decoded,production_consumer:'absent'},status:'NOT_TESTED',module_status:'NOT_IMPLEMENTED',
    contract_self_check:'TRANSPORT_FIXTURE_EXECUTED_ONLY',coverage:'MOCK_WIRE_FORMAT_ONLY_NO_BOOKING_OR_CONSENT_IMPLEMENTATION'});
}
fs.writeFileSync(path.join(output,'ai-contract.ndjson'),ai.map(r=>JSON.stringify(r)).join('\n')+'\n');
console.log(JSON.stringify({webRows:rows.length,statuses:Object.fromEntries(['PASS','FAIL','EXPECTED_RED'].map(k=>[k,rows.filter(r=>r.status===k).length])),aiExamples:ai.length,aiProductStatus:'NOT_TESTED',aiContractFailures:ai.filter(r=>r.contract_self_check==='FAIL').length},null,2));
if(rows.some(r=>r.status!=='PASS')||ai.some(r=>r.contract_self_check==='FAIL'))process.exitCode=1;
