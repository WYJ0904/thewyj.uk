# 多阶段滚轮 3D 与无缝 Bento 拼接墙报告

## 1. 多阶段 Scroll-Driven 3D 演进

- 依据阶段 A 新增并导出的 `computeMultiStageScroll3d(rect, viewportHeight, options)`，`#publicPreviewScrollWrap` 在 `[data-scroll-3d="true"]` 下完成连续三阶段演出：
  1. **入场展平（`enter`）**：`rotateX` 从倾斜状态平滑收敛到 `0deg`，`scale` 从 `0.95 → 1.00`，`translateY` 从 `18px → 0px`。
  2. **平视交互区（`level`）**：处于视口中央阅读带时锁定 `rotateX(0deg)`、`scale(1)`、`tz(0px)`，保证预览窗内部文字与表单控件 100% 清晰可读、可点。
  3. **离场退行（`exit` → `settled`）**：继续向下滚动时平滑俯仰退行（默认 `--ds-scroll-rx` 至 `-8deg`、`scale` 至 `0.96`、`--ds-scroll-tz` 至 `-20px`），超出阈值后稳定收束。
  4. **向上回滚可逆**：向上滚动完整连续逆向恢复。
- **浏览器实测遥测**（源自 `docs/ui-rebuild/i03/evidence/acceptance-report.json`）：
  - `topM`: `stage="enter"`, `rx=1.54deg`, `scale=0.9923`, `tz=0px`
  - `midM`: `stage="exit"`, `rx=-0.74deg`, `scale=0.9963`, `tz=-1.85px`
  - `exitM`: `stage="settled"`, `rx=-8.00deg`, `scale=0.96`, `tz=-20px`
  - `revM`: `stage="enter"`, `rx=1.32deg`, `scale=0.9934`, `tz=0px`
- Reduced Motion 开启时强制重置 `--ds-scroll-rx: 0deg`, `scale: 1`, `--ds-scroll-tz: 0px`。

## 2. 无缝 12 列 Bento 拼接墙与仅内部轻视差

- `#publicBentoWall` 采用 12 列网格（7+5 / 5+7 / 12），`gap: 0`，共享 `1px` 细线边框，`overflow: hidden`。
- 外层 `.bento-tile` 实测 `getComputedStyle(tile).transform === 'none'`（I07 联合测试 `maxSeamDrift = 0`），绝不产生外框错位或缝隙撕裂。
- 仅内部 `.tile-inner[data-parallax-speed]` 接收 GPU `--ds-parallax-y` 偏移（实测滚动区间变化 `[-8.4, 6.6, -6, 5.4, -3.6]` → `[0.88, -0.69, 0.63, -0.56, 0.38]` px），Reduced Motion 下全归 `0px`。
