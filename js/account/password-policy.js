// Shared by the Web UI and the authoritative Task12/Task27 server validation.
// Existing-password authentication must never call this new-password policy.
export const NEW_PASSWORD_MIN_LENGTH = 8;
export const NEW_PASSWORD_MAX_LENGTH = 128;
const COMMON = new Set(['password1!','password123!','password1234!','qwerty123!','welcome1!','admin123!','aeris12345!','changeme1!']);
export function passwordChecks(value) {
  const text=typeof value==='string'?value:'';
  return [
    {key:'length',label:`至少 ${NEW_PASSWORD_MIN_LENGTH} 个字符`,valid:[...text].length>=NEW_PASSWORD_MIN_LENGTH},
    {key:'upper',label:'包含大写英文字母 A–Z',valid:/[A-Z]/.test(text)},
    {key:'lower',label:'包含小写英文字母 a–z',valid:/[a-z]/.test(text)},
    {key:'digit',label:'包含数字 0–9',valid:/[0-9]/.test(text)},
    {key:'symbol',label:'包含特殊符号（空格不计）',valid:/[\p{P}\p{S}]/u.test(text)},
    {key:'maximum',label:'不超过 128 个字符',valid:[...text].length<=NEW_PASSWORD_MAX_LENGTH},
    {key:'control',label:'不包含控制字符或换行',valid:!/[\u0000-\u001f\u007f]/u.test(text)},
    {key:'common',label:'不能使用此常见弱密码，请设置更独特的密码',valid:!COMMON.has(text.normalize('NFKC').toLowerCase())},
  ];
}
export function passwordIssues(value) { return passwordChecks(value).filter(check=>!check.valid); }
export function isNewPasswordValid(value) { return typeof value==='string'&&passwordIssues(value).length===0; }
