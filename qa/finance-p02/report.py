"""Generate the P02 evidence index, metrics and six required reports from real output."""
import collections
import hashlib
import json
import math
from pathlib import Path
import statistics
import subprocess
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'docs/migration-evidence/finance-p02'
DOC=ROOT/'docs/finance-p02'

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def short(value,n=150):
    text=json.dumps(value,ensure_ascii=False,separators=(',',':')) if not isinstance(value,str) else value
    return text.replace('|','/').replace('\n',' ')[:n]
def percentiles(values):
    values=sorted(values)
    if not values:return {'samples':0,'p50_ms':'NOT TESTED','p95_ms':'NOT TESTED'}
    return {'samples':len(values),'p50_ms':statistics.median(values),'p95_ms':values[max(0,math.ceil(len(values)*.95)-1)]}
def load_rows(file):
    return [dict(json.loads(line),evidence=str(file.relative_to(ROOT)).replace('\\','/')+f':{index}') for index,line in enumerate(file.read_text(encoding='utf-8').splitlines(),1) if line.strip()]
def main():
    rows=[]
    # Keep every prior attempt, but select the final run of each unchanged group.
    for group in 'ABCDE':
        directory='preauth-reviewed' if group=='C' else 'currency-booking-final' if group=='D' else 'validated-matrix'
        rows+=load_rows(BASE/f'{directory}/kotlin-{group}.ndjson')
    for filename in ['web-pure.ndjson','web-dom.ndjson','ledger-d1.ndjson','ai-contract.ndjson']:
        rows+=load_rows(BASE/'matrix'/filename)
    for filename in ['process-G-PROCESS-SEED.ndjson','process-G-PROCESS-RESTORE.ndjson']:
        rows+=load_rows(BASE/'matrix'/filename)
    rows+=load_rows(BASE/'validated-matrix/negative-bookings.ndjson')
    timing=json.loads((BASE/'validated-matrix/timing.json').read_text());timing['evidence']='docs/migration-evidence/finance-p02/validated-matrix/timing.json';rows.append(timing)

    # Reuse fresh existing assertions, explicitly without counting a second execution.
    selected={
      'LocalPaymentBookingTest':['pendingReceiptWithKnownMoneyDoesNotCreateALedgerEntry','unverifiedClonePageCannotSettleTheSourceNotification','unprovenLegacyMoneyDoesNotBecomeACompletedPaymentOnReplay','laterSettlementOfSameSourceUpdatesProofWithoutDuplicatingIdentity','laterSettlementPersistsASeparateProofAcrossOutboxRestart','exactArchiveReceiptClosesLegacyRecordEvenWithoutCandidate','ambiguousUploadIdentityWithProvenCompletionKeepsLocalBooking','ambiguousIdentityRequiresOneProvedCanonicalTransactionWithoutRebooking','persistedLocalBookingRemovesAliasedManualReviewWithoutFabricatingReceipt','provenLocalRecoveryBooksOnceAndReceiptSurvivesRestart','concurrentRecoveryCannotCreateTwoTransactions','offlineCaptureReceiptAndReplayKeepOneLedgerAndCloseArchive','ocrCompleteEvidenceAutomaticallyBooksSameEvent'],
      'NotificationDatabaseMigrationTest':None,
      'OfflineNotificationQueueTest':['enqueueIsIdempotentPerOperationAndSurvivesReload','legacyTwoColumnRowsAndNewDeleteRowsRemainCompatible'],
      'PaymentTicketAndStatusTest':['wrongPackageEvidenceIsRejected','duplicateAccessibilityEventsDoNotChangeAConfirmedTicket','terminalRecognitionIsNeverReopened','enrichmentWithoutAmountNeverInventsAValue']}
    reused=0
    for file in sorted((BASE/'existing-junit').glob('TEST-*.xml')):
        suite=ET.parse(file).getroot();name=suite.get('name','').rsplit('.',1)[-1]
        if name not in selected:continue
        for testcase in suite.findall('testcase'):
            method=testcase.get('name');targets=selected[name]
            if targets is not None and method not in targets:continue
            reused+=1;status='FAIL' if testcase.find('failure') is not None or testcase.find('error') is not None else 'NOT_TESTED' if testcase.find('skipped') is not None else 'PASS'
            rows.append({'case_id':f'G-REUSED-{reused:03d}','group':'G','layer':'CURRENT_BASELINE','status':status,
                'fixture':{'class':suite.get('name'),'method':method,'source':'existing synthetic unit fixture in unchanged test source'},
                'expected':'existing identity/queue/migration assertions; exact record counts are in the referenced test body',
                'actual':{'junit':status,'test_time_seconds':testcase.get('time'),'assertion_values_not_separately_exported':True},
                'coverage':'REUSED_FRESH_588_JVM_ASSERTION_NOT_AN_EXTRA_EXECUTION','evidence':str(file.relative_to(ROOT)).replace('\\','/')+'#'+method})
    not_tested=[('NT-DEVICE-SLOTS','实际三星通知 key/profile/槽位行为','禁止真实手机操作'),
      ('NT-MLKIT-PIXELS','真实像素输入与 ML Kit 硬件准确率','本阶段仅固定识别文本的 OCR mock'),
      ('NT-OCR-HW-P50-P95','OCR 硬件 P50/P95','没有真机硬件测量'),
      ('NT-SECURE-WINDOW','系统 FLAG_SECURE 截图失败链','已有 mock engine 异常测试不能替代 OS'),
      ('NT-LOCKSCREEN','真实锁屏/亮屏/后台生命周期','本轮禁止 ADB/手机'),
      ('NT-REAL-CLOUD','真实跨设备/Hosted/Production 回执','仅本地 D1/HTTP handler，没有授权真实账户'),
      ('NT-DOWNGRADE','旧 App/整库回滚','无批准的旧候选/回退夹具；BLOCKED_REQUIRES_PHASE03_APPROVAL，不新增 down migration'),
      ('NT-SERVICE-LATE-CALLBACK','真实 Service 截图异步回调与进程死亡','ticket 假时钟可测，完整回调注入需额外测试缝隙；BLOCKED_REQUIRES_PHASE03_APPROVAL')]
    for case_id,subject,reason in not_tested:rows.append({'case_id':case_id,'group':'BOUNDARY','layer':'TARGET_SPEC','status':'NOT_TESTED','fixture':subject,'expected':reason,'actual':'not executed','coverage':'NO_DEVICE_NO_PRODUCTION','evidence':'docs/finance-p02/TEST_RUNS.md'})
    assert len({r['case_id'] for r in rows})==len(rows)
    for r in rows:r['fixture_sha256']=hashlib.sha256(json.dumps(r.get('fixture',{}),sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    counts=dict(collections.Counter(r['status'] for r in rows));layers={layer:dict(collections.Counter(r['status'] for r in rows if r['layer']==layer)) for layer in ['CURRENT_BASELINE','TARGET_SPEC']}
    direct=[r for r in rows if r['status']!='NOT_TESTED' and not r['coverage'].startswith('REUSED')]
    metrics={};observed=[]
    for r in rows:
        f=r.get('fixture');a=r.get('actual')
        if not isinstance(f,dict) or not isinstance(a,dict) or not f.get('metric_eligible'):continue
        truth=f['expected'].get('amount_minor');stratum=f['stratum'];m=metrics.setdefault(stratum,collections.Counter())
        if truth is None:
            m['negative_samples']+=1;m['safe_rejection' if a.get('amount_minor') is None else 'unexpected_amount']+=1
            continue
        m['positive_truth_samples']+=1;amount=a.get('amount_minor')
        m['no_answer' if amount is None else 'correct' if amount==truth else 'incorrect']+=1
        if f['expected'].get('currency') and a.get('currency') and a['currency']!=f['expected']['currency']:
            m['wrong_currency']+=1
            if a.get('records',0)>0:
                m['wrong_currency_booking_scenarios']+=1
                text=f.get('text','');currency=f['expected']['currency']
                if currency in ['USD','EUR','HKD','GBP','JPY'] and currency in text and not any(unit in text for unit in ['人民币','CNY','RMB']) and a.get('booked_currencies')==['CNY']:
                    m['explicit_single_iso_wrong_currency_bookings']+=1
        if f['expected'].get('direction') and a.get('direction') and a['direction']!=f['expected']['direction']:m['wrong_direction']+=1
        observed.append(r['case_id'])
    for key,value in metrics.items():
        for field in ['correct','incorrect','no_answer','wrong_currency','wrong_direction','wrong_currency_booking_scenarios','explicit_single_iso_wrong_currency_bookings']:value[field]+=0
        value['amount_correct_rate']=value['correct']/value['positive_truth_samples'] if value['positive_truth_samples'] else None
        metrics[key]=dict(value)
    metrics['AI_MOCK_CONTRACT']={'examples_executed':15,'oracle_checks':12,
        'oracle_pass':sum(r.get('contract_self_check')=='PASS' for r in rows),
        'oracle_fail':sum(r.get('contract_self_check')=='FAIL' for r in rows),
        'wire_only':3,'correct':'NOT_TESTED','incorrect':'NOT_TESTED','no_answer':'NOT_TESTED',
        'product_accuracy':'NOT_IMPLEMENTED / NOT_TESTED; mock is not a product parser'}
    booking=collections.Counter()
    for r in direct:
        f=r.get('fixture',{});a=r.get('actual',{})
        if not isinstance(f,dict) or not isinstance(a,dict):continue
        expected=f.get('expected',r.get('expected',{}))
        if isinstance(expected,dict) and 'records' in expected and 'records' in a:
            booking['counted_scenarios']+=1
            if expected['records']==0:booking['negative_booking_controls']+=1
            if expected['records']==0 and a['records']>0:booking['false_booking_scenarios']+=1
            if a['records']<expected['records']:booking['missed_booking_scenarios']+=1
            if a['records']>expected['records']:booking['duplicate_booking_scenarios']+=1
    for field in ['false_booking_scenarios','missed_booking_scenarios','duplicate_booking_scenarios']:booking[field]+=0
    d=[r['actual'] for r in rows if isinstance(r.get('fixture'),dict) and r['fixture'].get('kind')=='parser_currency']
    performance={'parser_host_jvm':percentiles([x['parser_elapsed_ms'] for x in d]),
        'coordinator_room_host_jvm':percentiles([x['coordinator_room_elapsed_ms'] for x in d]),
        'queue_host_jvm':percentiles([x['queue_ms'] for x in timing['samples']]),'booking_host_jvm':percentiles([x['room_ms'] for x in timing['samples']]),
        'ocr_hardware_p50_p95':'NOT TESTED','retry_max_attempts':8,'retry_window_ms':90000}
    summary={'baseline_commit':'1398c76d9321919ac8c94550f2d23c2c8e1a1e84','matrix_rows':len(rows),'statuses':counts,'layers':layers,
      'direct_product_rows':len(direct),'direct_product_statuses':dict(collections.Counter(r['status'] for r in direct)),
      'reused_baseline_rows':reused,'ai_product_not_tested':15,'planned_boundaries_not_tested':len(not_tested),
      'existing_automated':{'JVM':588,'Node':13,'Browser':6,'PASS':607,'FAIL':0,'SKIP':0},'amount_metrics':metrics,'booking_metrics':dict(booking),'performance':performance,
      'groups':{g:dict(collections.Counter(r['status'] for r in rows if r['group']==g)) for g in sorted({r['group'] for r in rows})},
      'ai_contract_self_check_failures':[r['case_id'] for r in rows if r.get('contract_self_check')=='FAIL'],
      'fixture_file_sha256':sha(ROOT/'qa/finance-p02/fixtures/matrix.json')}
    (BASE/'report-results.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
    (BASE/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    proof=json.loads((BASE/'protected-final.comparison.json').read_text(encoding='utf-8'))
    assert all(not p['added'] and not p['missing'] and not p['changed']
               and all(value for key,value in p.items() if key.endswith('Same')) for p in proof.values())
    proof_table='\n| 保护范围 | 文件数 | 新增/丢失/改变 | HEAD/分支/dirty |\n| --- | --- | --- | --- |\n'
    for name,p in proof.items():
        proof_table+=f'| {name} | {p["files"]} | 0/0/0 | '+('全部相同' if 'headSame' in p else '原始证据逐文件相同')+' |\n'
    DOC.mkdir(exist_ok=True)
    header='# FINANCE-P02 基线矩阵\n\n日期：2026-10-19，Asia/Hong_Kong。测试/诊断专用，产品修改 0。\n\n'
    header+=f'基线 `1398c76d9321919ac8c94550f2d23c2c8e1a1e84`，完整继承本地 Hotfix WIP/状态修复/D-01/D-02；不同于远端 PR110 的 e2febc6，也不使用旧 main 覆盖它。\n\n矩阵共 {len(rows)} 个唯一标识，判定 {counts}。其中 {reused} 行复用本轮已执行的 588 JVM，不重复计新增执行；15 行 AI mock 仅验证示例/传输，产品集成 NOT_TESTED；8 行硬件/回滚边界未执行。新增直接产品调用行 {len(direct)}，判定 {summary["direct_product_statuses"]}。\n\n'
    header+='CURRENT_BASELINE FAIL 保留；TARGET_SPEC 断言未满足为 EXPECTED_RED，不是 PASS。5 个矩阵 JUnit 方法按组聚合，失败输出保留；不能把每个动态 fixture 误称独立 JUnit 方法。原始输入/稳定事件 ID/金额/状态、期望和完整 actual/error 在 ignored `report-results.json` 与每行来源 NDJSON。无账本或状态字段的解析/格式层均为 N/A，不假造记录数。\n\n| 组 | 判定数量 |\n| --- | --- |\n'
    for group,stats in summary['groups'].items():header+=f'| {group} | {stats} |\n'
    header+='\n| case_id | 层 | 前态 / 输入序列 | 期望记录/状态/汇总 | 实际 | 判定 | 覆盖 / 原始证据 |\n| --- | --- | --- | --- | --- | --- | --- |\n'
    for r in rows:
        f=r.get('fixture',{});e=f.get('expected',r.get('expected','N/A')) if isinstance(f,dict) else r.get('expected','N/A')
        compact={k:v for k,v in f.items() if k not in ['expected','precondition','source']} if isinstance(f,dict) else f
        a=r.get('actual','undefined / capability absent');a={k:v for k,v in a.items() if k not in ['parsed_events','model_fields']} if isinstance(a,dict) else a
        state='fresh synthetic state'
        if r['case_id'].startswith('G-D1-'):state='shared local D1; preceding G-D1 assertions retained'
        elif r['case_id']=='G-PROCESS-RESTORE':state='prior seed JVM persisted Room/queue; new JVM opens same files'
        elif r['case_id'].startswith('G-REUSED'):state='unchanged test fixture, see original test method'
        elif r['status']=='NOT_TESTED':state='not executed against product'
        header+=f'| {r["case_id"]} | {r["layer"]} | {state}; {short(compact,180)} | {short(e,150)} | {short(a,190)} | **{r["status"]}** | {r["coverage"]}; `{r["evidence"]}` |\n'
    (DOC/'BASELINE_MATRIX.md').write_text(header,encoding='utf-8')
    (DOC/'FIXTURES_AND_GROUND_TRUTH.md').write_text(f'''# Fixtures 与固定真值

日期：2026-10-19。全部为合成资料，无真实账户/短信/银行卡/OTP/支付凭证。

- 主集 `qa/finance-p02/fixtures/matrix.json`：525 项（A416/B26/C8/D24/E39/F12）；SHA-256 `{summary['fixture_file_sha256']}`。
- 另有 JS 23、DOM 4、本地 D1/客户端 11、双 JVM 2、timing 1、实际 coordinator/Room 负样本5，F013–015 和边界方案由测试代码/最终 JSON 保存；既有 G 映射保留原 test class/method 与本轮 JUnit。
- 每项 fixture、expected、actual、结果、日志和标准化 fixture SHA-256 见 `docs/migration-evidence/finance-p02/report-results.json`。所有历史失败在 attempt1、matrix、metrics-rerun、各原始日志中保留，不覆盖为 PASS。

## 输入与真值

A 采用 2 来源×4 间隔（0/5/30/60秒）×同/异槽位×撤销/未撤销×引用/消息/空身份×新 registry/旧实例×同/异正文的 384 个组合，加 24 重放、2 交错和 6 消息身份。时钟是 fake wall clock；“restart”是同一虚拟 App 重新创建 registry，不能称真 Android 进程死亡。主矩阵会实际调用 registry、真实 Room/coordinator，用生成 event ID 入账。输入 payment outcome 的 providerReference 属合成结构化证据，不声称相同正文必然能从真实通知提取不同引用。

B 包括微信+招商包名 cmb.pb 在 0/5分钟/1小时/6小时后相同金额及相同/空引用，均保留来源；另有 1/2 候选与 0/179999/180001/300000/21600000ms 的直接 reconcile。多候选调用仅诊断返回，未接入真实入口。

C 包括 200 USD 授权→170 USD 清算→200 USD 解除、重复清算、金额变化、过期、撤销、部分扣款、退款、缺引用与两授权。本轮最终重跑已真正把合成参考号加入源文本；C008 的两个独立授权分别为 AUTH-A/AUTH-B，结算仅引用 A。初次遗漏参考号和两授权装配错误的结果另存，只用最终记录确认范围。原币/授权证据应保留且不计正式支出；不指定必须新增哪一个数据库列。结构字段探针只作诊断，最终断言针对金额/币种证据与汇总，未实现模型不能假造。

D 精度真值按用户冻结的六币种：JPY 0，其余 2；Intl 格式对照来自本机运行时。历史 2026-10-18 的 USD7/EUR8/HKD0.9/GBP9.5/JPY0.05 与翌日 USD7.2 **全是合成率，不是市场数据**。缺快照应明确未换算；不得从今天率重算旧账。主解析集同时含 USD100/$100/¥100/￥100/JPY1000/无单位及原币/清算/手续费。

E 使用完整文本行集合：698 原价、50 优惠、648 实付、352 余额，以及传统一分转账/18:49/拆符号/缺符号/646误读/冲突/列表/未完成/聊天/OTP。OCR engine 仅返回固定合成识别行（或抛异常）；验证器、二次金额校验、ticket/retry 都是真实产品类。不是 ML Kit 像素识别准确率。90秒边界、8次读取、250ms去抖、窗口复用、后台 cancel 与 overlay 边界都使用假时钟。

F 15 个 mock 示例：12 个响应/授权/白名单例子与3个冲突/可信候选/授权中途撤销线格式示例。没有生产 financial AI adapter，也没有任何付费/远端模型调用。示例不证明真实 opt-in 或脱敏已经实施；F012 的桩决议 accept 与冻结 review 期望不一致保留，产品集成仍 NOT_TESTED。

## 关键真值边界

A009/A011/A201/A203 被 fixture 宣称为两个独立交易，但可观察输入是相同槽位/正文/时间戳且无 message/reference；`new_event_evidence` 是作者意图标记，并非真实来源证明。四个 FAIL 保留，不能升级为“有充分新证据仍吞单”。相同可观察输入无法同时保证区分新交易与旧通知；P03 应先补证据合同，不能靠金额/时间强行一笔或两笔。

双 JVM 测试实际 PID 不同、Room 文件和离线队列从磁盘重开；Robolectric preferences 则显式从合成 JSON 重新灌入新的虚拟 App 目录，不冒充 Android OS 崩溃恢复。所有数据仅位于隔离 worktree 的 ignored 输出/虚拟 cache。
''',encoding='utf-8')

    (DOC/'IDENTITY_REPLAY_RCA.md').write_text('''# 身份与重放可执行归因

## 已证实

1. A 中不同 providerReference 或真实 NotificationMessagingIdentity 产生的不同消息 timestamp/sender/conversation/source 能区分独立事件；同一强身份的更新/撤销重放可复用。messageIdentity 由 source+conversation+sender+message timestamp 哈希生成，不是正文或金额哈希；只改 text 保持 hash，相应实测在 A411–A416。
2. A009/A011/A201/A203 在零间隔、同槽位、先 remove、相同 postTime/正文、空 reference/message 下得到同 event ID、只有1笔而真值要求2。原因是 registry 的 removed grace 分支允许相同 postTime+evidence 复用。它是合成“隐藏真值与可观察输入不足”的复现；没有充分新事件证据，不证明真实三星吞单。
3. 未撤销同槽位完全相同正文/空身份，以及无稳定身份的新 postTime 重发，共20项 TARGET_SPEC 红灯；当前只靠有限信息无法满足所有新交易与重复事件要求。不同间隔并不等于合法身份。
4. B 中跨来源 0/5分钟/1小时/6小时及共享字面 reference 均保留2个独立来源/2笔。referenceHash 含 sourcePackage/channel；不推断跨平台字面引用可直接并账。
5. `PaymentRecognitionCoordinator.reconcile` 缺省3分钟，直接返回 Room `reconciliationCandidates`，DAO 按金额/时间最近排序且 **LIMIT 1**。B 两候选在窗口内仍返回第一项（2 EXPECTED_RED）；不产生 booking 写入。旧 hint 的唯一候选、来源约束是另一条接口，不应混为一谈。
6. Kotlin 全生产目录搜索未发现调用上述 amount/time reconcile 的静态入口；同名 PaymentVerificationState/Center/PendingReviewReconciler 是其它方法。因而只确认一个危险的可调用接口，**未复现经产品入口自动跨源合并账目**。反射/运行时动态调用、真实通知行为 NOT_TESTED。
7. 本地 D1 验证相同 event 三次只1笔、跨设备同 receipt 不变、同额同 fingerprint 不同 event为2笔、同渠道可靠引用复用、跨渠道相同引用独立、引用金额冲突拒绝；直接服务方法不等同系统采集/Hosted。

源码定位（均为未改产品）：`AndroidPaymentNotificationLifecycleRegistry.kt:64` 的 removed grace；`PaymentRecognitionCoordinator.kt:650` 的 amount/time 诊断接口；`store/PaymentDao.kt:137` 起的候选查询及146行 LIMIT 1。包路径均为 `android/app/src/main/java/uk/thewyj/app/task21/`，payment 或 store 子目录。

## 重现

`qa/finance-p02/test.init.gradle` 只添加测试 source；按 TEST_RUNS 执行 FinanceP02MatrixTest。逐条输入、event_ids、records、金额、状态和堆栈在最终 kotlin-A/B.ndjson。跨 JVM 使用 FinanceP02SeedTest 后在另一 Gradle Test worker 运行 FinanceP02RestoreTest；不能在同一个 JVM 运行来冒充重启。

## 未证实与 P03 前置

真实三星的消息槽位/profile/消息时间如何交付没有测试（本轮没有任何 ADB）。没有修改 registry、reconcile 或账本。后续先确认可观测新事件证明、缺失证明时的保守核对策略和跨来源产品政策；不得把 0/5/30 秒阈值或金额当身份。unused reconcile 的移除/收紧也须产品审查，不能只因这次直接调用红灯就猜改正在工作的入口。
''',encoding='utf-8')
    (DOC/'CURRENCY_PREAUTH_GAPS.md').write_text('''# 六币种、汇率、预授权与跨币种汇总缺口

本阶段仅测试，未修改产品/依赖/SQL/迁移。

## 当前模型与新证据

- Android ParsedPaymentMessage/Recognition 有 amount、currency、direction、providerReference 等字段，但没有完整授权冻结→结算→解除的可观察状态合同。SourceParsers 多条路径仍指定 CNY；有金额而币种未知时的用户六币种偏好、currency_review_required 与一次核实提醒没有可调用闭环。
- **明确 ISO 标记也会记为 CNY：**24 个 notification/SMS 固定样本中18个发生币种错误并实际写入隔离 Room，其中12个是明确、单一 USD/EUR/HKD/GBP/JPY 标记（每层6个；排除 `$`、无单位默认和原币+人民币清算混合输入）。这是实际产品 parser/coordinator 的可复现软件风险，不能只归为未来 FX 功能缺失；没有读取或证明真实用户账目已受影响。D 的目标层标记用于保留冻结规格的红灯，不降低这项证据的风险。
- D1 `task16_finance_raw_events` 和 `task16_finance_transactions` **已存在 currency 列**。直接服务测试确实能原样保存 USD/10000，不能声称后端完全没有币种存储，更不能新建平行账本。问题跨解析、决议、精度、汇总与转换追踪，不是单纯加选项。
- JPY formatter 实际除100并强制至少2位；两个 JPY 格式例子红灯。CNY-only汇总与五种两位格式基础调用通过，不代表全产品支持这些货币。
- CNY100+USD100 在真实 summary 函数、预算和分类 DOM 中无转换相加为200；合成 USD7 快照的显示目标为800CNY，或者明确保留分币种/未换算状态，不能无说明地当200CNY。预算/分类初次 harness race/无效短ID失败另存；第二次预算误匹配“剩余800”的假阳性也已保留，最终只读取“已用”字段，CNY控制2通过、mixed目标2红灯。
- 历史日期快照、翌日率改变、离线缺率目标均红灯。率为合成，未选择真实供应商、未请求 FX 网络、未给市场准确率。
- C 八场景均实际调用源解析/coordinator 并保留授权/结算/解除输入及引用。当前行为不能满足冻结/清算金额、无引用不关联、部分扣款/退款的完整目标；8 EXPECTED_RED。没有仅因不产生支出就把“授权未识别”当正确预授权处理。

## 未来最小模型方向（仅建议，不实施）

继续复用现有 event/raw/transaction/receipt、稳定 ID 和 outbox；先定义授权证据、待结算金额、已入账金额及可证明关联。不同授权没有可靠共同身份时保持独立，不能按同额/时间猜。清算、解除与退款各自幂等；授权/解除不计最终消费，结算170只计170。

六币种需要保存原币金额/ISO精度、币种证据/用户默认决议及 review 标志，显示值与原币值分离；汇率快照要包含日期、来源、精确数值/精度、原/目标币种及转换结果/舍入规则。缺历史率明确待换算，不凭空填今天率。不要假定现有 currency 列需要重建；具体增加哪些字段/表、索引和回填方案留待 Phase03/04 审批。

所有迁移必须 additive、保留旧 ID/receipt/outbox/tombstone、不把旧未知完成状态自动升级。现有升级测试只验证既有 migration；新的授权/FX migration 与真实旧 App 降级/回滚 **NOT_TESTED**，本阶段没有创建 SQL。没有授权不得以测试红灯直接开始产品实现。
''',encoding='utf-8')

    files=sorted(p.relative_to(ROOT).as_posix() for p in (ROOT/'qa/finance-p02').rglob('*') if p.is_file() and '__pycache__' not in p.parts)
    (DOC/'ADDED_FILES.md').write_text('# 新增测试/fixtures 路径\n\n'+''.join('- `'+n+'`\n' for n in files)+'\n所有产品文件、依赖与配置均保持基线；原始日志/JSON/JUnit 在 ignored `docs/migration-evidence/finance-p02/`。\n',encoding='utf-8')
    (DOC/'TEST_RUNS.md').write_text(f'''# 执行命令、环境与失败账本

基线 `1398c76d9321919ac8c94550f2d23c2c8e1a1e84`；分支 `codex/finance-p02-tests`，managed worktree `%USERPROFILE%/.codex/worktrees/finance-p02-tests/thewyj.uk`。主工作区 e2febc6、PR110 e2febc6、Task26/PR111 6247c41；远端 main74eadf5。两个PR当前仍 open/draft/unmerged；Core CI 110 failure38690670403、111 success38844323258。本轮只读接口核查，不改 PR/CI，不把 PR 的 mergeable/test merge SHA 当已合并。GitHub 元数据与 ls-remote 不证明 CF Production live状态；**Production live/真实手机均 NOT_TESTED**，遵守用户禁止操作的边界。

已检查 status/branches/worktrees、AGENTS/迁移/暂停报告、历史 Hotfix RCA/phase4 与最近15+Pinned线程；可见唯一活跃 Codex 为当前任务，不声称穷尽全部历史线程。新 P02 授权只解除本阶段测试限制，未启动财务 AI 产品/P03。主工作区新材料目录被保留，实际路径比用户最初给出位置多一层 thewyj.uk。原件 SHA 在 provenance.json，仅读且复制到 ignored。gh CLI不在PATH，已用GitHub只读connector和git ls-remote替代；无需安装gh或改全局配置。

环境：Windows PowerShell，Node24.18.1，Python3.15.0，Android Studio JBR OpenJDK21.0.10，Gradle9.4.1，SDK36；新增Robolectric用API34虚拟Android。没有模拟器/手机/ADB、真实短信/账户/交易、Cloudflare远端操作或付费AI。Miniflare仅本地D1，源码中的 preview URL是Request对象，不是网络请求该地址。npm ci固定原lockfile，仅安装隔离node_modules，未升级依赖。原始 stdout/stderr 在下列路径，非零退出没有隐藏。

| 命令（均从隔离root，Gradle用-p android） | 结果 | 原始证据相对 finance-p02/ |
| --- | --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | PASS，34 packages | npm-ci.log |
| `gradlew :app:testDebugUnitTest --rerun :app:lintDebug` | 588 PASS/0 FAIL/0 SKIP；Lint通过 | existing-android-baseline.log、existing-junit/、existing-lint.xml |
| `node local-backend/test_aeris_state_consistency.mjs` | 13 PASS | existing-node-state.log |
| `node qa/aeris/state-consistency-browser.mjs` | 6 PASS，非手机 | existing-browser-state.log |
| `node local-backend/test_task21_notification_js.mjs` | 脚本PASS，本地隐私/幂等/提示回执 | backend-task21.log |
| `node local-backend/test_task16_d1_js.mjs` | 11组PASS，本地D1 | backend-task16.log |
| `node local-backend/test_task17_d1_js.mjs` | 脚本PASS，本地D1 | backend-task17.log |
| `python qa/finance-p02/generate_fixtures.py` | 主fixture525，匿名固定真值 | fixtures/matrix.json、fixture-generation-final.log |
| `gradlew -I qa/finance-p02/test.init.gradle :app:testDebugUnitTest --tests '*FinanceP02MatrixTest' --tests '*FinanceP02TimingTest' --rerun` | 退出1：7个JUnit方法，矩阵5组失败，含7 CURRENT FAIL和48 EXPECTED_RED；timing及negative方法通过 | validated-matrix.log、validated-matrix-junit/、validated-matrix/*.ndjson |
| 同overlay，`--tests '*FinanceP02MatrixTest.C_preauthorizationTarget' --rerun` | 退出1：复核C008参考号装配后8 EXPECTED_RED | preauth-reviewed.log、preauth-reviewed-junit/、preauth-reviewed/kotlin-C.ndjson |
| 同overlay，`--tests '*FinanceP02MatrixTest.D_parserCurrencyTarget' --rerun` | 退出1：24个D样本6 PASS/18 EXPECTED_RED，额外导出实际booked_currencies/amounts；金额/币种真值未变 | currency-booking-final.log、currency-booking-final-junit/、currency-booking-final/kotlin-D.ndjson |
| 上述overlay分别 `--tests '*FinanceP02SeedTest'`、`--tests '*FinanceP02RestoreTest'` | 2 PASS，两个真实JVM PID | process-seed/restore.log、对应-junit/、matrix/process-*.ndjson |
| `node qa/finance-p02/web-contracts.mjs` | 非零：23行，11 PASS/12 EXPECTED_RED；AI15产品NOT_TESTED，桩决议1项不匹配 | web-contracts-final.log、matrix/web-pure/ai-contract.ndjson |
| `node qa/finance-p02/web-dom.mjs` | 退出1：CNY2 PASS、混币2 EXPECTED_RED | web-dom-final.log、matrix/web-dom.ndjson |
| `node qa/finance-p02/ledger-d1.mjs` | 11 PASS | ledger-d1.log、matrix/ledger-d1.ndjson |
| `python qa/finance-p02/report.py` | 生成索引/度量/报告，不改任何结果为PASS | summary.json、report-results.json |
| `python qa/finance-p02/protection.py docs/migration-evidence/finance-p02/protected-final.json --before docs/migration-evidence/finance-p02/protected-before.json` | 退出0，7工作区和4组原始证据无变化 | protected-final.log、protected-final.comparison.json |
| `python scripts/repository_audit.py` | 退出0，901个tracked/candidate文件检查通过 | repository-audit-final.log |
| `python qa/finance-p02/provenance.py` | 校验仅P02新增路径并保存SHA，禁止覆盖旧索引 | provenance.json |

Overlay还需传 `-Dfinance.p02.root=<隔离root>/qa/finance-p02`、`-Dfinance.p02.output=<全新ignored输出目录>`；PowerShell逐项引用-D参数。精确复验命令和输出保护见qa/finance-p02/README.md。JDK/SDK按WINDOWS_WORKSPACE设置，正式签名环境变量从测试进程移除。第一次seed不要覆盖已有DB；复验使用新输出目录，保留之前样本。513个动态case在5个JUnit聚合方法中执行；另有timing和negative两个方法，不能伪称每个fixture是独立JUnit。复用G行已经包含在588中，不重复执行/计数。

## 所有保留失败/装配纠正

- 原新增矩阵先执行A–E并失败，原 ndjson/JUnit/log 仍在matrix、matrix-junit和attempt1。7基线FAIL和48目标RED都保留，未删用例、改期望或改产品。
- 首次C装配遗漏参考号、初版D parser耗时包含coordinator写入。最终C把合成参考号送入源文本，取消对特定字段命名的实现耦合、验证授权原币证据；D分开测纯parser和Room。重跑保留到metrics-rerun/final-matrix/validated-matrix，8/18目标红灯仍在，并没有为转绿改币种或170/200真值。最后发现C008两个独立授权误用同一参考号，保留fixture-before-two-hold-review.json，改为A/B后仅重跑C8，结果全RED，不重算未变的A/B/D/E。
- B首次未实际遵守restart=false标记；已修QA，使两种registry实例策略真正分别执行并导出registry_recreated。validated-matrix保留最后结果，跨来源2笔结论不变。另加5个真实coordinator/Room负入账控制（待收款、优惠、OTP、无金额、不可信legacy），全部0笔；保留原先无负样本的运行，不能从它推断false-booking=0。
- timing测试首次错误地给Robolectric getApplication加泛型，编译失败保留metrics-cd-compile-failure.log；只修QA API调用，没有动依赖/产品。
- D最后补充实际Room币种导出时，首次命令把方法过滤器拼成D_currencyParserTarget而不是D_parserCurrencyTarget，退出1且零测试；currency-booking-reviewed.log保留，不算执行样本。随后用正确过滤器在新目录currency-booking-final执行24个原样本，实际写入币种可逐条核对，不靠parser字段推断落账值。已归档改导出前的Kotlin源，见validated-sources。
- 首次DOM未等deferred render且用了过短交易ID，另有cleanup API拼写错误；attempt1三行和web-dom-attempt1.log保留。修正合法fixture装配、等原aria-busy完成并用现有公共resetAccount；未延长wait阈值。第二次预算把“剩余800”误当目标“已用800”，其假阳性与测试源保留在attempt2；最终读取small中的已用部分，实际200，mixed预算/分类均RED，未改800真值。
- 初版AI示例对sensitive_fields的期望做过特判；已移除，冻结fixture不变，最终F012桩返回accept而期望review，保留为契约桩不一致。没有据旧特判声称通过，更没有证明生产隐私泄露；AI产品15项全部NOT_TESTED。
- Node提示MODULE_TYPELESS_PACKAGE_JSON，未为消除告警修改package.json；非致命。真实降级/Service callback没有安全测试缝隙，标BLOCKED_REQUIRES_PHASE03_APPROVAL；其它独立测试继续完成。

## 固定真值集指标（仅软件/模拟分层）

金额正确/错误/无答案以所有正金额真值样本为分母，不能丢掉解析失败。无金额的聊天/OTP/余额/列表样本另列negative/safe-rejection，不能冲高金额率。下表不是人群估计或实际银行/ML Kit准确率。

```json
{json.dumps(metrics,ensure_ascii=False,indent=2)}
```

Booking计数只对直接导出records且有真值的场景：`{dict(booking)}`。其中负入账控制5个，实际均0笔；False为0仅代表这些固定控制，不外推用户误记率。Missed含隐含真值但来源证据不足的A场景，不能称真实漏记率；不产生账本的E行不硬填false-booking=0。币种/方向错误按字段样本计，非金融损失统计。notifications和SMS各9个wrong-currency booking中，各6个具有明确单一ISO标记；合计12个排除了符号/偏好歧义及人民币清算混合输入。

性能是当前开发机的monotonic实测，30次queue/Room样本和24次parser；不是手机延迟：

```json
{json.dumps(performance,ensure_ascii=False,indent=2)}
```

OCR硬件P50/P95、真实消息投递、锁屏、跨设备云与回滚均NOT_TESTED，不填估算数字。没有复制GPL/AGPL或其它第三方产品模块；仅复用本项目既有测试辅助与锁定Miniflare库，未创建重复开源名录。

## 隔离和可追溯核验

完整继承：e2febc6 → 94f5177 → 9ff7a7f → f6a2ec7 → 57b622e → 8c0de9c → ff11072 → 1398c76。D-01/D-02维持CLOSED，本阶段没有新证据重新打开；Task26仍CLOSED_WITH_OWNER_WAIVER，其CI通过不改写豁免门禁。

保护脚本为纯文件系统/Git哈希，没有ADB或手机操作。首次protected-before与最终protected-final比较如下；源码/ignored原始证据都保留。候选相对f6a2ec7的Android/JS/Worker/SQL产品差异为0；本次相对1398c76仅新增P02测试与文档，依赖/版本/签名/发布配置不变。
{proof_table}
详细证据：protected-final.comparison.json、protected-final.log；provenance.json收录原材料相同SHA、基线继承、源/fixture/报告/原始证据SHA、JDK/Node/Python版本。原始库只读状态核查不等于验证Production live或手机状态。没有推送、合并、发布、正式签名、正式App迁移；P02没有任何ADB调用。

最终D仅为明确Room落账币种补充诊断输出，性能coordinator_room_host_jvm包含coordinator、Room读写和导出诊断开销；parser_host_jvm单独测量。最后运行包含冷启动/主机调度差异，不删除高耗时样本，不宣称生产SLA。
''',encoding='utf-8')

    handoff=f'''# FINANCE-P02 一页中文交接

**阶段完成，基线红灯保留；只交付测试体系/诊断，不是产品修复完成。停止于P02，等待P03授权。**

基线：`1398c76d9321919ac8c94550f2d23c2c8e1a1e84`，独立 `codex/finance-p02-tests`，未用main覆盖本地Hotfix。PR110/111最新仍draft/open/unmerged，分别e2febc6/6247c41；其CI分别failure/success。主工作区WIP、现有Hotfix和Task26仅只读保护。

本轮新执行原607：607 PASS、0 FAIL、0 SKIP；另有本地后端3脚本PASS。细粒度矩阵{len(rows)}行：{counts}。其中直接产品调用/新执行行{len(direct)}：{summary['direct_product_statuses']}；{reused}行复用607既有JUnit，不重复计执行。AI mock示例15个已构建/执行，但产品集成15项NOT_TESTED；8项真实硬件/云/回滚边界未测。新矩阵JUnit有真实失败（含EXPECTED_RED），不是全绿验收。

已证实：强消息/引用身份与同源重放控制通过；两个候选的amount/time reconcile直接接口仍选第一项但没有写账；跨来源延迟保留2笔；12个明确单一ISO外币标记的合成输入被实际记为CNY，另有6个符号/默认/清算歧义币种红灯；JPY格式、混币月/预算/分类、历史FX与预授权存在目标缺口；传统一分/无符号固定文本有3个语义拒绝FAIL。双JVM Room/队列保留旧ID，真实本地D1三次重放/同receipt只一笔，编辑/删除/恢复/旧响应保护通过；5个明确负入账控制均0笔。

未证实：A零间隔无message/reference的4个FAIL没有充分可观察新事件证明，不能推断真实三星吞单；没有产品入口调用旧reconcile的证据，不能推断真实跨源误并。OCR只是固定文本+mock engine，不是真ML Kit硬件率；AI模块未集成，F012仅测试桩契约不一致，不是生产泄露证明。真实手机、支付、Hosted/Production、模型调用与回滚都未操作。

P03最小建议与前置：先批准新事件证据合同和缺证据核对策略，保护原稳定ID/receipt/outbox；审查未调用的金额/时间匹配接口，不能直接把它当去重规则。对明确ISO却写CNY的动态证据，应先由所有者决定是否提升为阻断或调整修复优先级，最小方向是保留明确币种证据并禁止静默改为CNY，不在本阶段实施。再设计既有账本上的授权/清算/解除关系与additive迁移/回退保护，无可靠共同引用不得自动关联。完整六币种/FX仍属Phase04，OCR语义Phase05，AI授权与真实模型Phase06；如要调整阶段顺序须所有者明确。禁止用红灯授权自动抢跑产品实施。

报告：[逐案矩阵](BASELINE_MATRIX.md)、[fixtures与真值](FIXTURES_AND_GROUND_TRUTH.md)、[身份/重放归因](IDENTITY_REPLAY_RCA.md)、[币种/预授权缺口](CURRENCY_PREAUTH_GAPS.md)、[运行与失败账本](TEST_RUNS.md)、[新增路径清单](ADDED_FILES.md)。原始证据在ignored docs/migration-evidence/finance-p02：[完整机器记录](../migration-evidence/finance-p02/report-results.json)、[度量汇总](../migration-evidence/finance-p02/summary.json)、[SHA与隔离核验](../migration-evidence/finance-p02/provenance.json)。完整输入、期望、actual、堆栈、fixture哈希、环境与复现命令可追溯。

隔离核验：主工作区832、原修复840、Task26 826、D-01 859、D-01对照829、D-02 871、原候选881个文件全部哈希不变；7个工作区HEAD/分支/dirty相同，原始phase3/D01/D02/候选证据140/870/207/366文件不变。产品代码、依赖与版本配置差异0。D-01/D-02保持CLOSED；Task26保留所有者豁免状态。没有ADB、手机、真实支付、远端生产、推送、合并、发布或P03实施。
'''
    (DOC/'PHASE02_HANDOFF.md').write_text(handoff,encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
