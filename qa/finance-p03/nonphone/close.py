"""Close available non-device engineering, preserve PARTIAL and hand off to P04."""
from pathlib import Path
import datetime,hashlib,json,subprocess,shutil
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/migration-evidence/finance-p03/nonphone-entry'
read=lambda p:json.loads(p.read_text(encoding='utf8-sig'))
s=read(OUT/'delivery-final/summary.json');assert s['original607']['PASS']==607 and s['standard681']=={'PASS':681} and s['new38']=={'PASS':38}
assert s['frozen608']=={'PASS':538,'FAIL':7,'EXPECTED_RED':40,'NOT_TESTED':23}
assert read(OUT/'protected-final.json')['status']=='PASS'
assert not subprocess.check_output(['git','diff','5d96e1e','--','android','functions','js','app.js','cloudflare'],cwd=ROOT)
old=(OUT/'previous-report.md').read_bytes();report=ROOT/'docs/finance-p03/FINANCE_P03_FINAL_REPORT.md';assert report.read_bytes()==old
apk=OUT/'build-regression/app/outputs/apk/debug/app-debug.apk';assert apk.is_file()
canonical=OUT/'artifacts';canonical.mkdir(exist_ok=False);shutil.copy2(apk,canonical/'finance-p03-nonphone-debug.apk')
artifact={'scope':'Fresh non-device Debug build; never installed','bytes':apk.stat().st_size,'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'baseline':'5d96e1ee5d2064076bd0efa59eed86edb9b1c4cc'}
(OUT/'debug-artifact.json').write_text(json.dumps(artifact,indent=2),encoding='utf8')
cases=read(ROOT/'docs/migration-evidence/finance-p03/finish/case-analysis-28.json')
current={r['case_id']:r for r in read(OUT/'delivery-final/frozen-608.json')}
case_rows=[]
for r in cases['rows']:
 if r['after']=='PASS':continue
 fresh=current[r['case_id']];assert fresh['status']==r['after']
 assert fresh['fixture']==r['fixture']
 case_rows.append({'case_id':r['case_id'],'status':fresh['status'],'fixture_unchanged':True,'classification':r['classification'],'reason':r['reason'],'recovery_condition':r['recovery_condition'],'fresh_evidence':fresh['evidence'],'prior_detailed_trace':'../finish/'+r['evidence']})
assert len(case_rows)==26
(OUT/'remaining-26.json').write_text(json.dumps(case_rows,ensure_ascii=False,indent=2),encoding='utf8')
stamp=datetime.datetime.now(datetime.timezone.utc).isoformat()
prefix=f'''# FINANCE-P03 最终统一报告

## 2026-10-21 非手机工程收尾与P04交接（本轮当前结论）

**P03：PARTIAL。当前可安全独立执行的非手机工程：已结束并封存。** 所有者本次明确授权 P03 收尾后立即开展 P04 非生产开发；P03 的 PARTIAL 不再阻止该切换。历史停止要求不构成本轮的阶段审批节点。

起点 `5d96e1ee5d2064076bd0efa59eed86edb9b1c4cc`、分支与干净 tracked 状态已实核；该轮51个源码/报告条目与911个raw哈希、13组保护均通过。没有重做P01/P02，没有手机/ADB/安装/权限/正式账户/Production操作。本轮未发现新的可证P03产品缺陷，产品代码差异0；改动为 `qa/finance-p03/nonphone/` 的输出隔离驱动、收集/保护/封存及本报告更新。原报告字节另存 `nonphone-entry/previous-report.md`，旧封存不覆盖。

所有下列数字是本轮实际新执行：[统计与身份清单](../migration-evidence/finance-p03/nonphone-entry/delivery-final/summary.json)。原607=588 JVM+13 Node+6 DOM全部PASS；标准681/681 PASS；既有重叠集合63/41/99/79均PASS；前轮新增38/38再次PASS（5 Robolectric/JVM、15投影、10实际Chrome、8 TEST-key单元）。这些集合不相加。Android Lint无Error/Fatal，Debug构建PASS；本轮APK SHA-256 `{artifact['sha256']}`，保留副本在 `nonphone-entry/artifacts/`，未安装。

Room9/11/12/13→14与整链故障回退/重试/闭库Room+outbox副本、旧opener拒绝、D1迁移/中断/重复/旧写端失败关闭均重新执行。四组跨JVM/HTTP/Miniflare桥及98表原生复制/恢复均PASS，原ID/人工优先/回执、断网重试与提交成功丢回执保护不变。完整命令、退出码、JUnit、原失败与校正记录在 `nonphone-entry/commands.json`、`continuation-commands.json`、`*-run.json`、`driver-corrections.json`；一次追踪驱动漏载P02源编译失败和一次桥驱动目录名错误均保留，只修驱动，未变更断言。

冻结608仍为 **538 PASS / 7 FAIL / 40 EXPECTED_RED / 23 NOT_TESTED**；原输入/预期/断言不变。本轮26条P03目标逐条复核及新执行位置见 [remaining-26](../migration-evidence/finance-p03/nonphone-entry/remaining-26.json) 与 [新失败账本](../migration-evidence/finance-p03/nonphone-entry/delivery-final/failure-ledger.json)：A系列4 FAIL/20 EXPECTED_RED，C005/C007各EXPECTED_RED。80/90共用字面引用、缺operation/revision/前驱，以及无引用的源输入仍不能证明原17000目标；金额/商户/postTime不是身份。原源、候选、隔离原因、旧账与回执保留，不伪造证明，不将安全拒绝等同完整支持。既有两条CW修复继续PASS。

历史Activity请求RESUMED而STOPPED的额外失败仍 **UNRESOLVED / 因果INCONCLUSIVE**。本轮复核已有日志/1.7.0二进制与探针边界；没有该次失败瞬间有效栈，电脑Robolectric不能证明Samsung Window/Renderer实际时序，故不猜修复、不重复无新证据的大规模试验。D-01/D-02保持CLOSED。以下历史手机结果仅作历史证据，本轮真机/真实通知/支付页面/LMK/真实云/正式备份与旧正式APK均 **NOT TESTED**。

独立可做的核验现已完成；剩余需要合法提供方/账户作用域与操作前驱证明，或所有者对不可观测合同的明确处置；正式一致备份/生产恢复及真实手机故障复现仍须以后单独授权。本轮不再反复索要已明确不存在的凭据。P04将完整继承本次收尾提交，不cherry-pick、不改主目录/Task26/Hotfix，不自动开放P05/P06或发布。

当前P03最终本地SHA/tree/工作树与源码/raw哈希由 [REVISION.json](../migration-evidence/finance-p03/nonphone-entry/REVISION.json)、同目录provenance/validation固定。下文保留上一轮完整范围与证据，**其中测试次数、手机操作和“本轮”措辞均属于历史5d96e1e轮次，不计本轮PASS**。

---

'''
report.write_text(prefix+old.decode('utf8').replace('# FINANCE-P03 最终统一报告','## 上一轮统一报告（历史保留）',1),encoding='utf8')
(OUT/'nonphone-closure.json').write_text(json.dumps({'utc':stamp,'p03':'PARTIAL','nonphone_engineering':'COMPLETE_FOR_AVAILABLE_EVIDENCE','product_delta':[],'remaining_cases':26,'phone_used':False,'production_used':False,'p04_immediate_transition_authorized':True},ensure_ascii=False,indent=2),encoding='utf8')
print('P03 non-device report updated; retain PARTIAL and immediately proceed to P04')
