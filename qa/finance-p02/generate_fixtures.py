"""Frozen synthetic ground truth. No real notification, account, rate or receipt."""
import itertools
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
cases=[]
def add(group,kind,expected,layer='CURRENT_BASELINE',**data):
    row={'case_id':f'{group}{sum(x["group"]==group for x in cases)+1:03d}', 'group':group,'kind':kind,'layer':layer,
         'source':'SYNTHETIC_ONLY','precondition':'isolated JVM/Room or local JS; no device/backend account',
         'expected':expected,**data}
    cases.append(row)

for pkg,delay,slot,removed,identity,restart,body in itertools.product(
 ['com.tencent.mm','com.eg.android.AlipayGphone'],[0,5000,30000,60000],[True,False],[True,False],['reference','message','empty'],[True,False],[True,False]):
    ambiguous=slot and not removed and identity=='empty' and body
    add('A','independent',{'records':2,'expense_minor':129600},'TARGET_SPEC' if ambiguous else 'CURRENT_BASELINE',
        package=pkg,delay_ms=delay,same_slot=slot,removed=removed,identity=identity,restart=restart,same_body=body,
        new_event_evidence=not ambiguous,observability='indistinguishable_from_update' if ambiguous else 'explicit_or_platform_lifecycle')
for pkg,identity,restart,changed_post in itertools.product(['com.tencent.mm','com.eg.android.AlipayGphone'],['reference','message','empty'],[True,False],[True,False]):
    ambiguous=identity=='empty' and changed_post
    add('A','replay',{'records':1,'expense_minor':64800},'TARGET_SPEC' if ambiguous else 'CURRENT_BASELINE',package=pkg,
        identity=identity,restart=restart,changed_post=changed_post,delay_ms=5000,observability='no_repost_identity_proof' if ambiguous else 'stable_source_identity')
for pkg in ['com.tencent.mm','com.eg.android.AlipayGphone']:
    add('A','interleaved',{'records':2,'expense_minor':129600},package=pkg)
for changed in ['text','timestamp','sender','conversation','source','empty']:
    add('A','messaging_identity',{'same':changed=='text' or changed=='empty','empty':changed=='empty'},changed=changed)
for delay,reference,restart in itertools.product([0,300000,3600000,21600000],[False,True],[False,True]):
    add('B','cross_source',{'records':2,'expense_minor':6800},delay_ms=delay,shared_reference=reference,restart=restart)
for count,delta in itertools.product([1,2],[0,179999,180001,300000,21600000]):
    add('B','reconcile',{'writes':0,'match':count==1 and delta<=180000},'CURRENT_BASELINE' if count==1 else 'TARGET_SPEC',candidates=count,delta_ms=delta)

sequences={
 'standard':[('authorization',20000),('settlement',17000),('release',20000)],
 'duplicate_posted':[('authorization',20000),('settlement',17000),('settlement',17000),('release',20000)],
 'expired':[('authorization',20000),('expiry',20000)],
 'cancelled':[('authorization',20000),('release',20000)],
 'partial':[('authorization',20000),('settlement',8000),('settlement',9000),('release',20000)],
 'refund':[('authorization',20000),('settlement',17000),('refund',5000)],
 'missing_reference':[('authorization',20000),('settlement',17000),('release',20000)],
 'two_holds':[('authorization',20000),('authorization',20000),('settlement',17000)],
}
for name,seq in sequences.items():
    add('C','preauth',{'expense_minor':17000 if name not in ['expired','cancelled'] else 0,'authorization_excluded':True,
        'reference_required':name=='missing_reference','refund_minor':5000 if name=='refund' else 0,'authorization_evidence_preserved':True},'TARGET_SPEC',
        scenario=name,events=[{'state':state,'minor':minor,'currency':'USD','reference':'' if name=='missing_reference' else
            'SYNTH-P02-AUTH-B' if name=='two_holds' and index==1 else 'SYNTH-P02-AUTH-A' if name=='two_holds' else 'SYNTH-P02-AUTH'} for index,(state,minor) in enumerate(seq)])

