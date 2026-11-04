# Aeris V6.2 — P06 Codex 独立专项成果接管与最小安全集成报告

- **报告日期**：2026-11-04
- **当前状态**：`INTEGRATION_COMPLETED` / `OFFLINE_GATES_PASS` / `RELEASE_HELD`
- **集成基线**：最新 PR #112 基线 `9ab3a5667b6230560b64531764720a754922b4c7`
- **独立集成分支**：`codex/finance-p06-integration`
- **独立集成工作树**：`%USERPROFILE%\.codex\worktrees\p06-safe-integration\thewyj.uk`
- **源专项工作树**：`%USERPROFILE%\.codex\worktrees\p06-ai-quality-lab\thewyj.uk`
- **移植来源提交**：
  - 候选安全修复：`f633fc85d91d339a856bf981e25cc0999e4bde32`
  - 离线评测框架：`74ab9f8a03e088d286cb7613a9041dce5ff48b28`

---

## 一、集成准则与保护边界核验

本次集成严格遵循“最小安全集成”准则，严禁整分支合并或整文件覆盖已有修复：

1. **PR #112 六项 Android 双轨契约修复保持完整**：
   - 保留了 Gemini 在基线 `9ab3a56` 中针对双轨币种、生命周期与自动记账所做的全部修复（`AndroidPaymentRecognitionHookArchiveTest.kt`、`FinanceP03IdentityLifecycleTest.kt`、`LocalPaymentBookingTest.kt` 未被覆盖）。
   - 实际运行证实，此前在 Codex 基线中的 6 项旧失败全部持续 PASS（0 FAIL）。
2. **P03/P04 身份、币种与离线记账安全规则**：
   - `functions/_lib/task21-api.mjs` 与 `functions/_lib/finance-client-capability.mjs` 中的货币能力校验、历史 CNY 区分与严格身份守卫 100% 保持。
3. **P06 预算原子性、权限、超时与降级处理**：
   - 服务端原子预算扣减、`finance_ai_decisions` 租期并发控制、日调用上限与断路降级机制完全保持。
4. **Web / Android / 服务端三端输出证据语义一致性**：
   - 服务端（`finance-ai.mjs`）、前端（`ai-assistance.js`）与原生 Android（`FinanceAiEvidence.kt`）同步强制：所有金额角色（无论是被选中还是候选中的辅助角色）都必须具备对应的独立语义依据；严禁从其他候选中借用动作词；禁止将非数字/浮点/超界版本号或置信度隐式强转。
5. **Prompt 与 Cache 版本协调**：
   - `FINANCE_AI_PROMPT_VERSION` 升级至 `finance-assistance-7`，与协议版本及缓存键严格协调，彻底避免复用历史旧 prompt 决策。
6. **生产与发布门禁隔离**：
   - `FINANCE_AI_ENABLED` 生产环境保持关闭；
   - PR #112 维持 `DRAFT` 与 `RELEASE_HELD`；
   - 未执行任何计费真实模型调用，真实模型调用数确认为 0，在线配额记为 `NOT_TESTED_QUOTA`；
   - Argon P07 视觉工作树完全隔离未碰。

---

## 二、旧角色合同两项失败独立分析

在 `qa/finance-p06/ai-v2-contracts.mjs` 回归测试中，存在两项确定性失败：
- `refund-role-only-copies-original-source-money`
- `income-role-is-not-an-expense`

### 根因与安全边界分析
1. **测试用例构造方式**：
   测试中使用的基准输入 `p` 包含候选金额短语 `phrases: ['本次', '扣除']`（属于典型的支出/借记语义）。测试在将请求上下文的 `direction` 强行篡改为 `'refund'` 或 `'income'`、并将角色改为 `'refund'` 或 `'actual_received'` 后，断言校验应当成功并通过金额复制。
2. **安全防护规则冲突**：
   服务端 `functions/_lib/finance-ai.mjs` 的 `hasNetMovementEvidence(candidate, direction)` 规则明确规定：
   - `refund` 方向必须匹配退款词（`['退款']`）；
   - `income` 方向必须匹配收款词（`['收款', '到账', '转账', '已收']`）；
   - 支出词（如 `'扣除'`）严禁被认定为退款或收款依据。
   因此，校验器正确拒绝了这种“语义与方向冲突”的输出，抛出 `finance_ai_semantic_evidence_insufficient`。
3. **处理决策**：
   **严禁通过删除测试或放宽安全规则来掩盖红灯。** 这两项失败真实反映了“凭空变更交易方向而缺少原文依据时系统必须坚决拒识”的安全防护设计，属于预期保留的安全红灯（21 PASS / 2 FAIL），历史原件与断言完整保留。

