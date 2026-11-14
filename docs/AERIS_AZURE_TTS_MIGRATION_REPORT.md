# Aeris P0：Azure Speech TTS 迁移报告

日期：2026-11-12（香港时间）。状态：**LOCAL_READY / BLOCKED_AZURE_RESOURCE / PRODUCTION_NOT_SWITCHED**。

所有者已确认尚未创建 Azure 资源，本轮先完成代码和隔离测试。实际 Azure 调用
**0 次**；真实声音试听、Android 真机和 Hosted 验收均未执行，不能据此发布。
本任务只恢复 TTS 迁移，不恢复暂停中的 Android Hotfix 或财务 AI。

## 基线与保护

- 从固定 checkout 的 `origin/main` 创建隔离工作树和普通分支
  `codex/aeris-azure-tts`；基线 `4fc025a044e5e39d742166df9510d488413f7043`。
  固定 checkout 的 Hotfix 分支、未提交工作和原发布证据保留。
  最终核对原 checkout 的 HEAD/status 及 13 个 tracked 修改、30 个 untracked
  文件的逐文件 hash 均保持；证据为 `source-preservation.json` 与
  `scope-verification.json`。本轮 TTS 候选仍为本地未提交修改。
- Cloudflare 只读核查确认 Production deployment 为
  `5d8f4c8e-94d0-4bf2-add1-a4989a69bb41`，source `4fc025a`。
  主项目 `thewyj-uk`，Production R2 为 `wyj-cloud-production`，Preview R2
  为 `wyj-cloud-preview`；Workers AI binding 仍存在且开启。
- Production 和 Preview 的 Secret 名录均没有 `AZURE_SPEECH_KEY`；本机
  Process/User/Machine 环境变量及固定 checkout 的常规本地配置也未发现
  Azure 配置。没有读取根目录私人口令文件，没有复制旧工作区凭据。
- 本轮未 push、merge、部署、变更云端 Secret、远端迁移、操作正式 R2 对象、
  改账户/学习记录/权限/手机数据、签名或 Stable 指针。

## 实现

`functions/_lib/tts-api.mjs` 在缓存 miss 时只调用 Azure Speech REST API。
既有 Workers AI binding 和 Llama 文字 AI 保持原样，TTS 不依赖其开关。
服务端保留 GET/POST `/api/tts`、`text`、`language`/`lang`、`voice=default`、
240 字符限制、二进制音频、错误 JSON、ETag 和原有 TTS 响应头。

| 规范语言 | Azure locale | 固定 Neural Voice |
| --- | --- | --- |
| en | en-US | en-US-JennyNeural |
| jp（兼容 ja / ja-JP 等别名） | ja-JP | ja-JP-NanamiNeural |
| zh | zh-CN | zh-CN-XiaoxiaoNeural |

SSML 文本进行 XML 转义，不把用户文本当语音标签。区域只用于构造固定
`*.tts.speech.microsoft.com` 主机；密钥只放请求头。请求采用手动重定向并
拒绝 3xx，不把密钥转发到其他主机。输出统一为 24 kHz / 48 kbit/s mono MP3。
每次 Azure 请求的默认 8 秒截止时间覆盖响应头和音频流；网络/5xx 最多两次
尝试，认证、429、超时和无效音频不自动重试，不切换其他供应商。

| 情况 | HTTP / code | 行为 |
| --- | --- | --- |
| 未配置或配置无效 | 503 / tts_not_configured | 不调用 Azure，retryable=false |
| Azure 401/403 | 503 / tts_auth_failed | 明示管理员检查密钥/区域，不导致账户被当作失效 |
| 上游或资源级限流 | 429 / tts_quota_exhausted | 返回 Retry-After，不重试/绕过额度 |
| 超时、上游 408/504 | 504 / tts_timeout | 中断请求，不重复合成 |
| 网络/持续 5xx | 503 / tts_service_unavailable | 最多两次；失败保留明确错误 |
| 3xx、其他上游 4xx | 503 / tts_provider_rejected | 不跟随、不重试 |
| 空或非音频/超大响应 | 503 / tts_empty_audio 或 tts_invalid_audio | 不写入缓存 |
| cache-only 模式下 miss | 503 / tts_unavailable | 不进行新合成 |

原有每客户端限流保留；额外复用现有 D1 限流表，为每次 Azure 合成尝试计入
资源级预算，默认 20 次/分钟，缓存命中不消耗该预算。资源级限流不可用时
fail closed，不新增数据库迁移。固定窗口不能替代 Azure 自身的速率判断；
Azure 429 仍按上表处理。F0 是 Azure 资源 SKU，需要创建资源时选择；代码
不会创建付费资源或自动升到 S0。F0 的月度字符额度由 Azure 执行。

## 缓存、客户端与回滚

- 保留 `tts/v2/...` 的旧 key 算法。Azure 的 key 纳入 voice、输出格式及
  adapter r1；正常情况下优先读取 Azure，再读取旧 MeloTTS/Gemini 对象。
- 验证音频格式后复用旧 EN/ZH 对象。旧 JP 对象缺少可确认的语种/音色，
  仅在已有 `ttsLocale=ja-JP`、`ttsVerified=true` 人工复核标记时复用；否则
  保留原对象，生成独立的日语 Azure 缓存。本轮没有给历史对象批量添加标记。
- 新缓存只写音频及供应商/locale/voice/format 元数据，不储存原文或密钥。
  缓存读取/写入故障可继续提供已经生成的音频；限流仍生效。
