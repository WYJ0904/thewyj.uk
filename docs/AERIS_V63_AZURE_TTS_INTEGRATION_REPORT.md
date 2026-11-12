# Aeris V6.3：P0 Azure Speech TTS 集成验收

日期：2026-11-12（香港时间）。集成分支：`codex/aeris-p0-azure-tts-integration`。
基线为 PR #146 精确 HEAD `29bdbb9e3ae4cd88019b6c0046aabc6df574a942`；
GitHub 只读复核仍为 open/draft，基线 Core CI `42992113724` success。
本分支面向 main，因此 PR 会包含 #146 尚未合并的候选内容；TTS 增量应与上述
精确基线比较，不把 #146 的财务/Task26 工作描述为此次新增功能。

## 状态与授权边界

所有者已创建 `TTSforwyj` / `webtothewyj` / eastasia / Free F0，状态 Active。
资源 SKU/Active 为所有者提供的信息，不冒充本轮 Azure 管理面查询结果。
密钥只允许进入 Git 忽略的 `.dev.vars` 和 Azure 请求认证头；Key 2 未配置，
不轮换密钥，不修改其他服务 Secret。

当前真实服务门槛：**BLOCKED_LOCAL_AZURE_KEY_CONFIGURATION**。本机当前常规
配置尚未检测到有效 `AZURE_SPEECH_KEY`，已提供本机遮蔽输入窗口。不能从
“资源已创建”推断真实请求通过，也不从聊天或私人口令文件提取密钥。

- Azure 实际合成：尚未执行，0 次；`AZURE_API_PASS` 未声明。
- 实际 Azure MP3 的 Chrome 播放：尚未执行；`LOCAL_AUDIO_PASS` 未声明。
- 人工试听：`LISTENING_PENDING`。
- Android 真机：`ANDROID_DEVICE_NOT_TESTED`；没有安装、改权限或读取手机。
- 本候选 Hosted：未验收；没有授权的独立 D1/R2 Hosted 环境，不新建云资源。
- Production：`NOT_SWITCHED`；不合并 main，不部署，不执行正式迁移。

最新精确提交的远程 Core CI 以本分支 Draft PR 检查及交付记录为准；上述基线
CI 只作来源核对，不能替代本候选的 CI。

## 移植与保护

原 `codex/aeris-azure-tts` 的 41 个未提交变更文件逐文件备份/hash 保全，原树
不 reset、stash、提交或移走。TTS 核心服务、播放器与现有 TTS/语言测试在
#146 和原基线之间未变化，因此移植既有成果；app 调用点、CI、配置和 SW
测试入口只应用必要小改。没有把旧分支的 sw.js 或 index.html 覆盖到 #146。

通过 #146 自有资源更新脚本统一生成 `20261112-aeris-v63-azure-tts-r1`，
然后用 `scripts/refresh_shell_publication.mjs` 根据合并后实际 UTF-8/LF 字节
重算完整性。保留 RC5 的 81 项 CORE_SHELL 及独立固定指纹
`a33d01c43f6f20a6963ab1384fb2305ee3b2447e0e68dc8c1f3015f1a2a6deae`。
Task26 两个 required 模块保留，REQUIRED_SHELL 仍为 83 项。

原 10 项完整性内容全部保留，并把现有 required speech.js 纳入指纹校验，
形成 11 项 integrity entries。新 publication hash：
`790408fb081f8a017652af5bf6e755148567b7a6686c50486cbfdd8b33b2ffb0`。
旧语音模块混入新 release 会令安装失败，不能发布带设备回退的旧播放器。

TTS 保留 Azure-only 新合成、R2 旧有效缓存、每客户端及 F0 资源级限流、明确
错误和 `cache-only` 回滚。语言分别绑定 Jenny / Nanami / Xiaoxiao Neural。
客户端 API、CSP 音频 Blob 支持和 URL 缓存版本沿用已完成的 TTS 改造。

Android、Room schemas、D1 migrations、Task26 API、Task11 服务、Llama
模型/API、财务服务未修改。主页、财务及 wrong-review-sync 等文件的额外
diff 仅为统一资源 release 引用；不修改账户、学习记录、真实财务或正式版本。

## 本地联合回归

原始日志/临时库/构建均在忽略路径 `.wrangler/tts-evidence/v63/`；P04 HTTP
合同产物在忽略的 `docs/migration-evidence/finance-p04/v63-tts-contracts/`。

