// Read-only evaluation of the fixed P07 formatter; no Flash checkout mutation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {moneyText} from '../../js/finance/money.js';
import {formatFinanceMoney} from '../../js/finance/format.js';
import {moneyCapability,requiredMoneyCapability,requireMoneyCapability} from '../../functions/_lib/finance-client-capability.mjs';
import {Task16Error} from '../../functions/_lib/task16-model.mjs';
const root=path.resolve(import.meta.dirname,'../..'),sha='d26bbb8112e7d10a5dfede40af0fe19c4c447866';
const source=execFileSync('git',['show',sha+':js/finance/format.js'],{cwd:root,encoding:'utf8'});
const old=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const context={request:new Request('https://synthetic.invalid/api/finance/transactions')};
const row={currency:'JPY',amount_minor:123,amount_exponent:0};
assert.equal(moneyText(123,'JPY'),'123');assert.ok(old.formatFinanceMoney(123,'JPY').includes('1.23'));
assert.equal(moneyCapability(context),1);assert.equal(requiredMoneyCapability(row),2);
assert.throws(()=>requireMoneyCapability(context,row,Task16Error),error=>error.code==='currency_client_upgrade_required');
const result={p07_sha:sha,formatter_sha256:createHash('sha256').update(source).digest('hex'),
 sample:{amount_minor:123,currency:'JPY',amount_exponent:0,p07_display:old.formatFinanceMoney(123,'JPY'),p04_display:formatFinanceMoney(123,'JPY'),exact_amount:'123'},
 old_client_money_version:1,required_money_version:2,old_client_fails_closed:true,
 conclusion:'P07 financial UI must adopt exact units and review-state support before claiming Money-Version 3',
 scope:'pure formatter and capability guard on fixed Git code; not a live P07 UI integration acceptance'};
const out=path.join(root,'docs/migration-evidence/finance-safe-convergence/interface-audit.json');
await fs.writeFile(out,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
