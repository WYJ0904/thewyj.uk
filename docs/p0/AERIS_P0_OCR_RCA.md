# Aeris P0 / P05 OCR 根因与三星 SDK 复验

日期：2026-10-31（香港时区）。结论：**部分完成 / 暂缓发布**。

已完成输入、裁剪、尺寸、颜色、方向、模型脚本及冷进程的隔离取证，确认
reference 的错误已出现在原始 ML Kit 输出中。原始六视图仍为 **0/6** 完整
reference 精确识别；原八样本仍为 **8/8 安全断言、2/8 单一 reference 精确绑定**。
新增 Latin 对照改善部分合成文字读取，但仍不能可靠识别混合编号；不得据此
启用 OCR 自动关联、自动入账或正式 Android Stable。

## 授权、版本与保护

- 本轮所有者的《Aeris V6.2 — P0 非 P07 专项最终收敛、真机验收与安全发布总指令》
  明确授权独立开发、SDK 诊断及 Samsung SM-S9360 / API36。它覆盖旧迁移文档的
  暂停要求，但不覆盖其账号、正式数据、原始证据、签名和发布门禁保护。
- 唯一写树：`%USERPROFILE%/.codex/worktrees/aeris-p0-ocr/thewyj.uk`；分支
  `codex/aeris-p0-ocr`；产品基线 `253a776f4bab013b13fdbf7545c932d45c91314b`。
  未切换或写入主工作区、其他并行工作树及旧来源目录。
- 接手的 `qa/p0-ocr/` 五个文件先在忽略的证据目录中逐字节留存。
  `build.py`、`analyze.py`、`sdk.init.gradle`、`P0OcrGeometryDiagnosticTest.kt`
  保持接手字节；`device.py` 仅扩展 Latin 对照、user0 约束和卸载读回。
- **产品源码修改为零**。未修改正式 Gradle 依赖、币种规则、身份匹配、金额解析、
  10 秒 OCR 超时、90 秒 ticket、签名、发布元数据或 feature flag。
  Latin `16.0.1` 仅通过 QA init script 加入诊断 Debug 构建。
- 没有 push、merge、云端操作、远端迁移或 release dispatch。没有调用外部 OCR/AI
  模型，没有上传原图；所有编号与图片均为既有合成 fixtures。

## 可复验输入与方法

冻结方法 `qa/aeris-finance-quality/sdk/ReferenceOcrProbeTest.kt` 的 SHA-256：
`2c6ff27bf9d4839dc7bdc17c828e3a10767a2a2010993f61ca241eebe71c2949`。
原始 PNG SHA-256：
`46e6442173c53550e68f06bc8bbed7cb88557a751c8f244a9baa75100ff4c68f`。
两者在构建前、执行前和离线评分时均核对，未改输入、期望或原方法。

原图为 1080×2200；Android 解码并重编码 PNG 的文件 hash 会变化，但其规范
RGBA 像素 hash 与归档原图相同：
`3dd76f31cf30cb0186578c21e6e52ce7454aa45bc7940218ae67186dfd8a3848`。
未使用期望 reference 进行定位、裁剪、缩放、字符替换或结果选择。评分程序
只在设备证据收集且 QA 包卸载后读取期望值。

新增通用诊断先读取原图，再根据实际识别到的交易号等标签与 SDK 几何边界定位。
它对整行做 padding，并评估原尺寸、24/36/48 像素字高、灰度、RGB565 量化及
90/180/270 度旋转加方向补偿。若 SDK 将标签与编号合为一个 element，程序
不会猜测标签宽度或硬切出编号；本次因此只生成整行 ROI，没有 value-only ROI。

八样本使用冻结方法在设备上生成；它们与归档原图是不同图片。
Latin 对照读取本次冻结方法保存的 PNG，逐张核对 hash，保证中/英文模型之间
使用同一张图片。两次独立 QA 安装的 25 张输出 PNG 全部字节一致，原六视图和
八样本的原始识别行也一致；未将这两次重复计入更多独立样本。

## 原始六视图：失败保持原账

以下期望只用于事后评分，均为合成编号：`SYNTH-P06-JOINT-123456`。
“精确”要求完整 token 相同，不能靠包含子串、O/0 或 I/1 替换、拼接或删前缀通过。

