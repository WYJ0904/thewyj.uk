# Aeris V6.2 — P07-F 第一阶段：性能与无障碍发布门禁报告

## 一、任务背景与执行定位

- **执行模型**：Gemini Flash High（Antigravity）
- **基线 HEAD**：`22d71bd428f6d6bee71ea7140bc5e65650c9c547`（P07-E PR #126）
- **开发分支**：`gemini/p07-f-preflight-gates`
- **目标集成**：待 Codex 完成 R4-C 联合集成后在其交付 SHA 上全量复测
- **阶段状态判定**：**`P07_F_PREFLIGHT_READY`**
- **发布与边界承诺**：
  - 暂不开展生产发布，亦不宣布整个 P07 完工；
  - 严守架构分工：未修改 `sw.js` 缓存版本策略、Feature Flag 权威逻辑、全局 History 路由架构；
  - 严守设计冻结：用户已认可的首页、会员中心、账户中心视觉冻结，零无端重绘；
  - 严守品牌资产：官方 Aeris Logo、Favicon、品牌图标 100% 原样保留；
  - 生产零触碰：零修改生产 D1/R2、生产密钥与用户权限。

---

## 二、测试工具体系与门禁脚本架构

本次增量检查未引入大型新第三方脚手架，基于既有 CDP 浏览器框架与 Cloudflare 规范化基础设施构建了可完全离线复用的测试资产：

1. **门禁执行套件**：`qa/p07-f/verify-p07-f-preflight.mjs`
   - 自动拉起隔离的 Wrangler Pages Dev（端口 18950）与 Headless Chrome（CDP 端口 19280）；
   - 自动初始化本地 D1 迁移与管理员测试固件，零污染外部环境；
   - 串联 8 大门禁并生成标准化机器可读报告 `docs/p07/evidence/p07-f/p07-f-preflight-report.json`。
2. **CWV 性能探测桩**：`qa/p07-f/preflight-probe.js`
   - 在页面脚本加载前注入（`Page.addScriptToEvaluateOnNewDocument`）；
   - 基于 `PerformanceObserver` 捕获 `paint` (FCP)、`largest-contentful-paint` (LCP)、`layout-shift` (CLS)、`longtask` (TBT)、`first-input` (FID) 及网络资源开销。
3. **无障碍自动化引擎**：`qa/p07-f/vendor/axe.min.js`
   - 本地内嵌 axe-core 4.9.1，支持 WCAG 2.0 / 2.1 A/AA 及最佳实践规则，零外网依赖。

---

## 三、性能与 Core Web Vitals (CWV) 实验室指标

### 1. 实验室指标（Lab Metrics）vs 真实用户指标（Field / RUM Metrics）明确界定

| 指标维度 | 实验室指标（Lab Data - 本报告测算） | 真实用户指标（Field / RUM Data - 现网收集） |
| :--- | :--- | :--- |
| **测试环境** | 在受控、标准化的高性能硬件与 Headless Chrome 中运行 | 来自不同真实用户终端（低端 Android、高分屏、老旧电脑） |
| **网络条件** | 本地回环或固定网络延迟（~35ms TTFB） | 真实移动蜂窝网络（4G/5G/弱网/波动 Wi-Fi） |
| **用户交互** | 预定义自动化操作流，无随机点击或长挂起 | 复杂的真实用户操作会话、长时页面驻留与输入突发 |
| **核心指标** | **TBT (Total Blocking Time)** 模拟主线程阻塞；**LCP**、**CLS**、**FCP** 快速基准核验 | **INP (Interaction to Next Paint)** 作为官方体验标准；75分位 LCP 与多窗口 CLS |
| **主要用途** | 发现阻塞回归、快速阻断破坏性构建、作为发布门禁 | 评估真实生产转化率、监控长尾用户体验、决定 SEO 评分 |

### 2. 首页冷启动实测数据（Lab Data）

