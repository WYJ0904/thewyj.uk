# Aeris P07 / Task26 — 历史离线复习提交超时根因调查与修复报告

- **状态结论**：`P07_OFFLINE_REVIEW_ROOT_CAUSE_FIXED`
- **仓库**：`WYJ0904/thewyj.uk`
- **调查基线**：PR #132（分支 `codex/p07-task25-d1-concurrency`，基线提交 `91f0d466361ee80fbd6475facea0b9620f950661`）
- **独立工作树**：`C:/Users/78252/.codex/worktrees/p07-offline-review-root-cause/thewyj.uk`
- **任务分支**：`argon/p07-offline-review-root-cause`
- **原始失败运行**：GitHub Actions Run [`42186871114`](https://github.com/WYJ0904/thewyj.uk/actions/runs/42186871114) / Job `Browser flow (application)`（Job ID `127790499853`）
- **失败测试项**：`wrong search, JSON/PDF export, import and offline review`（`local-backend/test_app_browser.mjs`）
- **错误消息**：`timeout waiting for offline review answer`

---

## 1. 原 CI 故障的时间线

通过对原始失败运行 `42186871114` 的产物包 `browser-application-reports-1`（Artifact ID `13487997976`，含 `browser-application.log`、`browser-application-report.json`、`backend-application.log`、`chrome-application.log`）逐行比对，还原故障时间线如下（UTC 时间 `2026-04-06`）：

1. **`09:11:34`**：`wrong search, JSON/PDF export, import and offline review` 测试启动，首先执行 `hello\nworld` 两道题跳过并进入错题本，随后清空本轮错题并导入 `wrongFile`（`hello`）。
2. **`09:11:35`**：对 `hello` 执行在线重新判定（输入 `"你好"`，调用 `/api/quiz/start` 与 `/api/judge`），`hello` 判定正确并从本轮错题本移除（`wrongList` 变为空），同时触发 `saveState()` 与 `learningSyncManager.schedule(900)`。
3. **`09:11:36`（同一 UTC 秒内第一次导入）**：
   - 测试在 `local-backend/test_app_browser.mjs:1496` 调用 `setFiles("#wrongDataFileInput", [wrongNoRubricFile])` 导入无标准释义的旧错题 `network`（`correct_answer: ""`, `rubric.gloss: ""`）。
   - 由于 `setFiles` 先调用 CDP `DOM.setFileInputFiles`（触发一次原生 `change` 事件），紧接着又派发一次合成 `dispatchEvent(new Event("change"))`，而 `app.js:6653` 的 `importWrongData` 在异步 `await file.text()` 与 `alert()` 之后的 `finally` 块才清空 `event.target.value = ""`，导致**每次 `setFiles` 均并发执行了两次 `importWrongData`**（原失败报告 `dialogs` 数组记录了 **6 次** `"错题数据导入完成：历史错题 2 个。可以直接进入本地复习。"` 弹窗，而脚本仅调用了 3 次 `setFiles`）。
   - 紧接着测试在 `1500–1532` 行拦截 `/api/quiz/start` 返回 HTTP 503 `"模拟网络连接失败"`，验证 `network` 重新判定失败弹窗。
   - 在此期间，`learningSyncManager` 的 900ms 防抖定时器到期触发 `syncNow()` 第 1 轮迭代（Iteration 1），将 `wrongNoRubricFile`（`network` 的 `correct_answer: ""`）发送至 `POST /api/learning/sync`。
4. **`09:11:36`（同一 UTC 秒内第二次导入与并发同步）**：
   - 测试在 `1534` 行调用 `setFiles("#wrongDataFileInput", [wrongFailureFile])` 导入含标准释义的 `network`（`correct_answer: "网络"`, `rubric.gloss: "网络"`），并通过 `1535` 行断言 `state.currentWrongBook.network?.correct_answer === '网络'`。
   - 此时 `POST /api/learning/sync` 第 1 轮响应返回（`09:11:36 "POST /api/learning/sync HTTP/1.1" 200`）。由于第 1 轮请求在途期间 `wrongFailureFile` 修改了本地 `network` 记录（`local.dirty === true` 且 `local.revision !== submittedRevision`），`learning-sync.js:772` 的 `do...while` 循环（`if (!response.has_more && !this.dirtyRecords().length) break;`）**未等待 900ms，立即进入第 2 轮迭代（Iteration 2）**，发出第 2 个 `POST /api/learning/sync` 请求（携带 `wrongFailureFile` 的 `correct_answer: "网络"`）。
   - 同时，`setFiles` 的第二次合成 `change` 事件再次调用 `learningSyncManager.schedule(900)`，埋下了一个 900ms 后触发的定时器。
5. **`09:11:36`（进入离线与复习页，第 2 轮同步响应到达并覆写本地状态）**：
   - 测试在 `1536–1538` 行启用 CDP 离线模拟并派发 `offline` 事件，确认 `backendAvailable === false`，随后在 `1541–1547` 行点击 `#reviewBtn`（及 `#acceptConfirmBtn`）进入 `#quizView`（题目为 `network`）。
   - 就在进入 `#quizView` 后、提交答案前，已经由本地回环发出的第 2 个 `POST /api/learning/sync` 响应到达浏览器：
     - 服务端 `local-backend/account_store.py:2999` 将 `updated_at` 截断到了秒级（`.replace(microsecond=0)`），导致同一 UTC 秒（`09:11:36`）内的 `wrongNoRubricFile` 与 `wrongFailureFile` 具有完全相同的 `updated_at: "2026-04-06T09:11:36Z"`。
     - 服务端 `account_store.py:3112` 的 `_learning_sync_incoming_is_newer` 在时间戳相等时执行 `incoming["client_id"] > str(existing["client_id"] or "")`；因为两次请求来自**同一个客户端（`client_id` 相同）**，`>` 恒为 `False`！
     - 服务端 `_merge_wrong_payload(existing_payload, incoming["payload"], incoming_newer=False)` 执行 `{**incoming, **current}`，用第 1 次同步的 `existing_payload`（`correct_answer: ""`, `rubric.gloss: ""`）覆盖了第 2 次同步的 `incoming`（`correct_answer: "网络"`, `rubric.gloss: "网络"`），并将 `correct_answer: ""` 返回给浏览器！
     - 浏览器端 `applyServerRecord` 收到响应后，因第 2 轮请求发出后本地未再修改 `network`（`changedDuringRequest === false`），直接用服务端返回的 `correct_answer: ""` 覆盖了内存与 `localStorage` 中的 `state.currentWrongBook.network` 和 `state.historyWrongBook.network`！
     - 同时，`js/core/api.js:178` 在收到该响应时调用 `markBackendReachable()`（`app.js:4994`），在 `navigator.onLine === false` 的离线状态下将 `backendAvailable` 错误重置为 `true`（而 `aiAvailable` 仍为 `false`）。
     - 且由于此时当前活动视图是 `#quizView` 而非 `#wrongView`，`scheduleLearningSyncRender()`（`app.js:578`：`if ($("wrongView")?.classList.contains("active")) renderWrongBook()`）跳过了对 `#wrongList` 的重绘，导致隐藏的 `#wrongList` DOM 仍然停留在旧文本 `"network / 你答：网络 · 标准：网络"`！
6. **`09:11:36–09:11:37`（离线复习提交失败与 900ms 定时器触发）**：
   - 测试在 `1548–1549` 行填入 `"网络"` 并点击 `#submitBtn`。
   - `submitAnswer`（`app.js:6117–6144`）读取 `info = state.currentWrongBook.network`，此时 `hasUsableMeaning(info)` 因 `correct_answer === ""` 返回 `false`；又因 `aiAvailable === false`，跳过在线获取分支并在 `6142` 行直接抛出异常：`"这条旧错题没有保存标准释义；请联网获取一次后再复习。"`。
   - `catch` 分支将 `#resultTitle` 设为 `"错题复习暂不可用"`（`className = "result-title bad"`），`#nextNowBtn.disabled` 保持为 `true`。
   - 约 900ms 后，第 4 步埋下的 900ms 同步定时器触发 `syncNow()`，因 `navigator.onLine === false` 进入 `learning-sync.js:719`，将 `#learningSyncDetail` 更新为 `"离线时已保存在本机，联网后自动同步"`。
7. **`09:11:41`（等待超时与 `finally` 块瞬间返回）**：
   - `1550` 行的 `waitFor("document.querySelector('#resultTitle')?.classList.contains('ok') && !document.querySelector('#nextNowBtn')?.disabled", 5_000, "offline review answer")` 在 5 秒后超时。
   - 进入 `finally` 块（`1558–1560` 行）恢复网络并等待 `waitFor("backendAvailable === true")`；因为第 5 步在途同步响应已经把 `backendAvailable` 设为了 `true`，`waitFor("backendAvailable === true")` 在第 0 次轮询（<1ms）即立即返回，随即采集 `diagnostic` 快照并抛出超时失败。

---

## 2. 所有候选根因及证据

本次调查对以下四个方向的全部候选根因进行了代码级与实验级取证：

| 编号 | 候选假设 | 证据与实验结果 | 判定 |
| --- | --- | --- | --- |
| **H1** | **同秒同步时间戳截断 + 同 `client_id` 比较反转 + 空释义覆盖非空释义（主根因）** | 1. `local-backend/account_store.py:2999` 使用 `updated_time.replace(microsecond=0)` 截断毫秒；<br>2. `account_store.py:3112` 与 `functions/_lib/task11-model.mjs:386` 在时间戳相同时使用 `incoming.client_id > existing.client_id`，对同客户端恒为 `False`；<br>3. `mergeWrongPayload`（三端）在 `incoming_newer=False` 时用 `correct_answer: ""` 覆盖了 `"网络"`；<br>4. 在真实 Chrome 受控复现脚本中 100% 复现了原 CI 全部 `diagnostic` 字段。 | **确认（主根因）** |
| **H2** | **在途 `/api/learning/sync` 跨越离线边界及离线完成复习后的同客户端删除被服务端拒绝（次生根因）** | 1. `learning-sync.js:730` 在 `do...while` 连续批次循环中未检查 `navigator.onLine === false`，且未监听 `offline` 事件中止在途请求；<br>2. `app.js:4994` 的 `markBackendReachable` 在 `navigator.onLine === false` 时仍将 `backendAvailable` 设为 `true`；<br>3. 若前序同客户端同步在断网瞬间已在服务端落库（`server_version` 递增）而客户端未收到响应，离线复习删除错题后重连同步时，`account_store.py:3121` 与 `task11-model.mjs:394` 因 `base_server_version < existing.server_version` 拒绝同客户端的更新删除，导致已复习错题复活。 | **确认（并发与重连根因）** |
| **H3** | **文件导入控件 `setFiles` 双重 `change` 事件触发并发重复导入与额外防抖定时器（触发放大器）** | `app.js:6630`（`importWrongData`）与 `app.js:6713`（`importWords`）在 `finally`（`await file.text()` 之后）才清空 `event.target.value = ""`。CDP `DOM.setFileInputFiles` 触发原生 `change` 后，测试的合成 `change` 事件再次读取到同一个 `File` 对象，导致每次导入执行两遍、弹窗 6 次（原 CI 日志 `dialogs` 证据）并额外调度 900ms 同步定时器。 | **确认（触发放大器）** |
| **H4** | **`#wrongView` 非活动状态下 `scheduleLearningSyncRender` 跳过 `#wrongList` 重绘（诊断掩盖项）** | `app.js:578` 仅在 `$("wrongView")?.classList.contains("active")` 时调用 `renderWrongBook()`。当后台同步在 `#quizView` 激活期间改写 `state.currentWrongBook` 时，`#wrongList` DOM 保留旧文本 `"标准：网络"`，造成“DOM 显示有标准释义但状态实际为空”的假象。 | **确认（UI/诊断不一致）** |
| **H5** | `confirmModal` 关闭动画与 `inert` 焦点恢复导致 `#submitBtn.click()` 被吞 | 实验探针证实：即使父容器 `inert = true`，JS 同步调用 `HTMLButtonElement.prototype.click()` 在 Chrome 中仍会触发 `click` 与表单 `submit` 事件（`{ clicked: true, submitted: true }`）；且进入 `#quizView` 的等待条件要求 `#wordText === 'network'`，此时 `confirmModal` 已确认接受。 | **已排除** |
| **H6** | 错题重新判定（Rejudge）失败后遗留 `state.busy`、`answerLocked` 或模态框锁死 | 代码审查与复现实验证实：`submitWrongBookRejudge`（`app.js:6300–6415`）使用独立的 `activeWrongRejudgeKey`，不修改 `state.busy` 或 `state.answerLocked`，且 `finally` 块始终清理 `activeWrongRejudgeKey = ""`。 | **已排除** |
| **H7** | Service Worker (`sw.js`) 缓存或拦截了 `/api/learning/sync` / `/api/quiz/start` | `sw.js` 对所有 `/api/*` 请求直接 bypass，不拦截 API 请求。 | **已排除** |
| **H8** | 旧错题与新错题身份混淆（`hello` 与 `network` 串题） | 原 CI 快照中 `currentWrong: null` 是因为 `test_app_browser.mjs:600` 硬编码读取了 `state.currentWrongBook.hello`（已在 `1452` 行移除），而实际复习题目为 `network`。 | **已排除（系诊断字段硬编码）** |

---

## 3. 排除假设的依据

1. **排除 H5（`inert` / 模态框吞点击）**：
   - 在真实 Headless Chrome 中注入探针验证：对 `inert = true` 容器内的 `<form><button type="submit"></button></form>` 执行 `btn.click()`，浏览器同步触发 `click` 与 `submit` 事件（`{ clicked: true, submitted: true }`）。
   - 同时，若点击未触发 `submitAnswer`，`#resultTitle` 会保持初始值且不会出现 `"离线时已保存在本机，联网后自动同步"` + `backendAvailable === true` 立即退出的组合特征。
2. **排除 H6（重新判定与正常复习共享异步锁）**：
   - `submitWrongBookRejudge` 仅操作局部变量与 `activeWrongRejudgeKey`，在 `finally` 中无条件恢复并渲染错题本；其失败弹窗不会污染 `state.busy`、`state.roundActive` 或 `state.answerLocked`。
   - 对照实验（场景 5）证明：单独触发重新判定 503 失败后继续离线复习，只要 `network.correct_answer` 未被同秒同步回包清空，离线复习 100% 成功。
3. **排除 H8（`hello` 与 `network` 题目身份串扰）**：
   - `test_app_browser.mjs:600–602` 原先固定采集 `state?.currentWrongBook?.hello` 及 `record_id.includes('hello')`（而 `record_id` 中单词经过 base64url 编码，`"hello"` 为 `"aGVsbG8"`，`"network"` 为 `"bmV0d29yaw"`，故 `syncWrong` 恒为 `[]`）。补充 `currentWrongNetwork` 与解码后的 `syncWrong` 后，题目身份清晰无误。

---

## 4. 实际能够复现的最小场景与 12 项复现实验矩阵

### 4.1 最小确定性复现场景（RED 场景）

在受控本地环境中执行原测试的完整操作顺序：
1. 在同一 UTC 秒内先后导入 `wrongNoRubricFile`（`network.correct_answer = ""`）与 `wrongFailureFile`（`network.correct_answer = "网络"`）；
2. `learningSyncManager.syncNow()` 第 1 轮发送 `wrongNoRubricFile` 期间导入 `wrongFailureFile`，使 `syncNow()` 的 `do...while` 循环立即发起第 2 轮 `POST /api/learning/sync`；
3. 在第 2 轮响应返回前切换离线并点击 `#reviewBtn` 进入 `#quizView`，随后第 2 轮响应送达浏览器；
4. 输入 `"网络"` 并点击 `#submitBtn`。

**修复前（RED）实验结果**：
- 抛出与原 CI 完全一致的错误：`timeout waiting for offline review answer (last=false)`；
- `Diagnostic` 快照与原 CI 100% 吻合：`pathname: "/language/english"`, `quizActive: true`, `wordInput: "hello\nworld"`, `syncDetail: "离线时已保存在本机，联网后自动同步"`, `wrongCount: 1`, `wrongText` 仍显示 `network / 你答：网络 · 标准：网络`，而内存态 `currentWrongNetwork.correct_answer === ""`，`resultTitle === "错题复习暂不可用"`（`"这条旧错题没有保存标准释义；请联网获取一次后再复习。"`）。

### 4.2 12 项复现对照测试矩阵结果

在真实 Chrome 浏览器与受控本地后端（`local-backend/server.py` + `ci_ollama_stub.py`）下执行全部 12 项对照实验：

| 序号 | 实验场景 | 核心观察指标（事件顺序 / 题目身份 / `busy` / DOM / 持久化） | 结果 |
| --- | --- | --- | --- |
| **1** | 正常在线完成错题复习 | `mode: "review-current"`, `currentWord: "network"`, 提交 `"网络"` 后 `resultTitle: "正确"`, `currentWrongKeys: []`, 汇总弹窗正确显示 | **PASS** |
| **2** | 进入复习后立即断网 | 进入 `#quizView` 后立即触发 CDP offline + `offline` 事件，`backendAvailable: false`, `quizActive: true`, `submitDisabled: false`, `busy: false` | **PASS** |
| **3** | 断网时提交正确答案 | 离线状态下提交 `word1` 正确答案，同步零等待判定 `resultTitle: "正确"`, `word1` 从 `currentWrongBook` 移除，`syncPending > 0` | **PASS** |
| **4** | 断网时提交错误答案 | 离线状态下对 `word2` 提交错误答案，判定 `resultTitle: "错误"`, `word2` 保留在 `currentWrongBook` 且 `wrong_count` 递增 | **PASS** |
| **5** | 错题重新判定请求失败后继续复习 | `/api/quiz/start` 返回 503 `"模拟网络连接失败"`，关闭失败弹窗后恢复错题标准释义并断网复习，`resultTitle: "正确"` | **PASS** |
| **6** | 离线提交期间刷新页面 | 离线提交（含正确删除 `word1` 与错误保留 `word2`）后执行 `Page.reload`，刷新后 `word1` 保持已移除、`word2` 保持存在 | **PASS** |
| **7** | 离线提交后恢复网络 | 恢复在线后触发 `learningSyncManager.syncNow()`，`syncPending` 归零，服务端与本地 `word1` 保持已删除（未复活） | **PASS** |
| **8** | 快速连续提交 | 对 `#submitBtn` 连续同步点击 3 次，`answerLocked: true`, `submitDisabled: true`, `state.index` 保持 `0` 不跳题 | **PASS** |
| **9** | 从当前错题切换至历史错题 | 点击 `#reviewHistoryBtn` 进入 `mode: "review-history"`（共 3 题），答对 1 题后 `historyWrongKeys` 从 3 减为 2 | **PASS** |
| **10** | 切换账户后恢复待同步数据 | 账户 A 离线导入 `offline_only_word` 产生待同步队列；切换至账户 B 验证 `currentWrongKeys: []` 完全隔离；切回账户 A 后 `offline_only_word` 恢复并完成同步（`syncPending: 0`） | **PASS** |
| **11** | 使用不同网络响应延迟与顺序 | 同 UTC 秒内两轮 `/api/learning/sync` 响应跨离线边界乱序/延迟到达，`network.correct_answer` 保持 `"网络"` 不丢失，`backendAvailable` 在离线期间保持 `false` | **PASS** |
| **12** | 对原失败测试的完整操作顺序进行复现 | 完整复现原 CI 操作链并连续独立运行 5 轮：`Caught error: null`, `resultTitle: "正确"`, `wrongCount: 0`, 重连同步后错题不复活 | **PASS（5/5）** |

---

## 5. 修改代码、RED/GREEN 与回归证据

### 5.1 最小因果修复清单

1. **[`local-backend/account_store.py`](file:///C:/Users/78252/.codex/worktrees/p07-offline-review-root-cause/thewyj.uk/local-backend/account_store.py)**：
   - `_validated_learning_sync_request`：保留 `updated_at` 的毫秒精度（与 `functions/_lib/task11-model.mjs` 对齐），不再通过 `.replace(microsecond=0)` 抹除同秒内先后两次更新的时序差异；
   - `_learning_sync_incoming_is_newer`：当 `incoming_time == existing_time` 时使用 `incoming["client_id"] >= str(existing["client_id"] or "")`，使同一客户端在相同时间戳下的后续请求被判定为较新（`True`）；
   - `_merge_learning_sync_record`：当同一客户端发送更新的变更/删除（`same_client_newer`）时，即使前序在途请求因断网丢失响应导致 `base_server_version < existing.server_version`，也允许同客户端的更新删除生效，防止离线复习消除的错题在重连后被服务端复活；
   - `_merge_wrong_payload`：合并错题载荷时保留非空的 `correct_answer` 与 `rubric` 文本字段（`language`、`gloss`、`notes`、`reading`），与前端 `js/language/wrong-book.js` 的 `mergeWrongBooks` 语义保持一致。
2. **[`functions/_lib/task11-model.mjs`](file:///C:/Users/78252/.codex/worktrees/p07-offline-review-root-cause/thewyj.uk/functions/_lib/task11-model.mjs)**：
   - `incomingIsNewer`：在 `incomingTime === existingTime` 时使用 `>=` 处理同 `client_id` 顺序更新；
   - `mergeLearningRecord`：支持 `sameClientNewer` 下同客户端断网恢复后的删除落库；
   - `mergeWrongPayload`：保留非空的 `correct_answer` 与 `rubric` 文本字段，防止空字符串 `""` 抹除已有的标准释义。
3. **[`learning-sync.js`](file:///C:/Users/78252/.codex/worktrees/p07-offline-review-root-cause/thewyj.uk/learning-sync.js)**：
   - `mergeWrongPayload`：保留非空的 `correct_answer` 与 `rubric` 文本字段；
   - `upsert`：对未显式指定 `updated_at` 的本地更新保证单调递增时间戳（`Math.max(Date.now(), existingTime + 1)`）；
   - `LearningSyncManager`：监听 `offline` 事件，断网时清理防抖定时器、中止在途 `syncController` 并在存在待同步记录时立即发出 `"离线时已保存在本机，联网后自动同步"` 状态；在 `syncNow()` 的 `do...while` 循环顶部检查 `navigator.onLine === false`。
4. **[`app.js`](file:///C:/Users/78252/.codex/worktrees/p07-offline-review-root-cause/thewyj.uk/app.js)**：
   - `markGetReachable`、`applyBackendStatus`、`markBackendReachable`：当 `navigator.onLine === false` 时拒绝将在途旧响应标记为 `backendAvailable = true`；
   - `markBackendDisconnected`：清理 `backendRecoveryTimer`；
   - `importWrongData` 与 `importWords`：在读取 `event.target.files[0]` 后立即清空 `event.target.value = ""`（位于 `await file.text()` 之前），消除 CDP `DOM.setFileInputFiles` + 合成 `change` 事件导致的并发双重导入与重复弹窗；
   - `scheduleLearningSyncRender`：只要 `$("wrongList")` 存在且未处于重新判定编辑态即更新错题本 DOM 与按钮状态，避免非活动视图下的 DOM 陈旧。
5. **回归测试与诊断增强**：
   - [`local-backend/test_app_browser.mjs`](file:///C:/Users/78252/.codex/worktrees/p07-offline-review-root-cause/thewyj.uk/local-backend/test_app_browser.mjs)：在失败诊断中补充 `resultGloss`、`currentWrongNetwork`、`historyWrongNetwork` 及解码后的 `syncWrong`；并在离线复习恢复在线后验证 `learningSyncManager.syncNow()` 不会复活已消除的本轮错题；
   - [`local-backend/test_learning_sync_js.mjs`](file:///C:/Users/78252/.codex/worktrees/p07-offline-review-root-cause/thewyj.uk/local-backend/test_learning_sync_js.mjs)、[`local-backend/test_task11_model_js.mjs`](file:///C:/Users/78252/.codex/worktrees/p07-offline-review-root-cause/thewyj.uk/local-backend/test_task11_model_js.mjs)、[`local-backend/test_accounts.py`](file:///C:/Users/78252/.codex/worktrees/p07-offline-review-root-cause/thewyj.uk/local-backend/test_accounts.py)：新增同秒错题同步、非空释义保留、离线中止与断网重连删除的单元回归测试。

### 5.2 回归门禁验证结果

- **受控复现脚本（`repro_offline_review.mjs`）**：修复前稳定 RED（`timeout waiting for offline review answer`），修复后连续 **5/5 轮** 独立运行全部 GREEN（`Caught error: null`, `resultTitle: "正确"`, `wrongCount: 0`）。
- **12 项复现对照矩阵（`matrix_12_scenarios.mjs`）**：**12/12 项**全部 PASS。
- **原失败浏览器套件 `local-backend/test_app_browser.mjs`（`Browser flow (application)`）**：
  - 独立运行第 1 轮：**24/24 项**全部 PASS（`wrong search, JSON/PDF export, import and offline review` 耗时 `3101 ms`，弹窗次数由异常的 6 次恢复为准确的 3 次）；
  - 独立运行第 2 轮：**24/24 项**全部 PASS。
- **Task11 / 语言学习 / 状态一致性测试**：
  - `node local-backend/test_learning_sync_js.mjs`：PASS
  - `node local-backend/test_task11_model_js.mjs`：PASS（7 groups）
  - `node local-backend/test_task11_api_js.mjs`：PASS（10 groups）
  - `node local-backend/test_task11_d1_js.mjs`：PASS（10 groups）
  - `node local-backend/test_language_js.mjs`：PASS
  - `node local-backend/test_aeris_state_consistency.mjs`：PASS（13 tests）
  - `python -m unittest discover -s local-backend -p "test_accounts.py"`：PASS（57 tests）
  - `node local-backend/test_module_graph_js.mjs` & `node scripts/audit_async_interactions.mjs`：PASS
- **Task26 全量确定性算法与状态合同测试（`npm run test:task26`）**：
  - `test_task26_engine.mjs`（32 groups）、`test_task26_d1_js.mjs`（21 groups）、`test_task26_client_js.mjs`（17 groups）、`multi-window-client.mjs`、`account-deletion-local.mjs`、`test_task26_feature_refresh.mjs`、`test_task26_preview_transport.mjs`、`durable-outbox-client.mjs`：全部 PASS。

---

## 6. 尚缺证据说明

不适用。本次调查已通过原始 CI 产物与受控实验完整复现历史故障，建立了唯一且闭合的因果链并完成最小修复（状态：`P07_OFFLINE_REVIEW_ROOT_CAUSE_FIXED`）。

---

## 7. 对现有 Task26、Task11 和账户数据的兼容性影响

1. **Task26 `wrong-review-v1` 兼容合同**：未引入 PR #111 的 `0026` 数据库迁移，未改动任何 Task26 掌握度算法、冷却规则、票据合同、持久队列（durable outbox）或 Feature Flag 默认关闭/Kill 语义；`npm run test:task26` 全套通过。
2. **Task11 学习同步兼容合同**：`schema_version: 1` 保持不变；`updated_at` 毫秒规范化与 `task11-model.mjs` 的 `normalizedTimestamp`（`.toISOString().replace(".000Z", "Z")`）完全一致；跨设备冲突合并、墓碑（tombstone）防复活（不同 `client_id` 的旧删除/旧恢复仍被拒绝）与离线备份导入导出全部保持向后兼容。
3. **账户数据隔离与安全边界**：未触碰正式环境 D1/R2、正式账户或学习记录；多账户切换测试（场景 10 及 `test_accounts.py`、`test_task11_d1_js.mjs`）验证账户间错题本与待同步队列完全隔离。

---

## 8. 新 Draft PR、最终 SHA、测试及 CI 链接

- **目标基底分支**：`codex/p07-task25-d1-concurrency`（PR #132，`91f0d466361ee80fbd6475facea0b9620f950661`）
- **修复分支**：`argon/p07-offline-review-root-cause`
- **Draft PR / 最终 SHA / CI 链接**：待提交并推送后回填。

---

## 9. 后续供 Codex 集成的最小变更清单

供 Codex 集成至 P07 主线时仅需合入以下最小变更集（无数据库 schema 迁移）：

1. `local-backend/account_store.py`：保留学习同步 `updated_at` 毫秒精度、修复同 `client_id` 同时间戳比较与离线复习删除落库、在 `_merge_wrong_payload` 中保留非空 `correct_answer` / `rubric` 文本字段。
2. `functions/_lib/task11-model.mjs`：同步修复 `incomingIsNewer`、`mergeLearningRecord`（`sameClientNewer`）与 `mergeWrongPayload` 非空释义保留逻辑。
3. `learning-sync.js`：同步修复 `mergeWrongPayload` 非空释义保留、`upsert` 单调时间戳、以及 `offline` 事件对在途同步的中止与状态更新。
4. `app.js`：离线状态下禁止在途响应将 `backendAvailable` 置回 `true`、清理 `backendRecoveryTimer`、在 `importWrongData`/`importWords` 入口立即清空 `event.target.value` 防止重复触发、以及在 `scheduleLearningSyncRender` 中保持 `#wrongList` DOM 同步。
5. `local-backend/test_app_browser.mjs`、`local-backend/test_learning_sync_js.mjs`、`local-backend/test_task11_model_js.mjs`、`local-backend/test_accounts.py`：诊断字段增强与回归测试。
