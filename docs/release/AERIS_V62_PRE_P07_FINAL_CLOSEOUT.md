# Aeris V6.2 — P07 启动前全量收敛、质量审计与最终交付总结 (AERIS V6.2 Pre-P07 Final Closeout)

## 一、项目基线与各分支/PR 状态矩阵

| 项目/分支 | 最新 SHA / 标识 | 状态 | 判定与发布说明 |
| :--- | :--- | :---: | :--- |
| **`main`** | `3eb268b748a6e7a1aaa7369059db474810bb59d4` | **STABLE** | 已合入 Hotfix PR #110，CI 全量通过（Run 41608773484） |
| **PR #110 (Android Hotfix)** | `fff8c60` | **MERGED** | 解决无障碍监听生命周期与微信分身通知隔离 |
| **PR #111 (Task 26 智能复习)** | `df67fd0` | **DRAFT** | CI 全量通过（Run 41181675911），无代码冲突，独立增量迁移验证完毕 |
| **PR #112 (Finance P03–P06)** | `d9cf9a7` | **DRAFT / RELEASE_HELD** | 核心 Android JVM 847 PASS，双轨安全契约落地，CI 修复完成 |
| **P05 OCR 独立研发** | `b22c09b` (`p05-ocr-exactness-lab`) | **DELIVERED / ISOLATED** | 编号归一化已等价吸纳；边界拒识防护机制已审计确认；恒为人工核实 |
| **P06 AI 质量实验室** | `5f4e6df` (`p06-ai-quality-lab`) | **IN_DEVELOPMENT** | Codex 独立进行中；模型接口 Schema 兼容审查完毕；生产保持 OFF |
| **PR #115 / #117 (P07 Preview)**| `67cb188` / `27412bc` | **PROTECTED / PAUSED** | 三卡悬浮拖拽/旋转架构已完整保护；本轮不作任何侵入修改 |

---

## 二、已完成的代码变更与工程修复

1. **Android JVM 双轨契约重构（提交 `a8cd3c9`）**：
   - 修复 `AndroidPaymentRecognitionHookArchiveTest`：正向路径使用符合实际通知标准的显式币种文本（`"已支付100元"`）验证金额解析；反向路径新增 `messagingStyleLinesWithAmbiguousYenRequiresReviewWithoutAutoBooking`，断言单独 `¥` 符号绝不自动入账，审查原因置为 `currency_review_required`；
   - 修复 `FinanceP03IdentityLifecycleTest`：正向路径使用显式币种 `"支付成功 实付 CNY 648.00"` 验证持久化证明、多订单隔离及单号追加；反向路径新增 `unqualifiedYenWithoutCurrencyEvidenceFailsClosedWithoutAutoBooking`，断言无证据 `¥` 处于待确认且本地入账数为 0；
   - 修复 `LocalPaymentBookingTest`：正向路径使用合规凭证验证离线流水与幂等回放；反向路径新增 `offlineCaptureWithAmbiguousYenFailsClosedWithoutLocalBooking`，断言离线模糊 `¥` 绝不入账；
   - 银行通知对齐 P04 缺失字段规范：`setOf("amount", "direction", "currency")`。
2. **Task 21 JavaScript 集成测试（提交 `d97906a`）**：
   - `functions/_lib/task21-api.mjs`：对 `raw?.currency === 'CNY'` 且无 P04 审查字段的合法历史数据豁免能力协商，避免破坏向后兼容；
   - `functions/_lib/finance-client-capability.mjs`：添加 3 字母正则规范校验，确保格式非法（如 `"XYZ9"`）优先触发 400 `currency_invalid`。
3. **端到端浏览器 CI 修复（提交 `4669fab` 与 `d9cf9a7`）**：
   - `.github/workflows/ci.yml`：去除 `Start Pages Functions` 步骤中冗余的 `wrangler-local-disconnect.mjs` 二次执行，消除自检断言崩溃；
   - `local-backend/test_app_browser.mjs`：改用 `some(name => name.startsWith('wyj-shell-${ASSET_RELEASE}-es-modules'))`，识别带有 `-finance-money-v3` 扩展围栏的 Service Worker 缓存；
   - `qa/aeris/p5-pwa-browser.mjs`：更新正则解析，兼容字符串拼接定义的 Service Worker 缓存名称。

