import {
  cleanEmailAddress,
  cleanSingleLineText,
  DEFAULT_FROM_EMAIL,
  sendSupportAutoAckEmail,
  SUPPORT_FROM_EMAIL,
} from "./email-service.mjs";

export const MAX_INBOUND_PARSE_BYTES = 256 * 1024;
export const MAX_INBOUND_HARD_BYTES = 10 * 1024 * 1024;
export const MAX_INBOUND_EXCERPT_CHARS = 2000;
export const INBOUND_RETENTION_DAYS = 180;

const DANGEROUS_ATTACHMENT_EXT_REGEX = /\.(?:exe|bat|cmd|scr|pif|vbs|js|jse|jar|msi|ps1|hta)\b/i;

function nowIso() {
  return new Date().toISOString();
}

function addDaysIso(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function generateId(prefix) {
  if (typeof crypto?.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeErrorMessage(err, sensitiveAddress = "") {
  let msg = String(err?.message || err || "forward_failed").replace(/[\r\n\0]/g, " ");
  if (sensitiveAddress) {
    const escaped = sensitiveAddress.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    msg = msg.replace(new RegExp(escaped, "gi"), "[REDACTED_FORWARD_TARGET]");
  }
  msg = msg.replace(/[a-z0-9._%+-]+@gmail\.com/gi, "[REDACTED_EMAIL]");
  return msg.slice(0, 220);
}

function readHeaderValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") {
    return String(headers.get(name) || "");
  }
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === lower) {
      return String(v || "");
    }
  }
  return "";
}

function decodeQuotedPrintable(input) {
  const cleaned = String(input || "").replace(/=\r?\n/g, "");
  const bytes = [];
  for (let i = 0; i < cleaned.length; i += 1) {
    if (cleaned[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(cleaned.slice(i + 1, i + 3))) {
      bytes.push(parseInt(cleaned.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(cleaned.charCodeAt(i) & 0xff);
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
  } catch {
    return cleaned;
  }
}

function decodeBase64Utf8(input) {
  const b64 = String(input || "").replace(/\s+/g, "");
  if (!b64) return "";
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return input;
  }
}

export function decodeRfc2047(text) {
  return String(text || "").replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, charset, encoding, payload) => {
    const mode = String(encoding).toUpperCase();
    if (mode === "B") {
      return decodeBase64Utf8(payload);
    }
    const q = String(payload).replace(/_/g, " ");
    return decodeQuotedPrintable(q);
  });
}

async function readBoundedRawEmail(raw, maxBytes = MAX_INBOUND_PARSE_BYTES) {
  if (!raw) return { text: "", bytesRead: 0, truncated: false };
  if (typeof raw === "string") {
    const encoded = new TextEncoder().encode(raw);
    if (encoded.byteLength > maxBytes) {
      return {
        text: new TextDecoder("utf-8", { fatal: false }).decode(encoded.slice(0, maxBytes)),
        bytesRead: encoded.byteLength,
        truncated: true,
      };
    }
    return { text: raw, bytesRead: encoded.byteLength, truncated: false };
  }
  if (raw instanceof Uint8Array || raw instanceof ArrayBuffer) {
    const u8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const truncated = u8.byteLength > maxBytes;
    const slice = truncated ? u8.slice(0, maxBytes) : u8;
    return {
      text: new TextDecoder("utf-8", { fatal: false }).decode(slice),
      bytesRead: u8.byteLength,
      truncated,
    };
  }
  if (typeof raw.getReader === "function") {
    const reader = raw.getReader();
    const chunks = [];
    let total = 0;
    let truncated = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      const remaining = maxBytes - total;
      if (chunk.byteLength > remaining) {
        if (remaining > 0) chunks.push(chunk.slice(0, remaining));
        total += chunk.byteLength;
        truncated = true;
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        break;
      }
      chunks.push(chunk);
      total += chunk.byteLength;
    }
    const merged = new Uint8Array(Math.min(total, maxBytes));
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      text: new TextDecoder("utf-8", { fatal: false }).decode(merged),
      bytesRead: total,
      truncated,
    };
  }
  return { text: "", bytesRead: 0, truncated: false };
}

