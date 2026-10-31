"""P03-A evidence-only reports. Never regenerates historic P01/P02/P03 files."""
import argparse,collections,datetime,hashlib,json,re,subprocess,xml.etree.ElementTree as ET
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
BASE=ROOT/'docs/migration-evidence/finance-p03/phase-a'
DOC=ROOT/'docs/finance-p03'
BASELINE='09442c2985368dfb09ddfa6b613c3be2d0f21b9d'
NODE='node-closure';SERVER='server-closure';MIGRATION='migration-final-role';BRIDGE='closure-a-bridge'
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def rel(p):return p.relative_to(ROOT).as_posix()
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT).decode('utf8').strip()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def counts(rows):return dict(collections.Counter(r['status'] for r in rows))
def ndjson(p):return [dict(json.loads(s),evidence=rel(p)+':'+str(i)) for i,s in enumerate(p.read_text(encoding='utf8-sig').splitlines(),1) if s.strip()]
def short(v,n=180):
 if not isinstance(v,str):v=json.dumps(v,ensure_ascii=False,separators=(',',':'))
 return v.replace('|','/').replace('\r',' ').replace('\n',' ')[:n]
def junit(directory):
 rows={}
 for file in directory.glob('TEST-*.xml'):
  suite=ET.parse(file).getroot()
  for case in suite.findall('testcase'):
   key=(suite.get('name'),case.get('name'));failure=case.find('failure');error=case.find('error')
   rows[key]={'class':key[0],'method':key[1],'seconds':case.get('time'),'status':'FAIL' if failure is not None or error is not None else 'NOT_TESTED' if case.find('skipped') is not None else 'PASS','error':(failure.text if failure is not None else error.text if error is not None else '') or '', 'evidence':rel(file)+'#'+key[1]}
 return rows
def bridge(name,prefix):
 seed=read(BASE/name/'seed.json');restore=read(BASE/name/'restore.json');server=read(BASE/name/'server-final.json');run=read(BASE/(name+'-run.json'))
 assert seed['pid']!=restore['pid'] and run['server_exited'] and run['seed_exit']==run['restore_exit']==0
 assert restore['queue']==[] and server['status']=='PASS'
 assert {b['transaction_id'] for b in restore['bookings']}=={t['id'] for t in server['txs']}
 result=[]
 for label,data in [('SEED',seed),('RESTORE',restore)]:result.append({'case_id':prefix+label,'status':'PASS','actual':data,'evidence':rel(BASE/name/(label.lower()+'.json'))})
 return result,dict(server,seed_pid=seed['pid'],restore_pid=restore['pid'])
