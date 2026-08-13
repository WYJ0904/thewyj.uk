(() => {
  const entries = [
    {
      version: "2026.08.11.3",
      build: "2026-08-11-tool-workflows",
      date: "2026-08-11",
      title: "可配置工具工作流",
      features: ["新增本地优先的文本、CSV、图片和 ZIP 工作流，可保存、导入、导出并使用四个模板。"],
      improvements: ["批量图片逐项隔离失败，并提供步骤状态、取消运行和三种响应式布局。"],
      fixes: ["工作流配置由前后端共同执行严格版本、字段、类型和数量校验。"],
      security: ["运行、批量处理和云端配置分别复用现有会员权益，导入文件不能携带或伪造权限。"],
    },
    {
      version: "2026.08.11.2",
      build: "2026-08-11-functional-audit",
      date: "2026-08-11",
      title: "全站功能审计与工具可靠性",
      features: ["建立覆盖公开路由、用户流程、全部工具和子模式的功能审计矩阵。"],
      improvements: ["工具产物改用独立解析器验证，并补充 390px 手机端可读性检查。"],
      fixes: ["修复中文联系人二维码编码、文本分割尾部空文件和合并多余空行。"],
      security: ["持续检查敏感运行文件，并使用隔离账号、数据库和浏览器上下文执行测试。"],
    },
    {
      version: "2026.08.11.1",
      build: "2026-08-11-learning-sync",
      date: "2026-08-11",
      title: "学习数据跨设备同步",
      features: ["错题、成就、测试历史、每日目标和语言设置支持按账号增量同步。"],
      improvements: ["学习操作保持本地优先，并提供立即同步与 JSON 备份。"],
      fixes: ["删除记录通过 tombstone 防止旧设备重新恢复。"],
      security: ["同步接口按会话隔离账号，并限制记录类型、数量和大小。"],
    },
    {
      version: "2026.08.11",
      build: "2026-08-11-feedback-voting",
      date: "2026-08-11",
      title: "反馈、功能投票与支付状态一致性",
      features: ["新增登录用户反馈、管理员处理和功能建议投票。"],
      improvements: ["更新日志改为结构化数据，并在个人首页显示最新摘要。"],
      fixes: ["修复微信与支付宝订单在创建和刷新后丢失支付方式的问题。"],
      security: ["反馈接口增加字段白名单、长度限制、频率限制和隐私内容拦截。"],
    },
    {
      version: "2026.08.09",
      build: "2026-08-09-rejudge-modal",
      date: "2026-08-09",
      title: "个人首页与错题重新判定",
      features: ["登录后首页集中显示学习、会员和服务摘要。"],
      improvements: ["错题可按正式判卷规则重新作答，并在站内弹窗显示结果。"],
      fixes: ["修复答题页切换和刷新时重复推进题目的问题。"],
      security: [],
    },
    {
      version: "2026.08.02",
      build: "2026-08-02-network-resilience",
      date: "2026-08-02",
      title: "连接恢复与缓存加固",
      features: [],
      improvements: ["完善请求超时、有限重试、网络切换恢复和 Tunnel 健康判断。"],
      fixes: ["避免非关键接口失败导致整个页面无法继续使用。"],
      security: ["补充敏感运行文件检查和服务端权限回归测试。"],
    },
    {
      version: "2026.07.28",
      build: "2026-07-28-membership-tools",
      date: "2026-07-28",
      title: "会员与在线工具箱",
      features: ["提供文本、文件、图片、随机和临时工具。"],
      improvements: ["统一套餐权益展示和管理员人工充值审批。"],
      fixes: [],
      security: ["工具与临时分享接口统一执行服务端权益校验。"],
    },
  ];

  globalThis.WYJ_CHANGELOG = Object.freeze(entries.map((entry) => Object.freeze({
    ...entry,
    features: Object.freeze([...entry.features]),
    improvements: Object.freeze([...entry.improvements]),
    fixes: Object.freeze([...entry.fixes]),
    security: Object.freeze([...entry.security]),
  })));

  import("/temporary-share-fix.js?v=20260813-temp-share").catch(() => {});
})();
