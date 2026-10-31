"""Produce the three reports from current evidence; never turn missing gates green."""
from pathlib import Path
from datetime import datetime,timezone,timedelta
from collections import Counter
from decimal import Decimal
import hashlib,json,statistics,subprocess
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p06';FULL=ROOT/'docs/migration-evidence/finance-p04/p06-validation/final-r3'
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def counts(rows):return dict(Counter(r['status'] for r in rows))
def short(value):return ' / '.join(f'{n} {k}' for k,n in value.items()) or 'NOT_TESTED'
def table(headers,rows):return '\n'.join(['| '+' | '.join(headers)+' |','| '+' | '.join(['---']*len(headers))+' |',*['| '+' | '.join(str(x).replace('\n',' ') for x in row)+' |' for row in rows]])
def relative(p):return p.relative_to(ROOT).as_posix()
def link(p):return f'[{p.name}](../{p.relative_to(ROOT/"docs").as_posix()})'
summary=read(FULL/'delivery-current/summary.json');android=read(FULL/'android-current/command.json');assert android['source_stable']
assert read(E/'source-binding.json')['status']=='PASS'
protected=read(E/'protected-final.comparison.json');assert len(protected)==13 and all(not r['added'] and not r['missing'] and not r['changed'] and all(v for k,v in r.items() if k.endswith('Same')) for r in protected.values())
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip();date=datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%d')
ai=[r for r in android['cases'] if r['classname']=='uk.thewyj.app.finance.FinanceAiTest'];b=[r for r in android['cases'] if r['classname'].endswith('FinanceP06DeviceOcrRegressionTest')]
assert len(ai)==23 and len(b)==7 and counts(ai)=={'PASS':23} and counts(b)=={'PASS':7}
device=read(E/'joint-r8/result.json');emu=read(E/'emulator-joint-r3/result.json');assert device['status']==emu['status']=='PASS'
supp=E/'supplementary-r1';supplementary={name:counts(read(supp/name/file)['rows']) for name,file in [('roles','contracts.json'),('recovery','result.json'),('migration','result.json'),('chrome','result.json')]}
supplementary['ai-contracts']=counts(read(supp/'ai-contracts/contracts.json')['rows'])
provider=[];calls=[]
for folder in sorted((E/'provider').glob('live-r*'),key=lambda p:int(p.name[6:])):
 if not (folder/'calls.json').exists():continue
 batch=read(folder/'calls.json');calls.extend(dict(c,run=folder.name) for c in batch)
 result=read(folder/'result.json') if (folder/'result.json').exists() else {}
 provider.append({'run':folder.name,'calls':len(batch),'status':result.get('status','DIAGNOSTIC'),'rows':result.get('rows',[]),'diagnostic':folder.name in ['live-r3','live-r4'],'model':result.get('model',batch[0].get('model') if batch else None)})
assert len(calls)==15
usage=[];durations=[]
for c in calls:
 u=c.get('provider_usage') or c.get('usage')
 if u:usage.append(u)
 ms=c.get('duration_ms')
 if ms is None and c.get('started_utc') and c.get('finished_utc'):ms=round((datetime.fromisoformat(c['finished_utc'].replace('Z','+00:00'))-datetime.fromisoformat(c['started_utc'].replace('Z','+00:00'))).total_seconds()*1000)
 if ms is not None:durations.append(ms)