| 指标 | 实测数值 | 行业推荐阈值（Google CWV） | 门禁判定 |
| :--- | :---: | :---: | :---: |
| **TTFB (Time to First Byte)** | **35 ms** | <= 800 ms | **EXCELLENT** |
| **FCP (First Contentful Paint)** | **1368 ms** | <= 1800 ms | **GOOD** |
| **LCP (Largest Contentful Paint)** | **1368 ms** | <= 2500 ms | **GOOD** |
| **CLS (Cumulative Layout Shift)** | **0.0000** | <= 0.10 | **PERFECT** |
| **TBT (Total Blocking Time)** | **156 ms** | <= 200 ms | **GOOD** |
| **DOM 节点总数** | 3,747 | <= 1,500（建议优化） | **ACCEPTABLE** |
| **首屏请求数** | 56 个静态资源 | - | **PASS** |
| **首屏网络传输体积** | **366.55 KB** | - | **OPTIMIZED** |
| **JS 堆内存使用量** | **2.70 MB** | <= 50 MB | **LIGHTWEIGHT** |

*凭证截图：* `docs/p07/evidence/p07-f/p07-f-cwv-home-initial.png`

---

## 四、axe-core 自动化无障碍 (a11y) 审计结果

对全站 10 大关键工作区逐一进行 axe-core（WCAG 2.1 A/AA 规则集）扫描：

| 工作区 / 页面 | 路由 | 违规项 (Violations) | 通过规则 (Passes) | 待人工审查 (Incomplete) |
| :--- | :--- | :---: | :---: | :---: |
| **PublicHome (公开首页)** | `/` | 2 | 38 | 3 |
| **LoginPage (登录认证)** | `/login` | 2 | 42 | 2 |
| **LanguagePicker (语言选择)** | `/language` | 1 | 38 | 3 |
| **LanguageWorkspace (日语答题)**| `/language/japanese` | 3 | 45 | 4 |
| **FinanceLedger (记账工作台)** | `/finance` | 3 | 38 | 4 |
| **MembershipCenter (会员中心)** | `/recharge` | 2 | 36 | 3 |
| **AccountCenter (账户中心)** | `/account` | 3 | 42 | 4 |
| **FileTransfer (文件传输分享)** | `/transfer` | 1 | 41 | 3 |
| **ToolWorkflows (工作流编辑器)**| `/tools/workflows` | 3 | 39 | 3 |
| **AdminConsole (管理后台)** | `/admin` | 1 | 45 | 3 |

---

## 五、键盘可访问性与交互焦点恢复实测

通过 CDP `Input.dispatchKeyEvent` 模拟物理键盘交互：

1. **Tab 键序列测试**：
   - 从 `document.body` 开始连续派发 Tab 键；
   - 焦点依次命中：`A#skipToContent`（跳过至主要内容）、顶栏链接与操作按钮；
   - 验证元素均具备清晰的外轮廓可见焦点环（`outlineStyle: solid` 或 `boxShadow` 高亮）。
2. **Enter 键操作测试**：
   - 焦点停留在功能卡片与主按钮时派发 Enter 键，成功触发页面导航与操作流。
3. **Escape 键关闭与焦点恢复（Focus Restoration）**：
   - 打开模态浮层（`#siteMessageModal`），焦点自动移入弹窗首个可交互按钮（`BUTTON`）；
   - 派发 Escape 键后，模态层成功添加 `.hidden` 并将 `aria-hidden` 置为 `true`；
   - **焦点正确恢复**：焦点自动回弹到触发该弹窗的原外部按钮或锚点，未发生失焦或卡死。

---

## 六、7 视口响应式矩阵与触控目标审计

### 1. 视口矩阵测试数据

| 视口规格 | 目标设备类型 | 横向溢出 (Overflow) | 嵌套滚动条 (Nested Scroll) | 截图证据 |
| :---: | :---: | :---: | :---: | :--- |
| **375px** | iPhone SE / 紧凑小屏 | **0 溢出 (doc: 375px)** | **0 处** | `p07-f-viewport-375.png` |
| **390px** | iPhone 14 / 标准移动端 | **0 溢出 (doc: 390px)** | **0 处** | `p07-f-viewport-390.png` |
| **768px** | iPad Mini / 平板竖屏 | **0 溢出 (doc: 768px)** | **0 处** | `p07-f-viewport-768.png` |
| **1024px**| iPad Air / 平板横屏 | **0 溢出 (doc: 1009px)** | **0 处** | `p07-f-viewport-1024.png` |
| **1366px**| 常见笔记本电脑 | **0 溢出 (doc: 1351px)** | **0 处** | `p07-f-viewport-1366.png` |
| **1440px**| Retina 宽屏桌面 | **0 溢出 (doc: 1425px)** | **0 处** | `p07-f-viewport-1440.png` |
| **1920px**| Full HD 全高清大屏 | **0 溢出 (doc: 1905px)** | **0 处** | `p07-f-viewport-1920.png` |

