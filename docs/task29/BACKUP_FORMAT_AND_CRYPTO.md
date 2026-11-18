# Task29 加密备份容器格式与密钥管理规范

## 1. 版本化加密容器（`aeris-encrypted-backup` v1）

所有加密构建完全基于标准 Web Crypto API（`crypto.subtle` + `crypto.getRandomValues`），不自造密码学算法，不以 SHA-256 冒充加密或签名，且在浏览器与 Cloudflare Workers (`workerd`) 两端字节级兼容：

```json
{
  "format": "aeris-encrypted-backup",
  "container_version": 1,
  "schema_version": "aeris.backup.v1",
  "export_id": "bexp_...",
  "created_at": "2026-11-18T...",
  "account_binding": {
    "account_id_sha256": "<64-hex SHA-256('aeris-backup-owner:v1:' + accountId)>",
    "binding_version": 1
  },
  "manifest_sha256": "<64-hex>",
  "privacy_declaration": { "...": "..." },
  "crypto": {
    "cipher": "AES-256-GCM",
    "kdf": "PBKDF2-HMAC-SHA256",
    "iterations": 100000,
    "salt_b64": "<16-byte CSPRNG random salt>",
    "iv_b64": "<12-byte unique random nonce/IV>",
    "tag_bits": 128,
    "aad_fields": [
      "format",
      "container_version",
      "schema_version",
      "account_id_sha256",
      "export_id",
      "created_at",
      "manifest_sha256"
    ]
  },
  "ciphertext_b64": "<AES-256-GCM ciphertext + 16-byte auth tag>"
}
```

## 2. 密钥派生与独立参数保证

- **KDF 兼容性**：使用 `PBKDF2-HMAC-SHA256`、`100,000` 次迭代（兼容 Cloudflare Workers 单次 `deriveKey` 100k 上限与主流移动/桌面浏览器 Web Crypto），同时解密端支持分段迭代验证 `[100000 .. 600000]`，低于 100,000 或超出 600,000 一律拒绝 (`BACKUP_KDF_UNSUPPORTED`)。
- **独立随机数与防重用**：每次加密生成全新随机 16 字节 `salt` 与 12 字节 `iv`，相同明文与相同口令连续两次导出亦产出不同密文、不同 `salt_b64` 与不同 `iv_b64`。
- **与 Task27 TOTP 密钥隔离**：绝不复用 `WYJ_TASK27_TOTP_KEY` 或服务端会话密钥作为用户备份加密密钥。
- **口令零持久化**：用户备份口令仅驻留内存并在使用后清空，绝不写入 D1、R2、浏览器 `localStorage`/`sessionStorage`、URL 参数或服务端日志；浏览器 Web Crypto 模式下出口与预检口令无需离开浏览器。
- **遗失说明**：由于系统不保存用户口令或恢复密钥，遗失口令后任何人均无法解密加密备份包。

## 3. AAD 认证绑定与完整性多层校验

1. **格式与有界内存检查**：强制 `<= 16 MiB` (`MAX_BACKUP_BYTES`)，核对 `format`, `container_version`, `cipher`, `kdf`, `iterations`, `salt`/`iv` 字节长度。
2. **AES-GCM AAD 防头篡改**：容器外部的 `format`, `container_version`, `schema_version`, `account_id_sha256`, `export_id`, `created_at`, `manifest_sha256` 经过规范 JSON 序列化后作为 AES-GCM `additionalData`。任何对版本、账户摘要、密文、Nonce、Salt 或认证标签的篡改，以及错误口令，都会在 `crypto.subtle.decrypt` 阶段以 `403 BACKUP_DECRYPTION_FAILED` 拒绝。
3. **完整性清单 (`manifest`) 校验**：解密成功后进一步验证：
   - 容器头部 `account_binding.account_id_sha256` 与解密正文内部 `manifest.account_id_sha256` 一致；
   - `sha256(canonicalJson(manifest)) === container.manifest_sha256`；
   - `sha256(canonicalJson(data)) === manifest.payload_sha256`；
   - 每个数据节 `section` 的记录条数 (`count`) 与规范化 SHA-256 (`sha256`) 完全匹配 (`BACKUP_MANIFEST_MISMATCH`)。
