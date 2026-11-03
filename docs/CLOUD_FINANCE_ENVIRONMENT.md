# 非生产财务云运行时

本环境只用于隔离财务开发与合成数据测试。使用 `/workspace/thewyj.uk`
现有检出和普通分支，不另建日期副本。所有者上传的 P03 bundle 已在该检出
校验并导入，原始 P03 HEAD 为 `5d96e1ee5d2064076bd0efa59eed86edb9b1c4cc`。
不能用 GitHub 旧 main 替代此继承关系。

## 工具与启动

```bash
source /workspace/.cloud-onboarding/android-env.sh
cd /workspace/thewyj.uk
```

工具：Node 22.23.3、完整 Temurin JDK 21.0.12.1+1、Android SDK Platform 36、
Build Tools 36.0.0、仓库 wrapper 锁定 Gradle 9.4.1、系统 Chromium。
Node/JDK 下载核对官方 SHA-256；Android command-line tools 19.0 核对官方
仓库公布校验值，SDK Manager 保留其安装验证。Gradle wrapper 原有 SHA-256
未修改。所有缓存位于 `/workspace/.cloud-onboarding`。

预装系统 Java 21 仅有运行时，缺少 `javac`，因此没有把它当完整 JDK。
Robolectric 下载锁和 Maven 缓存需要可写用户目录；独立 Gradle init 脚本
将测试 JVM 的 `user.home`、Maven 缓存、代理与系统 CA 信任库配置到隔离路径。
没有关闭 TLS、签名或校验值验证，没有改依赖与锁文件来绕过安装。

完整安装和启动说明已保存到环境配置草稿的 `install_script`、`start_skill`；
草稿保存不等于执行、应用或发布。当前实例已实际执行安装与验证，未验证新任务
恢复，也未发布环境或产品。P03 含尚未推送的本地提交，不能声称单凭远端能恢复。

本地 Pages：

```bash
bash /workspace/.cloud-onboarding/start.sh
```

启动器先生成 allowlist staging，只服务 `.wrangler/pages-output`。D1/R2 仅使用
本地 binding 和 `.wrangler/onboarding/state`；财务读写开启，AI、设备入口、
管理员模块和 legacy fallback 关闭。被忽略的 `.dev.vars` 使用独立本地随机值，
不复用正式值。Pages 不支持单个自定义 `--config` 路径，启动器没有使用该参数。

就绪请求 `/api/status?source=cloud` 应返回 development、status=ok、本地 D1/R2
binding、Task16 schema ready、财务读写开启和 ai_ready=false。仅端口可用不算验证。

## 已执行的必需检查

在 P03 原始 HEAD 上，完成了本轮 681 项 JVM/Robolectric 测试，全部通过；
Lint 没有 Error/Fatal（75 Warning、12 Hint）；Debug 构建成功。
本地 HTTP 注册、登录、撤销会话、未授权财务访问拒绝、Chromium 登录 UI 均通过。
测试包基础地址设为 `https://isolated-finance.invalid`，仅构建，没有安装。

```bash
cd /workspace/thewyj.uk/android
bash gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug \
  --no-daemon --max-workers=2 --console=plain --stacktrace \
  -PTHEWYJ_BASE_URL=https://isolated-finance.invalid
```

只允许一条 Gradle 命令同时运行。每次归档当前 JUnit、Lint、日志、APK 校验值后
再执行其他测试源集；零测试、历史文件、失败和跳过都不能记为本轮 PASS。
P03/P04 验收另有专门矩阵，以上仅证明开发运行时可用。

## 2026-10-22 P04 接续后的实际状态

所有者已撤销 Windows 交接暂停；同一云端线程继续，不从旧 main 重建。
原 P03 `5d96e1ee` 与云端收口提交 `dd5fc98b` 的继承已核验，封存的 77 个 WIP
源码及 1033 个证据在继续前全部与检查点 SHA-256 一致。当前 P04 结果见
[统一报告](finance-p04/FINANCE_P04_FINAL_REPORT.md)，不复用旧 702 测试结论。

最终源码完整 JVM/Robolectric 为 705 PASS（含 P03 681 和新增 24），Lint 为
0 Error/Fatal、76 Warning、12 Hint，Debug 构建成功、目标 URL 仍为
`https://isolated-finance.invalid`。所有 Gradle 串行，结果在新独立目录归档。
Room 当前 15；仅隔离本地库应用 0031/0032，实际查询 Task16 D1=4、Task21 D1=8。
回退到旧二进制写库被拒绝，不能用 Git checkout 当作数据库降级。

本地 Task21 HTTP 财务读写由启动器启用，仅用于合成接口测试；不启用手机监听、
系统权限或 Android 设备入口。runtime smoke 实际验证合成注册/登录/撤销、
未授权/无权益拒绝及 Chromium 登录页，status 为 development、本地 D1/R2 ready、
AI 关闭。只服务 allowlist staging；不复制正式凭据。

Frankfurter v2 公开参考接口的早期 CONNECT 403 保留。2026-10-22 当前代理下
真实提供方 12 项验证通过，包括六币种双向对、前营业日及真实 D1 cache/历史
参考；它不授予支付 provider 的身份权威，不是成交价或 Production 测试。
后续新任务仍须重新检查实际网络和本地提交，不按历史成功假设可用。

环境配置的安装/启动说明和 schema 8 仅保存草稿，未发布/激活新配置；本实例
实际工具链和本地验证已执行，但未独立验证新 VM 恢复。P03/P04 仅本地提交、
未 push，远端 main 不包含完整成果；必须保留本地 bundle 和 ignored QA 证据。

## 所有者边界

不运行 ADB、模拟器或手机，不安装 APK、不恢复正式权限、不读取真实财务数据、
Production D1/R2 或根目录 `访问口令.txt`。不 push、PR、merge、正式签名、
部署或发布，不进入 P05/P06。Windows 主工作区、Task26、Hotfix、D01/D02 的
历史保护观察不能在云端被冒充为重新执行。
