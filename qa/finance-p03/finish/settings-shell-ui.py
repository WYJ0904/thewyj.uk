"""Normal Settings UI outside the owned app's instrumentation lifecycle.

Read a Settings-only accessibility tree; tap only a fresh observed unique node.
Never write permission databases or inspect a private app window. Each temporary
device XML has a task-owned random name and is removed after export.
"""
from pathlib import Path
import argparse,json,re,subprocess,sys,uuid,xml.etree.ElementTree as ET
sys.dont_write_bytecode=True
import phone
p=argparse.ArgumentParser();p.add_argument('--name',required=True);p.add_argument('--text');p.add_argument('--resource');a=p.parse_args()
assert re.fullmatch('[a-z0-9-]+',a.name)
dest=phone.OUT/'settings-shell-ui';dest.mkdir(exist_ok=True);file=dest/(a.name+'.json');assert not file.exists()
s=phone.device();assert not phone.state(s)['formal_nls_enabled']
windows=phone.run('-s',s,'shell','dumpsys','window')
focus=re.search(r'mCurrentFocus=Window\{[^\r\n]*?\s(com\.android\.settings)/',windows)
assert focus,'Only foreground system Settings is permitted; no private-window fallback'
remote='/data/local/tmp/finance-p03-finish-ui-'+uuid.uuid4().hex+'.xml'
try:
    status=subprocess.run([str(phone.ADB),'-s',s,'shell','test','-e',remote],capture_output=True)
    assert status.returncode==1,'Own temporary path must not exist'
    phone.run('-s',s,'shell','uiautomator','dump','--compressed',remote,timeout=25)
    data=phone.run('-s',s,'shell','cat',remote)
    root=ET.fromstring(data)
    nodes=[dict(n.attrib) for n in root.iter('node')]
    assert all(n.get('package','') in ['','com.android.settings','com.android.systemui','com.android.permissioncontroller','com.google.android.permissioncontroller'] for n in nodes)
    result={'maintenance_only':True,'normal_system_ui':True,'permission_database_writes':False,'nodes':nodes}
    if a.text or a.resource:
        targets=[n for n in nodes if (a.text is None or n.get('text')==a.text) and (a.resource is None or n.get('resource-id')==a.resource)]
        assert len(targets)==1,'Tap requires exactly one freshly observed node'
        target=targets[0];m=re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]',target['bounds']);assert m
        x1,y1,x2,y2=map(int,m.groups());assert 0<=x1<x2 and 0<=y1<y2
        phone.run('-s',s,'shell','input','tap',str((x1+x2)//2),str((y1+y2)//2))
        result['tapped']={'text':target.get('text'),'resource':target.get('resource-id'),'bounds':target['bounds']}
    file.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'name':a.name,'tapped':result.get('tapped'),'nodes':[{k:n.get(k) for k in ['text','resource-id','checked','bounds']} for n in nodes if n.get('text') or n.get('checkable')=='true']},ensure_ascii=False))
finally:
    # One checked, literal task-owned filename only, never a recursive delete.
    assert re.fullmatch(r'/data/local/tmp/finance-p03-finish-ui-[a-f0-9]{32}\.xml',remote)
    phone.run('-s',s,'shell','rm',remote)
