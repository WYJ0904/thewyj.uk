"""Add fresh device evidence without overwriting the earlier offline snapshot."""
from pathlib import Path
import collections,datetime,json,re
ROOT=Path(__file__).resolve().parents[3];BASE=ROOT/'docs/migration-evidence/finance-p03/finish'
read=lambda p:json.loads(p.read_text(encoding='utf8-sig'))
def main():
    dest=BASE/'delivery-phone-final';dest.mkdir(exist_ok=False)
    summary=read(BASE/'delivery-final/summary.json')
    attempts=[];executed=[];unique=collections.defaultdict(list)
    for file in sorted(BASE.glob('*.json')):
        if file.stat().st_size>100000:continue
        try:r=read(file)
        except (ValueError,UnicodeError):continue
        if not isinstance(r,dict) or r.get('action')!='instrument':continue
        row={'name':file.stem,'evidence':file.relative_to(ROOT).as_posix(),**r};attempts.append(row)
        if not r.get('counts'):continue
        executed.append(row)
        log=(ROOT/r['log']).read_text(encoding='utf8')
        # Class/method identity is extracted only from actual completion bundles.
        for block,code in re.findall(r'((?:INSTRUMENTATION_STATUS:.*\n)+)INSTRUMENTATION_STATUS_CODE: (-?\d+)',log):
            if int(code)>0:continue
            clazz=re.search(r'^INSTRUMENTATION_STATUS: class=(.+)$',block,re.M)
            method=re.search(r'^INSTRUMENTATION_STATUS: test=(.+)$',block,re.M)
            if clazz and method:unique[clazz[1].strip()+'#'+method[1].strip()].append({'run':file.stem,'code':int(code)})
    continuous=read(BASE/'continuous-thirty/summary.json')
    notification=read(BASE/'notification-os-after-harness-fix/summary.json')
    actual_counts={s:sum(r['counts'].get(s,0) for r in executed) for s in ['PASS','FAIL','SKIP']}
    summary['utc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    summary['physical_current_run']={'device':'Samsung SM-S9360 / Android 16 / API36 / user0',
        'all_instrumented_method_executions_including_repeats':actual_counts,
        'instrumented_attempts':len(attempts),'actually_executed_attempts':len(executed),
        'unique_method_identities':len(unique),'maintenance_helpers_excluded':True,
        'continuous_matrix':continuous,'actual_os_notifications':notification,
        'a11y_normal':read(BASE/'accessibility-ordinary-settings-final.json'),
        'actual_os_notifications_all_attempts':[{**read(BASE/n/'summary.json'),'evidence':n+'/summary.json'} for n in ['notification-os-final','notification-os-normal-start','notification-os-after-harness-fix']],
        'normal_notification_recovery_all_attempts':[{**read(BASE/n/'summary.json'),'evidence':n+'/summary.json'} for n in ['notification-normal-recovery','notification-recovery-after-normal-start']],
        'instrumentation_boundary_diagnostic':read(BASE/'nls-instrumentation-boundary/summary.json'),
        'a11y_instrumented_settings_failed_observation_retained':'accessibility-normal-owner-confirmed.json (both manager/connection false; filename is not a PASS verdict)',
        'historical_continuous_matrix_23_pass_1_fail':'UNRESOLVED; retained, not erased by fresh passes',
        'formal_business_e2e':'NOT TESTED','formal_private_backup':'NOT TESTED','os_lmk':'NOT TESTED'}
    summary['cases28']=read(BASE/'case-analysis-28.json')
    summary['cases28'].pop('rows')
    summary['phone_cleanup']=read(BASE/'phone-cleanup-final.json')
    summary['status']='PARTIAL'
    for name,data in [('summary.json',summary),('physical-attempts.json',attempts),('unique-methods.json',dict(unique))]:
        (dest/name).write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
    old_ledger=read(BASE/'delivery-final/failure-ledger.json')
    old_ledger['physical_current_nonpass']=[r for r in attempts if r['status']!='PASS']
    old_ledger['physical_expected_missing_external']=['Legitimate provider account/operation/correction proof','Formal private consistent backup and old APK open','Real WeChat/Alipay flows','Historical lifecycle cause','OS LMK']
    old_ledger['physical_historical_failure_preserved']='docs/migration-evidence/finance-p03/device/device-final-native-suite.log'
    old_ledger['os_notification_all_failed_cases']=[{'evidence':str(file.relative_to(ROOT)),**json.loads(line)} for name in ['notification-os-final','notification-os-normal-start','notification-os-after-harness-fix'] for file in [BASE/name/'results.ndjson'] for line in file.read_text(encoding='utf8').splitlines() if line.strip() and json.loads(line)['status']=='FAIL']
    old_ledger['normal_recovery_all_failed_cases']=[{'evidence':name+'/results.json',**r} for name in ['notification-normal-recovery','notification-recovery-after-normal-start'] for r in read(BASE/name/'results.json') if r['status']=='FAIL']
    old_ledger['a11y_failed_maintenance_observation']=read(BASE/'accessibility-normal-owner-confirmed.json')
    (dest/'failure-ledger.json').write_text(json.dumps(old_ledger,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'physical_execution_counts':actual_counts,'unique_methods':len(unique),'offline607':summary['original607'],
        'frozen608':summary['frozen608'],'status':summary['status']},ensure_ascii=False))
if __name__=='__main__':main()
