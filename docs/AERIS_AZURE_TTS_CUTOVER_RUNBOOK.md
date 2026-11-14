# Azure Speech TTS：切换与回滚手册

2026-11-12（香港时间）。本轮 **不执行生产切换**：所有者已创建 eastasia 的
`TTSforwyj`（资源组 `webtothewyj`，Free F0 / Active）。本轮已完成独立代码候选构建、
真实 Azure 三语 API 合成（3 次合成 + 1 次音色查询）、Chrome 本地解码播放及所有者试听确认
（见 `docs/tts/v63/` 与 [独立上线候选报告](AERIS_V63_AZURE_TTS_STANDALONE_HOTFIX_REPORT.md)）。
此文件是后续切换与回滚执行步骤，不能作为已经部署到 Production 的证明。

## 1. 资源和凭据

创建独立的 Azure Speech **F0** 资源，记录真实区域、资源 SKU、额度和三种
Neural Voice 可用性。实现使用 Azure 公有云区域端点；不接受任意 endpoint。
不能只凭本地参数或文档认定资源实际为免费层，也不自动创建或升级 S0。
F0 当前公开额度为每月 50 万 Neural 字符、实时 TTS 每 60 秒 20 次请求；
同时考虑其他应用对同一资源的消耗，以及 Azure 自身的区域/音色容量限制。

需要的配置：

| 名称 | 类型 | 要求 |
| --- | --- | --- |
| AZURE_SPEECH_KEY | Cloudflare 加密 Secret | 与目标资源/区域匹配；不写 vars、Git、前端或命令行参数 |
| AZURE_SPEECH_REGION | 非敏感服务端变量 | Azure 真实区域标识，例如 eastasia；示例不代表已创建 |
| TTS_MODE | 非敏感服务端变量 | azure；回滚候选使用 cache-only |
| TTS_AZURE_RATE_LIMIT | 非敏感服务端变量 | 默认 20/分钟，测试与其他使用者共享资源时按总预算调整 |
| TTS_TIMEOUT_MS | 非敏感服务端变量 | 默认 8000，单次尝试上限 10000 |

`WORKERS_AI_ENABLED`、`AI` binding 和 Llama 模型不因 TTS 改动。不要删除它们
来关闭旧 TTS。旧 `TTS_MODEL` / `TTS_FALLBACK_MODEL` 不再控制新合成路径。

本地服务测试可由所有者安全填写 Git 忽略的 `.dev.vars`，只需有效的 Azure
key/region；不复制 Production 其他 Secret。随后运行：

```powershell
node --env-file=.dev.vars qa/tts/live-azure.mjs
```

不要把密钥粘到聊天、shell 参数或报告。此脚本输出只含状态、公开短句、音色、
音频 hash；结果和 MP3 保存在 `.wrangler/tts-evidence/live-azure/`。无凭据时
退出 2 并记录 BLOCKED；成功只代表 Azure API 和本地 R2 回读通过，试听和设备
状态仍为 NOT_TESTED。

对专用 Hosted 项目，使用交互式 Secret 输入，命令中不带值：

```powershell
npx wrangler pages secret put AZURE_SPEECH_KEY --project-name <isolated-tts-project> --env preview
```

Production 使用同一命令的生产目标，**仅在下述门槛完成后**配置并发布。
Preview/Production 的 Secret 必须分别核查；Secret 设置不会证明已有 deployment
已使用它，必须对实际新 deployment 验证。

## 2. 必须完成的隔离验收

先运行已提供的本地检查：

```powershell
npm run test:tts
npm run test:tts:runtime
npm run test:tts:browser
npm run cf:types
```

需要验证当前未提交资源的 SW 安装行为时，使用唯一输出目录，保留旧日志：

```powershell
node qa/p07-release/sw-install-browser.mjs --source WORKTREE --label azure-tts --cases normal,warm,failure-retry --out .wrangler/tts-evidence/sw-install-next
```

`WORKTREE` 会记录实际资源 hash manifest；它的 source_sha 是基线，不能把
工作文件结果声称为该基线提交的验收。正式候选应提交/评审后以准确 SHA 重测。

实际服务测试、试听及 Hosted 门槛如下，任何一项缺失都保持 release held：

1. `live-azure.mjs` 三语真实请求均成功，原始 MP3、hash、voice、尝试数和缓存
   回读记录齐全。首次请求必须为 miss，再次为 hit。不得用静音 fixture 替代。
2. 试听英语、中文及日语，记录试听人、时间、设备、样本 hash。日语样本至少
   包含「先生と学生が日本語を勉強しています」及听写常用汉字词，确认使用
   日本语音、读法正确；中文不能跑到英语语音。确认速度变化只调整播放器。