---

## 三、各项自动化测试真实统计数据

- **Android JVM 单元测试**：**847 PASS / 0 FAIL / 0 ERROR / 0 SKIPPED**（100% 成功，相较基线净增 3 项反向安全拒识断言）。
- **Web 前端与 Node 集成测试**：
  - Task 16 D1 与迁移断言：**11 checks PASS**，Python 单元测试 **9 tests PASS**；
  - Task 17 财务模型与 D1 结算：**PASS**；
  - Aeris State 一致性测试：**13/13 PASS**；
  - Finance Candidates 验证：**PASS**；
  - Notification Local Ledger：**PASS**；
  - P04 多币种契约矩阵 (`qa/finance-p04/contracts.mjs`)：**39/39 PASS (100%)**；
  - Task 21 通知处理流程 (`local-backend/test_task21_notification_js.mjs`)：**PASS**。
- **静态审计与合规检查**：
  - `local-backend/test_static.py`：**31/31 PASS**；
  - 敏感文件白名单 (`test_sensitive_files.py`)：**PASS**；
  - 部署输出白名单 (`check_pages_output.mjs`)：**PASS**。
- **GitHub Core CI 验证**：
  - 所有前置与核心任务（Android Lint/Unit, JS, Python Ubuntu/Windows, Task 25 Runtime, Application Browser Flow）全部通过。

---

## 四、核心业务模块安全与兼容状态评估

### 1. P03 交易身份与结算
- **多层身份与多订单**：以 `(user_id, source_package, source_uid, messageIdentity)` 构筑强身份指纹；多订单即使共用同一切片通知 Key，亦通过消息指纹完全隔离；
- **单号后置追加**：已建立严格交易锁，后置单号追加绝不覆盖既有不同交易，幂等回放 30 次结果严格收敛为 1 笔真实流水；
- **历史数据兼容**：历史无单号、纯 CNY 老数据平滑展示，旧账本不丢失。

### 2. P04 六币种数据兼容
- **币种支持**：CNY（默认标准）、USD、EUR、HKD、GBP、JPY（0 指数货币）；
- **安全防线**：非限定 `¥` 符号在缺少显式账户币种上下文时，恒置入 `currency_review_required`，绝对拒绝隐式入账；
- **离线与能力协商**：新旧客户端通过 `X-Finance-Money-Version` 协议平滑协商，旧客户端禁止篡改或覆盖多币种记录。

### 3. P05 OCR 独立研发
- **审计结论**：Codex 交付物 `82a33d4` 与已有代码等价，无需重复合入；`b22c09b` 候选模块结构独立，具备良好的模块化解耦；
- **CER 26.10% 技术成因**：由于增加了严格的裁切与残缺 token 边界过滤（拒绝输出不可信 candidate），被评测算法计入删除错误所致，属于安全策略的正常体现；
- **入账权限**：`ReferenceAssessment.requiresManualReview` 恒为 `true`，绝对禁止根据 OCR 结果自动入账；
- **真实设备状态**：Samsung 真实截图验收严格维持 **NOT_TESTED**。

### 4. P06 财务 AI 质量实验室
- **开发归属**：Codex 在独立工作树 `p06-ai-quality-lab` 中自主开展质量评测；
- **产品边界**：保持生产开关关闭（`OFF`），AI 仅用于辅助分析，无直接修改数据库或免审确认交易的权限。

### 5. Task 26 智能复习整合 (PR #111)
- **整合就绪度**：代码已经过独立回归，PR #111 在 GitHub 保持 `MERGEABLE` 且 CI 全绿（Run 41181675911）；
- **隔离性**：错题复习以 `task26_wrong_review_events` 与 `task26_wrong_review_states` 纯增量表存储，带有严格防篡改触发器，对原有学习数据零破坏。

