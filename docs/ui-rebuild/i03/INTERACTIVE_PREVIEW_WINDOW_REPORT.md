# 单一真实交互预览窗与骨架切换报告

## 1. 几何稳定性与防跳动

- 预览内容容器 `.preview-body.aeris-window-content` 设定固定最小高度 `356px`（移动端 `360px`），即使在入口缩放阶段实测渲染高度亦维持在 `354.5px+`（桌面平视态 `>= 356px`），在 **语言一题 ↔ JSON 与文本 ↔ 结余试算 ↔ 文件清单** 四项切换前后零塌陷或高度抖动。

## 2. `120–150ms` 骨架过渡与异步竞态守卫

- `js/core/public-experience.js` 消费共享 `createTabSkeletonSwitcher({ duration: MOTION.skeleton, view })`（`MOTION.skeleton = 140ms`，严格处于 `120–150ms` 窗口内）。
- 点击 Tab 时立即更新 `aria-selected` 并标记 `.aeris-window-content[data-skeleton-loading="true"][aria-busy="true"]` 显示 `.i03-skeleton-shimmer` 骨架占位，随后执行带 `AbortSignal` 与自增 `switchGen` 令牌的渲染回调：
  - 快速连击（如 `语言一题 → 结余试算 → 文件清单 → JSON 与文本`）时，中间全部过期 Promise 自动返回 `false` 并中止，最终仅呈现最后一次选择。
  - 在 `JSON 与文本` 面板中，`<textarea id="publicTextInput">` 节点身份全程保留，编辑/格式化后不会破坏焦点或重建输入框；点击 `#publicJsonFormatQuickBtn` 可本机格式化并显示即时校验结果 `#publicJsonQuickStatus`。
- Reduced Motion 开启时，`createTabSkeletonSwitcher` 自动将骨架延时降为 `0ms`，即时切换面板且禁用入场位移动画。

## 3. 真实本地处理边界

- 不存在任何伪造余额、伪造上传或匿名写入请求：
  - 语言题库仅在前端内存比对；
  - JSON 校验与文本统计仅操作本地字符串；
  - 结余试算基于整数分运算；
  - 文件清单仅读取本地 `File.name` / `File.size`。
