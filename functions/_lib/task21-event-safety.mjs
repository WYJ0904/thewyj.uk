import {Task21Error} from './task21-model.mjs';

export function paymentReviewReason(event) {
  if (event.identity_review_reason) return event.identity_review_reason;
  if (Number(event.lifecycle_revision)>1) return "lifecycle_revision_requires_reconciliation";
  if (event.lifecycle_review_reason) return event.lifecycle_review_reason;
  if (event.financial_phase && !['SETTLED','REFUNDED'].includes(event.financial_phase)) return 'payment_lifecycle_not_settled';
  if (event.financial_phase && (!event.lifecycle_reference || !event.provider_reference)) return 'lifecycle_reference_missing';
  const codes=String(event.currency_evidence||'').split(',').filter(Boolean);
  if (codes.length>1 || (codes.length===1 && codes[0]!==event.currency)) return 'currency_evidence_conflict';
  return '';
}

export function referenceNamespaceForSource(event) {
  const channel=event.payment_channel||'notification';
    const source=event.source_package||'';
    const bank={
      'cmb.pb':'cmb','com.cmbchina.ccd.pluto.cmbActivity':'cmb','95555':'cmb','10695555':'cmb',
      'com.icbc':'icbc','95588':'icbc','10695588':'icbc',
    }[source];
    return ['bank_card','bank','bank_sms'].includes(channel) ? 'bank_card:'+(bank||source.toLowerCase())
      : ['wechat','alipay'].includes(channel) ? channel : source.toLowerCase();
}

/** Namespace is an issuer, never a merchant/body/amount/time similarity key. */
export function financeReferenceProvider(event) {
  const channel=event.payment_channel||'notification';
  let issuer=channel;
  if (event.reference_namespace) {
    const expected=referenceNamespaceForSource(event);
    if (event.reference_namespace!==expected) throw new Task21Error('引用的来源命名空间不匹配',409,'reference_namespace_conflict');
    issuer=event.reference_namespace;
  }
  const role=event.financial_phase==='REFUNDED'?'':event.financial_phase||'';
  return event.provider_reference ? `${issuer}:${event.direction}${role?':'+role:''}` : issuer;
}

export function financeReplayReference(event) {
  if(event.provider_reference) return {provider:financeReferenceProvider(event),reference:event.provider_reference};
  if(event.lifecycle_identity) return {provider:`${event.source_package}:${event.payment_channel}:${event.direction}:${event.financial_phase||''}:message`,reference:event.lifecycle_identity};
  return null;
}
