# Task27 开源参考、运行环境与安全复核

核查日期：2026-11-15。对象为现有 Task27 的增量完善；不是新认证系统。
前一实现检查点：`4167af98b38ae6c11c632e0b58b3902e62e57c3f`。
研究只使用项目官方代码、文档和许可证；没有运行外部仓库的开发指令。

## 五个项目的取舍

| 项目 | 官方资料与许可证 | 参考及实际采用 | 运行环境与未引入的原因 |
| --- | --- | --- | --- |
| OTPAuth 9.6.0 | [TOTP 代码](https://github.com/hectorm/otpauth/blob/master/src/totp.js)、[package/导出](https://github.com/hectorm/otpauth/blob/master/package.json)、[MIT](https://github.com/hectorm/otpauth/blob/master/LICENSE.md) | 参考 URI、6 位/SHA-1/30 秒配置及窗口验证；仅作独立测试 oracle。现有 Web Crypto 实现与其通过 256 组生成/验证交叉校验，保留原实现。 | 官方支持 Node、Deno、Bun、浏览器；默认浏览器 ESM 在实际本地 workerd 中通过。该实测不代表所有 Workers 配置都受官方保证。未增加生产依赖；其发行包含 Noble hashes，单纯换库也不能替代 D1 并发防重放与密钥加密。 |
| Better Auth | [2FA 文档](https://better-auth.com/docs/plugins/2fa)、[TOTP 插件代码](https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/plugins/two-factor/totp/index.ts)、[Cloudflare 指南](https://better-auth.com/docs/guides/cloudflare)、[MIT](https://github.com/better-auth/better-auth/blob/main/LICENSE.md) | 对照先验证绑定再启用、登录挑战不产生完整会话、恢复与重新认证等生命周期。 | 官方 Cloudflare 指南涉及 Node 兼容、IP、环境及后台任务等条件。未运行其迁移、未替换 Task12/20、未添加它的用户表或会话模型；也未增加可信设备绕过。 |
| Novu | [Inbox](https://docs.novu.co/platform/inbox)、[消息实体](https://github.com/novuhq/novu/blob/next/libs/dal/src/repositories/message/message.entity.ts)、[幂等处理](https://github.com/novuhq/novu/blob/next/apps/api/src/app/shared/framework/idempotency.interceptor.ts)、[MIT](https://github.com/novuhq/novu/blob/next/LICENSE-MIT)／[商业部分](https://github.com/novuhq/novu/blob/next/EE-PACKAGES-LICENSE) | 参考账户范围、read/seen 分离、投递状态及幂等请求概念。Aeris 的“明确确认”仍是独立业务状态，普通已读不能替代它。 | 官方提供独立平台和 Web SDK；所读服务代码使用 NestJS、缓存及其它平台服务。没有部署 Novu，也没有引入 React Inbox、商业模块或新的通知基础设施；继续使用 Task18/27 D1 数据。 |
| OWASP ASVS 5.0.0 | [认证 V6](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x15-V6-Authentication.md)、[会话 V7](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x16-V7-Session-Management.md)、[授权 V8](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x17-V8-Authorization.md)、[CC BY-SA 4.0](https://github.com/OWASP/ASVS) | 用作复核目录和版本化要求引用，不是运行库。下表记录本地证据、政策差异及缺口。 | 运行环境无关的标准。未复制整份标准进入产品，也不声称取得 ASVS 认证或全面达到某等级。 |
| node-qrcode | [浏览器实现](https://github.com/soldair/node-qrcode/blob/master/lib/browser.js)、[功能说明](https://github.com/soldair/node-qrcode)、[MIT](https://github.com/soldair/node-qrcode/blob/master/license) | 评估其本地 canvas/SVG 生成方案；没有采用。 | 官方说明支持服务端与客户端。仓库已有 MIT 的 qrcode-generator 2.0.4，本轮实际显示的 SVG 已由独立解码器解码，QR/链接/手工密钥配置相同；无需再引入第二个编码器。原许可证见 `THIRD_PARTY_NOTICES.md`。 |

OTPAuth 9.6.0 和 jsQR 1.4.0（MIT）仅安装于忽略的测试工具目录。
未向根 package 的 dependencies/devDependencies 增加库，根 lockfile 未改。
本地 oracle 还验证了中文及带冒号的账户标签；实际 Google/Microsoft
Authenticator 的设备扫描、URI 接管和手工录入仍由所有者进行，不能由 oracle 冒充。

## ASVS 参考下的实际结论

以下是 Aeris 自身实现的复核结论；要求编号仅作定位，不复制标准正文。

| 参考 | 本轮核查 | 证据／限制 |
| --- | --- | --- |
| v5.0.0-6.1.3 | Web、Android、刷新、恢复及临时密码路径均保留 Task12/20 主体 | 完整会话只在所需步骤完成后签发；临时挑战不进入会话表 |
| v5.0.0-6.2.2/3/6/7/8/9/10 | 新密码前后端一致；当前密码验证不套用新规则；不裁剪或改写散列输入 | 9 位四类字符、最长 128 个 Unicode 码点；显示/隐藏、粘贴和 autocomplete 保留；30 天只建议 |
| v5.0.0-6.4.1/3、6.5 | 临时密码符合新规则且只能进入受限改密；普通恢复保留 MFA | 20 位 CSPRNG、一次显示、旧会话撤销、绑定前验证码、恢复码单次并发消费均有本地测试 |
| V7 | 会话所有权、代次、撤销及刷新重建竞态 | Web/Android 旧会话升级保留；明确撤销后刷新不能重建；原生 cookie 哨兵不变时也丢弃跨账户的迟到安全响应 |
| V8 | 管理员、目标账户、消息及批量已读范围 | 普通管理员不能重置超级管理员；提交时再次检查角色；私有通知按所有权查询 |

**已确认政策与标准的差异不能标 PASS：** 所有者要求的字符组合规则与
v5.0.0-6.2.5 的取向不同；普通 MFA 可选、邮箱 OTP 和管理员可见临时密码
也不能被描述为全面满足 ASVS 更高等级。实现按已确认产品要求执行。
本地常见弱密码检查是小型基本拒绝集合，不是完整 top-3000 或在线泄露库；
没有将明文密码送往第三方，不宣称已实现全面泄露密码检测。

## 新增的安全边界

- 同一 `otpauth://` URI 用于本地二维码与“在验证器 App 中打开”；密钥可单独复制。
  URI 不进入 HTTP 资源地址、history API、分析事件或客户端持久化存储。
  页面与链接使用无 Referrer 策略，关闭弹窗会清除配置 DOM。
- Android 只允许 Aeris、TOTP、SHA1、6 位、30 秒的标准 URI；来自可信主页面
  且有用户手势时才交给系统。没有处理应用时显示手动添加提示。
  没有新增权限、查询已安装应用权限或独立 Authenticator。
- 已认证的绑定／登录／重新认证发码失败返回失败；绑定失败的挑战作废，邮箱
  和 MFA 状态不改变。公开找回使用不枚举账户的统一请求回执，明确不代表发码
  或送达；整体发信底座不可用时，对存在／不存在的账户均返回 503。
- 旧 ID 不额外限制为 UUID 或字母数字，沿用原系统“不含控制字符且至多 80”
  的标识范围；Step-up 仍精确绑定目标及操作，不放宽服务端权限。

## 本地复现

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm install --prefix .wrangler/task27-reference/otpauth-lab --ignore-scripts --no-audit --no-fund --no-save otpauth@9.6.0 jsqr@1.4.0
npm run test:task27
npm run test:task27:upgrade
npm run test:task27:oracle
npm run test:task27:owner
npm run test:task27:browser
```

这些命令只使用合成账户、隔离 D1、模拟邮件和独立浏览器。
旧失败日志保留在 `.wrangler/`；不得把本地 PASS 改写为 Hosted、CI、真机或 Production PASS。
