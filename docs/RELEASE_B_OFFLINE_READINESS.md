# Release B 离线软件验收与剩余真机门禁

基线：codex/aeris-unified-repair-release-b，自已正式发布的main f9baa86开始；原签名Stable仍为1.3.36/49。新APK准备使用1.3.37/50，候选不等于正式发布。Task26未开始。

已实现的网站部分：充值状态容器透明，仅状态文字有小Badge；确认日期时间独立成行；四类状态数据、订单号、套餐、金额、付款方式保留。小屏320px最小宽度和浮动版本提示遮挡也已修正。顶部“下载Android/更新日志”为相邻的中性图标描边入口，所有视口保持可见；页脚链接移至折叠面板外。

日志首次进入以最新日期/数字版本排序；静态已审查内容优先于相同build的旧缓存/API副本，远程独有历史保留。显式点击旧版本后，同文档会话返回可恢复；新文档/旧hash默认最新；新版提示的查看详情明确回到最新。

Android软件部分：Scaffold内容正确消费insets，处理IME和底部留白；通道按钮8dp圆角、至少48dp触控高度，长名称和选中标记分开允许换行。权限中心区分系统授权与服务连接，观察连接变化刷新；状态Pill/标题允许换行，无自动授权。Launcher/adaptive26/adaptive33/monochrome/notification资源已经指向仓库正式Aeris资产，未为了代码改动重新绘制品牌。

软件证据：538 JVM测试0失败/0跳过、Android lint、31static检查、CoreJS回归；12组真实Chromium视口（390/768/1440/1920与100/125/150等效重排）无横向溢出，字段/日期完整，按钮无浮层遮挡；首次最新/旧版本返回、页脚位置和去重有实际DOM/截图证据。

浏览器限制必须保留：Chrome尺寸接口后续未实际生效，失败记录与实际1707px数据保留。Chrome设置页被浏览器安全策略拒绝；快捷键未改变缩放，因此125/150原生Chrome缩放仍UNVALIDATED。替代矩阵明确是受支持的Chromium视口等效重排，不能把该方法写成原生缩放PASS。

手机当前离线。正常/放大字体、真实Samsung旋转/键盘/冷暖恢复、OneUI桌面和应用详情图标/缓存、覆盖安装数据保留、实际权限绑定、微信应用分身/支付宝金额与重复记账/Room云同步均UNVALIDATED，不能以JVM、桌面或历史Task25结果代替。

原录像之后Accessibility/parser/Finance相关链路确实曾修改，基线history和原始hash8749…保留。按用户要求，当前正式HEAD+真实微信分身的首次基线复现必须先执行；金额/分身路由行为修复不依据包名猜测不同Android实例，不假定旧Bug消失。当前包名启动器尚未保存/核验profile身份，这是待真机验证的风险点，不宣称根因已在当前设备确认。

此分支不改公开APK元数据、Task25服务/权益/支付API；所有网页修改随完整Release B合并，不单独提前上线。既有未提交的Android专项工作仍在原stash/备份，未盲目合入。

RELEASE_A: COMPLETE
RELEASE_B_SOFTWARE: IN_PROGRESS_CI_AND_SIGNED_BUILD
RELEASE_B_PHYSICAL: UNVALIDATED_DEVICE_OFFLINE
RELEASE_B_STABLE_PROMOTION: BLOCKED_FINAL_DEVICE_GATES
TASK26: NOT_STARTED
