# FINANCE-P03/P04 — RC-6 与 Production 放行门禁

2026-10-24，Asia/Hong_Kong。**RELEASE = HELD；Production 验收 NOT TESTED。** 本轮已取得的本地、Samsung、隔离 Hosted 与恢复证明不能替代正式环境放行。所有者授权门禁满足后的发布操作，不等于授权跳过门禁或不可恢复迁移。

原始证据为 `docs/migration-evidence/finance-p04/closure-current/`（`E/`）。本报告只汇总已存在证据，未运行远端操作、部署、Git 或手机命令。产品最终 OCR 源码为 `73764f77fd02ada240e41c24734e523c5dad8805`；后续最终回归 / 封存以统一报告列出的完整 SHA 和逐项结果为准。

## 1. 四种环境分别记账

| 环境 | 本轮已证明 | 不能据此声称 |
| --- | --- | --- |
| Windows / JVM / Node / Chrome / 本机 Miniflare | 原合同复现、版本化币种前提保护、金额 / FX / 迁移 / 幂等；实际结果见最终回归，不重叠相加 | Samsung PASS、真实通知 PASS、Production PASS |
| Samsung 独立 QA 包 | 最终Room/六币种/四组件备份/冷重读/三个合成Web表面、生命周期30轮及七向量OCR；最终息屏20秒FAIL保留，人工解锁后仅观察RESUMED；指定微信详情只读 | 正式App已升级、真实支付自动入账、真实云链或W01–W10全通过；原失败未被后续观察抹去 |
| 独立 Cloudflare Hosted | 新 QA 项目 / 新 QA D1，真实 HTTP、D1 持久化、重复 operation、新会话 / 账户隔离、FX 与远端导出恢复 | 正式账户、正式 D1 / R2 / Stable、生产备份与回滚均已验收 |
| Production | 既有基准只读元数据核对，不实施变更 | 最终候选已发布、正式数据迁移 / 恢复 / 回退 / 正式包复验 PASS |

## 2. RC-6 历史来源一致性

**RC-6 = NOT TESTED；历史归因 INCONCLUSIVE。** 原历史事件尚缺足够材料把同一事件的 source package、Android user / UID、recognition、aliases、canonical、回执及最终显示连续串联。本轮新的合成通过不能解释旧事件。

真实现存¥0.01观察只证明取证前后OS窗口metadata分别稳定于`com.tencent.mm` user0和user95；**截图层profile归属NOT TESTED**。QA使用UiAutomation全屏截图/根节点，产品API34使用窗口截图，两者不能认作等价服务采集。两次probe对QA截图运行完整产品OCR均为CNY最小单位1、INCOME、completion true；标为分身的结果与所有者“分身付款”声明不一致，但尚不能确认为产品方向缺陷。未取得可信提供方交易引用、原始交易时间、付款角色标签或前驱关系。详情见 [Samsung / 微信报告](SAMSUNG_AND_WECHAT_ACCEPTANCE.md)。

| RC-6 要求 | 现状 | 关闭条件 |
| --- | --- | --- |
| 历史同事件的原始来源与显示一致 | **NOT TESTED / INCONCLUSIVE** | 同事件可脱敏关联证据；没有材料时明确保留历史无法归因，不以新事件代替 |
| 同包不同 profile / 账户分离 | OS metadata稳定已观察；截图层profile归属及完整事件链 **NOT TESTED** | 首先证明截图/窗口/profile一致，再使source user/UID进入采集、持久化、幂等作用域并保持到页面/回执 |
| 同额不同事件不误合并 | P03 原身份红灯仍在；本笔不做同额自动归并 | 可信独立 operation / 提供方引用 / 版本与前驱；缺失则保留原事件并待核实 |
| 付款 / 收款方向与原始业务事实一致 | **INCONCLUSIVE**：标为分身probe输出未满足付款角色，截图profile尚未证实，非已确认产品方向FAIL | 先证明实际采集来源，再解决方向/角色并用原始真实证据复验；不补造关联字段 |
| source / canonical / 三页面 / receipt 同事件闭环 | **NOT TESTED** | 对合法确认的真实事件建立贯穿链；merchant / counterparty 不替代渠道 |
| 隐私与失败关闭 | probe 创建 ledger 0；真实原件加密本地保存 | 持续不上传原始正文 / OCR、无证据不入账；此保护不等同完整业务支持 |

