const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "expect",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const NO_BODY_METHODS = new Set(["GET", "HEAD"]);
const RETRYABLE_STATUS = new Set([502, 503, 504, 530]);
const MAX_PROXY_BODY_BYTES = 600 * 1024;
const MAX_TEMP_FILE_BYTES = 30 * 1024 * 1024;
const LEGACY_MAX_TEMP_FILE_PROXY_BODY_BYTES = 28 * 1024 * 1024;
const MAX_TEMP_FILE_PROXY_BODY_BYTES = Math.max(LEGACY_MAX_TEMP_FILE_PROXY_BODY_BYTES, 42 * 1024 * 1024);
const IDEMPOTENT_RETRY_BASE_DELAYS_MS = [0, 250, 900];
const UPSTREAM_GET_TIMEOUT_MS = 10000;
const UPSTREAM_DEFAULT_TIMEOUT_MS = 30000;
const UPSTREAM_AI_TIMEOUT_MS = 125000;
const UPSTREAM_VOCABULARY_TIMEOUT_MS = 245000;
const UPSTREAM_UPLOAD_TIMEOUT_MS = 185000;
const UPSTREAM_PREFLIGHT_TIMEOUT_MS = 4500;
const TEMP_FILE_PRESELECT_PATHS = new Set([
  "/api/temporary/file",
  "/api/share/file/read",
]);
const CLIENT_CONTEXT_HEADERS = new Set([
  "x-wyj-proxy",
  "x-wyj-client-ip",
  "x-wyj-client-country",
  "x-wyj-client-region",
  "x-wyj-client-city",
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function downloadError(message, status = 400) {
  return new Response(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>下载失败</title></head><body data-download-error="true"><p>${escapeHtml(message || "下载失败")}</p></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

function normalizeBase(value) {
  const base = String(value || "").trim();
  if (!base) return "";

  const url = new URL(base);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("LOCAL_API_BASE must start with http:// or https://");
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

function joinPaths(basePath, requestPath) {
  const cleanBase = basePath.replace(/\/+$/, "");
  const cleanRequest = requestPath.startsWith("/") ? requestPath : `/${requestPath}`;
  return `${cleanBase}${cleanRequest}` || "/";
}

function targetUrlFor(request, base) {
  const incoming = new URL(request.url);
  const target = new URL(base.toString());
  target.pathname = joinPaths(base.pathname, incoming.pathname);
  target.search = incoming.search;
  return target;
}

function targetPathFor(base, pathname) {
  const target = new URL(base.toString());
  target.pathname = joinPaths(base.pathname, pathname);
  target.search = "";
  target.hash = "";
  return target;
}

function uniqueBases(items) {
  const seen = new Set();
  return items.filter((base) => {
    const key = base.toString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function configuredBases(env) {
  const rawBases = [
    env.LOCAL_API_BASE || env.VOCAB_LOCAL_API_BASE,
    env.LOCAL_API_FALLBACK || env.VOCAB_LOCAL_API_FALLBACK,
  ].filter(Boolean);
  return uniqueBases(rawBases.map((base) => normalizeBase(base)));
}

function encodedContextHeader(value, maxLength = 120) {
  return encodeURIComponent(String(value || "").slice(0, maxLength));
}

function requestHeadersFor(request, requestContext = {}) {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const normalized = key.toLowerCase();
    if (!HOP_BY_HOP_HEADERS.has(normalized) && !CLIENT_CONTEXT_HEADERS.has(normalized)) {
      headers.set(key, value);
    }
  });
  headers.set("X-Forwarded-Host", new URL(request.url).host);
  headers.set("X-Forwarded-Proto", "https");
  headers.set("X-Forwarded-For", request.headers.get("CF-Connecting-IP") || "");
  headers.set("X-WYJ-Proxy", "pages");
  headers.set("X-WYJ-Client-IP", encodedContextHeader(request.headers.get("CF-Connecting-IP"), 80));
  headers.set("X-WYJ-Client-Country", encodedContextHeader(requestContext.country || request.headers.get("CF-IPCountry"), 80));
  headers.set("X-WYJ-Client-Region", encodedContextHeader(requestContext.region || requestContext.regionCode, 120));
  headers.set("X-WYJ-Client-City", encodedContextHeader(requestContext.city, 120));
  return headers;
}

function responseHeadersFor(response) {
  const headers = new Headers(response.headers);
  for (const name of HOP_BY_HOP_HEADERS) {
    headers.delete(name);
  }
  headers.set("Cache-Control", "no-store");
  return headers;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelayWithJitter(baseMilliseconds) {
  if (!baseMilliseconds) return 0;
  return baseMilliseconds + Math.floor(Math.random() * Math.max(50, baseMilliseconds * 0.35));
}

function upstreamTimeoutFor(requestPath, method) {
  if (requestPath === "/api/vocabulary/suggest") return UPSTREAM_VOCABULARY_TIMEOUT_MS;
  if (["/api/temporary/file", "/api/share/file/download"].includes(requestPath)) return UPSTREAM_UPLOAD_TIMEOUT_MS;
  if (["/api/judge", "/api/rubric", "/api/japanese/readings", "/api/export-pdf"].includes(requestPath)) {
    return UPSTREAM_AI_TIMEOUT_MS;
  }
  if (NO_BODY_METHODS.has(method)) return UPSTREAM_GET_TIMEOUT_MS;
  return UPSTREAM_DEFAULT_TIMEOUT_MS;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function probeBase(base) {
  const target = targetPathFor(base, "/api/status");
  try {
    const response = await fetchWithTimeout(target.toString(), {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "application/json" },
    }, UPSTREAM_PREFLIGHT_TIMEOUT_MS);
    const usable = response.status < 500;
    if (response.body) await response.body.cancel().catch(() => {});
    return usable;
  } catch (_) {
    return false;
  }
}

async function selectHealthyBase(bases) {
  if (bases.length <= 1) return bases[0];
  for (const base of bases) {
    if (await probeBase(base)) return base;
  }
  await sleep(250);
  for (const base of bases) {
    if (await probeBase(base)) return base;
  }
  return bases[0];
}

function base64Bytes(value) {
  const encoded = String(value || "");
  if (!encoded) return new Uint8Array();
  const padding = encoded.endsWith("==") ? 2 : (encoded.endsWith("=") ? 1 : 0);
  const outputLength = Math.floor(encoded.length / 4) * 3 - padding;
  const output = new Uint8Array(outputLength);
  const chunkSize = 4 * 1024 * 1024;
  let outputOffset = 0;
  for (let offset = 0; offset < encoded.length; offset += chunkSize) {
    const end = Math.min(encoded.length, offset + chunkSize);
    const binary = atob(encoded.slice(offset, end));
    for (let index = 0; index < binary.length; index += 1) {
      output[outputOffset++] = binary.charCodeAt(index);
    }
  }
  return output;
}

function attachmentHeaders(file) {
  const fileName = String(file?.file_name || "download").replace(/[\r\n]/g, "").slice(0, 120) || "download";
  const fallback = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "download";
  return {
    "Content-Type": String(file?.mime_type || "application/octet-stream"),
    "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };
}

async function handleTemporaryFileDownload(context, bases) {
  const { request } = context;
  let form;
  try {
    form = await request.formData();
  } catch (_) {
    return downloadError("下载请求格式无效", 400);
  }
  const id = String(form.get("id") || "").trim();
  const password = String(form.get("password") || "");
  if (!id || id.length > 240 || password.length > 1000) {
    return downloadError("下载参数无效", 400);
  }

  const base = await selectHealthyBase(bases);
  const target = targetPathFor(base, "/api/share/file/read");
  const headers = requestHeadersFor(request, request.cf || context.cf || {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Accept", "application/json");

  let upstream;
  try {
    upstream = await fetchWithTimeout(target.toString(), {
      method: "POST",
      headers,
      redirect: "manual",
      body: JSON.stringify({ id, password }),
    }, UPSTREAM_UPLOAD_TIMEOUT_MS);
  } catch (_) {
    return downloadError("临时文件服务暂时不可达，请稍后重试", 502);
  }

  let payload;
  try {
    payload = await upstream.json();
  } catch (_) {
    return downloadError("临时文件服务返回了无效响应", 502);
  }
  if (!upstream.ok || !payload?.file?.base64) {
    return downloadError(payload?.error || "文件不存在、已过期或密码错误", upstream.status || 400);
  }

  let bytes;
  try {
    bytes = base64Bytes(payload.file.base64);
  } catch (_) {
    return downloadError("文件内容解码失败，请重新下载", 502);
  }
  if (!bytes.byteLength || bytes.byteLength > MAX_TEMP_FILE_BYTES) {
    return downloadError("文件内容大小无效", 502);
  }
  const headersOut = new Headers(attachmentHeaders(payload.file));
  headersOut.set("Content-Length", String(bytes.byteLength));
  return new Response(bytes, { status: 200, headers: headersOut });
}

export async function onRequest(context) {
  const { env, request } = context;

  let bases;
  try {
    bases = configuredBases(env);
  } catch (error) {
    return json({ ok: false, error: error.message }, 500);
  }

  if (!bases.length) {
    return json(
      {
        ok: false,
        error: "LOCAL_API_BASE is not configured. Start the local backend and set this to the Cloudflare Tunnel URL.",
      },
      503,
    );
  }

  const requestPath = new URL(request.url).pathname;
  if (requestPath === "/api/share/file/download" && request.method.toUpperCase() === "POST") {
    return handleTemporaryFileDownload(context, bases);
  }

  const maxBodyBytes = requestPath === "/api/temporary/file" ? MAX_TEMP_FILE_PROXY_BODY_BYTES : MAX_PROXY_BODY_BYTES;
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > maxBodyBytes) {
    return json({ ok: false, error: requestPath === "/api/temporary/file" ? "请求内容过大，视频最大支持 30 MB，其他临时文件仍为 20 MB。" : "请求内容过大。" }, 413);
  }

  const method = request.method.toUpperCase();
  const idempotent = NO_BODY_METHODS.has(method);
  const body = idempotent ? undefined : await request.arrayBuffer();
  if (body && body.byteLength > maxBodyBytes) {
    return json({ ok: false, error: requestPath === "/api/temporary/file" ? "请求内容过大，视频最大支持 30 MB，其他临时文件仍为 20 MB。" : "请求内容过大。" }, 413);
  }
  const rounds = idempotent ? IDEMPOTENT_RETRY_BASE_DELAYS_MS : [0];
  let candidateBases;
  if (!idempotent && TEMP_FILE_PRESELECT_PATHS.has(requestPath)) {
    candidateBases = [await selectHealthyBase(bases)];
  } else {
    candidateBases = idempotent ? bases : bases.slice(0, 1);
  }
  const timeoutMs = upstreamTimeoutFor(requestPath, method);
  for (let round = 0; round < rounds.length; round += 1) {
    const delay = retryDelayWithJitter(rounds[round]);
    if (delay) await sleep(delay);
    for (let baseIndex = 0; baseIndex < candidateBases.length; baseIndex += 1) {
      const base = candidateBases[baseIndex];
      const target = targetUrlFor(request, base);
      const init = {
        method: request.method,
        headers: requestHeadersFor(request, request.cf || context.cf || {}),
        redirect: "manual",
      };
      if (body) init.body = body;
      const hasMoreAttempts = round < rounds.length - 1 || baseIndex < candidateBases.length - 1;
      try {
        const response = await fetchWithTimeout(target.toString(), init, timeoutMs);
        if (hasMoreAttempts && RETRYABLE_STATUS.has(response.status)) {
          if (response.body) await response.body.cancel().catch(() => {});
          continue;
        }
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeadersFor(response),
        });
      } catch (_) {
        // GET/HEAD may continue to a fallback; writes are deliberately never replayed.
      }
    }
  }

  return json(
    {
      ok: false,
      error: "Could not reach the local backend through configured Cloudflare Tunnel URLs.",
      code: "upstream_unreachable",
      retryable: true,
    },
    502,
  );
}

export const __testing = {
  configuredBases,
  fetchWithTimeout,
  retryDelayWithJitter,
  upstreamTimeoutFor,
  selectHealthyBase,
  base64Bytes,
};
