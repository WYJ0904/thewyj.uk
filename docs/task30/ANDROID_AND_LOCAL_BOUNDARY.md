# Task30 Android、本地缓存与浏览器模拟测试边界说明 (`ANDROID_AND_LOCAL_BOUNDARY`)

## 1. 端云数据与权限边界（诚实披露原则）

Task30 的「隐私与数据管理」及政策声明严格遵循以下技术事实边界，绝不混淆服务端同意与系统级权限：

1. **云端可选同意撤回 ≠ Android 系统权限关闭**：
   - 在网页端撤回 `cloud_notification_sync`（云端结构化通知识别与待确认同步）后，服务端立刻拦截后续 `/api/notification/*` 与待确认线索的新写入与增量同步。
   - 网站 **无法且从不宣称** 已在 Android 系统设置中关闭 `NotificationListenerService`（通知使用权）或 `AccessibilityService`（无障碍服务）。界面通过 `DEVICE_OS_PERMISSIONS_DISCLOSURE` 明确指导用户前往手机系统设置手动关闭。
2. **云端清空通知 ≠ 远程擦除 Android 本机 Room 数据库**：
   - Android 客户端本地 Room `notification_history` / `notification_settings` 数据库存储于用户手机本地，支持设备端独立的留存天数配置（`7`、`30`、`90`、`365` 或 `0`=永久保留，并兼容旧版本 `1`/`3` 天，同时星标收藏通知免受自动留存裁剪）。
   - 在网页端删除 `notifications_cloud` 类别仅清除云端 D1 的结构化支付事件与审核候选，并写入云端防复活墓碑；不会也不能远程擦除手机本地 Room 数据库。
3. **浏览器缓存、Service Worker 与离线备份边界**：
   - 账号注销或安全删除后，浏览器端可通过同源会话清理撤销登录态并更新 `sw.js` 缓存清单（私有文件响应携带 `Cache-Control: private, no-store`）。
   - 用户此前自行导出并保存至本机磁盘或网盘的 `.wyjbackup` 加密文件由用户完全掌控，服务端无法远程销毁；但其数据在后续重导入时受 `task30_erasure_tombstones` 与 `task30_erasure_generations` 防复活机制约束。

---

## 2. 本轮 Android 真机验证状态声明

- **Android 真机测试状态**：**`NOT_TESTED — NOT REQUIRED`**（本轮明确不要求使用 Android 真机、不连接 USB、不安装 APK）。
- **已执行的 UI 响应式与触摸模拟验证**：
  - 使用本地无头 Chromium/Chrome 并在桌面端 `1440×900`（Light）、平板 `768×1024`（Light）、移动视口 `390×844`（Dark + `mobile: true` + `touch`）及窄屏 `375×667`（Light + `mobile: true`）以及 HTTPS Preview `390×844`（Dark）进行真实布局、零横向溢出（`scrollWidth <= innerWidth + 1`）与 ≥44px 可触控热区实测通过。
- **严谨性说明**：上述浏览器视口/触摸模拟仅验证 Web 前端响应式布局与交互行为，**不冒充也不替代** Android 真机系统级权限撤销或 Android 本地 Room 数据库擦除验证。
