export const APP_VERSION = "2026-09-04-task20-android-preview";
export const ASSET_RELEASE = "20260904-task20-android-r1";

export const API_TIMEOUT_MS = 30000;
export const AI_TIMEOUT_MS = 25000;
export const STATUS_TIMEOUT_MS = 8000;
export const STATUS_RETRY_BASE_DELAYS_MS = Object.freeze([0, 650, 1800]);
export const API_GET_TIMEOUT_MS = 10000;
export const GET_RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 530]);
export const BACKEND_REFRESH_INTERVAL_MS = 60 * 1000;

export const BACKEND_NETWORK_MESSAGE = "暂时无法连接 Cloudflare 云端服务，请检查网络后重试；当前本地数据不会丢失。";
export const BUSINESS_TIME_ZONE = "Asia/Hong_Kong";
