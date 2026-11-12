# Aeris V6.3：P0 Azure Speech TTS 独立上线候选报告

**日期**：2026-11-12（香港时间）  
**执行 Agent**：Gemini Flash High  
**分支**：`flash/p0-azure-tts-standalone-hotfix`  
**基线**：生产 `main` HEAD `4fc025a044e5e39d742166df9510d488413f7043`  
**状态**：`DRAFT_PR_READY` / `LOCAL_TESTS_PASS` / `REAL_AUDIO_CONFIRMED` / `PRODUCTION_NOT_SWITCHED`  

---

## 1. 目标与背景

生产环境旧版 Workers AI MeloTTS 处于服务退役阶段，且存在日语读音发音异常与设备静默回退问题。此前 Codex 已完成基于 Azure Speech REST API 的三语 Neural Voice 改造，并在联合候选 #147 中集成了真实 F0 资源测试与试听。

为了避免 TTS 修复受阻于尚未完成真机和最终业务验收的**财务 P03/P04 多币种**及 **Task26 错题功能**，本轮在独立 Worktree 中直接以生产 `main`（`4fc025a0`）为精确基准，抽离并构建了一条**最小化、零无关依赖的 P0 Azure TTS 独立热修复候选**。

---

## 2. 变更范围与严格边界

### 2.1 变更严格限定（TTS 必需）

1. **后端合成与缓存 (`functions/_lib/tts-api.mjs`)**：
   - 使用 Azure Speech REST API 区域端点（`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`）。
   - 三语 Neural Voice：英语 `en-US-JennyNeural`、日语 `ja-JP-NanamiNeural`、中文 `zh-CN-XiaoxiaoNeural`。
   - 输出音频格式：`audio-24khz-48kbitrate-mono-mp3`。
   - 保持兼容现有 R2 `audio/v2/{language}/{hash}.mp3` 缓存键规范，不删除、不清空历史合法缓存。
   - 速率限制：客户端 120 次/分 + 资源级 F0 限流 20 次/分（跨 IP 保护免费层配额）。
   - 超时与重试：单次 8000ms 超时，最多 2 次尝试（仅重试 503 等瞬态网络错误；400/401/403/415/429 立即失败）。
   - 降级支持：支持服务端 `TTS_MODE="cache-only"` 安全回滚模式。

2. **前端播放器与调用点 (`js/language/speech.js`, `app.js`)**：
   - 统一 Web 与 Android WebView 播放路径，使用 HTML5 Audio 播放服务端流式/缓存 Blob。
   - 彻底移除设备原生 TTS 静默降级（移除 Android `thewyj://speech/*` bridge 与 Web Speech API 静默降级）。
   - 显式错误提示：遇到 `tts_auth_failed`、`tts_quota_exhausted`、`tts_service_unavailable` 等明确 Toast 提示。

3. **安全与 CSP 配置 (`_headers`)**：
   - CSP 更新：允许播放音频 Blob，`Content-Security-Policy` 增加 `media-src 'self' blob:;`。

4. **环境与运行时配置 (`wrangler.jsonc`, `.dev.vars.example`)**：
   - `wrangler.jsonc`：preview/production 默认启用 `TTS_MODE: "azure"`, `TTS_AZURE_RATE_LIMIT: "20"`, `TTS_TIMEOUT_MS: "8000"`。根级别默认 `TTS_MODE: "cache-only"`。
   - `.dev.vars.example`：增加 `AZURE_SPEECH_KEY` 与 `AZURE_SPEECH_REGION` 占位示例。

5. **PWA 缓存与发布版本号 (`sw.js`, `index.html`, `qa/p07-release/sw-install-browser.mjs`, 各模块 import)**：
   - 版本标识更新至 `20261112-aeris-azure-tts-r1`。
   - 严格保持 `CORE_SHELL` 恰好 81 项 RC5 资源，零新增核心缓存模块，零损坏 PWA 原子安装与回滚机制。

### 2.2 明确排除项（保证独立性）

