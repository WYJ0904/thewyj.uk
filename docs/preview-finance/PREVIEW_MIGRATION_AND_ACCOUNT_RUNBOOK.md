# Preview 迁移、测试账户和清理执行手册

本手册于 2026-11-13 准备，**尚未获得远程写入授权，以下写入命令未执行**。
当前事实和测试边界见 [核查报告](P0_PREVIEW_FINANCE_ACCEPTANCE_REPORT.md)。

## A. 执行前必须核对

- 源 SQL 固定为 #146 `29bdbb9e3ae4cd88019b6c0046aabc6df574a942` 的 0027–0034；
  与 [记录的 SHA-256](evidence/local-upgrade.json) 完全一致，不从 TTS 分支取 SQL。
- 目标只能是 account `97c274a981e8dd6703aa6388e11c4614` 内的
  `wyj-cloud-preview` / `a3e6253b-689f-49f3-998b-7c5828ea255a`。
  核对 Pages 项目 Preview 的 WYJ_DB 绑定仍指向该 UUID；若与只读结果不同则停止。
- Hosted 必须明确记录完整 deployment ID、commit SHA 和 URL。本轮旧部署为
  `6d3ca922-f444-4dd7-afeb-a3af33161f26`。补丁部署后应使用新 SHA/URL，不能
  声称不可变的旧 URL 已被覆盖。
- 所有者确认维护窗口，以及所有连接此历史 Preview D1 的写入已协调暂停；
  包括其他 Preview、用户操作和 Flash 的工作。本任务不自行改 Access、Pages
  环境配置或全局维护权限来实现停写。
- 只读复核 ledger、DDL、metadata 与数据规模，保留额外历史迁移
  `0021_candidate_unknown_amount.sql`。不清空库，不手工重置 ledger。

不能用 `wrangler d1 migrations list --remote` 作严格只读核查：固定 4.118.0 的
该命令会调用 initMigrationsTable，执行 CREATE TABLE IF NOT EXISTS。应使用
明确的 SELECT，例如：

```powershell
node node_modules/wrangler/bin/wrangler.js d1 info a3e6253b-689f-49f3-998b-7c5828ea255a --json
node node_modules/wrangler/bin/wrangler.js d1 execute a3e6253b-689f-49f3-998b-7c5828ea255a --env preview --remote --command "SELECT id,name,applied_at FROM wyj_d1_migrations ORDER BY id" --json
```

不要用 `/api/status` 代替只读 SQL：它会更新限流表。正常登录后的 GET 还可能
触发限流/会话访问记录，这些附带写入需纳入后续验收授权。

## B. 备份及最短迁移流程（批准后）

1. 确认 A 节目标和停写窗口，记录实际行数、metadata、ledger 文件集合和时间。
2. 获取**当次** Time Travel bookmark，并导出完整 SQL 私有备份。备份含用户
   数据及凭证哈希，只放 Git 忽略、仅本机授权用户可访问的位置；不打印内容、
   不提交、不把真实备份用于本轮合成本地测试。
3. 用只包含 Preview 绑定的临时配置，执行原有 Wrangler migrations apply。
4. 核对 0027–0034 各只应用一次、metadata 5/9、18 个新表、旧记录数量及授权
   的私有内容摘要；随后才允许专用账户进行业务写入。
5. 完成业务验收及清理；恢复停写前的访问安排。未过门槛则保持 BLOCKED。

示例准备配置只写入本地忽略目录，防止误解析 Production binding：

```powershell
$previewId = 'a3e6253b-689f-49f3-998b-7c5828ea255a'
$previewDir = Join-Path (Get-Location) '.wrangler/approved-preview-finance'
New-Item -ItemType Directory -Path $previewDir -Force | Out-Null
$previewConfig = Join-Path $previewDir 'wrangler.jsonc'
@'
{
  "name": "p0-preview-finance-plan",
  "compatibility_date": "2026-08-06",
  "send_metrics": false,
  "d1_databases": [{
    "binding": "WYJ_PREVIEW_ONLY",
    "database_name": "wyj-cloud-preview",
    "database_id": "a3e6253b-689f-49f3-998b-7c5828ea255a",
    "migrations_table": "wyj_d1_migrations",
    "migrations_dir": "../../cloudflare/migrations"
  }]
}
'@ | Set-Content -LiteralPath $previewConfig -Encoding utf8
git diff --exit-code 29bdbb9e3ae4cd88019b6c0046aabc6df574a942 -- cloudflare/migrations
if ($LASTEXITCODE -ne 0) { throw '迁移 SQL 与批准基线不一致' }
```

