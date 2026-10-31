> 迁移交接副本，2026-10-15。仅将本机用户目录前缀替换为 `%USERPROFILE%`；历史执行结论、失败和豁免均保留。原件和哈希记录仍保留，未重新执行发布。

# Task 26 当前正式状态 — 2026-10-15T02:59:43.414Z（UTC；香港时间 +8）

TASK26_RELEASE_STATUS = RELEASED_WITH_OWNER_WAIVER
TASK26_RELEASE_CLOSURE = CLOSED_WITH_OWNER_WAIVER

Owner 当前明确授权 A100/M100 Stable-only 正式开放；本次安全核验与真实上线健康检查已执行。两项原门禁分别记录：指定普通会员独立试用参与授权 WAIVED_BY_OWNER；专门1%/5%/10% Stable阶段与观察窗口 WAIVED_BY_OWNER。原 BLOCKED 和实际百分比有效样本0保留，均未改为PASS。原 App50 隔离写入继续 WAIVED_BY_OWNER，未冒充通过。

Production 核心学习 Commit c1f32485028c9ce9114d21cab4af3bb46961359c；首次成功开放时间 2026-10-14T11:59:11.196Z，健康检查完成 2026-10-14T12:00:18.692Z。网站日志已完成独立门禁发布，最终 Commit 74eadf589b0a6ffe1e5ab7a9564115891c4ef2dc，Deployment 566292b3-3c7f-4ef5-93b5-6977e606c14a。

实际配置：A ON/100%/Stable-only revision36；M ON/100%/Stable-only revision31；另外三项 OFF/0%/Experimental-only；active targeting0。现有会员权益决定是否可用，未授予或更改权益。100/100针对性隔离检查11组/66请求PASS（仅本地安全证据）；既有真实普通会员C1验收21项复用。新真实浏览器测试使用111有效admin身份，不能代表普通用户。

真实上线检查16项PASS：英日2次作答、同ID去重、Mastery与语言隔离、重载恢复、AI OFF课程回退、重复自然分流一致、会员/角色不变、无效投影0、缺回执0、活动覆盖0。新增7条预期不可变学习事件保留。实际测试账户事件由26到33；未清理或重置学习数据。专门的小比例自然流量观察未执行，不作PASS。

第一次真实发布检查因测试工具在隐藏工作区初始化时过早点击中断，0作答；已实际按 M→A 最新CAS回退（M30/A35），正常注销。可见性等待修正后的同源重复检查成功，最终M31/A36；未修改Production运行代码。保留首轮失败及真实回退证据，未隐藏失败。

正常注销及会话撤销PASS。原正式App1.3.37/50、签名、Cookie、Room、账户、权限、APK与R2 Stable指针不动。0025仍仅执行一次，最新精确Schema匹配。正常既有业务回归证据保留；本次没有对无关用户进行财务、通知或文件读写测试。

回退准备：正常管理员API读取最新revision，先将M OFF/0%/Experimental-only，再将A OFF/0%/Experimental-only；不得删数据或还原D1书签。局部真实HTTP追踪无5xx，浏览器异常0；不把短时测试当作全站长期SLO。已捕获7条限定本次审计标记的真实Functions调用日志，unhandled/exception/5xx为0，未保留请求头、Session、原文或无关用户日志。

证据：owner-release-waiver-20261014.json；owner100-contract-review.json（11/66）；owner100-preflight.json；owner100-production-release-first-ui-failure.json；owner100-production-release.json（16项）；task26-stable100-english.png；task26-stable100-japanese.png。另有owner-release-publication-final.json及exact-head CI/Preview/main/Production记录。

最终 Gate：安全与实际Runtime健康PASS；两项新Owner豁免WAIVED_BY_OWNER；App50隔离写入WAIVED_BY_OWNER；网站日志/新Commit发布PASS；Git自动部署ENABLED实际复核。后续Android Hotfix 允许进入独立阶段；财务AI继续等待Hotfix独立发布与Closure。

以下为保留的历史报告；其中旧OFF配置、技术审核无授权与旧百分比阻塞不代表本次Owner决定后的当前状态。

---
<!-- BEGIN LATEST TECHNICAL STABLE REVIEW -->
# Task26 最终Stable技术审批审核：未授权执行

