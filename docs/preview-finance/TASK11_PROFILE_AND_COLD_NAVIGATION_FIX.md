# Task11：云端活动档案及 PWA 冷导航修复

日期：2026-11-14（香港时间）。统一候选仍为 #151
`72bf8cd0573f87c6bf78f8e31fab97ab966ec99c`，Hosted 为
`https://75752fb7.thewyj-uk.pages.dev`。本修复以该精确提交为基线，未修改 #151
分支或 Hydrogen 工作树，未部署、合并 main 或操作 Production。

## 实际复现

1. 新建 Chrome 上下文正常登录本轮普通 QA A，学习页显示默认档案“我”，并将
   现有云端合成档案覆盖。真实 Preview Task11 changelog 中，原活动档案在版本
   15，随后该新浏览器把默认值写为版本 24。旧错题/学习分组没有被删除。初始化
   将没有编辑时间的默认/旧偏好当成当前时间的用户修改；收到云端档案时又只改
   localStorage，未同步更新空闲学习界面。
2. 当前 Hosted 的完整发布缓存存在，`/index.html` 为成功 HTML，但其响应经过
   Pages `/index.html → /` 跳转，`redirected=true`。关闭旧页，在同一存储上下文
   中对页面和 Service Worker 均硬断网后打开语言页，Chrome 进入
   `chrome-error://chromewebdata/` / `ERR_FAILED`。在线重开控制组可读到相同缓存
   和自有数据标记。缓存完整不等于离线文档导航已通过。

第二项符合 [Fetch Standard 的 Service Worker 响应限制](https://fetch.spec.whatwg.org/#main-fetch)：
导航请求不能直接消费带有该跳转链的缓存响应。原始 Hosted 及隔离本地 RED 均保留。

## 最小修改

- 未经用户选择的新视图默认档案不进入同步变更队列；有实际本地旧档案时以
  未知旧时间迁移，避免伪造一次新的编辑覆盖已有云端选择。已存在的持久队列
  不被清空，正常显式编辑继续按原同步合同提交。
- 收到云端活动档案时，空闲状态复用原 `changeProfile`，在同步抑制标志下
  保存当前本机数据、更新档案及界面，不制造新的同步写入。不打断未完成测验。
- 离线导航遇到 redirected 的已验证缓存 HTML 时，用相同 body、status 和
  headers 创建导航响应，保留页面字节及 CSP。原 Cache Storage 不被改写或删除。
- 按实际文件重新计算 12 项完整性和 publication hash。81 个原 RC5 CORE、两个
  Task26 REQUIRED 和一个独立 FINANCE 项均未增删；TTS/Email/Llama 代码未改。

## 验证及边界

使用项目既有 Miniflare、D1/R2 与 CDP/Chrome 工具新增一个定向回归脚本，没有
新增依赖或测试框架。其数据库始终为新建本地 fixture，服务只绑定 127.0.0.1；
不读取真实凭据，模拟 Pages 的 308 规范跳转。

| 验证 | 结果 |
| --- | --- |
| 原实现的新浏览器云端档案与硬断网文档导航 | RED：两个实际断言失败 |
| 修复后的新浏览器档案、显式编辑/空闲远端更新、未知时间旧档案、硬断网导航 | GREEN：4/4 |
| 原 SW 单元合同 | 18/18 PASS |
| 原 SW 浏览器 normal / warm / failure-retry | 3/3 PASS；失败安装拒绝、重试恢复和旧缓存保留 |
| 当前 75752fb7 Hosted 上这两个问题 | FAIL，修复尚未部署；本地 GREEN 不代替 Hosted |
| Samsung / 正式 APK / Production | 未操作，不是此修复的验收结果 |

回归命令：

```powershell
npm run cf:check
node qa/task11/profile-restore-browser.mjs
node --test qa/p07-release/sw-install.test.mjs
node qa/p07-release/sw-install-browser.mjs --source WORKTREE --label task11-profile-cold --cases normal,warm,failure-retry --out .wrangler/task11-profile-sw
```

Core CI 已追加此独立回归，用精确新提交确认后，再由所有者协调新的 Preview
补测原两个失败及关闭页面后的 Task11/Task26 恢复。分支使用当前 Pages 排除的
`codex/aeris-p0-*`，推送不会被当作新 Preview 部署授权。

本轮 Preview 的六币种/JPY、生命周期及退款、人工币种确认、隔离、FX 历史快照
和 P05/P06 禁用/来源边界的实际结果另记在最终业务验收报告；这些结果不消除
上述两个 UI/PWA 发布阻断，也不代表 Android 真机或真实模型质量通过。
