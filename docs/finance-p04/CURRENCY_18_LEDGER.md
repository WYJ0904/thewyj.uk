# P04 原18项合同逐行账本

2026-10-24 最新复验：原样仍12 PASS / 6 EXPECTED_RED；版本化上下文18 PASS。逐行原输入/预期及新raw见 [最终证据索引](FINAL_EVIDENCE_INDEX.md)。下方保留2026-10-23逐行历史，不将其结果另加进本轮计数。

2026-10-23：当前合同 **18 PASS**；冻结原驱动原样执行仍 **12 PASS/6 EXPECTED_RED**。两种执行同时保留。

版本化驱动只补上原fixture声明但未转发的default_currency（当前policy2）与synthetic_rate=7/date（protocol2及真实产品FX/D1引用）。原fixture字节/哈希、checkExpected、DOM的/800/和/200/断言均不变；没有按金额/商户猜测，不把拒绝当成功。原D驱动的snake_case反射探针不是FO6业务值；FO6由真实持久化/回执/通知测试独立验证。

| Case | 原期望 | 原样驱动 | 当前合同执行 | 当前实际 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `D004` | `{"amount_minor":10000,"currency":"USD","direction":"EXPENSE","records":1}` | EXPECTED_RED | **PASS** | `{"amount_minor":10000,"currency":"USD","direction":"EXPENSE","records":1,"booked_currencies":["USD"],"booked_amounts_minor":[10000]}` | 原声明参数经版本化驱动传入 |
| `D008` | `{"amount_minor":10000,"currency":"HKD","direction":"EXPENSE","records":1}` | EXPECTED_RED | **PASS** | `{"amount_minor":10000,"currency":"HKD","direction":"EXPENSE","records":1,"booked_currencies":["HKD"],"booked_amounts_minor":[10000]}` | 原声明参数经版本化驱动传入 |
| `D012` | `{"amount_minor":10000,"currency":"USD","direction":"EXPENSE","records":1}` | PASS | **PASS** | `{"amount_minor":10000,"currency":"USD","direction":"EXPENSE","records":1,"booked_currencies":["USD"],"booked_amounts_minor":[10000]}` | 原驱动已直接验证通过 |
| `D016` | `{"amount_minor":10000,"currency":"USD","direction":"EXPENSE","records":1}` | EXPECTED_RED | **PASS** | `{"amount_minor":10000,"currency":"USD","direction":"EXPENSE","records":1,"booked_currencies":["USD"],"booked_amounts_minor":[10000]}` | 原声明参数经版本化驱动传入 |
| `D020` | `{"amount_minor":10000,"currency":"HKD","direction":"EXPENSE","records":1}` | EXPECTED_RED | **PASS** | `{"amount_minor":10000,"currency":"HKD","direction":"EXPENSE","records":1,"booked_currencies":["HKD"],"booked_amounts_minor":[10000]}` | 原声明参数经版本化驱动传入 |
| `D024` | `{"amount_minor":10000,"currency":"USD","direction":"EXPENSE","records":1}` | PASS | **PASS** | `{"amount_minor":10000,"currency":"USD","direction":"EXPENSE","records":1,"booked_currencies":["USD"],"booked_amounts_minor":[10000]}` | 原驱动已直接验证通过 |
| `DW-FMT-JPY-10000` | `"JP¥10,000"` | PASS | **PASS** | `"JP¥10,000"` | 原驱动已直接验证通过 |
| `DW-FMT-JPY-12345` | `"JP¥12,345"` | PASS | **PASS** | `"JP¥12,345"` | 原驱动已直接验证通过 |
| `DW-MIX-USD` | `80000` | PASS | **PASS** | `80000` | 原驱动已直接验证通过 |
| `DW-MIX-EUR` | `90000` | PASS | **PASS** | `90000` | 原驱动已直接验证通过 |
| `DW-MIX-HKD` | `19000` | PASS | **PASS** | `19000` | 原驱动已直接验证通过 |
| `DW-MIX-GBP` | `105000` | PASS | **PASS** | `105000` | 原驱动已直接验证通过 |
| `DW-MIX-JPY` | `60000` | PASS | **PASS** | `60000` | 原驱动已直接验证通过 |
| `DW-HISTORY-2026-10-18` | `70000` | PASS | **PASS** | `70000` | 原驱动已直接验证通过 |
| `DW-HISTORY-2026-10-19` | `70000` | PASS | **PASS** | `70000` | 原驱动已直接验证通过 |
| `DW-FX-MISSING-OFFLINE` | `"missing_historical_rate"` | PASS | **PASS** | `"missing_historical_rate"` | 原驱动已直接验证通过 |
| `DW-DOM-MIXED-budget` | `"spent 800.00 CNY or explicit unconverted grouping; never unqualified spent 200.00 CNY"` | EXPECTED_RED | **PASS** | `"已用 ¥800.00 "` | 原声明参数经版本化驱动传入 |
| `DW-DOM-MIXED-category` | `"spent 800.00 CNY or explicit unconverted grouping; never unqualified spent 200.00 CNY"` | EXPECTED_RED | **PASS** | `"合成分类¥800.00"` | 原声明参数经版本化驱动传入 |

输入/断言未改的证明：[adaptations.json](../migration-evidence/finance-p04/local/contract-input-drivers/adaptations.json)。全输入、before/after和错误：[currency-18.json](../migration-evidence/finance-p04/local/final-r2/delivery-v2/currency-18.json)。未覆盖或真实业务不可验证的项目仍见统一报告NOT_TESTED，不能据18项通过宣布整体COMPLETE。
