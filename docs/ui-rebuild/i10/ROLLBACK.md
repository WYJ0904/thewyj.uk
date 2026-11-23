# Aeris V6.3 — I10｜安全回滚与隔离资源清理手册（Rollback）

本操作不触碰 `main`、Production `thewyj-uk`、PR #177、PR #178、`thewyj-v6-preview`、`thewyj-v6-rework-preview` 与正式 D1/R2。

---

## 1. 代码与 PR 回滚方式

1. **Draft PR 放弃合并**：直接在 GitHub 关闭 I10 Draft PR（目标 `hydrogen/i-v6-ui-ux-quality-rework`），原 V6 返工基线 `dcfe77a3202541460c88f9e3067668af0b3402f5` 保持丝毫不改。
2. **若已合入上游目标分支后的回退**：在工作副本仅执行反向还原提交（严禁强推或重写历史）：
   ```powershell
   git revert -m 1 <I10_MERGE_OR_COMMIT_RANGE>
   npm run task27:publication
   ```
   若只想回滚单一子系统缺陷修复，12 个源码文件互相独立且可按文件粒度单独 `git checkout dcfe77a3202541460c88f9e3067668af0b3402f5 -- <file>` 后重新运行 `npm run task27:publication`。
3. **本地 worktree 清理**（在确认分支已 Push 或不再需要本地调试目录后）：
   ```powershell
   cd "$env:USERPROFILE\Desktop\编程\thewyj.uk"
   git worktree remove "<path-to-full_site_motion_audit>"
   ```

---

## 2. 隔离 Preview 云端资源清理（仅限 I10 专用资源）

以下资源完全独立于正式站与 V6 返工预览（`thewyj-v6-rework-preview`），若要销毁隔离预览环境，仅删除下列对应资源（**切勿触碰任何非 `i10` 前后缀资源**）：

- **Pages 项目**：`thewyj-i10-preview`（别名 `https://i10-interaction-acceptance.thewyj-i10-preview.pages.dev`）
- **D1 数据库**：`aeris-i10-preview`（UUID: `dde3e526-eee3-4690-bdd8-a7168c318681`）
- **R2 存储桶**：`aeris-i10-preview-storage`

```powershell
# 示例：仅删除 I10 隔离资源
npx wrangler pages project delete thewyj-i10-preview
npx wrangler d1 delete aeris-i10-preview
npx wrangler r2 bucket delete aeris-i10-preview-storage
```
