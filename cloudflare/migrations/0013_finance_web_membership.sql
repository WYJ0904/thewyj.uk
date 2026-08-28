INSERT INTO task13_membership_plans (
    code, name, price_cents, currency, lifetime, duration_months,
    purchasable, priority, description, updated_at
) VALUES (
    'finance_monthly',
    '财务会员',
    800,
    'CNY',
    0,
    1,
    1,
    44,
    'Web 与 Android 共用的财务账本会员，有效期一个月，不包含语言学习或在线工具箱。',
    strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
)
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

INSERT OR IGNORE INTO task13_membership_entitlements (plan_code, entitlement_code)
VALUES ('finance_monthly', 'finance_access');

UPDATE task13_membership_plans
SET description = '全部语言测试、在线工具箱和财务账本功能，有效期一个月。',
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE code = 'all_access_monthly';

UPDATE task13_membership_plans
SET description = '全部语言测试、在线工具箱和财务账本功能，永久有效。',
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE code = 'all_access_lifetime';