不重新开启已独立关闭的 D-01 / D-02。P03 另一次历史 Activity 异常仍 INCONCLUSIVE；普通进程连续 30 轮成功只是新的回归证据，不是历史 RCA。

## 3. 独立 Hosted 的实际对象

| 对象 | 身份 |
| --- | --- |
| Pages 项目 | `thewyj-finance-qa`；仅分支 `finance-p03-p04-qa`，保留分支 `qa-hold` 未作为生产发布 |
| 本轮QA别名（已退役） | `https://finance-p03-p04-qa.thewyj-finance-qa.pages.dev`；证据封存后所属owned项目已删除，不再作为可访问交付站点 |
| 最终本轮部署（已退役） | `bf3aaabd-bf85-4fbc-9b55-63cbc70d9545`，声明提交`73764f77fd02ada240e41c24734e523c5dad8805`；`E/cloud-deploy-final/command.json`/stdout；随项目清理退役 |
| 正确 QA D1（已备份后删除） | `finance-p03-p04-qa` / `c2eb978f-9f49-4e4c-8286-f6b398fae0de` |
| 恢复演练目标（已删除） | 新建、未绑定产品的隔离D1 `da1711d7-f770-4e30-b305-9d812588f8b4` |
| 正式 D1（受保护） | `11c288d8-c584-409f-bb1f-7e7af11793e5`；未迁移 / 写入 |
| 既有共享 Preview（非本轮 QA 库） | `a3e6253b-689f-49f3-998b-7c5828ea255a`；初次部署错误涉及此库，见下一节 |

实际下载部署配置复核为正确 QA D1，根 Wrangler 配置未改变：`E/hosted-bindings-final/result.json`。部署仅通过既有资源 allowlist staging，不上传整个开发工作区、private 目录、密钥或原始微信证据。

| 隔离 Hosted 项目 | 实际结果 | 覆盖范围 / 原证据 |
| --- | --- | --- |
| 正常登录与六币种 HTTP 合同 | **11 PASS** | 六币种持久化、人工 revision、同 operation 重放、JPY 旧客户端拒绝、未知币种拒绝、新登录重读、第二账户不可见 owner 账。`E/hosted-http-r2.json` |
| Samsung实际NativeCloud r3 | seed/跨进程restore **各1 PASS** | 实际Task20/HTTPS，六币种各1最小单位、提交后丢ACK、精确Outbox重放/回执、queue0、另账户不可见；`E/samsung-hosted-native-seed-r3.json` / restore-r3；不是微信 |
| 真实远端参考 FX | **4 PASS** | 正常 QA 登录、Frankfurter v2 2026-10-19 USD/CNY 日参考、cache / 源 / 时间、同币种、历史引用不改原账不新增行。`E/hosted-fx-r2.json`；参考汇率不冒充支付成交价 |
| 远端 D1 导出恢复 | **PASS** | SQL 导出导入新隔离 D1，105 表、12 笔合成账、24 回执、0 外键错误，原 ID / 单位 / revision 保全。`E/hosted-d1-restore-r2/result.json` |
| 初次 HTTP driver | **6 PASS / 5 FAIL保留** | r1期待非JPY公开响应显式amount_exponent=2，实际API有意省略该冗余字段，undefined≠2；r2按ISO推导，直接D1另核12行单位正确。`E/hosted-http-r1.json`；不是revision错误，未改业务金额/币种断言 |
| 首次远端恢复结果解析 | **FAIL 保留** | r1 非 JSON 输出解析失败；r2 使用独立结果重新核验真实恢复。`E/hosted-d1-restore-r1/result.json` |
| 首次 FX fixture 与最终 adapter | 原失败 / 适配记录保留 | `E/hosted-fx-r1.json`、`E/hosted-fx-r2-adaptation.json`；最终数据源合同单独验证，不用 retry 抹除原记录 |
| 清理前最终Hosted实际浏览器 | 19条合成记录可见，CNY/JPY显示证据已保存 | `E/hosted-final-19-dom.json`、`hosted-final-19-cny.png`、`hosted-final-19-jpy.png`；含原12人工、1FX及6NativeCloud小单位，不是微信 |
| 最新备份/本机恢复后退役 | **PASS**；105表、19合成账、25财务回执、6通知回执、外键0 | `E/cloud-final-backup-r2/result.json`，remote_import=false；SQL导出至本机独立SQLite后精确核对，不冒充再次远端导入；之后owned项目/2D1删除 |