3. 使用独立 Pages 测试项目与**专用 D1/R2 fixtures**，不复用 Production，也
   不假定已有共享 Preview 是可写的空环境。把 region 和 encrypted Secret
   配入其正确环境，验证新部署的 GET/POST、三语 cold/hit、限流和故障提示。
   429/认证/超时故障用受控模拟，不能通过耗尽真实免费额度或破坏生产密钥造故障。
4. Web 在当前支持浏览器实际播放三语 Azure 音频，覆盖冷启动、已有 PWA 更新、
   重试与停止。核查 429、认证错误和不可用状态给出明确提示，设备语音调用为 0。
5. Android 使用独立 Debug 包 `uk.thewyj.app.debug` 和测试 URL，验证实际 WebView
   三语音频、网络故障/恢复、页面重载/重启及速度调整。不得覆盖正式 App、切换
   手机权限、读取正式数据或改签名/Stable 指针。桌面移动视口不能替代此项。
6. 所有页面确认加载 `20261112-aeris-azure-tts-r1` 或后续受审查的同源 release。
   新部署不会改写已经运行的旧 JS；旧标签页和 WebView 必须正常重载以使用新
   cloud-only 客户端。保留其 cookie/localStorage/IndexedDB，不能通过清空用户
   数据获取“更新成功”。记录暖缓存更新结果和仍未更新的会话限制。
7. 精确候选 SHA 的必要 CI 和独立 Hosted 验收通过，关联报告保留原始失败及
   修正记录。此次本地 PASS 不能充当 CI/Hosted/Production 或实际声音验收。

## 3. 生产切换

执行前重新只读核查实际 Production SHA、deployment 和配置，防止与其他工作
并发漂移；本轮记录的 deployment 是 `5d8f4c8e-94d0-4bf2-add1-a4989a69bb41`，
source `4fc025a`。若有变化，应在新正式基线重新审阅 TTS 变更，不带入暂停的
Hotfix WIP、财务分支或其他未发布功能。

所有隔离门槛完成后，在受审查配置的 production 范围设置真实 region、
`TTS_MODE=azure`，通过 Cloudflare Secrets 写入 Azure key。保留其余远端配置、
D1/R2 binding、AI、feature flags 和正式 Android 元数据。无需新数据库迁移。

发布输入始终由现有 allowlist 脚本生成：

```powershell
node scripts/stage_pages_deploy.mjs
```

只能发布 `.wrangler/pages-output` 中受审查的静态文件及 Functions；不要把
开发根目录传给 deploy。沿用现有受控 Pages 发布流程，部署记录必须对应精确
候选源码。若使用 CLI，目标是 `thewyj-uk` 的生产环境/受审查分支；不要把隔离
项目命令复制成生产发布，也不要临时关闭其他业务门禁来完成 P0。

切换后用公开短句执行最小线上 smoke：三语音频、voice/format、hit/miss、错误
响应，以及 Web/Android 已加载的新 release。此时正常 TTS 请求会写入原有
限流表和新的音频缓存，这是上线行为，不能把它写成“零 Production 操作”。
记录 deployment、源码 SHA、资源 SKU/区域、Secret 名称（不含值）、样本 hash、
实际试听和缓存结果，观察 Azure 429/认证/超时。出现不满足项执行下述回滚。

## 4. 安全回滚

在切换前准备一份基于相同 TTS 候选、**仅令 production TTS_MODE=cache-only**
的受审查回滚配置，保留新的 cloud-only 客户端与 P07 worker。以独立资源 release
标识生成 allowlist staging；在隔离环境验证缓存 hit=200、miss=503、Azure 调用
为 0，并验证用户数据保留。当前本地自动化已经覆盖该服务端模式。

出现事故时部署这份 cache-only 候选，确认新 deployment 的配置确实生效。
这会暂时限制未缓存短句的朗读，但仍提供明确错误且不会切换设备 TTS。已经
缓存的有效音频继续使用；不清空 R2、不删旧对象、不改账户或学习记录，也不
调整 Llama、其他 feature flags、D1 schema 或 Android 签名/正式版本指针。

旧 Production deployment 仅保留为历史基线，**不应直接作为本迁移的长期安全
回滚**：旧代码依赖即将退役的 MeloTTS，并含设备回退路径。特别是在 2026-11-20
后，旧部署不能保证未缓存朗读正常。需要恢复新合成时，修复/轮换 Azure 配置，
在隔离环境重过对应门槛，再将 TTS_MODE 恢复 azure 并重新部署。

回滚后记录新 deployment、缓存成功/未命中失败、零 Azure 新合成、客户端 release
和数据保留证据。Cloudflare 上已有 Secret 的明文不可回读；需要轮换时从安全
保管处操作，不把 Secret 输出到日志或 Git。