| 原视图 | 原 Chinese SDK 实际 reference | 新 Latin 同像素实际 reference |
| --- | --- | --- |
| original | `SYNTH-P06-J01NT-123456` | `SYNTH-P06-JOINT-123456` |
| full-800 | `SYNTH-PO6-J01NT-123456` | `SYNTH-PO6-JOINT-123456` |
| full-1600 | `SYNTH-P06-J0INT-123456` | `SYNTH-P06-JOINT-123456` |
| reference-1600 | `SYNTH-P06-J0INT-123456` | `SYNTH-P06-JOINT-123456` |
| reference-2160 | `SYNTH-PO06-J01NT-123456` | `SYNTH-PO6-JOINT-123456` |
| reference-gray | `SYNTH-PO06-J01NT-123456` | `SYNTH-PO6-JOINT-123456` |
| 完整精确结果 | **0/6** | **3/6，新增诊断** |

这六个视图是同一图片的派生输入，不是六笔真实支付。
原方法 JUnit 通过代表完成六视图采集，不代表 OCR 准确率通过。

## 完整八样本：原安全结果与新读取对照

| 样本 / 图片内期望 reference | 原 Chinese 实际读取 | 新 Latin 实际读取 | 原安全断言 / 单一精确绑定 |
| --- | --- | --- | --- |
| letters / `ABCDEFGHJKLMNPQR` | `ABCDEFGHJKLMNPQR` | `ABCDEFGHJKLMNPQR` | PASS / 是 |
| digits / `202610260123456789` | `202610260123456789` | `202610260123456789` | PASS / 是 |
| mixed / `AB0O1I2LZ2026` | `AB00112LZ2026` | `ABO0112LZ2026` | PASS / 否 |
| original-alpha / `SYNTH-P06-JOINT-123456` | `SYNTH-P06-J01N-123456` | `SYNTH-P06-JOINT-123456` | PASS / 否 |
| low-resolution / `AB0O1I2LZ2026` | `AB00112LZ2026` | `ABO0112LZ2026` | PASS / 否 |
| blurred / `AB0O1I2LZ2026` | `AB00112LZ2026` | `AB00112LZ2026` | PASS / 否 |
| occluded / `AB0O1I2LZ2026` | `AB001`，截断 | `ABO01`，截断 | PASS / 否 |
| duplicate-references / `202610260123456789` + `OTHER-REF-987654` | `202610260123456789` + `0THER-REF-987654` | 同左 | PASS / 否 |

原八样本结果仍是 **8/8 安全断言、2/8 单一精确绑定**，账目写入为零。
这些断言验证“完整精确关联，否则保留人工核实”的既有合成合同；安全拒绝
不算识别成功。多 reference 样本本来就不允许绑定为唯一编号。

新增 Latin 仅做文字读取：**3/8 完整 reference 集合精确，3/8 单一 reference 精确**；
没有把 Latin 输出接入产品 observer、身份匹配或入账路径，也没有声称它的业务
安全断言是 8/8。`blurred` 存在中/英文模型一致但错误的单串；多编号样本也一致
把 `OTHER` 读成 `0THER`。模型一致不是独立凭证，不能用投票放宽身份门禁。

## 新增几何、颜色及方向控制

以下是同一原图的 **10 个新增视图 × 2 模型**，不替代上述六视图或八样本。

| 新控制视图 | Chinese 完整精确 | Latin 完整精确 | 关键观察 |
| --- | --- | --- | --- |
| source-identity，1080×2200 | 否 | 是 | 未做裁剪即存在脚本模型差异 |
| line-native，940×147 | 否 | 是 | 保留整行与 padding 后仍混淆 O/I |
| line-glyph24，460×71 | 否 | 是 | 缩小字高并未修复 Chinese |
| line-glyph36，690×107 | 否 | 否 | Latin 读为 `3SYNTH-PO6-JOINT-123456` |
| line-glyph48，920×143 | 否 | 否 | Latin 读为 `SYNTH-PO6-JOINT-123456` |
| line-gray，940×147 | 否 | 是 | 与 line-native 像素、PNG hash 均相同 |
| source-rgb565，1080×2200 | 否 | 是 | 量化后 Chinese 仍错；SDK 前仍按产品路径复制为 ARGB8888 |
| rotation-90 + compensation-270 | 否 | 是 | Chinese 有乱码与编号截断 |
| rotation-180 + compensation-180 | 否 | 是 | Chinese 仍读作 `J01NT` |
| rotation-270 + compensation-90 | 否 | 是 | Chinese 有乱码与编号截断 |
| 新控制合计 | **0/10** | **8/10** | 一个原图的控制观察，不是新语料准确率 |

原图仅包含不透明灰度像素，去饱和不增加信息。通用检测行边界为
`[73,827,915,876]`，49 像素 padding 后 ROI 为 `[24,778,964,925]`。
独立像素扫描得到该前景行范围 `[92,828,901,880]`，完整落在 ROI 内，
四周有余量。因而本次有 padding 的 ROI 不是被截断的输入。

