INSERT OR IGNORE INTO payment_request_events (
    id, payment_request_id, from_status, to_status,
    actor_user_id, actor_username, note, created_at
)
SELECT
    'migration-005-payment-' || id,
    id,
    status,
    'cancelled',
    '',
    '',
    '旧订单缺少有效支付方式或二维码绑定，已关闭并允许重新创建',
    strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM payment_requests
WHERE status IN ('pending_payment', 'user_paid', 'processing')
  AND (
      payment_method NOT IN ('wechat', 'alipay')
      OR qr_resource_id != 'qr-v1:' || payment_method || ':' || plan_code
  );

UPDATE payment_requests
SET status = 'cancelled',
    cancelled_at = CASE
        WHEN cancelled_at = '' THEN strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        ELSE cancelled_at
    END,
    handled_at = CASE
        WHEN handled_at = '' THEN strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        ELSE handled_at
    END,
    admin_note = CASE
        WHEN admin_note = '' THEN '系统关闭：旧订单缺少有效支付方式或二维码绑定'
        ELSE admin_note
    END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE status IN ('pending_payment', 'user_paid', 'processing')
  AND (
      payment_method NOT IN ('wechat', 'alipay')
      OR qr_resource_id != 'qr-v1:' || payment_method || ':' || plan_code
  );

INSERT OR IGNORE INTO schema_migrations(version, applied_at)
VALUES ('005_payment_method_consistency', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
