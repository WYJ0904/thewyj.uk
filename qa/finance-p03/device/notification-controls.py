"""One-variable sender timestamp reversal plus real QA background/restart."""
from pathlib import Path
import argparse,hashlib,json,subprocess,time,uuid
import phone
OUT=Path(__file__).resolve().parents[3]/'docs/migration-evidence/finance-p03/device'
def main():
    p=argparse.ArgumentParser();p.add_argument('--name',default='notification-controls');p.add_argument('--skip-timestamp',action='store_true');args=p.parse_args()
    dest=OUT/args.name;dest.mkdir(exist_ok=False);s=phone.device()
    assert not phone.state(s)['formal_nls_enabled']
    owned=json.loads((OUT/'owned-install.json').read_text(encoding='utf8'));assert owned['device_sha256']==hashlib.sha256(s.encode()).hexdigest()
    tag='FINANCE_P03_AB_'+uuid.uuid4().hex[:10].upper()
    def file(name):
        r=subprocess.run([str(phone.ADB),'-s',s,'exec-out','run-as',phone.PKG,'cat','files/finance-p03-device/'+name],capture_output=True,timeout=10)
        return r.stdout.decode('utf8') if r.returncode==0 else ''
    def posts(t):return [r for line in file('platform.ndjson').splitlines() if line.strip() for r in [json.loads(line)] if r.get('tag')==t and r.get('event')=='posted']
    def control(op,t='',old=False):
        value=phone.run('-s',s,'shell','am','broadcast','--user','0','--include-stopped-packages','-n',phone.PKG+'/uk.thewyj.app.qa.finance.FinanceDeviceControlReceiver','--es','operation',op,'--es','tag',t,'--ez','historical_when',str(old).lower())
        with (dest/'commands.ndjson').open('a',encoding='utf8') as f:f.write(json.dumps({'operation':op,'tag':t,'historical_when':old,'output':value})+'\n')
    def wait(t,n):
        end=time.monotonic()+10
        while time.monotonic()<end:
            rows=posts(t)
            if len(rows)>=n:return rows
            time.sleep(.1)
        raise AssertionError('Actual OS callback absent')
    def quiet(t,n):
        end=time.monotonic()+10
        while time.monotonic()<end:
            assert len(posts(t))==n,'Historical timestamp unexpectedly delivered; attribution not established'
            time.sleep(.2)
    if not args.skip_timestamp:
        control('post',tag,True);quiet(tag,0)
        control('post',tag);first=wait(tag,1)
        control('cancel',tag);time.sleep(.2)
        control('post',tag,True);quiet(tag,1)
        control('post',tag);second=wait(tag,2)
        timestamp={'status':'CONTROLLED_OBSERVATION','same_apk':'apk-final11.json','same_package_uid_tag_channel_and_body':True,'sequence':['when=1000 no callback in original 10s','current time callback','cancel owned','when=1000 no new callback in original 10s','current time callback'],'posted':second,'conclusion':'QA live sender timestamp is causal in this device condition; exact platform discard implementation NOT TESTED','original_failure_retained':True,'frozen608_changed':False}
        (dest/'timestamp-ab.json').write_text(json.dumps(timestamp,indent=2),encoding='utf8');print(json.dumps({'timestamp_control':'CONFIRMED_QA_FIXTURE','callbacks':len(second)}),flush=True)
    main_component=phone.PKG+'/uk.thewyj.app.MainActivity'
    def launch():phone.run('-s',s,'shell','am','start','-W','--user','0','-n',main_component,'-a','android.intent.action.VIEW','-d','thewyj://app?route=%2Ffinance')
    launch()
    helper=phone.run('-s',s,'shell','am','start','-W','--user','0','-n',phone.PKG+'/androidx.test.core.app.InstrumentationActivityInvoker\\$EmptyActivity')
    assert 'Status: ok' in helper and '$EmptyActivity' in helper,helper
    (dest/'helper-launch.txt').write_text(helper,encoding='utf8')
    bg=tag+'_BACKGROUND';phone.run('-s',s,'shell','cmd','notification','post','-t','P03_SYNTHETIC',bg,'P03_SYNTHETIC_ONLY');background=wait(bg,1);launch()
    before=phone.run('-s',s,'shell','pidof','-s',phone.PKG).strip();assert before.isdigit()
    phone.run('-s',s,'shell','am','force-stop','--user','0',phone.PKG);launch();control('bind')
    after=phone.run('-s',s,'shell','pidof','-s',phone.PKG).strip();assert after.isdigit() and after!=before
    restart=tag+'_RESTART';phone.run('-s',s,'shell','cmd','notification','post','-t','P03_SYNTHETIC',restart,'P03_SYNTHETIC_ONLY');restored=wait(restart,1)
    result={'status':'PASS','background_callback':background,'post_owned_force_stop_callback':restored,'before_pid':int(before),'after_pid':int(after),'normal_grants_preserved':phone.state(s),'os_low_memory_kill':'NOT TESTED; termination was owned QA force-stop','synthetic_only':True}
    (dest/'recovery.json').write_text(json.dumps(result,indent=2),encoding='utf8');(dest/'platform.ndjson').write_text(file('platform.ndjson'),encoding='utf8');print(json.dumps({'background_and_owned_restart':'PASS','old_pid':before,'new_pid':after}),flush=True)
if __name__=='__main__':main()
