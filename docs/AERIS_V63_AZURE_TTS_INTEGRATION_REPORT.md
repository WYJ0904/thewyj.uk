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

本机最初未配置密钥，首次 preflight 明确退出 2、真实请求为 0，原始阻塞结果
保留。随后所有者通过本机遮蔽输入窗口配置 Key 1；只写入 Git 忽略的
`.dev.vars`，没有把密钥复制到报告、音频、源码、日志或远端 Secret。

- Azure 实际请求：**AZURE_API_PASS**；3 次顺序合成、1 次音色列表查询，共 4 次。
- 实际 Azure MP3 的 Chrome 解码/完整播放：**LOCAL_AUDIO_PASS**。
- 人工试听：**LISTENING_PASS_OWNER_CONFIRMED**；所有者在本聊天确认三语语言和
  声音均正常。没有声称 Codex 进行了人工听觉判断，也没有记录试听设备型号。
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
| 真实 Azure F0 REST | 三语 PASS | 每语 1 次合成，音色列表 1 次；均 200，缓存 hit 新合成为 0 |
| 原始 Azure MP3 Chrome | LOCAL_AUDIO_PASS | 三语 × 桌面/移动视口，完整解码和播放、非静音 PCM、CSP 与 cache |
| 所有者实际试听 | LISTENING_PASS_OWNER_CONFIRMED | 绑定下表三个原始 MP3 hash，确认中英日声音/语言正常 |
| Task26 全套 | PASS | package.json 的全部入口，包含 wrong-review engine/D1/client、Mastery、离线/多窗口/outbox |
| Task11 | 27 checks PASS | model 7、API 10、真实本地 D1 10 |
| P07 原子发布单测 | 17/17 PASS | 保留原 RC5 合同，新增旧 speech 模块拒绝发布 |
| 实际 Chrome SW | 8 场景 PASS | 正常、慢网、失败重试、流超时、暖更新、Task26 失败、旧内容混入、暖更新失败回滚 |
| 提交后 P07 派生回滚 | 2/2 PASS | 保留全部 81 资源身份，逐项重绑原子完整性 |
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

## 真实服务与试听结果

2026-11-12 18:44（香港时间）开始真实服务验收。Azure 返回以下三个原始 MP3；
本地 D1/R2 每语首次 miss、再次 hit，返回字节完全一致，hit 新增 Azure 合成为 0。
eastasia 的实际音色列表也确认三个 voice 均为对应 locale 的 Neural 类型。

| 语言 / locale | voice | HTTP / MIME | 字节 / 解码时长 | SHA-256 |
| --- | --- | --- | --- | --- |
| en / en-US | en-US-JennyNeural | 200 / audio/mpeg | 28,224 / 4.704s | `8d1594f6d863deb18a6d968a309be4e3d73c9187fbe14c767222beccc1a0ee35` |
| jp / ja-JP | ja-JP-NanamiNeural | 200 / audio/mpeg | 24,480 / 4.080s | `59e16d0659f480748894b90aab3a77aa94daf587abfa1def73a6378670dab8bd` |
| zh / zh-CN | zh-CN-XiaoxiaoNeural | 200 / audio/mpeg | 28,080 / 4.680s | `d348ce95552aeb9509d469e670c5c547d9077739687bade6e86a0162a910b1f8` |

解码得到 24 kHz 单声道非静音 PCM：EN/JP/ZH RMS 分别约 0.0752 / 0.1489 /
0.1089。Chrome 在桌面和移动视口完整播放相同 hash 的原始 MP3，并覆盖 8 个
模拟错误提示场景；此阶段只重放已生成音频，新增 Azure 请求为 0。
最初生成结果中的 LISTENING_PENDING 按原样保留，后续所有者试听确认另存
receipt，避免把生成时状态改写为当时已听过。

可审阅证据：[acceptance.json](tts/v63/acceptance.json)、
[原始 Azure 元数据](tts/v63/azure-api.json)、[Chrome 解码播放](tts/v63/local-audio.json)、
[所有者试听确认](tts/v63/listening-confirmation.json)。音频：[英语](tts/v63/en.mp3)、
[日语](tts/v63/jp.mp3)、[中文](tts/v63/zh.mp3)。均为公开测试短句，不含密钥或财务文本。

### 重现方法

本机安全配置 Key 1 后，顺序调用三语短句，并查询一次 eastasia 音色列表：

```powershell
node --env-file=.dev.vars qa/tts/live-azure.mjs --out .wrangler/tts-evidence/v63/live-azure-run1
npm run test:tts:audio -- .wrangler/tts-evidence/v63/live-azure-run1
```

输出目录不得覆盖先前 result.json。服务测试记录 locale、voice、MIME、HTTP、
原始 MP3 hash、cache miss/hit、实际合成和音色查询次数；缓存回读不得增加合成。
Chrome 对相同 hash 的原始 MP3 进行完整解码、非静音 PCM 检查与播放，使用
隔离本地 D1/R2 重放样本，避免重复消耗 Azure 额度。该重放不是新 Azure 调用。

本轮已完成 `AZURE_API_PASS` / `LOCAL_AUDIO_PASS` 和所有者试听确认；以后
重测若人未实际试听仍应写 `LISTENING_PENDING`。移动视口不等于 Samsung 或
Android WebView 真机。授权的隔离 Hosted 环境尚需独立配置
region/encrypted Secret 和专用 fixtures，并重新验收精确候选。

## 切换与回滚

参见 [更新后的切换手册](AERIS_AZURE_TTS_CUTOVER_RUNBOOK.md)。生产放行需要
适用 Android 真机、独立 Hosted 门槛和精确 SHA Core CI；本轮 API、隔离 Web
播放器及三语试听已完成，不能提升为这些剩余环境的验收。
回滚仍基于当前统一候选，设置 `TTS_MODE=cache-only` 并重新部署，保留新的
cloud-only 客户端、81+2 资源层、原子发布和用户缓存；不恢复旧 MeloTTS/设备
回退，不清空 R2，不改变 Llama、账户、学习记录、正式 Android 或财务数据。

Task26 的 `CLOSED_WITH_OWNER_WAIVER` 及其 WAIVED 项保持原状态，没有重新
标成 PASS。本任务结束后停止，不继续其他功能。
