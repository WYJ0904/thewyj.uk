# Claude 精准编码任务包：P07 主线与财务候选收敛 (js/finance/app.js & js/finance/candidates.js)

**基线与环境**：
- **收敛工作区**：`aeris_p07_finance_convergence`（基于 `main` SHA: `4fc025a044e5e39d742166df9510d488413f7043`）
- **财务候选源**：`codex/p04-convergence-staging` (HEAD: `0239018b74b1fb9d143cb4747657cbfd795d644c`)
- **目标门禁**：保持 P07 V3 体验、P04 冻结金额契约、RELEASE_HELD、无数据库结构变动、无生产环境修改

---

## 一、Flash 已处理内容（Claude 无需处理，避免重复劳动）

1. **A 类（机械合并与样式，已完成）**：
   - 22 个非财务模块文件（`js/language/*`、`js/tools/*`、`js/transfer/app.js`、`js/core/keyed-list.js`、`app.js` 等）中的静态版本查询参数差异已统一至 P07 主线；
   - `docs/p07/P07_IMPLEMENTATION_READINESS.md`、`qa/aeris/p5-pwa-browser.mjs` 差异已机械对齐；
   - `workspace-experience.css` 已安全合入财务多币种列表布局样式（`.finance-transaction-side { min-width: 0; }` 及文本折行限制）。
2. **B 类（明确契约简单适配，已完成）**：
   - `index.html`：已在收敛工作区安全插入展示币种、基准币种、默认币种下拉框（`financeDisplayCurrency`, `financeAccountCurrency`, `financeDefaultCurrency`, `financeCurrencyStatus`）及交易/预算模态窗中的 6 币种选择器（`financeTransactionCurrency`, `financeBudgetCurrency`）；
   - `js/core/api.js`：已为 `/api/finance/` 和 `/api/notification/` 请求自动附加 `X-Finance-Money-Version: '3'` 请求头；
   - `js/core/dashboard.js`：首页结余看板已支持多币种及未折算提示格式化；
   - `sw.js`：已将 `/js/finance/money.js` 与 `/js/finance/ai-assistance.js` 加入 PWA Service Worker 预缓存清单；
   - `js/finance/format.js`、`js/finance/money.js`、`js/finance/notification-ledger.js` 已就绪。
3. **后端与数据库迁移**：
   - `functions/` 全部后端解析与准入服务、`cloudflare/migrations/0027-0034`、`qa/finance-p04/` 测试矩阵已完整迁入本工作区。
   - 经测试：`structural-binding-review.mjs` 6/6 PASS，`semantic-contract-matrix.mjs` 35/35 PASS。

---

## 二、Claude 编码任务清单（聚焦仅 2 个文件）

Claude 仅需关注并修改以下两个文件：
1. `js/finance/app.js`
2. `js/finance/candidates.js`

### 任务 1：`js/finance/app.js` 状态与多币种收敛

#### 1. 模块导入与依赖
在文件顶部引入 `money.js` 相关工具：
```javascript
import { parseMoney, moneyText, referenceValue, SUPPORTED_CURRENCIES, currencyDigits } from './money.js?release=20261109-aeris-p07-production-r2';
```
定义预授权控制状态常量：
```javascript
const AUTHORIZATION_CONTROL_STATES = new Set(["pending_authorization", "authorization_release", "authorization_expired"]);
const AUTHORIZATION_CONTROL_DIRECTIONS = new Set(["authorization_release", "authorization_expired"]);
function isAuthorizationControl(item) {
  return AUTHORIZATION_CONTROL_STATES.has(item?.reconciliation_state) || AUTHORIZATION_CONTROL_DIRECTIONS.has(item?.direction);
}
```

#### 2. 金额校验函数 `validateAmountText(value, label, currency = 'CNY')` 适配
- **现状（main）**：仅检查最大 2 位小数和 1000 亿上限。
- **目标行为**：
  - 动态获取该币种允许的小数位数：`const digits = currencyDigits(currency);`
  - 若 `digits === 0`（如 JPY），若输入包含小数则返回错误：`${label}日元不支持小数位`；
  - 若 `digits === 2`，超过 2 位小数返回错误：`${label}最多支持两位小数`；
  - 其余纯数字有效性、大于 0、1000 亿上限逻辑严格保留。