以上均是自建合成账户 / 数据；不是那笔真实微信转账的同步证明。HTTP11与FX4含重复登录前提，不能把它们相加当作15个互斥业务用例。恢复中的12账 /24回执是该次合成快照数量，不是正式环境记录数量。Production Time Travel 与正式账户备份恢复 **NOT TESTED**。

## 4. 首次 QA 部署误绑定事件

首次两次新 QA Pages 部署从根工作目录调用 Wrangler，遗漏显式 staging 工作目录。即使项目名是新 QA 项目，Wrangler 实际采用根 `env.preview` 的共享 Preview D1。**这是执行隔离错误，不是登录产品根因。**

| 事实 | 可复核证据 |
| --- | --- |
| 初始 QA 部署实际绑定共享 Preview `a3e…` | `E/hosted-bindings-before-fix/result.json` |
| 涉及的本轮部署 | `95a8fab5-c14c-4d2d-86ac-a82c115eff56`、前缀 `7863b891`；完整部署身份保存于 `E/cloud-qa-deployment-list/` |
| 已确认副作用 | 3 条本轮合成用户名的失败登录审计记录；没有成功认证的财务 API 写入。`E/cloud-old-preview-own-audit/command.json` / `stdout.log` |
| 纠正措施 | 后续部署强制 `--cwd` 为 allowlist staging，并检查 QA 名称 / D1 ID；实际重新下载配置确认 `c2…`。`E/hosted-bindings-after-fix/result.json`、`E/hosted-bindings-final/result.json` |
| 正式环境 | 没有据此操作 Production D1、R2、Stable、正式账号或 Task26 数据 |

共享Preview登录失败审计确实发生变化，**不能声称该库整个数据库逐字节未变**。失败登录还可能涉及短时认证/限流状态，不能把体积相同推导为内容均不变。3条本轮失败audit作为必要事故证据保留，没有进一步写共享库掩盖。旧错误部署已随owned Pages项目全部4部署一起删除；正式/共享D1及Production Pages仍存在，owner Wrangler keyring保留，见[清理报告](CLEANUP_REPORT.md)。

所有远端新写入都应限定在本轮自建 QA 对象。所需认证秘密只保存在忽略的受限 private 路径，未打印、提交或复制 Production 密钥。正常 Cloudflare / Google 身份验证由所有者完成，未绕过认证。

## 5. Production 硬门禁

| 门禁 | 当前结论 | 必须满足后才能放行 |
| --- | --- | --- |
| P03 原26业务目标 | **4 FAIL / 22 EXPECTED_RED**，未关闭 | 原 A 系列、C005 / C007 需要可信独立事实；无法观测时保持原输入、隔离原因及范围接受边界，不伪造证据 |
| 原607及标准 JVM 冻结合同 | 最终73764f7原607 **602 PASS / 5 FAIL**，标准730 **724 PASS / 6 FAIL**；新增8个OCR方法包含在730，集合重叠 | 处理旧无币种断言与新安全合同的版本化差异并获得适用合同接受；新增测试通过不覆盖原失败。`E/final-current/delivery-current-r2/summary.json` |
| G-REUSED-014及原冻结608 | 原失败保留；金额上下文冲突未静默更改 | 原 driver 与明确上下文版本双账本，原测试输入 / 断言不可篡改 |
| 真实微信采集与完整链 | **NOT TESTED**，付款侧方向冲突未消解 | 合法身份 / 角色、真实 listener / recognition / ticket、Room / Outbox、云 receipt、三页面与重启一致 |
| RC-6 历史 / 新来源链 | 历史 **INCONCLUSIVE**，完整链 **NOT TESTED** | 同事件可信关联材料及不跨账户 / profile / 来源的实际验收 |
| 最终 Samsung 全范围 | 最终Room3P/六币种3P/四组件2P/冷重读1P/登录1P/MainWeb1P/正常通知P/生命周期30轮P；smoke前提FAIL及清理状态PASS并列；最终息屏20秒FAIL，解锁后只观察RESUMED；OCR安全两项NT | 全部结果按独立范围，不合成完整微信链；原两次instrumentation FAIL及历史异常保留，真实票据/原生核实页/事件恢复仍NT |
| CI / 远端最终提交 | **NOT TESTED**；本轮未推送 / 创建PR / 合并 / dispatch | 精确候选SHA、同源构建、有效 CI与产物匹配，不把历史PR状态当新CI通过 |
| 正式 App及升级 | 正式仍1.3.37/code50；最终正式包 **NOT TESTED** | 原签名、完整一致备份及恢复验证、实际升级保原ID / 用户数据、发布后验收 |
| Production schema与回退 | **NOT TESTED** | 服务端5/9及capability3先行；正式备份、恢复及安全失败关闭；不能仅回退Git / APK |
| Production账号 / 幂等 / 持久化 | **NOT TESTED** | 在其他门禁通过后用明确专用账户验证，限定写入 / 清理及恢复范围 |
| Production Web / API / R2 / Stable | **NOT TESTED**；未变更 | 生产部署身份、正式APK SHA、公钥 / 版本、正式资源与回归证据各自核实 |
| 测试残留 / 权限恢复 / 保护 | owned手机/云/Windows清理已完成、正式a11yTRUE/NLSFALSE读回；最终13组保护PASS，最终SHA记录于 `E/FINAL_DELIVERY_PROVENANCE.json` | [清理报告](CLEANUP_REPORT.md)逐项证据；只清owned对象，失败/必要备份保留；最后保护核验不得由早期核验冒充 |

