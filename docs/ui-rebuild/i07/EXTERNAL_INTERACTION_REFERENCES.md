# Aeris I07 — 外部开源项目与公开网站交互参考归档

本文件依据 Owner 第 25 节新增授权，在 I07 动效与交互引擎设计及实现期间完成外部开源方案调研、许可证核查、适用性对比及最终采用决策归档。

## 1. 选型总原则

- **零重型框架依赖**：Aeris Web 端采用原生 ES Modules + 原生 DOM/CSS；不引入 React 运行时或大型第三方动画库（如 GSAP、Framer Motion），避免增加包体、CSP 复杂度、Service Worker 完整性清单负担与维护成本。
- **许可证合规**：仅评估与借鉴 MIT / Apache-2.0 / BSD 等宽松许可项目的交互设计与数学算法，不复制任何专有视觉素材、品牌标识或 GPL/AGPL 代码。
- **架构兼容**：所有能力均扩展至既有 `js/core/motion.js`、`js/core/keyed-list.js` 与 I02 `design-system.css` `--ds-*` Token 体系。

## 2. 重点评估与参考方案明细

| 类别 | 项目名称与地址 | 许可证 | 所参考的具体交互 / 机制 | 采用方式 | 适用性分析与未直接引入原因 | 实测验证结果 |
|---|---|---|---|---|---|---|
| **移动端跟手抽屉 (Drawer)** | **Vaul** (`emilkowalski/vaul`) · [GitHub](https://github.com/emilkowalski/vaul) | **MIT** | 1:1 指针跟手、向上回拉橡皮筋阻尼、释放速度+阈值判定吸附或关闭、背景微缩 (`.app-scale-wrap`)、内部滚动与手势防冲突 | **算法与交互设计借鉴**（实现于 `js/core/motion-sheet.js`） | Vaul 强绑定 React 与 Radix Dialog；Aeris 为原生 ESM，且需兼顾桌面弹簧模态与 `[data-confirm-only]` 危险弹窗保护 | 在 Chrome 375px 触控模拟下验证 42px 轻拉回弹（保留表单输入）与 240px 下滑关闭并释放滚动锁 |
| **Toast 队列与调度** | **Sonner** (`emilkowalski/sonner`) · [GitHub](https://github.com/emilkowalski/sonner) | **MIT** | 全局声明式队列调度、同屏受限可见数、悬停/聚焦暂停计时、同类消息去重与 `aria-live` 无障碍通知 | **交互设计与队列策略借鉴**（实现于 `js/core/motion-toast.js`） | Sonner 为 React 组件库；Aeris 需强制“同屏最多 2 条”、有界队列、错误保护（禁止成功 Toast 覆盖活动错误）及与 `p07_accessibility` 兼容 | 5 条突发不同状态消息实测同时仅 2 条可见、3 条排队、Error 置顶受保护、单测验证去重与清空 |
| **双向 FLIP 布局重排** | **FormKit Auto-Animate** (`formkit/auto-animate`) · [GitHub](https://github.com/formkit/auto-animate) & Paul Lewis Aerotwist FLIP | **MIT** | First–Last–Invert–Play 原理、Web Animations API 驱动 `transform` 合成层动画、节点增删改顺滑过渡 | **算法参考**（自研增强于 `js/core/motion-flip.js` 与 `js/core/keyed-list.js`） | Auto-Animate 封装为黑盒 MutationObserver，难以精细控制“动画中途反向重排时先读取当前视觉矩形再取消重算”、2-RAF 提交与拖拽手柄联动 | 实测上移/下移双向均产生真实连续 `transform` 动画、3 连击/中途逆向平滑衔接、DOM 节点 4/4 复用 |
| **无障碍与状态语义** | **Radix Primitives** (`radix-ui/primitives`) · [GitHub](https://github.com/radix-ui/primitives) / [Docs](https://www.radix-ui.com/) | **MIT** | Dialog 焦点陷阱与关闭焦点恢复、Tabs `aria-selected` + 方向键漫游、Switch `role="switch"` 与 `aria-checked` 同步 | **WAI-ARIA 规范与交互行为对齐**（结合 `js/core/design-system.js` 与 `js/core/motion.js`） | Radix 为 React 无头组件；Aeris 已有原生焦点陷阱与按键漫游，在 I07 补充了动态 `tablist` 追踪、表单 `invalid` 状态提示与开关异步失败回滚 | 全站与 Fixture 通过 `axe-core` 0 违例审计，Escape/Tab/Arrow 键盘闭环可用 |
| **微交互与滚轮 3D / Bento 视差** | 原生 CSS Transitions + WAAPI + `IntersectionObserver` + rAF 节流（参考 Apple/Stripe 克制按压与 W3C Scroll-Driven 思路） | **Web 标准原生能力**（无外部包） | 80ms 瞬时按压、140ms 骨架防闪烁与旧请求丢弃、仅在视口内按真实滚动进度可逆插值 `rotateX`/`scale`/`translate3d`、外框锁定仅 `.tile-inner` 视差 | **原生实现**（`js/core/motion.js` & `js/core/motion-scroll.js`） | 无需第三方滚动劫持库（如平滑滚轮劫持库会破坏原生惯性与可访问性），严格保证仅在视口内执行批量读/写 rAF | 桌面真滚轮向下/暂停/向上反向插值可逆，Bento 外框接缝漂移实测 `0.00px`，Reduced Motion 自动锁平 |

## 3. 未采用第三方运行时包的原因总结

1. **包体与 PWA 缓存约束**：Aeris 的 Service Worker (`sw.js`) 对前端资源实施严格的清单与完整性校验，任何引入 React 或第三方 UI 框架都会破坏现有架构与包体预算。
2. **可中断性与业务安全控制**：Aeris 的模态框需要与 Task27/28/29/30 安全流程、`inert`、原生焦点恢复及 `data-confirm-only` 强绑定；自研零依赖模块可在 100% 掌控生命周期的前提下达到成熟开源项目的交互质感。
3. **最终验证基准**：所有借鉴机制均未依赖上游示例，而是在 Aeris I07 隔离 Fixture 与真实应用路由上通过真实 Chrome CDP + 自动化单测完成独立验收。