---

## 三、确定性测试与全量回归实测结果

### 1. P06 专项测试矩阵

| 评测套件 | 实跑命令 / 脚本 | 测试结果 | 关键特征 / 备注 |
| :--- | :--- | :--- | :--- |
| **87 项确定性评测** | `evaluate.mjs` (via `run.py evaluate`) | **87 PASS / 0 FAIL** | 覆盖 A–H 组；Base 上 8 项角色越权漏洞全部闭环修复 |
| **32 项 Android Native P06 专项** | `*FinanceAi*Test` (via Gradle) | **32 PASS / 0 FAIL** | `FinanceAiQualityLabTest` (9/9) + `FinanceAiTest` (23/23) |
| **40 项本地 D1/API 专项** | `qa/p06-ai-quality-lab/api.mjs` | **40 PASS / 0 FAIL** | 涵盖多币种、来源、预算耗尽、降级与超时回退，零真机模型调用 |
| **独立安全守卫** | `local-backend/test_finance_ai_quality_guards.mjs` | **10 PASS / 0 FAIL** | 验证三端对未选定角色独立依据、标签借用拦截与人工确认必须性 |
| **评分器一致性** | `qa/p06-ai-quality-lab/scoring.test.mjs` | **13 PASS / 0 FAIL** | 覆盖 Schema 准确性、未选定动作、零分母与脱敏回放 |
| **历史响应脱敏回放** | `qa/p06-ai-quality-lab/replay.mjs` | **12 / 12 回放成功** | 严格保留历史真实模型成绩：Llama-3.3 2/6，Qwen3-30b 3/6 |
| **P06 历史回归集合 (10 项)** | `qa/p06-ai-quality-lab/regressions.py` | **9 项 PASS / 1 项保留 FAIL** | `roles` 维持 21 PASS / 2 FAIL；`rich` (51), `recovery` (14), `migration` (7), `protocol` (17), `boundary` (8), `quality` (76), `atomic` (11), `budget` (18), `chrome` (11) 全部 PASS |

### 2. PR #112 完整工程回归矩阵

| 验证领域 | 实跑命令 / 测试用例 | 运行结果 | 审计结论 |
| :--- | :--- | :--- | :--- |
| **Android 全量单元测试** | `.\gradlew.bat testDebugUnitTest` | **856 tests PASS / 0 FAIL / 0 ERROR** | 基线 847 项 + 专项 9 项 = 856 项全绿；此前 6 项旧失败全部保持修复通过 |
| **Android 质量与打包** | `lintDebug assembleDebug assembleDebugAndroidTest` | **BUILD SUCCESSFUL (156 tasks)** | 无阻断级 lint 问题，测试与调试 APK 均构建通过 |
| **Cloudflare Worker 编译** | `npm run cf:check` | **✨ Compiled Worker successfully** | Functions 语法、路由与打包完全一致 |
| **Task 16 财务核心** | `npm run test:task16` | **11 D1 checks PASS, 9 Python PASS** | 账本同步、拆分、合并与冷启动一致 |
| **Task 17 财务 Web** | `npm run test:task17` | **Web model PASS, D1 tests PASS** | 多币种、汇总、过滤器、墓碑机制正常 |
| **Task 21 支付与通知** | `npm run test:task21-payment` & `test:task21-notification` | **ALL PASS** | 隐私边界、幂等入账、候选状态机、去重与记账聚合正常 |
| **Aeris 状态一致性** | `npm run test:aeris-state` | **13 tests PASS, 候选/流水 PASS** | 终端一致性、刷新防抖与会话隔离通过 |
| **真实模型调用数** | 全过程监控 | **0 次** | 未消耗付费配额，无任何模型凭据泄露 |

---

## 四、结论与发布控制

1. **P06 安全成果接管完成**：候选修复 `f633fc85` 与评测框架 `74ab9f8` 已最小化移植到基于 `9ab3a56` 的独立集成分支 `codex/finance-p06-integration`。
2. **门禁与状态保持**：
   - PR #112 保持 `DRAFT`；
   - 生产环境财务 AI 保持关闭（`FINANCE_AI_ENABLED: false`）；
   - 正式发布门禁继续保持 `RELEASE_HELD`；
   - 真实模型质量缺陷（2/6、3/6）明确隔离，不伪称模型质量已通过；
   - 独立视觉 Preview 分支（PR #115 / PR #117 / Argon P07 工作树）不受任何干扰。
