function escapeWifiValue(value) {
  return String(value ?? "").replace(/([\\;,:"])/g, "\\$1");
}

export function buildWifiPayload({ name, security = "WPA", password = "", hidden = false } = {}) {
  const ssid = String(name ?? "");
  if (!ssid.trim()) throw new Error("请输入 Wi-Fi 网络名称");
  if (/[\r\n\0]/.test(ssid)) throw new Error("Wi-Fi 网络名称不能包含换行或空字符");
  if (new TextEncoder().encode(ssid).length > 32) throw new Error("Wi-Fi 网络名称不能超过 32 字节");
  const type = String(security || "WPA");
  if (!["WPA", "WEP", "nopass"].includes(type)) throw new Error("Wi-Fi 安全类型无效");
  let secret = String(password ?? "");
  if (/[\r\n\0]/.test(secret)) throw new Error("Wi-Fi 密码不能包含换行或空字符");
  if (type === "nopass") secret = "";
  if (type === "WPA" && !(/^([0-9a-fA-F]{64})$/.test(secret) || (Array.from(secret).length >= 8 && Array.from(secret).length <= 63))) {
    throw new Error("WPA 密码需为 8–63 个字符，或 64 位十六进制密钥");
  }
  if (type === "WEP") {
    const bytes = new TextEncoder().encode(secret).length;
    if (!([5, 13].includes(bytes) || /^(?:[0-9a-fA-F]{10}|[0-9a-fA-F]{26})$/.test(secret))) {
      throw new Error("WEP 密码需为 5 或 13 字节，或 10 或 26 位十六进制密钥");
    }
  }
  return `WIFI:T:${type};S:${escapeWifiValue(ssid)};P:${escapeWifiValue(secret)};H:${hidden ? "true" : "false"};;`;
}

function escapeVcardValue(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([;,])/g, "\\$1");
}

export function buildVcardPayload(values = {}) {
  const family = String(values.family || "").trim();
  const given = String(values.given || "").trim();
  const display = String(values.display || "").trim();
  const phone = String(values.phone || "").trim();
  const email = String(values.email || "").trim();
  const organization = String(values.organization || "").trim();
  const title = String(values.title || "").trim();
  const street = String(values.street || "").trim();
  const city = String(values.city || "").trim();
  const region = String(values.region || "").trim();
  const postal = String(values.postal || "").trim();
  const country = String(values.country || "").trim();
  const website = String(values.website || "").trim();
  const note = String(values.note || "").trim();
  if (![family, given, display, phone, email, organization, title, street, city, region, postal, country, website, note].some(Boolean)) throw new Error("请至少填写一项联系人信息");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("联系人邮箱格式不正确");
  if (website) {
    let parsed;
    try {
      parsed = new URL(website);
    } catch (_) {
      throw new Error("联系人网址格式不正确");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("联系人网址只支持 http 或 https");
  }
  const fullName = display || (family + given) || organization || phone || email;
  const addressPresent = [street, city, region, postal, country].some(Boolean);
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${escapeVcardValue(family)};${escapeVcardValue(given)};;;`,
    `FN:${escapeVcardValue(fullName)}`,
    phone && `TEL;TYPE=CELL:${escapeVcardValue(phone)}`,
    email && `EMAIL;TYPE=INTERNET:${escapeVcardValue(email)}`,
    organization && `ORG:${escapeVcardValue(organization)}`,
    title && `TITLE:${escapeVcardValue(title)}`,
    addressPresent && `ADR;TYPE=HOME:;;${escapeVcardValue(street)};${escapeVcardValue(city)};${escapeVcardValue(region)};${escapeVcardValue(postal)};${escapeVcardValue(country)}`,
    website && `URL:${escapeVcardValue(website)}`,
    note && `NOTE:${escapeVcardValue(note)}`,
    "END:VCARD",
  ].filter(Boolean).join("\r\n");
}
