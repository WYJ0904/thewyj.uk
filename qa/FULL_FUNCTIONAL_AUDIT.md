# 全站完整功能审计矩阵

本文件描述用户可见功能的验收边界。机器可读的唯一清单位于
[`functional-audit.json`](./functional-audit.json)，CI 通过
[`scripts/functional_audit_gate.py`](../scripts/functional_audit_gate.py) 将它与源码目录和真实浏览器测试互相核对。

## 通过标准

- 页面渲染、按钮可点击、接口返回 200 或文件非空都不单独算通过。
- 文本结果必须与预期语义一致，并覆盖中文、日文、英文、Unicode、空输入和特殊字符。
- 下载文件必须由独立解析器重新打开；JSON/CSV 比较数据结构，ZIP 比较条目与 SHA-256，PDF 比较页数和嵌入图像，图片比较格式、尺寸和关键像素。
- 二维码必须从最终图片重新解码；联系人二维码还要交给独立 vCard 解析器验证字段。
- 临时文件必须完成“浏览器上传 -> 服务端保存 -> 公开分享页下载 -> SHA-256 一致”。
- 权限功能必须同时验证允许和拒绝路径，不能以隐藏前端控件代替服务端权限。
- 手机验收使用 390px 主视口，并补充桌面 1366px 与 1920px；运行时异常和意外网络错误均使测试失败。

## 路由与访问控制

| 范围 | 路由 | 访问规则 | 主要验收 |
| --- | --- | --- | --- |
| 公开 | `/`, `/login`, `/register`, `/trial`, `/changelog` | 无需登录；试用有明确限制 | 导航、登录注册、更新提示、五种本地试用、刷新恢复 |
| 个人 | `/select`, `/account`, `/recharge` | 登录用户 | 控制台摘要、账户改密、七种套餐、微信/支付宝订单恢复 |
| 学习 | `/language`, `/language/english`, `/language/japanese` | 登录用户与对应权益 | 词表、测试、判卷、跳过、错题、重新判定、历史、PDF、统计、成就、同步 |
| 工具 | `/tools`, `/tools/:tool_id`, `/tools/workflows` | 服务端 `tools_access` | 搜索、分类、收藏、最近、固定、配置、103 个工具及可配置工作流 |
| 财务 | `/finance` | 服务端 `finance_access` | 本地优先账目 CRUD、收入/支出/退款、筛选、分类、预算、撤销、同步、冲突与移动端 |
| 管理 | `/admin` | 服务端管理员校验 | 用户、会员、订单、登录记录、反馈、投票、审计日志 |
| 分享 | `/share/text/:id`, `/share/file/:id`, `/share/clipboard/:code`, `/share/qr/:id`, `/share/room/:id` | 不可预测令牌或连接码 | 密码、次数、销毁、过期、下载、房间同步 |

## 账户、会员与后台

| 功能组 | 独立验收项 |
| --- | --- |
| 账户 | 注册、登录、退出、会话恢复、自助改密、自助注销、封禁后令牌失效 |
| 套餐 | 单语言包月体验、财务会员、双语言包月、工具箱包月、全功能包月、双语言双项永久、全功能永久 |
| 支付 | 用途筛选、套餐选择、微信、支付宝、创建订单、二维码、我已付款、刷新恢复、取消、管理员审批/拒绝、唯一履约 |
| 权益 | 英语、日语、全部语言、工具、批量、临时分享、配置保存、财务、权益合并、到期降级 |
| 管理员 | 搜索用户、会员开通/续期/取消、权限覆盖、封禁/解封、强制退出、重置密钥、充值审批、反馈状态/备注/合并/删除、审计 |
| 反馈 | 六种反馈、仅看本人、状态筛选、功能建议一人一票与撤票、版本/路由/工具/错误码元数据脱敏 |

## 语言学习

| 范围 | 独立验收项 |
| --- | --- |
| 词表 | 手输、TXT 导入、导出、打乱、清空、AI 分级搜索、替换/追加、语言隔离 |
| 答题 | 英语/日语、释义/听写、普通/严格/宽松/AI、空答案、提交、跳过、下一题、取消判卷、发音 |
| 日语 | 汉字自动标音、纯假名直接出题、汉字和假名共同显示、两种答案形式 |
| 错题 | 本轮、历史、搜索、移除、重新判定、跳过题重新判定、复习、JSON 导入导出、PDF |
| 状态 | A-H 切页/刷新状态机、题目只推进一次、反馈计时一致、未答题不污染统计 |
| 记录 | 测试历史、统计、每日目标、连续天数、成就只增、离线本地数据、跨设备增量同步与 JSON 备份 |

## 工具目录

下列每个 ID 都必须在真实浏览器中至少完成一次，并由覆盖门禁保证与源码 103 项目录完全一致。

### 文本处理（29）

`text-stats`, `dedupe-lines`, `remove-empty-lines`, `collapse-spaces`, `letter-case`, `camel-case`, `pascal-case`, `snake-case`, `kebab-case`, `line-prefix`, `line-suffix`, `line-numbers`, `find-replace`, `regex-replace`, `sort-lines`, `shuffle-lines`, `text-diff`, `extract-email`, `extract-url`, `extract-ip`, `extract-number-date`, `base64`, `url-code`, `html-entities`, `unicode-code`, `json-format`, `json-minify`, `json-validate`, `chinese-convert`。

