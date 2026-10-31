"""Run one allowlisted D01 diagnostic group on this investigation's own QA packages."""
import argparse
import datetime
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import threading

from device_guard import ADB, SERIAL, adb

ROOT = pathlib.Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / 'docs/migration-evidence/d01'
METHODS = {'plain':'L01_plainRepeatedLifecycle', 'native':'L02_nativeRepeatedLifecycle',
           'web':'L03_webRepeatedLifecycle', 'matrix':None,
           'r11':'R11_originalT11ThirtyTimes','r15':'R15_originalT15ThirtyTimes','r16':'R16_originalT16ThirtyTimes',
           't11':'T11_activityBackgroundResumeReadsFreshState','t15':'T15_amountOnlyChangeWhileNoSubscriberIsObservedOnReturn',
           't16':'T16_historicalReceiptDoesNotInsertDeletedRow','full':None,
           'home':'E01_homeAndExternalReturn','screen':'E02_screenSleepWakeExternalReturn'}


def raw(*args, timeout=20):
    return subprocess.run([str(ADB), '-s', SERIAL, *args], stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, timeout=timeout).stdout.decode('utf-8', 'replace')


def services():
    dump = adb('shell', 'dumpsys', 'accessibility')
    match = re.search(r'Bound services:\{([\s\S]*?)\n\s*Enabled services:', dump)
    return {'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'formalBound':bool(match and 'id=uk.thewyj.app/.task21.payment.ThewyjPaymentAccessibilityService' in match[1]),
            'd01ServiceBound':bool(match and re.search(r'id=uk\.thewyj\.app\.qa\.d01',match[1]))}


