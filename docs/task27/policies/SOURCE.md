# Confirmed policy source

- Active published version: `2026-11-16-v1` (effective `2026-11-16`)
  - Operator: Independent personal operator (`https://thewyj.uk`, `support@thewyj.uk`, no fabricated corporate entity)
  - Governing law: Applicable laws including mandatory consumer protection, privacy, and data protection laws in the user's jurisdiction
  - Data retention & deletion: Category-by-category code-verified TTLs and retention rules (sessions 7d / 15m+180d, challenges 5m / purge 24h post-expiry, rate windows +1h, unpaid orders 24h, quizzes 2h, Workers AI learning cache 7d, Android local notification options 7/30/90/365/manual non-auto-delete scoped strictly to local device archive, temporary shares <=7d, large transfer sessions 24h / shares <=7d, inbound support threads/messages 180d, previews 15m, OTP email audit redaction, self-service account deletion + sync tombstones + backup rolling retention)
  - Third-party processors: Cloudflare (Pages, Workers, D1, R2, Email Routing/Sending, Workers AI `@cf/meta/llama-3.1-8b-instruct-fast` for learning; Finance AI disabled in Production), Microsoft Azure Speech (online TTS)
- Immutable prior draft archive preserved: `2026-11-14-v1`
