# Task 24.4 真机 + Production 联合回归记录

设备：Samsung SM-S9360（`R5CY22MEHJN`），Android 16，App 1.3.0 / versionCode 13。
现场：Production `thewyj-uk`，D1 `wyj-cloud-production`。采集时未清缓存、未清 App data、
未删除任何真实 pending / session / 财务数据。

## 现场证据（2026-09-12）

### P0/P1-1 + P0/P1-2 同一 root cause：hint 缺 direction 导致 confirm 永远失败

真实记录（Production D1，`task21_notification_pending_hints`）：

| 字段 | 值 |
| --- | --- |
| id | `hint:36fcd412-0c3a-4af6-9c9b-785adad7cd23` |
| user_id | `96089c00-c88e-4947-9ec9-234f6ac3acb7` |
| source_event_id | `63b1863d-1b4d-449a-b4e6-1c580f60720a` |
| device_id | `f8098997-74ce-4235-b55d-2acf4d893d66` |
| source | notification / `cmb.pb`（招商银行），app_label 招商银行 |
| amount_minor | 10449（¥104.49），confidence 760 |
| direction | **空** |
| state | **pending**（`updated_at` 仍等于 `created_at`） |
| finance_entry_id | 空 |
| created_at | 2026-09-12 04:28:24 UTC（12:28:24 HKT） |

同刻的关联检查：

- `task21_notification_candidates`：该金额无 candidate 行（hint 是唯一来源）。
- `task16_finance_transactions`：无 10449 记录；该用户全部财务行均为 `status=deleted` 历史行。

Root cause：`confirmNotificationHint` 要求 `edits.direction || row.direction`
（`functions/_lib/task21-hints.mjs:182-186`），该 hint 的 direction 为空，服务端按设计返回
`hint_direction_required`（400）。但 Web Finance 页对「缺 direction」的记录仍然提供一键
「确认记账」，并且缺字段检测只包含金额/商户，没有方向；`handleClick` 里“打开编辑器”的
分支先调用 `render()` 重建了列表 DOM，旧节点上的展开操作随即失效——用户看到的只是
一闪而过的错误横幅，记录永远停在 pending，于是 Finance 像“确认过”，通知页也一直待确认。

### P0/P1-3 上传 100% 但无法创建分享：客户端完成态永远到不了 done

真实现场（Production D1）：

| 对象 | 值 |
| --- | --- |
| session | `TuWl3aCXakuN5qpKnSsk7JcwH-5a7GTx`，owner user `96089c00-…`，state **active** |
| 声明 | file_count 1，total_bytes 264,786,072（252.5 MiB） |
| file | `file-8425b3b1b83c4a4cbcd7` `UbisoftConnectInstaller.exe`，size 264,786,072，part_count 16，state `allocated` |
| parts | **16/16，合计 264,786,072 bytes**（服务端内容已齐全） |

Root cause（纯客户端）：

1. 页面重载后 `restoreQueue()` 把持久化的 `status:"uploading"` 原样恢复，而 `run()` 只处理
   `pending`/`error`——重新选择同一文件也不会续传，条目永久停在 100% 但非 done。
2. 即使条目已经 done，`complete()` 仍要求内存中的 `activeSession`；刷新后它为空，于是
   一律回「还有文件没有上传完成。」，从未调用服务端 `/complete`。

服务端 `/complete` 本身有完整校验（文件数、分片数、分片大小、R2 对象/etag、总字节），
因此不需要也不允许用「进度等于 100% 就强制完成」的 UI 绕过。

## 修复

1. `js/finance/candidates.js`
   - 新增 `candidateNeedsEditor()`（金额或方向缺失 → 必须走编辑器）。
   - 缺少方向的记录显示「选择方向并确认」，点击后**先渲染再展开**编辑器并聚焦方向选择。
   - 同理修正金额缺失路径（原先展开动作被 `render()` 覆盖）。
2. `js/transfer/app.js`
   - 新增 `restoreQueueEntry()`：`uploaded >= size` 的条目恢复为 `done` 且不再要求重选文件；
     真正的半途条目恢复为 `pending`（而不是 `uploading`），重新选文件后可续传；
     显式暂停的条目保持暂停。
   - 新增 `sessionIdForQueue()`：`complete()` 在刷新后从队列持久化的 session id 恢复上传任务，
     再由服务端校验后发布分享。
   - `run()` 只续传「有 File、未完成、未取消、未暂停、无在途分片请求」的条目。
3. Web 资源令牌 `20260912-task24-3-r1` → `20260912-task24-4-r1`（SW 为 URL 级 cache-first，
   不 bump 令牌真机 WebView 会继续命中旧 JS），同步 `test_static.py` 断言。

## 回归

- `local-backend/test_finance_candidates_js.mjs`（新增，CI）：缺方向 → 必须走编辑器；
  有金额+方向 → 允许一键确认；空白方向 → 必须走编辑器。
- `local-backend/test_transfer_isolation_js.mjs`（扩展，CI）：100% 条目恢复为 done 且不需重选；
  半途条目恢复为 pending 需重选；暂停保持；持久化 session id 恢复。
- `scripts/check_js_module_graph.mjs`、`test_module_graph_js.mjs`、`check_storage_contract.mjs`、
  `test_static.py` 31 OK。

## 现场验证（待回填）

- [ ] 真机 Finance：确认上述 hint → 服务端 1 笔财务记录、hint confirmed、Finance/通知待确认
      立即消失，refresh / App restart / force stop 不回退。
- [ ] 真机 Transfer：上述 session 恢复为可完成 → 创建分享成功（服务端 session published、
      share 可下载），刷新/重进不回退。
- [ ] Android/Web/Production 回归：duplicate/offline/reconnect/pull、小文件/大文件/多文件/
      pause/resume/account switch/cancel/expired session。