更新：2026-10-14T11:34:01.519Z（香港时区）。用户本轮仅授权技术审核，不能执行Production灰度。**TASK 26: INCOMPLETE**。本轮没有修改正式Flags、角色、权益、学习数据或源代码，没有新的Production登录，未操作App50/Room/Cookie/签名/Stable。五项维持OFF/0%/Experimental-only；原App50隔离写入WAIVED_BY_OWNER保留，AndroidHotfix/财务AI未启动。

**建议有条件批准有限Core-onlypilot，当前不建议立即开启。** [最小审批摘要](<%USERPROFILE%/Documents/Codex/2026-10-10/li/outputs/TASK26_FINAL_STABLE_OWNER_ACTION.md>)，[完整技术审核](<%USERPROFILE%/Documents/Codex/2026-10-10/li/outputs/TASK26_STABLE_TECHNICAL_REVIEW.md>)。

实际C1dispatcher/middleware/API/controller确认：选题/事件/解释是A AND M，Mastery读取/reconcile是M，显式Review独立R且本候选OFF。A100对28Stable暴露A=true元数据；没有只看A即执行新学习的另一原生/财务/通知/文件路径。新鲜UI及普通学习在M5门内；固定名单当前1普通会员自然选中、111不命中，名义5%不保证有限名单恰好5%（1/28实际3.57%）。

**例外：** 合法管理员ONoverride优先于percentage，可以有意开放门外会员。因此需活动override0、真实reason=percentage_rollout、bucket<500，并冻结/监控五项定义、通道、比例、revision和覆盖漂移；不改正确管理员权限。既有管理员聚合诊断独立于M，普通403。旧同账户pending/离线缓存和有效快照可能继续显示，在线不开新票据、不提交队列；原30秒TTL和后端每次校验维持。R关闭仅禁显式Review按钮/API/模式，核心自适应仍可在M内巩固到期知识和显示时间。

**新增实际核验：** 独立本地Miniflare/D1使用真实C1dispatcher和同源middleware，真实controller配局部DOMrig，执行10组/64请求PASS：门外普通及管理员七类接口403、门内英日学习/Mastery/reconcile/解析、免费/错误语言403、admin聚合200普通403、ONoverride百分比例外和NULL恢复、UI AND/pending保留无提交、Kill/CAS409/回退后原Quiz、会员/价格/旧同步/不可变事件/Mastery保留。AI0调用，C1原逻辑9文件Hash核对；这不是Hosted/三星/Production灰度样本，之前完整回归不重复。当前Cloudflare规则及类型参考已取回，项目依赖未改。

2026-10-14T11:12:12.795Z真实只读D1确认该自然会员active、未删除/封禁、effective user及现有英日权益有效；没有保存用户名/ID/支付正文。它不是111或已退役的三个原授权普通fixture，其本人试用授权和正常会话验权未取得。没有登录、冒充、授新权益；会员资格不是测试授权。

原始门禁规定初始部署OFF、分阶段实际观察错误/延迟/Mastery/重复/audit/异常和故障优先关闭，未规定固定时长/人数/请求量/数字SLO，也未规定成功后必须OFF或保留5%。Preview fixture恢复OFF是不同阶段。24h/3人/100次未采用，不能加为门禁。建议有限窗口结束恢复OFF0EX；保持A100/M5须所有者明确批准，最终Closure记录实际终态。

观察仍需所有者确定香港起止、适用参与/功能范围和未定义的接受判定；实际自然Stable命中、多次一致、合法语言流/Mastery/同ID/回退/原Quiz/数据不变量和真实HTTP错误/完整延迟/audit不可缺。日志只存path/status/duration/requestID/opaqueeventID，不留Cookie/Token/请求正文；D1已接受计数不能推算失败率，预期401/403/409控制请求需与非预期错误分开。

任何身份/权益、重复或非法投影、非预期核心失败、选择不一致或配置/覆盖漂移即停用/kill M再关A。正常API按最新revision/CAS，409停止，不覆盖别人修改；恢复原描述/OFF/killfalse/0%/Experimental-only，另外3项不改，保留权限/价格/历史/事件/Mastery/audit。不reset/restoreD1或清App50/Room/Cookie，不改签名/Stable。新方案回退仅本地验证，Production未执行；原真实Kill20.562秒证据保留，不冒充本轮复测。

**OWNER ACTION REQUIRED**