def collect():
 full=junit(BASE/'closure-full-junit');prior=junit(BASE.parent/'reviewed-final-junit');closed=junit(BASE.parent/'closeout/completion-full-junit')
 original={k for k in prior if '.FinanceP03' not in k[0]};p03=set(prior)-original;closeout=set(closed)-set(prior);added=set(full)-set(closed)
 assert len(original)==588 and len(p03)==26 and len(closeout)==18 and original|p03|closeout|added==set(full)
 assert len(full)==663 and len(added)==31
 old=[dict(full[k],case_id='P03-JVM-'+k[1]) for k in sorted(p03)]
 old+=ndjson(BASE/NODE/'p03-server/server.ndjson')+ndjson(BASE/NODE/'p03-legacy/legacy-raw.ndjson')
 old+=[dict(r,evidence=rel(BASE/NODE/'p03-migration/migration.json')) for r in read(BASE/NODE/'p03-migration/migration.json')]
 previous=[dict(full[k],case_id='CO-JVM-'+k[1]) for k in sorted(closeout)]
 previous+=ndjson(BASE/NODE/'closeout-server/clearing.ndjson')+ndjson(BASE/NODE/'closeout-d1/migration.ndjson')
 new=[dict(full[k],case_id='A-JVM-'+k[1]) for k in sorted(added)]
 new+=ndjson(BASE/SERVER/'reconciliation.ndjson')+ndjson(BASE/MIGRATION/'migration.ndjson')
 bridges={}
 for name,prefix,target in [('closure-legacy','P03-BRIDGE-',old),('closure-closeout','CO-BRIDGE-',previous),(BRIDGE,'A-BRIDGE-',new)]:
  rows,detail=bridge(name,prefix);target+=rows;bridges[name]=detail
 assert len(old)==63 and len(previous)==41 and len(new)==99
 assert {r['case_id'] for r in old}=={r['case_id'] for r in read(BASE.parent/'p03-results.json')}
 assert {r['case_id'] for r in previous}=={r['case_id'] for r in read(BASE.parent/'closeout/new-results.json')}
 # No inherited status or expected value is used as a new execution result.
 historical={r['case_id']:r for r in read(BASE.parent/'closeout/p02-comparison.json')}
 matrix=[]
 for group in 'ABCDE':matrix+=ndjson(BASE/'closure-p02-native'/('kotlin-'+group+'.ndjson'))
 for name in ['web-pure.ndjson','web-dom.ndjson','ledger-d1.ndjson','ai-contract.ndjson']:matrix+=ndjson(BASE/NODE/'p02-web'/name)
 for name in ['process-G-PROCESS-SEED.ndjson','process-G-PROCESS-RESTORE.ndjson']:matrix+=ndjson(BASE/'closure-p02-process'/name)
 matrix+=ndjson(BASE/'closure-p02-native/negative-bookings.ndjson')
 matrix.append(dict(read(BASE/'closure-p02-native/timing.json'),evidence=rel(BASE/'closure-p02-native/timing.json')))
 for r in historical.values():
  if r['case_id'].startswith('G-REUSED-'):
   f=r['fixture'];fresh=full[(f['class'],f['method'])];matrix.append(dict(r,status=fresh['status'],evidence=fresh['evidence']))
  elif r['case_id'].startswith('NT-'):matrix.append(dict(r,evidence='NOT_TESTED: hardware/Production/real backup prohibited in P03-A'))
 assert len(matrix)==608 and {r['case_id'] for r in matrix}==set(historical)
 for r in matrix:
  prior_row=historical[r['case_id']]
  original_fixture=prior_row.get('fixture',{})
  fixture=original_fixture if isinstance(original_fixture,dict) else {'original_fixture':original_fixture}
  r.update(baseline_status=prior_row['status'],fixture=fixture,fixture_original=original_fixture)
  if not fixture or not isinstance(original_fixture,dict):
   r['fixture']={**fixture,**{k:prior_row[k] for k in ['expected','coverage','layer','target_policy'] if k in prior_row}}
 node=read(BASE/NODE/'exits.json');assert len(node)==13
 tap=(BASE/NODE/'aeris-node.log').read_text(encoding='utf8-sig');dom=read(BASE/NODE/'aeris-dom.log')
 assert re.search(r'tests\s+13\b',tap) and re.search(r'fail\s+0\b',tap) and dom['tests']==dom['pass']==6 and dom['fail']==0
 lint=collections.Counter(r.get('severity') for r in ET.parse(BASE/'closure-full-lint.xml').getroot().findall('issue'))
 protected=read(BASE/'protected-seal.json')['comparison']
 changes=sorted(set(git('diff','--name-only',BASELINE).splitlines())|set(git('ls-files','--others','--exclude-standard').splitlines()))
 product=[p for p in changes if p.startswith(('android/app/src/main/','android/app/schemas/','functions/','cloudflare/migrations/'))]
 summary={'phase':'FINANCE-P03-A','status':'PARTIAL','baseline':BASELINE,'test_jvm':dict(collections.Counter(r['status'] for r in full.values())),
  'original_607':{'total':607,'native':dict(collections.Counter(full[k]['status'] for k in original)),'node':13,'dom':6,'fixture_qualifications':'3 inherited P03 fixture conditions; only migration registration/target extended this phase'},
  'existing_p03':counts(old),'closeout':counts(previous),'p03a_new':counts(new),'p03a_breakdown':{'standard_jvm':len(added),'service':58,'d1_migration':8,'bridge_methods':2},
  'matrix':counts(matrix),'matrix_changes':[{'case_id':r['case_id'],'before':r['baseline_status'],'after':r['status']} for r in matrix if r['status']!=r['baseline_status']],
  'lint':dict(lint),'debug':'PASS' if read(BASE/'closure-full-run.json')['exit_code']==0 else 'FAIL','bridges':bridges,'product_files':product,
  'selected':{'jvm':'closure-full-junit','node':NODE,'service':SERVER,'migration':MIGRATION,'bridge':BRIDGE},
  'not_tested':['real_provider_semantics_and_adapter','real_phone','real_payments','Production_or_Hosted','formal_APK_upgrade','native_D1_binary_backup','real_Room_D1_backup_restore'],
  'protected':protected,'owner_materials':read(BASE/'owner-materials.json'),'duplicate_policy':'Do not add 607/663/63/41/99/608; reused methods, loop repetitions and repeated runs are not new cases.'}
 assert all(r['exit_code']==(1 if r['name'] in ['p02-web','p02-dom'] else 0) for r in node),node
 return summary,old,previous,new,matrix,full,node,changes