- Web/Android 共享 `js/language/speech.js`：先读取 API 错误 JSON，再播放
  云端音频 Blob；CSP 仅为音频增加 `media-src 'self' blob:`。移除客户端
  自动设备 TTS 路径，保留 `speakText` 的返回值/pending 协议及 playbackRate。
  中文与日语语言映射均有回归测试。停止/替换请求会取消待播音频，不迟发朗读。
- 音频 URL 的 v 改为 `azure-neural-r1`，绕开旧 HTTP 音频；使用现有资源
  更新脚本将 shell 统一升级为 `20261112-aeris-azure-tts-r1`。其余源文件的
  改动仅为必要的资源版本引用，未修改业务逻辑或品牌资源。
- `TTS_MODE=cache-only` 是安全回滚候选：继续提供有效缓存，明确拒绝未缓存
  请求。它需要更新配置并重新部署，不是即时远端 feature flag。具体步骤和
  保留旧客户端的限制见 [切换与回滚手册](AERIS_AZURE_TTS_CUTOVER_RUNBOOK.md)。

## 本轮验证

原始日志和可重建样本仅放忽略路径 `.wrangler/tts-evidence/`。

| 检查 | 结果 | 证据/范围 |
| --- | --- | --- |
| TTS API 隔离测试 | PASS：26/26（含总测试） | `tts-final.log`；真实本地 D1/R2，模拟 Azure |
| 语言模块回归 | PASS | 同上；错误提示、三语映射、不调用设备 TTS、停止取消 |
| 编译后 Pages worker/workerd | PASS：9 场景 | `workerd-final.log` / `workerd-result.json`；包括中间件、GET/POST、R2 流、302/401/429/503/504 |
| 实际 Chrome 桌面/移动视口 | PASS：14 场景 | `browser-result.json`；6 个三语播放/缓存场景与 8 个明确错误场景，CSP 和解码器实际执行 |
| PWA 安装/升级/失败后重试 | PASS：3 场景 | `sw-install-working/results.json`；当前工作文件 hash manifest，保留合成 localStorage/IDB/用户缓存 |
| Android 定向 JUnit | PASS：16/16 | `android-build-first.log`；11 项 WebRoutePolicy + 5 项既有 SpeechVoicePolicy |
| Android Debug APK | BUILD SUCCESSFUL | 同上；未签正式候选、未安装或改变手机 |
| Functions build / Wrangler types | PASS | 固定 Wrangler 4.118.0；未升级依赖或 compatibility_date |
| JS 模块图 / storage / cloud-only gate | PASS | 58 模块、29 稳定 storage key 家族、既有 gate |
| Android 正式元数据一致性 | PASS：36 checks | 1.3.37 / code 50 等既有正式值未改 |
| 仓库敏感内容/路径审计 | PASS：1409 files | `repository-audit-final.log`；包含本轮新增报告与 QA |
| allowlist Pages staging / diff 空白检查 | PASS | 不上传工作区、docs、QA、凭据或本地工具 |
| 真实 Azure 服务、语音试听 | BLOCKED / NOT_TESTED | `live-azure/result.json`，缺资源，真实调用 0 |
| Android 真机 / Hosted / CI / Production | NOT_TESTED / NOT_SWITCHED | 不把移动视口、旧单测、构建或本地通过提升为这些验收 |

第一次 workerd 测试失败日志保留在 `workerd-first.log`、
`workerd-diagnostic.log`；独立探针证明 `redirect: error` 在 workerd 抛错，
请求尚未出站。已修正为 manual 并拒绝所有重定向，新增 302 回归后重跑通过。
没有覆盖原始失败或把它归因于 Azure 服务。

本轮浏览器音频是人工构造的**静音 MP3**，仅验证请求、解码和播放链路；没有
Azure 发音内容，不能判断自然度、日语汉字读法或中英日发音正确性。
Android 原有本地语音策略测试只证明原代码构建/回归，不能当作 Azure 真机验收。
Blob 音频在异步请求后启动，所支持浏览器和实际 WebView 的用户手势/自动播放
行为仍需真实验收；当前实际浏览器证据仅覆盖已记录的 Chrome 桌面和移动视口。

## 交付和剩余阻塞

可执行入口：`npm run test:tts`、`npm run test:tts:runtime`、
`npm run test:tts:browser`。CI 已增加编译后 Worker 隔离测试入口，本轮未推送
或调度 CI。真实服务入口 `qa/tts/live-azure.mjs` 缺凭据时退出码为 2，并明确
记录 BLOCKED；有资源后仅对三段公开合成测试短句调用 Azure，使用临时本地
D1/R2，保存 MP3/hash 和缓存回读证据，试听及设备验收仍需独立完成。

生产放行仍缺：F0 资源与区域、加密 Secret、三语真实 API/试听、Web 与 Android
实际音频验收、独立 Hosted 环境验收和候选 CI。详见切换手册。本报告没有授权
绕过这些门槛，也没有把 Task 26 的 owner waiver 改成 PASS。

## 官方依据

- [Cloudflare MeloTTS 模型页](https://developers.cloudflare.com/workers-ai/models/melotts/)：计划退役 2026-11-20。
- [Azure Speech REST TTS](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech)：认证头、SSML、区域端点、MP3 和错误状态。
- [Azure Speech 语言和音色](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts)：三语 Neural Voice。
- [Azure F0 配额](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits)：实时 TTS 20 次/60 秒。
- [Azure Speech 价格](https://azure.microsoft.com/en-us/pricing/details/speech/)：F0 Neural 每月 50 万字符，需以实际资源 SKU/额度为准。
- [Cloudflare Pages Secrets](https://developers.cloudflare.com/pages/functions/bindings/#secrets)：密钥以加密绑定保存，部署前配置。
