const MEMBERSHIP_LABELS = Object.freeze({
  free: "普通用户",
  trial_single_language: "单语言包月体验会员",
  monthly: "历史双语言包月会员",
  lifetime: "历史双语言永久会员",
  legacy_all_monthly: "历史双语言包月会员",
  legacy_all_lifetime: "历史双语言永久会员",
  japanese_lifetime: "双语言双项永久会员",
  tools_monthly: "工具箱包月会员",
  dual_language_monthly: "双语言包月",
  dual_language_lifetime: "双语言双项永久会员",
  finance_monthly: "财务会员",
  all_access_monthly: "全功能包月会员",
  all_access_lifetime: "全功能永久会员",
  super_admin: "超级管理员",
});

const ENTITLEMENT_LABELS = Object.freeze({
  language_japanese_access: "日语会员功能",
  language_english_access: "英语会员功能",
  language_all_access: "全部语言会员功能",
  tools_access: "在线工具箱",
  tools_batch_access: "批量处理",
  temporary_share_access: "临时分享",
  save_tool_config: "保存工具配置",
  finance_access: "财务账本",
  all_features_access: "全部高级功能",
});

export function membershipLabel(value) {
  return MEMBERSHIP_LABELS[value] || "普通用户";
}

export function entitlementLabel(code) {
  return ENTITLEMENT_LABELS[code] || code;
}

export function accountEntitlements(account) {
  return new Set(Array.isArray(account?.entitlements) ? account.entitlements : []);
}

export function isSuperAdmin(account) {
  return Boolean(
    account && account.username === "wyj" && account.role === "super_admin" && account.is_super_admin === true,
  );
}

export function hasAccountEntitlement(code, account) {
  return isSuperAdmin(account) || accountEntitlements(account).has(code);
}

export function accountMembershipSummary(account) {
  if (!account) return { code: "free", name: "未登录", permanent: false, expires_at: "", tools_access: false };
  return account.membership_summary || {
    code: account.membership || "free",
    name: membershipLabel(account.membership),
    permanent: account.membership === "lifetime",
    expires_at: account.membership_expires || "",
    tools_access: Boolean(account.tools_access),
  };
}
