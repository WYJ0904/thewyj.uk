# 受保护工作区与边界核验

日期：2026-10-19（Asia/Hong_Kong）。P02基线 `6ff9b9fd89bb6dedf5837f28421825c4418925f9`；产品基线 `1398c76d9321919ac8c94550f2d23c2c8e1a1e84`；实施提交 `bbe97a6b1fdc1e618eae2b3ca7d2c87be648ed82`；分支 `codex/finance-p03-identity-preauth`。最终文档提交与Git tree见本地证据 FINAL_REVISION.json。

| 范围 | 文件数 | 新增/缺失/改变 | HEAD/branch/dirty |
| --- | --- | --- | --- |
| main | 832 | 0/0/0 | 相同 |
| repair | 840 | 0/0/0 | 相同 |
| task26 | 826 | 0/0/0 | 相同 |
| d01 | 859 | 0/0/0 | 相同 |
| d01control | 829 | 0/0/0 | 相同 |
| d02 | 871 | 0/0/0 | 相同 |
| candidate | 881 | 0/0/0 | 相同 |
| p02 | 901 | 0/0/0 | 相同 |
| phase3 | 140 | 0/0/0 | 原始证据相同 |
| d01Evidence | 870 | 0/0/0 | 原始证据相同 |
| d02Evidence | 207 | 0/0/0 | 原始证据相同 |
| candidateEvidence | 366 | 0/0/0 | 原始证据相同 |
| p02Evidence | 196 | 0/0/0 | 原始证据相同 |

before在产品修改前记录；after在所有构建/回归后重新逐文件SHA。脚本只有文件系统/Git，不使用ADB。固定主工作区WIP、Task26、旧修复、D01/对照/D02/候选/P02的HEAD、branch、dirty与文件hash均相同，ignored原始证据也单列保护。P02的报告/fixture/test和原始日志未覆写；本轮重跑输出均在新worktree。

只修改本P03产品分支。正式applicationId、签名/版本、依赖、Manifest权限、会员、旗标、release配置无Git内容差异；关键配置和schema1–10的原Git blob已复核，Windows换行不作为产品改动。外部受保护树按实际文件字节SHA核验。没有读取正式手机或App数据，故其实际安装/数据状态NOT TESTED，只能确认本轮未操作，不能冒称设备校验PASS。没有Production、D1/R2、账户、推送、合并、PR写入、发布或Task26启动。共享Git只新增本分支/本地提交，不改受保护分支。

最终commit/tree、产品/测试/fixture/报告/原始证据SHA清单见FINAL_REVISION.json与provenance.json；不提交secrets、签名材料、金融原文或重建产物。
