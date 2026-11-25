# Aeris V6.3 Phase 3 V2 — Reference Mapping & Real Web Research

本报告记录 Phase 3 V2 专项整改中实际执行的互联网搜索、查阅的公开网页、开源实现、央行人民币硬币公开资料、许可证核查，以及对应的 Aeris 实现位置与真机渲染证据。

## 1. 人民币 1 元硬币（CNY ¥1）真实参考资料

| 项目 | 记录内容 |
|---|---|
| 搜索关键词 | `中国人民银行 2019年版第五套人民币 1元硬币 正面 背面 菊花 公告`、`2019 5th series RMB 1 yuan coin PBOC specifications diameter` |
| 公开参考来源 | 中国人民银行公告〔2019〕第4号（2019年版第五套人民币50元、20元、10元、1元纸币和1元、5角、1角硬币发行公告，公开政府规范资料）；Wikipedia / Numista 对 2019 版 1 元硬币参数记录 |
| 物理与图案规格 | 直径 `22.25mm`（较 1999 版 25mm 缩小），材质为钢芯镀镍（银白色金属光泽），边缘滚字/圆点内缘；正面为“中国人民银行”、大号衬线数字“1”与“元”字及汉语拼音“YIYUAN”；背面为菊花图案、年号“2019”及上部拼音“ZHONGGUO RENMIN YINHANG” |
| 素材与许可 | 依据公开法定规格由 Aeris 原创编写纯本地 SVG 矢量绘制（无第三方版权图片依赖、无外链 CDN，严格满足 `style-src 'self'` CSP） |
| Aeris 实现位置 | `js/tools/random.js` (`renderRmbOneYuanCoinSvg`, `computeCoinTargetAngle`)、`tools.js` (`renderCoinRandomTool`)、`spatial-experience.css` (`.coin-3d-scene`, `.coin-3d-body`, `.coin-edge-layer-1..6`) |
| 渲染证据 | `docs/ui-rebuild/v63-phase3-tools/screenshots/v2/08-coin-rmb-1yuan.png`、`docs/ui-rebuild/v63-phase3-tools/phase3-v2-walkthrough.mp4` |

## 2. 开源交互式转盘与权重映射研究

| 参考对象 | 公开 URL / 开源仓库 | 许可证 | 提取的核心模式 | Aeris 实现位置 |
|---|---|---|---|---|
| Wheel of Names | `https://wheelofnames.com/` | 公开产品体验参考（非代码复用） | 固定 12 点钟方向指针、扇区按权重比例绘制、先用加密随机数定胜者再反推停止角 | `js/tools/random.js` (`computeWeightedSectors`, `drawWeightedSector`, `computeWheelNextRotation`) |
| `crazytim/spin-wheel` | `https://github.com/crazytim/spin-wheel` | MIT | 连续多圈缓出减速（`cubic-bezier`）、扇区角度边界安全留白（22%–78% 区间避免停在分割线上） | `js/tools/random.js` (`drawWeightedSector`), `tools.js` (`renderWheelRandomTool`) |
| `wheelofnames-io/canvas-spin-wheel` | `https://github.com/wheelofnames-io/canvas-spin-wheel` | MIT | 实时修改选项/权重时同步重绘扇区几何、支持 0 权重项从转盘移除 | `js/tools/random.js` (`renderWheelSvg`), `tools.js` (`updateWheelVisual`) |

## 3. 开源 3D 骰子与 3D 硬币翻转研究

| 参考对象 | 公开 URL / 开源仓库 | 许可证 | 提取的核心模式 | Aeris 实现位置 |
|---|---|---|---|---|
| `gnuton/css-dice-roller` & `drdreo/dice-roller-3d` | `https://github.com/gnuton/css-dice-roller` | MIT | CSS 3D `perspective` + `transform-style: preserve-3d` 立方体六面 `translateZ(56px)`、累加多圈 `rotateX/rotateY` 精准落定到目标点数面 | `js/tools/random.js` (`DICE_D6_FACE_ROTATIONS`, `computeDiceTargetTransform`), `tools.js` (`renderDiceRandomTool`), `spatial-experience.css` (`.dice-cube`) |
| `Ayokanmi-Adejola/Flip-The-Coin` & `hieuristix/3D-Coin-Flip` | `https://github.com/Ayokanmi-Adejola/Flip-The-Coin` | MIT | `backface-visibility: hidden` 双面硬币 + 多层 `translateZ` 金属边缘厚度层 + 抛物线起跳与地面阴影缩放 | `tools.js` (`renderCoinRandomTool`), `spatial-experience.css` (`.coin-3d-body`, `.coin-edge-layer-*`, `@keyframes dsCoinToss`) |

## 4. 目录网格、搜索、滑杆与文件选择规范研究

| 参考对象 | 公开 URL / 规范 | 提取的核心模式 | Aeris 实现位置 |
|---|---|---|---|
| Apple Launchpad / App Library & Samsung One UI | Apple HIG / One UI 公开视觉规范 | 独立柔和底色卡片 + 内部更浅色居中图标块 + 卡片间清晰留白 + 名称自然 2–3 行换行不粗暴单行截断 | `spatial-experience.css` (`.tool-catalog`, `.tool-card`, `.tool-open > .tool-tile-glyph`, `strong.tool-tile-name`) |
| Raycast | `https://www.raycast.com/` | 搜索框单一清空动作（隐藏浏览器重复 `::-webkit-search-cancel-button`）、键盘选中态与 hover 态分离、清晰分类胶囊 | `tools.js` (`toolCard`), `spatial-experience.css` (`#toolSearchInput`, `.tool-tile-cat`, `.tool-card.is-kbd-active`) |
| WAI-ARIA APG Slider | `https://www.w3.org/WAI/ARIA/apg/patterns/slider/` | 原生 `<input type="range">` 承载完整键盘导航（方向键/Home/End），配合 `aria-valuemin/max/now/valuetext` 与自定义轨道/滑块 | `tools.js` (`renderWheelRandomTool`), `spatial-experience.css` (`.aeris-weight-slider`) |
| Apple / ChatGPT 文件选择与拖放 | 公开 Web 交互模式 | 视觉上完全隐藏原生 `<input type="file">`（`.visually-hidden` 保留无障碍与系统选择器），统一 Aeris 拖放区、文件清单与重选/清空操作 | `tools.js` (`aerisDropzoneMarkup`, `bindAerisDropzone`), `index.html` (`#workflowFileInputWrap`), `spatial-experience.css` (`.aeris-file-drop`) |