明确批准两项新配置和Core-only范围；取得自然普通会员本人参与及正常会话验权；填写香港起止/观察接受条件；决定成功后恢复OFF或批准保留目标；确认override0/定义冻结监控。条件不具备继续OFF。若不接受A元数据100%暴露，则保留原同百分比策略等真正自然受众或另行审查分组方案，不为111改Hash/角色/权益或扩量。PR109待适用Stable实际观察后发布日志，再最终Closure；本轮技术审核完成但Task26仍INCOMPLETE。

<!-- END LATEST TECHNICAL STABLE REVIEW -->

## 以下是有日期的先前Root/浏览器/发布证据，最新审批状态以上为准

# Task26 Production 发布状态与 Closure 门禁

更新：2026年10月14日 19:34:45（香港）。本文件记录已经实际执行的结果，**不是完整 Release Closure**。

`TASK26_PRODUCTION_DEPLOYMENT = COMPLETE`

`TASK26_RELEASE_CLOSURE = INCOMPLETE`

`ORIGINAL_APP50_ISOLATED_WRITE_ACCEPTANCE = WAIVED_BY_OWNER`，绝不是 PASS。

## Final Stable Percentage Rollout 本轮实际分析

截至2026-10-14T10:04:58.406Z，**TASK 26: INCOMPLETE**。Production仍C1，源码工作树未改。既有CI/D1/Schema/真实浏览器/普通会员/AI/适用真机门禁复用，不重新全量验收；App50隔离写入保持WAIVED_BY_OWNER。本轮未启动Android Hotfix或财务AI，正式Android仍1.3.37/50。

### 零受众的明确根因

当前五项OFF、0%、仅Experimental，本来没有对Stable开放；修改比例单独不能越过globalOFF和channel排除。Live actor用canonical账户ID，不用用户名、设备ID、会话ID或IP。分桶为UTF8(flag_key+NUL+账号ID)的SHA256前4字节uint32BE，乘10000/2^32向下取整；仅bucket<百分比×100命中，等于边界不命中，最小精度0.01%。优先级kill→globalOFF→channel→账户override→percentage；admin也不绕过，Flags不授予会员权益。

UI/选题/作答/解释需adaptive_learning和mastery_score共同命中；Mastery独立接口需mastery_score；review接口需adaptive_review，UI复习还需核心双门和review。因flag_key不同，桶相互独立。同百分比核心近似p²、UI复习p³，这是均匀独立假设的解释，不是实际流量。当前甚至adaptive_learning单项在10%以内都没人，交集当然0。

真实D1名单28个活跃账号均Stable，7个潜在语言权益，其中5普通/2管理员。下面是原名单的离线自然桶规划，**不是已开启灰度**；未知账户的权限还需本人正常会话确认。

| 规划比例 | 阈值basis points | A单桶人数 | M单桶人数 | Review单桶人数 | A∩M | A∩M∩Review |
| --- | --- | --- | --- | --- | --- | --- |
| 1% | 100 | 0 | 0 | 0 | 0 | 0 |
| 5% | 500 | 0 | 1 | 1 | 0 | 0 |
| 10% | 1000 | 0 | 2 | 1 | 0 | 0 |

111为既有admin，桶A3611、M4772、Review8840。诊断上同百分比核心需至少47.73%、复习88.41%才能包含它，**未按该ID扩大比例，未换ID或随机值**；反复登录/换设备无效。原三条普通测试账号已退役、凭据失效，不重新激活。现有另一位普通潜在会员在单项mastery5%自然桶，但未授权本人参与测试，不能用管理员模拟当真实流量。

独立NodeSHA256参考计算140项、111重复25项都与正式C1引擎一致；现有CI边界/1000账户向量证据复用。**没有发现分流实现或环境配置缺陷**：OFF0EX是故意安全状态；未定义“所有Flag共享同一1/5/10人群”的原要求，故不为样本修改算法。

### 实际请求与观察状态

2026-10-14T10:11:12.573Z至2026-10-14T10:11:21.378Z仅使用已授权111正常新会话执行3次真实Production /api/features：全部200，canonical身份及Stable通道一致，五项均global_off、revision一致；这些是关闭状态控制请求，不是正向灰度样本。正常login/logout200、该新Session随后的me401；仅正常登录时间/会话/审计写入，没有配置/角色/权益/学习数据修改，其他会话与App50未操作。

C1部署后Stable接受事件/唯一作答仍0。**灰度未开启、自然功能命中人数0、激活观察窗口NULL、激活窗口请求量0；错误率/成功率/p95无分母，均未测量**。既有Beta普通canary和111定向Beta不能填入这个分母。没有遗漏可以替代真实百分比的Production观察证据。

