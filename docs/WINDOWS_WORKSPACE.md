# Windows 固定工作区

统一入口：`%USERPROFILE%\Desktop\编程\thewyj.uk`（`%USERPROFILE%` 为当前 Windows 用户目录）。

当前 Android Hotfix 开发与发布已按所有者要求暂停。迁移后仍保留原 Hotfix
分支和未提交改动；迁移成功不代表 Hotfix 验收或发布成功。继续前先读
`PAUSED_DEVELOPMENT_HANDOFF.md` 和 `WORKSPACE_MIGRATION_REPORT.md`。

## 启动与本地核查

在此目录打开 PowerShell / Codex，不需要改全局 Codex 配置。

```powershell
Set-Location (Join-Path $env:USERPROFILE 'Desktop\编程\thewyj.uk')
git status --short
git branch --show-current
git remote -v
npm ci --ignore-scripts --no-audit --no-fund
node scripts/check_js_module_graph.mjs
node scripts/check_storage_contract.mjs
npm run cf:check
npm run test:task26
```

前端使用原生 HTML/CSS/JS，正式资源不需额外打包。Cloudflare 开发工具版本以
package-lock.json 为准，不为迁移升级依赖、compatibility_date 或环境配置。
`wrangler.local.jsonc` 用于本地 D1/R2；禁止为了本地测试使用 `--remote`。
仅本地迁移的可复现命令：

```powershell
npm run cf:migrate:local
npm run cf:dev
```

这些命令不连接 Production 数据库，不包含 Workers AI 远端 binding。
`npm run cf:dev` 同样先生成 allowlist staging，再从该目录启动；根目录的
私人本地文件不会进入静态服务目录。不要直接把整个开发根目录作为静态目录。
Pages 不接受自定义 `--config` 路径；启动器保留标准开发配置，检查 AI/远端
绑定禁用，再按 wrangler.local.jsonc 的名称显式绑定本地 D1/R2，不覆盖正式配置。
正式模型调用与远端验收需要独立授权、有效账号和既有发布门禁。
空白本地库未创建管理员，且没有复制任何正式 Pepper/Secret，因此首次状态页
可能为 degraded。要启用本地登录/分享/设备会话，应按 `.dev.vars.example`
生成独立随机的本地值，并使用原有本地 fixture 工具；不要复用 Production 凭据。
这不影响已有隔离自动化测试，不代表已完成 Production 或真机验收。

## Android

需要既有 Android Studio JDK、Android SDK 36 和 build-tools 36.0.0。
项目内 `android.overridePathCheck=true` 仅允许 AGP 继续实际构建包含中文的路径；
迁移验收仍执行 Kotlin、资源、Room、unit test、lint 和 APK 构建。
固定 Gradle 9.4.1 的 Windows worker 参数文件还需与系统原生编码一致；项目
`file.encoding=COMPAT` 处理该兼容问题，未改系统编码或升级 Gradle。
源码继续 UTF-8；Linux/macOS 原生 UTF-8 环境不变。参见
[Gradle #30304](https://github.com/gradle/gradle/issues/30304)。
可使用系统 SDK/JDK/Gradle 下载缓存，不依赖旧源码目录。
`android/local.properties` 为本机文件且被 Git 忽略；只配置 SDK 路径，
不放签名密码。也可用进程级环境变量：

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME=Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
Push-Location android
.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest --no-daemon --console=plain
Pop-Location
```

Debug 包独立为 `uk.thewyj.app.debug`。迁移验收只构建，不安装，不运行真机
instrumentation，不请求手机权限，不读写正式 App。正式 applicationId、签名
身份、版本元数据和 R2 Stable 发布指针保持原样。正式签名材料继续保留在仓库外。

## 分支、证据和本地文件

- `origin` 指向 `https://github.com/WYJ0904/thewyj.uk.git`。
- `main` 跟踪 `origin/main`；当前工作分支保留独立 Hotfix。
- `refs/remotes/migration-source/` 保存原本地分支指向；
  `refs/remotes/migration-archive/` 保存原远端引用快照，避免遗漏旧提交。
- `docs/` 保留可审阅报告。`docs/migration-evidence/` 为忽略的本地完整日志。
- `node_modules/`、Gradle/build、`.wrangler/` 为可重建内容，不提交。
- 根目录原有 `_wyj-tools/` 和 `访问口令.txt` 不属于源码，已排除；后者不读取、
  不复制入 Git、不作为静态站点资源。
- 旧日期目录和原始备份保留，迁移不清理旧目录。日常开发不要再从旧目录执行。

没有进行全局 Codex 配置修改。后续项目通过此目录的 AGENTS.md 获取项目约束。
