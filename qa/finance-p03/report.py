"""Build P03 engineering reports from archived executions, never from expected results."""
import collections
import hashlib
import json
import os
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'docs/migration-evidence/finance-p03'
DOC = ROOT / 'docs/finance-p03'
P02 = Path(os.environ['USERPROFILE']) / '.codex/worktrees/finance-p02-tests/thewyj.uk'
BASELINE = '6ff9b9fd89bb6dedf5837f28421825c4418925f9'
PRODUCT_BASELINE = '1398c76d9321919ac8c94550f2d23c2c8e1a1e84'
BRIDGE_RUN = 'bridge-controlled'


def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def relative(path): return path.relative_to(ROOT).as_posix()
def git(*args): return subprocess.check_output(['git', *args], cwd=ROOT).decode('utf-8').strip()
def ndjson(path):
    return [dict(json.loads(line), evidence=relative(path) + ':' + str(i))
            for i, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1) if line.strip()]
def clean(value, limit=180):
    value = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    return value.replace('|', '/').replace('\n', ' ')[:limit]
def counts(rows): return dict(collections.Counter(r['status'] for r in rows))
def write(name, body): (DOC / name).write_text(body.strip() + '\n', encoding='utf-8')


def main():
    old = json.loads((P02 / 'docs/migration-evidence/finance-p02/report-results.json').read_text(encoding='utf-8'))
    suites = [ET.parse(p).getroot() for p in (BASE / 'reviewed-final-junit').glob('TEST-*.xml')]
    original_suites = [s for s in suites if '.FinanceP03' not in s.get('name', '')]
    original_jvm = sum(int(s.get('tests')) for s in original_suites)
    assert original_jvm == 588
    current_junit = {}
    p03 = []
    for file in (BASE / 'reviewed-final-junit').glob('TEST-*.xml'):
        suite = ET.parse(file).getroot()
        for test in suite.findall('testcase'):
            status = 'FAIL' if test.find('failure') is not None or test.find('error') is not None else 'NOT_TESTED' if test.find('skipped') is not None else 'PASS'
            key = (suite.get('name'), test.get('name'))
            current_junit[key] = (status, relative(file) + '#' + test.get('name'))
            if '.FinanceP03' in suite.get('name', ''):
                p03.append({'case_id': 'P03-JVM-' + test.get('name'), 'status': status, 'fixture': {'class': suite.get('name'), 'method': test.get('name'), 'synthetic': True},
                            'actual': {'junit': status, 'seconds': test.get('time')}, 'error': test.findtext('failure', ''), 'evidence': relative(file) + '#' + test.get('name')})
    current = []
    for group in 'ABCDE':
        directory = 'p02-final-native'
        current += ndjson(BASE / directory / f'kotlin-{group}.ndjson')
    for filename in ['web-pure.ndjson', 'web-dom.ndjson', 'ledger-d1.ndjson', 'ai-contract.ndjson']:
        current += ndjson(BASE / 'p02-after-web' / filename)
    for filename in ['process-G-PROCESS-SEED.ndjson', 'process-G-PROCESS-RESTORE.ndjson']:
        current += ndjson(BASE / 'p02-process' / filename)
    current += ndjson(BASE / 'p02-final-native/negative-bookings.ndjson')
    timing = json.loads((BASE / 'p02-final-native/timing.json').read_text())
    timing['evidence'] = relative(BASE / 'p02-final-native/timing.json')
    current.append(timing)
    for row in old:
        if row['case_id'].startswith('G-REUSED-'):
            f = row['fixture']; status, evidence = current_junit[(f['class'], f['method'])]
            current.append(dict(row, status=status, evidence=evidence, coverage='REUSED_FRESH_P03_BASELINE_NOT_AN_EXTRA_EXECUTION'))
        elif row['case_id'].startswith('NT-'):
            current.append(dict(row, evidence='docs/finance-p03/REMAINING_RISKS.md'))
    assert len(current) == len(old) == 608
    before = {r['case_id']: r for r in old}
    assert set(before) == {r['case_id'] for r in current}
    for row in current:
        row['before_status'] = before[row['case_id']]['status']
        case = row['case_id']
        if case.startswith('A') and row['status'] != 'PASS':
            ownership = '保留旧直接调用宿主真值；弱身份未接入新Hook门禁，不推定真实吞单；P03实际入口另测'
        elif case == 'C005': ownership = 'P03未完成：同一引用缺清算子ID，保留80及90冲突候选，不猜170'
        elif case == 'C007': ownership = 'P03安全替代：缺引用时0正式账、保留候选；冻结170目标不改'
        elif case.startswith('CW-'): ownership = '冻结对象把授权塞入active正式交易；新API不产生该对象；原红灯保留'
        elif case.startswith('E') and row['status'] == 'FAIL': ownership = 'P05：固定文本/OCR mock语义失败，未改识别器'
        elif case.startswith('F'): ownership = 'P06：AI适配器未实施；mock自检不是产品PASS'
        elif row['status'] == 'EXPECTED_RED': ownership = 'P04币种决议/FX/格式/混币目标未实施'
        elif row['status'] == 'NOT_TESTED': ownership = '设备/Hosted/Production/真实旧APK等未授权或未验证'
        else: ownership = '实际调用通过；以所列原始证据为准'
        row['p03_disposition'] = ownership
    p03 += ndjson(BASE / 'server-reviewed/server.ndjson')
    p03 += ndjson(BASE / 'legacy-raw-reviewed/legacy-raw.ndjson')
    for row in json.loads((BASE / 'd1-migration-attempt1/migration.json').read_text()):
        p03.append(dict(row, evidence=relative(BASE / 'd1-migration-attempt1/migration.json')))
    for name in ['seed', 'restore']:
        actual = json.loads((BASE / BRIDGE_RUN / f'{name}.json').read_text())
        p03.append({'case_id': 'P03-BRIDGE-' + name.upper(), 'status': actual['status'], 'actual': actual,
                    'evidence': relative(BASE / BRIDGE_RUN / f'{name}.json')})
    bridge = json.loads((BASE / BRIDGE_RUN / 'server-final.json').read_text())
    assert bridge['status'] == 'PASS'
    proof = json.loads((BASE / 'protected-final.comparison.json').read_text())
    assert all(not r['added'] and not r['missing'] and not r['changed'] and all(v for k, v in r.items() if k.endswith('Same')) for r in proof.values())
    changed = set(git('diff', '--name-only', BASELINE).splitlines())
    changed.update(git('ls-files', '--others', '--exclude-standard').splitlines())
    product = sorted(p for p in changed if p.startswith(('android/app/src/main/', 'android/app/schemas/', 'functions/', 'cloudflare/migrations/')))
    tests = sorted(p for p in changed if p.startswith(('android/app/src/test/', 'qa/finance-p03/')))
    code_commit = json.loads((BASE / 'code-commit.json').read_text())['commit']
    summary = {'status': 'PARTIAL', 'baseline_commit': BASELINE, 'product_baseline': PRODUCT_BASELINE, 'code_commit': code_commit,
        'original_automated': {'JVM': original_jvm, 'Node': 13, 'DOM': 6, 'PASS': 607, 'FAIL': 0, 'SKIP': 0, 'fixture_qualifications': 3},
        'all_normal_jvm': {k: sum(int(s.get(k, '0')) for s in suites) for k in ['tests', 'failures', 'errors', 'skipped']},
        'new_p03_rows': len(p03), 'new_p03_statuses': counts(p03), 'frozen_p02_rows': 608,
        'frozen_p02_before': counts(old), 'frozen_p02_after': counts(current),
        'frozen_changed': [{'case_id': r['case_id'], 'before': r['before_status'], 'after': r['status']} for r in current if r['before_status'] != r['status']],
        'product_files': product, 'test_files': tests, 'fixture_sha256': sha(ROOT / 'qa/finance-p02/fixtures/matrix.json'),
        'bridge': bridge, 'protected_groups': len(proof)}
    (BASE / 'p02-comparison.json').write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding='utf-8')
    (BASE / 'p03-results.json').write_text(json.dumps(p03, ensure_ascii=False, indent=2), encoding='utf-8')
    (BASE / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    DOC.mkdir(exist_ok=True)
    intro = f'日期：2026-10-19（Asia/Hong_Kong）。P02基线 `{BASELINE}`；产品基线 `{PRODUCT_BASELINE}`；实施提交 `{code_commit}`；分支 `codex/finance-p03-identity-preauth`。最终文档提交与Git tree见本地证据 FINAL_REVISION.json。\n\n'
    index = '\n'.join(f'- [{name}](./{name})' for name in ['IMPLEMENTATION_REPORT.md','EVENT_IDENTITY_CONTRACT.md','DEDUPLICATION_RCA_AND_FIX.md','PREAUTH_STATE_MODEL.md','MIGRATION_AND_COMPATIBILITY.md','CURRENCY_SAFETY_GATE.md','TEST_MATRIX.md','TEST_RUNS.md','PROTECTED_WORKSPACE_AUDIT.md','REMAINING_RISKS.md'])
    write('PHASE03_HANDOFF.md', '# FINANCE-P03 中文交接\n\n' + intro + f'''
**最终状态：PARTIAL。安全修复和本轮本地验收已完成，未宣称完整清算业务闭合。**

已实施交易引用/命名空间与消息证明的持久别名、零间隔独立交易保护、重复/迟到回执保护、弱身份待核实、授权/结算/解除/过期/退款的基本状态、Room11/D1增量迁移，以及明确ISO币种不静默变CNY的门禁。金额/时间/商户相似度不再触发旧raw API的自动合并；新待核实记录不能在重放时给自己“作证”。

原607本轮运行：607 PASS / 0 FAIL / 0 SKIP；其中3个旧夹具补充身份或已持久化账目证明，断言未删除或放宽，迁移链续接11。标准JVM实际{summary['all_normal_jvm']}；新P03独立用例{len(p03)}，{counts(p03)}；Lint与Debug构建通过。冻结P02矩阵608行：{counts(old)} → {counts(current)}；26行复用本轮既有JUnit，不额外计数。原FAIL和所有中间失败均保留。

双JVM真实Room/outbox→loopback HTTP→本地D1闭环：首次服务器已提交但响应503，重放后仍3笔（CNY648两笔、USD170一笔），最终队列空；跨资料引用冲突及无身份捕获保留待核实，不借用别人的回执。它不是Samsung或真实云端验收。

未完成：无清算子流水时无法判断80+90是分次清算还是同单修正，冻结C005仍红；明确partial及关联不完整保守待核实。旧未结构化raw API只隔离授权文字，不冒充完整授权账本；剩余冻结余额、复杂部分解除/多次部分退款未完整实现。缺引用的C007采用0正式账的安全替代，未篡改冻结170真值。OCR三项FAIL、JPY格式、混币/FX、币种偏好和AI仍属P04/P05/P06。

**未合并、推送、创建PR、发布、正式签名、操作ADB/手机/Production或真实支付。主工作区、Task26、旧Hotfix、D-01/D-02及P02证据全部保持。** D-01/D-02保持CLOSED，Task26保留所有者豁免。已修改的产品源码只在本隔离分支；未修改正式安装App。

下一步仅供所有者审核本地提交、身份合同与迁移/回退方案；未具备自动进入P04或发布的授权。P03剩余清算边界须接受或补完后再判定关闭。

{index}

机器证据：[summary](../migration-evidence/finance-p03/summary.json)、[P02逐案比较](../migration-evidence/finance-p03/p02-comparison.json)、[新P03用例](../migration-evidence/finance-p03/p03-results.json)、[最终提交](../migration-evidence/finance-p03/FINAL_REVISION.json)。
''')
    write('IMPLEMENTATION_REPORT.md', '# P03 实施与产品差异\n\n' + intro + '''
所有者本轮P03授权覆盖原暂停要求中的本阶段代码修复；不解除发布、手机、Production或P04/P05/P06边界。以P02完整HEAD新建managed worktree，没有cherry-pick、重置、合并或复制无关WIP。

既有架构保留：recognition/candidate、Room本地账目/outbox、Task16正式交易、Task21结构化事件/回执。新增的是身份别名与证据字段，不是第二套财务账本。既有金额、transactionId、receipt/operation ID、编辑/删除关系不批量重建。

Android产品路径只在PaymentParserRegistry安全装配、notification→hook→coordinator、持久化/回执和确认门禁增加字段与检查。既有PaymentText、PaymentPageSemantics、PaymentScreenshotVerifier、ML Kit模型和WebView/MainActivity生命周期源码未改；新增明确ISO配对金额和授权角色解析属于P0/生命周期最小支持，不宣称“金额解析完全没变”。90秒ticket与8次预算源码不改。确认页面只补安全提示与正确币种/身份传递，无大规模UI重构。

本地冲突判定在捕获后再次进入上传门禁，避免本地待核实而云端parsed；持久账目/真实回执作为引用权威，未入账冲突候选不能靠再次投递自证。已存在账目继续保留，新的legacy identity_pending无可靠证明先待核实，全部精确别名回执一致才解除阻断。

Worker修改包括payload完整摘要与旧摘要兼容、引用/消息别名、命名空间、清算门禁、回执不覆盖用户修改；普通hint补足发行方身份以和ingest一致。旧raw接口禁止相似度自动合并，强引用不依赖三分钟，冲突或扫描不完整待核实；未结构化清算与冲突外币不新建正式账。

依赖、版本、签名、Manifest权限、会员/旗标、发布配置、Task26、Web财务FX/格式源码均未修改。schema/API变更见迁移报告。

## 全部产品文件

''' + '\n'.join('- `' + p + '`' for p in product) + '\n\n## 新增/修改测试与工具\n\n' + '\n'.join('- `' + p + '`' for p in tests))
    write('EVENT_IDENTITY_CONTRACT.md', '# 事件身份与证据合同\n\n' + intro + '''
| 层 | 可靠依据 | 不足时的处理 |
| --- | --- | --- |
| Android通知/SMS | 平台支付/银行解析器给出的引用+来源命名空间；或带来源/资料UID的MessagingStyle会话/发送者/消息when证明 | 无引用/消息证明进入待核实；保留金额、币种、原因、观察hash和候选 |
| messageIdentity | source+conversation+sender+消息timestamp的hash，再按UID限定；是投递/重放证据 | 不是正文hash，也不是postTime或交易号；同证明对应多订单时建立独立review系列 |
| 系统槽位 | key/id/tag仅用于捕获连续性 | 不把它或时间阈值当交易ID |
| coordinator | sourceEventId是调用者声明的稳定来源occurrence；生产调用只有Hook捕获/SMS入口并施加门禁 | 不能直接用旧测试宿主的任意ID替代真实来源验证 |
| OCR/无障碍 | 只为当前受控ticket补证据，保留UID/页面/金额冲突校验 | 金额已读到不自动清除身份、币种或清算冲突；不绕过确认 |
| 本地持久化 | 已有transactionId/实际receipt优先；新增来源映射到同recognition | 不能删旧账重建ID；业务身份不明不新建正式账 |
| outbox/云端 | 稳定operationId、完整payload摘要、源事件/平台引用/角色的别名 | 同ID内容冲突拒绝且原队列保留；旧摘要须核对已存不可变事件 |
| 用户确认 | 现有显式确认可处理普通identity_unproven候选 | 币种/清算/跨实例/引用冲突需要更多证明；未知canonical映射不能凭金额确认 |

A/B可靠重放或通知重建幂等，C不同可靠身份分别保留，D模糊输入保留待核实。金额相同、来源相同、零间隔不构成合并证据；长间隔也不解除可靠引用的幂等性。

微信/支付宝按其平台命名空间区分。同字面引用跨平台不直接并账。银行App与短信只有在已知发行方映射（例如cmb.pb/95555）或raw调用者明确声明同一canonical平台/issuer时才共享引用。银行名称文本不作为发行方证明。未知来源不猜跨平台共同引用。

Room payment_event_aliases保留来源别名/限定message证明/观察hash；proof和observation内部键不作为Web交易event_ids发布。原recognition、transaction/outbox ID不改。SDK消息when与UID的真实稳定性仍须P07设备证据；本地合成不证明Samsung投递事实。
''')
    write('DEDUPLICATION_RCA_AND_FIX.md', '# 去重根因、责任与修复\n\n' + intro + '''
CONFIRMED（源码+可失败合成回归）：原本地coordinator只按sourceEventId去重，不按可靠引用统一不同来源别名；同一引用的新ID可创建多笔。原Worker operationDigest的JSON replacer只保留顶层键，嵌套payload未进入摘要；同操作不同金额不能靠旧摘要安全判重。修复前Native12项8 FAIL、服务16项14 FAIL的完整证据保留。

修复：来源命名空间/角色与可靠引用查找、Room事务及持久别名，保留原ID；消息证明带profile UID并可在cache替换后从Room恢复。引用金额/实例冲突待核实；真实已持久化账目是权威，新冲突候选不能在第二次重放时晋升为自己的证据。post-capture的本地决定进入上传candidate门禁，review事件不借用其它hint的confirmed回执。不同订单ref优先于相同消息tuple。

旧金额/时间reconcile经全生产调用搜索无该coordinator方法调用；仍保留诊断功能，DAO取2并singleOrNull，不再在两个候选中取第一项，未接入生产记账。Task16旧raw入口另外存在score>=0.92自动合并和强引用受3分钟候选窗限制：相似度现在只提示，自动关系只接受同命名空间可靠引用；可靠引用查找跨时间窗口，多个历史ID或扫描不完整保守待核实，保留原历史账目。

回执：摘要改为递归稳定序列化；旧摘要仍保留，经完整原事件逐字段比较后允许兼容重放。确实已入账的receipt优先于迟到编辑器值，防止把999覆盖450；新不一致ingest仍拒绝。已synced本地交易不能被另一个迟到ID改名。新legacy模糊金额不正式入账，精确全别名全部confirmed且非空并一致才恢复；已存在旧账通过显式fixture继续验证保留。

边界：P02的A009/A011/A201/A203及20弱身份目标保留，输入没有足够新事件证明，且原直接调用宿主没接新Hook门禁，不能据此断言真实吞单。真实UID/消息槽位/重投递未授权测试。D-01/D-02不重开，不归因三星驱动。
''')
    write('PREAUTH_STATE_MODEL.md', '# 预授权状态模型与限制\n\n' + intro + '''
复用现有recognition/candidate/正式ledger。financialPhase是来源操作的结构化事实，family由referenceNamespace+lifecycleReference限定；providerReference是该次可幂等操作的可靠引用。没有共同引用不按金额/商户/时间关联。

| 操作事实 | 持久化/正式账目 | 原有UI状态 |
| --- | --- | --- |
| AUTHORIZED | 原授权金额/币种/引用保留；无正式支出 | FINANCE_PENDING_CONFIRMATION |
| SETTLED | 最终可信结算金额只记一次，不把授权额相加 | FINANCE_RECORDED；已关联hold关闭 |
| RELEASED/EXPIRED | 仅明确解除/过期证据关闭hold；不抵消已有支出 | 复用IGNORED关闭状态，原financialPhase保留 |
| REFUNDED/既有refund方向 | 独立退款ID/方向，原结算不覆盖 | FINANCE_RECORDED |
| REVIEW_REQUIRED/身份不足 | 金额、币种和冲突证据保留；不自动正式入账 | 现有待核实 |

200 USD授权→170结算→200解除最终仅170支出。重复结算/退款30次幂等；结算先到、授权后到不多记。不同授权引用同额同时存在不合并；有独立清算引用且明确同授权家族的80+90可保留两条清算并合计170。源未宣布过期时不凭时钟杜撰授权失效；7天无结算仍待结算，与90秒OCR票据不是同一时钟。

未完成部分：明确partial标记、无共同引用、无清算子ID、部分解除/残余冻结余额/复杂多次退款仍保守处理，不宣称完整清算系统。冻结C005只提供同一个AUTH引用的80与90，无法区分追加清算与金额修正；保留80及90冲突候选，不猜170。冻结C007无共同引用，0正式账且保留候选，原目标170不改。旧raw文本接口无此类型模型，授权/清算文字只入pending证据，须升级到结构化入口而非猜测关联。
''')
    write('MIGRATION_AND_COMPATIBILITY.md', '# 数据迁移、兼容与回退\n\n' + intro + '''
Room 10→11只添加payment_recognitions的identityReviewReason、financialPhase、lifecycleReference、referenceNamespace、currencyEvidence（均默认空，不补猜币种或完成状态），增加payment_event_aliases。既有表、记录ID、金额、currency、receipt/outbox不清空、不重建。schema1–10原导出不改，新增11；原迁移用例续接10→11。

D1 0027增加Task21结构化事件的五个证据字段、生命周期/引用索引和task21_payment_reference_aliases（指向现有raw证据，不是新账本），metadata schema_version=3。Task16/Task21请求schema_version仍1；ingest新增可选结构化字段，旧字段默认空兼容；新增校验/候选行为明确属于P03安全合同。Hint发行方从既有source_package/payment_channel取得，不新增原文或私密字段。

0026编号保留给独立Task26分支，本轮不复制或合并其迁移。局部Miniflare按现有1–25与27验证；正式目标分支迁移顺序、旧schema现状和0026整合仍须所有者审核，本轮无任何远端迁移。

真实本地验证：v10 fixture升级保留旧transaction/event ID与币种和outbox，30次别名重放仍一笔；Room注入DDL后失败，user_version与原行回滚。D1在新DDL中注入失败，已执行DDL及metadata整体回滚，原账/旧回执保留；完整batch后schema3通过。依据[Room迁移指南](https://developer.android.com/training/data-storage/room/migrating-db-versions)与[D1 batch事务语义](https://developers.cloudflare.com/d1/worker-api/d1-database/)设计，实际结果见机器证据。

**Git回滚不是数据回滚。** Room11没有破坏性降级或down migration；旧APK实际读取11未测试，不得安装旧正式包尝试。D1 metadata3使预期2的旧服务器不ready，以避免旧确认逻辑把hold当支出；不能先单独迁移Production再继续旧服务，也不能只回退旧服务器。上线前须备份、协调服务/迁移顺序并测试能理解新证据的回退候选。本轮仅隔离合成数据库，没有读取真实用户库或正式备份，没有承诺零迁移风险。
''')
    write('CURRENCY_SAFETY_GATE.md', '# ISO币种P0防错门禁\n\n' + intro + '''
原问题经P02动态证明：12条明确单一USD/EUR/HKD/GBP/JPY输入在产品parser/coordinator写为CNY。P03同时修安全解析装配、Hook、捕获上传、持久恢复、确认payload与Worker门禁，不能只修页面或只修parser。完整原币证据、currency与配对金额保留，不删除ISO词、不添加汇率。

六种明确单位采用现有amount/currency表示；JPY原币minor为零位，其他冻结六币种为两位。没有做FX、用户币种配置、今日/历史汇率、混币预算或格式修复。多币种/多个不一致金额进入待核实。AUD/CAD/BHD等运行时已知但本轮不支持的明确ISO保留code和证据、金额不猜并阻断正式账；货币样式商户词不应覆盖明确CNY的控制用例已通过。

Worker结构化字段与明确currency_evidence冲突拒绝，无意义新CNY账不得生成；旧raw接口从现金文本识别明确ISO，冲突保留pending、原币代码/证据，金额置未证实，不把不明单位猜成CNY。运行时币种目录只用于code识别，不是市场数据（[ECMA-402 Intl.supportedValuesOf](https://tc39.es/ecma402/#sec-intl.supportedvaluesof)）；真实设备目录及真实业务输入未测。

原已入账的历史外币不自动批量改；owner需要另行授权历史数据核查。JPY显示仍有原formatter除100问题，月/预算/分类混币合计与历史FX仍红，必须在P04处理后才能以完整多币种产品发布。P03正确存币种不等于这道发布门禁通过。
''')
    table = '# 测试矩阵与P02逐案复核\n\n' + intro + f'新P03独立用例：{counts(p03)}。原607与新P03标准JVM合计 {summary["all_normal_jvm"]}；P02冻结矩阵 {counts(old)} → {counts(current)}，608条ID/真值/测试源码保留。\n\n| P03 case | 期望/范围 | 实际 | 状态 | 证据 |\n| --- | --- | --- | --- | --- |\n'
    for row in p03:
        table += f'| {row["case_id"]} | {clean(row.get("expected",row.get("fixture",{})))} | {clean(row.get("actual",{}))} | **{row["status"]}** | `{row["evidence"]}` |\n'
    table += '\n## 冻结P02 608条\n\n表格缩写；完整fixture/expected/actual/error在p02-comparison.json，原始输入未修改。G复用26条不重复计新执行；模型字段名启发式lifecycle_model_implemented不是能力判定，P03使用financialPhase而非该旧探针猜的列名。\n\n| case | before | after | 实际 | 归属与限制 | 原始证据 |\n| --- | --- | --- | --- | --- | --- |\n'
    for row in current:
        table += f'| {row["case_id"]} | {row["before_status"]} | **{row["status"]}** | {clean(row.get("actual",{}),150)} | {row["p03_disposition"]} | `{row["evidence"]}` |\n'
    write('TEST_MATRIX.md', table)
    write('TEST_RUNS.md', '# 本轮执行、环境和失败账本\n\n' + intro + f'''
标准Android：{summary['all_normal_jvm']}；原588 JVM+13 Node+6 DOM为本轮607，非历史PASS。新增P03：{counts(p03)}（JUnit方法与方法内30次重复分开，不把动态循环伪称独立JUnit）。原夹具调整3项：离线同步补可靠引用；两个旧账保护夹具预置旧版本已有持久账目，不再把fixture setup的“创建新账”混为“保护已有账”。原账目/回执断言均保留，另增无依据新建账目必须0的强断言。7个迁移用例只加10→11链。不能说输入完全相同。

环境：Windows/PowerShell，Node24.18.1、Python3.15.0、JBR21.0.10、Gradle9.4.1、SDK36，Robolectric API34。npm ci原lockfile34包，未升依赖。Workers参考类型仅下载到ignored目录5.20261018.1，不是产品升级。所有原始stdout/stderr、JUnit、NDJSON、APK及hash在ignored finance-p03。

| 执行命令/范围 | 结果 | 证据目录/日志 |
| --- | --- | --- |
| 原Gradle unit/lint/assembleDebug，--rerun | PASS，具体数量见上 | reviewed-final-android.log、reviewed-final-junit/、reviewed-final-lint.xml |
| 原Aeris Node13/浏览器DOM6 | 19 PASS | existing-node-state.log、existing-browser-state.log |
| 原Task21/16/17本地后端 | 3脚本PASS | final-task21/16/17.log、final-backend-exits.json |
| P03 server.mjs | 原生ingest/normalize/D1/hint/编辑删除恢复 | server-reviewed/server.ndjson |
| P03 legacy-raw.mjs | 原模型仅读对照+真实raw sync/D1 | legacy-raw-reviewed/、before-p02.json |
| P03 migration.mjs | 2 PASS，含故障注入和旧回执 | d1-migration-attempt1/migration.json |
| Bridge seed/restore（两个Gradle命令）+bridge-server | PASS，两个PID、503丢回执后恢复 | bridge-controlled/、bridge-controlled-seed/restore.log与-junit/ |
| 原P02 Matrix/Timing（最终源码overlay） | 按组非零保留，逐条真实结果 | p02-final-native/、p02-final-native.log与-junit/ |
| 原P02 C8中间专项复验 | C005/C007保持EXPECTED_RED；最终全量再复验 | p02-c-reviewed/ |
| 原P02 Seed/Restore（两个JVM） | 2 PASS | p02-process/、对应-junit/ |
| 原P02 Web/DOM/D1与AI示例 | 非零红灯及F012桩不一致保留 | p02-after-web/、p02-web-exits.json |
| protection.py前后对比 | 外部工作树/证据不变 | protected-final.comparison.json |

完整可复制PowerShell与-D参数见qa/finance-p03/README.md。每次输出选新目录；Gradle串行，归档后才运行下一次。Node脚本使用FINANCE_P03_OUTPUT，仅Miniflare或随机loopback，绝不--remote。签名变量仅从本轮子进程移除，不改系统环境。

## 保留的真实失败与纠正

- before-native：12方法8 FAIL；server-before：16例14 FAIL；不是编译成功即宣告完成。
- native-attempt1：发行方夹具错误地用通用sms标识却要求等价95555；改为可观察95555，另加未知短信名称不能借CMB作用域的对照，不按银行正文猜发行方。
- full-android-attempt1：5 FAIL：普通退款被误要求授权引用（产品回归，已修）；parser completion flag与身份门禁混层（已分层）；离线夹具缺可靠身份（补引用）；两条迁移fixture遗漏可选indices（仅QA装配修正）。全部日志保留。
- existing-task21首次：迟到编辑器999/收入被误拒为event冲突，原保护要求重用已入账450/支出的真实receipt。保留失败，修复为现有receipt优先且不附加矛盾新引用，后端重跑PASS。
- unsupported-iso-before：AUD仍为CNY的FAIL保留；扩展明确ISO识别，不支持单位保留待核实；没有新增FX或全币种功能。
- legacy-identity-before：无身份legacy仅凭已知金额新建账的FAIL保留；改为待核实，完整精确非空回执一致后恢复，已有持久账目不删除。
- server-attempt1：新SQL行注释被既有测试flatten换行吞掉导致0案例启动失败，改block注释兼容既有loader；失败栈保留。
- bridge-final-restore：队列仍7项的断言FAIL；该服务最终0请求、0账目，恢复启动时已停止，未验证到实际服务链。六分钟watchdog及文件时间线见bridge-final/和bridge-expiry-diagnosis.json。未修改产品或放宽断言，改在全新bridge-controlled目录连续执行seed→服务→restore；原FAIL及堆栈保留，不能由后续PASS抹除。
- integrity-attempt1：审计脚本直接比较git show的LF字节与Windows CRLF工作副本，触发QA断言；六份配置归一化后相同，改用git hash-object验证原blob。产品未因此修改；诊断和复核见integrity-attempt1.json、integrity-review.json。
- 中间局部/全量运行、冻结P02非零、F012 mock矛盾及所有重跑均保留。最后一次PASS不覆盖它们。Node MODULE_TYPELESS_PACKAGE_JSON告警未通过改package配置消除。

## 实际覆盖边界

Bridge是两个真实JVM、真实磁盘Room/队列、HTTP transport、本地D1服务及实际回执闭环，但合成账户绕过真实登录；不是Hosted或Samsung。ML Kit只运行原mock/假时钟。真实交易/通知/云/生产/旧APK降级等NOT TESTED。性能只可从本轮raw样本读取开发机耗时，CPU并发负载不同不声称比P02更快；OCR硬件P50/P95均NOT TESTED。
''')
    proof_table='| 范围 | 文件数 | 新增/缺失/改变 | HEAD/branch/dirty |\n| --- | --- | --- | --- |\n'
    for name,r in proof.items(): proof_table+=f'| {name} | {r["files"]} | 0/0/0 | '+('相同' if 'headSame' in r else '原始证据相同')+' |\n'
    write('PROTECTED_WORKSPACE_AUDIT.md', '# 受保护工作区与边界核验\n\n' + intro + proof_table + '''
before在产品修改前记录；after在所有构建/回归后重新逐文件SHA。脚本只有文件系统/Git，不使用ADB。固定主工作区WIP、Task26、旧修复、D01/对照/D02/候选/P02的HEAD、branch、dirty与文件hash均相同，ignored原始证据也单列保护。P02的报告/fixture/test和原始日志未覆写；本轮重跑输出均在新worktree。

只修改本P03产品分支。正式applicationId、签名/版本、依赖、Manifest权限、会员、旗标、release配置无Git内容差异；关键配置和schema1–10的原Git blob已复核，Windows换行不作为产品改动。外部受保护树按实际文件字节SHA核验。没有读取正式手机或App数据，故其实际安装/数据状态NOT TESTED，只能确认本轮未操作，不能冒称设备校验PASS。没有Production、D1/R2、账户、推送、合并、PR写入、发布或Task26启动。共享Git只新增本分支/本地提交，不改受保护分支。

最终commit/tree、产品/测试/fixture/报告/原始证据SHA清单见FINAL_REVISION.json与provenance.json；不提交secrets、签名材料、金融原文或重建产物。
''')
    write('REMAINING_RISKS.md', '# 未完成、风险与下一阶段条件\n\n' + intro + '''
P03状态PARTIAL，不用剩余P04/P05/P06红灯制造全绿。

1. P03业务边界：C005无独立清算子ID，80/90可能是追加或修正，不能自动判170；保留80与冲突90。明确partial、残余冻结余额、复杂多次退款/部分解除没有完整资金模型。独立子流水与明确共同授权家族已测，但缺证明时必须保持review。旧raw API只隔离未结构化清算，不宣称支持全部授权管理；调用者须迁移结构化合同。
2. 人工/历史数据：未读真实库，不批量修正历史外币或既有错误重复。旧未知canonical映射需要实际一致回执或所有者更强证明，不能凭金额自动“修复”。真实旧客户协议/旧APK降级、正式备份恢复没有执行。
3. P04：JPY显示、默认/符号币种决议、混币月/预算/分类、历史FX与缺率状态仍未完成；正确存原币不等于UI/统计完整正确，阻断完整多币种发布。
4. P05：E004/E007/E008固定语义FAIL保留；真实像素、ML Kit、secure-window、真实异步截图/锁屏没有测试。90秒/8次假时钟回归不等于硬件时延。
5. P06：15个AI产品项目NOT TESTED/NOT_IMPLEMENTED；F012仅mock契约不一致。没有模型调用、AI金额决策或授权UI实现。
6. P07/生产：真实Samsung、MessagingStyle投递稳定性/资料UID、真实MainActivity/后台恢复、真实微信支付宝、真实跨设备/Hosted/Production、真实云幂等全部NOT TESTED。桥接使用合成账户，不能代替这些验收。W01–W10及真实支付仍需独立授权。
7. 部署/回退：Room11与D1 metadata3需要协调、备份和回退候选；旧版本直接读取/降级不可假设安全。0026独立Task26与0027顺序必须在目标分支重新审查。没有发布授权，不安装或迁移正式App。

下一步：所有者先审核本地产品差异、夹具合同调整和剩余清算边界；接受安全隔离范围或授权P03补完后再决定P04。禁止自动推进下一阶段、生产集成、合并或真实验收。
''')
    print(json.dumps({k:summary[k] for k in ['status','all_normal_jvm','new_p03_rows','new_p03_statuses','frozen_p02_after','protected_groups']},ensure_ascii=False,indent=2))


if __name__ == '__main__': main()
