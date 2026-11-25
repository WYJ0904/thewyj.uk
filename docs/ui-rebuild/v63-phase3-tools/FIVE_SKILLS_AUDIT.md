# Aeris V6.3 Phase 3 — Five Skills Verification Audit (V2)

全局 Skill 根目录：`~/.gemini/config/skills`

## 1. `frontend-design`
- **职责**：目录网格独立卡片层次、长名称自然换行、随机工具专用工作区（转盘双栏舞台 / 3D 骰子舞台 / 3D 人民币硬币舞台）与统一文件拖放区架构。
- **V2 落地核验**：
  - 破除了旧版 `spatial-experience.css:8622` 强制单行截断与左偏 padding 的特异性覆盖；真机实测图标块水平居中偏差 `centerDelta = 0px`，`whiteSpace = "normal"`。
  - 每个工具卡片具备独立浅灰可点击表面（浅色 `rgb(244,244,244)` / 深色明确区分），内嵌更浅色图标块（浅色 `rgb(253,253,253)` / 深色 `#252932`），卡片间 `12px` 清晰留白。
  - 搜索结果分类徽章改用 `<em class="tool-tile-cat">` 并重置旧版 `.tool-open > span` 30px 边框规则，实测 `62px × 21.9px`、`overflow = 0`。

## 2. `ui-ux-pro-max`
- **实际执行查询**：
  - `python ~/.gemini/config/skills/ui-ux-pro-max/scripts/search.py "icon grid tile long text slider file upload keyboard accessibility" --domain ux -n 6`
  - `python ~/.gemini/config/skills/ui-ux-pro-max/scripts/search.py "developer tools workspace minimal monochrome" --domain style -n 3`
- **关键核验点**：
  - Keyboard Navigation & Visible Focus：工具卡片 `:focus-visible` 清晰聚焦环、滑杆完整方向键支持、文件选择器保留原生 `<input type="file">` 键盘与读屏可达性。
  - Text Reflow & Spacing：长工具名称支持 2–3 行自然换行，移动端 390px 宽度实测水平溢出 `0px`。
  - Color Contrast：浅色/深色模式下图标、名称、滑杆读数、概率标签均保持清晰对比度；0 处 `!important`。

## 3. `design-taste-frontend` (Taste)
- **职责**：转盘连续多圈缓出旋转、滑杆拖动与扇区几何实时联动、3D 骰子立体翻滚、3D 人民币 1 元硬币抛掷与金属边缘厚度、以及克制的微交互。
- **V2 落地核验**：
  - `weighted-wheel` 拖动滑杆（`0%`–`100%`、`0.5%` 步进整数半百分点存储）时，SVG 扇区角度实时更新且 `0%` 选项即时隐藏；点击“开始旋转”后 3.8s 多圈缓出精准停在中奖扇区内。
  - `dice-d6` 真实 CSS 3D 六面骰子（1 与 4 点红色强调）立体抛掷并准确落定至生成点数面。
  - `coin-flip` 真实 2019 版人民币 1 元硬币（正面“中国人民银行 1 元 YIYUAN”、背面菊花“2019”、6 层金属边缘厚度）立体翻转落定。
  - 所有动画均尊重 `prefers-reduced-motion: reduce`，且路由离开/切工具时自动清理定时器。

## 4. `impeccable`
- **职责**：对真实 Hosted Preview 渲染页面执行 Critique / Audit / Layout / Typeset / Animate 复核。
- **V2 实际发现并修复的问题**：
  1. **CSP 严格合规**：初版内联 `style="..."` 触发 `style-src 'self'` 拦截，已全部替换为 `data-swatch-index` / `.coin-edge-layer-1..6` CSS 类与纯 SVG `transform`，实现 `runtimeErrors: 0`。
  2. **目录图标左偏与名称单行截断**：通过真机审图发现旧版 `spatial-experience.css:8622` 特异性覆盖，修复后真机复测 `centerDelta: 0`、全名完整显示。

## 5. `hallmark`
- **实际执行命令**：
  - `node ~/.gemini/config/skills/hallmark/scripts/sloplint.mjs index.html spatial-experience.css tools.js`
- **核验结论**：
  - Phase 3 V2 新增的 `tools.js` 与 `spatial-experience.css` 目录/滑杆/转盘/骰子/硬币样式保持极简黑白灰体系、零渐变滥用、零 emoji、零 `!important`。
  - `sloplint` 报告的历史全站提示（如旧版 `index.html` 与 Phase 1/2 已验收区域）未越权改动，保持既定验收范围边界。
