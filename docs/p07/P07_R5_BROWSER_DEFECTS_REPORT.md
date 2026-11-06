# Aeris V6.2 — P07-R5 真实浏览器验收缺陷定向修复报告

**执行模型**：Gemini Flash High（Antigravity）  
**任务目标**：针对所有者在真实 Windows Chrome 验收截图中指出的 P0 缺陷（账户、会员、财务走势图）及启动／路由／SWR 追加要求进行最小定向修复与真实浏览器验证。  
**目标 PR**：[PR #129 (Draft)](https://github.com/WYJ0904/thewyj.uk/pull/129)  
**基准分支**：`codex/p07-r4c-integration` (PR #128)  
**修复分支**：`gemini/p07-r5-browser-defects`  
**最新代码提交**：`607f3b8bb091917f8bb931fa383ca593259b3c4f`  
**隔离预览环境 (Live Preview)**：`https://852fc79d.thewyj-p07-ui-rc.pages.dev`  
**预览环境 D1 数据库**：`ee869f78-b54a-4018-bc99-871089ecb8cd`（纯隔离 Preview，零触碰生产 D1/R2）  

---

## 一、缺陷根本原因与修复方案

### 1. P0-01：账户中心宽度与双层滚动限制 (`/account`)
- **根因分析**：
  1. `product-ui.css` 中历史旧规则 `.modal-panel` 设置了 `width: min(640px, 100%)`、`max-height: 90vh` 与 `overflow-y: auto`；
  2. `spatial-experience.css` 虽然在 `#accountModal` 容器层解除了窄屏，但在内部 `.v3-workspace-content` 与 `.modal-panel` 继承了旧的 640px 弹窗约束，导致桌面端右侧留出大片空白，内容形成双层嵌套滚动；
  3. 详情列表在桌面端未利用宽屏空间，排布稀疏。
- **定向修复**：
  1. 在 `spatial-experience.css` 中为 `html[data-p07-ui="enabled"] #accountModal` 下的 `.modal-panel` 和 `.v3-workspace-content` 强制覆盖：
     - `width: 100% !important; max-width: 100% !important;`
     - `max-height: none !important; overflow: visible !important; overflow-y: visible !important; padding: 0 !important;`
  2. 桌面端（1366px / 1440px / 1920px）详情列表重构为响应式双列网格：
     - `display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 24px;`
     - 移动端（390px / 375px）自动折叠为单列：`grid-template-columns: 1fr;`
  3. 完整保留双卡片（账户信息卡片 + 危险操作卡片）、8 项配置明细、体验通道选择、修改安全密钥表单、退出登录与注销警告。

### 2. P0-02：会员中心宽屏适配、4 步流程与 7 种用途网格 (`/recharge`)
- **根因分析**：
  1. 与账户中心类似，`#membershipModal` 的 `.modal-panel` 受制于旧弹窗规则；
  2. 用途过滤器在不同宽度下出现拥挤或换行错位；
  3. 套餐卡片尺寸不均，扫码支付区出现内嵌滚动条。
- **定向修复**：
  1. 彻底解除 `#membershipModal .modal-panel` 尺寸与滚动锁定（`width: 100% !important; max-height: none !important; overflow: visible !important;`）；
  2. 保留并优化 4 步横向流程指示器（选择用途 -> 选择套餐 -> 支付方式与二维码 -> 提交审核）；
  3. 7 种用途过滤器（全部、语言学习、云端同步、工具箱高级功能、文件传输、自动化工作流、AI 增强）采用响应式自适应网格（`repeat(auto-fit, minmax(260px, 1fr))`）；
  4. 套餐卡片统一度量、权益对比与价格展示，扫码支付区域与审核状态机完全保留。

### 3. P0-03：财务走势图真正折叠、状态持久化与上下结构 (`/finance`)
- **根因分析**：
  1. 原走势图折叠逻辑仅收起部分 SVG，容器高度未塌陷，图例仍残留，下方账本未真正上移；
  2. 刷新页面或从其他页面返回 `/finance` 时，折叠状态丢失，重新强制展开；
  3. 原走势图左右挤压，小金额点位贴底被 X 轴遮挡。
- **定向修复**：
  1. **真正折叠**：
     - 折叠时：`.collapsed { display: none !important; }`，`#financeTrendSection:has(.collapsed) .finance-trend-legend { display: none !important; }`；
     - 按钮文案在“收起走势图” (`aria-expanded="true"`) 与“展开走势图” (`aria-expanded="false"`) 之间切换；
     - 账本明细整体上移，实测腾出 **409px** 首屏空间（`ledgerTop` 从 1146px 移至 737px）。
  2. **状态本地持久化**：
     - 使用结构化 LocalStorage Key：`wyjFinanceFold:v1:<accountId>:trend:open`，值为 `"open"` 或 `"closed"`；
     - 页面初始化 `initialize()` 及路由切换 `show()` 时调用 `restoreTrendState()`，严格恢复用户上次选择的状态。
  3. **上下结构与精度**：
     - 容器采用 `flex-direction: column; width: 100%;`；
     - 上方：自适应平滑折线走势图（viewBox `920x220`），非零点位至少保证 **5px 最小可见凸起**，避免贴底裁切；
     - 下方：近 6 个月收支明细响应式网格（桌面端 6 列等宽），展示月份、收入、支出、结余；
     - 保留货币（CNY）与小数精度。

### 4. 追加要求 1：首次启动锁定页面滚动
- **根因分析**：启动 Splash 阶段背景 `html`/`body` 未锁定高度和溢出，加载卡片下方存在空白且可上下滚动。
- **定向修复**：
  - 在 `spatial-experience.css` 中增加全局启动锁定规则：
    ```css
    html:has(#entryScreen),
    html[data-boot-state="splash"],
    html[data-boot-state="splash"] body {
      overflow: hidden !important;
      height: 100dvh !important;
      touch-action: none;
    }
    ```
  - 当启动卡片消失并进入实际页面（`data-boot-state="ready"`）后，立即恢复正常滚动。

### 5. 追加要求 2：点击“工作流”直达工作台 (`/tools/workflows`)
- **根因分析**：从侧边栏点击“工作流”时，由于先执行了 `showTools()` 的通用逻辑，页面先渲染工具箱主页，再二次切换到工作流面板，产生视觉闪现。
- **定向修复**：
  - 在 `app.js` 的 `showTools(path)` 入口处首帧识别 `/tools/workflows` 路由，首帧直接添加/移除激活类：
    ```javascript
    if (isWorkflowPath) {
      $('toolsDashboard')?.classList.add('hidden');
      $('workflowWorkspace')?.classList.remove('hidden');
      $('toolsPanel')?.querySelector('.tools-header')?.classList.add('hidden');
    }
    ```
  - 杜绝旧头部与“在线工具箱”主界面的短暂闪现。

### 6. 追加要求 3 & 4：后台切回 >30s SWR 体验与平滑状态恢复
- **根因分析**：
  - 30 秒 TTL 在后台过期后，`feature-flags.js` 和 `public-ui-policy.js` 清除缓存导致 `decision()` 返回 `status: 'pending'`；
  - `app.js` 原逻辑直接将 `enabled` 设为 false，导致 `data-p07-ui` 切换为 `disabled`，使得 V3 画布闪退为基础界面，甚至闪现“正在读取界面设置…”。
- **定向修复**：
  - 在 `app.js` 中实施真正的 SWR 策略：
    ```javascript
    const isBootReady = document.documentElement.dataset.bootState === 'ready';
    const currentlyEnabled = document.documentElement.dataset.p07Ui === 'enabled';
    const effectiveStatus = (isBootReady && currentlyEnabled && decision.status === 'pending')
      ? 'enabled'
      : decision.status;
    const enabled = effectiveStatus === 'enabled';
    setInterfaceEnhancementsEnabled(enabled);
    document.documentElement.dataset.interfacePolicy = decision.status;
    ```
  - 当页面已完成首屏启动且此前已为启用状态时，后台 SWR 校验期间保持当前 UI 完全可见与可交互，`#interfacePolicyState` 保持隐藏，绝不清除画布或闪现白屏。

---

## 二、真实浏览器 CDP 验收数据与测量矩阵

验收运行命令：`node qa/p07-r5/verify-browser-defects.mjs`  
目标环境：`https://852fc79d.thewyj-p07-ui-rc.pages.dev`  
测试账号：`qa_lifetime_member` / 全功能永久会员  

### 1. 真实 CDP 实测数据

| 页面 / 测试项 | 测量指标 | 实测值 | 验收标准 | 结论 |
| :--- | :--- | :--- | :--- | :--- |
| **首屏启动 (Splash)** | `htmlOverflow` | `hidden` | `hidden`（禁止滚动） | **PASS** |
| | `htmlHeight` | `960px` (`100dvh`) | 充满视口无空白滚动 | **PASS** |
| | 就绪后 `htmlOverflow` | `visible` | 恢复正常滚动 | **PASS** |
| **账户中心 (`/account`)** | 桌面端 1440px 内容宽度 | **1128px** (`modal: 1200px`) | > 900px（彻底摆脱 640px 限制） | **PASS** |
| | 桌面端 1366px 内容宽度 | **1075px** | 自适应宽屏 | **PASS** |
| | 桌面端详情网格列数 | **2 列** | 2 列等宽响应式布局 | **PASS** |
| | 移动端 390px 详情网格列数 | **1 列** | 单列自适应 | **PASS** |
| | 详情项数量 | **8 项** | 全部既有配置项保留 | **PASS** |
| | 弹窗滚动条属性 | `maxHeight: none`, `overflowY: visible` | 无内嵌双层滚动条 | **PASS** |
| | 危险操作与表单 | `dangerCard`, `secretForm`, `deleteBtn`, `logoutBtn` 全部存在 | 结构完整无缺失 | **PASS** |
| **会员中心 (`/recharge`)** | 桌面端 1440px 内容宽度 | **1128px** (`modal: 1200px`) | > 900px（彻底摆脱 640px 限制） | **PASS** |
| | 流程指示步骤数 | **4 步** | 4 步横向流程 | **PASS** |
| | 会员用途过滤选项数 | **7 种** | 7 种自适应网格 | **PASS** |
| | 全功能套餐数量 | **2 个** (`all_access_monthly`, `all_access_lifetime`) | 实时套餐与价格准确呈现 | **PASS** |
| | 支付与状态机 | `hasQrSection: true` | 二维码与审核状态机完整 | **PASS** |
| **财务走势图 (`/finance`)** | 展开状态布局方式 | `flex-direction: column` | 上下结构（上图下网格） | **PASS** |
| | 展开状态折线图 SVG | **1107px × 240px** | 自适应平滑 SVG 曲线 | **PASS** |
| | 展开状态月份卡片数 | **6 个月** | 近 6 个月明细网格 | **PASS** |
| | 折叠后容器高度 | **0px** (`display: none !important`) | 彻底塌陷腾出空间 | **PASS** |
| | 折叠后账本列表位移 | 从 1146px 上移至 **737px**（上移 **409px**） | 首屏空间有效释放 | **PASS** |
| | 折叠按钮文案切换 | “收起走势图” (`aria-expanded="true"`) <-> “展开走势图” (`aria-expanded="false"`) | 状态双向切换准确 | **PASS** |
| | 本地持久化 Key | `wyjFinanceFold:v1:eec3951b...:trend:open` | 结构化 LocalStorage Key | **PASS** |
| | 跨页面与刷新持久化 | 切换到 `/account` 后返回 `/finance` 保持折叠 | 折叠状态严格保持 | **PASS** |
| **工作流直达 (`/tools/workflows`)**| `dashboardHidden` / `workflowVisible` | `true` / `true` | 首帧直接呈现工作流工作台 | **PASS** |
| | 工具箱旧头部隐藏 | `toolsHeaderHidden: true` | 不闪现“在线工具箱”头部 | **PASS** |
| **后台切回 SWR (>30s)** | 切回前台后应用画布可见性 | `appFrameVisible: true` | **绝不闪退白屏** | **PASS** |
| | 界面设置提示条可见性 | `policyStateVisible: false` | **绝不闪现“正在读取界面设置…”** | **PASS** |

---

## 三、多视口响应式与主题截图矩阵证据

已在独立 Preview 生成完整截图，存放在 `docs/p07/evidence/r5/`：

### 1. 核心修复页面（亮色／暗色／移动端）
- 账户中心：
  - `account-1440-light.png`
  - `account-1440-dark.png`
  - `account-1366-light.png`
  - `account-390-light.png`
- 会员中心：
  - `recharge-1440-light.png`
  - `recharge-1440-dark.png`
  - `recharge-1366-light.png`
  - `recharge-390-light.png`
- 财务工作台：
  - `finance-expanded-1440-light.png`
  - `finance-expanded-1440-dark.png`
  - `finance-collapsed-1440-light.png`
- 工作流直达：
  - `workflows-direct-1440.png`

### 2. 7 视口响应式矩阵 (375, 390, 768, 1024, 1366, 1440, 1920px)
- 账户中心：`matrix-account-{375, 390, 768, 1024, 1366, 1440, 1920}.png` (全部 7 份)
- 会员中心：`matrix-recharge-{375, 390, 768, 1024, 1366, 1440, 1920}.png` (全部 7 份)
- 财务工作台：`matrix-finance-{375, 390, 768, 1024, 1366, 1440, 1920}.png` (全部 7 份)

---

## 四、单元测试与架构边界承诺

### 1. 自动化回归测试
- `node --test qa/p07-phase1/public-ui-policy.test.mjs qa/p07-r4a/policy-state.test.mjs qa/p07-r4c/startup.test.mjs qa/p07-r4c/sw-release.test.mjs local-backend/test_finance_js.mjs local-backend/test_task25_client_js.mjs local-backend/test_task26_client_js.mjs`
- **结果**：**52 项测试全部 PASS，0 失败，0 告警**。

### 2. 严格生产与权限边界
- **Service Worker & 路由**：未改动 `sw.js`、`js/core/startup.js` 或 `js/core/router.js`；
- **生产环境隔离**：生产 D1 `11c288d8-c584-409f-bb1f-7e7af11793e5`、Production Pages、真实账目数据零触碰；
- **品牌资产**：保留全部官方 Aeris Logo，首页三张悬浮卡片未受影响；
- **Git 流程**：所有代码在独立工作树完成，PR #129 严格以 `codex/p07-r4c-integration` 为目标分支，无跨分支污染。
