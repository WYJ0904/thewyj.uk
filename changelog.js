(() => {
  const entries = [
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
})();
