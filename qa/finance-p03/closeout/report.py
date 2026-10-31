"""Closeout reports from fresh archived results; frozen P02 truth stays unchanged."""
import argparse
import collections
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'docs/migration-evidence/finance-p03/closeout'
OLD = BASE.parent
DOC = ROOT / 'docs/finance-p03'
BASELINE = '81d5aa7cc51b55d386b59414019c4a0f01272032'


def read(path): return json.loads(path.read_text(encoding='utf-8-sig'))
def relative(path): return path.relative_to(ROOT).as_posix()
def counts(rows): return dict(collections.Counter(r['status'] for r in rows))
def ndjson(path): return [dict(json.loads(s), evidence=relative(path) + ':' + str(i)) for i, s in enumerate(path.read_text().splitlines(), 1) if s.strip()]
def text(value, limit=150):
    if not isinstance(value, str): value = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    return value.replace('|', '/').replace('\n', ' ')[:limit]


def junit(folder):
    result = {}
    for file in folder.glob('TEST-*.xml'):
        suite = ET.parse(file).getroot()
        for case in suite.findall('testcase'):
            key = (suite.get('name'), case.get('name'))
            result[key] = {'class': key[0], 'method': key[1], 'seconds': case.get('time'),
                'status': 'FAIL' if case.find('failure') is not None or case.find('error') is not None else 'NOT_TESTED' if case.find('skipped') is not None else 'PASS',
                'evidence': relative(file) + '#' + key[1]}
    return result