执行时另选全新备份目录，不覆盖任何先前备份。以下示例仅在获得相应批准后运行：

```powershell
$previewBackup = Join-Path $previewDir ('backup-' + [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ'))
New-Item -ItemType Directory -Path $previewBackup | Out-Null
node node_modules/wrangler/bin/wrangler.js d1 time-travel info $previewId --json > (Join-Path $previewBackup 'bookmark.json')
node node_modules/wrangler/bin/wrangler.js d1 export $previewId --remote --config $previewConfig --output (Join-Path $previewBackup 'before.sql')
if ($LASTEXITCODE -ne 0) { throw '备份失败，禁止继续' }
Get-FileHash -LiteralPath (Join-Path $previewBackup 'before.sql') -Algorithm SHA256
node node_modules/wrangler/bin/wrangler.js d1 migrations apply WYJ_PREVIEW_ONLY --remote --config $previewConfig
```

SQL 导出会阻塞其他请求，应在已协调的维护窗口内进行。若数据库出现 virtual
tables 或导出不支持的类型，应停止并选择受支持的备份方式，不能为导出删除表。
SQL 导出是辅助逻辑备份；D1 export 对超大 int64 有精度限制，不能据此承诺任意
整数完全保真，原生恢复应优先使用当次 Time Travel 点。
Time Travel 的当前 bookmark 可能因内部维护前进，不能把 bookmark 变化直接
当成业务写入或数据变化；本轮只读获取的旧 bookmark 不能代替执行当次恢复点。

预期执行结果：本次待迁移恰好八个文件；现有 27 条 ledger 保留，最终为 35 条。
Task16 schema_version=5、Task21=9；Task11/12/13/25/26 的既有版本及数据不被
本批 SQL 改写。预计表数从 94 增加 18，但以表名/列/索引集合而非单一总数核对。
JPY 旧整数金额和币种不得重标度或自动确认为 exponent=0，五种两位币种只
新增 exponent=2。0034 仅创建空的辅助表，不启用 AI consent/Flags/模型。

## C. 失败、重复执行与回滚

Wrangler 4.118.0 将每个文件 SQL 和该文件 ledger INSERT 拼成同一次执行；
本地已验证相应 D1 batch 的原子失败及恢复。若文件失败，应立即停止业务验收：

1. 保存错误、ledger、metadata 和对应列/表状态。前面已成功的文件保留。
2. 确认失败文件的 DDL、数据和 ledger 均未部分提交，再用同一批准 SQL 和
   migrations apply 续跑剩余文件。已应用的文件依据 ledger 跳过。
3. 如果存在“列已增加但 ledger 无记录”、SQL hash 不一致或无法解释的并发
   写入，不裸重放 ALTER、不补写 ledger、不删除列/表；停止并交所有者决定。

本地已验证停止在 0030 后重开持久化 workerd，只执行 0031–0034；也验证了
迁移前逻辑快照恢复和 SQLite 备份可读。它们不是 Cloudflare 原生备份恢复演练。

整体回滚优先使用维护窗口开始时记录的 Time Travel bookmark，**需明确授权**。
它会覆盖整个 Preview 数据库并取消进行中的请求；会丢失恢复点之后的其他
写入。若不能确认期间没有外部写入，就不能自动执行整体恢复，应优先向前修复
或另行批准隔离恢复/数据协调。恢复命令形式为：

```powershell
$approvedBookmark = (Get-Content -LiteralPath (Join-Path $previewBackup 'bookmark.json') -Raw | ConvertFrom-Json).bookmark
node node_modules/wrangler/bin/wrangler.js d1 time-travel restore a3e6253b-689f-49f3-998b-7c5828ea255a --bookmark $approvedBookmark --json
```

保留 restore 返回的 undo bookmark；恢复后再只读确认旧 27 条 ledger、旧
metadata 1/2、表集合和私有备份摘要。禁止使用 DROP/清库后导入的方式覆盖现有
Preview。Workers Free/付费账户保留窗口不同，应按当时可用恢复点核查，不假定
过期 bookmark 仍可用。本轮没有执行远程 restore 或完整数据 export。

## D. 最小测试账户、权限和 Flags

仅需两个专用普通账户，例如 `aeris_s0qa_<nonce>_a` / `_b`，用户名长度不超过
40，名称和 UUID 进入本轮 manifest。凭据在本机安全生成/保存，不写报告、Git、
shell 参数或日志；不读取历史用户密码，不直接 SQL 插入账户，不新增管理员。

通过既有 `POST /api/register` 正常注册，字段为 username、secret、confirm_secret。
已有所有者管理员通过正常 API 操作这些新 UUID；不提升测试账户角色。

