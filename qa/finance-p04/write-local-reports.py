"""Write unified reports from sealed current-run identities/results, without changing raw evidence."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib
import json
import subprocess

ROOT=Path(__file__).resolve().parents[2]
LOCAL=ROOT/'docs/migration-evidence/finance-p04/local'
BASE=LOCAL/'final-r2';DELIVERY=BASE/'delivery-v2'
def read(path):return json.loads(path.read_text(encoding='utf-8-sig'))
def rel(path):return path.relative_to(ROOT).as_posix()
def link(path,label):return f'[{label}](../migration-evidence/finance-p04/local/{path})'
def result(value):return ' / '.join(f'{n} {kind}' for kind,n in value.items())
def inline(value):return json.dumps(value,ensure_ascii=False,separators=(',',':')).replace('|','\\|')
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
summary=read(DELIVERY/'summary.json');currency=read(DELIVERY/'currency-18.json');red=read(DELIVERY/'p03-original-26.json')
full=read(DELIVERY/'jvm-current.json');original=read(DELIVERY/'original-607.json');matrix=read(DELIVERY/'contract-608.json')
android=read(BASE/'android-current/command.json');apk=next(row for row in android['artifacts'] if row['path'].endswith('.apk'))
metadata=read(BASE/'android-current/output-metadata.json');protection=read(LOCAL/'protected-pre-report.comparison.json')
assert len(protection)==13 and all(not(r['added']or r['missing']or r['changed'])and all(v for k,v in r.items()if k.endswith('Same'))for r in protection.values())
source='94ab0fc82bc5b21b4f04237ff110574d10da565c'
assert git('diff',source,'--','android','functions','js','cloudflare','sw.js')==''
for commit in ['5d96e1ee5d2064076bd0efa59eed86edb9b1c4cc','dd5fc98b3ac636830a3517e2eae11fad14031b07','3b710e3c7a8c1da4a82ee5fe75221ec4d877ae5a',source]:
    subprocess.run(['git','merge-base','--is-ancestor',commit,'HEAD'],cwd=ROOT,check=True)

table26='\n'.join(f"| `{row['after']['case_id']}` | {row['before']['status']} | **{row['after']['status']}** | 保留原 fixture/expected；金额实值未变，仅新模型字段清单变化不作为修复。 |"for row in red)
oldfail='\n'.join(f"| `{row.get('classname','Chrome')}.{row.get('name',row.get('case_id',''))}` | FAIL | {(row.get('failure',row.get('error','')).splitlines()or [''])[0][:145].replace('|','/')} |"for row in original if row['status']=='FAIL')
allfail='\n'.join(f"| `{row['case_id']}` | FAIL | {'P05 页面/OCR文本语义旧缺口；本轮不开发P05' if row['case_id'].startswith('E') else '旧无币种/CNY前提与P04严格币种门槛冲突' if row['case_id']=='G-REUSED-014' else '缺少独立操作/消息证明；不能根据相似内容决定独立性'} |"for row in matrix if row['status']=='FAIL')
common=f'''本轮仅在 Windows 隔离工作树完成非手机工程；不读取正式交易/聊天/私库，不操作 ADB、手机、正式 App/权限、Production、签名、推送、PR、合并或发布。P05/P06 未开发。D-01/D-02 保持 CLOSED；P03 另一个历史 Activity 异常仍为 INCONCLUSIVE，未用新的通过结果解释其根因。

原 607 的实际结果为 **{result(summary['original607']['counts'])}**（588 JVM 中585 PASS/3 FAIL，13 Node PASS，6 Chrome 中4 PASS/2 FAIL；全部执行，无 NOT_RUN）。标准 JVM **{result(summary['standard_JVM'])}**，其中原681为675 PASS/6 FAIL，P04方法41 PASS（本地新增17，云端原有24，已包含在722中）。这些集合重叠，禁止相加。

原冻结驱动608行 **{result(summary['frozen608'])}**。保留这份原样重放；另以相同原 fixture/expected/oracle、正确传入原声明参数的版本化驱动复核 P04 后，合同608为 **{result(summary['contract608'])}**。两份不是同一个执行结果，不互相覆盖。原 P04 18 项合同 **18 PASS**；原样驱动仍是12 PASS/6 EXPECTED_RED，缺参修复和哈希证明见逐行账本。

本轮完整统计及所有原始错误：{link('final-r2/delivery-v2/summary.json','统计')}、{link('final-r2/delivery-v2/original-607.json','607逐项')}、{link('final-r2/delivery-v2/frozen-608.json','原样608')}、{link('final-r2/delivery-v2/contract-608.json','合同复核608')}、{link('final-r2/delivery-v2/jvm-failures.json','6个JVM失败')}。
'''

prefix=f'''# FINANCE-P03 最终统一报告

## 2026-10-23 本地接管收尾：PARTIAL

**当前授权下可安全独立完成的非手机工程已结束；P03 原合同尚未满足，不具备最终关闭条件。** 没有把 P03 再拆成独立实施/批准节点。所有者授权 P03 非手机收尾后继续完整 P04，已实际实现和回归，P03 的 PARTIAL 没有阻止 P04。

来源链为 `5d96e1e` → P03 收口 `dd5fc98b` → 云端 P04 `3b710e3` → 本地验收产品源码 `{source}`。完整 ZIP/本地 bundle 已恢复并验证；未从 main 套补丁、cherry-pick 或重写历史。原 P03 工作树仍在 `5d96e1e`，保留既有 untracked QA；本报告的最新统一副本随继承 P03 的 P04 分支交付。

{common}

### 实际补完及保护

- 原 P03 预授权/多次部分清算/解除/过期/退款、余额约束、权威修正、ID历史关系、人工优先级和回执控制继续保留；六币种下均补充真实本地 HTTP/D1 合成验证。
- 修复了两个队列对象写同一文件时争抢临时文件的可复现故障：原60操作并发测试抛出 NoSuchFileException，改为同一 canonical 文件共用锁后60条完整保留。
- 修复升级币种协议后旧队列达到拒绝上限而无法恢复：只对明确的 currency_client_upgrade_required 提供一次持久化 capability3 重试；再次失败仍停止，不无限重置。原请求ID、路径和 body 不重写。
- 人工币种确认使用独立、持久化操作，通过原事件的服务端 canonical pending 身份确认，不把旧 ingest 改写成另一笔钱。空200或金额/币种/事件冲突回执均不能删队列；账户、人工决议、生命周期和提供方隔离继续生效。
- 其他新增实现、迁移及六币种/FX的完整清单见 [P04统一报告](../finance-p04/FINANCE_P04_FINAL_REPORT.md)。

### 原26条身份歧义目标

**4 FAIL/22 EXPECTED_RED，原业务金额实值与前次一致。** A系仍缺足以决定“重投还是独立交易”的可信消息/操作证明；C005的相同授权引用下80+90，没有独立Capture ID、revision/前驱证据，不能自行选择170或更正90。原期望17000，实际8000，后续歧义保留。C007原输入无引用，期望17000，实际0；仍是原始真值，没有换成带引用的安全替代样本。旧反射探针 `lifecycle_model_implemented=false` 只是按字段名寻找 authorization 的旧驱动结果，不代表状态机不存在；没有篡改该探针制造PASS。

合法恢复需要提供方/账户作用域、独立操作引用、完成语义、版本及前驱关系与来源证明；现有 TEST-key/本地沙箱只能验证隔离协议，不能产生真实提供方事实。隔离合同不等同完整业务支持。

| Case | 历史状态 | 本轮原样重放 | 处置 |
| --- | --- | --- | --- |
{table26}

完整输入/期望/actual/错误见 {link('final-r2/delivery-v2/p03-original-26.json','原26逐项')}。

### 独立回归、迁移和恢复

| 集合 | 本轮实际结果 | 边界 |
| --- | --- | --- |
| P03原63 | 58 PASS / 4 FAIL / 1 NOT_TESTED | 3个旧无默认币种的身份测试失败；原legacy桥seed失败，restore未启动 |
| 后续41 / 99 / 79 | 各自全PASS | 与标准JVM/其他集合重叠，不累计 |
| 已有新增38 | 38 PASS | 包含5 trace/迁移、15控制、10浏览器、8 TEST-key；不是提供方真凭证 |
| 原legacy桥 | seed FAIL / restore NOT_TESTED | 期望3笔、缺明确CNY上下文后只有1笔；原消息/断言保留 |
| 独立明确CNY账户的legacy桥 | 两JVM PASS，9个HTTP请求 | 原通知/金额/断言不变，但新增显式账户币种前提，不能替换原失败 |
| clearing/correction/unified桥 | 两JVM均PASS；15/34/35请求 | 本地HTTP和真实Miniflare D1；提交成功丢回执、恢复、幂等均验证 |
| Native四组件冷恢复 | 两独立JVM PASS | Room16、FX/人工决议库1、五列Outbox、仅币种SharedPreferences；缺件/错账户/校验失败关闭 |
| 本地D1物理副本恢复 | 自动短运行目录PASS，105表 | 长路径FAIL原样保存，同脚本/同快照A/B定位QA路径问题；非Production备份 |
| Lint / Debug | 0 Error/Fatal；86 Warning/12 Hint；Debug成功 | Gradle整组exit1来自保留的6个单测FAIL，`--continue`独立完成Lint/构建 |

完整命令见 [Windows验证入口](../finance-p04/VALIDATION_COMMANDS.md)。四组件备份是实际合成文件格式/冷读取验证，**真实个人备份、正式App原地升级与Production恢复均NOT_TESTED**。不能用Git回退代替数据库回退；不支持把升级后主库或新Outbox喂给旧APK。只允许同/更高兼容版本恢复完整一致备份；恢复旧快照若会丢失升级后账目必须阻断。

### 仍未通过的原回归

以下均保留FAIL，不为了原人民币默认行为破坏P04“无可信币种不得猜CNY”的约束。旧bank提醒的缺字段数组现在多出currency，也不删断言。

| 原607身份 | 状态 | 真实错误（首行） |
| --- | --- | --- |
{oldfail}

冻结合同8个FAIL逐项如下；E004/E007/E008属于前序已声明的P05文本语义缺口，本轮未进入P05。新增 `G-REUSED-014` 是原无CNY上下文的离线记账用例，不隐藏成旧结果。

| Case | 状态 | 边界 |
| --- | --- | --- |
{allfail}

### 保护、剩余条件和停止

13组保护（主工作区、Hotfix、Task26、D01控制/证据、D02、候选、P02等）逐文件无新增/删除/变更，HEAD/分支/状态一致；原P03树tracked干净、HEAD仍5d96e1e。没有把 Task26 waiver 标成PASS。最终核验随交付[REVISION](../migration-evidence/finance-p04/local/final-r2/REVISION.json)及[provenance](../migration-evidence/finance-p04/local/final-r2/provenance.json)记录。

关闭仍需：①合法提供方的独立事件/版本/前驱事实或所有者明确接受隔离边界；②所有者解决旧无币种冻结验收与P04新约束的冲突，不能由工程师偷偷改输入/断言；③以后单独授权的真实通知/RC-6/云链/微信业务及正式备份验收。真实MainActivity、锁屏/后台、正式三页面及原Activity故障现场本轮均NOT_TESTED。D-01/D-02 CLOSED不等于整个Hotfix PASS。

本轮停止，不进入P05/P06，不推送、合并、签名、发布或操作手机。

---

## 历史报告原文（只作历史依据，不计本轮PASS）

'''
history=subprocess.check_output(['git','show','3b710e3:docs/finance-p03/FINANCE_P03_FINAL_REPORT.md'],cwd=ROOT).decode('utf8')
(ROOT/'docs/finance-p03/FINANCE_P03_FINAL_REPORT.md').write_text(prefix+history,encoding='utf8')

ledger='''# P04 原18项合同逐行账本

2026-10-23：当前合同 **18 PASS**；冻结原驱动原样执行仍 **12 PASS/6 EXPECTED_RED**。两种执行同时保留。

版本化驱动只补上原fixture声明但未转发的default_currency（当前policy2）与synthetic_rate=7/date（protocol2及真实产品FX/D1引用）。原fixture字节/哈希、checkExpected、DOM的/800/和/200/断言均不变；没有按金额/商户猜测，不把拒绝当成功。原D驱动的snake_case反射探针不是FO6业务值；FO6由真实持久化/回执/通知测试独立验证。

| Case | 原期望 | 原样驱动 | 当前合同执行 | 当前实际 | 说明 |
| --- | --- | --- | --- | --- | --- |
'''
for row in currency:
    a=row['after'];actual=a.get('actual')
    if isinstance(actual,dict):actual={k:v for k,v in actual.items()if k in ['currency','amount_minor','direction','records','booked_currencies','booked_amounts_minor']}
    ledger+=f"| `{row['case_id']}` | `{inline(row['before'].get('fixture',{}).get('expected',row['before'].get('expected')))}` | {row['frozen_after']['status']} | **{a['status']}** | `{inline(actual)}` | {'原声明参数经版本化驱动传入' if row['frozen_after']['status']!='PASS' else '原驱动已直接验证通过'} |\n"
ledger+='\n输入/断言未改的证明：[adaptations.json](../migration-evidence/finance-p04/local/contract-input-drivers/adaptations.json)。全输入、before/after和错误：[currency-18.json](../migration-evidence/finance-p04/local/final-r2/delivery-v2/currency-18.json)。未覆盖或真实业务不可验证的项目仍见统一报告NOT_TESTED，不能据18项通过宣布整体COMPLETE。\n'
(ROOT/'docs/finance-p04/CURRENCY_18_LEDGER.md').write_text(ledger,encoding='utf8')

files=set(git('diff','--name-only','5d96e1e',source).splitlines())|set(git('diff','--name-only').splitlines())|set(git('ls-files','--others','--exclude-standard').splitlines())
files|={'docs/finance-p04/FINANCE_P04_FINAL_REPORT.md','docs/finance-p04/VALIDATION_COMMANDS.md','docs/finance-p04/CURRENCY_18_LEDGER.md'}
filelist='\n'.join('- `'+name+'`'for name in sorted(files)if name)
prooflinks='\n'.join(f"| {name} | {result(data['counts']) if 'counts'in data else str(data['result']['PASS'])+' PASS'} | {link(data['evidence'].split('/local/',1)[1],'证据')} |"for name,data in summary['p04'].items())
p04=f'''# FINANCE-P04 统一最终报告

2026-10-23，Asia/Hong_Kong。**P04 = PARTIAL；本轮授权的非手机实现、修复和验证已完成并本地交付。** 原18项业务合同已验证18 PASS；原607仍602 PASS/5 FAIL，P03原26仍4 FAIL/22 EXPECTED_RED，不能宣布整体COMPLETE。没有以合成数据替代真实交易验收。

## 来源和执行边界

本地接回云端完整代码/证据后执行，云端没有继续接收开发任务。隔离工作树 `C:\\Users\\78252\\.codex\\worktrees\\finance-p04-multicurrency\\thewyj.uk`，分支`codex/finance-p04-multicurrency`。继承`5d96e1e → dd5fc98b → 3b710e3 → 1abeba2 → 02cc8e3 → 70ee5a3 → 1979fcb → {source}`。产品验收源码SHA为 `{source}`；后续仅QA路径/报告提交由REVISION.json固定，避免文档自引用。P03仍统一于[同一份报告](../finance-p03/FINANCE_P03_FINAL_REPORT.md)。

完整handoff ZIP SHA-256 `b18fad4b0d6be6582272360d1c01ad79e2fed9bcb9ff8f5f7e53450785813294`，增量bundle SHA-256 `171a0f42cecc8b1dcef1df11871da686c097116bb4f56f90f85be7dd561848bc`。已验证87源码blob与1888证据副本，CRLF差异不当作产品差异。旧Windows检查点和P01/P02历史结论不改。原始JUnit身份另从Windows受保护P03旧目录只读核对，历史PASS不计新通过。

{common}

## 已实现的六币种与资金合同

| 币种 | ISO小数位 | 持久化/精确计算/API/Web/Android |
| --- | --- | --- |
| CNY/USD/EUR/HKD/GBP | 2 | 全部已实现；各币种支出/收入/退款及清算经合成服务/D1验证 |
| JPY | 0 | 明确零位；JPY整数不除100，过精度拒绝/保留待核实；旧未证单位不擅自重标 |

每笔保留原ID、时间、来源、引用、原始金额与币种；交易/账户/展示币种及可空的识别默认币种分开。跨币种不直接累加，参考折算不改原账。JS用BigInt有理数，Kotlin用Long最小单位/BigDecimal换算；统一HALF_EVEN，只在最终目标单位舍入。输入严格精度，溢出/未知币种/缺金额/错误小数/科学计数等失败关闭，不默认为人民币。单笔业务上限沿用1e13最小单位；负值/退款/冲正的换算按精确规则，账务方向与金额绝对值分离。

原币/清算/费用角色分别保存，不把授权或参考FX记成支出；多次Capture、部分清算、解除/过期、退款及剩余冻结按P03来源/版本合同处理，同币种内核算净支出与冻结。新币种/展示设置不能构造独立交易身份、清除P03待核实或绕过提供方证明。旧请求、人工修改、原账ID、关系、Outbox和回执控制保持。

本地新增修复：

1. Android hook的policy2不再取决于是否注入Room store；无账户结果不猜CNY。对可信已归属引用的重投冻结原币种决议，偏好变化不另生成记录；不把引用或币种当作独立Capture证明。
2. 默认币种只是账户决议，不冒充通知中的ISO证据。持久化`currency_review_required/decision_source`，可靠支付可先入账并非阻塞提醒；通知拒绝不消耗提醒，成功后重复/重启不再提醒。人工明确编辑和精确当前回执清除标记，旧账户/旧epoch不能覆盖新状态。
3. 仍可调用的raw_event.ingest改走精确金额/币种路径：修复缺币种猜CNY、USD多位小数截断、JPY整数不能使用的问题；有默认时记录来源，无默认时保留未知/待核实。金额恢复仍需原完成语义，不把预计收入、退款申请当实付。旧纯函数兼容默认1只用于冻结/历史调用，实际写入路径固定policy2。
4. Web未知币种编辑器要求显式选择并重新输入金额，源事件不改；Android用独立持久化`/api/notification/review/confirm`命令确认canonical原事件，不重写旧ingest。已确认后旧命令与新人工金额冲突时409，不能覆盖或另入账；提供方语义/预授权门槛不因选币种放松。
5. 同一文件的多个队列实例共用锁；60并发操作完整保留。旧协议拒绝到上限可持久化地仅重试一次capability3，仍拒绝则停止；五列格式、原body/ID不改。空200/错金额/错币种/错事件不能吞掉货币确认请求。

## FX提供方、缓存和历史

采用公开合法、无key的Frankfurter v2 daily reference适配器，接口`/v2/rate/{{base}}/{{quote}}?date=YYYY-MM-DD`；来源是市场参考，**不是银行/支付通道成交汇率**。源码保存精确十进制lexeme，验证币种对、类型、日期、正数及范围；参考日期按交易UTC日，允许此前营业日最多7日。保存base/quote/rate/source/rate_timestamp/fetched_at/expires_at/rounding与完整性hash，不重复覆盖交易事实。

当前缓存6小时、同pair/date并发去重、完整性验证、安全更新、离线读取、历史引用按交易ID/revision/展示币种冻结。来源更新不修改旧引用，也不触发第二笔财务同步。同币种/正反向/交叉换算、负数/零/大小额/非法率和日期边界已有独立回归。缺失/过期且无法合法获取时明确不可用；不造1:1。Worker正文按64KiB流式限额及严格UTF-8，保留原8秒请求/7秒批次上限，未延长超时。12项公开提供方实读通过，另22项模拟缓存/错误/边界通过；合成率7等明确market_data=false，不当作真实行情或支付凭证。

## Web及Android适配

| 表面 | 已实施与覆盖 |
| --- | --- |
| 财务首页/余额/收支/月份 | 统一原币或明确参考折算；不可换算部分分币保留 |
| 历史/详情/退款与冲正 | 原币/金额/关系保留，显示参考与来源，不重写ID和原事件 |
| 分类/预算/剩余 | 币种分组和引用一致；缺汇率不显示虚假完整剩余；默认/展示变更失效缓存 |
| 手工新增/修改 | 六币种选择、JPY零位、严格精度；人工优先及CAS仍有效 |
| 待核实 | 未知币种不预选CNY、不预填未证单位；显式选择后重输金额；默认决议提醒可稍后更正 |
| 同步/离线/缓存 | 原Outbox优先保留；FX配额清理不丢财务重放；过期/缺FX有明确提示 |
| Service Worker | shell命名空间finance-money-v3，精度模块仍money_version2，传输capability3；旧缓存更新已由真实Chrome验证 |
| Android原生链 | Kotlin金额模型、Room、Repo、通知/手工/离线队列、原币显示、UI线程与生命周期保护回归；真实手机/UI/锁屏行为NOT_TESTED |

## 增量迁移、兼容与可执行恢复边界

Room主库14→15保留旧单位事实，旧JPY为未证；15→16仅新增3个决议/通知字段，旧行默认false/空，不把历史人民币改币或再生成账。FX/人工币种决议库为新独立v1，**含不可丢的manual decisions/source units/default preferences，不能把它当纯可删缓存**。旧实体升级、全链、事务中断回滚/重试、重复打开、原ID/金额/时间/人工修改/回执/Outbox均验证。旧v14/v15 opener对16拒绝降级，没有清库。

D1用0031/0032/0033增量；当前Task16元数据5、Task21为9。0033只新增决议列并重建有效视图，不删表/重算旧账。12项前迁移/回执/恢复及8项新决议迁移全部通过，涵盖部分失败、重复DDL、旧服务器拒绝新库、精确老回执、新旧协议、完整逻辑恢复和独立SQLite重开。旧客户端不能静默读取外币/丢弃待核实标记；新服务仍可重放已验证旧body，未证JPY不自动缩放。

实际跨两JVM恢复四个合成组件：主库16、FX/人工决议库1、五列Outbox、仅币种偏好SharedPreferences。先停止写入并关闭两库、等待队列和偏好落盘，再保存**同一账户/同一时点/版本+四文件SHA清单**，恢复前拒绝缺件、错账户或校验失败。两个JVM分别PID{summary['backup']['seed_pid']}/{summary['backup']['restore_pid']}，冷读取恢复决议/默认币种/原始未知值/历史引用与精确队列。凭据不在这四件中，恢复后另正常登录。

**Git回退不是数据库回退。** 只支持完整一致备份在同/更高兼容版本恢复；升级后有新账/新队列时禁止以旧快照配旧APK“回退”，也禁止清库、丢账或重建用户数据。服务端必须先完成隔离验证的5/9迁移及capability3接口，再考虑客户端放行；Production迁移/备份/部署和真正个人备份均NOT_TESTED、没有授权。本地Miniflare物理目录恢复与Production Time Travel不是一回事。

Windows QA另有已确认路径兼容问题：同脚本SHA/同105表快照SHA，253字符SQLite路径失败，217字符短路径通过；具体journal的MAX_PATH调用机制未取得Win32栈，标PROBABLE。框架现自动避开预计journal>=260的Windows运行目录，默认命令恢复/二进制复制/重开105表通过；初始失败与强制长路径FAIL、3次短路径PASS均保存。没有提高timeout、关FK或改数据/断言，也不把它归为Android/Samsung故障。

## 本轮实际回归

| 集合 | 数量与结果 | 证据 |
| --- | --- | --- |
{prooflinks}

标准722、原607、原681及P03重叠集结果见上文与P03统一报告。219为216个Decimal向量加3个边界检查，向量也在JVM方法内执行，不与方法数相加。Node34个脚本整组退出1的原因为原aeris-dom、旧无capability的Task21、P02原web/DOM目标红；其他独立脚本继续执行。只加capability3、不改原输入/221行断言的Task21独立重放全通过，不能覆盖原旧协议FAIL。

Lint **0 Error/Fatal、86 Warning/12 Hint**；比云端76 Warning多出的10项均为依赖/SDK新版本提示，锁定依赖未改。Debug已实际构建（全组`--continue`），applicationId `{metadata['applicationId']}`，version {metadata['elements'][0]['versionName']}/{metadata['elements'][0]['versionCode']}；未安装。APK `{apk['bytes']}` bytes，SHA-256 **`{apk['sha256']}`**，见 {link('final-r2/android-current/command.json','完整构建记录')}。npm lock SHA `75f023a2e4a47d248d3246e1b3c7e4a86ab7e5739b105b37ca8320021a1fdeb3`；Node22.23.3、JDK21.0.10、SDK36/BuildTools36、Gradle9.4.1，未升级产品依赖。

原18逐行输入/预期/故障/当前实际与责任见 [逐行账本](CURRENCY_18_LEDGER.md)。原26 P03业务目标仍红；E004/E007/E008是P05“已被合成用户领取/无符号0.01”旧文本语义故障，不伪装成金额引擎或新P04修复；`G-REUSED-014`新增FAIL及原607五FAIL明确保留。金额引擎能表示最小单位，不代表未获完成/币种证明的页面必须自动入账。

## 保护、残留和剩余授权

13组保护全部无变更（最终重复核验/完整哈希随provenance）。主工作区仍e2febc6的旧Hotfix分支及原dirty状态，Task26 waiver、Hotfix、D01/D02、P02原证据/材料和正式APK文件均保持；原P03工作树仍5d96e1e，未操作其tracked内容。正式设备/生产数据本身未读取，内容“完全没变”不能冒充已验证。

保留所有raw、失败/控制组、SQLite/物理副本、APK、源/证据SHA、原ZIP/bundle、必要夹具。build/node_modules为可重建本地缓存；三个人工隔离Chrome测试profile还在用户Temp中：删除被自动审批审查以“blocked by policy”拒绝，未给具体理由，未尝试其他删除方式；详见 {link('final-r2/profile-cleanup-blocked.json','残留清单')}。没有删除手机文件或恢复正式监听。

尚需所有者最少处置：合法真实提供方独立操作/账户/版本/前驱证明；决定旧无币种冻结验收前提与P04新安全合同的冲突；以后单独授权真实通知/无障碍、RC-6、真实云持久化/幂等、真实MainActivity/三页面/后台锁屏、微信W01–W10及个人备份验证。所有这些真实业务项 **NOT_TESTED**；本轮没有自动支付/消息/无关聊天读取或生产财务写入。P03/P04均不具备整体COMPLETE关闭条件，停止等待所有者审核，不进入P05/P06。

## 修改文件与提交

以下为相对P03原5d96e1e的继承变更及本轮QA/报告文件；产品源码固定94ab0fc，最终本地QA/报告提交见[REVISION](../migration-evidence/finance-p04/local/final-r2/REVISION.json)及[完整SHA封存](../migration-evidence/finance-p04/local/final-r2/provenance.json)。未修改主工作区/Task26，没有push、PR、merge或发布。

{filelist}
'''
(ROOT/'docs/finance-p04/FINANCE_P04_FINAL_REPORT.md').write_text(p04,encoding='utf8')

commands='''# P03/P04 Windows 当前命令与证据索引

2026-10-23。工作目录为隔离finance-p04-multicurrency工作树；全部D1/账户/备份为自建合成。旧cloud命令不计本轮通过。当前完整argv、UTC起止/退出码、Source-lock和JUnit分别在final-r2/android-current/command.json、regression/{node,jvm}-commands.json、extra-native-commands.json及各目录。

```powershell
$env:JAVA_HOME='C:\\Program Files\\Android\\Android Studio\\jbr'
$env:ANDROID_HOME='C:\\Users\\78252\\AppData\\Local\\Android\\Sdk'
$env:FINANCE_NODE='C:\\Users\\78252\\AppData\\Local\\npm-cache\\_npx\\d18f28baf1132559\\node_modules\\node\\bin\\node.exe'
$env:PATH=(Split-Path $env:FINANCE_NODE)+';'+$env:PATH
$env:AERIS_TEST_CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
# 每次选新目录，脚本拒绝覆盖原结果；以下final-r2是本轮已执行路径。
$env:FINANCE_P04_OUTPUT=Join-Path (Get-Location) 'docs/migration-evidence/finance-p04/local/final-r2/android-current'
python qa/finance-p04/android.py
$env:FINANCE_REGRESSION_OUTPUT=Join-Path (Get-Location) 'docs/migration-evidence/finance-p04/local/final-r2/regression'
$env:FINANCE_NODE_WORKERS='3'
python qa/finance-p04/run-regression-node.py
$env:FINANCE_TRACE_ROOT=Join-Path (Get-Location) 'docs/migration-evidence/finance-p04/local/trace-current-source'
python qa/finance-p04/run-regression-jvm.py
```

Android实际调用锁定gradlew.bat：`:app:testDebugUnitTest :app:lintDebug :app:assembleDebug --continue --rerun-tasks --no-daemon --max-workers=2 --console=plain --stacktrace -PTHEWYJ_BASE_URL=https://isolated-finance.invalid`。无ADB/模拟器/安装/release任务。原607与681按已封存身份映射选择**当前JUnit**，另只读核对原Windows旧JUnit身份，没有把历史PASS加入当前数据。

版本化合同驱动：`python qa/finance-p04/prepare-contract-drivers.py`（FINANCE_CONTRACT_ROOT、FINANCE_PRIMARY_DOM指向原输入/新目录），随后执行该目录web-dom-declared-inputs.mjs。它用原声明的非市场率7/date进入真实FX/D1创建引用，原断言/fixture没变；Native driver仅转发default_currency+policy2，checkExpected未改。原样执行仍另行保留。

`python qa/finance-p04/prepare-backup-proof.py` 创建四组件seed/restore源码（在ignored目录）；`python qa/finance-p04/extra-native.py` 串行运行声明输入D矩阵及两JVM冷恢复。Root/output/源码hash/完整gradle命令分别保存，未读取或操作正式私库。`python qa/finance-p04/upgraded-legacy-http.py task21` 只修改导入路径和capability3请求头，保留原221行断言。

四桥全部命令见regression/jvm-commands.json；原legacy seed失败后restore未执行，单独FINANCE_P03_COMPAT_ROOT加显式合成CNY偏好的derived-current-client桥9请求通过，不替换原结果。projection使用`node --import ./qa/finance-p04/fresh-inputs.mjs qa/finance-p03/finish/projections.mjs`，输入本轮resolution/cases。

本地物理恢复：`node qa/finance-p03/nonphone/native-persist.mjs`，FINANCE_REGRESSION_OUTPUT/FINANCE_D1_BRIDGE_INPUT指向本轮unified bridge快照。试验输出native-persist(FAIL)、native-control(同版长路径FAIL)、native-persist-short/native-short-b(短路径PASS)、native-persist-auto(新默认自动短路径PASS)。只有QA运行目录不同；同源码/同快照哈希控制组保存。该默认路径修复后无需改数据或延长超时。不要复用旧目录。

汇总：`python qa/finance-p04/collect-local.py`；输出新delivery-v2，保留先前collector路径/缺历史副本问题与原始delivery。原历史JUnit原件在受保护Windows P03树；云端包中个别旧路径缺失时只用封存JSON身份，不借历史状态，且已与Windows原身份相等核对。

保护：`python qa/finance-p03/protection.py <new-output.json> --before docs/migration-evidence/finance-p04/local/protected-before.json`。执行前脚本明确排除并断言不读取根访问口令。最终同样重复校验；Git状态与13组文件hash详见provenance。npm/Python/JDK/SDK准备只在本地依赖/ignored QA目录，不升级产品锁、不使用Production凭据。

所有失败/重试均在独立目录。原始源码/预期/样本未删除，测试集合重叠不累计；真实设备/业务/Production/个人备份NOT_TESTED。

封存采用`python qa/finance-p04/seal-local-delivery.py precommit`，本地Git提交并完成最后13组保护核验后执行`python qa/finance-p04/seal-local-delivery.py postcommit`。脚本独占创建封存文件，核对统计、继承、锁文件、APK、报告链接和QA/报告源码，既有raw不改；最终提交和完整文件SHA索引见[REVISION](../migration-evidence/finance-p04/local/final-r2/REVISION.json)及[provenance](../migration-evidence/finance-p04/local/final-r2/provenance.json)。
'''
(ROOT/'docs/finance-p04/VALIDATION_COMMANDS.md').write_text(commands,encoding='utf8')
(DELIVERY/'contract-failure-ledger.json').write_text(json.dumps([row for row in matrix if row['status']!='PASS'],ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'P03':'PARTIAL','P04':'PARTIAL','original607':summary['original607']['counts'],'currency18':summary['currency18'],'reports_written':4},ensure_ascii=False))
