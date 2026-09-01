import { BUSINESS_TIME_ZONE } from "./config.js?v=20260901-task19-remediation-r4";

export const $ = (id) => document.getElementById(id);

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[char]));
}

export async function writeClipboardText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(String(value));
      return true;
    } catch (_) {
      // Embedded browsers may expose the API but reject it; fall back below.
    }
  }

  const helper = document.createElement("textarea");
  helper.value = String(value);
  helper.setAttribute("readonly", "");
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  helper.style.pointerEvents = "none";
  document.body.appendChild(helper);
  helper.focus();
  helper.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (_) {
    copied = false;
  } finally {
    helper.remove();
  }
  return copied;
}

export function formatLocalDateTime(value, fallback = "无") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("zh-CN", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
