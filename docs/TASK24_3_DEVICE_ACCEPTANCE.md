# Task 24.3 真机验收矩阵（Phase 12 完成记录）

状态：**TASK 24.3 DEVICE ACCEPTANCE COMPLETE**（2026-09-12）。
设备：Samsung SM-S9360，Android 16（One UI）；由用户本人在正式设备上执行。

结论：Task 24.3 真机矩阵 7 项全部实际执行。其中 6 项 PASS；第 5 项（App update）中
「下一版本下载 → SHA 校验 → 安装」链路因本轮没有可发布的新版本，明确记为
**NOT EXERCISED — no newer release available**，不计入 PASS。无 FAIL 项。

自动化部分（audit / fix / regression / 全量测试 / PR / CI / merge / main CI / Production
deploy / smoke）见 `docs/TASK24_3_AUDIT.md`。

## 1. T24.3-03 自动入账后通知档案终态（P0）— PASS

- 微信 / 支付宝真实支付，走服务端自动入账（本机没有 candidate）路径。
- 通知档案条目显示 confirmed 且带 `financeTransactionId`，未停在「等待确认记账」。
- 下拉刷新 / 冷启动 / force stop 后重启：终态未被 pending 覆盖。

（对应矩阵第 1–3 项。）

## 2. T24.3-06 离线捕获 → 联网自动补传（P2）— PASS

- 飞行模式下产生真实支付通知，本机显示待同步。
- 恢复网络后**未**打开通知档案 / 待核实页面、**未**制造新通知，1–2 分钟内自动补传并进入
  Finance，通知档案转为已入账 / 已同步。

（对应矩阵第 4–6 项。）

## 3. T24.3-04 无障碍与权限状态一致性（P2）— PASS

- 无障碍已开启时冷启动：「我的 → Android 能力」与「权限中心」状态一致。
- 系统设置中关闭无障碍 → 回到 App 两处均显示未开启；重新开启后显示已连接。
- 撤销通知访问 → 两处均显示未开启；重新授权后恢复捕获。

（对应矩阵第 7–9 项。）

## 4. T24.3-01 / 02 多账户隔离与能力提示（P1/P2）— PASS

- 账户 A 停在大文件上传中断状态 → 切到 B 并操作 → 切回 A：A 的待续传队列未丢失，
  B 看不到 A 的文件，A/B 队列与文件相互隔离。
- 关闭系统「文字转语音」引擎后，离线朗读明确提示不可用 / 离线 fallback 状态，未静默失败；
  联网时云端 TTS 正常播放。

（对应矩阵第 12–13 项。）

## 5. T24.3-05 更新包完整性（P2）— 部分执行

- PASS（真实执行部分）：当前已是最新版（1.3.0 / versionCode 13）时，检查更新显示
  「当前已是最新版」，不出现可安装包。
- **NOT EXERCISED — no newer release available**（未执行，不计入 PASS）：
  「发布下一版本 → 下载 → SHA 校验 → 安装未知应用授权 → 系统安装器」整链。本轮没有可发布 /
  可安装的新版本，因此没有真机证据；SHA 缺失或哈希不符必须 fail-closed 的行为仅由自动化回归
  `android/app/src/test/java/uk/thewyj/app/core/update/AppUpdateInstallerVerifyTest.kt`
  在代码级确认，不得当作真机 PASS。下一次版本发布时必须补做该真机链路。

（对应矩阵第 10–11 项。）

## 6. 既有矩阵沿用情况

- Task 24.1 / 24.2 已通过的真机矩阵（clean install、覆盖升级、reboot、VPN、支付
  pending → confirm、通知点击 cold/warm/kill 路由、文件传输多文件/大文件）本轮**未重复执行**，
  沿用既有 PASS 记录；本轮受改动影响的路径已由上方 1–4 组实际执行覆盖。

## 未通过 / 待办

- 无 FAIL 项。
- 唯一未执行项：下一版本的真实「下载 → SHA 校验 → 安装」真机链路（见第 5 节），
  记录为 `NOT EXERCISED — no newer release available`。
