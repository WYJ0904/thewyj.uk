CREATE TABLE IF NOT EXISTS task13_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task13_membership_plans (
    code TEXT PRIMARY KEY CHECK (length(code) BETWEEN 1 AND 64),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    currency TEXT NOT NULL DEFAULT 'CNY' CHECK (currency = 'CNY'),
    lifetime INTEGER NOT NULL DEFAULT 0 CHECK (lifetime IN (0, 1)),
    duration_months INTEGER NOT NULL DEFAULT 0 CHECK (duration_months BETWEEN 0 AND 1200),
    purchasable INTEGER NOT NULL DEFAULT 0 CHECK (purchasable IN (0, 1)),
    priority INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task13_membership_entitlements (
    plan_code TEXT NOT NULL,
    entitlement_code TEXT NOT NULL CHECK (length(entitlement_code) BETWEEN 1 AND 64),
    PRIMARY KEY (plan_code, entitlement_code),
    FOREIGN KEY (plan_code) REFERENCES task13_membership_plans(code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task13_user_memberships (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
    user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 80),
    plan_code TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    expires_at TEXT NOT NULL DEFAULT '',
    is_lifetime INTEGER NOT NULL DEFAULT 0 CHECK (is_lifetime IN (0, 1)),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
    source TEXT NOT NULL DEFAULT 'admin' CHECK (length(source) BETWEEN 1 AND 40),
    source_ref TEXT NOT NULL DEFAULT '' CHECK (length(source_ref) <= 120),
    created_by TEXT NOT NULL DEFAULT '' CHECK (length(created_by) <= 80),
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (length(metadata_json) <= 4000),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_code) REFERENCES task13_membership_plans(code)
);
CREATE INDEX IF NOT EXISTS idx_task13_memberships_user
ON task13_user_memberships (user_id, status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task13_memberships_source
ON task13_user_memberships (user_id, source, source_ref)
WHERE source_ref != '';

CREATE TABLE IF NOT EXISTS task13_user_entitlement_overrides (
    user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 80),
    entitlement_code TEXT NOT NULL CHECK (length(entitlement_code) BETWEEN 1 AND 64),
    allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
    note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    updated_by TEXT NOT NULL DEFAULT '' CHECK (length(updated_by) <= 80),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, entitlement_code),
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task13_payment_orders (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
    order_number TEXT NOT NULL UNIQUE CHECK (length(order_number) BETWEEN 1 AND 80),
    user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 80),
    username_snapshot TEXT NOT NULL CHECK (length(username_snapshot) BETWEEN 1 AND 80),
    plan_code TEXT NOT NULL,
    plan_name_snapshot TEXT NOT NULL CHECK (length(plan_name_snapshot) BETWEEN 1 AND 100),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    currency TEXT NOT NULL DEFAULT 'CNY' CHECK (currency = 'CNY'),
    lifetime_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_snapshot IN (0, 1)),
    duration_months_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (duration_months_snapshot BETWEEN 0 AND 1200),
    entitlements_snapshot_json TEXT NOT NULL DEFAULT '[]' CHECK (length(entitlements_snapshot_json) <= 4000),
    description_snapshot TEXT NOT NULL DEFAULT '' CHECK (length(description_snapshot) <= 500),
    trial_language TEXT NOT NULL DEFAULT '' CHECK (trial_language IN ('', 'english', 'japanese')),
    payment_method TEXT NOT NULL DEFAULT '' CHECK (payment_method IN ('', 'wechat', 'alipay')),
    qr_resource_id TEXT NOT NULL DEFAULT '' CHECK (length(qr_resource_id) <= 120),
    payment_note TEXT NOT NULL DEFAULT '' CHECK (length(payment_note) <= 500),
    status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN (
        'pending_payment', 'user_paid', 'processing', 'approved',
        'rejected', 'cancelled', 'expired'
    )),
    requested_at TEXT NOT NULL,
    expires_at TEXT NOT NULL DEFAULT '',
    user_confirmed_at TEXT NOT NULL DEFAULT '',
    processing_at TEXT NOT NULL DEFAULT '',
    handled_at TEXT NOT NULL DEFAULT '',
    handled_by TEXT NOT NULL DEFAULT '' CHECK (length(handled_by) <= 80),
    admin_note TEXT NOT NULL DEFAULT '' CHECK (length(admin_note) <= 500),
    processing_token TEXT NOT NULL DEFAULT '' CHECK (length(processing_token) <= 80),
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_code) REFERENCES task13_membership_plans(code)
);
CREATE INDEX IF NOT EXISTS idx_task13_payment_orders_user
ON task13_payment_orders (user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_task13_payment_orders_status
ON task13_payment_orders (status, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task13_one_open_order
ON task13_payment_orders (user_id)
WHERE status IN ('pending_payment', 'user_paid', 'processing');

CREATE TABLE IF NOT EXISTS task13_payment_status_history (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
    payment_order_id TEXT NOT NULL,
    from_status TEXT NOT NULL DEFAULT '' CHECK (length(from_status) <= 40),
    to_status TEXT NOT NULL CHECK (length(to_status) BETWEEN 1 AND 40),
    actor_user_id TEXT NOT NULL DEFAULT '' CHECK (length(actor_user_id) <= 80),
    actor_username TEXT NOT NULL DEFAULT '' CHECK (length(actor_username) <= 80),
    note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    created_at TEXT NOT NULL,
    FOREIGN KEY (payment_order_id) REFERENCES task13_payment_orders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task13_payment_history_order
ON task13_payment_status_history (payment_order_id, created_at, id);

CREATE TABLE IF NOT EXISTS task13_payment_fulfillments (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
    payment_order_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 80),
    plan_code TEXT NOT NULL,
    user_membership_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'payment',
    source_ref TEXT NOT NULL UNIQUE CHECK (length(source_ref) BETWEEN 1 AND 120),
    fulfilled_at TEXT NOT NULL,
    FOREIGN KEY (payment_order_id) REFERENCES task13_payment_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE,
    FOREIGN KEY (user_membership_id) REFERENCES task13_user_memberships(id)
);
CREATE INDEX IF NOT EXISTS idx_task13_fulfillments_user
ON task13_payment_fulfillments (user_id, fulfilled_at DESC);

CREATE TABLE IF NOT EXISTS task13_admin_approvals (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
    payment_order_id TEXT NOT NULL UNIQUE,
    action TEXT NOT NULL CHECK (action IN ('approve', 'reject')),
    admin_user_id TEXT NOT NULL CHECK (length(admin_user_id) BETWEEN 1 AND 80),
    admin_username TEXT NOT NULL CHECK (length(admin_username) BETWEEN 1 AND 80),
    note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    created_at TEXT NOT NULL,
    FOREIGN KEY (payment_order_id) REFERENCES task13_payment_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (admin_user_id) REFERENCES task12_users(id)
);

CREATE TABLE IF NOT EXISTS task13_admin_audit_logs (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
    actor_user_id TEXT NOT NULL CHECK (length(actor_user_id) BETWEEN 1 AND 80),
    actor_username TEXT NOT NULL CHECK (length(actor_username) BETWEEN 1 AND 80),
    target_user_id TEXT NOT NULL DEFAULT '' CHECK (length(target_user_id) <= 80),
    target_username TEXT NOT NULL DEFAULT '' CHECK (length(target_username) <= 80),
    action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
    before_json TEXT NOT NULL DEFAULT '{}' CHECK (length(before_json) <= 12000),
    after_json TEXT NOT NULL DEFAULT '{}' CHECK (length(after_json) <= 12000),
    note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    created_at TEXT NOT NULL,
    FOREIGN KEY (actor_user_id) REFERENCES task12_users(id)
);
CREATE INDEX IF NOT EXISTS idx_task13_audit_created
ON task13_admin_audit_logs (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_task13_audit_target
ON task13_admin_audit_logs (target_user_id, created_at DESC);

INSERT INTO task13_membership_plans (
    code, name, price_cents, currency, lifetime, duration_months,
    purchasable, priority, description, updated_at
) VALUES
    ('trial_single_language', '单语言包月体验会员', 800, 'CNY', 0, 1, 1, 20, '英语或日语任选一种，会员功能有效期一个月，不包含在线工具箱。', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('dual_language_monthly', '双语言包月', 2000, 'CNY', 0, 1, 1, 46, '英语和日语测试会员功能，有效期一个月，不包含在线工具箱。', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('tools_monthly', '工具箱包月会员', 2000, 'CNY', 0, 1, 1, 45, '仅在线工具箱全部功能，有效期一个月，不包含语言测试会员功能。', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('all_access_monthly', '全功能包月会员', 3000, 'CNY', 0, 1, 1, 80, '全部语言测试和在线工具箱功能，有效期一个月。', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('japanese_lifetime', '双语言双项永久会员', 7000, 'CNY', 1, 0, 1, 70, '英语和日语测试会员功能永久有效，不包含在线工具箱。', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('all_access_lifetime', '全功能永久会员', 10000, 'CNY', 1, 0, 1, 100, '全部语言测试和在线工具箱功能，永久有效。', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('dual_language_lifetime', '双语言双项永久会员', 7000, 'CNY', 1, 0, 0, 69, '仅用于兼容旧记录，不再新售；英语和日语测试会员功能永久有效，不包含在线工具箱。', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('legacy_all_monthly', '历史双语言包月会员', 1000, 'CNY', 0, 1, 0, 50, '保留改版前双语言包月权益，不包含在线工具箱。', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('legacy_all_lifetime', '历史双语言永久会员', 7000, 'CNY', 1, 0, 0, 60, '保留改版前双语言永久权益，不包含在线工具箱。', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
ON CONFLICT(code) DO UPDATE SET
    name = excluded.name,
    price_cents = excluded.price_cents,
    currency = excluded.currency,
    lifetime = excluded.lifetime,
    duration_months = excluded.duration_months,
    purchasable = excluded.purchasable,
    priority = excluded.priority,
    description = excluded.description,
    updated_at = excluded.updated_at;

DELETE FROM task13_membership_entitlements;
INSERT INTO task13_membership_entitlements (plan_code, entitlement_code) VALUES
    ('dual_language_monthly', 'language_english_access'),
    ('dual_language_monthly', 'language_japanese_access'),
    ('dual_language_monthly', 'language_all_access'),
    ('tools_monthly', 'tools_access'),
    ('tools_monthly', 'tools_batch_access'),
    ('tools_monthly', 'temporary_share_access'),
    ('tools_monthly', 'save_tool_config'),
    ('all_access_monthly', 'language_english_access'),
    ('all_access_monthly', 'language_japanese_access'),
    ('all_access_monthly', 'language_all_access'),
    ('all_access_monthly', 'tools_access'),
    ('all_access_monthly', 'tools_batch_access'),
    ('all_access_monthly', 'temporary_share_access'),
    ('all_access_monthly', 'save_tool_config'),
    ('all_access_monthly', 'all_features_access'),
    ('japanese_lifetime', 'language_english_access'),
    ('japanese_lifetime', 'language_japanese_access'),
    ('japanese_lifetime', 'language_all_access'),
    ('dual_language_lifetime', 'language_english_access'),
    ('dual_language_lifetime', 'language_japanese_access'),
    ('dual_language_lifetime', 'language_all_access'),
    ('all_access_lifetime', 'language_english_access'),
    ('all_access_lifetime', 'language_japanese_access'),
    ('all_access_lifetime', 'language_all_access'),
    ('all_access_lifetime', 'tools_access'),
    ('all_access_lifetime', 'tools_batch_access'),
    ('all_access_lifetime', 'temporary_share_access'),
    ('all_access_lifetime', 'save_tool_config'),
    ('all_access_lifetime', 'all_features_access'),
    ('legacy_all_monthly', 'language_all_access'),
    ('legacy_all_monthly', 'language_japanese_access'),
    ('legacy_all_lifetime', 'language_all_access'),
    ('legacy_all_lifetime', 'language_japanese_access');

INSERT INTO task13_metadata (key, value, updated_at)
VALUES ('schema_version', '1', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