- ❌ **无财务 P03/P04 变更**：不含六币种、JPY、人工确认逻辑、Room 10→18 数据库或 Outbox 变更。
- ❌ **无 Task26 变更**：不含 wrong-review-v1、Mastery 历史同步等。
- ❌ **无 D1 数据库迁移**：保持 `main` 现有 schema，不引入 `0026`–`0034` 任何迁移。
- ❌ **无 Production 部署或操作**：不修改生产 Secret、D1/R2、APK 或 Stable 指针。

---

## 3. 本地与真实服务验证结果

### 3.1 本地测试套件全绿

| 测试套件 | 验证范围 | 结果 |
| --- | --- | --- |
| `npm run test:tts` | 26 项 Azure TTS 核心逻辑、R2 缓存回读、XML 转义、限流、错误重试与 speech.js 单元测试 | **26/26 PASS** |
| `npm run test:tts:runtime` | Cloudflare Pages functions 构建 + workerd 隔离运行，真实模拟 Azure REST 交互 | **9/9 PASS** (`PASS_SYNTHETIC_RUNTIME_ONLY`) |
| `npm run test:tts:browser` | Chrome 真实无头浏览器播放、Blob 解码、CSP `media-src` 与显式错误展示 | **14/14 PASS** (`PASS_SYNTHETIC_TRANSPORT_ONLY`) |
| `test_static.py` | 静态代码规范、模块依赖图版本唯一性检查 | **31/31 PASS** |
| `sw-install.test.mjs` | PWA Service Worker 81 项 RC5 资源完整性与原子安装保障 | **5/5 PASS** |
| `b3-presentation.test.mjs` | P07 悬浮卡回滚 presentation 策略断言 | **1/1 PASS** |
| `sw-release.test.mjs` | 离线缓存、版本切换与回滚隔离检查 | **4/4 PASS** |
| `repository_audit.py` | 仓库文件合法性与密钥防泄露审计 | **1417 文件 PASS** |
| `npm run pages:stage` | Pages 构建产物输出审计 | **PASS** |

### 3.2 真实 Azure Speech F0 服务验收证据（复用并随附）

所有者已创建 Azure Speech 免费层 F0 资源 `TTSforwyj`（区域 `eastasia`）。在此前隔离测试中已验证真实通信并保留完整证据：

- **API 合成记录 (`docs/tts/v63/azure-api.json`)**：3 次真实合成（en, jp, zh）+ 1 次音色查询，共 4 次真实 HTTP 请求，全为 HTTP 200。
- **本地解码与播放 (`docs/tts/v63/local-audio.json`)**：Chrome 本地解码真实 MP3 原始样本成功。
- **所有者试听确认 (`docs/tts/v63/listening-confirmation.json`)**：所有者已在真实设备试听三语音频，确认发音正常、音质清晰，无语言跑偏。
- **音频样本留存 (`docs/tts/v63/*.mp3`)**：保留合成的 `en.mp3`、`jp.mp3`、`zh.mp3`。

---

## 4. 上线前所有者操作清单与安全回滚

### 4.1 生产上线前必要操作（由所有者在 Cloudflare 控制台或 CLI 执行）

1. **设置 Cloudflare Pages 生产环境加密 Secret**：
   ```powershell
   npx wrangler pages secret put AZURE_SPEECH_KEY --project-name thewyj-uk
   ```
   > 交互式输入 Azure `TTSforwyj` Key 1，切勿将其写入命令行参数、Git 或聊天。
2. **确认环境变量**：
   - `AZURE_SPEECH_REGION`: `eastasia`
   - `TTS_MODE`: `azure`
3. **部署审核**：
   - 必须通过 `npm run pages:stage` 生成受控目录部署，禁止上传整个工作区。

### 4.2 紧急安全回滚策略

若上线后 Azure 产生未预料的 429 配额用尽或服务故障：
- **方案 A（无需重新构建客户端代码）**：
  直接在 Cloudflare Pages 生产环境变量中将 `TTS_MODE` 设置为 `"cache-only"` 并重新触发部署。
  - 效果：已缓存音频（R2 中的常见单词）仍可正常流畅朗读；未缓存的新单词将直接弹出显式友好 Toast，不会产生 Azure 错误堆栈，更不会产生设备静默回退。
- **方案 B（代码级回滚）**：
  保持发布 token，仅在 `wrangler.jsonc` 中设置 `TTS_MODE: "cache-only"` 进行热更。