### 可直接审批的具体动作

完整方案：[TASK26_FINAL_STABLE_OWNER_ACTION.md](<%USERPROFILE%/Documents/Codex/2026-10-10/li/outputs/TASK26_FINAL_STABLE_OWNER_ACTION.md>)。原始设计只规定Experimental→Beta→小比例Stable→扩大与实际观察，没有固定1/5/10阶段目的、最低时长/样本、数字SLO；1/5/10原为规划值，24小时/3人/100次旧建议已归档，未追加成强制门禁。

可选新候选：adaptive_learning从OFF/0%/Experimental-only变为ON/100%/Stable-only作为依赖；mastery_score从OFF/0%/Experimental-only变为ON/5%/Stable-only作为唯一核心百分比门；review/AI/辨析3项不变，全部不设用户override。A100%布尔值覆盖28人，但选题、事件、解释仍须M5%，Mastery接口也是M5%，UI也是双门，review独立关闭；因此目前核心功能自然只选1个普通潜在语言会员，111不选中。这个100%依赖策略是**新增待审配置范围**，没有从此前一般发布授权推定获准，不擅自执行。

它只是核心pilot候选，不宣称全部功能Stable完成。启用前需所有者批准目标值和范围，确认自然成员本人参与、正常会话有对应语言权限，指定实际香港时间窗口并确定原文未定义的观察判定。不得给该人新权益/改角色补样本或由管理员冒充。实际记录人数/请求/事件/完整延迟/错误、固定自然bucket、Mastery/课程/权限/幂等/回退和旧Quiz情况；身份/权益、重复和无效状态必须无异常，失败时马上停止，数字SLO不虚设通过。

回退先关/kill主门M，立刻阻断核心新请求，再关A；正常API使用最新revision/CAS，冲突停止。恢复两项OFF/0%/Experimental-only和原描述，保留新revision/audit；其他3项不动，保留事件/Schema，不reset/restoreD1、不清App50、不改签名或Stable。当前没有执行配置或实际回退，原已通过Kill证据保留。

### PR109依赖和最终状态

2026-10-14T10:12:15.577Z实际PR109仍OPEN Draft/8b8dd15、未合并。依赖顺序是**Stable适用观察通过→PR109精确CI/受控正式日志发布/云静态一致→最终Closure**，并不是先CLOSED才可发日志；没有循环门禁。当前保持Draft，尚不发布。所有原门禁保持其范围的PASS；新的Root/Control分析PASS；实际Stable和日志发布仍BLOCKED，Task26 INCOMPLETE。

**OWNER ACTION REQUIRED**

批准该新增A100%依赖+M5%自然核心pilot，并确认那一名自然命中普通会员本人参与、实际观察窗口及接受范围；或保留原同百分比策略并安排真正自然命中的受众。111仍不具备该小比例命中，不能单靠重复111实验解除。当前五项OFF，原有数据/签名/Stable受保护，Android与财务AI尚未开始。

## 历史参与者选择（有日期，不代表已批准本轮候选）

2026-10-14T09:49:50.077Z，用户再次明确选择此前测试账户111。本轮已完成其真实浏览器验收，保留有效admin身份，不修改角色或权益、不重跑已经完成的作答。该账户未自然命中已核查1%/5%/10%的核心组合桶。最新回答没有提供实际观察起止时间，也没有采用所建议的24小时/3人/100次数字标准或授权为使账号命中而扩大比例。建议数值不是原始必需门禁；当前INCOMPLETE原因是实际百分比灰度没有有效样本和完成观察，不是强行追加建议样本要求。五项Flags继续OFF。

## 本轮剩余门禁的实际结果

URL访问已通过现有受控E2E方式恢复。原Codex Windows工具失败在读取当前Chrome URL、导航/登录之前，其安全保护未关闭或绕过，也不宣称该工具自身已修好。系统DNS可以解析，返回的198.18.0.16是本机网络解析路径，不冒充公网DNS记录；严格TLS1.3证书/SAN/主机名校验通过，HTTP登录入口301只跳转到同一域名HTTPS/login200。HTTPS登录/英日页面无额外跳转，最终域名均https://thewyj.uk。Production同源安全策略与认证没有修改。