C005原场景同一授权下80+90缺少独立 Capture / revision / 前驱，原预期17000仍不能由当前8000自行补足；C007无可靠引用，原预期17000而实际0。数学上无足够可观测事实时，安全拒绝有价值，但不能标为原业务支持完成。

原 E004 / E007 / E008 文本语义缺口不因本轮 OCR 金额修复自动关闭。真实方向问题也不能通过弱化完成门禁、补币种默认、同额合并或让市场 FX 回写原交易来绕过。

## 6. 数据库与发布回退限制

本轮设备及隔离云库验证了增量迁移、事务失败后重试和合成恢复；正式用户库没有导出、清空、重建或降级。可执行安全原则为：冻结一组一致的主库、Outbox、FX / 人工决议及必要偏好；先校验账户、版本、SHA与关联，再在同 / 更高兼容版本恢复，并重新取得会话。

**Git 回退不是数据库回退。** 升级后若已有新账 / 新回执 / 新队列，不能用旧快照覆盖或交给旧 APK；旧 opener 应拒绝新 schema。不能安全降级时必须失败关闭、阻断发布，保留升级后数据并使用兼容版本恢复。Production正式迁移与恢复若存在不可逆影响或不能证明可恢复，须所有者针对具体操作另行批准。

## 7. 当前决定

P03 / P04 均不能据上述组件成功宣布 COMPLETE。保留现有失败与未测项，继续可安全完成的独立回归 / 封存 / 清理；在身份、真实链、最终回归、CI及Production恢复等门禁未满足时，**不推送、不合并、不签正式包、不执行Production迁移 / 发布**。

自动审批曾拒绝一次读取 QA URL `/api/status` 的403诊断响应及组合中的 Settings 重启动作，只返回 `blocked by policy`，未提供更具体原因；该组合未执行，未以其他路径绕过该诊断拒绝。后续合法独立 QA 行为与此拒绝分别记录，不把被拒绝动作计为已验证。

<!-- FINAL_CLEANUP_AND_SEAL_STATUS -->
最新备份/恢复、owned项目4部署/2D1、4owned APK、Windows13,807文件/1,471,872,541逻辑字节清理及正式权限恢复已完成；最终13组保护已PASS，最终Git SHA/总manifest记录于 `E/FINAL_DELIVERY_PROVENANCE.json`。本节清理结果不改变RELEASE HELD、PARTIAL或任何原FAIL/NOT_TESTED。


清理保留例外：`qa/finance-p04/closure/__pycache__`的最后删除被自动审批拒绝（仅`blocked by policy`，无具体理由），命令未执行、未换方式重试，故小型pyc缓存仍保留；见E/cleanup-policy-rejection-final.json。不得称零残留。