def intermediate():
 rows=[]
 for d in sorted(BASE.iterdir()):
  if not d.is_dir():continue
  files=list(d.glob('*.ndjson'))
  for file in files:
   if file.name not in ['reconciliation.ndjson','migration.ndjson','before.ndjson']:continue
   values=ndjson(file);rows.append({'run':d.name,'source':rel(file),'counts':counts(values),'failures':[{'case_id':v['case_id'],'error':v.get('error','')} for v in values if v['status']=='FAIL']})
  if d.name.endswith('-junit'):
   methods=list(junit(d).values());rows.append({'run':d.name,'source':rel(d),'counts':counts(methods),'failures':[{'class':v['class'],'method':v['method'],'error':v['error']} for v in methods if v['status']=='FAIL']})
 return rows
def write_owned(path,text):
 assert path.parent in [DOC,BASE] and (path.parent!=DOC or path.name.startswith('P03A_'))
 path.write_text(text,encoding='utf8')
def generate(data):
 s,old,previous,new,matrix,full,node,changes=data
 runs=intermediate()
 for name,value in [('summary.json',s),('p03-existing-results.json',old),('closeout-results.json',previous),('new-results.json',new),('p02-comparison.json',matrix),('failure-ledger.json',runs)]:write_owned(BASE/name,json.dumps(value,ensure_ascii=False,indent=2))
 revision='最终本地提交、Git tree、APK SHA-256及证据seal见 [REVISION.json](../migration-evidence/finance-p03/phase-a/REVISION.json)；本轮无发布。'
 report=f'''# FINANCE-P03-A 实施与验收报告

**最终状态：PARTIAL。合成合同内核完成验证，真实提供方适配器仍 BLOCKED；不建议无条件关闭 P03-A。整个 P03 继续 PARTIAL。**

基线 `{BASELINE}`，分支 `codex/finance-p03-identity-preauth`，使用原隔离工作树。开工实际HEAD/branch/clean已核对，原closeout seal的45份源码/报告与698份证据通过。{revision}

P01现按实际主工作区子目录读取：14,773字节、111行、七章节及最终状态完整，SHA256 `c91558842104cb44079a59e325242a7bbf7f33ceb49b01dfbc9506098a111ebc`，与开工保护清单字节相同；不声称与不可访问的ChatGPT沙盒原件独立比对。它是远端静态历史参考，未代表当前本地代码、未据此重启P01/P02/P03或新增P04/P05/P06。原资料路径经所有者更正后补读，原P02/P03报告与raw证据不重写。历史资料读入/格式检查1224份、0解析错误，见historical-read-index.json。

实现：精确来源证明下的Capture/Refund绝对金额更正、候选晋升、同操作候选幂等归并、家族/操作重归属、单个错误别名解除和之后独立恢复、保留旧正式ID与不可变回执、全额退款冲正、用户决定保护、Room/outbox恢复、D1原子余额/CAS与change feed。签名/真实提供方语义适配器缺失时默认拒绝，合成注册器不会随产品启用。没有复制第三方实现、引入AI、修改金额识别或OCR策略。

| 当前执行集合 | 真实结果 |
| --- | --- |
| 原607 | 588 JVM +13 Node +6 DOM PASS，0 FAIL/SKIP；保留前轮3个已披露夹具条件 |
| 标准JVM | {s['test_jvm']}；663方法，包括原588、旧P03的26、closeout的18、本轮31 |
| 原P03新增63 | {s['existing_p03']}，case ID集合保持 |
| 上轮新增41 | {s['closeout']}，case ID集合保持 |
| 本轮新增99 | {s['p03a_new']}；31标准JVM、58服务、8迁移、2跨JVM方法 |
| Lint / Debug | {s['debug']}；Lint实际告警 {s['lint']}，无Error/Fatal |
| 冻结608行 | {s['matrix']}；状态变化 {len(s['matrix_changes'])}，26行复用本轮JUnit，不额外计执行 |

这些集合存在交叠，不能相加；30次循环、重跑及全量661→662→663的中间轮次不增加独立用例数。最终选取索引、全部命令/退出码和完整失败账本在 TEST_RUNS 与机器JSON。未验证的一律NOT_TESTED。

三组真实Room文件/outbox/loopback HTTP/本地D1桥接通过。新组修正已提交后实际503，再重建D1 runtime，重放原请求及30次重复：原交易ID、USD90、revision2、一条已应用修正、队列空，共34请求。旧组仍3账/2待核实/至少9请求和4账/1待核实/至少15请求。均为合成账户，不是手机或真实云端验收。

C005仍原170目标、实际80、EXPECTED_RED，90缺独立引用不自动入账；C007仍原170目标、实际0、EXPECTED_RED。独立受证80+90的170路径另测，未替换冻结样本。原FAIL7与EXPECTED_RED42完整保留，P04/P05/P06红灯未作为P03-A开发范围。

新增Role保护拒绝把已接受的授权/解除/过期控制事实消耗成Capture别名。兼容性回归修复generic raw、旧structured缺字段、hint共用入口绕过；已受证旧来源返回实际Event receipt，未伪造hint行。八候选审计上限、旧别名第三版仍读第二版等本轮中间缺陷均先保留失败再修复。原始源事实/旧关系不删除。

保护：原主工作区832文件全部hash不变；P01等3份材料开工已存在，只有所有者新增路线图1份（当前833）；HEAD/branch/既有dirty相同。其余12组工作区/证据零新增、缺失、变化。Task26豁免状态、D01/D02 CLOSED、原Hotfix均保持。正式版本/签名配置不改；没有操作设备，正式App实际数据状态NOT_TESTED。本轮未ADB、真实交易、Production、远端迁移、正式签名、PR、push、merge或发布。

剩余阻断：真实提供方的账户作用域、独立操作引用、前驱/绝对版本及完成/退款语义未取得；当前App没有已验证的真实自动修正适配器。多正式账目、未知人工来源、跨账户/发行方、证据不足、超过完整证明集合容量继续隔离，不能称完整业务支持。真实备份恢复、旧正式APK、真实通知/云同步/三页面/生命周期仍NOT_TESTED。详见交接。

- [实施计划](P03A_PLAN.md)
- [业务合同与限制](P03A_RECONCILIATION_CONTRACT.md)
- [模型、迁移与恢复](P03A_MIGRATION_AND_RECOVERY.md)
- [逐案608行及新增/既有测试](P03A_TEST_MATRIX.md)
- [命令、失败、保护及改动清单](P03A_TEST_RUNS.md)
- [P03-B交接与停止条件](P03A_P03B_HANDOFF.md)
'''
 write_owned(DOC/'P03A_REPORT.md',report)
 table='# P03-A 逐案回归矩阵\n\nVERIFIED对应本轮PASS；FAIL为FAILED；EXPECTED_RED/NOT_TESTED均原样保留。合成安全隔离PASS不等于真实自动修正支持，后者BLOCKED。原冻结矩阵未覆盖。\n\n'
 for label,rows in [('原P03 63',old),('上轮closeout 41',previous),('本轮新增99',new)]:
  table+=f'## {label}\n\n{counts(rows)}\n\n| case | 状态 | actual/范围 | 证据 |\n| --- | --- | --- | --- |\n'
  for r in rows:table+=f"| {r['case_id']} | {r['status']} | {short(r.get('actual',{'class':r.get('class'),'method':r.get('method')}))} | `{r['evidence']}` |\n"
 table+='\n## 冻结608行对照\n\n| case | 原status | 本轮status | 原truth/expected | 本轮actual | 证据 |\n| --- | --- | --- | --- | --- | --- |\n'
 for r in matrix:table+=f"| {r['case_id']} | {r['baseline_status']} | {r['status']} | {short(r['fixture'].get('expected',r['fixture']),130)} | {short(r.get('actual',''),180)} | `{r['evidence']}` |\n"
 table+='\n完整fixture、actual及堆栈保存在机器p02-comparison.json及所引NDJSON/XML。C005/C007的17000 minor真值不改。NOT_TESTED包括15项AI产品集成和8项真实设备/云/备份边界，未借用旧PASS。\n'
 write_owned(DOC/'P03A_TEST_MATRIX.md',table)
 commands='# P03-A 运行、失败账本、保护与变更\n\n'+revision+'\n\n## 最终选取与真实命令\n\n'
 commands+='标准JVM/Lint/Debug选closure-full；矩阵选closure-p02-native、closure-p02-process；Node选'+NODE+'；新服务选'+SERVER+'；新迁移选'+MIGRATION+'；桥接选closure-legacy、closure-closeout、'+BRIDGE+'。这是本轮新执行，不引用历史PASS。\n\n'
 commands+='Gradle实际参数向量、时间和真实退出码见各*-run.json。标准命令为 `./android/gradlew.bat -p ./android :app:testDebugUnitTest --rerun --no-daemon --console=plain :app:lintDebug --rerun :app:assembleDebug --rerun`。源JVM不加载桥接overlay；双JVM另按seed/restore执行，防止缺端口测试混入标准集合。完整复验示例见qa/finance-p03/phase-a/README.md。\n\n| Node入口 | exit | 日志 |\n| --- | --- | --- |\n'
 for r in node:commands+=f"| `{r['command']}` | {r['exit_code']} | `{Path(r['log']).relative_to(ROOT).as_posix()}` |\n"
 commands+='\nP02 Web/DOM exit1包含原红灯；原608预期不修改。前轮607三项夹具合同已披露，本轮没有追加金额/身份例外。既有测试只续接Room13 / D1v5迁移注册、目标及相应旧版本报错文字；原SQL/schema不变。新A29草案零金额与Task16正金额合同不符，保留失败后改为原支出+独立全额退款，未放宽数据库约束或冻结真值。\n\n## 中间执行完整统计\n\n| run | 实际counts | raw |\n| --- | --- | --- |\n'
 for r in runs:commands+=f"| {r['run']} | {r['counts']} | `{r['source']}` |\n"
 commands+='''
全栈逐项在failure-ledger.json；不由后续PASS覆盖。主要处置：

- before三项API能力探针FAIL，记录09442c2缺少修正接口，不冒充已执行业务场景。
- server-attempt1/2：真实SQL缺闭合括号及列数/绑定修复；QA手动编辑请求误用last_server_version改since_version；草案0金额不符合正式账本，采用现有退款冲正合同。原32例失败保存。
- server-attempt3：退款先到、映射后未触发依赖重检，A10真实FAIL；修复后按精确家族做有界重检。
- native-attempt1：测试RuntimeEnvironment泛型误用编译失败；attempt2迁移注册脚本误改默认参数编译失败，均无新鲜JUnit，不把旧XML计PASS。
- native-and-migration-attempt4：37方法1FAIL，旧opener测试仍匹配12而实际13；更新版本文字，保留拒绝降级及旧行检查。
- a-bridge-attempt1：实际原生v2完成消息因身份门禁上传candidate，初始修正合同无法接受，真实FAIL。现在必须另有精确完成源digest；没有该证明的processing仍不升级，A27/A48保留负断言。
- audit-capacity-before/diagnostic：真实D1 `CHECK length(before_json)<=12000`，整批回滚。完整快照留新日志，旧审计只保存SHA指针与摘要，A49全八候选通过，并独立核对指针。
- alias-version-before：实际95后旧别名仍90，1FAIL；读取主recognition最新事实，原源记录90保留，当前多版本测试通过。
- legacy-bypass-before及shared-booking-bypass-before：generic raw、旧structured、hint共用函数可重复创建支出；统一保护并保留实际回执恢复，A50–56通过。
- role-control-before：错误MAP可消耗已接受授权，原A丢失；拒绝控制角色作为Capture别名，A57通过。
- existing-capture-before / existing-capture-native-before：弱候选映射到已经入账的权威Capture分别缺少canonical predecessor、未确认已有本地booking；保留失败后支持选取证据的现有正式ID并更新原booking回执，A58及原生新增方法通过。
- migration-attempt1：合成旧事件遗漏confidence，D1绑定undefined启动失败、0业务case；早期shell尾部Get-Content掩盖child exit，未用shell0算PASS。后续run-one记录真实退出码。
- migration-attempt3：AM07错用Finance而非Cloud写flag，实际返回cloud_not_enabled；修正测试配置。migration-final的AM08漏DeepHealth flag，未执行深查而为空；明确开启后验证DB2。不是生产配置更改。
- node-attempt1：旧closeout迁移基线只排0028却误含新0029，readiness前即失败；P02输出重定向旧safe前缀拒绝新phase-a目录，三项没跑业务。修正QA边界，原输出保留，不把这些exit1冒充EXPECTED_RED。
- protection-attempt1：误假设四份材料都新到；开工清单证实三份已存在且hash一致，仅路线图新增。新审计只接受该精确集合差，保留原832文件/HEAD/branch/dirty检查，未忽略未知修改。
- 报告生成器先后遇到3行没有fixture键、8个NOT_TESTED行fixture为字符串；保留失败及draft，按原值存fixture_original并生成展示元数据，没有改变输入、真值或状态。

原P03/P02及closeout的全部旧失败日志仍保持，新增99之外的能力探针、startup失败、同方法重跑和30次内部循环不计新用例。测试程序/fixture修改的源diff与每轮源码hash在candidate-source-deltas和provenance。

## 保护核验

| 范围 | 原文件数 | added / missing / changed | HEAD / branch / dirty |
| --- | --- | --- | --- |
'''
 for name,r in s['protected']['protected'].items():commands+=f"| {name} | {r['files']} | {len(r['added'])} / {len(r['missing'])} / {len(r['changed'])} | {str(r.get('headSame','N/A'))} / {str(r.get('branchSame','N/A'))} / {str(r.get('statusSame','N/A'))} |\n"
 commands+='\n主工作区新增1仅为所有者提供路线图，SHA与owner-materials清单相符；原材料3份及其余832原文件不变。1537份历史资料无变化。原closeout于开工的45/698 seal成功，后续产品差异是已授权P03-A变更，不声称旧产品源码仍相同。正式App实际设备状态、真实生产数据及正式签名均未查询/操作。\n\n## 本轮修改/新增文件\n\n'
 for p in changes:commands+='- `'+p+'`\n'
 commands+='\n未删除测试/夹具/旧报告。四份一次性实现变换脚本转入ignored implementation-transforms保留，未作为可重复测试交付；所有业务方法和原断言保留。\n'
 write_owned(DOC/'P03A_TEST_RUNS.md',commands)
 handoff='''# P03-A → P03-B 审核交接

**P03-A=PARTIAL，P03仍PARTIAL；不自动开始P03-B/P04/P05/P06。** 本轮可审核关闭的是合成明确证据条件下的修正内核及安全隔离合同，不能自行等同真实业务完整支持。

| 门禁 | 当前状态 | 后续所需证据/授权 |
| --- | --- | --- |
| 明确源证明的修正/映射/Capture重归属/退款 | VERIFIED 合成；当前真实入口BLOCKED | 提供方与账户作用域、独立操作、前驱、绝对版本、完成/撤销/退款语义的真实可核对合同；接入前先负向验证 |
| C005/C007 | EXPECTED_RED | 原170目标不改；取得可信独立引用及对应原发生事件。不能用金额或本文合成样本替代 |
| 历史未知人工来源/多个正式账目 | BLOCKED 自动修改 | 可审计用户决定/原回执/唯一来源；没有就保留候选，不批量猜测修复 |
| 多个已正式入账ID即便后来证明同操作 | NOT_IMPLEMENTED 自动消解 | 本轮只自动处理0或1个正式ID；需要另审受控账目supersession/调整机制和本地对应语义，不能伪造银行退款或删除历史来抵消重复 |
| 完整集合容量/控制事件版本修订 | BLOCKED 超界自动处理 | 本轮最多8目标+8解除，要求完整受影响集合；授权/解除角色不被MAP消耗。扩展须另审合同及原子性 |
| 真实提供方adapter | NOT_IMPLEMENTED / BLOCKED | 当前默认拒绝，QA注入不是生产适配器。不能以合成验证器绕过该门禁 |
| 正式Room/D1备份与恢复 | NOT_TESTED | 所有者单独授权、合法导出通道、写冻结、同水位队列/回执/日志、独立目标实际恢复及差额对账 |
| 原生D1二进制/Time Travel | NOT_TESTED | 本轮只有可检查SQLite逻辑快照及新runtime恢复；上轮持久化探针阻断未消除 |
| 正式旧APK升级/降级 | NOT_TESTED | 合法完整备份与回退候选，禁止清库降版本；旧Room opener/API失败关闭已本地验证 |
| 真实通知/三页面/生命周期/云端/支付 | NOT_TESTED | 独立所有者账户及数据授权；按Hotfix剩余矩阵单独验收，不操作本轮QA之外设备 |
| P04/P05/P06既有红灯 | EXPECTED_RED / NOT_TESTED | 保持阶段顺序，不因P03-A修复启动FX/OCR/AI |

建议先审核本地diff、全部失败及范围接受，再单独决定P03-B的备份恢复/提供方合同工作。若不接受上述真实入口及历史边界，不能宣布P03-A COMPLETE。P03-B应首先保全原ID、source/receipt/journal、账户隔离、metadata耦合及全部99/63/41/607回归；正式部署还须审核0026独立Task26与0027–29目标顺序，不在本轮合并。

本轮没有手机/ADB、真实交易、Production、正式签名、PR、推送、合并或发布。完成本轮本地报告与提交后停止，等待所有者审核。
'''
 write_owned(DOC/'P03A_P03B_HANDOFF.md',handoff)
 print(json.dumps({k:v for k,v in s.items() if k in ['status','test_jvm','original_607','existing_p03','closeout','p03a_new','p03a_breakdown','matrix','matrix_changes','lint','debug']},ensure_ascii=False,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--check-only',action='store_true');args=p.parse_args();data=collect()
 if args.check_only:print(json.dumps(data[0],ensure_ascii=False,default=str))
 else:generate(data)