- A 仅授予 `finance_access`、`language_all_access` 两项 entitlement override。
- B 初始不授予权益，先验证财务/学习拒绝及隔离；再为 B 授予同样两项，以完成
  双账户及同名 profile/operation ID 的隔离验收。
- 使用 `POST /api/admin/entitlement`，字段 user_id、entitlement、allowed=true、
  note。不要使用充值支付流程、创建真实订单或授予 all_features_access。
  这两个权益足以通过当前财务及英语/日语学习云端 gate；若另需测试会员计划显示，
  另外审批最窄的临时 membership，不默认赠送所有功能。

Task26 需要单独批准三个 Flag。最窄配置为：保持现有 experimental channel
和 0% rollout，只把 enabled 改为 true；仅两个新账户设 experimental 和
enabled=true override。当前没有其他 enabled=true 覆盖，但操作前必须重新
读取并确认，防止误激活历史用户。P07 Flag 保持原值，不重设全局 100%。

正常端点：`POST /api/admin/feature-flags`、`POST /api/admin/feature-flags/override`、
`POST /api/release-channel`。每次使用最新 expected_revision；用户 override
也会增加全局 revision，因此不能批量复用旧 revision。遇到 429 只按 Retry-After
等待，不能提高限流或换身份绕过。若发生并发修改，停止并重新审阅，不能盲目
恢复旧快照覆盖 Flash/其他人的工作。

## E. 获批后的最短 Hosted 业务序列

1. 确认新/旧 URL 与最终 SHA，完成 B 节迁移及后置检查，安全配置两个账户。
2. A/B 先测拒绝、跨账户读取/操作拒绝，再授予所需权益；两个账户各建两个
   合成 profile，测试 Task11 离线队列、断网恢复和同一事件重放。
3. 临时启用 D 节的三 Flags，仅对 A/B 验证 wrong-review-v1、Mastery、旧错题
   保留、纠正/删除及云端回执；不可把本地状态当作云端接受成功。
4. 复用现有 `qa/finance-p03/` 和 `qa/finance-p04/contracts.mjs` 的公开合成案例，
   通过 Hosted Web/API 验证 CNY/USD/EUR/HKD/GBP/JPY、JPY exponent=0、未知
   币种人工确认、待核实、预授权/部分清算/退款/人工更正。使用现有 Money v3
   客户端和稳定 operation ID，记录实际 HTTP、回执及独立读回；不做手机支付。
5. 以审阅通过的 PWA 修复候选部署新 Preview 后，验证三卡、PWA 更新、财务
   完整模块断网和旧用户缓存保留。旧 6d3ca922 的已知 FAIL 保留作基线。
6. 清理专用数据/身份和 Flag 配置，记录 residual counts，输出精确 SHA 的矩阵。

## F. 清理范围

只使用 manifest 中由本轮创建的两个 UUID 和合成 record/operation ID；不按
模糊用户名匹配或历史 qa 前缀批量删除。先清理本轮学习/账目记录的正常 tombstone，
撤销两个 entitlement override（allowed=null），将三个 Flag 的本轮用户覆盖
改回 null，再按 CAS 恢复全局 enabled=false 等原配置。原 P07 配置保持原样。

账户使用自身 `POST /api/account/delete`（当前 secret 仅从本机安全输入）或
既有管理员删除流程。当前实现为**软删除**和会话撤销，会保留审计、历史业务行
及不可变学习事件；不能声称已物理清空全部测试行。保留这些可追溯记录是默认
安全清理。若所有者要求物理清除，需另行审批两个精确 UUID 的受限 purge，
先列出外键/无外键残留及计数，不能临时添加远程 DELETE 脚本。

## 待所有者明确批准的最小事项

| 范围 | 最小授权 |
| --- | --- |
| Preview 数据准备 | 指定 UUID 的私有完整备份、协调停写窗口、顺序应用 0027–0034 和后置保全比对 |
| 失败恢复 | 明确是否包含维护窗口内的整体 Time Travel 恢复；否则只允许已验证的未提交文件续跑，异常时停工 |
| 专用身份及数据 | 两个普通新账户、两项权益、仅合成财务/学习测试写入及正常软删除/撤权清理 |
| Task26 | 三 Flags enabled=true/rollout=0%、两个账户实验通道与覆盖，结束按 CAS 恢复 |
| PWA 修复 | 审阅独立 Draft PR；由所有者协调新的统一候选 SHA 与 Preview 部署，不修改 PR #148 工作树 |

参考：[D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)、
[D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)、
[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)。
