# P07-R4-C 运行门禁与 P07-E 联合集成

日期：2026-11-06，Asia/Hong_Kong。当前 `P07_R4C_PARTIAL`：最终冻结门禁、隔离 Preview 和精确 SHA CI 待完成。

## 固定输入与 ancestry

| 输入 | SHA |
|---|---|
| R4-A / PR #125 | `0c87169aa4b75db4d00fe76a66bd32a62ead9e4a` |
| R4-B / PR #122 | `15fdd2b71b2f6a49957720a5aaed0135464f63fc` |
| P07-E / PR #126 | `22d71bd428f6d6bee71ea7140bc5e65650c9c547` |
| 冻结 QA / PR #124 | `882efdb9978f2608c54bc6c9c19eb8843e80945f` |

`merge-base(R4-A,P07-E)` 为 R4-B；R4-B 已是两个输入的祖先。P07-E 独有一个提交，产品增量为 spatial-experience.css，另有其 QA 和历史截图。集成 merge `a09f991124c6a15ee2267c42012e866c38c5d614` 无内容冲突，没有重复应用 R4-B。复用现有干净隔离工作树，新分支 `codex/p07-r4c-integration`，旧 R4-A 分支及全部原失败证据保留。

## G01：启动等待渲染帧的无界路径

历史账户普通刷新 30 秒超时仍保留在 R4-A 报告和截图；其当时未记录页面可见性，不能事后补造归因。

本轮用同一 R4-A 的 Git 字节，在真实 Chrome 中将账户标签置于后台再普通刷新。计时器在 1.7 秒、2.7 秒运行，页面 readyState=complete、appShell 已 ready，RAF 帧数为 0，原 Splash 仍存在；切回前台才完成。旧 `runSplashSequence()` 把清理和 Promise resolve 放在 RAF 回调之后，构成可确定复现的无界等待路径。[MDN 对后台 RAF 暂停的说明](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) 与实测一致。

修复提取为 `js/core/startup.js`：沿用原 450ms 展示和 180ms 退出时长，清理不依赖任何 RAF。错误回调也会移除 Splash 并拒绝 Promise，由现有 session recovery 界面处理；不转入未经验证的账户页。增加只读 bootState 阶段用于以后故障取证。没有增加启动延时、提高测试超时或修改 Logo。

固定 baseline probe `r4c-fixed-baseline-red` 在 `0c87169` 上明确 FAIL；同一背景清理断言在修复后 `ac59872` 上 PASS，后台仍为 hidden、RAF 仍为 0，但 Splash 已移除，前台账户恢复正常。四项单元合同覆盖无帧、原时长、reduced motion、异常清理；均 PASS。此证据关闭了已证明的等待路径；历史那一次故障的具体调度状态仍不可追溯。

## G02：联网后测量发生在策略 pending

[失败 CI 42018783175](https://github.com/WYJ0904/thewyj.uk/actions/runs/42018783175)，Cloud job `127217741420`，`test_tools_browser.mjs:1456`：viewport=1366，workspaceLeft=workspaceRight=runButtonHeight=0。

固定 R4-A 的真实页面记录：工作流路由始终 `/tools/workflows`，工作流本身未带 hidden；离线可操作。恢复联网并暂缓实际 `/api/features` 响应时，policy=pending，主画布按合同暂不显示，几何为 0；释放原真实响应后，policy=enabled，工作区宽 1157px，按钮高 44px。没有后台导航覆盖。

修正旧测试的就绪条件：恢复联网后有界等待权威策略及实际工作区／按钮可见，再测量。原视口边界、按钮至少 44px、对比度和工作流操作断言全部保留，另加路由保持断言。没有改产品的 fail-closed 决策或用 display/z-index 伪造通过。完整 Cloud-only CI 尚待最终候选验证。

## 集成边界与定向验证

资源版本：`20261106-aeris-p07-r4c-integration`，由现有 update_asset_release 脚本同步；新增 startup 模块列入必要离线 shell。R4-A 的 decision、History workspace、单一主工作区和缓存发布合同保留，P07-E 样式按其原增量合入。

已完成：

- G01 严格 RED → GREEN；G02 实际策略／路由／几何对照。
- P07-E 四个页面 × 375/390/1024/1440 × light/dark，共 32 项实际布局检查 PASS；工作流真实本地执行、管理员功能页、候选编辑／取消均检查。
- 管理接口匿名 401、普通用户 403、合法本地管理员 200。
- 候选数据通过隔离 pending-summary 测试替身进入原控制器，没有手工写产品 DOM、运行 AI/OCR 或确认写账。
- 模块图 58 文件、93 imports；29 类存储键兼容检查；43 个官方品牌／Android 文件和语义引用保持不变。

最终冻结 25 项、主页面排他 3 项、P4、慢策略、OFF/Kill Switch、暖缓存／离线、Android Web 返回、Preview 及 CI 结果将在收尾证据中逐项记录。原冻结脚本 SHA-256 保持 `227c4f69d473186fdbe307fa3a6da4a9a6d5a0c41d485ff51d19beed608fa61d`。

没有合并 main、发布 Production、改正式 D1/R2／权限／策略、启动 Android Stable、清除真实数据或调用 Claude。