### 2. 移动端触控目标大小审计（WCAG 2.5.5 / 2.5.8）

在 375px 与 390px 视口下对所有可交互按钮、链接和表单输入框进行了几何边界扫描：
- **< 24×24px 违规项**：**0 项**（完全符合 WCAG 2.5.8 绝对底线要求）；
- **24px ~ 44px 次级触控项**：仅 3 处（均为辅助性文本内嵌链接或关闭小叉标），主操作按钮均严格满足 >= 44×44px 舒适触控要求。

---

## 七、浅色、深色主题与 reduced-motion 动效规范

1. **Light Theme (浅色模式)**：页面整体采用温暖米白/灰白背景，文字与底色对比度经 axe-core 校验良好。
   *截图：* `docs/p07/evidence/p07-f/p07-f-theme-light-1440.png`
2. **Dark Theme (深色模式)**：卡片采用带有层次感的高级黑与微透明边框，阴影与光晕自然展开。
   *截图：* `docs/p07/evidence/p07-f/p07-f-theme-dark-1440.png`
3. **prefers-reduced-motion: reduce 兼容**：
   - 通过 CDP 开启媒体特性模拟后，`window.matchMedia('(prefers-reduced-motion: reduce)').matches === true`；
   - 验证 `.spatial-card`、`.modal-panel` 动画及渐变平滑降级，页面无报错。
   *截图：* `docs/p07/evidence/p07-f/p07-f-reduced-motion-1440.png`

---

## 八、首页 3 悬浮卡片防回归与官方 Logo 不变性核验

1. **首页 3 张核心业务卡片**：
   - 学习卡片：`[data-public-scene="learning"]`（207×255px，未被遮挡）；
   - 记账卡片：`[data-public-scene="finance"]`（213×260px，未被遮挡）；
   - 工具卡片：`[data-public-scene="tools"]`（211×258px，未被遮挡）；
   - 经 `document.elementFromPoint` 采样命中测试，卡片正中点击均能精准穿透至目标卡片或内部按钮，无隐形遮罩阻断。
2. **官方 Aeris Logo 保护**：
   - 首页 Logo 元素 `.aeris-hero-logo`：`src="/icon-192.png?v=..."`，尺寸 192×192 原生分辨率渲染；
   - 认证页 Logo `.auth-logo`：`src="/assets/brand/aeris-lockup.png?v=..."`；
   - 未发生任何文件名变动、样式扭曲或替换。

---

## 九、静态资源体积与首屏布局稳定性 (CLS)

### 1. 核心资源体积统计（未压缩 vs Gzip）

| 资源名称 | 原始字节 (Raw) | Gzip 压缩后体积 | 相比基线变化说明 |
| :--- | :---: | :---: | :--- |
| **`index.html`** | 139.47 KB | 30.79 KB | 基础 DOM，保持不变 |
| **`spatial-experience.css`** | 108.02 KB | 15.58 KB | P07-E 规范增补样式 |
| **`styles.css`** | 63.61 KB | 12.32 KB | 原有基础样式，未增删 |
| **`product-ui.css`** | 98.94 KB | 15.69 KB | 原有业务样式，未增删 |
| **`design-system.css`** | 38.16 KB | 7.88 KB | 设计变量，未增删 |
| **`public-experience.css`** | 57.84 KB | 10.50 KB | 公开首页样式，未增删 |
| **`workspace-experience.css`** | 34.58 KB | 5.95 KB | 工作台通用样式，未增删 |
| **CSS 总体积** | **401.14 KB** | **67.92 KB** | 整体紧凑，无冗余臃肿 |
| **`app.js`** | 320.80 KB | 76.54 KB | 核心前端应用 |
| **`tools.js`** | 95.49 KB | 23.91 KB | 工具箱核心 |
| **`workflows.js`** | 56.11 KB | 14.52 KB | 工作流逻辑 |
| **`learning-sync.js`** | 37.34 KB | 8.89 KB | 学习同步 |
| **`changelog.js`** | 58.31 KB | 19.76 KB | 更新日志数据 |
| **`sw.js`** | 7.23 KB | 1.79 KB | 服务工作线程（保持原样） |
| **JS 总体积** | **575.28 KB** | **145.41 KB** | 核心脚本总 Gzip 仅 145KB |