def collect():
    native = junit(BASE / 'completion-full-junit')
    backup = junit(BASE / 'room-backup-final-junit')
    assert len(native) == 632 and len(backup) == 5
    assert set(backup) <= set(native)
    # The final full suite now includes the stronger paired snapshot assertions. No extra count.
    baseline = junit(OLD / 'reviewed-final-junit')
    original = {k for k in baseline if '.FinanceP03' not in k[0]}
    existing = set(baseline) - original
    assert len(original) == 588 and len(existing) == 26
    assert original | existing <= set(native)
    assert all(r['status'] == 'PASS' for r in native.values())
    node = read(BASE / 'node-completion-final/exits.json')
    assert len(node) == 13
    assert all(r['exit_code'] == (1 if r['name'] in ['p02-web', 'p02-dom'] else 0) for r in node)
    tap = (BASE / 'node-completion-final/aeris-node.log').read_text()
    assert re.search(r'tests\s+13\b', tap) and re.search(r'fail\s+0\b', tap)
    dom = read(BASE / 'node-completion-final/aeris-dom.log')
    assert dom['tests'] == dom['pass'] == 6 and dom['fail'] == 0
    old_p03 = [dict(native[k], case_id='P03-JVM-' + k[1]) for k in sorted(existing)]
    old_p03 += ndjson(BASE / 'node-completion-final/p03-server/server.ndjson')
    old_p03 += ndjson(BASE / 'node-completion-final/p03-legacy/legacy-raw.ndjson')
    old_p03 += [dict(r, evidence=relative(BASE / 'node-completion-final/p03-migration/migration.json')) for r in read(BASE / 'node-completion-final/p03-migration/migration.json')]
    added = [dict(v, case_id='CO-JVM-' + k[1]) for k, v in native.items() if k not in baseline]
    added += ndjson(BASE / 'node-completion-final/closeout-server/clearing.ndjson')
    added += ndjson(BASE / 'node-completion-final/closeout-d1/migration.ndjson')
    bridges = {}
    for name, target in [('legacy-completion', old_p03), ('clearing-ack-final', added)]:
        seed, restore = read(BASE / name / 'seed.json'), read(BASE / name / 'restore.json')
        server = read(BASE / name / 'server-final.json')
        process = read(BASE / (name + '-run.json'))
        assert seed['pid'] != restore['pid'] and restore['queue'] == [] and process['server_exited']
        assert process['seed_exit'] == process['restore_exit'] == 0 and server['status'] == 'PASS'
        assert {r['transaction_id'] for r in restore['bookings']} == {r['id'] for r in server['txs']}
        bridges[name] = dict(server, seed_pid=seed['pid'], restore_pid=restore['pid'])
        for label, row in [('SEED', seed), ('RESTORE', restore)]:
            target.append({'case_id': ('P03-BRIDGE-' if name == 'legacy-completion' else 'CO-BRIDGE-') + label, 'status': row['status'], 'actual': row,
                           'evidence': relative(BASE / name / (label.lower() + '.json'))})
    assert len(old_p03) == 63 and counts(old_p03) == {'PASS': 63}
    assert {r['case_id'] for r in old_p03} == {r['case_id'] for r in read(OLD / 'p03-results.json')}
    assert len(added) == 41 and counts(added) == {'PASS': 41}
    current = []
    for group in 'ABCDE': current += ndjson(BASE / 'p02-completion-native' / ('kotlin-' + group + '.ndjson'))
    for name in ['web-pure.ndjson', 'web-dom.ndjson', 'ledger-d1.ndjson', 'ai-contract.ndjson']:
        current += ndjson(BASE / 'node-completion-final/p02-web' / name)
    for name in ['process-G-PROCESS-SEED.ndjson', 'process-G-PROCESS-RESTORE.ndjson']:
        current += ndjson(BASE / 'p02-completion-process' / name)
    current += ndjson(BASE / 'p02-completion-native/negative-bookings.ndjson')
    current.append(dict(read(BASE / 'p02-completion-native/timing.json'), evidence=relative(BASE / 'p02-completion-native/timing.json')))
    handoff = {r['case_id']: r for r in read(OLD / 'p02-comparison.json')}
    for row in handoff.values():
        if row['case_id'].startswith('G-REUSED-'):
            fixture = row['fixture']; fresh = native[(fixture['class'], fixture['method'])]
            current.append(dict(row, status=fresh['status'], evidence=fresh['evidence']))
        elif row['case_id'].startswith('NT-'): current.append(dict(row, evidence='docs/finance-p03/CLOSEOUT_REPORT.md'))
    assert len(current) == len(handoff) == 608 and {r['case_id'] for r in current} == set(handoff)
    for row in current:
        previous = handoff[row['case_id']]
        row['p02_status'] = previous['before_status']; row['handoff_status'] = previous['status']
        case = row['case_id']
        if case == 'C005': reason = '保持红灯：无子清算ID/版本。保留已入账80和90待核实；全量解除的实际残额未知，不猜170或解除120。'
        elif case == 'C007': reason = '保持原170真值；缺共同引用时0正式账为安全合同，不能替代原目标PASS。'
        elif case.startswith('A') and row['status'] != 'PASS': reason = '原宿主缺充分新事件证明/未走新Hook；保留FAIL或RED，不推断真实吞单。'
        elif case.startswith('E') and row['status'] == 'FAIL': reason = 'P05传统文本语义缺口，本轮未改OCR/识别器。'
        elif case.startswith('F'): reason = 'P06产品NOT TESTED；F012桩自检失败不是AI产品运行结果。'
        elif case.startswith('CW-'): reason = '冻结对象把授权放进active正式账；原红灯保留，未改冻结对象。'
        elif row['status'] == 'EXPECTED_RED': reason = 'P04币种决议/格式/混币与FX缺口，不扩展本轮范围。'
        elif row['status'] == 'NOT_TESTED': reason = '设备/真实模型/Hosted/Production等未授权或未验证。'
        else: reason = '本轮实际调用PASS；26条G复用本轮JUnit，不另计执行数。'
        row['closeout_disposition'] = reason
    proof = read(BASE / 'protected-seal.comparison.json')
    assert len(proof) == 13 and all(not r['added'] and not r['missing'] and not r['changed'] and all(v for k, v in r.items() if k.endswith('Same')) for r in proof.values())
    assert read(BASE / 'frozen-inputs-final.json')['status'] == 'PASS'
    snapshots = next(r for r in added if r['case_id'] == 'DM05-CLOSED-SNAPSHOT-RESTORE-V3-AND-V4')['actual']['snapshots']
    assert all(any(s['name'] == 'task11_learning_sync_changes' and s['seq'] >= 700 for s in r['sequences']) for r in snapshots)
    lint = collections.Counter(r.get('severity') for r in ET.parse(BASE / 'completion-full-lint.xml').getroot().findall('issue'))
    changed = set(subprocess.check_output(['git', 'diff', '--name-only', BASELINE], cwd=ROOT).decode().splitlines())
    changed.update(subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], cwd=ROOT).decode().splitlines())
    product = sorted(p for p in changed if p.startswith(('android/app/src/main/', 'android/app/schemas/', 'functions/', 'cloudflare/migrations/')))
    summary = {'status': 'PARTIAL', 'baseline_commit': BASELINE, 'original_607': {'PASS': 607, 'FAIL': 0, 'SKIP': 0},
        'standard_jvm': {'PASS': len(native), 'FAIL': 0, 'SKIP': 0}, 'old_p03': counts(old_p03), 'new_closeout': counts(added),
        'frozen_matrix': counts(current), 'matrix_rows': len(current), 'reused_junit_rows': 26,
        'lint': dict(lint), 'debug_build': 'PASS', 'product_files': product, 'bridges': bridges,
        'protected_groups': len(proof), 'binary_d1_snapshot': 'NOT_TESTED_BLOCKED_PROBE',
        'paired_room_outbox_backup_rechecks': len(backup), 'p02_status_changes_from_handoff':
        [{'case_id': r['case_id'], 'before': r['handoff_status'], 'after': r['status']} for r in current if r['status'] != r['handoff_status']]}
    return summary, old_p03, added, current, proof, node