function parseRawMimeHeaders(headerBlock) {
  const lines = String(headerBlock || "").replace(/\r\n/g, "\n").split("\n");
  const unfolded = [];
  for (const line of lines) {
    if (/^[ \t]+/.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += " " + line.trim();
    } else if (line.trim()) {
      unfolded.push(line);
    }
  }
  const map = {};
  for (const line of unfolded) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = decodeRfc2047(line.slice(idx + 1).trim());
    if (!map[key]) map[key] = val;
  }
  return map;
}

function stripHtmlToPlainText(html) {
  return String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function decodePartBody(bodyText, transferEncoding = "") {
  const enc = String(transferEncoding || "").trim().toLowerCase();
  if (enc.includes("base64")) return decodeBase64Utf8(bodyText);
  if (enc.includes("quoted-printable")) return decodeQuotedPrintable(bodyText);
  return bodyText;
}

function extractBodyParts(rawText, topHeaders) {
  const flags = [];
  const normalized = String(rawText || "").replace(/\r\n/g, "\n");
  const sepIdx = normalized.indexOf("\n\n");
  const rawBody = sepIdx >= 0 ? normalized.slice(sepIdx + 2) : normalized;
  const contentType = String(topHeaders["content-type"] || "text/plain");
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/i);

  let chosenPlain = "";
  let chosenHtml = "";

  if (boundaryMatch) {
    const boundary = boundaryMatch[1] || boundaryMatch[2];
    const parts = rawBody.split(`--${boundary}`);
    for (const part of parts) {
      if (!part || part.trim() === "--" || part.trim() === "") continue;
      const pSep = part.indexOf("\n\n");
      if (pSep < 0) continue;
      const partHeaders = parseRawMimeHeaders(part.slice(0, pSep));
      const pContentType = String(partHeaders["content-type"] || "text/plain").toLowerCase();
      const pDisp = String(partHeaders["content-disposition"] || "");
      const pEncoding = String(partHeaders["content-transfer-encoding"] || "");
      const rawPartBody = part.slice(pSep + 2).replace(/\n--$/, "");

      if (/filename=/i.test(pDisp) || /name=/i.test(pContentType)) {
        const fnameMatch = (pDisp + " " + pContentType).match(/(?:file)?name=(?:"([^"]+)"|([^\s;]+))/i);
        const fname = fnameMatch ? (fnameMatch[1] || fnameMatch[2]) : "attachment";
        if (DANGEROUS_ATTACHMENT_EXT_REGEX.test(fname)) {
          flags.push("dangerous_attachment_blocked");
        } else {
          flags.push("attachment_stripped");
        }
        continue;
      }

      const decoded = decodePartBody(rawPartBody, pEncoding);
      if (pContentType.includes("text/plain") && !chosenPlain) {
        chosenPlain = decoded;
      } else if (pContentType.includes("text/html") && !chosenHtml) {
        if (/<script\b|javascript:|on(?:error|load|click)\s*=/i.test(decoded)) {
          flags.push("active_html_stripped");
        }
        chosenHtml = decoded;
      }
    }
  } else {
    const decoded = decodePartBody(rawBody, topHeaders["content-transfer-encoding"] || "");
    if (contentType.toLowerCase().includes("text/html")) {
      if (/<script\b|javascript:|on(?:error|load|click)\s*=/i.test(decoded)) {
        flags.push("active_html_stripped");
      }
      chosenHtml = decoded;
    } else {
      chosenPlain = decoded;
    }
  }

  let plain = chosenPlain || (chosenHtml ? stripHtmlToPlainText(chosenHtml) : "");
  if (/<script\b|javascript:|<iframe\b|on(?:error|load|click)\s*=/i.test(plain)) {
    flags.push("script_pattern_neutralized");
    plain = stripHtmlToPlainText(plain);
  }

  const sanitized = plain
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_INBOUND_EXCERPT_CHARS);

  return {
    textExcerpt: sanitized || "(空正文或仅包含附件)",
    sanitizeFlags: Array.from(new Set(flags)),
  };
}