现有CI的CdpClient连接组件复用于新的独立Chrome155.0.8059.40进程/用户目录/BrowserContext，只连接本机127.0.0.1；未运行或放宽仅允许本地D1的全量fixture脚本，未注入test_mode、伪Session、忽略证书或关闭sandbox/web安全，未附加原管理员Chrome或正式App50。真实账号111正常表单登录200，canonical身份/有效admin角色/既有英日权益核实。

真实浏览器英日各一正一误、Mastery、下一题、reload、AI关闭的课程回退全部完成。英语错误答案在服务器实际200接受后，仅对本测试上下文丢回执；UI显示待同步，同一ID重试恢复，远程仍只有一条原答题事件。四条UI作答各同ID重放均原收据、D1count1；课程回退没有改变Mastery，无浏览器运行异常。该结果属于管理员测试账号，不是普通会员或自然百分比样本。

四次UI作答产生严格14条新唯一事件：shown4/submitted4/correct2/incorrect2/explanation_opened2。先前API四答12条仍保留，总26条事件、6条Mastery状态。额外两条是实际点击错因解析按钮时由产品代码发出的合法事件，不能当重复入库。首轮导航等待错误及末轮错误的12条总数假设全部存档；仅对已执行的证据进行只读严格协议核对，没有再制造答案、删除产品/CI断言或隐藏失败。

Production配置本轮**临时发生变化并已恢复**：只给111定向Beta，核心三项ON/0%且Stable排除；AI/辨析始终OFF。恢复五项OFF/0%/Experimental-only，111原Stable偏好恢复revision6，三个覆盖恢复NULL；全局revision依次为adaptive_learning:33、adaptive_review:26、ai_error_explanation:11、mastery_score:28、similar_word_explanation:9。正常注销两个本轮独立浏览器会话且原Token401，其他会话/角色/会员原记录保持，测试账号没有删除或改密码。测试26条事件及审计有意保留，不能称数据未发生变化；其他账户Task26事件/状态0，invalid0，pending0。未改正式APK/签名/App50/Stable指针，未发布新网站或迁移。

普通用户：**PASS（复用C1真实Production普通语言会员canary，21项、4答）**；窗口2026-10-13T07:32:36.233Z至2026-10-13T07:33:36.681Z，15个实际API请求无非预期HTTP错误，p503537ms、p954333ms。它是小样本功能结果，不能代表广泛流量。原账户已按既有流程退役、普通role保留、无admin授权，有效会话/会员/覆盖0；本轮不复用失效凭据、不重新激活、不创建新权益。此前Hosted/三星A/B与权益拒绝证据保留其原环境范围。

Stable：**BLOCKED / 未执行 / 观察不足**。本轮只读D1统计部署C1以后Stable接受事件0、唯一作答0；成功率、错误率、p95均无分母，记录NULL，不能填100%/0%。2026-10-14T09:38:33.025Z的受众规划仍28个Stable账号、7个潜在语言会员，1/5/10%核心组合有效受众均0。管理员同样经过kill/global/channel/override/bucket门禁，角色不绕过百分比，旗标不赋予会员权益。

原始Task26设计/交接和用户附件仅要求Experimental→Beta→小比例Stable→扩大及真实指标/窗口/kill，未给定固定1/5/10%、最短时长、样本或数字阈值；Task25只规定分桶优先级、比例精度和30秒TTL。没有把此前的规划比例或新建议追溯写成原门禁。旧24小时/3人/100次建议已单独归档，未采用为原门禁；本轮具体候选及未执行状态见顶部最终分析和OWNER ACTION文件。

| Gate | 实际状态 |
| --- | --- |
| URL/DNS/TLS/最终域名 | PASS，已批准受控E2E访问；原Windows工具保护保留 |
| 111真实浏览器作答/Mastery/去重/回退 | PASS，有效admin；原脚本失败保留并严格只读核对 |
| 普通用户功能/权益 | PASS，复用C1小样本Production普通会员证据 |
| CI、0025、Schema、Production部署 | PASS，复用无源码变化的原证据 |
| Experimental、Beta canary、Kill | PASS，原有限范围证据；不宣称广泛SLO |
| Stable准备/监控方案 | PREPARED，量化建议待采用 |
| Stable百分比实际执行/观察 | BLOCKED，有效受众和窗口缺失，实际样本0 |
| PR109正式日志发布 | BLOCKED，随最终发布门禁保持Draft |
| App50隔离写入 | WAIVED_BY_OWNER，绝非PASS |
| Task26最终关闭 | INCOMPLETE |

