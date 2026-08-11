UPDATE payment_requests
SET status = (
        SELECT event.from_status
        FROM payment_request_events AS event
        WHERE event.id = 'migration-005-payment-' || payment_requests.id
    ),
    cancelled_at = '',
    handled_at = '',
    admin_note = CASE
        WHEN admin_note = '系统关闭：旧订单缺少有效支付方式或二维码绑定' THEN ''
        ELSE admin_note
    END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE status = 'cancelled'
  AND EXISTS (
      SELECT 1
      FROM payment_request_events AS event
      WHERE event.id = 'migration-005-payment-' || payment_requests.id
  )
  AND NOT EXISTS (
      SELECT 1
      FROM payment_requests AS other
      WHERE other.user_id = payment_requests.user_id
        AND other.id != payment_requests.id
        AND other.status IN ('pending_payment', 'user_paid', 'processing')
  );

DELETE FROM payment_request_events
WHERE id LIKE 'migration-005-payment-%';

DELETE FROM schema_migrations
WHERE version = '005_payment_method_consistency';
