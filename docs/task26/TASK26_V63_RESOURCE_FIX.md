# Task26 PR #144：V6.3 资源与缓存修复

2026-11-11，Asia/Hong_Kong。继续原 Worktree 和分支
`codex/task26-final-convergence`，PR 保持 Draft，不合并、不部署。

## 原失败与最小修复

原 HEAD：`40ccb091631eaa66c529b8db7a30b71501cccdb3`。
[Core CI 42947559836](https://github.com/WYJ0904/thewyj.uk/actions/runs/42947559836)
在 JavaScript → Test core JavaScript modules → sw-install.test.mjs 失败：
Expected81 / Actual83。此前把两个新模块加入冻结 CORE_SHELL 是错误的资源边界。
本轮本地先复现 exit1，原日志和远端失败日志均保留。

修复提交 `f816bbf41597740a3bb1989083c11ffd27549637`：

- CORE_SHELL 恢复为原81项，原5个RC5测试体逐字比较保持不变。
  原独立归一化 SHA-256 继续为
  `a33d01c43f6f20a6963ab1384fb2305ee3b2447e0e68dc8c1f3015f1a2a6deae`。
- 两个模块放入独立 TASK26_SHELL，仍是**必须成功**的静态依赖。安装计划为
  原81+Task26两项，合计83；任一必需资源失败，整批拒绝，不转为可选资源。
- Task26修改的9个静态文件（含HTML两个URL）增加规范化UTF-8内容完整性校验，
  CRLF按LF校验；旧脚本不能因沿用P07 URL而混入。index只增加发布身份meta，
  页面、学习逻辑、模块URL和正式配置不改。
- 新发布使用内容指纹命名的独立缓存，完整静态图及HTML复制完成后才写提交
  marker并激活。旧 worker 的 CACHE 写入不能覆盖新发布；新发布运行时只读，
  迟到的旧HTML内容校验失败时使用完整已发布HTML，不重新写入静态缓存。
- 既有旧缓存不改写。只有没有旧 active worker、没有旧缓存的全新环境，才
  创建包含完整83项的兼容快照；现存旧版本、用户Cache、localStorage、IDB保留。
- 原并发6、响应体deadline、失败清理和Future/旧release隔离保持。未降低超时、
  关闭断言或把Task26依赖混入 OPTIONAL_BRAND_ASSETS。

发布内容指纹：
`efeb501ab7ab59b008ab7cc978fc448414a2ec69e44772ffd1f10e549920f4f3`。
它用于发布静态字节一致性，不是正式业务或Production恢复验收。

## 同一步骤后续暴露的兼容问题

继续执行原 CI 步骤时，B1暴露旧错题重复提交不是幂等：两个payload均没有
review_id时，Task11误加空review，reviewed为7/8。经所有者明确追加授权，
仅在 `functions/_lib/task11-model.mjs` 增加 `!left.review_id` 一行保护。
原B1预期不改，之后reviewed8/8、D1/API15/15通过；历史负对照失败照旧保留。
没有修改财务模块或扩大Task26功能。

旧导航单测夹具原先只提供单个HTML、未安装完整图，现改为真实发布字节并先
完成原子安装；原缓存/API断言保持。未允许导航先制造不完整离线壳。

## 已执行验证

| 验证 | 实际结果 |
| --- | --- |
| 精确失败测试 `node --test qa/p07-release/sw-install.test.mjs` | 13 PASS；原5个测试体及81/SHA断言不变，新增必需层失败、混入旧脚本、迟到导航/旧缓存写入、缺发布缓存、不可变重装等控制 |
| 原步骤 core JS / P07 runtime-state | Core JS PASS；runtime-state61 PASS |
| B1 / rollback presentation | server reviewed8/8；API/D1 15/15；Python reviewed9/9；presentation1 PASS |
| `npm run test:task26` | 缓存修复后完整命令exit0；授权的一行保护后另补错题D1 13组PASS |
| `npm run test:task11` | 授权保护后model7 / API10 / D1 10组PASS |
| 实际Chromium PWA | 原正常/慢网/失败重试/body超时/暖启动及Task26失败/旧脚本混入，共7项PASS；成功安装的离线83项逐项SHA均匹配 |
| 当前main旧缓存升级 | 以4fc025a为实际旧字节，升级与Task26层失败回滚两项PASS；旧缓存完整hash清单升级前后相同，失败后离线旧HTML hash不变 |
| 错题浏览器390px | 11项PASS，包含离线冷重载的Runtime/IDB原事件保留、正常身份恢复后同轮次/事件ID/分数恢复，以及旧票据、显式导入 |
| 模块图 / 存储键 / main静态检查 | 60文件98imports / 31类 / 31 tests均PASS |

PWA静态浏览器受测SHA为上述f816bbf；之后仅追加授权的Task11保护、QA夹具
和报告，静态发布源字节不变。最终完整SHA还须由远端Core CI重新执行确认；
结果见本PR Checks及最终交付回执，不将未完成CI写成PASS。

## 失败保留及边界

所有本轮原始证据位于忽略目录 `docs/migration-evidence/task26-v63/`：
`sw-before.log`、原远端失败、sw-unit、PWA两组results.json、Task11/B1和浏览器
各attempt均保留，没有覆盖旧验收记录。

新增冷重载QA首次错误地等待P07在断网时直接展示需身份恢复的工作区，原安全
门禁未改；改为离线核对模块、Runtime和IDB，再经正常重连核对原事件。后续
夹具按现有row.input结构核对作用域。一次本地Wrangler断连另留FAIL_ENV日志；
只复用仓库既有、限定8894/CI的4.118 workaround及其自测，未升级锁文件或
隐藏请求失败。最终完整浏览器验收通过，不覆盖此前失败。

本次只改缓存发布、对应既有测试夹具、index发布meta，以及追加授权的一行
Task11保护。#141/#143、Android、财务模块、Production及正式配置不动，
没有新功能、数据库迁移或测试框架。原 `CLOSED_WITH_OWNER_WAIVER` 不变，
未测的Samsung真机项目继续不标PASS。

## 后续完整CI与回滚验证

已推送的 `12de11c4305a30db2625a3dc8651fc16f9db1cfd` 对应
[Core CI 42967901326](https://github.com/WYJ0904/thewyj.uk/actions/runs/42967901326)：
原失败步骤及JavaScript job成功；完整run仍为8 SUCCESS / 2 FAIL。
application失败于旧断言“离线答对一次应删除错题”；Cloud-only失败于PWA
旧单层缓存清单未包含已验证的新发布缓存。未将这次run标PASS。

随后资源侧继续补齐：派生rollback重命名后重算内容校验、刚观察到的版本不被
重用token的旧缓存覆盖、不同release切换时保留完整兼容缓存。本地提交
`99af438981c78c46d9ad64dbaf95790b551ec7d9`、
`7a7def6d63540443387267adf35fcc8daf42aca9` 已完成：缓存/派生回滚18项PASS，
现有完整rollback-browser的回滚、离线旧客户端、身份恢复、再前滚和三卡7项
全部PASS；该浏览器测试的原断言未改。

两处旧浏览器断言的合同对齐已向所有者单独请求授权，尚未实施。原81项和
SHA断言保持原样，学习逻辑未改；后续提交暂不推送，以免在已知未对齐的
测试上反复启动同一失败CI。待授权后严格验证发布marker/83项，并核对答对
后原错题、原事件和分数保留，再运行完整浏览器与精确SHA远端CI。
