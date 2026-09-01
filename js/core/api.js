import {
  API_GET_TIMEOUT_MS,
  API_TIMEOUT_MS,
  BACKEND_NETWORK_MESSAGE,
  GET_RETRYABLE_STATUS,
  STATUS_RETRY_BASE_DELAYS_MS,
} from "./config.js?v=20260901-task19-production-final";

export const CANONICAL_SESSION_ERROR_CODES = new Set([
  "authentication_required",
  "canonical_session_invalid",
  "session_expired",
  "session_revoked",
  "session_generation_invalid",
  "account_deleted",
  "account_banned",
]);

export function isCanonicalSessionFailure(payload) {
  return CANONICAL_SESSION_ERROR_CODES.has(String(payload?.code || ""));
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const { controller: suppliedController, signal: suppliedSignal, ...requestOptions } = options;
  const externalSignal = suppliedController?.signal || suppliedSignal || null;
  const controller = new AbortController();
  let timedOut = false;
  const abortFromExternal = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...requestOptions, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      const wrapped = new Error(timedOut ? "请求超时，请稍后重试" : "请求已取消");
      wrapped.name = timedOut ? "TimeoutError" : "AbortError";
      wrapped.code = timedOut ? "request_timeout" : "request_aborted";
      throw wrapped;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

export function retryDelayWithJitter(baseMilliseconds) {
  if (!baseMilliseconds) return 0;
  const jitter = Math.floor(Math.random() * Math.max(80, baseMilliseconds * 0.35));
  return baseMilliseconds + jitter;
}

export function waitForDelay(milliseconds, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error("请求已取消");
      error.name = "AbortError";
      reject(error);
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      window.clearTimeout(timer);
      const error = new Error("请求已取消");
      error.name = "AbortError";
      reject(error);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function createApiClient({
  getSession,
  backendErrorMessage,
  markBackendReachable,
  markGetReachable,
  markNetworkFailure,
  handleSessionExpired,
  handleMembershipRequired,
}) {
  async function requestJsonGet(path, options = {}) {
    const authenticated = options.authenticated === true;
    let lastError = new Error(BACKEND_NETWORK_MESSAGE);
    for (let attempt = 0; attempt < STATUS_RETRY_BASE_DELAYS_MS.length; attempt += 1) {
      const delay = retryDelayWithJitter(STATUS_RETRY_BASE_DELAYS_MS[attempt]);
      if (delay) await waitForDelay(delay, options.controller?.signal);
      let response;
      try {
        response = await fetchWithTimeout(path, {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: authenticated ? { "X-Session-Token": getSession() } : {},
          controller: options.controller,
        }, options.timeoutMs || API_GET_TIMEOUT_MS);
      } catch (networkError) {
        if (networkError?.name === "AbortError") throw networkError;
        const message = backendErrorMessage(networkError);
        markNetworkFailure(message, "get");
        lastError = new Error(message);
        if (attempt < STATUS_RETRY_BASE_DELAYS_MS.length - 1) continue;
        throw lastError;
      }

      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        markGetReachable(data);
        return data;
      }
      if (authenticated && isCanonicalSessionFailure(data)) {
        handleSessionExpired({ replace: true });
        const error = new Error(data.error || "登录已失效，请重新登录");
        error.code = data.code;
        error.status = response.status;
        throw error;
      }
      if (GET_RETRYABLE_STATUS.has(response.status) && attempt < STATUS_RETRY_BASE_DELAYS_MS.length - 1) {
        lastError = new Error("服务器正在恢复，请稍候…");
        lastError.status = response.status;
        continue;
      }
      const message = GET_RETRYABLE_STATUS.has(response.status)
        ? backendErrorMessage({ status: response.status })
        : data.error || `请求失败（HTTP ${response.status}）`;
      const error = new Error(message);
      error.code = data.code || "request_failed";
      error.status = response.status;
      throw error;
    }
    throw lastError;
  }

  async function apiGet(path, options = {}) {
    return requestJsonGet(path, { ...options, authenticated: true });
  }

  async function api(path, body = {}, options = {}) {
    let response;
    try {
      response = await fetchWithTimeout(path, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Session-Token": getSession() },
        body: JSON.stringify(body),
        controller: options.controller,
        signal: options.signal,
      }, options.timeoutMs || API_TIMEOUT_MS);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      const message = backendErrorMessage(error);
      markNetworkFailure(message, "api");
      throw new Error(message);
    }
    const data = await response.json().catch(() => ({}));
    if (response.ok || response.status < 500) markBackendReachable(data);
    if (!response.ok) {
      if (isCanonicalSessionFailure(data)) {
        handleSessionExpired();
        const error = new Error(data.error || "登录已失效，请重新登录");
        error.code = data.code;
        error.status = response.status;
        throw error;
      }
      const error = new Error(data.error || "请求失败");
      error.code = data.code || "request_failed";
      error.status = response.status;
      if (error.code === "membership_required") handleMembershipRequired();
      throw error;
    }
    return data;
  }

  function uploadApi(path, body = {}, options = {}) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const controller = options.controller || new AbortController();
      const abortRequest = () => xhr.abort();
      let completed = false;
      const finish = (callback) => {
        if (completed) return;
        completed = true;
        controller.signal.removeEventListener("abort", abortRequest);
        callback();
      };
      xhr.open("POST", path, true);
      xhr.timeout = options.timeoutMs || 180000;
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("X-Session-Token", getSession());
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && typeof options.onProgress === "function") {
          options.onProgress(Math.max(0, Math.min(1, event.loaded / event.total)), event.loaded, event.total);
        }
      };
      xhr.onload = () => finish(() => {
        let data = {};
        try { data = JSON.parse(xhr.responseText || "{}"); } catch (_error) { data = {}; }
        if (xhr.status < 500) markBackendReachable(data);
        if (xhr.status >= 200 && xhr.status < 300) {
          if (typeof options.onProgress === "function") options.onProgress(1, 1, 1);
          resolve(data);
          return;
        }
        if (isCanonicalSessionFailure(data)) handleSessionExpired();
        const error = new Error(data.error || "请求失败");
        error.code = data.code || "request_failed";
        error.status = xhr.status;
        if (error.code === "membership_required") handleMembershipRequired();
        reject(error);
      });
      xhr.onerror = () => finish(() => {
        const message = backendErrorMessage(new Error("network error"));
        markNetworkFailure(message, "upload");
        const error = new Error(message);
        error.code = "network_error";
        reject(error);
      });
      xhr.ontimeout = () => finish(() => {
        const error = new Error("上传超时，请检查网络后重试");
        error.code = "upload_timeout";
        reject(error);
      });
      xhr.onabort = () => finish(() => {
        const error = new Error("上传已取消");
        error.name = "AbortError";
        error.code = "upload_cancelled";
        reject(error);
      });
      if (controller.signal.aborted) {
        xhr.abort();
        return;
      }
      controller.signal.addEventListener("abort", abortRequest, { once: true });
      try {
        xhr.send(JSON.stringify(body));
      } catch (error) {
        finish(() => reject(error));
      }
    });
  }

  function uploadBinaryApi(path, body, options = {}) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const controller = options.controller || new AbortController();
      const abortRequest = () => xhr.abort();
      let completed = false;
      const finish = (callback) => {
        if (completed) return;
        completed = true;
        controller.signal.removeEventListener("abort", abortRequest);
        callback();
      };
      xhr.open(options.method || "PUT", path, true);
      xhr.timeout = options.timeoutMs || 600000;
      xhr.setRequestHeader("Content-Type", options.contentType || body?.type || "application/octet-stream");
      xhr.setRequestHeader("X-Session-Token", getSession());
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && typeof options.onProgress === "function") {
          options.onProgress(Math.max(0, Math.min(1, event.loaded / event.total)), event.loaded, event.total);
        }
      };
      xhr.onload = () => finish(() => {
        let data = {};
        try { data = JSON.parse(xhr.responseText || "{}"); } catch (_error) { data = {}; }
        if (xhr.status < 500) markBackendReachable(data);
        if (xhr.status >= 200 && xhr.status < 300) {
          if (typeof options.onProgress === "function") options.onProgress(1, body?.size || 1, body?.size || 1);
          resolve(data);
          return;
        }
        if (isCanonicalSessionFailure(data)) handleSessionExpired();
        const error = new Error(data.error || "上传失败");
        error.code = data.code || "request_failed";
        error.status = xhr.status;
        if (error.code === "membership_required") handleMembershipRequired();
        reject(error);
      });
      xhr.onerror = () => finish(() => {
        const message = backendErrorMessage(new Error("network error"));
        markNetworkFailure(message, "upload");
        const error = new Error(message);
        error.code = "network_error";
        reject(error);
      });
      xhr.ontimeout = () => finish(() => {
        const error = new Error("上传超时，请检查网络后重试");
        error.code = "upload_timeout";
        reject(error);
      });
      xhr.onabort = () => finish(() => {
        const error = new Error("上传已取消");
        error.name = "AbortError";
        error.code = "upload_cancelled";
        reject(error);
      });
      if (controller.signal.aborted) {
        xhr.abort();
        return;
      }
      controller.signal.addEventListener("abort", abortRequest, { once: true });
      try { xhr.send(body); } catch (error) { finish(() => reject(error)); }
    });
  }

  async function publicApi(path, body = {}, options = {}) {
    let response;
    try {
      response = await fetchWithTimeout(path, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        controller: options.controller,
      }, options.timeoutMs || API_TIMEOUT_MS);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      throw new Error(backendErrorMessage(error));
    }
    const data = await response.json().catch(() => ({}));
    if (response.ok || response.status < 500) markBackendReachable(data);
    if (!response.ok) {
      const error = new Error(data.error || "请求失败");
      error.code = data.code || "request_failed";
      error.status = response.status;
      throw error;
    }
    return data;
  }

  return Object.freeze({ api, apiGet, publicApi, requestJsonGet, uploadApi, uploadBinaryApi });
}