真实灰度门禁未满足，Android Hotfix与财务WorkersAI未启动。本轮证据分别为task26-url-root-cause.json、task26-controlled-browser-url-probe.json、participant-111-browser-reconciliation.json、task26-stable-closure-audit.json和最新participant-111-posttest-protection.json。

## 上轮只读安全核查（历史有日期证据）

2026-10-14T08:39:43.845Z：0025 Ledger 仍只有一条，四表、四索引、Trigger 的完整 SQL 和三项 metadata 与最初正式迁移后的真实证据完全一致；迁移文件 SHA-256 未变，没有重跑迁移。三条已退休专用账户的有效会话、管理员权限、会员及覆盖均0。五项 Flags 的最新 OFF/0%/Experimental-only 和111原Stable偏好已再次只读核实，无其他账户新Task26事件。

Pages 最新只读快照 2026-10-14T08:37:27.500Z 确认 Production 仍为C1 / 74c90a72，原Git自动部署 ENABLED。一次管理接口OAuth过期通过现有Wrangler配置正常刷新后重新查询成功，没有覆盖密钥或修改配置。最新 main 与 PR109 精确提交 CI 均8/8 SUCCESS，旧失败证据保留，没有重复运行通过的测试。

正式英语、日语入口、service worker、公开App更新元数据四个实际HTTP请求均200；service worker与正式C1源码逐字一致，公开正式APK仍uk.thewyj.app / 1.3.37 / 50，大小及SHA-256一致。此项仅为公开HTTP/源码/元数据核查，不代替已登录浏览器或新增真机验收。本轮没有Production写入、App50操作、新AI调用或APK/Stable指针修改。

上轮额外111浏览器实验受Windows工具URL观测保护阻断，未执行；本轮已通过独立受控E2E完成，见顶部实际结果。原保护未关闭，原管理员浏览器未改。

2026-10-14T09:38:33.025Z的实际只读受众核查仍为28个Stable账户、7个潜在语言会员，1%/5%/10%必需组合桶均0；未启用Stable比例、未制造受众或流量。当前仍缺真实百分比灰度观察，Closure保持INCOMPLETE，后续Hotfix/财务AI按既定顺序等待。

## 当前正式环境

PR105/106/107/108 已合并；main 与实际 serving commit 为 `c1f32485028c9ce9114d21cab4af3bb46961359c`。Production Deployment ID：`74c90a72-5b91-472d-97b2-08588256ee9c`，2026-10-13 06:49:25UTC 创建。精确 main CI38356118942 attempt2 全部8项 SUCCESS；首次云端连接失败和一次同源码重试保留。Production Git 自动部署已恢复 ENABLED，本轮只读确认；Preview 分支配置保留。当前正式网站仍为2026.10.12.1/r7。

## D1、业务与安全保护

Production0025 于2026-10-11 15:15:00UTC **执行一次**。SHA256：`4664bbc91a8d1b6158ee58532186b38c870cb677c17c289e072e1cb4afd4adef`。Ledger1、四表四索引一不可变事件 Trigger、三项 metadata 验证通过；没有重复迁移、数据库重置、数据恢复或原记录覆盖。初始迁移前 bookmark：`00000cb3-00000000-00005101-16075a3abb2243a11be1661b8a1ddcc9`；最终部署前 bookmark：`00000d1e-00000000-00005103-715c8e1faacadc553299ffd9d038d14c`；111实验前只读 bookmark：`00000d6d-00000000-00005104-7fc430de14493393ed34a0364c60ee9b`。

111实验前、2026-10-14T05:57:09.865Z只读核查：非测试 Task26 events/states0，invalid states0，pending receipts0。原会员方案/权益及旧 Flags/overrides/preferences 五组哈希一致。财务175、通知199、文件280、上传91、分享26、旧学习同步233。旧财务164/通知184，以及部署前166/187行均保留，无之后更新；增量为既有路径的新记录，不回退、不声称总数未变。仅读取数量、时间、来源及状态元数据，没有金额、商户、聊天或通知原文。该审计不证明支付识别正确性。

三条专用 Production 测试账户通过正常自注销接口清理；两条临时语言会员正常取消，10条活动覆盖通过正常管理员 UI 清除。最新 active sessions/memberships/overrides/admin authority 均0，凭据失效。正常测试浏览器已回到登录页。不可变学习事件、审计及惰性 NULL 覆盖记录保留；未删除真实用户或业务记录。已验收的 Preview 专用账户和临时角色清理证据保留，本轮未再创建管理员。

