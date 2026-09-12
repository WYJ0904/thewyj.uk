# Task 24.2 审计与收尾记录

## 状态：WAITING FOR DEVICE ACCEPTANCE

所有可自动完成的代码、测试、CI 与 Production 工作已完成。剩余事项为必须由用户本人在
SM-S9360（Android 16）等真机上执行的一次性验收矩阵。

## Phase 摘要

- Phase 0：分支基线整合。两个既有分支全部合并进 `codex/task24-2-final-audit-r1`，原分支保留。
- Phase 1：Notification → Finance / 数据一致性。canonical 状态机与 ID 链、confirm 幂等终态、
  pull 终态合并、duplicate-without-ledger 不再丢单、通知动作路由修复、failure observable。
- Phase 2：Android 11 / API 30 baseline、bundled ML Kit OCR、云端 TTS、系统 TTS 仅 offline fallback、
  capabilities audit、OEM keep-alive hack 静态守卫、WebView 云端音频放行。
- Phase 3–10：本轮以既有全量测试 + 新增 targeted 测试覆盖 Finance / Admin / Membership /
  File Transfer / Security / UI / Performance 审计矩阵；主动审计发现并修复的问题见下方。
- Phase 11：PR #61、PR CI 7/7、merge `5e597da29ffeef7075953bb8017053f7865a2df3`、main CI 7/7、
  Production deployment `cff70d60-a3ca-4d06-9040-d86c7e14daa4`、Production smoke 通过。
- Phase 12：真机验收矩阵（见下）。

## 主动审计发现并修复（本阶段）

1. P0 金额已识别但未进入 Finance：服务端 duplicate 应答无账本身份时客户端静默丢弃队列项。
   修复：只有带 transaction_id/candidate_id 的 duplicate 才出队；否则保留 payload、archive 置 failed。
2. P0 通知动作错误打开来源应用：来源 App 停用时点击无反应。修复：thewyj 动作只打开 thewyj，
   来源 App 独立为「打开来源应用」，且仅在可解析且启用时提供。
3. P1 通知侧与 Finance 状态漂移：archive 无终态。修复：Room v7 持久化 financeState/financeTransactionId/sourceEventId。
4. P1 confirm 后 pull 复活 pending：拉取只应用 terminal 状态，terminal 不可被覆盖。
5. P1 文件传输移动端横向溢出：header 动作组不可收缩。修复：flex 换行 + min-width:0 + 响应式断点。
6. P1 TTS 依赖设备语音包：统一云端 TTS（Workers AI + R2 缓存），设备语音仅离线备用。
7. P1 OCR 依赖 GMS 动态模型：改为 bundled ML Kit。

## Production smoke（实测）

- `/api/app/config`：1.3.0 / 13 / sha `8a24e7792070ef4a...` / 47,578,521 bytes。
- 官网 APK 下载 SHA == 本地 == R2。
- `/api/tts`：英语 200（audio/wav，首次 miss），重复请求 hit；日语 200。Workers AI 真实合成可用。

## 真机验收矩阵（Phase 12，一次性交付）

clean install、覆盖升级、App restart、force stop、手机 reboot、Wi-Fi / 5G、VPN on/off、
offline → reconnect、登录持久化、NotificationListener / Accessibility / 权限开关、
微信 / 支付宝真实支付 → pending → confirm → 通知侧消失、已捕获撤回通知、自动 Finance、
文件传输多文件/大文件、多账户、App 内更新、通知点击 cold / warm / process-killed 路由。
