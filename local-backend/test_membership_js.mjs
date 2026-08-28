import assert from "node:assert/strict";
import {
  accountEntitlements,
  accountMembershipSummary,
  entitlementLabel,
  hasAccountEntitlement,
  isSuperAdmin,
  membershipLabel,
} from "../js/membership/account.js";
import {
  MEMBERSHIP_GOALS,
  MEMBERSHIP_PLAN_ORDER,
  membershipGoalAllowsPlan,
  membershipGoalForPlan,
  normalizedMembershipGoal,
  planDetails,
} from "../js/membership/plans.js";
import {
  DEFAULT_PAYMENT_METHODS,
  normalizedPaymentMethod,
  paymentMethodLabel,
  paymentStatusLabel,
  rechargeStatusLabel,
} from "../js/membership/recharge.js";
import { loginLocationLabel, loginReasonLabel, membershipDateValue } from "../js/admin/formatters.js";

assert.deepEqual(MEMBERSHIP_PLAN_ORDER, [
  "trial_single_language",
  "finance_monthly",
  "dual_language_monthly",
  "tools_monthly",
  "all_access_monthly",
  "japanese_lifetime",
  "all_access_lifetime",
]);
assert.equal(normalizedMembershipGoal(" tools "), "tools");
assert.equal(normalizedMembershipGoal("unknown"), "");
assert.equal(membershipGoalForPlan("trial_single_language", "japanese"), "japanese");
assert.equal(membershipGoalForPlan("dual_language_monthly"), "bilingual");
assert.equal(membershipGoalForPlan("tools_monthly"), "tools");
assert.equal(membershipGoalForPlan("finance_monthly"), "finance");
assert.equal(membershipGoalForPlan("all_access_lifetime"), "all");
assert.equal(membershipGoalAllowsPlan("tools", "tools_monthly"), true);
assert.equal(membershipGoalAllowsPlan("tools", "dual_language_monthly"), false);
assert.equal(membershipGoalAllowsPlan("finance", "finance_monthly"), true);
assert.equal(membershipGoalAllowsPlan("finance", "tools_monthly"), false);
assert.equal(MEMBERSHIP_GOALS.english.plans.includes("trial_single_language"), true);

const plans = [{ code: "tools_monthly", name: "工具箱包月会员", price: "20", currency: "CNY", description: "工具权益" }];
assert.deepEqual(planDetails(plans, "tools_monthly"), ["工具箱包月会员", "20 CNY", "工具权益"]);
assert.deepEqual(planDetails(plans, "missing"), ["请选择套餐", "", ""]);

const member = { membership: "monthly", entitlements: ["tools_access"] };
assert.deepEqual([...accountEntitlements(member)], ["tools_access"]);
assert.equal(hasAccountEntitlement("tools_access", member), true);
assert.equal(hasAccountEntitlement("language_all_access", member), false);
assert.equal(accountMembershipSummary(member).name, "历史双语言包月会员");
assert.equal(membershipLabel("japanese_lifetime"), "双语言双项永久会员");
assert.equal(membershipLabel("finance_monthly"), "财务会员");
assert.equal(entitlementLabel("temporary_share_access"), "临时分享");
assert.equal(entitlementLabel("finance_access"), "财务账本");
const admin = { username: "wyj", role: "super_admin", is_super_admin: true };
assert.equal(isSuperAdmin(admin), true);
assert.equal(hasAccountEntitlement("tools_access", admin), true);

assert.equal(normalizedPaymentMethod(" WeChat ", DEFAULT_PAYMENT_METHODS), "wechat");
assert.equal(normalizedPaymentMethod("card", DEFAULT_PAYMENT_METHODS), "");
assert.equal(paymentMethodLabel("wechat", DEFAULT_PAYMENT_METHODS), "微信支付");
assert.equal(paymentMethodLabel("alipay", DEFAULT_PAYMENT_METHODS), "支付宝");
assert.equal(paymentMethodLabel("", DEFAULT_PAYMENT_METHODS), "未选择");
assert.equal(paymentStatusLabel("pending_payment"), "等待付款");
assert.equal(paymentStatusLabel("user_paid"), "已通知管理员，等待确认");
assert.equal(rechargeStatusLabel("pending_payment"), "等待用户付款");
assert.equal(rechargeStatusLabel("approved"), "已开通");

assert.equal(loginReasonLabel("account_banned"), "账户已封禁");
assert.match(loginLocationLabel({ city: "Shenzhen", region: "Guangdong", country: "CN" }), /Shenzhen \/ Guangdong/);
assert.equal(loginLocationLabel({}), "未知网络位置");
assert.equal(membershipDateValue("invalid", () => "unexpected"), "");
assert.equal(membershipDateValue("2026-08-14T00:00:00Z", () => "2026/08/14"), "2026/08/14");

console.log("Membership/admin JS module tests passed (seven plans, entitlements, payments, admin formatters).");