| Flag | Global | Kill | 比例 | 通道 | Revision |
| --- | --- | --- | --- | --- | --- |
| adaptive_learning | OFF | false | 0% | Experimental | 33 |
| adaptive_review | OFF | false | 0% | Experimental | 26 |
| ai_error_explanation | OFF | false | 0% | Experimental | 11 |
| mastery_score | OFF | false | 0% | Experimental | 28 |
| similar_word_explanation | OFF | false | 0% | Experimental | 9 |

## 实际验收与限制

Experimental：专用普通账户功能验收通过。英语、日语在自然10分钟到期且20分钟评分冷却内的复习真实通过：review count1、due queue0、无额外 score/confidence/effective evidence，同ID回执及D1唯一事件。Workers AI 英/日各一次实际 generated；当日2请求/2成功/0失败，模型延迟合计2599ms，AI不改变Mastery。此前两次 schema-invalid 安全课程回退保留；没有以固定JSON或缓存冒充模型生成。账单成本未测量，不声称为零。

Beta：单个真实专用普通会员 canary 通过21项检查，4个英/日事件各接受一次；AI通道限制和课程回退通过。15次实际学习API请求0非预期HTTP错误，p50 3537ms、p95 4333ms，观察窗口2026-10-13T07:32:36.233Z至2026-10-13T07:33:36.681Z。这是约一分钟小样本及API验证，不能代替广泛用户观察或生产SLO。

Stable：**NOT STARTED / OBSERVATION INSUFFICIENT**。2026-10-14T09:38:33.025Z只读受众审计：28个原Stable账户、7个潜在语言会员；1%/5%/10%必需功能组合桶均0。它是自然分桶规划，不是流量或验收。没有修改算法、选择性重建账户、制造流量或使用定向覆盖冒充百分比通过。用户提供参与标识111；只读精确匹配1个基础role=user账户，具备有效英日语言权限，未命中1%/5%/10%必需功能组合桶。初始检查未包含Task18角色，正常登录随后确认有效角色为既有admin；未修改角色或权益。用户明确表示没有真实试用窗口、111为测试账户，后续结果按此范围记录。指定测试账户不等于已有有效百分比受众。

Kill Switch：真实Experimental/Beta新票据均被阻断，原会员/免费Quiz仍可用。首轮较晚观察上界58649ms、精确变化时刻未知，未标为30秒内通过；正常浏览器定时复测观察上界20562ms通过，两个记录均保留。随后五项配置恢复OFF/0%/Experimental-only。功能关闭/恢复实际执行，代码回滚和Time Travel restore未执行；保留旧已验证e5部署作紧急参考，任何恢复均先关功能、保留 additive schema和历史。

正式 App50：Samsung SM-S9360/Android16 上正常打开Production英/日设置页及前后台日语恢复，原wyj登录可见；没有换号、答题或读取/清理Cookie、Room、账户与密钥。最近2026-10-13T10:34:19.460Z核查包名uk.thewyj.app、1.3.37/50、UID10406、APK哈希、18项权限、无障碍/通知监听及用户0/95/150与本轮前值一致，User10不存在。APK SHA256：`9a4fad7f01c1dd1013efbcabd3931ea6c698b52dc2d2ce10cd18745ad7d7f55a`；原signer SHA256：`2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03`。现有APK、签名、R2 Stable和更新元数据未修改。没有直接比对Cookie/Room字节，也没有完成原App50隔离写入；该项仅WAIVED_BY_OWNER，端到端写入风险仍在，禁止再建工作资料。

## 先前API实验（历史证据、独立范围）

用户提供凭据并要求登录该测试账户实验，凭据仅存本机CurrentUser DPAPI，不写报告、Git或公开日志。实际正常登录200，canonical身份、英日权益及既有管理员角色验证通过；第一次操作脚本错误地只接受普通角色，失败记录保留，使用已被服务器接受的同一凭据取得新会话，没有继续猜测另一候选或重置密码。该账户有既有Task18 admin角色，不能冒充普通会员验收。

