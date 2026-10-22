# P04 原冻结 18 项逐行账本

2026-10-22，Asia/Hong_Kong。**12 PASS / 6 EXPECTED_RED**。原 fixture、ID 和断言未改；
以下仅从实际冻结重放抽取，不能用派生 fixture 的通过替代原行。完整原输入、原错误、
expected、actual 和日志路径保存在 [逐行 JSON](../migration-evidence/finance-p04/cloud/final-20261022/delivery-final-v2/currency-18.json)。

| 原 ID | 原结果 → 当前结果 | 原期望 | 当前实际 | 处理/限制 |
| --- | --- | --- | --- | --- |
| `D004` | EXPECTED_RED → **EXPECTED_RED** | `{"amount_minor":10000,"currency":"USD","direction":"EXPENSE","records":1}` | `{"amount_minor":10000,"currency":"CNY","direction":"EXPENSE","records":1,"booked_currencies":["CNY"],"booked_amounts_minor":[10000]}` | 原驱动未传 default_currency，运行 policy 1；原红灯保留。policy 2 同输入/预期的单独转发测试通过。 |
| `D008` | EXPECTED_RED → **EXPECTED_RED** | `{"amount_minor":10000,"currency":"HKD","direction":"EXPENSE","records":1}` | `{"amount_minor":10000,"currency":"CNY","direction":"EXPENSE","records":1,"booked_currencies":["CNY"],"booked_amounts_minor":[10000]}` | 原驱动未传 default_currency，运行 policy 1；原红灯保留。policy 2 同输入/预期的单独转发测试通过。 |
| `D012` | EXPECTED_RED → **PASS** | `{"amount_minor":10000,"currency":"USD","direction":"EXPENSE","records":1}` | `{"amount_minor":10000,"currency":"USD","direction":"EXPENSE","records":1,"booked_currencies":["USD"],"booked_amounts_minor":[10000]}` | 原币/清算/手续费分角色，原币 USD 10000 不被 CNY 清算覆盖。 |
| `D016` | EXPECTED_RED → **EXPECTED_RED** | `{"amount_minor":10000,"currency":"USD","direction":"EXPENSE","records":1}` | `{"amount_minor":10000,"currency":"CNY","direction":"EXPENSE","records":1,"booked_currencies":["CNY"],"booked_amounts_minor":[10000]}` | 原驱动未传 default_currency，运行 policy 1；原红灯保留。policy 2 同输入/预期的单独转发测试通过。 |
| `D020` | EXPECTED_RED → **EXPECTED_RED** | `{"amount_minor":10000,"currency":"HKD","direction":"EXPENSE","records":1}` | `{"amount_minor":10000,"currency":"CNY","direction":"EXPENSE","records":1,"booked_currencies":["CNY"],"booked_amounts_minor":[10000]}` | 原驱动未传 default_currency，运行 policy 1；原红灯保留。policy 2 同输入/预期的单独转发测试通过。 |
| `D024` | EXPECTED_RED → **PASS** | `{"amount_minor":10000,"currency":"USD","direction":"EXPENSE","records":1}` | `{"amount_minor":10000,"currency":"USD","direction":"EXPENSE","records":1,"booked_currencies":["USD"],"booked_amounts_minor":[10000]}` | 原币/清算/手续费分角色，原币 USD 10000 不被 CNY 清算覆盖。 |
| `DW-FMT-JPY-10000` | EXPECTED_RED → **PASS** | `"JP¥10,000"` | `"JP¥10,000"` | JPY exponent=0，无 100 倍缩放。 |
| `DW-FMT-JPY-12345` | EXPECTED_RED → **PASS** | `"JP¥12,345"` | `"JP¥12,345"` | JPY exponent=0，无 100 倍缩放。 |
| `DW-MIX-USD` | EXPECTED_RED → **PASS** | `80000` | `80000` | 精确原币最小单位及有明确参考时的汇总。 |
| `DW-MIX-EUR` | EXPECTED_RED → **PASS** | `90000` | `90000` | 精确原币最小单位及有明确参考时的汇总。 |
| `DW-MIX-HKD` | EXPECTED_RED → **PASS** | `19000` | `19000` | 精确原币最小单位及有明确参考时的汇总。 |
| `DW-MIX-GBP` | EXPECTED_RED → **PASS** | `105000` | `105000` | 精确原币最小单位及有明确参考时的汇总。 |
| `DW-MIX-JPY` | EXPECTED_RED → **PASS** | `60000` | `60000` | 精确原币最小单位及有明确参考时的汇总。 |
| `DW-HISTORY-2026-10-18` | EXPECTED_RED → **PASS** | `70000` | `70000` | 历史快照不被后续现价替换。 |
| `DW-HISTORY-2026-10-19` | EXPECTED_RED → **PASS** | `70000` | `70000` | 历史快照不被后续现价替换。 |
| `DW-FX-MISSING-OFFLINE` | EXPECTED_RED → **PASS** | `"missing_historical_rate"` | `"missing_historical_rate"` | 缺汇率显式失败/分币，不用 1:1。 |
| `DW-DOM-MIXED-budget` | EXPECTED_RED → **EXPECTED_RED** | `"spent 800.00 CNY or explicit unconverted grouping; never unqualified spent 200.00 CNY"` | `"已用 ¥100.00 "` | 无传入汇率，实际分币并提示待折算；原断言仅匹配 800，继续为红。 |
| `DW-DOM-MIXED-category` | EXPECTED_RED → **EXPECTED_RED** | `"spent 800.00 CNY or explicit unconverted grouping; never unqualified spent 200.00 CNY"` | `"合成分类¥100.00合成分类 · 原币未换算US$100.00"` | 无传入汇率，实际分币并提示待折算；原断言仅匹配 800，继续为红。 |

四项 default_currency 的当前原始重放仍得到 CNY，不能宣称这些原断言已绿。实际产品 hook
使用账户上下文和 policy 2；新 `CurrencyFrozenDefaultsTest` 将原六条 fixture 的声明默认币
显式传入，同输入/expected 另证通过。原 fixture 不改，派生转发/实际 hook 结果分开保存。

两项 DOM 的期望描述允许明确分币，但原 `/800/` 判定不接受分币；synthetic_rate 没有传到
产品 controller。缺汇率时不从外部 fixture 读取答案、不硬编码 7，不将分币实际值伪装成
800。真实 Chromium 另验证有参考/缺参考、预算/分类和历史场景。

这些差异均保留为原合同未达，不以解释把状态改 PASS。P04 因此仍为 PARTIAL。
