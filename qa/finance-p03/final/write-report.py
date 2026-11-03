"""Write the sole current P03 report from validated fresh evidence."""
import json
from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parents[3]
BASE=ROOT/'docs/migration-evidence/finance-p03/final'
def read(name):return json.loads((BASE/name).read_text(encoding='utf8-sig'))
summary=read('delivery-final/summary.json');matrix=read('delivery-final/p02-comparison.json');artifact=read('artifact-verification-final.json')
code_commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT).decode().strip()
assert code_commit!='75e6561c4d32db77ee1192a7f2995bedf2060d78','Commit the tested implementation before writing the report'
changed=subprocess.check_output(['git','diff','--name-only','75e6561',code_commit],cwd=ROOT).decode('utf8').splitlines()
product=[p for p in changed if p.startswith(('android/app/src/main/','android/app/schemas/','functions/','cloudflare/migrations/'))]
new=read('delivery-final/new-tests.json')
red=[r for r in matrix if r['status'] in ['FAIL','EXPECTED_RED']]
red_table='\n'.join('| '+r['case_id']+' | '+r['status']+' | 保留原断言与本轮实际结果 |' for r in red)
new_table='\n'.join('| '+r['case_id']+' | '+r['status']+' | '+r['evidence'].replace('docs/','')+' |' for r in new)
files='\n'.join('- `'+p+'`' for p in product)
bridges='\n'.join('| '+name+' | '+str(row['requests'])+' | PASS | '+str(row.get('pending_candidates','—'))+' |' for name,row in summary['bridges'].items())
target=ROOT/'docs/finance-p03/FINANCE_P03_FINAL_REPORT.md';assert not target.exists()
text=f'''# FINANCE-P03 最终统一报告

**状态：PARTIAL。不具备最终关闭 P03 的条件。** 本次已完成可独立执行的实现、本地仿真沙箱与备份恢复；真实提供方账户/原通知关联、正式备份及设备业务验收仍缺合法外部条件。没有把安全拒绝等同完整业务支持，没有进入 P04/P05/P06。

## 基线、提交与证据

沿用 `%USERPROFILE%/.codex/worktrees/finance-p03-identity-preauth/thewyj.uk`，分支 `codex/finance-p03-identity-preauth`。开工 HEAD `75e6561c4d32db77ee1192a7f2995bedf2060d78`，tracked 工作树干净；旧封存55份源码/报告、1138份raw、542份候选逐字节匹配。此前 P03 的工作及历史命名完整保留，本次没有独立的实施/审核停止节点，也没有重启 P01/P02。

本次已测试的实现提交：`{code_commit}`。本报告随后的本地文档提交只补充此统一报告；最终完整 HEAD、tree、APK与证据封存见 [REVISION.json](../migration-evidence/finance-p03/final/REVISION.json)、[provenance.json](../migration-evidence/finance-p03/final/provenance.json) 和 [validation.json](../migration-evidence/finance-p03/final/validation.json)。提交没有被推送。

Debug APK：`uk.thewyj.app.debug` / `1.3.37-debug` / code50 / min30 / target36，{artifact['apk_bytes']}字节，SHA-256 `{artifact['apk_sha256']}`。只构建与封存，没有安装、正式签名或发布。AAPT2实读见 [artifact-verification.json](../migration-evidence/finance-p03/final/artifact-verification-final.json)。

P01只作为2026-10-19远端静态历史参考，不代表当前源码；P02原始608行及全部证据没有改写。旧D-01/D-02保持CLOSED，Task26保持CLOSED_WITH_OWNER_WAIVER。

## 全部 P03 功能与边界

| 能力 | 本轮最终结论 | 证据/限制 |
| --- | --- | --- |
| 明确身份、重复/零间隔独立交易、旧回执与outbox | 合成回归PASS | 原63、41、99项逐case ID重跑；无金额/时间/商户相似合并 |
| 同一授权多个独立Capture、不同授权/清算金额 | 合成回归PASS | 80+90独立引用=170；清算可超过原额度，余额归0并明确over-capture，不把授权计支出 |
| 部分解除、剩余冻结、过期、部分/多次/全额退款 | 合成回归PASS | A/C/R/H/F/N分离，退款≤清算，部分解除≤剩余，显式完成/过期；乱序依赖与重复恢复保留 |
| Capture/Refund绝对金额更正、归属更正与错误别名解除 | 合成回归PASS | 原正式ID、源事件、旧回执、历史关系不删除；重归属须同时满足旧新家族余额 |
| 多正式ID的明确消解 | 新增合成回归PASS | CONSOLIDATE须逐源同操作证明、明确保留ID和完整revision集合；系统替代关系保留旧行/金额/来源与审计，没有虚构退款 |
| 多正式ID证据不足/未知人工来源 | 保持隔离 | 没有明确同操作证明不合并；人工编辑/删除/拒绝、未知来源、跨账户/发行方/实例继续阻断 |
| 授权/解除/过期控制事件版本 | 新增合成回归PASS | CONTROL_REPLACE仅同角色/独立引用/家族；不创建正式账，原子检查余额与前驱，需完整别名集合 |
| 系统关闭候选与用户拒绝 | 新增合成回归PASS | 新系统关闭有明确标记；用户拒绝持久决定优先。无标记旧拒绝继续隔离，不猜来源 |
| Android来源UID | 新增合成回归PASS | 已受证且同发行方的不同包可不同UID；同包UID冲突仍拒绝，发行方/账户/来源证明仍必须具备 |
| Room/D1/outbox/HTTP恢复 | 合成回归PASS | 四组真实文件、两个JVM、本地HTTP/D1，真实提交后503、重启与重复回执；不是正式手机/云端 |
| 提供方语义适配 | 部分实现，真实入口未闭合 | 新只读验签/事实适配器见下文；公共修正入口仍默认拒绝，未部署或接入真实账户 |
| 真实备份/正式旧APK/真实通知与页面生命周期 | NOT TESTED | 没有合法正式导出、授权沙箱/原样证明、设备操作及真实云端验收证据 |

人工修改与系统事实分开。旧账原ID保留；替代行使用既有deleted状态退出有效统计，并明确保存 `system_superseded_by` / `system_superseded_operation`。恢复/编辑该历史替代ID失败关闭，不能自动复活重复支出。该约束当前没有已授权的人工撤销系统替代工作流；不能声称已支持所有历史异常的自动修复。

D1在同一事务内保留全部before image、有效关联、旧新家族余额、原账更新、替代记录、回执和change feed。Task16每账户每版本一条变更，因此为多行分配连续版本，旧客户端可逐条消费，无需新合并消息协议。普通CAS失败返回已提交修正时也重新核对最新人工revision，避免竞态路径返回过时金额。

Android先暂存Room日志再恢复原磁盘outbox；收到匹配回执才原子应用。多ID回执必须完整对应所有旧ID、金额、币种、方向、版本与替代目标；本地保留原booking行，投影只统计有效账。控制回执还在本地独立拒绝过量解除，不能仅靠余额钳制隐藏负值。授权/解除/过期的有效投影保持控制状态，completionConfirmed不冒充支付完成、状态不标已入账；控制提交异常路径也核对当前版本，迟到旧回执不能覆盖新授权。

请求容量仍为最多8个目标+8个解除，且要求完整受影响集合；多ID消解不混用解除动作。超限、原始自动来源无法证明、较新版本链或人工冲突无法精确对应时保留待核实。这是明确容量/证据边界，不宣称任意规模历史修复已经完整支持。

## 提供方适配与 C005/C007

新增 `task21-provider-evidence.mjs` 使用内部可信配置与Web Crypto，只读处理微信APIv3精确字节RSA签名及AES-GCM资源，核对商户/App/付款方。退款回调须关联同作用域已独立验证Capture；保留独立refund_id与transaction_id。按提供方实际付款/退款口径取值，不把商户gross或含券退款直接冒充付款方金额。支付宝读取精确签名响应片段，绑定持久请求的auth_no、operation_id、out_request_no及付款方；金额转分不用浮点舍入，信用预授权不套用现金冻结模型。

**这些是只读事实适配器，不是已上线的自动修正授权器。** 未新增公开回调/上传入口；签名根、商户/付款方绑定、原通知对应关系、真实产品合同及绝对修订前驱仍未获得。返回 `revision=null`、`can_authorize_correction=false`；支付宝通用操作类型保持待产品合同解释，不把operation_id或查询时间当版本。20项签名测试使用临时合成密钥和账户，没有生成真实提供方凭证。

核查依据：[微信支付订单查询字段](https://pay.wechatpay.cn/doc/v3/merchant/4012791858)、[微信退款回调与验签](https://pay.wechatpay.cn/doc/v3/merchant/4012791906)、[支付宝官方授权操作查询模型](https://github.com/alipay/alipay-sdk-java-all/blob/master/v2/src/main/java/com/alipay/api/response/AlipayFundAuthOperationDetailQueryResponse.java)、[支付宝官方退款请求模型](https://github.com/alipay/alipay-sdk-java-all/blob/master/v2/src/main/java/com/alipay/api/domain/AlipayTradeRefundModel.java)。这些商户侧资料不能证明消费者手机通知已具备同样字段；支付宝动态文档无法完整获取的部分采用官方SDK可核对字段，不推断未知语义。

C005冻结期望仍17000分，实际8000分。原80与90只有同一家族字面引用，无法判断第二次是独立Capture、替换还是重复；原事件/候选保留，不伪造子引用或版本。C007冻结期望17000分，实际0分；缺引用/来源关联时不擅自晋升正式支出。两项均EXPECTED_RED，没有用安全替代样本改变原真值。带独立引用/完整证明的170路径另列测试，不能抵扣原红灯。

原FAIL中A009/A011/A201/A203是微信/支付宝无message/reference身份、同槽位、移除重现且零间隔的案例：冻结调用实际传入相同postTime/内容/槽位，两次返回同一event ID；`new_event_evidence`是夹具声明，没有额外交易引用传给注册器。平台通知移除并不证明两笔独立支付，不能为追求期望2笔直接生成第二笔正式支出。这四条仍保留FAIL；真实平台实例生成/恢复行为与交易证据合同未验证，未宣称只是QA错误或已修复。E004/E007/E008为一分金额/缺币种符号的固定页面解析失败，原输出仍空金额/方向；未修改识别策略或启动P05。其余EXPECTED_RED按逐案原期望与实际保留，不能用缺少业务证明的安全拒绝换算成PASS。

冻结输出的 `lifecycle_model_implemented=false` 来自旧反射夹具检查，完整原输出保留；新增余额投影、控制修订的真实覆盖以新增测试为准，不借修正该标签更改冻结判定。普通手机通知中同用户多提供方账户的引用唯一性仍未真实验证；新权威修正的账户scope不能替代原通知入口这项门禁。

## 已自行搭建的隔离沙箱

所有者明确表示没有预先准备的沙箱/样本/备份，要求自行完成。因此新增一键本地HTTP仿真：临时内存RSA/AES密钥、合成商户/付款方、真实产品验签及D1服务、可持久重放的合成outbox、两个部分退款、篡改/跨账户拒绝、无修订金额变更隔离、独立SQLite备份恢复，共7项PASS。入口 `run-one.ps1 -Name fresh-sandbox -Script qa/finance-p03/final/local-sandbox.mjs`；manifest与wire/数据库副本位于 `final/local-sandbox-final/`。服务只监听127.0.0.1，完成后自动停止，没有向提供方发送请求，没有支付、真实用户数据或私钥落盘。原Room双JVM及原生D1备份也已自行生成独立副本验证。

官方接入条件已另行核查：[微信官方安全指南](https://pay.wechatpay.cn/doc/v3/partner/4012082456)说明APIv3暂未提供独立沙箱；其v2部分仿真能力不等价于本次v3/个人通知链。 [支付宝官方接入说明](https://open.alipay.com/paymentServicer/paymentProvider.htm)要求实名开发者、沙箱应用与应用密钥配置；当前没有合法可用的账户/应用，也未证实预授权产品在该沙箱的支持范围。本轮不凭空创建第三方签名根，不借用公开示例凭证，不用Production替代沙箱。实际官方沙箱、正式导出和真实手机门禁仍NOT_TESTED；这些限制不能被本地仿真PASS抵扣。

## 实际测试统计

| 本轮选定集合 | PASS | FAIL | SKIP / NOT TESTED |
| --- | ---: | ---: | --- |
| 原607：588 JVM+13 Node+6 DOM | 607 | 0 | 0 |
| 标准JVM总集合 | 681 | 0 | 0 |
| 原P03新增63 | 63 | 0 | 0 |
| 既有清算/恢复41 | 41 | 0 | 0 |
| 既有修正/映射99 | 99 | 0 | 0 |
| 本次新增统一回归 | 79 | 0 | 0 |
| 冻结608逐行 | 536 | 7 | 42 EXPECTED_RED；23 NOT_TESTED |
| Android Lint/Debug | PASS | 0 | Lint {summary['lint']} |

集合有交叠，不能相加。681=原588+原P03的26+既有18+既有31+本次18。新增79=18 JVM+11多ID服务+9控制服务+20合成签名+8D1迁移+1本地原生二进制备份+2跨JVM方法+3真实JS投影+7自建本地HTTP提供方仿真。30次循环/重跑不增加独立用例数。13个Node脚本中11个退出0，冻结Web/DOM两个实际退出1；未将这两个脚本算全绿。冻结JVM7个聚合方法实际4失败，逐行608和复用26项按身份去重。

旧607继承的3处P03夹具证明条件保留；本轮只扩展迁移注册和最终schema版本断言，未移除功能断言。旧QA未覆盖写，兼容副本追加Room13→14及0030、DB6/3及两新增列默认值，适配清单在 [compatibility-adaptations.json](../migration-evidence/finance-p03/final/compatibility-adaptations.json)。D1恢复初版格式夹具只设置替代字段，不能证明业务关联；最终FM07/08改为通过真实产品协议建立一对合成替代账及已应用日志后恢复，同时保留最早原账/receipt。初版全部保留，最终只选增强后的运行。

本次完整冻结矩阵状态变化0。三项JS投影使用本轮D1实际change feed，覆盖顺序、逆序、重复与后续人工金额；它不是浏览器/手机三页面实测。通知/无障碍/页面/生命周期已有JVM及DOM回归通过，真实OS回调、权限、MainActivity和锁屏/后台均NOT_TESTED。

| 真实文件/JVM/HTTP/D1桥接 | HTTP次数 | 结果 | 待核实数 |
| --- | ---: | --- | --- |
{bridges}

四组seed/restore PID不同；HTTP由固定合成QA账户调用服务，未覆盖Hosted登录、真实设备session或真实账户权限。新消解组先保留两个80的本地booking，服务端提交消解后返回503；恢复独立D1运行时后原请求重放，旧ID/原80保留为系统替代，唯一有效账为90，30次重放不新增账。原始回执、journal及wire日志可逐项核对。

## 迁移、备份、降级与部署阻断

Room13→14仅新增 `payment_booking_supersessions`；原1–13 schema不改。D1新增0030：两列替代归属及系统控制关闭标记表；原0001–0029不改，Task21 DB6、Task16 DB3，wire仍1。没有改Task26/0026文件，也没有执行远端迁移。

实际文件Room13→14、完整旧链、DDL中断回滚重试、重复CREATE、成对数据库/outbox副本恢复均通过。实际旧Room13、12、11 opener失败关闭；未安装或测试正式旧APK。D1中断ALTER回滚、重复原始DDL无损拒绝、旧75e6561实际Task16/21 API对新DB返回503均通过。Git回退不是DB回退，没有降user_version、清库或重建用户数据。

本轮在安装的Miniflare5实际持久化接口 `resourcePersistencePath` 下，关闭运行时后复制完整目录（包含仍存在的WAL/SHM），独立打开并核对98张表及序列，保留真实合成修正日志、旧账/回执。第一次探针误用旧 `d1Persist` 参数，目录不存在而FAIL，未算PASS；前轮无进展记录也原样保留。本轮成功只证明本地原生二进制目录恢复，不证明Cloudflare Time Travel、正式备份或开放WAL裸文件拷贝安全。

真实部署仍阻断。可执行顺序：冻结所有采集/outbox/Task16/21写入口并记录在途与水位；通过合法导出获得关闭的一致Room+outbox及D1恢复点；在独立目标恢复，核对ID/币种/替代关系/日志/receipt/水位/孤儿与重复；确认理解Room14、DB6/3的候选及前向修复包；复验旧写端确实失败关闭。只有证明备份后没有新写入，或已保全并审核差额重放，才可评估旧快照成对恢复。不能用Git回退、旧APK覆盖或单独恢复旧DB丢弃新账。

## 失败记录与逐行矩阵

本轮所有尝试保留。重要修复前失败：旧提交不认识多ID命令；多行共用同一change版本触发真实D1约束；QA操作ID过长；控制版本动作不存在；自动关闭与用户拒绝混同；本地超量解除回执被接受；授权控制投影误标已入账；控制提交异常路径返回旧版本；提交后异常竞态返回过时金额；跨包UID被错误视为同包实例冲突。分别保留失败、最小修复与最终回归。初次working-tree BEFORE跨越编辑时刻，不作为基线归因证据；使用从75e6561提取并逐blob封存的90份源码/迁移重跑，原始失败仍保留。

统计、每个命令/退出码/起止、全部异常栈、fixture与实际值在 [summary.json](../migration-evidence/finance-p03/final/delivery-final/summary.json)、[failure-ledger.json](../migration-evidence/finance-p03/final/delivery-final/failure-ledger.json)、[608逐行矩阵](../migration-evidence/finance-p03/final/delivery-final/p02-comparison.json)、[79项新增](../migration-evidence/finance-p03/final/delivery-final/new-tests.json)。完整执行命令不靠本报告转述：见 `*-run.json`、`acceptance-final2-commands.json`、`node-final-2/exits.json`；可复验入口为 [QA README](../../qa/finance-p03/final/README.md)。

以下49条旧FAIL/EXPECTED_RED本轮均未关闭；完整原期望、实际与错误栈见608矩阵，不属于新增79的PASS。

| 冻结case ID | 最终状态 | 处理 |
| --- | --- | --- |
{red_table}

## 保护、修改文件与审阅结论

13组保护核验通过：主工作区833文件、Task26826文件、修复/Hotfix、D-01/D-02、候选、P02及各raw目录全部无新增/缺失/变化；各HEAD、分支、原dirty状态相同。2728份本地历史资料零变化。根口令、手机/私人页面、正式App/财务数据、Production、账号权限、签名材料均未操作；正式App实际数据状态NOT_TESTED，不伪称手机校验。

本次产品文件共{len(product)}份；另有7份Android测试（4份迁移续接+3份新增类）、新QA工具和本报告，完整变更及hash见封存。产品差异如下：

{files}

不能自行消除的剩余验收条件（按所有者“没有，自己弄”已完成可自建部分，不重复索要材料）：

1. 拟支持的真实提供方产品和合法隔离沙箱、服务器可信账户/付款方及原事件绑定；原样可验证回执/查询合同与独立操作、前驱/修订及优惠/退款口径。不要通过聊天发送私钥、真实账目或无关原文。仅有商户公开文档或脱敏后失去签名的样本不足以开启自动修正。
2. 合法正式备份/导出与隔离恢复通道、匹配outbox/水位的副本及可用旧候选。未获授权不接触真实账；不可安全降级时继续失败关闭，采用前向恢复。
3. 专用数据/账户和必要的设备/真实云端验收授权，覆盖通知、无障碍、三页面、MainActivity、锁屏/后台及迟到OS回调。本轮没有调用ADB、手机或Production，也没有真实支付。

以上外部门禁和C005/C007原始目标未满足，故不符合COMPLETE。当前交付供所有者统一审核整个P03；本轮工作到此停止，没有自动进入任何后续开发阶段、推送、合并、创建PR、正式签名、迁移Production或发布。
'''
target.write_text(text,encoding='utf8')
print(json.dumps({'report':str(target),'implementation_commit':code_commit,'product_files':len(product),'red_rows':len(red),'status':'PARTIAL'},ensure_ascii=False))