| 检查 | 本轮结果 | 范围 |
| --- | --- | --- |
| TTS API | 26/26 PASS（含总测试） | 本地 Miniflare D1/R2，模拟上游，缓存/429/认证/超时/网络错误 |
| 语言模块 | PASS | 三语映射、明确错误、无设备回退、停止后不迟播 |
| 编译后 Pages workerd | 9 场景 PASS | 实际中间件和路由，GET/POST、缓存、302/401/429/503/504 |
| Chrome 合成传输 fixture | 14 场景 PASS | 桌面/移动视口，CSP、解码播放、错误提示；不是 Azure 实际声音 |
| Task26 全套 | PASS | package.json 的全部入口，包含 wrong-review engine/D1/client、Mastery、离线/多窗口/outbox |
| Task11 | 27 checks PASS | model 7、API 10、真实本地 D1 10 |
| P07 原子发布单测 | 17/17 PASS | 保留原 RC5 合同，新增旧 speech 模块拒绝发布 |
| 实际 Chrome SW | 8 场景 PASS | 正常、慢网、失败重试、流超时、暖更新、Task26 失败、旧内容混入、暖更新失败回滚 |
| P07 runtime/state | 9/9 PASS | 启动、身份、后台策略、财务离线 fixture |
| P07 主页/交互投影 | PASS | Home widgets、P5 lazy ownership、P3 public unit suites |
| Web 财务 P03 | 25/25 PASS | 本地真实 D1 产品服务，合成事件 |
| P04 六币种/FX | 20/20 PASS | 金额精度、JPY、来源单位、快照、聚合、重放 |
| P04 HTTP 合同 | 39/39 PASS | loopback HTTP + 真实本地 D1，不操作真实财务 |
| Android | 824/824 PASS，119 suites | failures/errors/skipped 均 0；包含既有 Room/财务迁移回归 |
| Android lint / Debug / AndroidTest 构建 | PASS | 仅构建，未签正式候选或安装到手机 |
| 模块图 / storage | PASS | 62 模块、105 imports；31 稳定 key 家族 |

Debug APK hash：`c94c68a9bd951b077ccca1880c19c8b4ec1b81842bf9101df462ed48004a12e6`，
83,166,580 bytes；不是正式签名 APK，不改变正式身份或 Stable 指针。
测试编译的既有弃用警告不作为失败，也没有为它们修改无关产品代码。

## 真实服务与试听步骤

本机安全配置 Key 1 后，顺序调用三语短句，并查询一次 eastasia 音色列表：

```powershell
node --env-file=.dev.vars qa/tts/live-azure.mjs --out .wrangler/tts-evidence/v63/live-azure-run1
npm run test:tts:audio -- .wrangler/tts-evidence/v63/live-azure-run1
```

输出目录不得覆盖先前 result.json。服务测试记录 locale、voice、MIME、HTTP、
原始 MP3 hash、cache miss/hit、实际合成和音色查询次数；缓存回读不得增加合成。
Chrome 对相同 hash 的原始 MP3 进行完整解码、非静音 PCM 检查与播放，使用
隔离本地 D1/R2 重放样本，避免重复消耗 Azure 额度。该重放不是新 Azure 调用。

仅在真实调用通过后写 `AZURE_API_PASS`；原始 MP3 的浏览器验收通过后写
`LOCAL_AUDIO_PASS`。人未实际试听则始终 `LISTENING_PENDING`；移动视口不
等于 Samsung 或 Android WebView 真机。授权的隔离 Hosted 环境尚需独立配置
region/encrypted Secret 和专用 fixtures，并重新验收精确候选。

## 切换与回滚

参见 [更新后的切换手册](AERIS_AZURE_TTS_CUTOVER_RUNBOOK.md)。生产放行需要
真实 API/三语试听、适用 Web/Android 和 Hosted 门槛、精确 SHA Core CI。
回滚仍基于当前统一候选，设置 `TTS_MODE=cache-only` 并重新部署，保留新的
cloud-only 客户端、81+2 资源层、原子发布和用户缓存；不恢复旧 MeloTTS/设备
回退，不清空 R2，不改变 Llama、账户、学习记录、正式 Android 或财务数据。

Task26 的 `CLOSED_WITH_OWNER_WAIVER` 及其 WAIVED 项保持原状态，没有重新
标成 PASS。本任务结束后停止，不继续其他功能。
