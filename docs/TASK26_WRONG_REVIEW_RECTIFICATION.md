# Task 26 错题复习整改

状态：IMPLEMENTED / VERIFYING；不改变既有 Task26 CLOSED_WITH_OWNER_WAIVER 历史结论。

## 执行前审计

2026-10-15（香港）：固定工作区仍在 Android Hotfix 分支 e2febc6，含未提交工作。
已读取 WINDOWS_WORKSPACE、WORKSPACE_MIGRATION_REPORT、PAUSED_DEVELOPMENT_HANDOFF。
本次明确整改指示仅恢复 Task26；Hotfix、财务 AI 和历史豁免保持原状。
隔离工作树由固定仓库创建，分支 codex/task26-wrong-review，起点 origin/main
74eadf589b0a6ffe1e5ab7a9564115891c4ef2dc（git ls-remote / fetch 核对）。
受保护工作区文件 SHA256 清单保存在忽略的 artifacts/task26-rectification/。

实际调用链：reviewBtn/reviewHistoryBtn → startWrongReview → startQuiz → 原 answerForm。
释义复习使用 evaluateLocalMeaning；听写目前仅 normal 模式启用，需恢复错题题型。
成功调用 removeReviewedWord 直接删除；失败 markWrong 同时更新两本且覆盖题型。
sanitizeWrongBook 丢弃未知字段；Task11 的 wrong 记录键是档案/范围/词条，
wrong_count 用 max 合并；人工重新作答正确也直接删掉两本记录。
runtime 按账户/语言保存，未隔离档案。

另一链：createMasteryController → masterySection → adaptive/next → 固定 catalog
→ 独立表单 → events → mastery-v1。其 localStorage 和 IndexedDB 双重保存待同步
事件，已有幂等 ledger、服务端判卷、CAS 投影和版本校验，不能直接删除存储。
0025 已占用；新增对象使用 0026。Task25 的五个 Flag 和会员授权继续由服务器
有效结果决定。Task11 的 tombstone 必须优先于旧缓存/并发在途响应。

## 实施约束

原五个标签、两个复习按钮、startQuiz 和判卷/跳过/下一题/恢复继续使用。
新排序只能选择本范围真实错题；无到期记录允许主动复习，无新词混入。
首次正确保留错题；有效练习有冷却、日上限、跨天证据，算法明确版本。
本地证据可以辅助离线练习；只有服务端实际确认才能显示已同步。
旧题只提供恢复已签发题目的兼容流程，不再提供新固定题库入口。
不变更 Android 原生代码、APK、签名、R2 Stable、账户或生产 Feature Flags。

## 验证与发布

本次 Samsung 真机已由所有者明确暂缓：UNVALIDATED / DEFERRED_BY_OWNER。
这不是本次 release gate PASS，也不是引用旧 Task26 豁免放行。

## 最终调用链与算法

- reviewBtn / reviewHistoryBtn → startWrongReview(明确范围) → 原 startQuiz → 原
  answerForm / submitAnswer / skipWord / beginQuestionTransition。没有第二套 session、
  表单或导航。普通在线新测验仍走 Task15；已有错题不因网络、放量、会员或
  旧 adaptive_review 独立题库开关而失去复习入口。
- wrong-review-v1：到期加权 100，原错误次数（上限20）×3，未掌握程度×0.3，
  最近复习间隔（上限30天），近期失败加权30，已记录失败率×20。
  最近刚做过的题扣200，其他近期题扣30；同分按键排序，结果可复现。
  本轮排序只选择 current；历史先选择到期，再允许主动巩固已有项目。
- 首次有效正确20分；同一题至少冷却20分钟、UTC日最多1次，且须达到下一
  复习间隔；连续5次有效正确、5个不同UTC日期才能达到100分/已掌握。
  间隔为1、3、7、14、30天。错误清除连续正确，扣分不低于0，并安排10分钟
  后强化。旧 wrong_count 仅排序参考，不生成过去练习事件或成功证据。
- server accepted_at / seq 是可信时间与顺序。离线集中上传不会伪造离线期间
  的多个可信日期。本地状态标为“本地”，待确认不当作服务器已同步。
- 正确保留两本既有记录，不再删除；用户主动删除/清空通过 Task11 tombstone
  传播。人工纠正排除被纠正事件，不奖励新成功次数；有需要时复用原 Task15
  的服务端人工复判规则/缓存，普通错题复习不调用LLM判定每一道题。

## 数据、同步与兼容

wrong-book 保留原账户/档案键，条目增加 word、review_id、review_updated_at 和
版本化 review。听写使用题型专用键，释义兼容原词条键。review_id 包含语言、
题型、完整词条及生命周期ID；服务器另以账户/档案隔离。current/history 列表
各自独立，同一生命周期题目的掌握证据共享，避免两个范围重复奖励。