function extractAddressAndName(rawFrom) {
  const text = String(rawFrom || "").trim();
  const angle = text.match(/^(.*?)\s*<([^<>]+)>$/);
  if (angle) {
    return {
      name: angle[1].replace(/^["']|["']$/g, "").trim().slice(0, 80),
      rawAddress: angle[2].trim(),
    };
  }
  return { name: "", rawAddress: text };
}

export function normalizeThreadSubject(subject) {
  let clean = decodeRfc2047(String(subject || "")).replace(/[\r\n\0]/g, " ").trim();
  while (/^(?:re|fwd?|fw|回复|答复|转发)\s*[:：]\s*/i.test(clean)) {
    clean = clean.replace(/^(?:re|fwd?|fw|回复|答复|转发)\s*[:：]\s*/i, "").trim();
  }
  return (clean || "(无主题)").slice(0, 180);
}

async function tableExists(db, tableName) {
  if (!db) return false;
  try {
    const row = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .bind(tableName)
      .first();
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

async function matchVerifiedUser(db, senderEmail) {
  if (!db || !senderEmail) return null;
  if (await tableExists(db, "email_center_bindings")) {
    const row = await db
      .prepare("SELECT user_id FROM email_center_bindings WHERE email = ? AND verified = 1 LIMIT 1")
      .bind(senderEmail)
      .first();
    if (row?.user_id) return row.user_id;
  }
  if (await tableExists(db, "task27_security")) {
    try {
      const sec = await db
        .prepare(
          `SELECT s.user_id
           FROM task27_security AS s
           JOIN task12_users AS u ON u.id = s.user_id
           WHERE u.deleted = 0
             AND LOWER(TRIM(s.verified_email)) = ?
             AND COALESCE(s.email_verified_at, '') <> ''
           LIMIT 1`
        )
        .bind(String(senderEmail).trim().toLowerCase())
        .first();
      if (sec?.user_id) return sec.user_id;
    } catch {
      return null;
    }
  }
  return null;
}

async function resolveThreadId(db, { senderEmail, normalizedSubject, xAerisThread, inReplyTo, referencesHeader }) {
  if (!db || !(await tableExists(db, "email_center_inbound_threads"))) {
    return generateId("thr");
  }
  if (xAerisThread) {
    const cleanTid = xAerisThread.trim().slice(0, 80);
    const existing = await db
      .prepare("SELECT thread_id FROM email_center_inbound_threads WHERE thread_id = ? LIMIT 1")
      .bind(cleanTid)
      .first();
    if (existing?.thread_id) return existing.thread_id;
  }

  const refIds = [inReplyTo, ...(String(referencesHeader || "").split(/\s+/))]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  for (const ref of refIds) {
    const msgRow = await db
      .prepare("SELECT thread_id FROM email_center_inbound_messages WHERE rfc_message_id = ? LIMIT 1")
      .bind(ref)
      .first();
    if (msgRow?.thread_id) return msgRow.thread_id;

    const dlvRow = await db
      .prepare("SELECT thread_id FROM email_center_deliveries WHERE provider_message_id = ? AND thread_id IS NOT NULL LIMIT 1")
      .bind(ref)
      .first();
    if (dlvRow?.thread_id) return dlvRow.thread_id;
  }

  const subjectMatch = await db
    .prepare(
      `SELECT thread_id FROM email_center_inbound_threads
       WHERE sender_email = ? AND normalized_subject = ?
       ORDER BY last_message_at DESC LIMIT 1`
    )
    .bind(senderEmail, normalizedSubject)
    .first();

  if (subjectMatch?.thread_id) return subjectMatch.thread_id;
  return generateId("thr");
}

function classifyInboundSecurity({
  senderEmail,
  recipientEmail,
  headers,
  sanitizeFlags,
  rawSizeBytes,
  rawTruncated,
}) {
  const autoSubmitted = String(headers["auto-submitted"] || "").trim().toLowerCase();
  const precedence = String(headers["precedence"] || "").trim().toLowerCase();
  const authResults = String(headers["authentication-results"] || "").toLowerCase();

  if (!senderEmail) {
    return { securityStatus: "rejected_invalid", autoSubmittedDetected: false };
  }
  if (
    senderEmail === DEFAULT_FROM_EMAIL ||
    senderEmail === SUPPORT_FROM_EMAIL ||
    senderEmail === recipientEmail ||
    senderEmail.startsWith("mailer-daemon@") ||
    senderEmail.startsWith("postmaster@") ||
    (autoSubmitted && autoSubmitted !== "no") ||
    ["bulk", "junk", "list", "auto_reply"].includes(precedence)
  ) {
    return { securityStatus: "auto_submitted", autoSubmittedDetected: true };
  }

  const hasDkimFail = /\bdkim=fail\b/.test(authResults);
  const hasSpfFail = /\bspf=(?:fail|softfail)\b/.test(authResults);
  if (
    (hasDkimFail && hasSpfFail) ||
    sanitizeFlags.includes("dangerous_attachment_blocked") ||
    sanitizeFlags.includes("active_html_stripped") ||
    sanitizeFlags.includes("script_pattern_neutralized")
  ) {
    return { securityStatus: "quarantined", autoSubmittedDetected: false };
  }

  if (rawSizeBytes > MAX_INBOUND_HARD_BYTES) {
    return { securityStatus: "oversize_rejected", autoSubmittedDetected: false };
  }

  if (rawTruncated) {
    sanitizeFlags.push("body_truncated_at_limit");
  }

  return { securityStatus: "ok", autoSubmittedDetected: false };
}

export async function handleInboundSupportEmail(message, env = {}, ctx = null) {
  const db = env?.WYJ_DB || null;
  const receivedAt = nowIso();
  const retentionExpiresAt = addDaysIso(INBOUND_RETENTION_DAYS);
  const inboundId = generateId("inb");
  const rawSizeBytes = Number(message?.rawSize || 0);

  if (rawSizeBytes > MAX_INBOUND_HARD_BYTES) {
    if (typeof message?.setReject === "function") {
      message.setReject("Message size exceeds limit");
    }
    return {
      ok: false,
      inbound_id: inboundId,
      security_status: "oversize_rejected",
      forward_status: "skipped_oversize",
      auto_ack_status: "skipped",
    };
  }

  const parsedRaw = await readBoundedRawEmail(message?.raw, MAX_INBOUND_PARSE_BYTES);
  const rawStr = parsedRaw.text;
  const sepIdx = rawStr.replace(/\r\n/g, "\n").indexOf("\n\n");
  const rawHeaderSection = sepIdx >= 0 ? rawStr.replace(/\r\n/g, "\n").slice(0, sepIdx) : "";
  const rawMimeHeaders = parseRawMimeHeaders(rawHeaderSection);

  const envelopeFrom = extractAddressAndName(message?.from || rawMimeHeaders.from || "");
  const headerFrom = extractAddressAndName(
    readHeaderValue(message?.headers, "from") || rawMimeHeaders.from || ""
  );

  let senderEmail = null;
  try {
    senderEmail = cleanEmailAddress(envelopeFrom.rawAddress || headerFrom.rawAddress, "from");
  } catch {
    senderEmail = null;
  }

  let recipientEmail = SUPPORT_FROM_EMAIL;
  try {
    recipientEmail = cleanEmailAddress(message?.to || readHeaderValue(message?.headers, "to") || SUPPORT_FROM_EMAIL, "to");
  } catch {
    recipientEmail = SUPPORT_FROM_EMAIL;
  }

  const combinedHeaders = {
    ...rawMimeHeaders,
    subject: decodeRfc2047(readHeaderValue(message?.headers, "subject") || rawMimeHeaders.subject || ""),
    "message-id": readHeaderValue(message?.headers, "message-id") || rawMimeHeaders["message-id"] || "",
    "in-reply-to": readHeaderValue(message?.headers, "in-reply-to") || rawMimeHeaders["in-reply-to"] || "",
    references: readHeaderValue(message?.headers, "references") || rawMimeHeaders.references || "",
    "auto-submitted": readHeaderValue(message?.headers, "auto-submitted") || rawMimeHeaders["auto-submitted"] || "",
    precedence: readHeaderValue(message?.headers, "precedence") || rawMimeHeaders.precedence || "",
    "x-aeris-thread": readHeaderValue(message?.headers, "x-aeris-thread") || rawMimeHeaders["x-aeris-thread"] || "",
    "authentication-results":
      readHeaderValue(message?.headers, "authentication-results") || rawMimeHeaders["authentication-results"] || "",
  };

  const rawSubject = cleanSingleLineText(combinedHeaders.subject || "(无主题)", {
    maxLength: 200,
    field: "subject",
    required: false,
    allowEmpty: true,
  }) || "(无主题)";
  const normalizedSubject = normalizeThreadSubject(rawSubject);

  const { textExcerpt, sanitizeFlags } = extractBodyParts(rawStr, combinedHeaders);
  const { securityStatus, autoSubmittedDetected } = classifyInboundSecurity({
    senderEmail,
    recipientEmail,
    headers: combinedHeaders,
    sanitizeFlags,
    rawSizeBytes: rawSizeBytes || parsedRaw.bytesRead,
    rawTruncated: parsedRaw.truncated,
  });

  if (securityStatus === "rejected_invalid") {
    if (typeof message?.setReject === "function") {
      message.setReject("Invalid sender address");
    }
    return {
      ok: false,
      inbound_id: inboundId,
      security_status: "rejected_invalid",
      forward_status: "skipped_invalid",
      auto_ack_status: "skipped",
    };
  }

  // Prioritize preserving existing Gmail forwarding (never log/persist private Gmail address)
  const forwardTarget = String(env?.EMAIL_FORWARD_TO_ADDRESS || "").trim();
  let forwardStatus = "not_configured";
  let forwardError = null;
  const selfLoop =
    senderEmail === DEFAULT_FROM_EMAIL ||
    senderEmail === SUPPORT_FROM_EMAIL ||
    senderEmail === recipientEmail;

  if (selfLoop) {
    forwardStatus = "skipped_loop";
  } else if (forwardTarget) {
    if (message?.canBeForwarded === false) {
      forwardStatus = "not_forwardable";
      forwardError = "message.canBeForwarded=false";
    } else if (typeof message?.forward === "function") {
      try {
        await message.forward(forwardTarget);
        forwardStatus = "forwarded";
      } catch (err) {
        forwardStatus = "forward_failed";
        forwardError = sanitizeErrorMessage(err, forwardTarget);
      }
    } else {
      forwardStatus = "forward_unavailable";
    }
  }

  const threadMatchHint = (rawSubject.match(/\[(?:Thread|会话)[:：\s]+([a-z0-9_]+)\]/i) || [])[1] || "";
  const matchedUserId = await matchVerifiedUser(db, senderEmail);
  const threadId = await resolveThreadId(db, {
    senderEmail,
    normalizedSubject,
    xAerisThread: combinedHeaders["x-aeris-thread"] || threadMatchHint,
    inReplyTo: combinedHeaders["in-reply-to"],
    referencesHeader: combinedHeaders.references,
  });

  // Optional auto acknowledgement: default disabled, never on loops or quarantined emails
  let autoAckStatus = "disabled";
  const autoAckEnabled = String(env?.EMAIL_INBOUND_AUTO_ACK_ENABLED || "").trim().toLowerCase() === "true";
  if (autoAckEnabled && securityStatus === "ok" && !autoSubmittedDetected && !selfLoop) {
    let alreadyAckedRecently = false;
    if (db && (await tableExists(db, "email_center_deliveries"))) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const recentAck = await db
        .prepare(
          `SELECT delivery_id FROM email_center_deliveries
           WHERE recipient_email = ? AND kind = 'support_auto_ack' AND created_at >= ? AND status IN ('delivered', 'queued')
           LIMIT 1`
        )
        .bind(senderEmail, since)
        .first();
      alreadyAckedRecently = Boolean(recentAck?.delivery_id);
    }

    if (alreadyAckedRecently) {
      autoAckStatus = "cooldown_skipped";
    } else {
      const ackTask = sendSupportAutoAckEmail(env, {
        to: senderEmail,
        subject: rawSubject,
        threadId,
        inReplyTo: combinedHeaders["message-id"] || undefined,
      }).then((res) => {
        autoAckStatus = res?.ok ? "sent" : "failed";
        return res;
      });
      const ackRes = await ackTask;
      autoAckStatus = ackRes?.ok ? "sent" : "failed";
    }
  } else if (autoAckEnabled) {
    autoAckStatus = "blocked_by_security_policy";
  }

  if (db && (await tableExists(db, "email_center_inbound_threads")) && (await tableExists(db, "email_center_inbound_messages"))) {
    const senderName = (headerFrom.name || envelopeFrom.name || "").slice(0, 80);
    await db
      .prepare(
        `INSERT INTO email_center_inbound_threads (
          thread_id, normalized_subject, original_subject, sender_email, sender_name,
          matched_user_id, status, message_count, last_message_at, retention_expires_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'open', 1, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          message_count = email_center_inbound_threads.message_count + 1,
          status = CASE WHEN email_center_inbound_threads.status = 'closed' THEN 'open' ELSE email_center_inbound_threads.status END,
          matched_user_id = COALESCE(email_center_inbound_threads.matched_user_id, excluded.matched_user_id),
          last_message_at = excluded.last_message_at,
          retention_expires_at = excluded.retention_expires_at,
          updated_at = excluded.updated_at`
      )
      .bind(
        threadId,
        normalizedSubject,
        rawSubject,
        senderEmail,
        senderName || null,
        matchedUserId,
        receivedAt,
        retentionExpiresAt,
        receivedAt,
        receivedAt
      )
      .run();

    const headerSummary = JSON.stringify({
      auto_submitted: combinedHeaders["auto-submitted"] || null,
      precedence: combinedHeaders.precedence || null,
      has_dkim_spf_info: Boolean(combinedHeaders["authentication-results"]),
    });

    await db
      .prepare(
        `INSERT INTO email_center_inbound_messages (
          inbound_id, thread_id, rfc_message_id, in_reply_to, references_header,
          sender_email, sender_name, recipient_email, subject, text_excerpt,
          sanitize_flags_json, security_status, raw_size_bytes, forward_status,
          forward_error, auto_ack_status, matched_user_id, header_summary_json,
          retention_expires_at, received_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        inboundId,
        threadId,
        combinedHeaders["message-id"] ? String(combinedHeaders["message-id"]).slice(0, 200) : null,
        combinedHeaders["in-reply-to"] ? String(combinedHeaders["in-reply-to"]).slice(0, 200) : null,
        combinedHeaders.references ? String(combinedHeaders.references).slice(0, 500) : null,
        senderEmail,
        senderName || null,
        recipientEmail,
        rawSubject,
        textExcerpt,
        JSON.stringify(sanitizeFlags),
        securityStatus,
        rawSizeBytes || parsedRaw.bytesRead,
        forwardStatus,
        forwardError,
        autoAckStatus,
        matchedUserId,
        headerSummary,
        retentionExpiresAt,
        receivedAt,
        receivedAt
      )
      .run();
  }

  return {
    ok: true,
    inbound_id: inboundId,
    thread_id: threadId,
    sender_email: senderEmail,
    recipient_email: recipientEmail,
    matched_user_id: matchedUserId,
    security_status: securityStatus,
    sanitize_flags: sanitizeFlags,
    forward_status: forwardStatus,
    forward_error: forwardError,
    auto_ack_status: autoAckStatus,
  };
}
