/** v2 understands ISO units; v3 also retains default-currency review decisions. */
export function moneyCapability(context) {
  const value = context.request.headers.get('X-Finance-Money-Version') || new URL(context.request.url).searchParams.get('money_version');
  return value === '3' ? 3 : value === '2' ? 2 : 1;
}
export function requiredMoneyCapability(value) {
  let version = 1;
  const pending = [value], seen = new WeakSet();
  while (pending.length) {
    const row = pending.pop();
    if (!row || typeof row !== 'object' || seen.has(row)) continue;
    seen.add(row);
    if (row.currency_review_required === true || row.currency_review_required === 1 || row.currency_review_acknowledged === true) version = 3;
    else if (typeof row.currency === 'string' && row.currency !== 'CNY') version = Math.max(version,2);
    for (const child of Object.values(row)) if (child && typeof child === 'object') pending.push(child);
  }
  return version;
}
export function requireMoneyCapability(context, value, ErrorType) {
  if (moneyCapability(context) < requiredMoneyCapability(value))
    throw new ErrorType('请升级客户端后处理原币金额和币种核实状态',409,'currency_client_upgrade_required');
}
