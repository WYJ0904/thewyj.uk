# Aeris V6.3 Phase 5 — 工作流功能保留与能力/模板矩阵（WORKFLOW_RETENTION_MATRIX）

> 实施前核查基线：`workflows.js`、`index.html`、`qa/functional-audit.json`、`local-backend/test_workflows_js.mjs`、`local-backend/test_tools_browser.mjs`。
> 核心红线：**不将顺序步骤引擎改写为 DAG；保留全部 12 项注册能力、4 个内置模板、Schema v1（最大 50 工作流 / 20 步骤 / 48 KiB JSON / 50 文件 / 20 图片 / 50 MB）、纯本机处理隐私、账户隔离及会员/离线权限校验。**

---

## 一、全局入口与业务契约保留矩阵

| 编号 | 功能域 | 既有入口 / 契约标识 | 核心业务语义 | Phase 5 UI/UX 重构方案（100% 保留能力） |
|---|---|---|---|---|
| W-01 | 侧边栏与工具箱入口 | `[data-v3-nav="workflows"]`, `#openWorkflowBtn`, `/tools/workflows` | 鉴权与会员守卫；未登录引导 `/login`，无工具权限拦截或提示；进入 `/tools/workflows` | 点击即进入独立「工作流列表页」(`data-wf-view="list"`)，不再默认打开挤满表单与运行区的巨型单页 |
| W-02 | 返回工具箱 | `#closeWorkflowBtn` | 若有运行中任务则 `abort()` 并清理资源，返回 `/tools` 并恢复焦点 | 列表页顶部保留「返回工具箱」(`#closeWorkflowBtn`)；编辑器顶部新增「← 工作流列表」先回列表 |
| W-03 | 工作流搜索与新建 | `#createWorkflowBtn`, `#workflowSearchInput` (新增筛选) | 空白工作流 `blankWorkflow()`，受 `MAX_WORKFLOWS = 50` 限制 | 列表页顶部集中展示标题、权限胶囊 (`#workflowAccessBadge`)、搜索框（按名称与节点工具名实时筛选）、导入、新建 |
| W-04 | 我的工作流列表 | `#workflowList` | 展示已有工作流并支持切换、编辑、运行、复制、导出、删除 | Linear 风格紧凑行列表：显示名称、真实步骤数、输入→输出类型、最后修改时间、云同步标识；外显「编辑」「运行」，低频「复制/导出/删除」收进明确 `···` 菜单；无工作流时简洁空状态 |
| W-05 | 4 个内置模板 | `#workflowTemplateList`, `[data-workflow-template]` | `image-publish` / `image-batch` / `text-clean` / `csv-roundtrip` 创建新工作流并校验 | 列表页独立「内置模板」区展示用途、输入→输出类型与节点缩略流图；点击创建后直接打开独立画布编辑器 |
| W-06 | 工作流编辑与保存 | `#workflowNameInput`, `#saveWorkflowBtn`, `#workflowSaveState` | 修改实时持久化到 `wyjToolWorkflows:v1:<accountId>`；点击保存校验 `validateWorkflow()` 并同步云端 (`/api/tools/config/save`, `save_tool_config` 权限) | 置于编辑器顶部工作流工具栏，展示实时本地/云端保存状态反馈 |
| W-07 | 复制 / 导入 / 导出 / 删除 | `#duplicateWorkflowBtn`, `#exportWorkflowBtn`, `#importWorkflowBtn`, `#workflowImportInput`, `#deleteWorkflowBtn` | Schema v1 与 48 KiB 校验、ID 重生成防冲突、JSON 下载与云端删除同步 | 列表页 `···` 菜单与编辑器顶部管理菜单均可直接触发，保持全部现有 ID 与测试契约 |
| W-08 | 独立可视化节点画布 | `#workflowCanvasViewport`, `#workflowCanvasStage`, `#workflowStepList` | 真实映射 `workflow.steps` 顺序序列（非自由 DAG） | 桌面横向流式画布（点阵网格、平移、缩放、适应视口、SVG 贝塞尔连线+流向箭头、节点拖拽重排+按钮前移/后移+兼容性拦截提示）；手机端自动转为纵向流式画布 |
| W-09 | 节点添加（12 项能力） | `#workflowNodePicker`, `#workflowToolSelect`, `#addWorkflowStepBtn` | 按当前序列末尾或插入位置输出类型校验兼容能力；保留 `MAX_STEPS = 20` 限制 | 点击节点间 `+` 或工具栏「添加节点」弹出 Raycast 风格搜索/分类面板（文本处理/数据转换/图片处理/文件打包），标明 `输入→输出` 与兼容/不兼容原因 |
| W-10 | 节点参数配置面板 | `#workflowInspectorPanel`, `[data-step-config]` | 依据 `CONFIG_SCHEMAS` 动态生成控件与范围校验；支持启用/停用、复制节点、删除节点 | 桌面右侧自然展开参数抽屉，手机端底部抽屉；枚举 <=5 项直接平铺分段选项，数值滑杆同步数字显示；背景同步不关闭面板，关闭不丢失已改配置 |
| W-11 | 运行输入、执行轨迹与结果 | `#workflowRunnerPanel`, `#workflowTextInput`, `#workflowFileInput`, `#workflowBatchToggle`, `#runWorkflowBtn`, `#cancelWorkflowBtn`, `#workflowStepStatuses`, `#workflowItemResults`, `#workflowResultText`, `#workflowResultPreview`, `#downloadWorkflowResultBtn`, `#copyWorkflowResultBtn` | 纯本地处理；首步输入类型自适应；防重复并发运行；支持取消 (`AbortController`)、批量隔离失败、离线 24h 权限缓存运行 | 编辑器内可按需展开/收起运行工作区（点击「运行」自动展开）；画布节点与连线实时同步 `waiting/running/success/skipped/failed/cancelled` 真实状态；按文本/JSON/图片/多图/ZIP 类型化展示结果与错误定位按钮 |

