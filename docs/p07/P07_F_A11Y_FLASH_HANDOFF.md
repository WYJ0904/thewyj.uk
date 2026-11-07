# P07-F 无障碍专项交接

独立分支 `codex/p07-f-a11y-closeout`，基于 PR #130 固定 `72940bede5cff2aacd3bc3c66af5b16be40b243e`。新 Draft PR 的目标仍为 `codex/p07-r5-independent-integration`；本任务不移动 #128/#129/#130，不与 Flash 当前对 72940be 的隔离部署互相覆盖。

部署时读取新 Draft PR 的最终完整 SHA，并与最终验收评论核对。资源版本为 `20261107-aeris-p07-f-a11y-rc4`。使用既有 allowlist staging，仅部署同一提交的 HTML、CSS、JS 及版本化资源；不要混用原 RC4 文件。SW 只更新资源版本，没有缓存策略改动。

需要保留的接口与视觉合同：

- 官方 Logo、品牌文件和三个悬浮卡片原样保留。
- 登录按钮 controls 指向 `loginTabPanel` / `registerTabPanel`；原生 form ID、提交及账户业务不变。
- 既有可见标题采用 H1/H2/H3；相关 CSS 已保留人工接受的字号、行高和间距。
- 服务状态的可访问说明关联现有 `modelLabel`，保留 polite 实时反馈。
- 工作流输入仍存在且在 Tab 顺序中，由可见导入按钮提供名称，聚焦时显示行轮廓；不得重新剪除焦点或移除导入控件。
- 同步及警告标识使用既有设计 token，亮暗主题均须保持测得的合格对比度。
- 不改变 R5 的 Feature Flag、History、会话、API、业务权限或 SW 运行合同，不硬编码 ON。

专项通过不是 P07 全部完成。后续仍需明确最终集成 SHA，并在经证明隔离的 Preview 上核对公开与登录后策略、可访问名称、主题/缩放/焦点及功能；旧 72940be Preview 不能当作本次 SHA 的 Hosted PASS。提供部署 URL、部署 ID、commit hash、隔离绑定证明及安全 QA 凭据渠道，不将秘密写入报告或脚本。

保留全部 RED、axe incomplete 和无效 LCP 样本。没有 Field INP 样本则继续 NOT_TESTED；公开 hero 或 Splash 的 LCP 不替代主工作台数据。历史离线复习超时留给独立诊断，不因本次 CI 通过而关闭。不启用 AI/OCR，不发布 Production，不合并 main。