for pkg,channel,title in [('com.tencent.mm','notifications','微信支付'),('sms','SMS','【合成银行】')]:
 for text,currency,minor in [('支付成功 实付¥100.00','CNY',10000),('已扣款 100 USD','USD',10000),('已扣款 USD 100.00','USD',10000),
    ('已扣款 $100.00','USD',10000),('已扣款 ¥100','CNY',10000),('已扣款 ￥100','CNY',10000),
    ('已扣款 JPY 1000','JPY',1000),('已扣款 100','HKD',10000),('支付成功 实付 EUR 100.00','EUR',10000),
    ('支付成功 实付 HKD 100.00','HKD',10000),('支付成功 实付 GBP 100.00','GBP',10000),
    ('原币 USD 100.00，清算人民币700.00元，手续费10.00元，已扣款','USD',10000)]:
  add('D','parser_currency',{'amount_minor':minor,'currency':currency,'direction':'EXPENSE','records':1},
      'CURRENT_BASELINE' if text=='支付成功 实付¥100.00' else 'TARGET_SPEC',package=pkg,title=title,text=text,stratum=channel,
      default_currency=currency,ambiguous_symbol='$' in text or '¥' in text,metric_eligible=True)

pages=[
 ('actual_and_discounts',['账单详情','支付成功','原价 ¥698.00','优惠 ¥50.00','实付 ¥648.00','余额 ¥352.00'],64800,'EXPENSE'),
 ('one_cent',['转账详情','已被合成用户领取','¥0.01','转账时间','18:49'],1,'EXPENSE'),
 ('split_symbol',['账单详情','付款成功','实付','¥','648.00'],64800,'EXPENSE'),
 ('missing_symbol',['转账详情','已被合成用户领取','0.01','转账时间','18:49'],1,'EXPENSE'),
 ('list_multiple',['交易记录','支付成功 ¥34.00','支付成功 ¥648.00','退款成功 ¥20.00'],None,None),
 ('conflicting',['账单详情','付款成功','实付 ¥648.00','实际支付 ¥646.00'],None,None),
 ('pending',['账单详情','待支付','¥648.00'],64800,None),
 ('otp',['请输入支付密码','验证码 SYNTHETIC-OTP','¥648.00'],None,None),
 ('chat',['聊天','合成用户','支付成功 ¥648.00'],None,None),
 ('balance',['账户余额','¥352.00'],None,None),
]
for name,lines,amount,direction in pages:
 for engine in ['ui_tree','ocr_mock']:
  add('E','page',{'amount_minor':amount,'direction':direction,'must_not_auto_book':name in ['list_multiple','conflicting','pending','otp','chat','balance']},
      scenario=name,lines=lines,engine=engine,stratum='UI_tree' if engine=='ui_tree' else 'OCR_MOCK',metric_eligible=True)
for scenario in ['misread_secondary_disagrees','secure_window_failure','locked_capture_failure','empty_capture','ocr_exception']:
 add('E','ocr_failure',{'answer':False},scenario=scenario,lines=['账单详情','付款成功','实付 ¥646.00'],engine='ocr_mock',stratum='OCR_MOCK')
for age,pkg in itertools.product([89999,90000,90001,96000],['com.tencent.mm','cmb.pb']):
 add('E','ticket',{'accepted':age<=90000 and pkg=='com.tencent.mm'},age_ms=age,package=pkg,sequence=['create','late_ocr_callback'])
for scenario in ['eight_attempts','cooldown_249_250','window_89999_90000_90001','page_changes_share_budget','background_cancel','overlay_retry']:
 add('E','retry',{'finite_budget':True},scenario=scenario)

for name in ['valid_candidate','hallucinated_amount','wrong_currency','wrong_state','invalid_json','timeout','http_error','revoked','offline','rule_unambiguous','consent_absent','sensitive_fields']:
 add('F','ai_contract',{'module':'NOT_IMPLEMENTED','candidate_amounts':[64800,69800,5000,35200],
      'decision':('accept' if name=='valid_candidate' else 'no_call' if name in ['rule_unambiguous','consent_absent','revoked'] else 'review')},'TARGET_SPEC',
      scenario=name,stratum='AI_MOCK_CONTRACT',response={'amount_minor':65000 if name=='hallucinated_amount' else 64800,
      'currency':'USD' if name=='wrong_currency' else 'CNY','state':'settled' if name=='wrong_state' else 'candidate'},
      consent=name not in ['consent_absent','revoked'],ambiguous=name!='rule_unambiguous',
      original_fields={'source_package':'com.tencent.mm','amount_candidates':[64800,69800,5000,35200],
      'currency':'CNY','raw_sms':'SYNTHETIC_RAW_NEVER_SEND','card_number':'SYNTHETIC_CARD_NEVER_SEND','otp':'SYNTHETIC_OTP_NEVER_SEND'})

(HERE/'fixtures/matrix.json').write_text(json.dumps({'schema':1,'synthetic':True,'fx_is_synthetic':True,'cases':cases},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'cases':len(cases),'groups':{g:sum(c['group']==g for c in cases) for g in 'ABCDEF'}},indent=2))