---

## 二、全部 12 项工作流能力全量核查表

| # | 工具 ID (`tool_id`) | 能力名称 | 分类 | 接受输入类型 | 输出类型 | 真实参数 (`CONFIG_SCHEMAS`) |
|---|---|---|---|---|---|---|
| 1 | `text-encoding` | 读取文本编码 | 文本处理 | `text-file` | `text` | `encoding`: `utf-8` / `gbk` / `big5` / `shift_jis` |
| 2 | `remove-empty-lines` | 删除空行 | 文本处理 | `text` | `text` | 无参数 |
| 3 | `dedupe-lines` | 删除重复行 | 文本处理 | `text` | `text` | 无参数 |
| 4 | `sort-lines` | 文本排序 | 文本处理 | `text` | `text` | `order`: `asc`(升序) / `desc`(降序) |
| 5 | `csv-json` | CSV 转 JSON | 数据格式转换 | `text` | `json` | 无参数 |
| 6 | `json-csv` | JSON 转 CSV | 数据格式转换 | `json` | `text` | 无参数 |
| 7 | `text-split` | 文本分割 | 文本处理 / 文件打包 | `text` | `archive` | `lines`: integer `1..100000` (默认 `1000`) |
| 8 | `image-resize` | 图片尺寸调整 | 图片处理 | `image`, `image-list` | 保持输入单图/多图 | `width`: `1..4096` (默认 `1200`), `height`: `1..4096` (默认 `1200`) |
| 9 | `image-format` | 图片格式转换 | 图片处理 | `image`, `image-list` | 保持输入单图/多图 | `format`: `PNG`/`JPG`/`WebP`, `quality`: `0.1..1` (默认 `0.85`) |
| 10 | `text-watermark` | 文本水印 | 图片处理 | `image`, `image-list` | 保持输入单图/多图 | `text`: `1..100` 字符 (默认 `"WYJ"`), `color`: hex (默认 `#ffffff`) |
| 11 | `exif-remove` | 删除 EXIF | 图片处理 | `image`, `image-list` | 保持输入单图/多图 | 无参数 |
| 12 | `files-zip` | 打包为 ZIP | 文件打包 | `file-list`, `image-list` | `archive` | 无参数 |

---

## 三、全部 4 个内置模板核查表

| # | 模板 ID | 模板名称 | 用途说明 | 真实步骤序列 | 输入类型 | 输出类型 |
|---|---|---|---|---|---|---|
| 1 | `image-publish` | 图片发布处理 | 单张图片发布前标准化处理 | `image-resize` → `image-format` → `text-watermark` → `exif-remove` | `image` / `image-list` | `image` / `image-list` |
| 2 | `image-batch` | 图片批量发布 | 批量图片压缩转码清理后打包 ZIP | `image-resize` → `image-format` → `exif-remove` → `files-zip` | `image` / `image-list` | `archive` (`.zip`) |
| 3 | `text-clean` | 文本清理排序 | 读取文本编码后清除空行、去重并排序 | `text-encoding` → `remove-empty-lines` → `dedupe-lines` → `sort-lines` | `text-file` | `text` |
| 4 | `csv-roundtrip` | CSV 规范转换 | 解析 CSV 为结构化 JSON 再序列化为规范 CSV | `text-encoding` → `csv-json` → `json-csv` | `text-file` | `text` (`.csv`) |


---

## 最终整改能力与数据契约复核（2026-11-26）

- **12 项核心能力与 27 项工作流流程**：经 `python scripts/functional_audit_gate.py` 与 `node local-backend/test_workflows_js.mjs` 验证全部保留（11/11 自检组通过）。
- **Schema v1 零污染隔离**：节点区域内 2D 自由拖拽偏移 (`nodeOffsets: { [stepId]: { x, y } }`) 与视图状态均持久化于独立 UI 存储键 `wyjWorkflowCanvasUi:v1:<accountId>`，在删除步骤、删除/复制/导入工作流与跨账户切换时自动清理隔离；导出的工作流 JSON (`schema_version: 1`) 与云端保存配置保持纯净零注入（已由 Chrome CDP 实测断言 `"nodeOffsets" in wfBeforeReload === false`）。
- **执行真实性保障**：`executeWorkflow()` 不受动画时长阻塞或延迟；超快文本流程 (`text-clean`) 运行结束后立即解锁结果文本、“复制结果”与“下载结果”，无节点伪装留在 `running` 状态。
