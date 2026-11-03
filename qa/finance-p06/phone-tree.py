"""Inspect navigation metadata only; print just payment/search controls."""
from pathlib import Path
import argparse,json,re,xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('label');args=parser.parse_args();assert re.fullmatch('[a-z0-9-]+',args.label)
p=ROOT/'docs/migration-evidence/finance-p06/device/ui'/args.label/'private/ui.txt'
text=p.read_text(errors='replace');start=text.find('<hierarchy');end=text.rfind('</hierarchy>')
if start<0 or end<0:print(json.dumps({'readable_nodes':False,'bytes':len(text)}));raise SystemExit
root=ET.fromstring(text[start:end+len('</hierarchy>')]);rows=[]
for node in root.iter('node'):
    value=node.get('text','')+' '+node.get('content-desc','')
    if re.search('搜索|搜尋|转账|轉賬|轉帳|已收款|0[.]01',value):
        rows.append({'text':value.strip()[:80],'bounds':node.get('bounds'),'resource_id':node.get('resource-id'),'clickable':node.get('clickable')})
print(json.dumps({'readable_nodes':True,'payment_search_controls':rows[:20]},ensure_ascii=False))