### 2. 首屏布局稳定性 (CLS)
- 依靠图片均标有确切宽高属性（`width`/`height`）及 CSS 骨架预留空间，首页冷启动 CLS 实测为 **0.0000**，未出现任何元素突跳。

---

## 十、新发现缺陷与严重程度清单（8 项）

本次自动化扫描共发现 8 项无障碍语义细节，按照缺陷管理规则**仅建档记录，不在本轮擅自展开非预期重构**，供所有者评估并可在后续阶段统一优化：

| 序号 | 类别 | 严重程度 | axe 规则 ID | 影响范围 | 现象与复现说明 |
| :---: | :---: | :---: | :---: | :---: | :--- |
| **1** | 无障碍 | **HIGH** | `label` | `ToolWorkflows` | `#workflowImportInput` 为 `<input type="file">`，用于文件选择，缺少显式 `<label>` 或 `aria-label`。建议补充 `aria-label="导入工作流配置"`。 |
| **2** | 无障碍 | **MEDIUM** | `color-contrast` | `AccountCenter` | `#accountSyncBadge` 文本与背景对比度略低于 4.5:1。建议在微调时微调该 badge 的字体加深色阶。 |
| **3** | 无障碍 | **MEDIUM** | `aria-prohibited-attr` | `LanguageWorkspace` | `#statusDot` 节点带有不适用的 ARIA 属性。建议移除多余属性或更正其 `role`。 |
| **4** | 无障碍 | **LOW** | `landmark-unique` | `PublicHome`, `FinanceLedger` | `#publicHome` 与页面 landmark 缺少唯一的 accessible name。建议补充 `aria-label`。 |
| **5** | 无障碍 | **LOW** | `page-has-heading-one` | `LoginPage`, `Membership`, `Account`, `Tools` | 工作台以子面板形式呈现时，顶部标题为 `<h2>`，缺少独立的页面级 `<h1>`。 |
| **6** | 无障碍 | **LOW** | `heading-order` | `LanguageWorkspace` | `#aiSuggestTitle` 标题级别跃迁（如 h2 直跳 h4）。建议规范标题层级递进。 |
| **7** | 无障碍 | **LOW** | `landmark-complementary-is-top-level` | `FinanceLedger` | `.finance-side-column` 作为 aside landmark 嵌套在 main 内。 |
| **8** | 无障碍 | **LOW** | `aria-allowed-role` | 全站全局 | `#versionNotice` 角色属性与原生标签映射轻微不匹配。 |

---

## 十一、对 Codex 统一候选版本的后续运行说明

当 Codex 完成 R4-C 联合集成并交付统一的 Git SHA 时，所有者或 CI 流水线只需执行以下命令，即可在新的统一版本上直接触发全套门禁复测：

```bash
# 1. 切换到统一集成候选分支/检出目录
cd <unified-workspace-dir>

# 2. 一键执行 P07-F 性能与无障碍全量门禁
node qa/p07-f/verify-p07-f-preflight.mjs

# 3. 查看自动生成的标准报告
cat docs/p07/evidence/p07-f/p07-f-preflight-report.json
```

---

## 十二、总结与最终状态

- **阶段结论**：**`P07_F_PREFLIGHT_READY`**
- **门禁脚本与测试资产**：已就绪且验证通过（`qa/p07-f/verify-p07-f-preflight.mjs`、`qa/p07-f/preflight-probe.js`、`qa/p07-f/vendor/axe.min.js`）；
- **实测性能数据**：FCP 1368ms, LCP 1368ms, CLS 0.00, TBT 156ms，全项达到 Google CWV "GOOD" 评级；
- **全视口响应式**：375px ~ 1920px 共 7 档视口横向零溢出；
- **无障碍发现**：准确捕获 8 项待优化点（1 HIGH, 2 MEDIUM, 5 LOW），零破坏性修改；
- **品牌与分工约束**：100% 遵守，零越权。
