export function loginReasonLabel(reason) {
  return {
    success: "登录成功",
    invalid_credentials: "用户名或密钥错误",
    account_banned: "账户已封禁",
    login_rate_limited: "请求过于频繁",
  }[reason] || reason || "登录失败";
}

export function loginLocationLabel(log, locale = "zh-CN") {
  let country = String(log?.country || "").toUpperCase();
  if (/^[A-Z]{2}$/.test(country) && typeof Intl.DisplayNames === "function") {
    try {
      country = new Intl.DisplayNames([locale], { type: "region" }).of(country) || country;
    } catch (_) {
      // Older WebViews retain the ISO country code.
    }
  }
  return [...new Set([log?.city, log?.region, country].map((item) => String(item || "").trim()).filter(Boolean))].join(" / ") || "未知网络位置";
}

export function membershipDateValue(value, formatDate) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : formatDate(parsed);
}