2026-10-14T06:37:14.230Z至2026-10-14T06:39:08.105Z，只使用真实Production正常管理员/本人API：全局OFF票据403，暂时将本人通道设Beta，三项核心Flags ON/0%/Beta+Experimental、只给111定向覆盖，其他账户保持不命中。实际英/日正误4次作答、同ID回执、D1唯一性、Mastery摘要、AI关闭的课程回退和不改变Mastery均通过。此前自然到期/模型生成/普通账户证据复用，不重复无必要测试；本轮不调用新AI。

四个logical answers对应12条独立不可变事件：question_shown4、answer_submitted4、answer_correct2、answer_incorrect2，每类eventID唯一；两条Mastery状态。操作审计先误把所有事件数量当作作答4，已按现有协议严格核对12条及全部kind，原错误保留，没有修改产品代码或CI断言。

2026-10-14T06:39:40.203Z，先前API实验后五项Flags恢复OFF/0%/Experimental-only，111本人通过正常CAS恢复Stable，临时覆盖为惰性NULL；角色、原会员记录、其他会话和旧业务未改，未注销/删除已有测试账户。仅清理本轮两个会话：第一条丢失到本机验证错误的会话由唯一创建时间及专用UA登录审计对应后经合法Cloudflare管理撤销；当前会话正常logout200后me401。未从D1读取或重建Token，不清理其他人的有效会话。

111的12条新实验事件、两条状态、偏好revision和审计变化均为用户最新明确授权的可审计测试变化，保留、不隐藏为零。排除已注明的实验账户后其他用户新Task26 events/states0、invalid0、pending0、0025ledger1。所有无关原配置行五组哈希一致，111本人原通道语义已恢复，原会员/角色保留。本轮财务175/通知199/文件280/上传91/分享26/旧同步233。正式App50和原wyj浏览器没有换号或数据清理。

实验后仅获取D1只读bookmark `00000d76-00000000-00005104-57cb4278e5f638883ce0e45d89671428`，没有restore/reset或重跑迁移。

以上仅为先前API定向Beta实验；本轮真实浏览器证据另列顶部。两者均为已有管理员测试账户，均不替代普通会员、自然流量或Stable百分比观察。

## 更新日志待审稿

[PR109](https://github.com/WYJ0904/thewyj.uk/pull/109)仍Draft，HEAD `8b8dd156bb01d707200ab2ed3c04c4f8f00e40e5`。精确CI38368815826 attempt2 **8/8 SUCCESS**；最终COMMENT review5502587302，未声称独立APPROVE。首次Task25并发检查18/30失败、本地原样12组通过、一次同源码同断言重试均保留，不删断言，底层瞬态原因未进一步证实。

候选网站2026.10.13.1/r8，保留全部53条旧源日志；25个运行文件除缓存版本字符串外与C1一致，无后端/原生/迁移/签名改动。真实Preview Deployment33b29cb9-eaab-4cc8-aabd-3780c9590b08四个资源字节一致，Hosted匿名页面、新云端/静态条目一致性、三星独立Preview测试包新缓存加载通过。仅在经核验wyj-cloud-preview增加1条公开日志，原10条云端记录保留，未改Production公共日志。三星此项明确属于独立Preview包，不是正式App50结果；首个脚本错误Activity启动已保留并改为真实PM解析组件，未绕过权限。

该PR未合并/正式发布。等真实灰度门禁具备后才可按正确源码、精确mainCI、受控部署及公共日志同步完成发布；不能用当前CI/Preview通过跳过Stable观察。

## 接续条件

当前用户仅提供测试账户111，已完成明确范围实验；真实百分比受众与观察窗口仍未具备。后续需先只读验证真实参与者的权限、通道及自然分桶。未命中有效百分比受众或没有真实学习观察时继续保持OFF，不能把定向测试/开关变化写作百分比Stable PASS。完成所需真实Beta/Stable观察及验证后的日志正式发布，才能填写最终Closure COMPLETE。

Android无障碍/自动记账Hotfix：NOT STARTED，须独立分支、原签名、真机、发布及Closure，在Task26完整Closure之后自动继续。财务Workers AI：NOT STARTED，在独立Android Hotfix Closure之后按既定隐私授权、真实推理、金额/证据校验及人工确认要求继续。未擅自调整顺序，也未混入当前分支。

机器可读状态：[release-state.json](<%USERPROFILE%\Documents\Codex\2026-10-10\li\work\task26\production-release/release-state.json>)。本地完整证据位于work/task26/production-release，所有凭据只在私有加密位置，不进Git、报告或公开日志。
