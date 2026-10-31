# ISO币种P0防错门禁

日期：2026-10-19（Asia/Hong_Kong）。P02基线 `6ff9b9fd89bb6dedf5837f28421825c4418925f9`；产品基线 `1398c76d9321919ac8c94550f2d23c2c8e1a1e84`；实施提交 `bbe97a6b1fdc1e618eae2b3ca7d2c87be648ed82`；分支 `codex/finance-p03-identity-preauth`。最终文档提交与Git tree见本地证据 FINAL_REVISION.json。


原问题经P02动态证明：12条明确单一USD/EUR/HKD/GBP/JPY输入在产品parser/coordinator写为CNY。P03同时修安全解析装配、Hook、捕获上传、持久恢复、确认payload与Worker门禁，不能只修页面或只修parser。完整原币证据、currency与配对金额保留，不删除ISO词、不添加汇率。

六种明确单位采用现有amount/currency表示；JPY原币minor为零位，其他冻结六币种为两位。没有做FX、用户币种配置、今日/历史汇率、混币预算或格式修复。多币种/多个不一致金额进入待核实。AUD/CAD/BHD等运行时已知但本轮不支持的明确ISO保留code和证据、金额不猜并阻断正式账；货币样式商户词不应覆盖明确CNY的控制用例已通过。

Worker结构化字段与明确currency_evidence冲突拒绝，无意义新CNY账不得生成；旧raw接口从现金文本识别明确ISO，冲突保留pending、原币代码/证据，金额置未证实，不把不明单位猜成CNY。运行时币种目录只用于code识别，不是市场数据（[ECMA-402 Intl.supportedValuesOf](https://tc39.es/ecma402/#sec-intl.supportedvaluesof)）；真实设备目录及真实业务输入未测。

原已入账的历史外币不自动批量改；owner需要另行授权历史数据核查。JPY显示仍有原formatter除100问题，月/预算/分类混币合计与历史FX仍红，必须在P04处理后才能以完整多币种产品发布。P03正确存币种不等于这道发布门禁通过。