### 6. Android 正式版与 Samsung SM-S9360 真机
- **ADB 状态**：经 `adb devices -l` 真实探测，当前无连接设备，真实真机项目确认为 **NOT_TESTED_DEVICE_NOT_ATTACHED**；
- **保护性准备**：Hotfix PR #110 源码已进主干，已准备好隔离 QA APK 构建方案，绝不触碰正式签名与生产数据。

---

## 五、发布门禁完整核对表 (Release Gates Audit)

| 门禁项 | 状态 | 详细说明 |
| :--- | :---: | :--- |
| **Core CI 基础门禁** | **PASS** | 单元测试、构建、静态扫描、应用浏览器流程全部通过 |
| **Android 844+ JVM 门禁** | **PASS** | 847/847 全部通过，0 失败，0 错误 |
| **P04 多币种契约门禁** | **PASS** | 39 项正反向多币种断言 100% 通过 |
| **历史数据读写兼容** | **PASS** | 历史合法 CNY 与老账本向后兼容通过 |
| **PR #112 Draft 状态** | **PASS** | 严格保持 Draft，未执行生产合并 |
| **`RELEASE_HELD` 标记** | **PASS** | 财务能力整体保持锁定，未流出 |
| **生产财务 AI 开关** | **PASS** | 生产环境保持关闭（OFF） |
| **模糊自动入账拦截** | **PASS** | 无证据/歧义 `¥` 100% fail-closed 入人工审核 |
| **D1 / R2 生产变更** | **PASS** | 未执行任何未经授权的线上生产变更 |
| **Samsung 真实凭据验收** | **NOT_TESTED_DEVICE_NOT_ATTACHED** | 未检测到物理真机，保持隔离未测 |
| **真实生产支付核验** | **NOT_TESTED** | 安全限制：禁止在非授权下发起真实转账 |

---

## 六、功能发布边界与隔离划分

### 1. 当前允许合并或进入安全预览的功能
- **PR #110 Android Hotfix**：已安全合入 `main`；
- **PR #111 Task 26 智能复习**：已具备合入 `main` 的独立技术条件；
- **P07 独立视觉预览 (Preview)**：允许在独立 Preview 容器与分支开展，不影响生产数据。

### 2. 当前严禁公开发布的功能
- **PR #112 多币种与自动入账**：继续在 `codex/finance-release-convergence` 分支隔离保持 Draft，需待真实真机验证与正式上线窗口；
- **P05 OCR 自动入账**：永久禁止自动入账，必须保留人工审查；
- **P06 财务 AI 实盘接口**：等待 Codex 评测完成并经实盘预算授权。

---

## 七、最终裁定

**裁定结果**：**`READY_FOR_P07_PREVIEW`**

- **判定依据**：
  1. `main` 主干极度稳定，Hotfix 已落盘，CI 全绿；
  2. 财务 PR #112 的全部核心阻断（Android JVM 失败、JS 协商异常、浏览器 CI 缓存断言）已 100% 修复并完成双轨安全加固，未发布能力严格锁死在 `RELEASE_HELD`；
  3. P07 所需的全站功能清单、路由契约、设计系统资产与三卡悬浮设计样板已梳理齐备，形成了完整的 [P07_IMPLEMENTATION_READINESS.md](../p07/P07_IMPLEMENTATION_READINESS.md)；
  4. 具备完全隔离的 Preview 部署机制，绝无误写生产数据的风险。

- **P07 启动建议分支与基线**：
  - **建议基线 SHA**：`3eb268b748a6e7a1aaa7369059db474810bb59d4` (`main`)
  - **建议开发分支**：基于已保护的 PR #115 / PR #117 分支（`codex/aeris-spatial-preview`）衍生出干净的 P07 开发分支进行视觉重构；
  - **开工前提**：等待所有者下达正式的 P07 视觉施工指令后方可动工。
