# Aeris V6.3 Phase 7 — 网络调研、开源参考与交互映射（REFERENCE_MAPPING）

> 本文件记录 Phase 7 账户、登录注册及会员体系重构期间实际执行的公网产品参考调研、无障碍/设计规范检索与交互设计映射。所有实现均基于 Aeris 现有前端架构（原生 ES 模块、`design-system.css`、`motion.js`、`security-center.js`）独立编写，**未引入第三方身份/支付后端，未复制任何专有代码**。

---

## 一、公网调研与规范参考映射

### 1. ChatGPT（账户认证、设置分类与 Data Controls）
- **研究要点**：
  - **独立干净的认证页**：居中单列品牌标志、标题、简洁表单与唯一主按钮，页面无无关侧边工具或推广卡片干扰。
  - **设置分类结构**：将「概览 / 安全 / 数据控制 / 偏好 / 订阅」拆分为清晰分组而非单页长堆叠；`Data Controls` 中明确区分导出、隐私授权与不可逆账户注销。
- **Aeris 独立映射**：
  - `/login`、`/register`、`/forgot-password` 隐藏 `#v3Sidebar` 并以完整视口居中呈现 `#authPanel`，仅保留返回首页链接与底部政策/支持页脚。
  - `#accountModal` 重构为 6 分类选项卡（`账户概览`、`安全与登录`、`会员与权益`、`数据与隐私`、`外观与偏好`、`同步及服务状态`），在「数据与隐私」明确区分学习 JSON、Task29 加密备份、Task30 隐私管理与不可逆账户注销。

### 2. Apple Account（`account.apple.com`）& Apple Human Interface Guidelines
- **研究要点**：
  - 设备与会话管理采用「当前设备标识置顶 + 可确认客户端类型 + 活动时间 + 明确退出动作」，避免堆砌原始设备指纹或推测未知型号。
  - 控件语义与触摸尺寸遵循 ≥ 44pt 最小点击区、明确焦点环与按压即刻反馈。
- **Aeris 独立映射**：
  - 安全分类中的登录设备与会话列表突出「当前会话」标记，区分 Web 浏览器会话与 Android 客户端版本，对未知字段如实留空/标注，支持单会话撤销、退出其他设备与退出全部设备（均走 Task27 Step-up）。

### 3. Google Account（`myaccount.google.com`）& GitHub Settings（`github.com/settings/profile`）
- **研究要点**：
  - 账户概览与安全设置采用「列表行（设置名 + 当前真实状态 + 单一右侧操作）」取代重型嵌套卡片。
  - 危险操作区（Danger Zone）独立收尾，明确列出受影响数据、不可逆范围与二次确认输入/密码核验。
- **Aeris 独立映射**：
  - 账户概览与安全分类采用轻量分割线列表行呈现密码修改时间、绑定邮箱状态、2FA 状态、恢复码余量与近期安全事件；「数据与隐私」底部独立保留危险区域 `#openDeleteAccountBtn` 与 `#deleteAccountModal` 说明。

### 4. Cloudflare Dashboard & shadcn/ui（`ui.shadcn.com`）& WAI-ARIA APG
- **研究要点**：
  - 控制台级工作区导航采用全宽底线 Tabs（`role="tablist"`, `role="tab"`, `role="tabpanel"`），支持 `ArrowLeft`/`ArrowRight`/`Home`/`End` 键盘焦点切换。
  - 表单输入严格关联 `<label for>`、`aria-describedby`（绑定密码规则与行内错误）、`aria-invalid` 与 `aria-live="polite"` 异步状态播报；弹窗使用 `role="dialog"`/`role="alertdialog"`、`aria-modal="true"`、焦点锁定与 `Escape` 关闭回归焦点。
- **Aeris 独立映射**：
  - `#accountSubnav` 复刻已验收的 `.admin-tabs` / `.tf-subnav` 全宽底线标签栏与 WAI-ARIA 键盘模型，并严格对齐 `#v3MainCanvas` 居中宽度（`min(calc(100% - 48px), var(--ds-container-console))`）。

### 5. Bitwarden Clients（`github.com/bitwarden/clients`）
- **许可证核查**：`GPL-3.0` / Bitwarden Source Available（严格仅作概念层 UX 参考，零源码复制）。
- **研究要点**：
  - 密码生成器与实时强度反馈（显隐切换、安全随机生成、满足项即时勾选）、一次性恢复码「只显示一次 + 复制 + 勾选确认已保存」防误关门禁、以及本地加密导出与导入前校验边界。
- **Aeris 独立映射**：
  - 保留并增强 `password-fields.js`、`generateOwnSecret()`、`task27Secrets` 一次性恢复码确认门禁及 Task29 浏览器端 `Web Crypto AES-256-GCM` 加密备份与只读预检流水线。

### 6. ChatGPT Pricing & Upgrade Modal (`chatgpt.com/pricing`) + Stripe Customer Portal (`docs.stripe.com/customer-management`)
- **研究要点**：
  - **套餐并列比较结构**：首屏直接展示推荐方案对比卡片，名称、副标题、醒目价格/周期、全宽圆角主购买按钮、勾选权益清单与页脚说明保持统一行基准与等高对齐；明确标记「当前已拥有 / Current Plan」，底部提供全量展开入口，不强迫用户在看到价格前先填写冗长用途选择大卡片。
  - **三状态独立流程与等待审核聚焦**：选择方案后切换独立结账视口，仅聚焦已选方案、支付方式及受保护二维码（预览/离线无码时如实提示）；提交「我已付款」后聚焦等待人工审核与历史订单，严格禁止在管理员确认前伪造会员已生效。
- **Aeris 独立映射**：
  - `#membershipModal` 重构为三大互斥视图（`#membershipPlansView`、`#membershipCheckoutView`、`#membershipOrdersView`），并按第 36 项方案 A 默认呈现 4 款主流推荐对比卡、明确标注 `当前已拥有`、于卡片网格底部居中提供「查看所有套餐」直达全部 8 款方案，保留轻量化 7 类用途筛选标签、带锁未开通入口与全站顶部临近到期公告栏 `#membershipExpiryNotice`（严格豁免永久会员）。
