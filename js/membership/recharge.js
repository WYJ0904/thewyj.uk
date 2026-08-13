export const DEFAULT_PAYMENT_METHODS = Object.freeze([
  Object.freeze({ code: "wechat", name: "微信支付" }),
  Object.freeze({ code: "alipay", name: "支付宝" }),
]);

export function normalizedPaymentMethod(value, methods = DEFAULT_PAYMENT_METHODS) {
  const method = String(value || "").trim().toLowerCase();
  const allowed = methods.length ? methods.map((item) => item.code) : DEFAULT_PAYMENT_METHODS.map((item) => item.code);
  return allowed.includes(method) ? method : "";
}

export function paymentMethodLabel(value, methods = DEFAULT_PAYMENT_METHODS) {
  const method = normalizedPaymentMethod(value, methods);
  return methods.find((item) => item.code === method)?.name
    || DEFAULT_PAYMENT_METHODS.find((item) => item.code === method)?.name
    || "未选择";
}

export function paymentStatusLabel(status) {
  return {
    pending_payment: "等待付款",
    user_paid: "已通知管理员，等待确认",
    processing: "管理员核对中",
    approved: "已开通",
    rejected: "已拒绝",
    expired: "订单已过期",
    cancelled: "已取消",
  }[status] || status || "未知";
}

export function rechargeStatusLabel(status) {
  return {
    pending: "待处理",
    pending_payment: "等待用户付款",
    user_paid: "用户已确认付款",
    processing: "核对处理中",
    activated: "已开通",
    approved: "已开通",
    rejected: "已拒绝",
    expired: "已过期",
    cancelled: "用户已取消",
  }[status] || status || "未知";
}