#### 3. 核心计算函数 `calculateFinanceSummary(transactions, options = {})`
- **现状（main）**：单币种累计，返回 `{ income_minor, expense_minor, refund_minor, balance_minor }`。
- **目标行为（必须支持 `options.display_currency` 与 `options.snapshots`）**：
  ```javascript
  export function calculateFinanceSummary(transactions, options = {}) {
    const bounds = options.month ? monthBounds(options.month) : null;
    const active = (Array.isArray(transactions) ? transactions : []).filter((item) => {
      if (!item || item.status === "deleted" || isAuthorizationControl(item)) return false;
      if (!bounds) return true;
      return item.occurred_at_ms >= bounds.startMs && item.occurred_at_ms < bounds.endMs;
    });
    const summary = { income_minor: 0, expense_minor: 0, refund_minor: 0, balance_minor: 0, count: active.length };
    const currencies = [...new Set(active.map(item => item.currency || 'CNY'))];
    const quote = options.display_currency || (currencies.length === 1 ? currencies[0] : 'CNY');
    const unconverted = [], byCurrency = {};
    const exact = { income_minor: 0n, expense_minor: 0n, refund_minor: 0n };
    for (const item of active) {
      const currency = item.currency || 'CNY';
      const normalizedItem = item.currency ? item : { ...item, currency };
      const value = referenceValue(normalizedItem, quote, options);
      const bucket = byCurrency[currency] ||= { income_minor: 0n, expense_minor: 0n, refund_minor: 0n };
      if (Object.hasOwn(bucket, item.direction + '_minor') && Number.isSafeInteger(item.amount_minor)) {
        bucket[item.direction + '_minor'] += BigInt(item.amount_minor);
      }
      if (!['same_currency', 'reference'].includes(value.status)) {
        unconverted.push({ id: item.id, currency, reason: value.status });
        continue;
      }
      if (Object.hasOwn(exact, item.direction + '_minor')) {
        exact[item.direction + '_minor'] += BigInt(value.amount_minor);
      }
    }
    exact.balance_minor = exact.income_minor + exact.refund_minor - exact.expense_minor;
    for (const [key, value] of Object.entries(exact)) {
      summary[key] = value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
    }
    const overflow = Object.values(summary).some(value => value === null);
    for (const bucket of Object.values(byCurrency)) {
      for (const [key, value] of Object.entries(bucket)) {
        bucket[key] = value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
      }
    }
    if (currencies.length > 1 || unconverted.length || (currencies.length === 1 && quote !== currencies[0])) {
      Object.assign(summary, {
        display_currency: quote,
        by_currency: byCurrency,
        unconverted,
        conversion_status: unconverted.length ? unconverted[0].reason : 'reference',
        reference_only: true
      });
    }
    if (overflow) Object.assign(summary, { has_overflow: true, conversion_status: 'amount_overflow' });
    return summary;
  }
  ```

#### 4. 走势图 `renderTrendChart()` 与收支总览 `renderSummary()` 协调
- 保留 main 的可折叠走势图（`toggleFinanceTrendBtn`、`applyTrendCollapse`、SVG 折线渲染与月度卡片）；
- 走势图渲染在多币种下，按 `summary.display_currency` 显示金额；若存在未换算账目，显示提示信息。

#### 5. 货币偏好设置交互 `fetchCurrencyPreferences()` 与 `saveCurrencyPreferences()`
- 监听 `financeDisplayCurrency`、`financeAccountCurrency`、`financeDefaultCurrency` 下拉选择变更；
- 调用 GET `/api/finance/currencies` 获取偏好并回填；
- 调用 POST `/api/finance/currencies` 更新用户币种设置（附带 revision 防并发冲突）；
- 发生变动后调用 `loadReferences()` 并刷新结余渲染。

#### 6. 记账与预算提交
- `submitTransaction`：从 `financeTransactionCurrency` 取出选中的币种；传给 `validateAmountText`；保存时根据币种设定 `amount_exponent`（JPY 为 0，其余为 2）。
- `submitBudget`：从 `financeBudgetCurrency` 取出选中的币种并保存。

---

### 任务 2：`js/finance/candidates.js` 待核实卡片与币种审核

#### 1. 待核实卡片角标与币种状态渲染
- 当 candidate 含有 `currency_review_required === 1` 或 `true` 时，在操作区域呈现待核实币种提示与下拉确认按钮；
- 显示来源币种（例如 `USD`、`EUR`、`JPY`、`CNY`）与识别来源；
- 当为预授权控制项时，展示对应的预授权状态，不可直接自动计入正式支出。

#### 2. 确认接口调用能力协商
- 当用户核实币种并确认账目时，调用 `/api/notification/candidates/confirm` 时传递 `chosen_currency` 或 `currency_decision_source: 'user_override'`；
- 兼容处理服务端返回的 `409 currency_client_upgrade_required`（提示用户刷新或升级客户端）。

---

## 三、定向验证与验收标准

Claude 完成上述两个文件的移植与适配后，在收敛工作区执行以下命令验证：

1. **财务契约套件（必须 39/39 PASS）**：
   ```bash
   node qa/finance-p04/contracts.mjs
   ```
   *当前仅因 `calculateFinanceSummary` 尚未输出 `unconverted` 产生 1 FAIL，实现后将变为 39 PASS / 0 FAIL。*
2. **单元审查套件（必须 19/19 PASS）**：
   ```bash
   node qa/finance-p04/unit-review.mjs
   ```
3. **P04 冻结矩阵与结构绑定（必须 35/35 及 6/6 PASS）**：
   ```bash
   node qa/finance-p04/structural-binding-review.mjs
   node qa/finance-p04/semantic-contract-matrix.mjs
   ```
4. **前端语法与静态检查**：
   ```bash
   node --check js/finance/app.js
   node --check js/finance/candidates.js
   python local-backend/test_static.py
   ```

---

## 四、后续 Flash 集成交接步骤

1. Claude 提交 `js/finance/app.js` 与 `js/finance/candidates.js` 的修改代码。
2. Flash 运行全量 `npm run test:task16`、`npm run test:task17`、`contracts.mjs` 以及浏览器流端到端回归。
3. Flash 确认全绿后，生成最终收敛交付证据，保持 PR #140 为 Draft，不触碰生产环境。
