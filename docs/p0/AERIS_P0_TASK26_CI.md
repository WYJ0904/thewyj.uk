# Task26 P0：远端 CI 补充

2026-10-31。独立恢复候选 `569a1d20b2d33ee949f0c9b820e7864beff0916f` 已正常 fast-forward 更新 PR111。先在共享 Pages 的原 Preview exclusions 追加该原分支的精确名字 `codex/task26-wrong-review`，避免未合格候选自动使用共享数据库；没有改 Production、P07 或 Hotfix 的规则/绑定。没有运行远端 0026。

[首次远端 run41180368050](https://github.com/WYJ0904/thewyj.uk/actions/runs/41180368050)：7 PASS / 1 FAIL / 2 SKIP。Android unit/lint/Debug、Task25 emulator、JS、Linux/Windows Python、凭据发现和敏感路径检查均通过。两个浏览器依赖未执行，不计 PASS。

失败位于主线新 `ci-pages-build.mjs`：它只接受 package.build 精确等于 `node scripts/stage_pages_deploy.mjs`，但原 PR111 使用 `npm run pages:stage && node scripts/check_pages_output.mjs`，多执行一次输出隔离门禁。不能删去该旧保护来制造绿灯。

现校验器精确要求 `pages:stage` 为既有 allowlist staging，并要求 build 为 staging 加原 output checker；逐文件字节一致、凭据扫描、目录/链接及输出范围的其他检查全部保留。实际本地两次 staging/输出校验通过：147 文件，tree SHA-256 `16148f3d3fd34585f8936588d2c26a31498db87b1ae995e4fe804047d61089d2`。该改动仅 QA 校验器，不改变已测 Task26 产品字节。

原失败日志/CI 链接保留；需以修正提交的新 CI 结果单独判断。之前的本地 42 组 Chrome、算法/D1/客户端检查及历史 `CLOSED_WITH_OWNER_WAIVER` 均不被重命名成真机或 Hosted 通过。PR 继续 Draft，未合并或发布。