Google 的输入指引建议字符至少约 16×16 像素，并说明超过约 24×24 通常没有
额外准确率收益；这解释了为什么需要比较尺寸，而不能默认放大就会更可靠。
本原图前景字高约 52 像素，24/36/48 控制的结果也确实不单调。
参考：[ML Kit Android text recognition 官方文档](https://developers.google.com/ml-kit/vision/text-recognition/v2/android)。

## 冷进程、初始化及证据层次

两次独立安装后第一个 Chinese 诊断读取（含 SDK 等待和语义记录）分别为
**179 ms / 181 ms**，均有非空文本，
且均读成 `SYNTH-P06-J01NT-123456`。第二次 warm source 控制为 94 ms，
仍是相同错误。所有新几何及 Latin 读取均完成；产品 **10,000 ms** deadline
保持原值，未用延长超时掩盖失败。

此处“冷”仅指新安装 QA 包的首个进程；后续只 force-stop QA 包后重启
instrumentation。没有重启手机、锁屏/熄屏、切换正式 App、撤销权限、打开支付页
或执行支付。API36 当前两个 QA 进程成功初始化的证据，不能关闭完整生命周期
或正式业务 W01–W10；原历史空结果/失败也未被改写成 PASS。

| 证据层 | 本次能够证明的内容 | 未被证明的内容 |
| --- | --- | --- |
| 原始文字 | O/0、I/1 混淆、删除/插入、遮挡截断真实存在 | 完整 reference 可靠识别 |
| 金额与币种字形 | 原图 raw lines 保留 CNY 90.00、100.00、10.00 | 仅凭这些字形选择最终金额或通过六币种业务门禁 |
| 状态 | Chinese 原图保留“付款成功”，单独分类为 COMPLETED | 来源账号的正式清算证明 |
| 语义 | 诊断分别保存原始行与语义返回；不能把 null 自动补成金额/方向 | Latin 丢失中文角色/状态后仍可安全替换整页解析 |
| OS 来源 / profile | 只知道 QA 进程读取合成 PNG | 微信、支付宝、分身、工作资料或当前账户的权威归属 |
| 入账 | 探针不执行入账；原安全语料账目写入 0 | 真实结算、真实通知到端到端正式入账 |

## 根因等级与产品决定

- **CONFIRMED**：错误在 SDK 原始返回中已存在，早于 `normalizeOcrLines` 和身份关联。
  归档像素不损坏；本例有 padding 的 ROI 不裁断；灰度处理不增加信息；当前冷进程
  能及时得到非空结果。金额字符修复通过不能解决上述 reference 读取失败。
- **PROBABLE**：混合中文标签与拉丁字母数字、当前字体及脚本模型的识别混淆，是
  本例字符失败的主要因素。Latin 在相同像素恢复部分编号，但仍读错 O/0、I/1；
  这不是对模型内部机制的证明，也不是可泛化的可靠率保证。
- **RULED OUT（仅限本样本和本次运行）**：源 PNG 解码改变像素、有 padding 的
  ROI 丢失整行、需要下载模型才有文本、当前 10 秒超时导致这些字符错误。
- **未证实 / 仍开放**：历史首次空输出的具体原因、API36 其他生命周期路径、
  真正支付页字体/布局、来源 profile 与结算身份、长期稳定性。没有证据可归咎三星驱动。

可改进方向是标签/几何驱动的候选区域、受限脚本对照和保留多个原始候选，供后续
更多独立语料与人工核实评估。当前控制已经证明“选最大尺寸”“两模型一致即相信”
都不可靠，因此本次不把它们接入产品。遮挡丢失的字符只能补充原始来源证据，
不能从期望值、金额、时间或近似字符串补全编号。

当前安全降级仍是：reference 不完整或冲突时不自动关联既有交易，保留人工核实；
缺少独立来源与清算证明时不自动入账。**P05 reference 准确率门禁未关闭，阻止
相应自动化路径和正式 Stable 发布**。本报告不重新统计原607、冻结608或JVM833。

## 执行与证据索引

原始证据均位于忽略目录 `docs/migration-evidence/aeris-p0-ocr/`，没有提交 APK、
运行日志或手机数据。`evaluation-r1/result.json` 含此次拉回文件的逐项 SHA-256。

| 证据 | 结果 / 用途 |
| --- | --- |
| `inherited-source-protection/manifest.json` | 接手的 QA 未提交文件原字节备份索引 |
| `build-r4/result.json` | 接手诊断 APK 的既有 PASS，实际执行前核对源与 APK hash |
| `samsung-r1/result.json` | 01:56:05–01:57:02 UTC；原方法 + 冷/几何；卸载与状态读回 |
| `build-r5/result.json` | 追加设备驱动审计后的本地构建 PASS；APK 与 r4 字节相同 |
| `samsung-r2/result.json` | 01:59:24–02:00:30 UTC；原方法 + 冷/几何 + Latin 六/八同像素 |
| `samsung-r2/original-six/views.json` | 原六视图 raw lines，0/6 精确 |
| `samsung-r2/corpus/results.json` | 原完整八样本，8 安全 PASS、2 精确 |
| `samsung-r2/latin-corpus/results.json` | 新 Latin 14 次读取，逐张原 PNG hash |
| `samsung-r2/geometry/results.json` | 新几何 20 次读取，置信度、边界、颜色、方向、耗时 |
| `samsung-r2/cold-direct/results.json` | 首次进程 SDK 读取，181 ms，非空但 reference 错误 |
| `evaluation-r1/result.json` | 离线 source/APK manifest、图像 hash 和全量统计验证 |
| `repeat-comparison.json` | 25 个 PNG 重复字节一致、原始六/八文本相同 |
| `pixel-audit-r2/result.json` | 规范 RGBA 像素一致、整行未裁断、灰度无新信息 |

诊断 app APK SHA-256：
`0722304618d238c9ce5a70e7a3cb0f678a991978e30e2f0a7c003c7457f87535`。
instrumentation APK SHA-256：
`063eba7ba14f4ed966f99b8d9c975e6552f8c09e23713b1f0156005fb0ff5063`。
本次证据没有替换任何历史失败文件。

复验使用新 label，禁止覆盖已有目录；先取得该设备独占使用权并核对冻结输入。
构建脚本会记录当前源 hash；后续设备驱动在不匹配时拒绝安装。

```powershell
python qa/p0-ocr/build.py --label build-r6
python qa/p0-ocr/device.py --serial $ocrSerial --build build-r6 --label samsung-r3 --latin-corpus
python qa/p0-ocr/evaluate.py --input samsung-r3 --label evaluation-r2
pwsh -NoProfile -File qa/p0-ocr/pixel-audit.ps1 -InputRun samsung-r3 -Label pixel-audit-r3
```

`$ocrSerial` 是当轮所有者指定且在线的设备序列，不从任意首个 ADB 设备推断。
本次使用独立 ADB server 5057 和 user0。设备脚本只允许唯一 QA 包及 test 包，
先拒绝既有安装/其他 profile 已有包，再安装；拉取只允许 QA sandbox 中列明的
合成证据目录，校验 tar 路径，不抓取全局日志或私有页面。

两次执行均 **0 Activity、0 截图、0 私有页面读取、0 权限变更、0 正式入账**。
安装、QA force-stop 后的重启、Latin 对照与卸载有 8 秒间隔。两 QA 包均成功卸载；
最后 `pm path --user 0` 读回为空。正式 App 仍为 **1.3.37 / code50**，前后
无障碍与通知监听配置 raw bytes 的 SHA-256 分别为
`8c8fbbb234adb645f5c8512f751df08a40dd4df96c2e0e06f27b4b6b6f6dd052`、
`fffe0173a8ec1f62bee14999da5db21e2d4c8587ad88a611bb5e6939b800cf06`。
未对正式包执行安装、卸载、clear、force-stop、run-as 或权限命令。
这里的“状态不变”限定为版本及两项配置读回；未读取正式 Cookie、Room 或账号内容。

本地检查：诊断 Debug + AndroidTest 构建 PASS；r2 三个 instrumentation 方法完成，
离线程序另行确认 1 冷读取、20 几何读取、14 Latin 读取均为 EXECUTED，原六/八
逐项统计如上。四个 Python 工具语法检查 PASS；像素证明 PASS；
`scripts/repository_audit.py` 对 1,472 个 tracked/candidate 文件检查 PASS；
`scripts/check_android_release_consistency.py` 36 项 PASS；`git diff --check` PASS。
这些本地检查不等于 GitHub exact-head CI、Hosted Preview 或 Production 验收。

后续交接：保留本树与忽略证据，P05 状态仍部分完成/暂缓发布。若继续优化，应
扩大独立且可追溯的合成/真实授权语料，分别测完整 reference、字段语义、来源
与结算身份；不能选择当前图片的最佳变换来宣布总体通过。真实通知/支付和完整
生命周期验收仍由对应独立专项处理，禁止用本 SDK 结果代替。
