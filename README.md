# WYJ的网站

[![Core CI](https://github.com/WYJ0904/thewyj.uk/actions/workflows/ci.yml/badge.svg)](https://github.com/WYJ0904/thewyj.uk/actions/workflows/ci.yml)

这是部署在 Cloudflare Pages 上的语言测试与在线工具箱。前端是纯 HTML/CSS/JavaScript；正式 API 由 Pages Functions 提供，结构化数据存于 D1，私有二进制存于 R2，短文本 AI fallback 使用 Workers AI，PDF 在浏览器本地生成。Production 不依赖用户电脑、Python、SQLite、Ollama、Cloudflare Tunnel 或 `LOCAL_API_BASE`。

正式网站：<https://thewyj.uk>

## 技术栈与部署结构

- 前端：`index.html`、`styles.css`、`product-ui.css`、原生 ES Module 入口 `app.js`、`tools.js` 与 `js/` 领域模块
- PWA：`manifest.webmanifest`、`sw.js`
- Pages Functions：`functions/api/[[path]].js`，在同源 `/api/*` 下直接路由 Task 11～15 Cloudflare 服务，不代理本机
- 后端：Cloudflare Pages Functions；账户、学习、会员、支付、临时分享、工具偏好与 AI 业务均在 Cloudflare 运行
- 数据库与对象存储：D1 是正式结构化数据源，R2 保存私有付款二维码和临时分享文件
- AI：Workers AI binding `AI`，先走本地规则、内置词典和 D1 cache，仅在必要时调用集中配置的模型
- PDF：错题 PDF、多图 PDF 与图片 PDF 均在浏览器本地生成，不上传用户内容
- 公网链路：浏览器 -> `thewyj.uk` 同源 Pages / Pages Functions -> D1、R2 或 Workers AI
- 构建系统：无；不需要 npm、Vite、React、Vue 或 `node_modules`

网站根目录保留 `index.html`，Cloudflare Pages 可直接发布仓库根目录。

### 前端模块边界

`app.js` 和 `tools.js` 是浏览器 bootstrap / compatibility entry：前者组装登录、路由和学习工作区，后者组装工具页面并继续公开既有的 `window.WYJTools`；`workflows.js` 继续公开既有的 `window.WYJWorkflows`。它们由 `index.html` 以原生 `<script type="module">` 加载，不需要打包器。

```text
js/
  core/        API、配置、路由、会话、存储和通用 UI
  language/    判题模型、错题、成就、历史与学习同步适配
  membership/  套餐筛选、充值状态和账户权益摘要
  admin/       管理后台纯格式化
  tools/       103 项目录、runner、文本/文件/图片/随机/临时工具纯函数
```

依赖方向为 `core -> domain modules -> bootstrap/compatibility entry`。`core` 不依赖任何领域目录，领域模块只能依赖 `core` 或本领域模块；`scripts/check_js_module_graph.mjs` 在本地和 CI 中检查缺失模块、跨领域反向依赖和循环依赖。Service Worker 显式缓存所有模块，离线 shell 仍由 `sw.js` 提供。

### 浏览器存储兼容

本次模块化不改任何既有 `localStorage` / `sessionStorage` 键名、版本或数据结构。`qa/frontend-storage-contract.json` 记录账号会话、词表草稿、测试运行态、错题、成就、历史、每日目标、语言设置、日语读音缓存、工具偏好/工作流、更新日志和学习同步等稳定键族；`scripts/check_storage_contract.mjs` 会在 CI 中阻止无意改名。正在进行中的具体题目仍只保存在 `sessionStorage`，学习同步不会上传整份 `localStorage`。

## 页面流程与路由

```text
打开或刷新
-> 短暂品牌加载提示
-> 未登录在 / 查看公开首页，可进入 /trial 或 /changelog
-> 登录或注册后进入 /select
-> 在个人首页查看学习、会员和服务摘要
-> 进入英语、日语或在线工具箱
```

主要路由：

- `/`：公开首页；已登录账户访问时继续进入个人首页
- `/login`、`/register`：登录与注册
- `/trial`：无需登录的有限免费试用
- `/changelog`：公开更新日志
- `/select`：登录后的个人首页，汇总会员权益、学习进度、错题、未完成测试、常用工具和服务状态
- `/language`：语言项目选择
- `/language/english`、`/language/japanese`：固定语言测试
- `/tools`、`/tools/<tool-id>`：会员工具箱
- `/tools/workflows`：可配置的本地优先工具工作流
- `/account`、`/recharge`：账户与充值
- `/admin`：超级管理员后台
- `/share/<type>/<id>`：临时分享读取页

未登录访问 `/language`、`/tools`、`/account`、`/recharge` 或 `/admin` 等受保护路由会回到 `/login`。没有 `tools_access` 的用户访问 `/tools` 会回到 `/select` 并打开充值窗口。工具页每次进入都会调用服务端 `/api/tools/access`，工具偏好、临时分享和管理员 API 也独立验证服务端会话与权益。账户 API 暂时不可用时，个人首页继续展示当前账户的本地学习摘要；拥有最近一次已验证工具权益的用户仍可进入纯浏览器本地工具，服务端临时分享和同步功能会明确显示离线状态。

### 公开首页与免费试用

公开首页介绍语言学习、五类在线工具、隐私原则、账户套餐入口和近期更新，不加载第三方追踪脚本。`/trial` 只开放以下明确功能：

- 内置演示词表的英语或日语小测，单次最多 10 题；
- 文本字符、单词、行、段落和阅读时间统计；
- JSON 格式化与合法性检查；
- 单张图片压缩；
- 单张 PNG、JPG 或 WebP 格式转换。

试用文本和图片只在当前浏览器中处理；图片上限为 12 MB、2,000 万像素，文本和 JSON 上限为 200,000 字符。匿名成绩只保留在当前页面内存，刷新即清除，不写入服务器学习记录。匿名用户不能使用批量处理、保存工具配置、临时分享、正式会员或管理员功能；相应 API 即使被直接调用也要求有效服务端会话和权益。试用完成后只显示一次页面内注册提示，不使用弹窗反复打扰。

日语释义测试允许词表只输入汉字或只输入假名。纯假名会直接出题；含汉字的词会在开考前由内置词典、D1 cache 及必要时 Workers AI 补全读音，并在题目汉字下方显示假名，例如“電話 / でんわ”。听写模式继续隐藏词形与读音，避免直接泄露答案。

单词搜索和阶段推荐优先使用按语言与等级建立的内存索引，顺序为精确匹配、前缀匹配、标准化词形、同等级模糊匹配和相邻等级补充。本地结果足够时不会调用 Workers AI；只有不足时才使用受等级校验、配额和超时保护的 AI 补充。索引统一处理 NFKC、大小写、全角半角和片假名/平假名，结果使用有界缓存。前端输入采用 200 ms 防抖并通过 `AbortController` 取消旧请求。

## 会员方案

Production 的价格、权益与在售状态以 D1 的 `task13_membership_plans` 和 `task13_membership_entitlements` 为唯一运行时配置；订单创建时由服务端锁定方案快照。`local-backend/membership.py` 仅保留给旧 SQLite 迁移、隔离测试和历史兼容校验，不参与线上请求。

| 方案代码 | 价格 | 权益 |
| --- | ---: | --- |
| `trial_single_language` | 8 CNY/月 | 英语或日语任选一种，所选语言会员功能一个月，不包含工具箱 |
| `finance_monthly` | 8 CNY/月 | Web 与 Android 共用财务账本，不包含语言测试或工具箱 |
| `dual_language_monthly` | 20 CNY/月 | “双语言包月”：英语和日语全部测试会员功能，不包含工具箱 |
| `tools_monthly` | 20 CNY/月 | 在线工具箱、批量处理、临时分享和配置保存，不包含语言测试会员功能 |
| `all_access_monthly` | 30 CNY/月 | 全部语言会员功能、工具箱、批量处理、临时分享、配置保存 |
| `japanese_lifetime` | 70 CNY | “双语言双项永久会员”：英语和日语测试会员功能永久有效，不包含工具箱 |
| `all_access_lifetime` | 100 CNY | 全功能永久有效 |

充值窗口先让用户选择用途，再只展示适合该用途的在售方案：

| 用途 | 展示的方案 |
| --- | --- |
| 只学英语 | 单语言包月、双语言包月、全功能包月、双语言双项永久、全功能永久 |
| 只学日语 | 单语言包月、双语言包月、全功能包月、双语言双项永久、全功能永久 |
| 英语和日语 | 双语言包月、全功能包月、双语言双项永久、全功能永久 |
| 只用工具箱 | 工具箱包月、全功能包月、全功能永久 |
| 只用财务 | 财务会员、全功能包月、全功能永久 |
| 语言、工具和财务 | 全功能包月、全功能永久 |

用途筛选只用于减少误选，不参与价格或权限判定。七个在售方案的订单金额、权益、支付方式和二维码资源都由服务端根据方案代码锁定；Task 17 只新增 `finance_monthly`，既有六个方案代码、价格和语义保持不变。单语言用途会同时锁定英语或日语选择；旧的未完成订单打开时按订单快照恢复套餐和支付方式，并显示与该订单兼容的用途。

权益代码：

- `language_english_access`
- `language_japanese_access`
- `language_all_access`
- `tools_access`
- `tools_batch_access`
- `temporary_share_access`
- `finance_access`
- `save_tool_config`
- `all_features_access`

权限按有效会员记录合并，不使用单一 `isVip`。全功能永久和全功能包月覆盖全部模块；20 CNY 双语言包月与 20 CNY 工具箱包月互不越权；70 CNY 双语言双项永久包含英语和日语测试，但不包含工具箱；单语言体验和其他有效会员可以叠加。包月会员到期后立即失去对应权益，但同时存在的其他会员权益仍会保留。超级管理员拥有全部权益。

桌面启动器不参与正式网站运行。它只保留给历史后端隔离测试和人工回滚演练，始终手动启动且不创建开机自启动项；关闭电脑不会影响 Production。

### 老会员兼容

原有数据不会被覆盖：

- 旧 `trial_single_language` 保持原语言和剩余时间；新订单按 8 CNY/月销售，旧待处理订单仍保留原 5 CNY 金额
- 旧 `monthly` 迁移为 `legacy_all_monthly`，保持原双语言包月权限，不新增工具权限
- 旧 `lifetime` 迁移为 `legacy_all_lifetime`，保持原双语言永久权限，不新增工具权限
- `japanese_lifetime` 是当前在售的 70 CNY 双语言双项永久方案，内部代码保持稳定；现有记录自动获得英语和日语权益，但不会获得工具权限
- 已存在的 `dual_language_lifetime` 记录继续保持同等双语言永久权益，但该代码只用于数据库兼容且不再新售、不在界面重复显示
- 旧待处理充值按原价格和原权益迁移，不会被静默改成新方案

旧兼容方案不可由新用户购买。新 70 CNY 订单只能使用 `japanese_lifetime`；旧缓存页面提交已退役的 `dual_language_lifetime` 时，服务端会明确提示刷新并重新选择方案，提交 `monthly` 或 `lifetime` 等未知代码也会被拒绝，避免价格或权益误开。

## 充值与管理员

支付方式仅支持微信支付和支付宝。流程为“选择用途 → 选择套餐 → 选择支付方式 → 确认订单 → 后端锁定订单快照 → 加载该订单的私有二维码 → 用户声明已付款 → 管理员人工核对”。确认订单前不显示二维码；用户点击“我已付款”只会把状态从 `pending_payment` 改为 `user_paid`，不会自动开通会员。页面明确说明管理员会在 24 小时内核对，到账确认后权益才生效。

订单由服务端锁定用户、套餐名称快照、金额、币种、支付方式、二维码资源、单语言选择、订单编号和付款备注。客户端提交的金额、币种、期限、权益、用户或文件路径都会被忽略。更换支付方式必须先取消仍处于 `pending_payment` 的原订单，再创建新订单。

支付状态统一为：

```text
pending_payment -> user_paid -> processing -> approved
                                      \----> rejected
pending_payment -> cancelled
pending_payment -> expired
```

管理员只能处理 `user_paid`。批准在一个 `BEGIN IMMEDIATE` 事务内完成状态更新、会员发放/续期、唯一履约、状态历史和审计；失败会整体回滚，并发批准只能成功一次。包月续费从“当前时间”和“同套餐现有到期时间”中较晚者开始增加一个日历月，不会覆盖剩余时间；重复购买永久方案复用已有永久会员记录。

### 私有收款二维码

裁剪后的收款图片只保留二维码、金额和套餐名称，并在使用前验证扫码内容与处理前一致。图片必须去除头像、姓名、账号、状态栏及元数据，且不得进入 Git、公开静态目录、README、日志、数据库或源码 Base64。

Production 的 12 张已清理 PNG 存在私有 R2 bucket，通过固定的服务端映射关联支付方式和方案代码；R2 object key 不返回客户端，也不使用公开 object URL。仓库外的历史本机目录 `data/payment/qrcodes/` 只用于迁移备份和隔离回归，继续由 `.gitignore` 排除。

浏览器只能通过 `GET /api/recharge/qr?request_id=<订单ID>` 获取二维码。接口检查会话、订单归属、状态、支付方式、套餐与固定资源映射、解析后的根目录、文件大小和 PNG 签名，并返回 `Cache-Control: private, no-store`。前端携带 `X-Session-Token` 获取 Blob，关闭窗口、切换订单、退出或会话失效时撤销 Object URL。

管理员后台支持：

- 查看用户、有效会员、合并权益、开通与到期时间
- 查看、批准或拒绝充值申请
- 开通、续期或取消指定会员
- 降级普通用户并按需保留双语言双项永久会员
- 单独关闭或恢复工具权益
- 为任意普通用户手动设置或安全生成新密钥，可显隐、复制并在成功后仅本次查看；重置会立即退出该用户全部会话
- 查看管理员审计日志、登录记录与工具使用统计

所有管理员接口都在服务端验证固定超级管理员身份。登录密钥采用不可逆哈希，管理员也不能读取；新密钥只在重置成功后的当前编辑窗口显示，关闭后即从页面清除，接口、数据库导出和审计日志均不保存明文。用户可在账户窗口验证旧密钥后自行修改并确认新密钥。登录记录保存成功或失败、时间、IP、Cloudflare 提供的国家/地区/城市网络估计和浏览器标识，不保存密钥，也不读取设备 GPS；记录保留 90 天且最多 5,000 条。会员、充值、封禁和账户操作记录管理员、对象、修改前后状态、时间与备注。封禁、改密、强制退出和删除会递增会话版本或清除会话，旧令牌不能继续使用。

## 在线工具箱

工具箱共 103 项，目录和纯处理逻辑位于 `js/tools/`，页面编排和兼容入口保留在 `tools.js`。每项工具都有简短用途说明；搜索会同时匹配名称、说明、分类、别名和工具 ID，并支持部分关键词、顺序字符和少量拼写偏差。原始文本、图片和普通文件默认只在浏览器本地处理，不上传服务器；服务端默认只保存工具 ID、使用时间、收藏和用户主动保存的配置。

### 工具工作流

`/tools/workflows` 可以把兼容工具按顺序组合成可重复运行的本地流程。当前显式注册 12 个能力：文本编码读取、删除空行、去重、排序、CSV/JSON 互转、文本分割、图片缩放、图片格式转换、文字水印、EXIF 清除和 ZIP 打包。内置“图片发布处理”“图片批量发布”“文本清理排序”“CSV 规范转换”四个模板，也可以新建、添加、拖拽/按钮排序、复制、启用/停用和删除步骤。

工作流 JSON 使用 `schema_version: 1`、稳定工作流/步骤 ID、显式参数白名单和 `text-file`、`text`、`json`、`image`、`image-list`、`file-list`、`archive` 类型链；不执行表达式、脚本或动态代码。导入时检查未知字段、版本、重复 ID、步骤数量、参数范围、类型兼容和 48 KB 大小限制，权限不会写入或信任导入文件。单次仍沿用最多 50 个文件、50 MB，批量图片最多 20 张；批量项相互隔离，成功项仍可打包，失败项会单独显示。

运行要求服务端最近确认的 `tools_access`，批量运行另需 `tools_batch_access`，云端配置另需 `save_tool_config`；前端提示之外，云端保存接口也会重新验证会员权益和工作流 Schema。草稿先按账号保存在 `wyjToolWorkflows:v1:<accountId>`；有保存权益时复用 `/api/tools/config/save`，以虚拟工具 ID `workflow` 单独存放。网络断开时只有同一账号在 24 小时内成功验证过工具权限，才允许继续执行纯本地步骤；原始文件和中间结果不会上传。

### 文本处理（29）

统计、去重行、去空行、合并空格、大小写、camelCase、PascalCase、snake_case、kebab-case、前后缀、行号、查找替换、正则替换、排序、随机排序、差异对比、邮箱/URL/IP/数字日期提取、Base64、URL 编码、HTML 实体、Unicode、JSON 格式化/压缩/校验、基于本地 OpenCC 字符词典的简繁转换。

### 文件处理（17）

MD5、SHA-1、SHA-256、SHA-512、文件信息、CSV/JSON 互转、文本编码转换、TXT/CSV 分割、TXT/CSV/JSON 合并、多图转 PDF、重命名预览、ZIP 打包、批量 ZIP 下载。CSV 解析支持引号、逗号和字段内换行；合并时会检查表头与列数；转换、拆分和合并均可选择 UTF-8、GBK、Big5 或 Shift-JIS 源编码。

本地文件最多选择 50 个、总计 50 MB，避免浏览器内存失控。

### 图片与设计（30）

单张/批量压缩、PNG/JPG/WebP 转换、尺寸与百分比缩放、自由裁剪、1:1/4:3/16:9 裁剪、旋转、水平/垂直翻转、圆角、圆形头像、文字/图片/平铺水印、马赛克、模糊、黑色遮挡、转 PDF、EXIF 查看与删除、GPS 提醒、颜色提取与 HEX/RGB/HSL 转换、渐变、纯色图、Favicon、多尺寸图标 ZIP。JPEG 清除元数据时直接移除 EXIF/XMP 区块，不重新压缩像素。

### 随机生成器（22）

整数、小数、字符串、安全密码、UUID v4、抽签、分组、普通/带权转盘、日期、时间、颜色、调色板、硬币、D4/D6/D8/D10/D12/D20、自定义骰子、随机决定。随机和密码使用浏览器加密随机数。

### 临时工具（5）

- 临时文本：过期时间、访问次数、阅后即焚、密码、TXT 下载
- 临时文件：过期时间、下载次数、下载后销毁、密码和类型/大小验证
- 临时剪贴板：六位连接码、默认 10 分钟、可读取后销毁
- 临时二维码：文本、URL、可直接填写的 Wi-Fi、vCard 联系人和动态失效链接
- 临时留言房间：密码、最大消息数、自动过期、创建者清空、不公开列出，并以 4 秒轮询和指数退避在多设备间自动同步

Task 14 在 Preview 与 Production 均使用 D1 保存 metadata、私有 R2 保存原始字节。普通文件最大 20 MiB，允许 TXT、CSV、JSON、PDF、PNG、JPG/JPEG、WebP、GIF 和 ZIP；MP4、M4V、MOV、WebM 视频最大 30 MiB。云路径会同时校验安全文件名、扩展名、MIME 和基础文件签名，上传使用原始请求体，下载使用 R2 字节流及受控 Range，不再把完整文件 Base64 编码进 JSON。

Task 14 的下载次数在服务端签发授权时原子消费。一个 15 分钟授权可以用于同一次下载的 Range 和重试，不会重复计数；网络中断会消耗该次授权，但可用原授权续传。`destroy_after_download` 只在完整非 Range 响应结束后进入删除流程，活动授权会保护待删除对象，避免清理任务抢先删除重试所需文件。

## 更新日志、反馈与功能投票

`/changelog` 继续使用原有公开路由，内容来自根目录的 `changelog.js`。每条记录包含 `version`、`build`、`date`、`features`、`improvements`、`fixes` 和 `security`；个人首页只显示最新摘要。浏览器使用 `wyjChangelogSeenVersion:v1` 记录用户已经关闭的最新版本提示，新版本只在当前浏览器第一次打开时提示一次。

登录用户可以通过账户菜单提交功能建议、工具报错、页面问题、账户问题、新工具建议或其他反馈，并查看自己的反馈。以下接口均要求有效会话：

- `POST /api/feedback`：提交反馈；10 分钟内每个账户和客户端最多 5 次
- `GET /api/feedback/mine`：只返回当前用户自己的反馈
- `GET /api/feedback/voting`：只公开管理员已采纳或已完成的建议标题、状态和票数，不公开提交者与正文
- `POST /api/feedback/vote`：同一用户对同一建议最多一票，可取消；每分钟最多 30 次操作
- `GET /api/admin/feedback`：管理员搜索并按类型、状态筛选
- `POST /api/admin/feedback/update`：管理员更新状态/备注、合并重复建议或删除垃圾反馈

普通用户不能读取其他用户的反馈，管理员接口还会执行服务端超级管理员校验。所有 SQL 值均使用参数绑定；提交字段使用白名单和长度限制，并拒绝会话令牌、密码、私钥、支付卡号和本机路径等明显敏感内容。可选浏览器信息最长 240 字符且默认不勾选；系统不会自动附带工具中的原始文本、图片、文件、完整调用栈或支付信息。管理员的更新、合并和删除操作会写入既有 `admin_audit_logs`，审计快照不保存反馈正文。

## 数据库与迁移

Production 结构化数据只存于 Cloudflare D1，文件只存于私有 R2。账户密码在 D1 中使用带随机盐和服务端 pepper 的版本化 PBKDF2-SHA256 摘要；Session 只保存 token SHA-256 digest、过期时间和会话版本。仓库外最后一份 SQLite 与 `users.txt` 只作为迁移前备份，不接受正式写入，也不能作为运行 fallback。

历史 SQLite 迁移文件仅用于验证旧备份和迁移工具：

- `local-backend/migrations/pre-001-schema.sql`：迁移前结构快照
- `local-backend/migrations/001_entitlements_up.sql`：新权益、充值、审计、工具与临时数据表
- `local-backend/migrations/001_entitlements_down.sql`：回滚新表
- `local-backend/migrations/002_single_language_orders_up.sql`：为支付订单保存英语/日语选择
- `local-backend/migrations/002_single_language_orders_down.sql`：无损重建支付表并回滚语言列
- `local-backend/migrations/003_login_audit_up.sql`：登录成功/失败和网络位置审计表
- `local-backend/migrations/003_login_audit_down.sql`：只回滚登录审计表
- `local-backend/migrations/004_payment_flow_up.sql`：支付方式、锁定快照、过期/处理状态、状态历史和唯一履约
- `local-backend/migrations/004_payment_flow_down.sql`：删除支付历史/履约表并无损重建旧版订单列；`processing` 回退为 `user_paid`，`cancelled`/`expired` 回退为 `rejected`
- `local-backend/migrations/005_payment_method_consistency_up.sql`：关闭升级前遗留的无支付方式开放订单，保留订单和状态事件并允许用户重新创建
- `local-backend/migrations/005_payment_method_consistency_down.sql`：在没有其他开放订单时恢复由 005 关闭的订单状态
- `local-backend/migrations/006_feedback_voting_up.sql`：新增用户反馈和一人一票的功能建议投票表
- `local-backend/migrations/006_feedback_voting_down.sql`：回滚反馈和投票表，不影响用户、会员、订单或学习数据
- `local-backend/migrations/007_learning_sync_up.sql`：新增按用户、数据类型和稳定 ID 保存的增量学习记录、版本头与变更流
- `local-backend/migrations/007_learning_sync_down.sql`：只回滚学习同步表，不删除浏览器本地数据或既有账户数据

历史迁移曾在仓库外通过 SQLite backup API 创建一次性备份：

```text
data\users.pre-entitlements-001.sqlite3
data\users.pre-single-language-002.sqlite3
data\users.pre-payment-004.sqlite3
data\users.pre-payment-method-005.sqlite3
data\users.pre-feedback-006.sqlite3
data\users.pre-learning-sync-007.sqlite3
```

D1 migration 位于 `cloudflare/migrations/`，由 `wyj_d1_migrations` 管理并按 `0001`～`0013` 前向执行。付款履约、投票、学习记录、临时下载授权、Task 15 import receipt 和财务同步操作均使用稳定主键或唯一约束防止重复。回滚不删除 D1 表或 R2 对象；先冻结相关写入、导出并核对云端增量，再执行前向修复或受控恢复。

## 浏览器本地数据

旧错题、成就和登录数据结构保持兼容。主要键包括：

- `wyjAccountSession`：当前登录令牌
- `vocabProfile:v2:<accountId>`：使用者
- `wrongBook:v2:<accountId>:<scope>:<profile>`：当前/历史错题
- `achievements:v2:<accountId>:<profile>`：成就
- `studyHistory:v1:<accountId>:<profile>`：学习记录
- `studyGoal:v1:<accountId>:<profile>:<language>`：每日目标
- `vocabRuntime:v1:<accountId>:<language>`：未完成测试，仅当前浏览器会话
- `wrongRejudgeLog:v1:<accountId>:<profile>`：错题重新判定审计记录，不重复累计统计
- `toolPreferences:v1:<accountId>`：最近一次已验证的工具权益、收藏和最近使用摘要
- `learningPreferences:v1:<accountId>:<language>`、`aiSuggestSettings:v2:<accountId>:<language>`：按账号和语言隔离的判卷、练习和选词设置；首次使用会兼容读取旧键
- `wyjLearningSync:v1:<accountId>`：仅包含允许同步的逐记录索引、tombstone、待上传标记和服务器版本，不包含会话或整个 `localStorage`

登录、退出和注册时会清理待测试词表，避免显示上一账户的单词；错题、成就、统计和设置不会因此被删除。

### 学习数据跨设备同步

登录后，错题、成就、测试历史（学习统计由此重算）、每日目标、英语/日语设置、判卷偏好和当前使用者配置会先写入浏览器，再通过 `POST /api/learning/sync` 按稳定 ID 增量同步。进行中的具体题目保存在 `sessionStorage` 的 `vocabRuntime:*`，默认不上传，也不会因为服务器离线而阻止测试。

同步状态会显示“已同步”“等待同步”“同步失败”或“已合并”。个人首页提供“立即同步”和账号绑定的 JSON 导入/导出；导入会检查格式版本、账号 ID、记录类型、数量、大小和重复 ID。错题冲突保留最大错误次数并合并释义，成就只增加，历史按 ID 去重，目标和设置取较新的记录。删除会上传 tombstone，未见过该删除版本的旧设备不能恢复记录。服务端每个账号维护独立同步版本，单次最多 200 项、拉取最多 500 项，且按数据类型设有总量限制。

当前错题和历史错题都支持“重新判定”。系统保留原题、原答案、题型、语言、判卷模式、评分依据和轮次 ID，并复用当前判卷接口；判对后从当前与历史错题中移除，并在能匹配原轮次时修正统计，判错只更新结果而不重复增加错题或错误次数。重复点击同一条记录会复用同一审计项。

## 安全措施

- 密码和分享密码均不明文保存
- 会话令牌使用加密安全随机数，数据库只保存 SHA-256 摘要；服务端每次解析时检查封禁、删除、过期和会话版本
- 登录、注册、临时创建和临时读取均有限流
- POST 校验同源 `Origin`；无 CORS 放行；前端会话通过自定义请求头发送
- SQL 全部使用参数绑定
- 分享 ID 使用不可预测随机数，六位连接码只保存 HMAC 摘要
- 用户文本通过 `textContent` 展示；动态 HTML 对用户输入做转义
- 上传文件限制大小、文件名、扩展名、MIME 和内容签名
- 静态目录与运行数据分离，路径解析后再次校验根目录
- 支付二维码不在静态目录，只有订单本人可通过会话保护接口读取；响应禁止缓存且不暴露文件路径
- 错误响应不返回调用栈或本机路径
- CSP、`nosniff`、禁止 iframe、严格 Referrer 和 Permissions Policy；本地图片处理仅额外允许同源生成的 `blob:` 图片
- Production 不包含代理到本机的路由；统一错误响应不返回依赖细节、调用栈或本机路径
- Workers AI 错误、业务权限错误、网络失败和 Cloudflare 依赖错误不会被误判为 canonical Session 失效

## 环境变量

Pages Functions：

| 变量 | 说明 |
| --- | --- |
| `CLOUD_FOUNDATION_ENABLED` | Cloudflare 基础层开关；Preview 与 Production 为 `true` |
| `CLOUD_STATUS_MODE` | 状态来源；Preview 与 Production 固定为 `cloud`，`source=legacy` 返回 410 |
| `CLOUD_READS_ENABLED` / `CLOUD_WRITES_ENABLED` | 全局云端读写总开关；Preview 与 Production 均为 `true` |
| `TASK11_CLOUD_READS_ENABLED` / `TASK11_CLOUD_WRITES_ENABLED` | 更新日志、反馈、投票、学习同步和 telemetry；Preview 与 Production 均启用且不回退本机 |
| `TASK12_CLOUD_ACCOUNTS_ENABLED` | D1 账户与会话主开关；Preview 与 Production 均已在迁移验收后启用 |
| `TASK12_IMPORT_ENABLED` | Task 12 账户导入接口；仅 Preview 默认启用，Production 默认关闭 |
| `TASK12_PRODUCTION_IMPORT_ENABLED` | Production 账户导入第二道开关；默认 `false`，还要求明确确认头 |
| `TASK13_CLOUD_READS_ENABLED` | D1 会员、权益和支付读取开关；Preview 与 Production 均已在迁移验收后启用 |
| `TASK13_CLOUD_WRITES_ENABLED` | D1 会员、权益和支付写入总开关；必须与读取和支付主开关同时启用才接受支付写入 |
| `TASK13_PAYMENT_PRIMARY_ENABLED` | 支付单一主写门；启用后 D1/R2 是会员与支付唯一主路径，失败不会回退双写 SQLite |
| `TASK13_IMPORT_ENABLED` | Task 13 导入入口；仅 Preview 默认启用，Production 保持关闭 |
| `TASK13_PRODUCTION_IMPORT_ENABLED` | Production 导入第二道开关；默认 `false`，还要求管理员会话、备份和精确确认头 |
| `TASK14_CLOUD_READS_ENABLED` / `TASK14_CLOUD_WRITES_ENABLED` | D1/R2 临时分享读写开关；Preview 与 Production 均已在迁移验收后启用 |
| `TASK14_TEMPORARY_PRIMARY_ENABLED` | 临时分享单一主路径开关；Preview 与 Production 均为云端主路径，失败不会回退双写 SQLite |
| `TASK14_LEGACY_WRITES_FROZEN` | legacy 临时分享写入冻结标记；Production 保持 `true`，正式 D1/R2 主路径不受影响 |
| `TASK14_IMPORT_ENABLED` / `TASK14_PRODUCTION_IMPORT_ENABLED` | Task 14 导入入口及 Production 第二道开关；Preview 仅用于隔离迁移，Production 两项均保持 `false` |
| `WYJ_TASK14_TEMPORARY_SECRET` | Task 14 密码摘要、连接码 HMAC 和下载授权密钥；至少 32 字符，只存 Cloudflare 加密 Secret |
| `TASK15_CLOUD_ONLY_ENABLED` | Task 15 Production cloud-only gate；Preview 与 Production 必须为 `true` |
| `TASK15_IMPORT_ENABLED` / `TASK15_PRODUCTION_IMPORT_ENABLED` | 剩余工具偏好迁移入口和 Production 第二道开关；正常 Production 均为 `false` |
| `TASK16_CLOUD_READS_ENABLED` / `TASK16_CLOUD_WRITES_ENABLED` | 财务账本读取与本地优先增量同步开关；Preview 与 Production 均为 `true`，Production 已在仓库外备份和 `0012` schema 核对后启用 |
| `TASK16_IMPORT_ENABLED` | 旧 DailyPayGuard 财务导入入口；仅 Preview 隔离验证启用，Production 默认关闭 |
| `TASK16_PRODUCTION_IMPORT_ENABLED` | Production 财务导入第二道开关；默认 `false`，还要求管理员会话、仓库外备份和精确确认头 |
| `WORKERS_AI_ENABLED` | Workers AI 业务开关；Preview 与 Production 为 `true`，development 默认关闭以避免意外用量 |
| `D1_RATE_LIMIT_ENABLED` | 是否用 D1 对云端基础接口做基础限流；发生配额或绑定错误时自动 fail-open 并标记降级 |
| `CLOUD_RATE_LIMIT_REQUESTS` / `CLOUD_RATE_LIMIT_WINDOW_SECONDS` | 云端基础接口限流阈值，默认 120 次/60 秒 |
| `CLOUD_DEEP_HEALTH_CHECKS` | 是否让云端状态接口读取 D1 schema 版本；默认启用，失败只显示 degraded |
| `LEGACY_API_FALLBACK_ENABLED` | Production legacy fallback 标记；所有环境保持 `false` |
| `TASK11_IMPORT_ENABLED` | 受管理员会话保护的 Task 11 数据导入入口；仅 Preview 默认启用，Production 默认关闭 |
| `TASK11_PRODUCTION_IMPORT_ENABLED` | Production 数据导入的第二道开关；默认 `false`，还必须提供明确确认头 |

`WYJ_TASK12_PASSWORD_PEPPER` 与 `WYJ_TASK14_TEMPORARY_SECRET` 必须按环境保存在 Cloudflare encrypted Secret 中。Production 不需要 `LOCAL_API_BASE`、`LOCAL_API_FALLBACK` 或 `WYJ_LEGACY_IDENTITY_BRIDGE_SECRET`；不要重新添加这些变量来绕过 cloud-only gate。不要提交 `.env`、`.dev.vars`、`data/`、SQLite、`users.txt`、日志、二维码、token、Secret 或 Tunnel 凭据。

## 历史后端与手动测试启动器

Production 不需要启动本机程序，电脑关机后网站仍应完整可用。仓库保留 `local-backend/` 与 `desktop-tools/`，仅用于历史兼容测试、迁移审计和人工回滚演练；它们不进入 Pages Production 模块图，不是线上 fallback。项目不配置开机自启动。

如需在隔离环境重放旧后端测试，可手动运行 `启动WYJ网站.cmd`。仓库中的 `desktop-tools/` 是受版本控制的启动器源码目录；部署到桌面时，CMD 放在目标目录根部，两个 PowerShell 文件复制到 `_wyj-tools/`。CMD 也兼容三个文件处于同一目录的开发布局。

```text
仓库源码                       桌面手动启动布局
desktop-tools/启动WYJ网站.cmd  -> 启动WYJ网站.cmd
desktop-tools/start-wyj.ps1    -> _wyj-tools/start-wyj.ps1
desktop-tools/watch-wyj.ps1    -> _wyj-tools/watch-wyj.ps1
```

V11.0.0 启动器把仓库源码和私有运行目录分开，不搬移或覆盖历史数据库、账号、二维码和 Tunnel 凭据。它只在用户明确双击后启动，所有子进程均为本次手动会话的独立后台进程。

V11.0.0 还会兼容 Clash Party。若 Clash Party 原来使用全局代理，启动器会切换为规则模式，只让 `cloudflared.exe` 和 `argotunnel.com` 直连，并用 `MATCH,GLOBAL` 保持其余流量原来的全局代理行为；同时把 `+.argotunnel.com` 加入 fake-IP 排除。若用户本来使用直连模式，启动器不会强制改动。当前运行中的 Clash Party 会通过本地命名管道热加载，并启动仅限本次手动会话的隐藏守护进程，`stdin`、`stdout`、`stderr` 分别重定向；关闭 Clash Party 或关机后会自然结束，不创建开机自启动。配置变更前的备份保存在 `%LOCALAPPDATA%\WYJJapanese\config-backups\mihomo-party`。

启动时只同步白名单内的测试后端文件并保留私有运行数据。旧 Python、Ollama 与 Tunnel 即使全部停止，也不得影响 `thewyj.uk` 的登录、学习、支付、工具、临时分享、AI 或 PDF；cloud-only 浏览器 CI 会专门阻止这类依赖重新进入正式路径。

常用诊断与重新配置：

```powershell
# 只读检查，不启动或停止服务
powershell -NoProfile -ExecutionPolicy Bypass -File .\desktop-tools\start-wyj.ps1 -CheckOnly

# 显式保存现有私有运行目录，然后启动
powershell -NoProfile -ExecutionPolicy Bypass -File .\desktop-tools\start-wyj.ps1 -Configure -RuntimeRoot "你的私有运行目录"
```

启动器会删除历史遗留的开机启动快捷方式，但不会创建新的自启动项。手动测试产生的日志和错误报告放在启动器目录且不得提交；报告不包含数据库内容、登录密钥、Tunnel 凭据或付款码。

源码中对应文件：

- `desktop-tools/启动WYJ网站.cmd`
- `desktop-tools/start-wyj.ps1`
- `desktop-tools/watch-wyj.ps1`
- `local-backend/run.ps1`

也可以只启动历史测试后端：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\local-backend\run.ps1
```

## 测试

后端、HTTP 集成和静态结构测试：

```powershell
cd local-backend
python -m py_compile account_store.py membership.py payment_assets.py temporary_store.py vocabulary_index.py server.py test_accounts.py test_api.py test_payment_assets.py test_static.py test_vocabulary_index.py
python -m unittest discover -p "test_*.py" -v
cd ..
python scripts/repository_audit.py
```

JavaScript 语法检查：

```powershell
node --check app.js
node --check tools.js
node --check workflows.js
node --check sw.js
node --check functions/_middleware.js
node --check functions/_lib/cloudflare-foundation.mjs
node --check "functions/api/[[path]].js"
node --check functions/api/status.js
node scripts/check_js_module_graph.mjs
node local-backend/test_module_graph_js.mjs
node scripts/check_storage_contract.mjs
python scripts/functional_audit_gate.py
node local-backend/test_learning_sync_js.mjs
node local-backend/test_tools_js.mjs
node local-backend/test_workflows_js.mjs
node local-backend/test_proxy_js.mjs
node local-backend/test_cloudflare_foundation_js.mjs
```

`.github/workflows/ci.yml` 在推送到 `main`、所有 Pull Request 以及手动触发时运行。进入仓库的 **Actions -> Core CI -> Run workflow** 可手动执行。工作流分为：

- `Python syntax and unittest`：Python 语法检查和完整 `unittest`；
- `JavaScript and static site checks`：JavaScript 语法、ES Module 无环依赖、浏览器存储兼容、工具与工作流测试、历史代理 fixture 测试，以及 HTML、PWA 和目录覆盖检查；
- `Sensitive files and static naming`：检查敏感运行文件、凭据特征、旧仓库名和会员静态名称；
- `Browser flow (application/toolbox)`：两个并行的真实无头 Chrome 流程，分别覆盖完整网站流程和 103 个在线工具。
- `Cloud-only browser`：只启动 fresh D1/R2 Pages Functions 与 Chrome，不启动 Python、SQLite、Ollama、cloudflared 或 `LOCAL_API_BASE`，验证注册登录、刷新/重开标签、业务失败隔离、英语/日语导入开考和网络恢复。

浏览器 job 会为每个矩阵项创建独立的临时 SQLite、随机测试管理员密钥、合成的 1 像素二维码和确定性的 Ollama 兼容测试夹具，只访问 `127.0.0.1` 上的隔离服务，不读取真实账户、生产服务、真实 Ollama、Cloudflare Tunnel 或真实收款二维码。测试夹具仅让既有浏览器流程稳定覆盖 AI 入口，不进行真实模型推理。依赖缓存仅保存 `pip`/`npm` 下载缓存，不缓存源码、测试输出或通过结果。每个 job 无论成功失败都会上传关键日志，保留 7 天。

本地运行浏览器矩阵时，需要先启动一个使用隔离数据库和测试管理员密钥的后端，并以 `--remote-debugging-port=9223` 启动 Chrome。准备好 `WYJ_TEST_BASE`、`WYJ_CDP_URL` 和仅用于隔离测试库的 `WYJ_TEST_ADMIN_SECRET` 后执行：

若本机没有 Ollama，可在单独终端运行 `python local-backend/ci_ollama_stub.py --host 127.0.0.1 --port 11435`，并在启动隔离后端前设置 `OLLAMA_HOST=http://127.0.0.1:11435`。该夹具只适用于测试，不能作为生产 AI 服务。

```powershell
node local-backend/test_app_browser.mjs
node local-backend/test_tools_browser.mjs
```

当前 Python 自动化套件共 174 项，另配有学习同步客户端协议测试、38 项 JavaScript 工具模块自检、11 组工作流核心自检和 4 项 Pages 代理韧性检查，以及 `qa/functional-audit.json` 驱动的全功能覆盖门禁。门禁必须精确覆盖 20 个路由、21 条应用流程、103 个工具、51 个工具子模式、7 个复选控制、12 个工作流能力和 27 个工作流浏览器行为；源码和 QA 清单任一方向出现缺项都会直接失败。

`test_app_browser.mjs` 使用真实 Chrome 覆盖 21 条完整用户流程，其中包含学习数据离线排队、恢复连接、第二设备目标合并、账号绑定备份校验，以及 390px 手机视口下的错题重新判定、统一反馈计时、A-H 切页/刷新状态完整性、WCAG AA 对比度回归、结构化更新日志、私有反馈提交、管理员反馈处理与功能投票。`test_tools_browser.mjs` 会为每次运行创建全新的浏览器上下文，逐项操作 103 个工具（文本 29、文件 17、图片 30、随机 22、临时 5）及 51 个子模式，并额外真实操作工作流创建、编辑、保存、导入导出、四个模板、批量失败隔离、取消、离线运行和 390/1366/1920 响应式布局。文件、图片、PDF、ZIP、二维码、vCard 和工作流产物不使用被测页面自行判定，而由 `qa/verify_tool_artifacts.py` 通过标准库、Pillow、pypdf、OpenCV 和 vobject 独立重新打开并验证语义；本地首次运行前执行 `python -m pip install -r qa/requirements.txt`。

完整覆盖还包括公开首页、更新日志、有限匿名试用、受保护路由、注册登录、个人首页本地摘要与服务状态、断网后会话保留与自动恢复、微信 WebView 兼容、登录位置审计、会话摘要迁移、封禁、管理员安全重置密钥、用户自助改密、密钥与哈希防泄露、老会员迁移、六种在售方案、支付方式锁定、私有二维码鉴权、完整支付状态机、微信与支付宝订单刷新恢复、原子审批与唯一履约、包月续期与永久会员幂等、权益隔离与合并、过期降级、管理员审计、反馈隐私与投票去重、错题实际重新判定与幂等审计、本地优先分级搜索、NFKC/大小写/假名归一化、英语词形匹配、稳定排序、TTL/LRU 缓存、完整排除词缓存键、工具权限、收藏/历史/配置、双客户端留言自动同步、文件签名、跨站拒绝、限流、AI 兜底选词、日语汉字自动标音、纯假名直接出题、汉字与假名听写判卷、错题 PDF、HTML ID、PWA 缓存、390/1366/1920 像素布局与关键文字对比度、CSV 引号换行、MD5、颜色转换、JPEG 元数据清理、Wi-Fi/联系人二维码和 OpenCC 词典完整性。额外压力矩阵验证 300 次状态请求、200 次并发工具写入和 24 次并发 PDF 导出均为 0 错误。

## Cloudflare Pages 配置

### Serverless 基础层与渐进切换

`wrangler.jsonc` 是 Pages Functions 的版本化部署配置，`name` 固定为现有 Cloudflare Pages 项目 `thewyj-uk`。Task 10 已在 Preview 与 Production 分别创建并验证 D1、R2、Workers AI bindings；本地 development 继续使用 `wrangler.local.jsonc` 和 Wrangler 本地持久化。两套远端资源相互独立，不能把 Preview 数据导入 Production。

| 能力 | binding | 本地 development | Preview | Production |
| --- | --- | --- |
| D1 | `WYJ_DB` | `wyj-cloud-development`（仅本地状态） | `wyj-cloud-preview` | `wyj-cloud-production` |
| R2 | `WYJ_STORAGE` | `wyj-cloud-development`（仅本地状态） | `wyj-cloud-preview` | `wyj-cloud-production` |
| Workers AI | `AI` | 默认不声明，避免无意远程计费 | 已绑定，Task 15 业务开启 | 已绑定，Task 15 业务开启 |

配置没有 `account_id`、API token 或 secret。Cloudflare Pages 在部署带 D1 binding 的 Wrangler 配置时要求 `database_id`，因此 Preview 与 Production 环境各自保存 Cloudflare 生成的 D1 资源 UUID；这些 UUID 不是鉴权凭据，真正凭据仍只保存在 Cloudflare。`cloudflare/migrations/0001_foundation.sql` 已在两套远端 D1 应用，只创建 schema 元数据和基础限流窗口，不包含用户、会员、订单或支付数据。

`functions/_middleware.js` 为 Pages Functions 响应加入安全头和 `X-Request-ID`，拒绝浏览器跨站写请求，并把未处理异常转成统一的 `{ ok, error, code, retryable, request_id }` 格式。`GET /api/status` 与 `GET /api/status?source=cloud` 均直接报告 D1/R2/AI bindings、feature flags、限流和降级原因；`source=legacy` 返回 410，不发起本机请求。

Task 11～15 的 Production 业务均使用 Pages Functions。D1 是账户、Session、学习同步、会员、订单、临时分享 metadata、工具偏好、AI cache/用量和审计的单一结构化数据源；R2 保存私有支付二维码和临时分享文件；Workers AI 只处理必要的短文本 fallback；PDF 在浏览器本地生成。Production 不导入 `legacy-api.mjs` 或 `task12-bridge.mjs`，不把 D1 Session 转换成旧身份，也不会在云服务错误时回退或双写 SQLite。

### 控制台准备

1. 在 **Workers & Pages -> D1** 核对 `wyj-cloud-preview` 与 `wyj-cloud-production`，不要互换环境。
2. 在 **R2** 核对同名 Preview/Production Standard buckets。免费额度只适用于 Standard storage。
3. 打开 Pages 项目 `thewyj-uk` 的 **Settings -> Bindings**，分别核对 Preview/Production 的 D1 `WYJ_DB`、R2 `WYJ_STORAGE`、Workers AI `AI`。Wrangler 配置部署后是 Pages 的 source of truth。
4. 在 `thewyj-uk` 项目的 **Settings -> Variables and Secrets** 核对非敏感 feature flags，并以 Cloudflare encrypted Secret 保存 Task 12/14 密钥。Production 不设置 `LOCAL_API_BASE` 或 identity bridge secret。新增 Secret 使用 `wrangler pages secret put <KEY> --project-name thewyj-uk` 或控制台 Secret，不要写入 `wrangler.jsonc`。
5. Pages Wrangler 配置要求 V2 build system。每次迁移前先比对控制台现有 Production/Preview bindings；配置一旦部署就是 Pages 的 source of truth。

### 本地开发

需要 Node 22 和仓库锁定的 Wrangler 4.118。`compatibility_date` 使用该版本本地 runtime 已支持且仍在 30 天窗口内的 `2026-08-06`；升级 Wrangler 后应先在 preview 验证再更新。PowerShell 因执行策略拦截 `.ps1` 时可直接运行 `npm.cmd`。

```powershell
npm.cmd ci
npm.cmd run cf:migrate:local
npm.cmd run cf:types
npm.cmd run cf:check
npm.cmd run cf:dev
```

先将 `.dev.vars.example` 复制为已忽略的 `.dev.vars`，并为两个占位项分别生成至少 32 字符的本地随机值；不要复用 Preview 或 Production Secret。`wrangler.local.jsonc` 只供本地 migration 使用，`cf:dev` 通过 `--d1 WYJ_DB --r2 WYJ_STORAGE` 创建同名本地 bindings。默认 development 使用本地 D1/R2 cloud-only 路径，AI 则保持关闭；Wrangler 在 `.wrangler/state` 保存本地数据且该目录已忽略。访问 `http://127.0.0.1:8788/api/status?source=cloud` 检查云基础层。Workers AI 即使在本地也会访问 Cloudflare并计入用量，需要真实联调时先登录 Wrangler，再临时运行 `npx.cmd wrangler pages dev --d1 WYJ_DB --r2 WYJ_STORAGE --ai AI --binding WORKERS_AI_ENABLED=true`。普通本地开发和自动测试不要求 Python、SQLite、Ollama、Tunnel 或 Cloudflare Token。

### 迁移、部署与回滚

Task 10 的 `0001_foundation.sql`、Task 11 的 `0002_low_risk_cloud_services.sql`、Task 12 的 `0003_accounts_sessions.sql`、`0004_session_limit_trigger.sql`、`0005_session_limit_ordering.sql`、Task 13 的 `0006_memberships_payments.sql`，Task 14 的 `0007_temporary_sharing.sql`、`0008_task14_user_storage_trigger.sql`、`0009_task14_global_storage_trigger.sql`、Task 15 的 `0010_task15_cloud_only.sql`、`0011_task15_import_trigger_order.sql`、Task 16 的 `0012_finance_core.sql`，以及 Task 17 的 `0013_finance_web_membership.sql` 必须从 fresh D1 按序可重复应用。Production 迁移报告与备份只保存在仓库外；导入完成后所有 Production import 开关保持关闭。

```powershell
# 本地全新 D1 验证
npm.cmd run cf:migrate:local
npm.cmd run test:task11
npm.cmd run test:task12
npm.cmd run test:task13
npm.cmd run test:task14
npm.cmd run test:task15
npm.cmd run test:task16

# Preview D1
npx.cmd wrangler d1 migrations apply WYJ_DB --remote --env preview
# Preview Pages（按当前任务分支替换 branch）
npm.cmd run pages:stage
npx.cmd wrangler pages deploy .wrangler/pages-output --project-name thewyj-uk --branch codex/task15-workers-ai-retire-legacy-backend
```

Preview 与 Production 的 `/api/status?source=cloud` 必须显示 Task 12～16 schema ready、`task15_cloud_only=true`、`workers_ai=true`、`legacy_fallback=false`，且 Production import 均为 `false`。Task 16 的 Preview 与 Production 财务读写均已启用；Production 旧数据导入仍保持双开关关闭，仅允许在仓库外备份、明确管理员确认和逐批对账期间短时开启。隔离测试覆盖注册、登录、刷新/重开标签恢复、改密、封禁、强制退出、多会话、Task 11 ownership、业务错误不退出登录、英语/日语导入开考和网络恢复。任何后续部署都必须保持 Production D1 账户主开关开启。

回滚是人工数据恢复流程，不是线上请求 fallback。先冻结受影响的新写入、导出并核对 D1/R2 增量，再决定前向修复或从仓库外备份恢复；代码可在 Pages **Deployments -> All deployments** 回滚到先前成功的 Production deployment。D1 migration 是前向迁移，不要因代码回滚删除表或生产数据；Preview deployment 不能作为 Production 回滚目标，也不得把正式主写切回正在变化的 SQLite。

### Task 11 低风险云迁移

Task 11 只迁移结构化更新日志、反馈、功能投票、学习同步和聚合 telemetry。`cloudflare/migrations/0002_low_risk_cloud_services.sql` 创建带 `task11_` 前缀的独立表，不创建或复制账户、密码、Session、会员、entitlement、支付、二维码、临时分享、PDF 或 AI 业务数据。现有 `/api/*` 路径和响应字段保持不变。

Task 12 启用后，Task 11 在 Preview 与 Production 都直接使用 D1 Session 和同一稳定 user ID，不再依赖本机 `/api/me`；既有 Task 11 表及 ownership 不会重建。`legacy-api.mjs` 只保留为 test-only 迁移/回滚 fixture，Production 正常身份和业务模块均不会导入它。

| 路由 | 云端数据 | 权限 |
| --- | --- | --- |
| `GET /api/changelog` | 结构化 changelog | 公开；D1 不可用时浏览器读取静态 `changelog.js` |
| `POST /api/feedback`、`GET /api/feedback/mine` | 私有反馈 | 当前登录用户，只能读自己的数据 |
| `GET /api/feedback/voting`、`POST /api/feedback/vote` | 已公开建议与一人一票 | 当前登录用户 |
| `GET /api/admin/feedback`、`POST /api/admin/feedback/update` | 反馈管理与独立审计 | 旧账户系统确认的超级管理员 |
| `POST /api/learning/sync` | 增量学习记录、版本流和 tombstone | 当前登录用户；按稳定用户 ID 隔离 |
| `POST /api/telemetry` | 小时级聚合计数 | 公开白名单字段；不保存 IP、UA 或原始输入 |
| `GET /api/admin/task11/telemetry` | 聚合统计 | 超级管理员 |

Task 11 完成迁移后，Preview 与 Production 的云读写均已启用，D1 是唯一正式数据源；读取或写入失败会返回可重试的云端错误，不会回退或双写旧 API。D1 同步使用用户版本和 mutation ID 做乐观并发控制，发生竞争时重新读取并执行原有合并规则。

迁移工具默认是 dry-run，并通过与云端导入端相同的字段白名单逐条验证。报告只保存源数量、预计目标数量、非法/重复数量和导入结果，不保存反馈正文、学习 payload、用户名、token 或其他原始内容。报告和数据库备份必须放在 Git 仓库外。

```powershell
# Preview dry-run：不会联网写入
python scripts/migrate_task11_to_d1.py `
  --source-db <受保护的SQLite备份> `
  --environment preview `
  --dry-run `
  --report <仓库外的迁移报告.json>

# Preview 正式导入前，把管理员会话放入环境变量，禁止打印其值
$env:WYJ_TASK11_ADMIN_SESSION = '<当前管理员会话>'
python scripts/migrate_task11_to_d1.py `
  --source-db <受保护的SQLite备份> `
  --environment preview `
  --endpoint <Task-11-Preview-URL> `
  --apply `
  --report <仓库外的迁移报告.json>
```

Production 导入还要求 `TASK11_PRODUCTION_IMPORT_ENABLED=true`、`--backup-confirmed` 和 `--confirm-production TASK11-PRODUCTION-MIGRATION`。这些条件默认不满足；必须在 Preview、CI、源/目标数量核对通过并获得明确批准后才能临时启用。导入可重复运行：changelog/反馈/学习记录使用稳定主键 upsert，投票和版本变更使用唯一约束去重。

### Task 12 账户与会话迁移

`cloudflare/migrations/0003_accounts_sessions.sql` 新建 `task12_users`、`task12_sessions`、登录审计、账户审计和登录失败窗口；`0004_session_limit_trigger.sql` 在每次插入时由 D1 原子保留最新 12 个有效 Session，`0005_session_limit_ordering.sql` 再把保留顺序固定为 SQLite 插入 `rowid`，避免并发登录落在同一毫秒时使用随机 digest 破坏新旧顺序。它们不创建 membership、entitlement、payment、临时分享或 AI 表。用户主键直接复用 SQLite 的稳定文本 ID，Task 11 的反馈、投票和学习同步继续以同一 ID 归属；导入状态会报告 orphan 数量，非零时停止正式导入。

新建或成功升级的云账户使用版本化摘要 `pbkdf2_sha256_cf_v1$310000$...`：随机盐、四个串行 PBKDF2-SHA256 阶段（100,000 + 100,000 + 100,000 + 10,000）以及仅保存在 Cloudflare Secret 中的服务端 HMAC pepper。`password_scheme` 继续写 `pbkdf2_sha256` 作为算法家族，具体格式由摘要前缀区分，避免重建已有 D1 表。分段格式让每个 Web Crypto 调用保持有界，同时维持 310,000 次总工作量。`WYJ_TASK12_PASSWORD_PEPPER` 必须至少 32 bytes、按环境独立生成且稳定保存；状态接口只报告 `password_pepper_configured`，不会返回 Secret 值。丢失或更换 pepper 会使已生成的云摘要无法验证，只能通过受控密码重置恢复。

迁移工具只复制结构有效的旧 `pbkdf2_sha256$310000$...` 摘要。Task 15 由 Pages Web Crypto 直接验证该受支持摘要，并在成功登录后升级成 `pbkdf2_sha256_cf_v1`；不再调用 Python 身份桥。历史明文、未知 hash 和损坏记录仍只按数量分类并标记 `reset_required`，绝不把原值发送到 D1、报告或日志。D1 Session 只保存 `sha256$...` digest、有效期、会话版本和最小客户端类型；旧活动 Session 未迁移，正式切换时要求用户重新登录。

`WYJ_TASK12_PASSWORD_PEPPER` 必须按环境独立、稳定地保存在 Cloudflare encrypted Secret。`legacy-api.mjs` 与 `task12-bridge.mjs` 只作为 test-only 迁移/回滚 fixture 保留；Production 模块图、路由和环境变量均不依赖 identity bridge。

```powershell
# 默认 dry-run：只输出计数，不联网、不打印用户名、hash、token 或 secret
python scripts/migrate_task12_accounts_to_d1.py `
  --source-db <受保护的SQLite备份> `
  --environment preview `
  --dry-run `
  --report <仓库外的迁移报告.json>

# Preview 导入前，把旧系统管理员会话放入进程环境变量，禁止打印
$env:WYJ_TASK12_ADMIN_SESSION = '<当前管理员会话>'
python scripts/migrate_task12_accounts_to_d1.py `
  --source-db <受保护的SQLite备份> `
  --environment preview `
  --endpoint <Task-12-Preview-URL> `
  --apply `
  --report <仓库外的迁移报告.json>
```

导入按稳定 ID upsert，可重复执行且不会复制 SQLite Session。Production 导入曾临时要求 `TASK12_PRODUCTION_IMPORT_ENABLED=true`、`--backup-confirmed`、`--confirm-production TASK12-PRODUCTION-ACCOUNT-MIGRATION` 和同名确认头；完成源/目标数量、ID 集合与 Task 11 ownership 核对后，两个导入开关均已恢复为 `false`。回滚时先把 Pages 的 Task 12 主开关关闭；如果 D1 已发生改密、封禁或新注册，不能直接恢复旧 SQLite 主写，必须先按仓库外迁移报告核对账户并让受影响用户重新认证或重置密钥，避免恢复旧密码或产生 split-brain。

### Task 13 会员、权益和支付云迁移

`cloudflare/migrations/0006_memberships_payments.sql` 在 Task 12 稳定 user ID 上新增 `task13_` 前缀的方案、会员、entitlement override、支付订单、状态历史、唯一履约、管理员审批和审计表。迁移不会删除或改写旧 SQLite 表，也不会提前迁移临时分享、PDF 或 AI。六个在售方案由 D1 方案表提供：8 CNY 单语言包月、20 CNY 双语言包月、20 CNY 工具箱包月、30 CNY 全功能包月、70 CNY 双语言双项永久、100 CNY 全功能永久；内部代码 `japanese_lifetime` 保持不变，70 CNY 方案不包含工具箱。`monthly`、`lifetime` 和 `dual_language_lifetime` 仅用于历史兼容，新订单会拒绝停售方案。

Pages 保持原 `/api/membership/*`、`/api/recharge/*` 和 `/api/admin/*` 契约。服务端从 D1 读取方案并锁定订单名称、金额、期限和 entitlement 快照；客户端不能指定金额、用户 ID、权益或 R2 key。订单仍按 `pending_payment -> user_paid -> processing -> approved` 流转，也支持 `rejected`、`cancelled`、`expired`。用户点击“我已付款”只进入 `user_paid`，只有超级管理员审批成功才在同一 D1 batch 中写入唯一履约、会员、状态历史和审计。重复或并发审批不能重复延长期限，异常响应会说明提交状态而不会悄悄重试履约。

收款二维码存放在环境隔离的私有 `WYJ_STORAGE` bucket，既有方案使用固定 key `payments/qrcodes/v1/<wechat|alipay>_<plan>.png`。`finance_monthly` 的订单仍保存自身的 plan-bound `qr_resource_id`，服务端物理读取则复用同支付方式的 `all_access_monthly` 私有收款码，避免复制敏感二维码文件；客户端不能选择或看到该映射。接口只允许已登录的订单本人按订单 ID 读取，并校验订单归属、状态、支付方式、方案和 `qr_resource_id`；响应使用 `Cache-Control: private, no-store`，不返回 object key。二维码文件、内容和真实付款信息不得进入 Git、迁移报告或 CI artifact。

Preview 验证顺序：

```powershell
# 本地 D1/R2 + Miniflare 回归
npm.cmd run cf:migrate:local
npm.cmd run test:task13

# Preview D1：只应用前向 migration，不删除旧表
npx.cmd wrangler d1 migrations apply WYJ_DB --remote --env preview

# 迁移前只读审计；报告必须写在仓库外
python scripts/migrate_task13_memberships_payments.py `
  --source-db <受保护的SQLite备份> `
  --qr-dir <私有二维码目录> `
  --environment preview `
  --dry-run `
  --report <仓库外的迁移报告.json>

# Preview 导入：会按固定 key 上传私有二维码并分批幂等写入 D1
$env:WYJ_TASK13_ADMIN_SESSION = '<Preview 的 D1 管理员会话>'
python scripts/migrate_task13_memberships_payments.py `
  --source-db <受保护的SQLite备份> `
  --qr-dir <私有二维码目录> `
  --environment preview `
  --endpoint <Task-13-Preview-URL> `
  --apply --upload-r2 `
  --r2-bucket wyj-cloud-preview `
  --wrangler-env preview `
  --report <仓库外的迁移报告.json>

# 分支 Preview 部署
npx.cmd wrangler pages deploy . --project-name thewyj-uk --branch codex/task13-membership-payment-cloud
```

迁移工具使用 SQLite 只读连接检查用户归属、主键/订单号重复、方案兼容、各状态数量、唯一履约和二维码 PNG 签名/大小；导入按稳定 ID upsert/ignore，可重复执行。报告只含计数和结果，不含用户名、订单备注、二维码内容、Session、Secret 或 Token。Preview 必须逐项验证六种方案、五种用途、微信/支付宝、刷新恢复、私有二维码越权、用户声明付款不履约、管理员批准/拒绝、包月续期、永久幂等、并发审批、D1/R2 故障和现有移动支付流程。

Task 13 Production 已在 2026-08-23 完成仓库外 SQLite 备份、dry-run、稳定 user ID/归属核对、D1 migration、幂等导入、私有 R2 二维码逐文件 SHA-256 回读、云端只读验证，以及微信和支付宝人工扫码验收。随后启用了 `TASK13_CLOUD_READS_ENABLED`、`TASK13_CLOUD_WRITES_ENABLED` 和 `TASK13_PAYMENT_PRIMARY_ENABLED`；两个导入开关均已恢复为 `false`。Production 新订单、付款状态、审批和会员履约现在只写 D1/R2，失败不会回退或双写 SQLite。

Production 主路径启用后，旧 Python 会员与支付实现仅作为受控恢复参考，不再接受 Pages 的新支付主写。回滚前必须先停止新支付操作，导出并核对 D1 在切换后的订单、会员、履约和审计增量，再决定前向修复或受控回迁；不能直接关闭云端开关并恢复 SQLite 主写，否则会丢失新订单并形成 split-brain。Pages 代码回滚仍可在 **Deployments -> All deployments** 选择此前成功版本，但数据 source of truth 不能随代码版本自动倒退。

### Task 14 临时分享云迁移（Production 已启用）

`cloudflare/migrations/0007_temporary_sharing.sql` 在 Task 12 稳定 user ID 上创建 `task14_` 前缀的临时分享、房间消息、下载授权、用量和迁移状态表；`0008`、`0009` 分别建立单用户 500 MiB 与全局 5 GiB 存储配额 trigger。D1 只保存 metadata、摘要、计数和 R2 服务端引用，二进制文件保存在环境隔离的私有 `WYJ_STORAGE` bucket。客户端不能列出 bucket、指定 object key 或读取其他用户的 metadata；公开分享读取仍按不可预测 ID、密码或连接码及有效期受控。

Task 14 保留临时文本、普通及动态二维码内容、剪贴板、留言房间和临时文件。文件上传先创建服务端 reservation，再用原始 `PUT` 请求体写入 R2；下载先原子签发短时授权，再由受控 API 流式返回字节。服务端校验 extension、MIME、基础签名、大小和状态，响应设置安全的 `Content-Disposition`、`nosniff` 和私有缓存策略。普通文件上限 20 MiB，视频 MP4/M4V/MOV/WebM 上限 30 MiB；空文件和不匹配的 MIME、扩展名或签名会被拒绝。

下载上限采用“授权成功即消费一次”的确定性语义，避免两个并发客户端同时抢到最后一个名额。同一授权可在 15 分钟内用于 Range 或断线重试且不重复计数，但原子请求锁保证同一时刻只能有一个下载流，不能把一个授权并发复用成多次下载；中断本身不退还次数。完整非 Range 下载结束后，`destroy_after_download` 才进入删除流程。过期检查在创建、读取、授权和定时任务中执行；独立 cleanup Worker 每小时处理过期、失败重试、D1/R2 不一致和 orphan 对象，删除操作保持幂等。

Preview 或隔离恢复验证顺序：

```powershell
# 本地 migration、Miniflare、并发、Range、配额和迁移工具回归
npm.cmd run cf:migrate:local
npm.cmd run test:task14

# Preview 专用 Secret，值不要出现在命令历史、README 或 Git
npx.cmd wrangler pages secret put WYJ_TASK14_TEMPORARY_SECRET --project-name thewyj-uk --env preview

# Preview D1 与 Pages 分支部署
npx.cmd wrangler d1 migrations apply WYJ_DB --remote --env preview
npm.cmd run pages:stage
npx.cmd wrangler pages deploy .wrangler/pages-output --project-name thewyj-uk --branch codex/task14-temporary-sharing-r2

# 迁移前只读审计，报告和 resume state 必须写在仓库外
python scripts/migrate_task14_temporary_to_d1_r2.py `
  --source-db <受保护的SQLite备份> `
  --environment preview `
  --report <仓库外的dry-run报告.json>

# 幂等上传 R2 并导入 D1
$env:WYJ_TASK14_MIGRATION_SESSION = '<Preview 的 D1 管理员会话>'
python scripts/migrate_task14_temporary_to_d1_r2.py `
  --source-db <受保护的SQLite备份> `
  --environment preview `
  --endpoint <Task-14-Preview-URL> `
  --apply --upload-r2 `
  --r2-bucket wyj-cloud-preview `
  --wrangler-env preview `
  --resume-state <仓库外的resume-state.json> `
  --report <仓库外的apply报告.json>
```

`wrangler.task14-cleanup.jsonc` 是 cleanup Worker 模板，D1 UUID 使用占位符，不能直接提交真实 ID。部署时复制到已忽略的 `.wrangler/` 目录，替换对应环境占位符后再执行 `npx.cmd wrangler deploy --config <本地配置> --env <preview|production>`。Production cleanup Worker 已按小时 Cron 部署，使用 Production D1/R2 和加密 Secret；实际 UUID、Secret 和私有配置不进入 Git。读取前惰性检查与定时 Worker 共同处理过期、删除重试、D1/R2 不一致和 orphan 对象。

`npm.cmd run pages:stage` 只把 Pages 运行时需要的根文件、`assets`、`functions`、`js` 和 `vendor` 复制到已忽略的 `.wrangler/pages-output`。直接上传这个白名单目录可避免把 `.tool-e2e`、本地数据库、日志、测试下载和其他私有运行文件带入 Direct Upload；不要用仓库根目录替代它。

迁移工具只读取 SQLite 备份并输出安全计数：metadata、文件数、总字节、类型、无效 ID/错误码和 ownership orphan 数，不输出内容、密码、摘要、token 或本机路径。R2 上传按确定性 key 和 SHA-256 回读校验，resume state 支持中断续跑；D1 import 使用 source key 幂等 upsert。Preview 回滚使用相同脚本加 `--rollback --endpoint <URL>`，只删除该 source key 导入的数据和对应 R2 对象，不删除正常云端新建数据。

Task 14 Production 切换前对 legacy SQLite 做了仓库外备份、两次 dry-run、文件签名和稳定 user ID 归属核对。源 metadata、文件和字节数均为 0，目标导入数量也为 0，因此没有 legacy R2 对象需要上传，空迁移集合的 checksum 核对成立；两个幂等 import run 均完成。随后验证所有临时类型、20/30 MiB 边界、密码/连接码、并发最后一次下载、Range/中断恢复、销毁语义、R2 缺失、配额和 390x844 移动端真实下载，才同时启用 Production 的读、写和主路径开关。当前 `TASK14_IMPORT_ENABLED=false`、`TASK14_PRODUCTION_IMPORT_ENABLED=false`，`TASK14_LEGACY_WRITES_FROZEN=true` 阻止历史实现重新接受新写入，D1/R2 是唯一正式 source of truth。

旧 Draft PR #11 不合并。其 MP4/M4V/MOV/WebM 支持、30 MiB 视频限制、扩展名/MIME/容器签名校验、R2 流式移动端下载，以及确定性的下载计数和并发语义，均已由 Task 14 当前实现替代；旧 PR 中 Tunnel 选择逻辑不再适用于云端临时分享。

Task 14 回滚只允许作为受控恢复：先停止新的临时分享写入，导出并核对切换后 D1/R2 增量，再决定前向修复或受控回迁。不得直接把 SQLite 恢复为主写，也不得让 Cloud 与 SQLite 双写。代码层可在 Pages **Deployments -> All deployments** 回滚到先前成功部署，但数据 source of truth 不会随代码自动倒退，D1 表和 R2 对象不得删除。

### Task 15 完全云端化

`cloudflare/migrations/0010_task15_cloud_only.sql` 新增短期 quiz authorization、Workers AI cache/用量/并发 lease、工具收藏/最近使用/保存配置，以及幂等 import batch/receipt；`0011_task15_import_trigger_order.sql` 固定远端 D1 的 import receipt 校验优先级。模型只在 `functions/_lib/task15-model.mjs` 配置；当前使用 Cloudflare 官方 JSON Mode 支持列表中明确列出、仍保持 active 的多语言 `@cf/meta/llama-3.1-8b-instruct-fast`。单次输入最多 6,000 字符、输出最多 512 tokens、超时 18 秒；仅 Workers AI 5xx 最多自动重试 1 次，401/403/429、格式错误和 timeout 不重试；每用户每日 120 次、全站每日 3,000 次，最多 4 个并发 lease，cache 保留 7 天并在后续写入时有界清理过期项。

学习请求先使用内置词典、NFKC/假名/词形规则和 D1 cache；只有仍无法可靠回答时才调用 Workers AI。AI cache key 是规范化输入的 SHA-256，持久化内容不含原始用户答案、完整词表、prompt、密码或 Session token。AI 401/403、429、5xx、timeout、无效 JSON 或 schema failure 都返回稳定业务错误并保持 canonical Session。

Canonical Session 由 Task 12 D1 唯一判定。前端仅在 `authentication_required`、`canonical_session_invalid`、`session_expired`、`session_revoked`、`session_generation_invalid`、`account_deleted` 或 `account_banned` 等稳定终态代码下清除本地 Session；普通 HTTP 401、`membership_required`、Workers AI、D1/R2 业务表、网络或依赖错误不会触发退出。会话成功写入后立即读回校验，storage 写入失败会显示明确提示；同源标签页通过浏览器 `storage` event 同步登录或退出状态，不额外广播 token。

错题 PDF 由 `js/language/pdf.js` 在浏览器 Canvas 生成 JPEG 页面并写入标准 PDF 1.4 容器。导出前检查 MIME 与 `%PDF` 签名，生成内容不经过 API。多图 PDF 和图片 PDF 继续走既有浏览器工具实现。

Task 15 剩余 SQLite 工具偏好迁移只读取仓库外备份并输出计数、稳定 batch key 和聚合 SHA-256，不输出用户名、配置正文、token、Secret 或本机路径。每批 receipt 绑定 source/kind/batch/digest/source count；完全相同的重放返回 `replayed`，同 batch 内容变化会拒绝。D1 mutations 与 receipt 在同一 batch 中提交，数据库触发器原子限制累计数量、完成状态和来源总数；已存在的云端收藏、历史或配置优先，导入和回滚都不会覆盖或删除这些记录。

```powershell
# dry-run；报告必须写在仓库外
python scripts/migrate_task15_remaining_to_d1.py `
  --source-db <受保护的SQLite备份> `
  --environment preview `
  --report <仓库外的task15-dry-run.json>

# Preview apply；管理员 Session 只放进进程环境变量
$env:WYJ_TASK15_MIGRATION_SESSION = '<隔离Preview管理员会话>'
python scripts/migrate_task15_remaining_to_d1.py `
  --source-db <受保护的SQLite备份> `
  --environment preview `
  --endpoint <Task-15-Preview-URL> `
  --apply `
  --report <仓库外的task15-preview-apply.json>
```

Production 切换顺序固定为：创建迁移 tag与最后 SQLite 只读备份；记录 D1/R2 数量和聚合一致性；Preview migration/import/browser 验收；Production migration 与只读核对；短时冻结旧写入；Production 导入和重复重放核对；启用 cloud-only 与 Workers AI；关闭 import、legacy fallback、`LOCAL_API_BASE` 和 identity bridge；最后停止 Python、Ollama 与 cloudflared。回滚必须先导出并核对切换后的 D1/R2 增量，不能直接恢复旧 SQLite 主写。

Task 15 Production 最终验收于 2026-08-27 完成：本机 Python、Ollama、cloudflared 和相关监听端口全部停止后，Production 移动端完整流程仍通过；随后电脑彻底关机，使用手机移动网络从异地重新访问 `thewyj.uk`，登录、学习、AI、工具及云端状态均可用。Production 的结构化数据、私有文件和 AI 分别以 D1、R2 和 Workers AI 为正式 source of truth；本地 SQLite、Tunnel 与历史后端只保留仓库外备份、测试夹具和人工回滚参考，不接受线上主写。

### Task 16 财务核心与 DailyPayGuard 迁移

Task 16 只建立财务数据、同步、识别和迁移核心，不提前提供完整 Web 财务页面或 Android 自动采集客户端。`cloudflare/migrations/0012_finance_core.sql` 在 Task 12 稳定 user ID 上创建用户设备/版本、分类、预算、canonical transaction、raw event、transaction-event 关联、审计、增量变更、幂等操作 receipt，以及来源、批次和逐记录迁移 receipt。原始通知或短信正文不保存到 D1、R2、AI、telemetry 或日志；服务端仅保存经过白名单过滤的交易字段和原文 SHA-256 fingerprint。Task 16 不使用 R2，也没有新增 Secret。

财务操作保持本地优先：Web/Android 先把有稳定 `operation_id`、entity ID、revision 和 device ID 的操作写入本地队列，再批量调用 `POST /api/finance/sync`。服务端返回单调 `server_version`、逐操作 receipt 和增量 change stream；离线重放、进程重启、并发 Worker 和双设备使用同一 operation/provider reference 时不会重复创建 raw event。每次写入会固定读取实体前的 server version，另一设备抢先写入时返回可重试冲突，不会生成虚假的成功 receipt。设备的 `last_sync_version` 只推进到实际返回的 `next_since`；账目分页使用时间与 ID 复合游标，避免同一毫秒多笔交易跨页遗漏。删除采用 tombstone，撤销采用带 revision 的 restore；冲突返回当前版本，不会整份覆盖另一设备数据。合并/拆分的变更 payload 同时包含目标记录、来源 tombstone 和新记录，客户端无需猜测或丢弃 raw evidence。

自动识别先判断来源、完成语义和收支/退款方向，再接受金额。贷款/信用额度、优惠券、抽奖和商品宣传等营销内容即使包含金额也只保存为 rejected raw evidence，不创建账目。跨来源融合只在强 provider transaction/reference 一致时自动执行；同来源但缺少稳定参考号的相近金额和时间仍保持独立。用户手动合并/拆分会保留 raw event 关联和审计记录。

Task 16 当时先新增兼容权益 `finance_access` 和隐藏基础方案 `finance_monthly`（8 CNY/月），并让 `all_access_monthly` 与 `all_access_lifetime` 自动合并该权益；旧全功能会员因此无需改写历史订单快照即可获得财务访问。该阶段尚未开放独立购买。Task 17 随后通过 `0013_finance_web_membership.sql` 将 `finance_monthly` 开放为第七个在售方案；当前在售状态、用途筛选和私有二维码要求以本 README 的“会员与套餐”和“Task 17 Web 财务账本”章节为准。

旧 DailyPayGuard Android 原型是 Kotlin/Compose + NotificationListener，记录保存在 SharedPreferences 的 tab/newline 文本中，并用 timestamp 作为删除 ID；旧进程内 15 秒 fingerprint 去重在 App 重启后失效，也缺少编辑、云同步和持久审计。迁移工具支持 SharedPreferences XML 或导出文本，使用旧 timestamp 加用户/来源不可逆短摘要生成稳定 ID，默认 source key 也按稳定 user ID 派生，避免不同账户或不同导入源发生全局主键冲突且不暴露用户名。金额用 Decimal 转成 minor unit，无效/重复记录只在报告中输出数量、聚合 digest、opaque ID 和错误码。每条导入会原子写入 canonical transaction、legacy raw event、关联和摘要 receipt；中断后可安全 resume。完成批次前服务端会重建 canonical 数据并复核 SHA-256。工具不会修改旧数据，也不会输出通知正文、hash、token、用户名或本机路径。

```powershell
# 默认 dry-run；报告必须放在仓库外
python scripts/migrate_dailypayguard_finance.py `
  --source <DailyPayGuard导出XML或文本> `
  --user-id <Task-12稳定用户ID> `
  --environment preview `
  --report <仓库外的task16-dry-run.json>

# Preview apply；Session 只放进进程环境变量
$env:WYJ_TASK16_MIGRATION_SESSION = '<隔离Preview管理员会话>'
python scripts/migrate_dailypayguard_finance.py `
  --source <DailyPayGuard导出XML或文本> `
  --user-id <Task-12稳定用户ID> `
  --environment preview `
  --endpoint <Task-16-Preview-URL> `
  --apply `
  --report <仓库外的task16-preview-apply.json>

# 只回滚同一 source key 导入且尚未被用户修改的记录；记录变为 tombstone
python scripts/migrate_dailypayguard_finance.py `
  --environment preview `
  --endpoint <Task-16-Preview-URL> `
  --source-key <报告中的source_key> `
  --rollback
```

Production 已在仓库外全量 D1 备份、稳定 user ID 与 Task 11～15 数量核对后应用 `0012`，财务 read/write 已开启；当时没有可导入的真实 DailyPayGuard 导出，因此 Production 财务表以零记录开始，未伪造迁移数据。旧数据导入仍必须另行执行仓库外 dry-run、异常隔离、逐批导入、重复重放和源/目标 count/digest 核对。Production 精确确认值是 `TASK16-PRODUCTION-FINANCE-MIGRATION`，但仅设置请求头仍不够；`TASK16_IMPORT_ENABLED` 与 `TASK16_PRODUCTION_IMPORT_ENABLED` 也必须由管理员短时开启，并在完成后立即关闭。发生问题时先关闭新的财务写入并导出 D1 增量，不能把 D1 和旧 SharedPreferences 双写，也不能删除旧数据来回滚。完整审计和强制场景矩阵见 `qa/TASK16_FINANCE_CORE_AUDIT.md`。

### Task 17 Web 财务账本

`/finance` 是登录后的一级功能入口，复用 Task 16 的 D1 canonical transaction、分类、预算、revision、tombstone 和增量同步协议。页面支持收入、支出、退款、新增、编辑、删除后撤销、搜索、月份/类型/分类筛选、商户、对手方、备注、月总预算和分类预算；首页只显示余额与同步摘要。Web 不实现 Android Notification Listener、SMS 或 Accessibility 采集，Android 自动识别后的 canonical transaction 通过同一 API 出现在网页。

浏览器采用账户隔离的本地队列，先保存有稳定 operation ID 和 entity ID 的修改，再调用 `/api/finance/sync`。刷新、离线或页面切换不会消费或丢失队列；恢复联网后按 revision 同步，冲突会保留本机修改并基于服务端当前 revision 重试，不会整份覆盖另一设备。删除继续使用 tombstone。退出或切换账户时只切换到对应账户命名空间，不把一名用户的账目展示给另一名用户。

`cloudflare/migrations/0013_finance_web_membership.sql` 只把已有的 `finance_monthly` 开放为第七个在售方案（8 CNY/月）并保持 `finance_access`；它不修改既有六个方案的价格、订单快照或权益。全功能包月与全功能永久继续通过合并 entitlement 自动获得财务权限，无需重复购买。充值流程仍是服务端锁定方案、价格、支付方式和私有二维码，用户“我已付款”后只进入人工审核，不会自动开通。财务会员到期后页面停止云端读取和编辑，但本机及 D1 历史账目不会被删除。

### 免费额度降级

- D1 达到免费读写额度时会拒绝查询；云状态接口标记 degraded。Task 11～15 都返回明确的可重试错误，不会回退或双写 SQLite。浏览器本地学习记录、PDF 和纯本地工具仍可使用。
- Task 12 一旦正式切到 D1 主账户，不会在 D1 故障时把认证写入回退到 SQLite；登录、注册和受保护云同步会返回明确可重试错误，避免 split-brain。静态页面、浏览器本地学习数据和纯本地工具仍可打开。
- R2 达到额度或暂时不可用时，私有付款二维码和 Task 14 文件接口返回明确可重试错误，不会暴露 object key 或回退公开文件。Task 14 会暂停新的云端上传，纯本地工具继续可用；Workers AI 仍由独立功能开关控制。
- Workers AI 达到额度或暂时不可用时，规则、词典和 cache 仍可工作；需要 AI 的请求显示“AI 暂时不可用”，登录、支付、工具和临时分享不受影响。
- telemetry 按小时、功能、结果、耗时档和错误码聚合，不逐事件持久化用户数据；超限时丢弃统计不能阻止业务。
- 任何 binding 缺失都不会让静态站点白屏；`/api/status?source=cloud` 返回 200/degraded 和具体原因。受影响操作明确提示重试，不会把错误伪装成退出登录，也不会悄悄切回本机。

### GitHub 仓库

当前仓库为 `WYJ0904/thewyj.uk`。新环境可直接克隆：

```powershell
git clone https://github.com/WYJ0904/thewyj.uk.git
```

已有本地副本可用 `git remote set-url origin https://github.com/WYJ0904/thewyj.uk.git` 更新远端。Cloudflare Pages 的 Git 集成应连接此仓库的 `main` 分支；网站域名仍为 `thewyj.uk`。

| 设置 | 值 |
| --- | --- |
| Framework preset | `None` / `Static HTML` |
| Production branch | `main` |
| Build command | 留空；控制台强制要求时填 `exit 0` |
| Build output directory | `.` |

部署步骤：

1. 推送 `main` 到 `WYJ0904/thewyj.uk`。
2. Cloudflare Pages 连接该仓库和 `main`。
3. 核对 D1 `WYJ_DB`、R2 `WYJ_STORAGE`、Workers AI `AI` bindings，以及 Task 12/14 encrypted Secrets；不要设置 `LOCAL_API_BASE`。
4. 先应用待发布的 D1 migration，再部署 Pages staged output。
5. 部署后检查 `/api/status?source=cloud`、登录持久化、英语/日语导入开考、会员与支付、临时分享、Workers AI 降级和浏览器本地 PDF。
6. 保持 Python、Ollama 和 cloudflared 停止，从另一台设备和另一网络完成最终 smoke。

Pages 发布静态根目录，不生成 `dist`。仓库不提供顶层 `404.html`，由 Cloudflare Pages 的默认 SPA 行为把未匹配导航交给根页面；不要重新加入 `/* /index.html 200`，新版 Wrangler 会把它判定为循环规则并忽略。Service Worker 缓存版本会随本次发布更新，避免持续读取旧 JS/CSS。

## 当前限制

- Production 全部正式功能均不依赖本机；历史 Python、SQLite、Ollama 与 Tunnel 仅保留仓库外备份和 test-only fixture。
- Production Task 14 普通文件为 20 MiB、视频为 30 MiB，并使用原始上传、私有 R2 流式下载和受控 Range。普通本地文件工具仍支持总计 50 MB。
- Workers AI 有每日用量、并发与超时限制；额度耗尽时只降级 AI fallback，不影响规则判卷和其他模块。
- 浏览器本地 PDF 受设备 Canvas、内存和下载权限限制；失败不会上传错题数据或回退本机服务。
- 纯浏览器图片处理能力受设备内存和浏览器 Canvas 支持影响；超大图片应分批处理。
- 简繁转换使用 OpenCC 官方字符词典并在浏览器本地执行；它是字符级转换，不包含地区词汇与上下文短语消歧。
- 工具处理内容默认不上传，服务器因此无法恢复用户未主动保存的本地处理结果。

第三方二维码实现与许可证见 `THIRD_PARTY_NOTICES.md`。
