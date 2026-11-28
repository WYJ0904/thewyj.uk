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

### 6. ChatGPT Pricing & Upgrade (`chatgpt.com/pricing` & 参考录屏对比) + ChatGPT Two-Column Checkout (`chatgpt.com/checkout`)
- **研究要点**：
  - **GPT Pro 式卡内切换与纯净画布**：默认以宽敞画布并排展示 3 张核心对比卡（绝不在桌面端意外换行成 2+1），将同类变体收拢于高对比度浅/深色卡片顶部滑块切换器（如 `单语言 | 通知保存 | 财务`、`包月 | 永久` 及内置 `英语 | 日语`）；点击「查看所有套餐」在同一桌面水平行通过 FLIP 平滑扩展为 4 列（`[single, tools, bilingual, all]`），「查看完整权益」统一采用对钩列表且仅展开卡自身增长，不影响兄弟卡片留白。
  - **ChatGPT 两栏独立结账与协议门禁**：点击购买后脱离方案列表进入两栏结账：左栏放返回导航、档位切换与支付方式选择器，并设未默认勾选的支付协议确认及协议说明弹窗；右栏用独立高对比摘要卡片承接方案摘要、关键权益、金额明细、全宽确认按钮与人工审核提示，避免自动续费或虚假扣款文案。
  - **专注等待审核与订单管理**：会员现状卡、历史订单及待审核进度集中于「订单管理」分类，页签名称保持静态稳定，人工审核确认前严禁显示会员已生效。
- **Aeris 独立映射**：
  - `#membershipModal` 重构为纯净 3 态切换（`#membershipPlansView`、`#membershipCheckoutView`、`#membershipOrdersView`），严格按第 36 项方案 A 与最终整改规范落地固定 3 列桌面对比、CSP 安全属性滑块切换、页内平滑展开 `双语言套餐`（全部 8 套餐完整可达）、两栏结账 + `#paymentAgreementModal` 同意门禁、顶部临近到期公告 `#membershipExpiryNotice`（豁免永久会员）与订单管理聚焦视图。
