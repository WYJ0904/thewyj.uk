# Task 25 正式发布 Closure Report — 2026-10-09

网站 https://thewyj.uk/ 与正式 Android 1.3.36/49 已实际发布。24项 Samsung 必需验收全部通过。最终精确 main CI的8项实际全部成功，Release A / Task25已完成，没有未解决的本轮阻断。

| 项目 | 本次实际证据与结果 |
| --- | --- |
| PR96 | 已 Ready 并合并；原合并 main829336098d3ef520e8850f74caa405b963bc357d |
| 最终 main / 正式签名来源 | f9baa86d85702cca74811b13508cd8067de31132；完整树 fa287a61fe612eb92715b04264b6358e8f5ee78c；标准 release 重新构建、原签名独立验证，字节与所有24项真机、R2及公开下载完全相同 |
| 最终 CI | [37909888712](https://github.com/WYJ0904/thewyj.uk/actions/runs/37909888712) — 最终f9baa86实际8/8 SUCCESS；发布前893a769的37906434926实际8/8已通过 |
| Production | 1e67f1e0-43d2-402d-b819-484efa4979ee；现有项目thewyj-uk；main f9baa86d85702cca74811b13508cd8067de31132；服务ON已写入Git，初始及测试功能定义全部OFF |
| Preview | 原API8组、真实UI9类及下载/隔离R2通过；前7类Chrome、kill与审计由当时可用内置Chromium补验。最终Preview e04db165.thewyj-uk.pages.dev由d458450精确源码部署，独立Preview49对象回读及最终下载/缓存通过。最终main追加的QA断言和已保留的changelog滚动修复不改Android/server/Feature Flag逻辑 |
| 0024 | canonical SHA67712cbe6da1f35fdd59d2b4806c164869e06d840b1ae652a3e8f6f082018173；正常migrations apply成功一次；配置ledger wyj_d1_migrations中仅1条，schema_version1，11显式对象+4自动主键索引；两初始定义OFF/revision1；备用import未执行 |
| 业务数据 | Production82张既有表保留，Finance/文件等计数不减；原账号未重设密码/登录。三条本轮独有QA账号已软撤销，两个本轮无业务消费者flag OFF/killed/0，审计保留 |
| 设备 | Samsung SM-S9360，真实Android16/SDK36/ADB；实际未发布49→正式候选49 install-r，未卸载/clear data/降级。签名连续、原账户服务端会话恢复，98条原账本数量与完整hash保留，原账户各Room表保留 |
| 正式APK | uk.thewyj.app，1.3.36 / 49，48,124,971字节；SHA256 798ef91a7be32c8d6e181ff4813a173014c0bce73ca4f93077c7030df63ccb48 |
| 正式AAB | 24,744,491字节；SHA256 2ca2c15e8c934f609e4454aa5f12bbb29693f83fdcc72dfe6d5c80abcf2ce60a |
| 原证书 | 2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03；未新建/替换keystore，签名材料只在本机使用 |
| R2 / 指针 | Production wyj-cloud-production与Preview wyj-cloud-preview各自新版本化key app/android/thewyj-android-1.3.36.apk；都实际上传并完整回读相同798…/48124971。旧1.3.33/46对象保留；元数据和移动下载指针在一次部署中切49 |
| 公开最终验证 | /api/app/config与/api/app/download成功；HEAD、browser/native/WebView HTTP代理、缓存miss/旧validator全部相同49完整字节；另行下载后原签名/包名/版本/大小/hash46项独立检查通过；HTTP代理证据与24项实际物理证据分开保存 |
| 真机发布后复验 | 原账号的真实原生“检查更新”显示已是最新版，读取正式49与相同checksum/size；系统安装权限保留。WiFi/mobile1/1，原系统触感设置0已恢复 |
| 回滚 | 原840c4eaa-30b8-483c-9ba1-ee5159332932、完整旧配置和私有TimeTravel书签保存；优先回滚整个已验证Pages配置，保留旧/新R2；本轮未DROP/reset/恢复D1书签 |
| 历史微信录屏 | 本机原始字节保留，不覆盖、不删除、不宣称Bug自然消失；22,828,592字节，SHA2568749a9913f62109e9fbacb0e02697dd67925ca2c9b6bf0b72be4e7f4c511af39；录屏和原通知内容只保存在本机 |

## 24项真实物理验收

| 必需观察 | 结果 | 真实证据 |
| --- | --- | --- |
| package_version | PASS | samsung-upgrade-preservation.json; exact original-signed install-r; before/after real audit; installed APK hash798ef91a |
| signing_continuity | PASS | samsung-upgrade-preservation.json; exact original-signed install-r; before/after real audit; installed APK hash798ef91a |
| session_preservation | PASS | samsung-upgrade-preservation.json; exact original-signed install-r; before/after real audit; installed APK hash798ef91a |
| room_data_preservation | PASS | samsung-upgrade-preservation.json; exact original-signed install-r; before/after real audit; installed APK hash798ef91a |
| back | PASS | task25-native-lifecycle.json actual unmodified R8 MainActivity; UI navigation and live snapshot invalidation/restoration on physical S25+ |
| resume | PASS | task25-native-lifecycle.json actual unmodified R8 MainActivity; UI navigation and live snapshot invalidation/restoration on physical S25+ |
| cold_start | PASS | task25-native-lifecycle.json actual unmodified R8 MainActivity; UI navigation and live snapshot invalidation/restoration on physical S25+ |
| warm_start | PASS | task25-native-lifecycle.json actual unmodified R8 MainActivity; UI navigation and live snapshot invalidation/restoration on physical S25+ |
| webview_native_consistency | PASS | native-channels-webview.json actual original signed R8 gateway; physical native UI changes, same canonical account/Stable/ON in real WebView DOM |
| account_targeting_rollout | PASS | native-decision override_off/on/inherit and independent SHA bucket exact percentage_off/on boundary; actual physical original R8 SDK state matches every real server mutation |
| stable_beta_experimental | PASS | native-channels-webview.json actual original signed R8 gateway; physical native UI changes, same canonical account/Stable/ON in real WebView DOM |
| kill_switch | PASS | native-decision-kill.json actual live physical native OFF reason kill_switch; restored ON verified |
| offline_flag_fallback | PASS | native-network.json real device networks disabled/restored; actual native ON->closed->ON with original signed gateway |
| offline_startup | PASS | native-offline-cold.json force-stopped physical app cold startup while real WiFi/mobile0; cached account retained/no fresh login/flagsOFF |
| online_to_offline | PASS | native-network.json real device networks disabled/restored; actual native ON->closed->ON with original signed gateway |
| flag_service_unavailable | PASS | owned-quota-failure.json: real Production GET144 only disposable account; HTTP200118/42926; native-service-unavailable.json actual native closes flags with retryable429 while physical network and cached identity retained; no mocks/proxy/global service disable |
| foreground_background | PASS | task25-native-lifecycle.json actual unmodified R8 MainActivity; UI navigation and live snapshot invalidation/restoration on physical S25+ |
| webview_reload | PASS | native-webview-reload.json actual SDK WebView.reload; same native/Web canonical QA identity/Stable/ON after reload |
| process_restoration | PASS | native-process-restoration.json after actual external am force-stop; same persisted owned account and live Stable/ON through original R8 gateway |
| network_recovery | PASS | native-network.json real device networks disabled/restored; actual native ON->closed->ON with original signed gateway |
| apk_update_metadata | PASS | native-update-46.json real native UI checks current public Stable46; correct checksum/size and UpToDate for installed49; no downgrade |
| release_channel_recognition | PASS | native-channels-webview.json actual original signed R8 gateway; physical native UI changes, same canonical account/Stable/ON in real WebView DOM |
| haptic | PASS | native-haptic-feedback-proof.json real UI action with system feedback temporarily enabled, application UID10406 completed; original disabled0 restored; disabled honor separately verified |
| system_install_permissions | PASS | native-update-46.json real PackageManager.canRequestPackageInstalls true existing permission; no permission change |

## 修正及失败历史

- PR98网站日志更新使tracked bootstrap OFF覆盖已验收ON部署，实际观察到task25_disabled。只持久化已授权的两个master ON字段，保留所有既有配置与两个初始OFF定义；后续Git部署不再把服务关闭。
- 上线后QA脚本仍将版本46写死，最终d458450 CI的cloud/browser步骤在preflight实际失败。改为严格对照当前正式元数据的包名、版本名/码、hash和大小，不跳过步骤或降低权限/数据门禁。旧失败CI保留。
- 私有R8测试工具的标准库兼容和旧QA会话副本问题已纠正，失败记录保留；产品混淆/网关和原用户登录流程未放宽。最终故障测试仅对独有QA账号真实GET144触发26次HTTP429，网络保持在线，实际原生安全关闭功能；未伪造503或关闭全体Production服务。
- 已保留另一个网站更新PR101的changelog滚动修复。所有共享静态URL同步更新到20261009-task25-release49；Chrome正常加载最新网站日志和正式49下载信息，31项static/module graph与22项release guard自测通过。
- 正式指针49后，同版本candidate override被现有保护正确拒绝；使用标准release默认49重新构建和独立验证，未弱化“候选必须高于Stable”的保护。

## 范围与下一阶段

仅Release A / Task25。五项专项pending_recovery_identity、finance_pending、legacy_local_only_recovery、notification_finance_sync、amount_notification_accounting仍为NOT_EXECUTED / 后续独立APK修复；它们没有因延期标PASS。Release B和Task26均未开始。私有凭据、keystore、书签、真实通知/录屏未提交GitHub。

TASK_25_SOFTWARE: PASS
TASK_25_PRODUCTION: PASS
TASK_25_ANDROID_RELEASE: PASS
TASK_25_PHYSICAL_ACCEPTANCE: PASS
TASK_25_RELEASE_STATUS: COMPLETE
READY_FOR_ANDROID_REPAIR: YES
READY_FOR_TASK_26: NO

最终CI全部8项见final-main-ci.json；原始phone录屏路径在本轮只读回查未找到，受保护的本机原始文件22,828,592字节/hash8749…已实际再次验证，未执行手机媒体删除或覆盖。此处没有把手机路径查询当作录屏已消失或Bug已修复的结论。