def generate(data):
    summary, old_p03, added, matrix, proof, node = data
    commit = read(BASE / 'code-commit-final.json')['commit']
    intro = f'日期：2026-10-19（Asia/Hong_Kong；执行UTC时间见机器日志）。基线 `{BASELINE}`；实施提交 `{commit}`；分支 `codex/finance-p03-identity-preauth`。最终交付HEAD、tree和Debug APK SHA-256见 [CLOSEOUT_REVISION.json](../migration-evidence/finance-p03/closeout/CLOSEOUT_REVISION.json)。\n\n'
    for name, content in [('summary.json', summary), ('p03-existing-results.json', old_p03), ('new-results.json', added), ('p02-comparison.json', matrix)]:
        (BASE / name).write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding='utf-8')
    report = '# FINANCE-P03 收尾报告\n\n' + intro + f'''
**最终状态：PARTIAL。可提交所有者进行范围审核，不建议据此无条件关闭整个P03。**

开始时实际HEAD严格等于交接SHA、分支正确且工作树干净，才进行修改。已逐项读取原十一份报告、冻结608行及原始JSON/NDJSON；原报告、P02源码和800份既有P03证据字节hash保持。没有重置、重建仓库或覆盖旧工作。

已补足：处理中/完成事实区分、完成见证恢复与旧intent回放保护；显式授权家族+独立操作引用下的多次部分Capture、部分解除、多次/完整退款、超额退款/解冻阻断、乱序依赖恢复、显式到期、原授权与清算额不相等、不可安全表示的历史总额隔离。授权本身不入支出。已增加可重建的源清算投影和两项可选结构化证据，复用原recognition、candidate、outbox和正式账本，保持已有ID。D1账本写入与余额CHECK及回执可见性同批提交，避免两个并发退款通过各自JavaScript检查后共同超额。

C005仍保留原170目标和EXPECTED_RED：原80账目保留，90证据待核实。本轮中间实现曾把全量解除残额错误断言为120；新增可失败回归后改为未知/null。C007原170目标同样未改，缺引用时0正式账不能冒充其PASS。有明确独立Capture引用的80+90实际路径则记两笔、合计170，解除原授权残余30。状态版本>1明确识别并保留，但自动修正已有账目尚未实现；不会把90当作新支出或覆盖80。

| 本轮有效集合 | 结果 |
| --- | --- |
| 原607方法/脚本集合 | 607 PASS / 0 FAIL / 0 SKIP；保留前轮已披露的3个夹具合同条件 |
| 原P03新增63 | {counts(old_p03)}；迁移目标续接12/4，原ID/金额/回执断言保留 |
| 本轮新增41 | {counts(added)}；18 JVM、16服务、5 D1迁移/恢复、2新桥接 |
| 标准JVM总数 | 632 PASS；包含588原有+26前轮P03+18本轮新增，不与上述集合相加 |
| DB/outbox快照加强复验 | 同5个方法另跑PASS，不另计5个新用例 |
| Lint / Debug | PASS；告警实际为 {dict(summary['lint'])} |
| 冻结608行 | {summary['frozen_matrix']}；26条复用本轮JUnit，不重复计数 |

两组双JVM桥接均真实使用Room文件、outbox、HTTP和本地D1。原场景最终3账/2待核实/9请求；新清算场景4账/1版本修正待核实/至少15请求，USD支出170、退款50、源净额120，队列空且ID稳定。前者首笔支付已提交后503；后者首个授权事件已提交后503，均使用原操作ID恢复。二者都是合成账户，不能当作Hosted登录、真实云同步或Samsung验收。

迁移结果：Room11→12增量成功，中断事务回滚后重试成功，重复DDL明确拒绝；真实v11 Room opener对v12失败关闭且旧行不变。D1 3→4同样验证回滚、重试及重复拒绝；从81提取的实际旧v3 API返回503 schema_not_ready。逻辑快照在新D1 runtime恢复全部应用表、原财务ID/回执及自增水位700；Room关闭后的DB和outbox分别配对快照已验证。持久化Miniflare二进制快照探针阻断，真实云端/正式App备份与恢复仍NOT TESTED。

剩余范围：自动修正/Capture重归属、弱引用历史候选到权威账目的安全映射、真实提供方对操作ID/版本语义的证明、真实备份/回退门禁。净额投影表示已接收源清算事实；用户编辑/删除后的正式账本统计仍由原Task16链路负责，不拿源投影覆盖它。P04币种展示/FX、P05 OCR、P06 AI继续保留原红灯，未开发。

建议所有者只接受“可靠独立操作的基础清算及明确隔离合同”子范围；未接受上述业务边界、未补完修正映射和正式备份条件前，P03保持PARTIAL。没有进行手机/ADB、真实支付、正式App数据迁移、Production、PR、推送、合并、正式签名或发布；D-01/D-02保持CLOSED，Task26豁免不改成PASS。

- [身份、金额与隔离合同](CLOSEOUT_LIFECYCLE_CONTRACT.md)
- [迁移、回退与部署阻断手册](CLOSEOUT_MIGRATION_RUNBOOK.md)
- [全部608行及新增/既有P03矩阵](CLOSEOUT_TEST_MATRIX.md)
- [命令、失败账本与保护核验](CLOSEOUT_TEST_RUNS.md)

## 本轮全部产品差异

''' + '\n'.join('- `' + p + '`' for p in summary['product_files'])
    (DOC / 'CLOSEOUT_REPORT.md').write_text(report, encoding='utf-8')
    contract = '# P03 收尾清算与隔离合同\n\n' + intro + '''
家族键为用户+已验证发行方命名空间+显式授权引用，操作键另含角色与独立providerReference。系统槽位、金额、商户、时间不证明交易身份。部分事实必须同时有显式授权号及不同的操作引用；只有一个AUTH字面引用的80/90不证明两次Capture。

`lifecycleOperation`/`lifecycle_operation`为AUTHORIZE、CAPTURE、REFUND、RELEASE（部分解除）、CLOSE（全量解除/显式到期）；`lifecycleRevision`/`lifecycle_revision`保留来源版本，默认0代表旧消息未提供。版本>1进入`lifecycle_revision_requires_reconciliation`，不猜测它是累计额、增量额或最终替换额。

| 数值 | 合同 |
| --- | --- |
| A 原授权额 | 接受的同家族唯一原始授权金额；尚未到达时null，不从解除文本或Capture金额反推 |
| C 已清算额 | 独立可靠Capture的已记录金额，同canonical receipt只算一次；授权不计入 |
| R 已解除额 | 独立部分解除求和；全量CLOSE只在A及清算事实无矛盾时推导剩余解除额，不再次加原授权额；无法证明时null |
| H 剩余冻结投影 | max(A−C−R,0)，A未知或存在未解决矛盾时null；退款不增加冻结余额 |
| F 累计退款 | 可靠独立退款求和，新增退款必须≤C−既有F；超过时保留证据但不入账 |
| N 源净额 | C−F；正常未被用户改写的账目等于该家族净支出。正式账本被编辑/删除后的净额仍读原Task16，不能将源事实回写覆盖 |

授权不是最高扣款额度证明：可信最终Capture可以小于或大于原预留额；超出未解除授权覆盖的部分单列`overCapturedMinor=max(C+部分解除−A,0)`，不产生负H、不把授权额与清算额相加。跨币种家族冲突隔离，不做换汇。总额超出安全整数表示范围拒绝新写入并保留原账。

例如200→Capture80→Capture90→部分解除10→部分解除20→退款20和30，C=170、R=30、H=0、F=50、N=120。100授权→120可信Capture，支出120、H=0。100授权→80Capture→显式到期，只释放残余20，支出80不冲销。到期先到而原授权未到时，解除额未知；原授权到达后才可推导。没有来源到期事实时，不因墙钟或90秒OCR票据过期虚构授权失效。

这些是已接收源事实的投影，不证明银行实时可用余额或所有消息已经到齐；迟到可靠事实可以更新推导值，原事件和稳定账目ID不重建。关联不明、版本修正及金额矛盾使相应余额未知，不能将null显示为已验证0。

## 可恢复与不可自动恢复

- `lifecycle_completion_unproven`：部分清算/退款缺成功证明、解除或授权仍处理中时不能入账/解冻。完成事件必须有同发行方、家族、操作引用、角色、金额和币种的已接受回执/控制见证；重试、金额或时间相似不能自证。旧intent alias保留，完成发布使用新的不可变操作身份；迟到intent不覆盖完成态。
- 已接受的非入账控制事件闭合自身候选（复用rejected/IGNORED并保留accepted guard事实），不提前关闭仍有余额的授权，也不代表删除原事件。

- `lifecycle_capture_missing`：同发行方、同显式家族的实际Capture到达后，重新检查累计退款上限；一次有界扫描恢复，不轮询、不无限补拉。
- `lifecycle_authorization_missing`：原授权到达后重新检查部分解除及余额；全量关闭只证明关闭事实，不自动证明缺失的原额度。
- `lifecycle_refund_exceeds_capture`/`lifecycle_release_exceeds_remaining`：保留候选。只有后续精确家族事实使约束成立才能恢复，不能手工填一个金额绕过。
- 引用/资料实例/币种冲突、版本修正不随其它付款到达而自动清除。人工确认不能绕过这些阻断。
- C005若取得“90是另一独立Capture”的可靠子引用，可作为新的受证操作验证；旧歧义候选与该操作的精确映射仍须补充源事件/回执证明。不能把90重试当作证据，不能通过删旧80再建新账解决。
- 若证明90替换80，需要权威操作版本作用域、前驱版本及旧transaction/receipt对应关系，并与用户编辑/删除revision作CAS保护；当前未实现自动改写接口，继续隔离，不能宣称支持修正完成。
- C007缺家族引用时0正式账、候选及证据保留。原冻结170目标不变；后续必须取得可核对的共同引用与原发生事件关系，金额相似度不是恢复条件。

只接受测试明确提供的结构化操作语义；真实银行/微信模板是否提供这些字段仍NOT TESTED。旧raw文本接口继续保守待核实，没有扩展成第二套清算账本。
'''
    (DOC / 'CLOSEOUT_LIFECYCLE_CONTRACT.md').write_text(contract, encoding='utf-8')
    migration = '# P03 收尾迁移、恢复与部署阻断\n\n' + intro + '''
Room11→12只增加两个默认空/0的证据列；保留1–11原schema、所有旧金额、ID、候选和outbox。D1 0028只增加两项来源事实、一项服务端核实原因及CHECK验证标记表，Task21 metadata变4，wire仍1。0026仍留给独立Task26，未复制或修改其工作区。没有destructive migration，没有批量补猜币种，没有修改正式版本/签名。

本地已验证：历史迁移链续接12，v10/11原ID及币种不变；中途DDL失败回滚后可重试；重复原始ALTER拒绝并保留原数据，正常按版本打开不重复迁移。不能把“DDL可重复执行”虚构成幂等：它会安全报错，版本/迁移账本必须控制仅执行一次。

v11 opener是从81冻结实体定义生成、使用原Room runtime的真实旧schema opener；对v12默认降级路径抛错，之后v12原行仍可读。不是安装旧APK的真机测试。D1从81复制的实际旧API/service/model在metadata4时HTTP503 `task21_schema_not_ready`，尚未进入鉴权或账本写入。这个门禁针对Task21；回退时必须同时禁止其它旧财务写入口，不能假定全站服务均被该metadata挡住。

Room关闭后复制数据库与配对队列：v11快照恢复旧1账/1队列，新v12快照恢复2账/2队列；原活跃副本不动。旧快照明确缺少升级后的新写入，因此恢复旧快照不是无损降级。D1逻辑schema/数据/自增水位在新runtime恢复，保留旧transaction/operation receipt及水位700；二进制持久化探针阻断仍保留，不以逻辑测试替代生产备份工具验收。依据[Room迁移指南](https://developer.android.com/training/data-storage/room/migrating-db-versions)和[D1事务批次语义](https://developers.cloudflare.com/d1/worker-api/d1-database/)，实际结果以本地日志为准。

## 现在可实际复验的安全恢复命令

见 `qa/finance-p03/closeout/README.md`：`prepare-baseline.py`校验旧模块，`run-gradle.ps1`运行旧opener/中断/DB与outbox快照测试；`migration.mjs`在全新空白D1 runtime执行逻辑恢复；`run-bridge.ps1`验证进程死亡、HTTP、回执和队列。本轮只运行这些合成副本，没有提取正式手机私有数据库。

## 将来部署前必须满足的顺序（本轮未执行）

1. 所有者另行授权真实备份、隔离恢复及部署，并先冻结采集、outbox发送、Task16/21 ingest、hint/confirm和其它财务写入口；记录用户级服务版本及队列水位，证明没有在途写入。
2. 通过被系统/应用正式允许的导出方式获取关闭后的Room DB及完整outbox、版本与hash清单；不能复制一个仍在写WAL的裸.db。正式App安全导出通道未验证时保持阻断，不使用Root或绕过手机权限。
3. 获取提供方支持的D1备份/恢复点和导出，记录schema/迁移账本/写入水位。到独立目标实际恢复，逐一核对旧ID、金额币种、receipt、队列、水位及孤儿/重复关联。真实云端Time Travel和正式备份本轮NOT TESTED。
4. 审查目标分支全部迁移顺序（含独立0026与27/28）、旧客户端行为和最小服务版本。协调部署理解schema4的服务与Room12客户端，绝不能先迁移后继续旧写服务。
5. 在仍冻结写入的条件下验收API readiness、队列重放、迟到回执、编辑/删除及历史候选。任一项失败、备份无法恢复或水位不一致，继续阻断部署。
6. 优先向前恢复：发布仍理解Room12 / D1 schema4的修复候选。Git回退不降低数据库版本；禁止改user_version、清库或重建历史账目来让旧包启动。
7. 只有证明备份后没有新写入，才可以评估成对恢复旧DB与同水位队列/服务快照。已有新写入时必须先保全两侧及回执，完成经审核的差额重放/对账；不允许直接恢复旧快照丢新账。
8. 所有正式备份、旧APK、Hosted及真实端到端门禁通过后才由所有者解除写冻结。当前不具备这些发布条件。
'''
    (DOC / 'CLOSEOUT_MIGRATION_RUNBOOK.md').write_text(migration, encoding='utf-8')
    table = '# P03 收尾测试矩阵\n\n' + intro + f'原P03：{counts(old_p03)}；新增：{counts(added)}。所有循环30次为单方法内部试验，不另计JUnit。\n\n| case | 状态 | 实际/范围 | 原始证据 |\n| --- | --- | --- | --- |\n'
    for row in old_p03 + added:
        table += f'| {row["case_id"]} | {row["status"]} | {text(row.get("actual", {"method": row.get("method"), "seconds": row.get("seconds")}))} | `{row["evidence"]}` |\n'
    table += '\n## 冻结608行逐项复核\n\n原P02的7 FAIL及62 EXPECTED_RED全部保留历史状态。旧lifecycle_model_implemented按列名启发式探测，不能代替真实清算/持久化断言；本轮实际能力以新增41项真实路径为准。此表覆盖所有608条，完整fixture/expected/actual/error见收尾p02-comparison.json；无样本或真值修改。\n\n| case | P02 | 81交接 | 收尾 | 实际 | 处置 | 证据 |\n| --- | --- | --- | --- | --- | --- | --- |\n'
    for row in matrix:
        table += f'| {row["case_id"]} | {row["p02_status"]} | {row["handoff_status"]} | **{row["status"]}** | {text(row.get("actual",{}))} | {row["closeout_disposition"]} | `{row["evidence"]}` |\n'
    (DOC / 'CLOSEOUT_TEST_MATRIX.md').write_text(table, encoding='utf-8')
    runs = '# P03 收尾命令、失败账本与隔离\n\n' + intro + '''
全部有效Node命令、真实参数向量、开始/结束UTC、退出码和日志在closeout/node-completion-final/exits.json。Gradle overlay命令向量在各`*-run.json`，最终有效运行索引在acceptance-index.json；completion-sequence.json保留了修正QA前的桥接FAIL，之后由clearing-ack-final-run.json接续（旧轮次final-gradle-sequence.json也保留）。标准完整命令为 `./android/gradlew.bat -p ./android :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --rerun --no-daemon --console=plain`；环境和可复制命令见QA README及environment.json（Node24.18.1、Python3.15.0、JBR21.0.10、Gradle9.4.1、compile/target SDK36、Robolectric34；依赖未升级）。全量日志completion-full.log及-junit/、-lint.xml保留；更强的DB/outbox备份断言在room-backup-final重跑5个原方法，不另加5计入总数。

本轮没有删减冻结测试。原607仍为588 JVM+13 Node+6 DOM；继承前轮三个已披露夹具合同，本轮仅续接7个迁移路径到12。原P03 persistence/bridge的迁移注册也续接12，迁移脚本M02的目标续接4并实际断言DB metadata4；所有原ID/金额/receipt保护断言保留。P02脚本通过输出前缀重定向进入新目录，源文件/样本/hash不变，不进入原P02 worktree运行。

## 真实失败与中间执行（不由后续PASS覆盖）

- `clearing-before`：新增9方法在81行为上9 FAIL；说明缺能力，完整栈在XML/log。
- `clearing-attempt1`：32方法1 FAIL。QA helper把Capture和Release命名成同一source occurrence，产品正确拒绝不同角色；修正合成事件ID命名空间，断言不放宽。attempt2为32 PASS。
- `room-attempt1`：QA编译失败，RoomDatabase不实现AutoCloseable，改用显式finally关闭。该文件夹曾拷到旧XML，属于STALE_ARTIFACT，不计为本轮执行；后续launcher只归档开始时间之后的新XML。
- `room-attempt2`：8方法2 FAIL，长QA路径在PRAGMA journal_mode时CANTOPEN；仅缩短合成fixture文件名后attempt3为8 PASS。长度对照支持QA宿主路径限制，未归因Android；未修改产品journal、硬件加速、超时或手机策略。
- `server-attempt1`：合成用户名超过40导致启动失败，0业务case；缩短QA账户名。attempt2有11 FAIL，原因是跨合成账户复用了全局event_id；给case加前缀，attempt3原12例PASS。没有改变业务预期。
- `c005-release-before`：2方法2 FAIL；`node-verified`的N13也真实FAIL（12000不等于null）。本轮中间投影错误把有矛盾的全量解除残额当确定值；已以nullable解除额修复，后续新增处理中负向覆盖；最终16服务例和632 JVM通过。这不是声称81已有这项投影功能。
- `completion-before`：补充2方法2 FAIL，确认新部分状态把“结算通知/解除处理中”当作完成。已加独立完成证据门禁，精确完成见证才能恢复，迟到处理中消息不得降级已接受事实；规范完成upload ID保留旧intent alias，避免以新payload重放已ack的旧操作。最终全量重新执行，早先630/37结果只作中间证据，快照见draft-6187f06/。
- `clearing-completion-restore`：旧意图先收到candidate而本地已有完成账目，现有不删队列门禁保留1条，原过早清空断言FAIL。QA新增严格中间态：9条确认、只余指定意图、请求SHA原样、无永久拒绝，再以同请求获取receipt_reconciled后断言0队列和ID不变。产品ACK门禁未改，未延长超时；最终clearing-ack-final采用该依赖重放合同，要求至少15次请求，保留原FAIL/11请求记录。
- `d1-attempt1`及`persist-probe`：持久化Miniflare启动/探针阻断；只停止经PID和父子关系核对的本轮探针。未得到二进制恢复证据，不猜测平台根因。`d1-probe`一次shell quoting语法失败也保留，不能算作数据库失败。
- `node-final`启动器单参数被展开为首字符，多个脚本根本未运行，原日志MODULE_NOT_FOUND保留。改显式string[]，有效完整结果取node-completion-final；没有以这些启动失败计算607 PASS。
- 冻结P02聚合7方法4 FAIL，Web/DOM非零，以及F012 mock契约自检不一致继续保留。完整堆栈在NDJSON/XML，表格摘要不替代原始错误。

本轮PASS不覆盖上述执行记录。原81的十一份报告和800份原始证据也完整保留。真实Samsung、真实支付/通知、Hosted/Production、旧正式APK及正式备份全部NOT TESTED；持久D1二进制探针的NOT TESTED另列，不塞进冻结608行冒充覆盖。

## 外部保护核验

| 范围 | 文件数 | 新增/缺失/变化 | HEAD/branch/dirty |
| --- | --- | --- | --- |
'''
    for name, row in proof.items(): runs += f'| {name} | {row["files"]} | 0/0/0 | '+('相同' if 'headSame' in row else '原始证据相同')+' |\n'
    runs += '\n固定主工作区、Task26、旧Hotfix、D01/对照/D02/候选/P02与原始日志均保持。没有ADB、手机、真实账户/交易、Production、正式签名、推送、合并、PR或发布。只在P03分支提交。正式App的实际设备状态NOT TESTED，仅能确认本轮没有操作它。最终源码、报告、APK与证据hash由closeout/provenance.json和validation.json封存。\n'
    (DOC / 'CLOSEOUT_TEST_RUNS.md').write_text(runs, encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--check-only', action='store_true'); args = parser.parse_args()
    data = collect()
    if not args.check_only: generate(data)
    print(json.dumps({k: data[0][k] for k in ['status', 'standard_jvm', 'old_p03', 'new_closeout', 'frozen_matrix', 'protected_groups']}, ensure_ascii=False, indent=2))