usage_keys=Counter(k for u in usage for k in u)
token_totals={k:sum(u[k] for u in usage if isinstance(u.get(k),int)) for k in ['prompt_tokens','completion_tokens','total_tokens']}
neurons={k:str(sum((Decimal(str(u[k])) for u in usage if isinstance(u.get(k),(int,float))),Decimal(0))) for k in usage_keys if 'neuron' in k}
metrics={'binding_invocations_started':15,'model_outputs_returned':12,'invocation_errors_without_output':3,'usage_reports_present':len(usage),'tokens_reported':token_totals,'neuron_fields_reported':neurons,'observed_call_latency_ms':{'samples':len(durations),'min':min(durations),'median':statistics.median(durations),'max':max(durations)},'actual_billed_cost':None,'billing_status':'NOT_TESTED','provider_runs':provider}
(E/'provider/aggregate.json').write_text(json.dumps(metrics,indent=2))
original_failures=read(FULL/'delivery-current/jvm-failures.json');assert len(original_failures)==6
failure_table=table(['类 / 方法','最终结果'],[(r['classname'].split('.')[-1]+'.'+r['name'],'FAIL') for r in original_failures])
base='docs/migration-evidence/finance-p06/';full=relative(FULL)
common=f'''本轮仅开发、隔离测试及本地提交。项目 Production D1/R2/Pages、共享 Preview、既有独立 P04 Preview 均未修改；没有 push、merge、PR、正式签名或发布。真实 Workers AI 调用仅使用脱敏合成字段，独立于项目正式财务环境。

起始封存 `425776f086d5a2b9165f9b9de311826a8d218f9e`。工作树 `%USERPROFILE%/.codex/worktrees/finance-p04-multicurrency/thewyj.uk`，分支 `codex/finance-p06-ai`。产品修复提交 `a57ce56e7045167389ebbf7726c49fd043c5c7a7` 与 AI 实施 `07e54f94ea633661f95a8ad3a6ab8e88028fdc07` 分开；后续源绑定修复 `56f5c4921896f540ac0c4b167c26c1a676a00889`、原生授权/并发策略修复 `878f135dfca4d5d100aca65e18c1da7c3d8b3e10` 均保留。最终文档提交由 `finance-p06/FINAL_PROVENANCE.json` 绑定，避免报告包含自身 SHA 的循环引用。
'''
device_report=f'''# FINANCE P03/P04/P05 Samsung 联合验收报告

{date}，Asia/Hong_Kong。**P03/P04/P05 = PARTIAL；D-01/D-02 保持 CLOSED。**

{common}
## 设备与隔离

Samsung SM-S9360，Android16/API36，序列号仅公开尾号 EHJN。原系统指纹及完整命令保留在 `{base}device/baseline/`。现有 user0、95、150 未变；主微信 UID10390、分身 UID9510390，用户150未发现微信。本轮未建立手机工作分区。

正式 App 保持1.3.37/code50，APK SHA256 `9a4fad7f01c1dd1013efbcabd3931ea6c698b52dc2d2ce10cd18745ad7d7f55a`，初始公开APK签名验证 PASS，证书 SHA256 `2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03`；收尾 APK 哈希相同。正式私有数据库未读取，不能宣称取得了其字节级哈希。

仅使用 `uk.thewyj.app.qa.financep06` / `.test`，未覆盖正式或旧QA包。正式无障碍服务按既有所有者授权暂时暂停一次，取证后恢复原列表；正式通知监听在本轮基线已关闭，保持关闭。QA未申请通知读取或无障碍敏感授权，SDK/流水线通过隔离组件测试运行，不能冒充真实OS通知采集。

## Samsung OCR与生命周期

| 轮次 | 结果与边界 |
| --- | --- |
| p03-p05-r1 | 33像素中28 PASS/5 FAIL，另有QA lifecycle失败；原件保留 |
| p03-p05-r2 | 构建后中断，仪器化 NOT_TESTED |
| p03-p05-r3 | 31 PASS/2 FAIL；修复中出现的人工候选回归保留 |
| p03-p05-r4 | 同33图及同断言全部通过；5方法与独立恢复1方法通过 |
| p03-p05-lifecycle-r1 | 普通Activity30轮、未登录MainActivity30轮通过；该批在所有者舒适度反馈前完成 |
| joint-r8 | 当前产品源码：33 SDK像素、3个SDK保护方法、原生种子/新进程恢复2方法、Chrome8检查全部通过；真实收款页字节另作1个诊断 |
| emulator-joint-r3 | 与Samsung同APK哈希，独立API36虚拟设备；同合成链路及60轮生命周期对照通过 |

产品OCR最小修复涉及聊天损坏标题负向否决、待处理二次裁剪保留、全角单位独立读取、非金额时间标签及未知单位人工候选保留。新增7个原生回归全部通过。90秒、8次、250ms和单SDK任务10秒未改变。D-01的辅助Activity配置只修QA，不归因三星驱动，不改产品硬件加速。60轮MainActivity是未登录入口，不能证明登录后财务WebView或真实同步生命周期。

所有者反馈快速开关刺眼后，真机快速矩阵被禁用。后续聊天导航每次停留10秒；joint-r8为零前台Activity切换。压力循环只在无窗口模拟器运行。

当前Samsung APK SHA256：`{device['artifacts'][0]['sha256']}`；测试APK：`{device['artifacts'][1]['sha256']}`。精确编译源和最终源码逐文件绑定见 `finance-p06/source-binding.json`。Samsung同33张PNG与r4哈希一致；模拟器只声明同输入配方，不把不同系统字体的像素冒充相同。

## 真实微信观察及未闭合链路

实际进入主微信相关转账聊天并观察已有收款详情，没有再次付款、转账、发送消息或领取。页面收款状态已显示，真实SDK读得小数候选0.01；未给默认币种时，产品结果为 `amount_minor=null / amount_decimal=0.01 / currency=null / completion=false`，零写账。所有者声明的CNY与页面单独的¥符号分开记录。缺少可绑定的业务引用及本轮真实历史通知，付款侧同一交易的严格关联未证明。

因此真实通知→无障碍→Room→Outbox→Hosted D1→Web完整链路仍为 NOT_TESTED，不能以页面可见、合成流水线或单笔真实转账替代W01–W10十次独立场景。支付宝按所有者条件豁免处理；微信完整门禁尚未通过，不记作实际执行PASS，原行数保留。

## 合成联合链路与保留的失败

joint-r8实际经过SDK→原生可选缓存→普通Outbox→认证HTTP→本地D1→Web编辑器→D1冷重建及回执重放→Android新进程拉回。同一原事件始终对应一笔CNY8800（人工将建议9000改为8800）的合成记录；采用建议只填表，确认前零账目，丢回执和重放后仍只有同一ID。模型为受控Mock，真实模型API另行计量，不冒充此链路的一部分。

joint-r1的stdin阻塞、r2的二进制传输损坏及缺少前提、r3缺少普通核实票据、r4字母引用被真实OCR误读、r5缺少canonical pending hint、r6网页按钮未恢复的失败全部保留。r4误读引用时产品正确拒绝；另建数值引用正向对照，并未修复或翻绿原字母图片。未修改冻结608或C007原真值。

## 当前回归与保护

{table(['集合','本轮当前结果'],[('标准JVM',short(summary['standard_JVM'])),('原607',short(summary['original607']['counts'])),('冻结608',short(summary['frozen608'])),('原26身份红项',short(summary['p03_original26'])),('新增OCR7',short(counts(b)))])}

原六项保留：

{failure_table}

MainActivity真实登录金融页、真实通知抵达、RC-6真实历史来源、真实云端与正式备份恢复仍独立 NOT_TESTED；历史财务Activity异常仍 INCONCLUSIVE。原来的一次重测PASS没有覆盖旧FAIL。13组保护结果见 `protected-final.comparison.json`，正式App/微信UID/profile及权限收尾见 `phone-cleanup-r2/result.json`。测试包已移除，私人证据以CurrentUser DPAPI加密保留并验证，明文清理另有清单。
'''
ai_report=f'''# FINANCE P06 AI实施与验收报告

{date}，Asia/Hong_Kong。**P06 = PARTIAL；不满足正式启用或发布条件。**

{common}
## 实际实现

后端使用既有Task12认证、Task13财务权限、Task16/21路由与Workers AI binding。`functions/_lib/finance-ai.mjs` 负责来源、授权、预算和决策；`finance-ai-provider.mjs` 将角色/候选ID结果归一化，金额和单位只从原始候选复制。默认必须同时配置 `FINANCE_AI_ENABLED=true`、`FINANCE_AI_KILL_SWITCH=false`、`WORKERS_AI_ENABLED=true` 及合法服务端模型；没有把正式开关打开，也没有修改Task15/26模型或额度。

现有待核实页接入可选脱敏分析、建议和原编辑器。规则已知金额、金额硬冲突、缺少UID/引用/方向/单位/完成证据、预授权/解除/过期或身份冲突均不调用模型。C005/C007缺失身份事实仍被隔离。AI不能创建金融事实、合并交易、确认支付或写账，所有建议须人工核对。

Android以独立 `FinanceAiDatabase` schema1缓存最小候选、授权及审计，主Room18/FX1不变。原生树/真实SDK的歧义候选经过账户、原票据、精确引用、单位和方向校验才进入协调器。已知单位的`currency_amount_unproven`可以接受建议，原核心待核实原因保留；其原始事件通过既有Outbox补同ID、金额为空的pending hint。没有新造provider proof、没有把模型金额上传成原事实。

Web继续使用已有财务候选展开区和编辑器，采用建议只填表，人工未保存修改优先。修复AI结束后保存/编辑/核实按钮停留disabled的问题。原生金额标签显示ISO，原生编辑器的同意、未保存修改、撤销和离开页面边界均回归。

## 安全与恢复

严格Schema、整数最小单位、六币种指数、有限角色词/品牌、证据ID和角色交叉校验；不上传截图、通知历史、聊天、姓名或真实订单号。Prompt injection、编造金额/单位/引用、选中优惠/费用/余额、低置信结果不能成为自动账。

持久缓存绑定账户、canonical hint、语义digest、模型/提示词/协议版本；同事件上限2次，日/月/用户预算及最大输出token有硬限制。0预算拒绝首次调用，尚未调用模型的配额拒绝可在额度恢复后CAS重试。原生断网授权撤销立即生效，待同步撤销持久保留。服务中断的running请求经过有界租期只转人工超时，不重新发模型请求；原远端调用是否收费不据此推断。

最后新增的三项隔离复现全部先FAIL：缓存建议遇到Kill Switch不刷新、撤销后重新授权复活旧建议、迟到running覆盖最终建议。修复后策略变更在事务中撤销旧可用建议，撤销优先于迟到授权，配置读取串行；发布SQL原子绑定授权revision和模型版本，弱状态不能覆盖已完成结果，原生显示/采用同时核对授权revision。没有更改90秒票据、金额识别、核心账本或Outbox内容。三份原失败JUnit与完全相同的新方法体保留在`native-policy-before/`；后续30个相关方法全PASS。

## 数据库及兼容

D1 `0034_finance_ai_assistance.sql`仅新增consent、observations、decisions、budgets四表。真实本地D1增量、部分batch回滚、重复迁移、原ID/金额/时间/人工备注保留及冷逻辑恢复7项通过。可选Room缓存二进制副本恢复、未来版本拒绝、主库18不升级均通过；没有fallbackToDestructiveMigration。原生策略修复只改DAO查询与JSON元数据，不增加表或迁移版本。

Git回退不能当数据库回退。未迁移正式App数据库，没有对Production D1运行SQL。旧财务数据库和回执通过本轮已有迁移/备份测试；正式个人备份、真实云端Time Travel及非兼容正式降级仍 NOT_TESTED。回退优先停用AI并保留新增表，不能删除正式金融事实。

## 实际自动化

{table(['集合','结果','性质'],[('Native AI',short(counts(ai)),'真实产品逻辑/Room/JVM/Robolectric，包含并发和策略复现'),('SDK修复防回归',short(counts(b)),'包含在标准JVM中'),('原P06 rich-provider契约',short(supplementary['ai-contracts']),'受控Mock+实际D1'),('角色协议v2',short(supplementary['roles']),'严格归一化/实际D1'),('预算与中断恢复',short(supplementary['recovery']),'实际D1/冷恢复+Mock'),('D1迁移',short(supplementary['migration']),'真实本地SQL/事务/冷恢复'),('实际Chrome',short(supplementary['chrome']),'实际HTTP/auth/D1/DOM；模型Mock'),('Samsung/AVD联合','PASS','SDK/Room/Outbox/HTTP/D1/Web真实执行；模型Mock')])}

以上集合有覆盖重叠，不相加作为总用例数。Functions构建、模块图和storage contract均通过。当前标准JVM、Lint与Debug统计见统一报告及`{full}`；原607、原六失败及冻结608没有借用历史PASS。

## 真实提供方与费用

共15次开始的`AI.run` binding调用：12次收到模型输出，3次调用抛错没有结构化输出。真实API使用临时AI binding、本地D1和纯合成脱敏输入，没有部署或绑定正式金融资源。最初12次结果保留，预算调整仅增加3次同输入模型对照。

| 轮次 | 真实结果 |
| --- | --- |
| live-r1 / r2 | 每轮3个原语义目标均FAIL，review/拒绝，没有写账 |
| live-r3 / r4 | 各1次语言/压缩诊断；不是产品业务PASS |
| live-r5，当前roles-2 | CNY退款PASS；CNY付款和JPY付款均FAIL，费用角色与净额选择冲突被拒绝 |
| live-r6 | 同退款场景重复PASS，不算新的独立业务场景 |
| live-r7，第二模型 | 3次binding异常，无结构化输出；语义能力NOT_TESTED，原因INCONCLUSIVE |

主要模型请求 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`，实际返回模型标识 `@cf/meta/llama-3.3-70b-json`。第二模型 `@cf/meta/llama-3.1-8b-instruct-fp8` 的异常原文在该轮未保存，name/status/输入hash/时间及安全失败结果保留；已补后续private异常保存，但不能猜测这三次原因。

已记录usage的调用数为{len(usage)}；可观测token合计 `{json.dumps(token_totals)}`，neuron字段合计 `{json.dumps(neurons)}`。调用耗时样本 `{json.dumps(metrics['observed_call_latency_ms'])}`。这些只描述已观测样本，部分调用没有usage。**实际发票费用 NOT_TESTED/null**，不把参考价格、免费额度或失败次数当作实付费用。完整逐次记录见`provider/aggregate.json`及各轮原件。

同三种当前主模型语义场景只有1/3独立场景通过，退款重复不增加分母；这一结果不足以标定真实业务准确率/召回率。合成Mock联合链路和规则33图不能替代真实模型+真实来源的联合指标。已测试错误接受路径为零自动写账，真实业务总体误记账率与人工复核率仍 NOT_TESTED，不能虚构百分比。

采用结构化接口仍须验证返回内容，官方JSON Mode也明确说明不能保证所有响应符合Schema。[Cloudflare JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)；第二模型的参数依据[官方模型页](https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fp8/)。模型可用性文档不是本账户调用成功的证据。

## 剩余门禁

主要模型付款/JYP角色质量、第二模型完整错误诊断、更大合法标签集校准、真实通知与提供方凭证、真实模型和Samsung全链路、登录后MainActivity/息屏恢复、Hosted金融D1与正式备份均未关闭。不能凭安全拒绝宣称完整业务支持。本轮未更新正式环境或既有Preview，没有可宣称已交付的P06线上Deployment ID或真实账户体验。
'''
unified=f'''# FINANCE P03–P06 统一验收报告

{date}，Asia/Hong_Kong。**P03=PARTIAL；P04=PARTIAL；P05=PARTIAL；P06=PARTIAL。**

本轮实际完成了Samsung OCR修复、P06建议流水线、原生授权/并发缓存修复及当前源码回归。所有失败、EXPECTED_RED和NOT_TESTED均保留；没有满足全部原合同，不能标COMPLETE。

{common}
## 最新结果与口径

{table(['集合','当前结果'],[('标准JVM',short(summary['standard_JVM'])),('原607',short(summary['original607']['counts'])),('原冻结608',short(summary['frozen608'])),('版本化前提608',short(summary['contract608'])),('原P04十八项原样',short(summary['currency18_raw'])),('原P04十八项前提转发',short(summary['currency18'])),('原P03二十六红项',short(summary['p03_original26'])),('既有新增38',short(summary['new38'])),('Native P06',short(counts(ai))),('新增Samsung OCR防回归',short(counts(b)))])}

SKIP以原始结果为准，未执行项目不算PASS。JVM、607及63/41/99/79等集合重叠，不相加。额外保护集合：`{json.dumps(summary['overlapping_p03_sets'])}`；独立显式币种v2为`{short(summary['explicit_v2'])}`。P04的18条原输入/原断言未改，6条原样红灯因驱动未传递声明前提保留；版本化输入转发有单独证明。

Lint：`{json.dumps(summary['lint'])}`，Error/Fatal为{summary['lint'].get('Error',0)}/{summary['lint'].get('Fatal',0)}；Debug及测试APK构建已执行。组合Gradle命令因原六项失败返回非零，不能写成整个回归PASS。代码来源、命令、JUnit、时间、APK及完整失败栈位于`{full}`。

最终全量批次的Node受测文件哈希在续跑前再次核对；手动中断发生在Android生成结果前，旧编译日志另存`interrupted-android-r1`并标INTERRUPTED_NOT_TESTED。只恢复未完成Android和后续阶段，未覆盖旧命令记录。早期P06输出目录被旧QA守卫拒绝的尝试也保留，后改用全新的本轮专属`finance-p04/p06-validation/`，未修改原守卫、冻结源码或oracle。

## 仍未关闭的原始缺陷

{failure_table}

缺少可审计币种前提时，¥不能直接当CNY；不能因原测试曾使用旧默认值就恢复猜币种。原六项的三个源文件哈希未变，C005/C007原样本/真值未改，26条身份红项保持真实结果。需要所有者另行裁定v1→v2合同或提供真实可证明的operation/reference/revision/前驱/账户作用域；隔离合同不等于完整业务支持。

## 真机、模拟器、API与业务证据

Samsung最新joint-r8及独立API36模拟器joint-r3使用相同APK哈希，合成SDK、Room、Outbox、认证API、本地D1、Web人工修改、丢回执、冷恢复和新进程拉回通过。模拟器60轮及先前Samsung60轮均是未登录MainActivity，不能代替登录金融页的真实生命周期。D-01/D-02保持CLOSED；历史财务Activity异常仍INCONCLUSIVE，不凭当前PASS改写。

已有真实收款页只得到0.01未知单位候选和收款状态观察；实际历史通知、付款侧同笔身份、来源与引用、RC-6、真实云持久化和完整W01–W10仍NOT_TESTED。没有新付款/领取/消息，没有访问无关账目。真实模型15次binding调用与合成Mock链路分开；当前主模型三种独立语义场景1 PASS/2 FAIL，第二模型3异常，发票费用NOT_TESTED。

## 数据、兼容性、保护及清理

主Room18/FX1不变，AI可选库1和D1四表增量独立于金融事实。迁移/异常回滚/重放/Outbox/四组件备份、独立JVM与真实本地D1恢复按原合同重跑。正式数据库从未打开；正式个人备份恢复、Production迁移/回退和Hosted持久化NOT_TESTED。Git回退不能替代数据库回退。

13组保护逐文件/HEAD/branch/status核验一致；原37份源字节已归档，956份上轮raw、再前2779份raw/51份源档案、4142份更旧文件均核验；原107个缺失编译缓存及原因未确定的旧FAIL继续保留。冻结13文件和原失败3文件哈希未变。

正式App1.3.37/code50及APK/权限与测试前一致，微信UID及profile未变。本轮QA两个包再次移除，私有ADB5043和专属AVD停止；磁盘/ChromeProfile/冗余APK清单见`local-cleanup/result.json`。原有其他QA、Task25/26、Hotfix工作树、签名材料、正式APK及数据保留。私人原件使用Windows CurrentUser DPAPI+用途entropy加密，全部解密hash核对后才移除明文；可用`privacy-read.py --label r1/r2 --verify-all`复核，不输出私人原文。

## 所有者后续最少条件

1. 对原v1币种默认合同及无法观察的身份场景作明确范围裁决，或提供合法脱敏且包含独立操作/版本/前驱/账户作用域的真实提供方凭证。不能伪造这些字段。
2. 在未来自然发生、持有人亲自完成的真实事件中取得完整来源通知和匹配凭证；不要求为本轮重付或重领旧转账。真实通知、RC-6和W01–W10分项保留数量与证据边界。
3. 真实模型需取得可诊断错误及独立校准数据，并完成受控预算下的真实模型+设备联合验证；未达到质量门禁前不启用正式AI。
4. 正式备份恢复、登录后金融页生命周期、Hosted金融库及Production发布仍须相应独立门禁与有效授权。本轮没有将代码推送、合并、正式签名或部署到任何现有站点。

完整实现/边界见 `FINANCE_P06_AI_IMPLEMENTATION_REPORT.md`，Samsung细节见 `FINANCE_P03_P04_P05_DEVICE_ACCEPTANCE_REPORT.md`。最终Git SHA、干净状态、全部证据hash和保护结果由`docs/migration-evidence/finance-p06/FINAL_PROVENANCE.json`及`FINAL_VERIFY.json`绑定。完成本轮交付后停止，不自动进入新阶段或发布。
'''
currency_rows=read(FULL/'delivery-current/currency-18.json')
unified+='\n## 原P04十八项逐条结果\n\n'+table(['Case ID','原样冻结','声明前提转发'],[(r['case_id'],r['frozen_after']['status'],r['after']['status']) for r in currency_rows])+'\n'
changed=set(subprocess.check_output(['git','diff','--name-only','425776f086d5a2b9165f9b9de311826a8d218f9e'],cwd=ROOT,text=True).splitlines())
changed.update(n for n in subprocess.check_output(['git','ls-files','--others','--exclude-standard'],cwd=ROOT,text=True).splitlines() if n)
change_rows=[{'path':n,'kind':'产品' if n.startswith(('android/app/src/main/','android/app/schemas/','functions/','js/','cloudflare/')) else '报告' if n.startswith('docs/') else '测试/QA'} for n in sorted(changed)]
(E/'CHANGE_LIST.json').write_text(json.dumps({'before_final_document_commit':head,'starting_commit':'425776f086d5a2b9165f9b9de311826a8d218f9e','files':change_rows,'final_sha_and_hashes':'FINAL_PROVENANCE.json binds the final local commit and all source bytes'},ensure_ascii=False,indent=2))
unified+='\n## 修改清单\n\n'+table(['仓库内文件','范围'],[(r['path'],r['kind']) for r in change_rows])+'\n\n完整补丁可审阅本地 `425776f..最终HEAD`；没有向远端提交这些变更。最终文件哈希由新封存manifest绑定。\n'
reports={'FINANCE_P03_P04_P05_DEVICE_ACCEPTANCE_REPORT.md':device_report,'FINANCE_P06_AI_IMPLEMENTATION_REPORT.md':ai_report.replace('付款/JYP','付款/JPY'),'FINANCE_P03_P06_UNIFIED_ACCEPTANCE_REPORT.md':unified}
for name,text in reports.items():(ROOT/'docs/finance'/name).write_text(text,encoding='utf8')
print(json.dumps({'reports':list(reports),'tested_head':summary['tested_head'],'standard_JVM':summary['standard_JVM'],'phase_status':'PARTIAL'}))