sanitize、合并、导入JSON、导出JSON/PDF、Task11客户端/服务端合并均配套。
有界本地事件集合按ID合并；压缩后错误次数保守取max，避免旧副本反复抬高
计数。服务端保留完整不可变事件，增量CAS投影；纠正时按原ledger重建。
新答案先保存稳定 attempt/event ID、原反馈与判卷快照，再完成 IndexedDB
持久保存，之后同步原错题，最后提交事件。刷新和失败重试复用原ID/原判卷，
不覆盖已保存答案；跨账户/档案的迟到响应不生效。

source_digest 把离线答案绑定到当时标准、题型和判卷模式。另一设备改动标准时，
服务器从该用户 Task11 历史查找匹配版本；不能确认原版本时保留待确认，
不会按新标准偷偷重判。Task11 tombstone 优先于旧缓存和迟到响应；主动导入
发生在本机在途删除之后时，保留明确的恢复修订，避免误伤用户主动恢复。

0026 仅新增 task26_wrong_review_events、task26_wrong_review_states、索引和
不可变trigger。不重写0025，不删旧表，不改变旧Task26历史或原财务/会员对象。

mastery.js 已退役为恢复适配器。保留 aerisMastery:v1 和原 IndexedDB journal；
旧题/待确认事件可在 Flag关闭、原票据过期后，按已存在且属于该账户的签发
题目恢复，重放原事件ID。仅在有旧题时显示一次恢复操作，并复用原答题界面；
恢复不会重复计入完成轮次或轮次成就。没有档案字段的旧普通测验runtime保留，
需用户明确选定当前档案才迁入v2，不自动串到其他档案。

| 既有 Flag | 新流程含义 |
| --- | --- |
| adaptive_learning | 智能排序/可信事件总开关 |
| mastery_score | 服务端掌握状态与确认 |
| adaptive_review | 原错题范围的智能间隔复习；关闭仍能普通复习 |
| ai_error_explanation | 保留旧已签发题目的可选解析兼容；不参与新排序或判卷 |
| similar_word_explanation | 同上，旧解析辨析兼容；无新增独立面板 |

继续使用Task25原通道、百分比、用户覆盖、Kill Switch和审计，没有新Flag。
业务权限以服务端有效 entitlements 为准，不把普通管理员身份当作开放证据。

## 当前证据

| 项目 | 状态 |
| --- | --- |
| 本地Core JS脚本 | 62/62，早期完整检查；最终受影响套件另行运行 |
| Python全量 | 185 tests，0 failures；最终static 31 tests另过 |
| Android基线回归 | 78 suites / 545 tests，0 failures/errors/skips；Lint / Debug构建PASS；native差异0 |
| Chromium本地矩阵 | 320/390/768/1366/1920，深浅色；原入口/首次正确/刷新/范围/听写/离线/Flag关闭共40组已过；新增兼容用例继续验证 |
| 新D1套件 | 已过10组，含原判卷版本、并发/幂等/纠错/删除/重建；迁移保护新增断言继续验证 |
| Preview D1 | 实际只读确认待迁移0026后，仅对Preview a3e6253b-689f-49f3-998b-7c5828ea255a应用0026成功 |
| PR / 远端Core CI / Hosted UI | 待补充精确Commit和链接 |
| Production | 实际Pages仍为566292b3-3c7f-4ef5-93b5-6977e606c14a / main74eadf5；本次未迁移或部署Production |
| Samsung真机 | UNVALIDATED / DEFERRED_BY_OWNER；不以Chromium、Debug构建或HTTP代替 |

完整本地日志进入忽略的 artifacts/task26-rectification/；保留失败日志。
浏览器矩阵的TTS供应商故障由明确503 fixture覆盖，发音provider另由既有TTS
单元测试覆盖；不声称矩阵验证了真实外部音频或手机扬声器。

## 发布与回滚

生产门禁未满足前不发布，不以历史豁免代替本次证据。正式APK仍1.3.37/50，
没有改签名、发布元数据、R2 APK或Stable指针。Hosted Preview和本地证据分开。
实际发布前需重新记录生产source部署、D1 Time Travel bookmark/既有备份策略，
核对0026待执行与源码hash，再完成生产审批/剩余门禁。

首选回滚是使用Task25原管理入口关闭这三个既有智能Flag，基础复习继续可用，
事件留在本机/服务端。若需回退Pages，在管理CLI中列出同项目production部署，
选择本报告记录的旧deployment执行原Pages rollback流程。不得回滚SQL删表、
删除ledger或旧Task26历史；0026保留不会影响旧服务。下一次启用时按原事件恢复。
