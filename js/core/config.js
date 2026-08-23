export const APP_VERSION = "2026-08-23-task14-temporary-sharing";

export const API_TIMEOUT_MS = 30000;
export const AI_TIMEOUT_MS = 120000;
export const STATUS_TIMEOUT_MS = 8000;
export const STATUS_RETRY_BASE_DELAYS_MS = Object.freeze([0, 650, 1800]);
export const API_GET_TIMEOUT_MS = 10000;
export const GET_RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 530]);
export const PDF_TIMEOUT_MS = 120000;
export const BACKEND_REFRESH_INTERVAL_MS = 60 * 1000;

export const BACKEND_CONFIG_MESSAGE = "服务器代理尚未配置，请设置 Cloudflare Pages 的 LOCAL_API_BASE。";
export const BACKEND_NETWORK_MESSAGE = "暂时无法连接服务器，请检查网络后重试；微信中可关闭页面再重新打开。";
export const BUSINESS_TIME_ZONE = "Asia/Hong_Kong";
