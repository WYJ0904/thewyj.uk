export const MEMBERSHIP_PLAN_ORDER = Object.freeze([
  "trial_single_language",
  "finance_monthly",
  "dual_language_monthly",
  "tools_monthly",
  "all_access_monthly",
  "japanese_lifetime",
  "all_access_lifetime",
]);

export const MEMBERSHIP_GOALS = Object.freeze({
  english: {
    label: "只学英语",
    description: "显示英语单语言、双语言和全功能方案。",
    trialLanguage: "english",
    plans: ["trial_single_language", "dual_language_monthly", "all_access_monthly", "japanese_lifetime", "all_access_lifetime"],
  },
  japanese: {
    label: "只学日语",
    description: "显示日语单语言、双语言和全功能方案。",
    trialLanguage: "japanese",
    plans: ["trial_single_language", "dual_language_monthly", "all_access_monthly", "japanese_lifetime", "all_access_lifetime"],
  },
  bilingual: {
    label: "英语和日语",
    description: "只显示同时包含两种语言会员功能的方案。",
    plans: ["dual_language_monthly", "all_access_monthly", "japanese_lifetime", "all_access_lifetime"],
  },
  tools: {
    label: "只用工具箱",
    description: "显示工具箱包月和包含工具箱的全功能方案。",
    plans: ["tools_monthly", "all_access_monthly", "all_access_lifetime"],
  },
  finance: {
    label: "只用财务",
    description: "显示财务会员和已包含财务权益的全功能方案。",
    plans: ["finance_monthly", "all_access_monthly", "all_access_lifetime"],
  },
  all: {
    label: "语言、工具和财务",
    description: "显示同时包含语言学习、在线工具箱与财务账本的全功能方案。",
    plans: ["all_access_monthly", "all_access_lifetime"],
  },
});

export function normalizedMembershipGoal(value) {
  const goal = String(value || "").trim();
  return Object.prototype.hasOwnProperty.call(MEMBERSHIP_GOALS, goal) ? goal : "";
}

export function membershipGoalForPlan(planCode, trialLanguage = "") {
  if (planCode === "trial_single_language") return trialLanguage === "japanese" ? "japanese" : "english";
  if (planCode === "finance_monthly") return "finance";
  if (planCode === "tools_monthly") return "tools";
  if (["dual_language_monthly", "japanese_lifetime", "dual_language_lifetime"].includes(planCode)) return "bilingual";
  if (["all_access_monthly", "all_access_lifetime", "legacy_all_monthly", "legacy_all_lifetime"].includes(planCode)) return "all";
  return "";
}

export function membershipGoalAllowsPlan(goal, planCode) {
  const config = MEMBERSHIP_GOALS[normalizedMembershipGoal(goal)];
  return Boolean(config?.plans.includes(planCode));
}

export function planDetails(plans, planCode) {
  const item = plans.find((candidate) => candidate.code === planCode);
  return item
    ? [item.name, `${item.price} ${item.currency}`, item.description]
    : ["请选择套餐", "", ""];
}