def kernel_probe(pkg,run):
    """Read only this debuggable QA process's scheduler metadata; no root or signals."""
    pid=raw('shell','pidof',pkg).strip()
    if not pid.isdigit():return
    wait=raw('shell','run-as',pkg,'cat','/proc/'+pid+'/wchan').strip()
    result={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pid':int(pid),'mainWchan':wait,'threads':[]}
    if wait=='do_freezer_trap':
        for tid in raw('shell','run-as',pkg,'ls','/proc/'+pid+'/task').split():
            if not tid.isdigit():continue
            base='/proc/'+pid+'/task/'+tid+'/'
            name=raw('shell','run-as',pkg,'cat',base+'comm').strip()
            if tid==pid or 'Instr:' in name or 'D01' in name:
                result['threads'].append({'tid':int(tid),'name':name,'wchan':raw('shell','run-as',pkg,'cat',base+'wchan').strip()})
    dump=raw('shell','dumpsys','activity','processes',pkg)
    # Keep only the package-specific APP block; dumpsys also prints unrelated global summaries.
    match=re.search(r'(?m)^  \*APP\* UID .*?'+re.escape(pkg)+r'[^\n]*\n([\s\S]*?)(?=\n  \*APP\*|\n  Active instrumentation:|\Z)',dump)
    if match:
        result['ams']= [s.strip() for s in match[0].splitlines() if any(k in s for k in ['mInstr=','pid=','curProcState=','cached=','isFrozen=','isFreezeExempt='])]
    suffix=datetime.datetime.now(datetime.timezone.utc).strftime('%H%M%S-%f')
    (run/('kernel-probe-'+suffix+'.json')).write_text(json.dumps(result,indent=2),encoding='utf-8')
    log=raw('logcat','-d','-v','epoch','-s','FreecessController','FreecessHandler','MARsPolicyManager','MARsHandler')
    allowed=re.compile(re.escape(pkg)+r'(?=[( /:,.]|$)')
    (run/('freecess-qa-only-'+suffix+'.log')).write_text('\n'.join(s for s in log.splitlines() if allowed.search(s)),encoding='utf-8')
    print(json.dumps({'kernelProbe':result}),flush=True)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('build', choices=['current','control'])
    parser.add_argument('mode', choices=METHODS)
    parser.add_argument('label')
    parser.add_argument('--rounds',type=int,default=30)
    parser.add_argument('--sample-mode',choices=['off','individual'],default='off')
    parser.add_argument('--away-seconds',type=float,default=2)
    args=parser.parse_args()
    assert re.fullmatch('[a-zA-Z0-9_-]+',args.label)
    assert 1<=args.rounds<=100
    assert 1<=args.away_seconds<=8
    pkg='uk.thewyj.app.qa.'+('d01' if args.build=='current' else 'd01control')
    owned={r['package'] for r in json.loads((EVIDENCE/'owned-installed.json').read_text(encoding='utf-8'))}
    assert pkg in owned and pkg+'.test' in owned
    run=EVIDENCE/'runs'/args.label
    run.mkdir(parents=True,exist_ok=False)
    before=services()
    assert before['formalBound'] and not before['d01ServiceBound'], 'Preserve formal accessibility binding'
    # Each independent invocation starts with no orphaned EmptyActivity from a failed invocation.
    # These two allowlisted packages were first installed by this investigation; no data is cleared.
    for target in [pkg,pkg+'.test']:
        assert target in owned
        raw('shell','am','force-stop','--user','0',target)
    remote='/sdcard/Android/data/'+pkg+'/files/d01-evidence'
    old=set(raw('shell','ls','-1',remote).splitlines())
    device_epoch=float(adb('shell','date','+%s'))
    live_log=subprocess.Popen([str(ADB),'-s',SERIAL,'logcat','-v','epoch','-T','1',
        '-s','FreecessController','FreecessHandler','MARsPolicyManager','MARsHandler'],
        stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    allowed_vendor=re.compile(re.escape(pkg)+r'(?=[( /:,.]|$)')
    def read_vendor():
        with (run/'freecess-live-qa-only.log').open('w',encoding='utf-8') as sink:
            for data in iter(live_log.stdout.readline,b''):
                line=data.decode('utf-8','replace')
                if allowed_vendor.search(line):sink.write(line);sink.flush()
    vendor_thread=threading.Thread(target=read_vendor,daemon=True);vendor_thread.start()
    clazz='uk.thewyj.app.qa.D01LifecycleTest'
    if args.mode.startswith('r'):clazz='uk.thewyj.app.qa.D01RegressionTest'
    if args.mode in ['home','screen']:clazz='uk.thewyj.app.qa.D01ExternalTest'
    if args.mode.startswith('t') or args.mode=='full':clazz='uk.thewyj.app.qa.StateDeviceAcceptanceTest'
    if METHODS[args.mode]:clazz+='#'+METHODS[args.mode]
    if args.mode=='full':
        text=(EVIDENCE/'qa-host-current/test/uk/thewyj/app/qa/StateDeviceAcceptanceTest.kt').read_text(encoding='utf-8')
        names=[n for n in re.findall(r'@Test fun (T\d\d_\w+)',text)]
        assert len(names)==16
        clazz=','.join(clazz+'#'+n for n in names)
    command=[str(ADB),'-s',SERIAL,'shell','am','instrument','--user','0','-w','-r',
             '-e','disableAnalytics','true','-e','rounds',str(args.rounds),'-e','sampleMode',args.sample_mode,'-e','class',clazz,
             pkg+'.test/uk.thewyj.app.qa.StateAcceptanceRunner']
    start=time.monotonic();latest_stage=None;stage_at=start;new_session=None;stopped=False
    last_progress=0;last_service=start;probed=False;external_handled=set()
    with (run/'instrumentation.log').open('wb') as out:
        process=subprocess.Popen(command,stdout=out,stderr=subprocess.STDOUT)
        while process.poll() is None:
            time.sleep(3)
            names=[s for s in raw('shell','ls','-1',remote).splitlines() if s not in old and re.fullmatch('[0-9TZ.-]+',s)]
            if names:new_session=max(names)
            if new_session:
                tail=raw('shell','tail','-n','20',remote+'/'+new_session+'/events.ndjson')
                rows=[]
                for line in tail.splitlines():
                    try:rows.append(json.loads(line))
                    except ValueError:pass
                stages=[r.get('stage') for r in rows if r.get('kind')=='stage']
                stage=stages[-1] if stages else latest_stage
                if (args.mode.startswith('t') or args.mode=='full') and not stages:
                    runner_log=(run/'instrumentation.log').read_text(encoding='utf-8',errors='replace')
                    runner_methods=re.findall(r'INSTRUMENTATION_STATUS: test=(\w+)',runner_log)
                    if runner_methods:stage=runner_methods[-1]
                if stage!=latest_stage:latest_stage=stage;stage_at=time.monotonic();probed=False
                requests=[r for r in rows if r.get('kind')=='external-request' and r.get('round') not in external_handled]
                if requests:
                    request=requests[-1];external_handled.add(request['round'])
                    focus='\n'.join(s for s in raw('shell','dumpsys','window').splitlines() if 'mCurrentFocus=' in s)
                    assert pkg+'/' in focus, 'Only background/sleep an own QA foreground window'
                    action={'request':request,'focusBefore':focus,'beforeUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
                    if request['mode']=='home':raw('shell','input','keyevent','KEYCODE_HOME')
                    else:raw('shell','input','keyevent','KEYCODE_SLEEP')
                    time.sleep(args.away_seconds)
                    action['awaySeconds']=args.away_seconds
                    action['powerWhileAway']=[s.strip() for s in raw('shell','dumpsys','power').splitlines() if re.match(r'\s*mWakefulness=',s)]
                    if request['mode']=='screen':raw('shell','input','keyevent','KEYCODE_WAKEUP')
                    keyguard=[s.strip() for s in raw('shell','dumpsys','window','policy').splitlines() if 'mIsShowing=' in s]
                    action['keyguardAfterWake']=keyguard
                    if any('mIsShowing=true' in s for s in keyguard):
                        (run/'owner-unlock-required.json').write_text(json.dumps(action,indent=2),encoding='utf-8')
                        print('OWNER_UNLOCK_REQUIRED: use normal device unlock; no bypass attempted',flush=True)
                    action['return']=raw('shell','am','start','--activity-reorder-to-front','--activity-single-top','-n',pkg+'/uk.thewyj.app.qa.StateAcceptanceActivity')
                    action['afterUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
                    action_file=run/('external-action-'+str(request['round'])+'.json')
                    action_file.write_text(json.dumps(action,indent=2),encoding='utf-8')
                    if 'ackFile' in request:
                        assert re.fullmatch(r'd01-external-ack-[a-f0-9-]+\.json',request['ackFile'])
                        raw('push',str(action_file),'/sdcard/Android/data/'+pkg+'/files/'+request['ackFile'])
                if time.monotonic()-last_progress>15:
                    print(json.dumps({'label':args.label,'stage':latest_stage,'hostElapsedSeconds':round(time.monotonic()-start,1)}),flush=True)
                    last_progress=time.monotonic()
            if time.monotonic()-last_service>30:
                check=services()
                with (run/'service-monitor.ndjson').open('a',encoding='utf-8') as f:f.write(json.dumps(check)+'\n')
                if not check['formalBound'] or check['d01ServiceBound']:
                    (run/'isolation-failure.json').write_text(json.dumps(check),encoding='utf-8')
                    for target in [pkg,pkg+'.test']:
                        assert target in owned
                        raw('shell','am','force-stop','--user','0',target)
                    stopped=True
                    break
                last_service=time.monotonic()
            if time.monotonic()-stage_at>8 and not probed:
                kernel_probe(pkg,run)
                probed=True
            # A separate watchdog remains available if the in-process sampler itself cannot run.
            stage_limit=160 if latest_stage and latest_stage.startswith('T12') else 50
            if latest_stage and latest_stage.startswith('OWNER_UNLOCK_REQUIRED:'):stage_limit=125
            if (new_session and time.monotonic()-stage_at>stage_limit) or (not new_session and time.monotonic()-start>60):
                (run/'host-watchdog.json').write_text(json.dumps({'status':'WATCHDOG_FAIL','lastStage':latest_stage,'elapsedSeconds':time.monotonic()-start}),encoding='utf-8')
                for target in [pkg,pkg+'.test']:
                    assert target in owned
                    raw('shell','am','force-stop','--user','0',target)
                stopped=True
                break
        try:process.wait(timeout=15)
        except subprocess.TimeoutExpired:process.terminate();process.wait(timeout=10)
    live_log.terminate();live_log.wait(timeout=10);vendor_thread.join(timeout=5)
    if new_session:
        raw('pull',remote+'/'+new_session,str(run/'device-evidence'),timeout=45)
    raw('pull','/sdcard/Android/data/'+pkg+'/files/qa3-evidence',str(run/'qa3-evidence'),timeout=45)
    system=raw('logcat','-d','-v','epoch','-s','ActivityManager','ActivityTaskManager',timeout=25)
    filtered=[]
    pattern=re.compile(re.escape(pkg)+r'(?=[/ .:\}]|$)')
    for line in system.splitlines():
        try:stamp=float(line.split()[0])
        except (ValueError,IndexError):continue
        if stamp>=device_epoch and pattern.search(line):filtered.append(line)
    (run/'system-qa-only.log').write_text('\n'.join(filtered)+'\n',encoding='utf-8')
    vendor=raw('logcat','-d','-v','epoch','-s','FreecessController','FreecessHandler','MARsPolicyManager','MARsHandler')
    lines=[]
    for line in vendor.splitlines():
        try:stamp=float(line.split()[0])
        except (ValueError,IndexError):continue
        if stamp>=device_epoch and allowed_vendor.search(line):lines.append(line)
    (run/'freecess-buffered-qa-only.log').write_text('\n'.join(lines),encoding='utf-8')
    after=services()
    events=[]
    file=run/'device-evidence/events.ndjson'
    if file.exists():events=[json.loads(s) for s in file.read_text(encoding='utf-8').splitlines()]
    log=(run/'instrumentation.log').read_text(encoding='utf-8',errors='replace')
    result={'build':args.build,'mode':args.mode,'roundsRequested':args.rounds,
            'roundsPassed':sum(r.get('kind')=='round-pass' for r in events),
            'failedSteps':[r for r in events if r.get('kind') in ['step-fail','WATCHDOG_FAIL']],
            'groupPasses':[r for r in events if r.get('kind')=='group-pass'],
            'hostWatchdog':stopped,'elapsedSeconds':round(time.monotonic()-start,3),
            'junitCompletePass':bool(re.search(r'OK \(\d+ tests?\)',log)) and 'FAILURES!!!' not in log,
            'servicesBefore':before,'servicesAfter':after,'deviceEpochAtStart':device_epoch,
            'sampleCount':sum(r.get('kind')=='sample' for r in events)}
    result['skippedTests']=len(re.findall(r'INSTRUMENTATION_STATUS_CODE: -(?:3|4)\b',log))
    repeated=args.mode in ['plain','native','web','matrix','r11','r15','r16','home','screen']
    expected_rounds=args.rounds*(3 if args.mode=='matrix' else 1)
    result['allRequestedRoundsCompleted']=(not repeated or
        (result['roundsPassed']==expected_rounds and bool(result['groupPasses'])))
    result['qualifiedPass']=(result['junitCompletePass'] and not stopped and after['formalBound']
        and not result['skippedTests'] and result['allRequestedRoundsCompleted'])
    (run/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result),flush=True)
    return 0 if result['qualifiedPass'] else 1


if __name__=='__main__':
    sys.exit(main())