模式：大小写 3 种、正则标志 3 种、排序 2 种、Base64/URL/HTML/Unicode 双向、简繁双向。

### 文件处理（17）

`file-md5`, `file-sha1`, `file-sha256`, `file-sha512`, `file-info`, `csv-json`, `json-csv`, `text-encoding`, `text-split`, `csv-split`, `txt-merge`, `csv-merge`, `json-array-merge`, `images-pdf`, `rename-preview`, `files-zip`, `batch-zip`。

模式：UTF-8、GBK、Big5、Shift-JIS；单文件/多文件；拆分、合并、PDF、ZIP。下载后必须独立解析。

### 图片与设计（30）

`image-compress`, `image-batch-compress`, `image-format`, `image-resize`, `image-scale`, `image-crop`, `crop-square`, `crop-four-three`, `crop-sixteen-nine`, `image-rotate`, `image-flip`, `image-rounded`, `image-avatar`, `text-watermark`, `image-watermark`, `tile-watermark`, `image-mosaic`, `image-blur`, `image-redact`, `image-pdf`, `exif-view`, `exif-remove`, `gps-warning`, `color-extract`, `color-convert`, `gradient-generator`, `gradient-css`, `solid-image`, `favicon-generator`, `multi-icon-zip`。

模式：JPG/PNG/WebP、90/180/270 度、水平/垂直/双向翻转、固定裁剪比例、区域处理、元数据、颜色与多尺寸图标。

### 随机生成（22）

`random-integer`, `random-decimal`, `random-string`, `random-password`, `random-uuid`, `random-draw`, `random-groups`, `random-wheel`, `weighted-wheel`, `random-date`, `random-time`, `random-color`, `random-palette`, `coin-flip`, `dice-d4`, `dice-d6`, `dice-d8`, `dice-d10`, `dice-d12`, `dice-d20`, `custom-dice`, `random-decision`。

范围、格式、密码字符集覆盖、UUID v4 位、分组不丢项、权重边界和各骰子上下界都需验证。

### 临时工具（5）

`temporary-text`, `temporary-file`, `temporary-clipboard`, `temporary-qr`, `temporary-room`。

二维码拆分为文本、URL、Wi-Fi（WPA/WEP/无密码、可见/隐藏网络）、联系人、动态链接；临时内容分别验证无密码/有密码、保留/读取后销毁、次数限制、过期和公开分享页。留言房间验证创建、打开、发送、轮询去重、密码、上限和清空。

## 工具工作流

- 显式能力目录：`text-encoding`、`remove-empty-lines`、`dedupe-lines`、`sort-lines`、`csv-json`、`json-csv`、`text-split`、`image-resize`、`image-format`、`text-watermark`、`exif-remove`、`files-zip`。
- 模板：`image-publish`、`image-batch`、`text-clean`、`csv-roundtrip`。
- 编辑器：新建、命名、添加、复制、删除、启用/停用、按钮排序、拖拽排序、复制工作流、导入/导出 JSON、本地与云端保存。
- 运行器：单一运行锁、等待/运行/成功/跳过/失败/取消状态、每步耗时、最终产物、`AbortController` 取消、批量逐项失败隔离。
- 权限：运行检查 `tools_access`，批量检查 `tools_batch_access`，云端保存检查 `save_tool_config`；离线仅接受同账号 24 小时内的有效工具权益缓存。
- 限制：Schema v1、48 KB JSON、20 步、50 个本地/云端工作流、50 个文件、20 张批量图片、50 MB 总输入；未知字段、重复 ID、类型断链和伪造权益一律拒绝。
- 真实产物：文本与 CSV 必须逐值一致；WebP 必须重开验证尺寸、格式、水印像素和无 EXIF；批量 ZIP 必须重开验证成员数、唯一文件名和每张图片。

## 自动覆盖门禁

1. `functional-audit.json` 的路由必须与 `app.js` 的源路由清单双向完全一致，工具 ID 必须与 `tools.js` 完全相同。
2. 22 条应用浏览器流程名称必须与 `test_app_browser.mjs` 完全相同。
3. 工具内部所有选项必须在 `test_tools_browser.mjs` 运行时登记并与清单完全相同。
4. 核心路由、七种套餐、两种支付、反馈类型/状态和学习模式必须仍存在于源码。
5. 12 个工作流能力、4 个模板、7 种类型和 27 个工作流浏览器行为必须与 `workflows.js` 及真实浏览器标记一致。
6. 任一路由、目录项、模式或工作流能力新增却未补 QA 清单和测试时，CI 失败。

## 人工视觉检查

- 公开首页、登录、控制台、充值、答题、错题、工具箱、管理员和反馈页面。
- 390x844、1366x768、1920x1080；无横向溢出、控件可触摸、Modal 可关闭、焦点清晰。
- 白底正文、次要文字、placeholder、disabled 按钮和状态标签达到可读对比度。
- 真实截图保存在忽略目录 `.tool-e2e/`，CI 失败时上传为 artifact，不提交到仓库。
