/* Task 27 Email Center schema: independent incremental migration 0036 */

CREATE TABLE IF NOT EXISTS email_center_metadata (
  meta_key TEXT PRIMARY KEY,
  meta_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_center_bindings (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_center_bindings_email
  ON email_center_bindings(email);

CREATE INDEX IF NOT EXISTS idx_email_center_bindings_verified
  ON email_center_bindings(verified, email);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_center_bindings_verified_email_unique
  ON email_center_bindings(LOWER(email))
  WHERE verified = 1;

CREATE TABLE IF NOT EXISTS email_center_templates (
  template_id TEXT PRIMARY KEY,
  template_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  subject_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_center_templates_category
  ON email_center_templates(category, enabled);

INSERT OR IGNORE INTO email_center_templates (
  template_id, template_key, title, category, subject_template, body_template, is_system, enabled, updated_by, created_at, updated_at
) VALUES
  (
    'tpl_verification_code',
    'verification_code',
    '邮箱与二次验证验证码',
    'transactional_auth',
    'Aeris 安全验证码：{{code_label}}',
    '您好，\n\n您的 Aeris {{purpose_label}}验证码将在 {{expires_minutes}} 分钟后失效，请仅在本人发起操作时输入：\n{{code}}\n\n如果这不是您的操作，请立即检查账户安全并修改密码。',
    1,
    1,
    'system',
    '2026-11-15T00:00:00.000Z',
    '2026-11-15T00:00:00.000Z'
  ),
  (
    'tpl_password_reset_notice',
    'password_reset_notice',
    '密码重置与账户恢复通知',
    'transactional_security',
    'Aeris 安全通知：您的账户密码已重置',
    '您好 {{username}}，\n\n您的 Aeris 账户密码已完成重置或恢复。为保障账户安全，现有登录会话可能已失效，需要重新登录。\n\n若非本人或授权管理员操作，请立即联系 {{support_email}}。',
    1,
    1,
    'system',
    '2026-11-15T00:00:00.000Z',
    '2026-11-15T00:00:00.000Z'
  ),
  (
    'tpl_password_changed_notice',
    'password_changed_notice',
    '密码修改成功提醒',
    'transactional_security',
    'Aeris 安全提醒：账户密码已修改',
    '您好 {{username}}，\n\n您的 Aeris 登录密码刚刚修改成功，原有设备会话已注销，请使用新密码重新登录。\n\n如非本人操作，请立即联系 {{support_email}}。',
    1,
    1,
    'system',
    '2026-11-15T00:00:00.000Z',
    '2026-11-15T00:00:00.000Z'
  ),
  (
    'tpl_mfa_changed_notice',
    'mfa_changed_notice',
    '多因素认证（MFA）变更通知',
    'transactional_security',
    'Aeris 安全通知：双因素认证设置已更新',
    '您好 {{username}}，\n\n您的账户双因素认证（MFA）状态已发生变更：{{event_detail}}。\n\n如非本人操作，请立即通过安全中心核查会话或联系 {{support_email}}。',
    1,
    1,
    'system',
    '2026-11-15T00:00:00.000Z',
    '2026-11-15T00:00:00.000Z'
  ),
  (
    'tpl_session_security_notice',
    'session_security_notice',
    '异常登录或重要设备会话变更通知',
    'transactional_security',
    'Aeris 安全警示：设备会话与登录状态变更',
    '您好 {{username}}，\n\n系统检测到您的账户发生重要会话安全事件：{{event_detail}}。\n\n若非本人操作，请立即修改密码并在安全中心退出全部设备。',
    1,
    1,
    'system',
    '2026-11-15T00:00:00.000Z',
    '2026-11-15T00:00:00.000Z'
  ),
  (
    'tpl_membership_change_notice',
    'membership_change_notice',
    '订单与会员权益变更通知',
    'transactional_billing',
    'Aeris 服务通知：订单与会员权益已更新',
    '您好 {{username}}，\n\n您的 Aeris 会员或订单状态已更新：{{event_detail}}。\n\n如有疑问，请回复本邮件或联系 {{support_email}}。',
    1,
    1,
    'system',
    '2026-11-15T00:00:00.000Z',
    '2026-11-15T00:00:00.000Z'
  ),
  (
    'tpl_system_maintenance_notice',
    'system_maintenance_notice',
    '系统维护与必要账户服务通知',
    'admin_service',
    'Aeris 服务通知：系统维护与服务提醒',
    '您好，\n\n{{body}}\n\n如需协助，请联系 {{support_email}}。',
    0,
    1,
    'system',
    '2026-11-15T00:00:00.000Z',
    '2026-11-15T00:00:00.000Z'
  ),
  (
    'tpl_support_reply',
    'support_reply',
    '客服工单人工回复模板',
    'support_reply',
    'Re: {{subject}}',
    '您好，\n\n感谢您联系 Aeris 客服（{{support_email}}）。针对您的来信（会话 {{thread_id}}），回复如下：\n\n{{body}}\n\n如需继续沟通，请直接回复本邮件并保留主题中的会话编号。',
    0,
    1,
    'system',
    '2026-11-15T00:00:00.000Z',
    '2026-11-15T00:00:00.000Z'
  );

CREATE TABLE IF NOT EXISTS email_center_drafts (
  draft_id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  created_by_username TEXT,
  target_mode TEXT NOT NULL,
  recipient_user_ids_json TEXT NOT NULL,
  template_key TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sender_kind TEXT NOT NULL DEFAULT 'noreply',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_center_drafts_creator
  ON email_center_drafts(created_by, updated_at DESC);

CREATE TABLE IF NOT EXISTS email_center_previews (
  preview_token TEXT PRIMARY KEY,
  draft_id TEXT,
  created_by TEXT NOT NULL,
  target_mode TEXT NOT NULL,
  from_email TEXT NOT NULL,
  reply_to TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  resolved_recipients_json TEXT NOT NULL,
  recipient_count INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  confirm_required INTEGER NOT NULL DEFAULT 1,
  used_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_center_previews_creator
  ON email_center_previews(created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS email_center_deliveries (
  delivery_id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE,
  kind TEXT NOT NULL,
  channel TEXT NOT NULL,
  trigger_source TEXT NOT NULL,
  actor_user_id TEXT,
  actor_role TEXT,
  target_user_id TEXT,
  recipient_email TEXT NOT NULL,
  from_email TEXT NOT NULL,
  reply_to TEXT,
  subject TEXT NOT NULL,
  body_preview TEXT NOT NULL,
  body_redacted INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  transport TEXT,
  provider_message_id TEXT,
  error_code TEXT,
  error_message TEXT,
  retryable INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  parent_delivery_id TEXT,
  batch_id TEXT,
  thread_id TEXT,
  inbound_message_id TEXT,
  metadata_json TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_center_deliveries_created
  ON email_center_deliveries(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_center_deliveries_status
  ON email_center_deliveries(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_center_deliveries_actor
  ON email_center_deliveries(actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_center_deliveries_target
  ON email_center_deliveries(target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_center_deliveries_batch
  ON email_center_deliveries(batch_id);

CREATE INDEX IF NOT EXISTS idx_email_center_deliveries_thread
  ON email_center_deliveries(thread_id);

CREATE TABLE IF NOT EXISTS email_center_inbound_threads (
  thread_id TEXT PRIMARY KEY,
  normalized_subject TEXT NOT NULL,
  original_subject TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  sender_name TEXT,
  matched_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  message_count INTEGER NOT NULL DEFAULT 1,
  last_message_at TEXT NOT NULL,
  last_reply_at TEXT,
  last_reply_by TEXT,
  retention_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_center_inbound_threads_last
  ON email_center_inbound_threads(last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_center_inbound_threads_sender
  ON email_center_inbound_threads(sender_email);

CREATE INDEX IF NOT EXISTS idx_email_center_inbound_threads_status
  ON email_center_inbound_threads(status, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_center_inbound_threads_user
  ON email_center_inbound_threads(matched_user_id);

CREATE TABLE IF NOT EXISTS email_center_inbound_messages (
  inbound_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  rfc_message_id TEXT,
  in_reply_to TEXT,
  references_header TEXT,
  sender_email TEXT NOT NULL,
  sender_name TEXT,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  text_excerpt TEXT NOT NULL,
  sanitize_flags_json TEXT,
  security_status TEXT NOT NULL,
  raw_size_bytes INTEGER NOT NULL DEFAULT 0,
  forward_status TEXT NOT NULL,
  forward_error TEXT,
  auto_ack_status TEXT,
  matched_user_id TEXT,
  header_summary_json TEXT,
  retention_expires_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_center_inbound_messages_thread
  ON email_center_inbound_messages(thread_id, received_at ASC);

CREATE INDEX IF NOT EXISTS idx_email_center_inbound_messages_rfc
  ON email_center_inbound_messages(rfc_message_id);

CREATE INDEX IF NOT EXISTS idx_email_center_inbound_messages_sender
  ON email_center_inbound_messages(sender_email, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_center_inbound_messages_retention
  ON email_center_inbound_messages(retention_expires_at);
