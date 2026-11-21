import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcileMergeFinance } from '../../functions/_lib/ds-merge-finance.mjs';
import { preserveMergeMembership } from '../../functions/_lib/task13-ds-merge.mjs';

const minor='9007199254740995';
const tx=(subject,id,fields={})=>({subject,id,amount:minor,exponent:2,currency:'USD',occurred:123,
  source:'manual',direction:'expense',status:'active',revision:1,reviewState:'confirmed',merchant:'',counterparty:'',...fields});
const fact=(row,reference,fields={})=>({subject:row.subject,transaction:row.id,provider:'verified',
  account:'payer-scope',reference,parent:'',kind:row.direction,amount:row.amount,currency:row.currency,
  exponent:row.exponent,digest:'a'.repeat(64),...fields});
const base={evidence:[],lifecycle:[]};

test('strong origin preserves receipts, exact units, refund parent and transfer semantics',async()=>{
  const a=tx('a','original');
  const b=tx('b','drawn-copy');
  const r=tx('a','refund',{amount:'12',direction:'refund',occurred:124});
  const t=tx('b','transfer',{direction:'income',currency:'JPY',exponent:0,amount:'42',occurred:133});
  const result=await reconcileMergeFinance({...base,transactions:[a,b,r,t],authority:[
    fact(a,'op'),fact(b,'op'),fact(r,'return',{parent:'op'}),fact(t,'move',{kind:'transfer'}),
  ]},'b');
  assert.deepEqual(result.review,[]);
  assert.equal(result.summary.duplicates,1);
  assert.equal(result.receipts[0].canonical,result.receipts[1].canonical);
  assert.equal(result.receipts[2].payload.refundOf,result.receipts[1].canonical);
  assert.deepEqual(result.summary.totals,[['JPY',0,'transfer','42'],['USD',2,'expense',minor],['USD',2,'refund','12']]);
});

test('same amount and timestamp, ambiguous currency and unverified refund are review-only',async()=>{
  const a=tx('a','original');
  const b=tx('b','unverified-copy');
  const c=tx('c','ambiguous',{exponent:null,currencyReview:1,occurred:456});
  const r=tx('a','unverified-refund',{direction:'refund',occurred:789,amount:'22'});
  const result=await reconcileMergeFinance({...base,transactions:[a,b,c,r],authority:[]},'a');
  assert.equal(result.summary.duplicates,0);
  assert.deepEqual(result.review.map(row=>row.kind).sort(),
    ['CURRENCY_UNVERIFIED','POSSIBLE_DUPLICATE_OR_TRANSFER','REFUND_LINK_UNVERIFIED']);
  assert.equal(result.receipts[3].payload.refundOf,null);
  assert.ok(!result.summary.totals.some(row=>row[2]==='income'));
});

test('membership coverage uses the strongest existing grant and preserves provenance and effective caps',()=>{
  const common={starts:'2025-01-01T00:00:00Z',lifetime:0,state:'active',entitlements:['tools_access']};
  const result=preserveMergeMembership({memberships:[
    {...common,subject:'keep',id:'term',source:'payment',expires:'2030-01-01T00:00:00Z'},
    {...common,subject:'other',id:'life',source:'gift',lifetime:1,expires:'',entitlements:['tools_access','language_english_access']},
    {...common,subject:'other',id:'expired',source:'payment',expires:'2025-02-01T00:00:00Z',entitlements:['all_features_access']},
    {...common,subject:'other',id:'future',starts:'2030-01-01T00:00:00Z',expires:'2031-01-01T00:00:00Z'},
  ],overrides:[{subject:'keep',entitlement:'language_english_access',allowed:0}]},'keep',Date.parse('2026-01-01'));
  assert.deepEqual(result.summary.coverage,[{code:'tools_access',expiresAt:null}]);
  assert.equal(result.summary.archived,2);
  assert.deepEqual(result.receipts.map(row=>row.payload.state),['ACTIVE','ACTIVE','EXPIRED','SCHEDULED']);
});
