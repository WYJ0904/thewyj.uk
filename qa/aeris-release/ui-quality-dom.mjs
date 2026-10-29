import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dialogFocusTargets, focusDialog } from '../../js/core/design-system.js';
import { publicPlanCatalog, renderPublicPlanCatalog } from '../../js/core/public-experience.js';

// Small DOM adapters isolate the exported rules. The companion browser suite
// uses real DOM, layout, keyboard input and the application's modal handlers.
function control(id, options = {}) {
  return { id, tabIndex: 0, visibility: 'visible', rects: [{}], focused: false,
    matches() { return Boolean(this.disabled || this.hiddenInput); },
    closest() { return this.blocked ? {} : null; },
    getClientRects() { return this.rects; },
    hasAttribute(name) { return name === 'data-dialog-initial-focus' && this.initial === true; },
    focus() { this.focused = true; }, ...options };
}
function layer(controls, panel = control('panel')) {
  panel.setAttribute = function (name, value) { this[name] = value; };
  return { panel, querySelectorAll() { return controls; }, querySelector() { return panel; } };
}
globalThis.getComputedStyle = node => ({ visibility: node.visibility });

test('dialog Tab sequence excludes disabled, hidden, inert and negative tabindex controls', () => {
  const usable = control('usable');
  const modal = layer([control('fieldset-disabled', { disabled: true }),
    control('hidden-input', { hiddenInput: true }), control('negative', { tabIndex: -1 }),
    control('inert-or-aria-hidden', { blocked: true }), control('display-none', { rects: [] }),
    control('visibility-hidden', { visibility: 'hidden' }), control('visibility-collapse', { visibility: 'collapse' }), usable]);
  assert.deepEqual(dialogFocusTargets(modal), [usable]);
});

test('destructive dialog entry prefers its explicit safe action', () => {
  const secret = control('secret'), cancel = control('cancel', { initial: true }), accept = control('accept');
  focusDialog(layer([secret, cancel, accept]));
  assert.equal(cancel.focused, true); assert.equal(secret.focused, false); assert.equal(accept.focused, false);
});

test('a dialog with no enabled Tab targets still receives programmatic focus', () => {
  const modal = layer([control('disabled', { disabled: true })]);
  focusDialog(modal);
  assert.equal(modal.panel.tabindex, '-1'); assert.equal(modal.panel.focused, true);
});

function catalogDocument() {
  const elements = new Map();
  const node = () => ({ attributes: new Map(), children: [], textContent: '', dataset: {}, hidden: false,
    setAttribute(name, value) { this.attributes.set(name, value); },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    classList: { hidden: false, toggle(name, value) { this[name] = value; } } });
  for (const id of ['publicModulePlans', 'publicPermanentPlans', 'publicPlanStatus', 'publicPlanRetryBtn']) elements.set(id, node());
  return { elements, getElementById: id => elements.get(id), createElement: node };
}
const plans = Object.freeze([
  Object.freeze({ code: 'finance_monthly', name: '财务会员', currency: 'CNY', price_cents: 800, duration_months: 1, purchasable: true }),
  Object.freeze({ code: 'notification_archive_access', name: '通知保存', currency: 'CNY', price_cents: 800, duration_months: 1, purchasable: true }),
  Object.freeze({ code: 'all_access_monthly', name: '全功能包月', currency: 'CNY', price_cents: 3000, duration_months: 1, purchasable: true, entitlements: Object.freeze(['all_features_access']) }),
  Object.freeze({ code: 'all_access_lifetime', name: '全功能永久', currency: 'CNY', price_cents: 10000, lifetime: true, purchasable: true }),
]);

test('catalog error preserves a recovery action and releases the busy state', () => {
  const doc = catalogDocument();
  renderPublicPlanCatalog(doc, [], 'temporary catalog failure');
  assert.equal(doc.elements.get('publicPlanRetryBtn').classList.hidden, false);
  for (const id of ['publicModulePlans', 'publicPermanentPlans']) {
    const list = doc.elements.get(id);
    assert.equal(list.attributes.get('aria-busy'), 'false'); assert(list.children[0].textContent.includes('重试'));
  }
  assert(doc.elements.get('publicPlanStatus').textContent.includes('登录账户'));
});

test('catalog recovery retains the authoritative 8/8/30/100 CNY offers without mutation', () => {
  const doc = catalogDocument(), before = JSON.stringify(plans);
  renderPublicPlanCatalog(doc, [], 'temporary failure'); renderPublicPlanCatalog(doc, plans);
  assert.equal(doc.elements.get('publicPlanRetryBtn').classList.hidden, true);
  assert.equal(doc.elements.get('publicPlanStatus').attributes.get('aria-atomic'), 'true');
  const catalog = publicPlanCatalog(plans);
  assert.deepEqual(catalog.modules.map(plan => plan.price), ['¥8.00', '¥8.00']);
  assert.deepEqual(catalog.permanent.map(plan => plan.price), ['¥30.00', '¥100.00']);
  assert.equal(JSON.stringify(plans), before);
});
