// Presentation only: preserve unaffected rows, focus and scroll position.
// Durable entities, ordering and lifecycle decisions remain with each caller.
import { rowRenderRoot } from "./parked-rows.js?v=20261010-aeris-task26-r1";

const lists = new WeakMap();
const focusable = 'button,input,select,textarea,a[href],[tabindex]';

export function reconcileKeyedRows(container, items, { key, signature, render, empty = '' }) {
  if (!container) return;
  const target = rowRenderRoot(container);
  let cache = lists.get(container);
  if (!cache) { cache = new Map(); lists.set(container, cache); }
  const wanted = new Set(items.map(item => String(key(item))));
  for (const [id, entry] of cache) {
    if (!wanted.has(id)) { entry.node.remove(); cache.delete(id); }
  }
  if (!items.length) {
    if (target === container) {
      if (container.innerHTML !== empty) container.innerHTML = empty;
    } else {
      const template = container.ownerDocument.createElement('template');
      template.innerHTML = empty;
      target.replaceChildren(template.content);
    }
    return;
  }
  for (const node of [...target.children]) {
    if (!node.dataset.workspaceKey || !wanted.has(node.dataset.workspaceKey)) node.remove();
  }
  let cursor = target.firstElementChild;
  for (const item of items) {
    const id = String(key(item));
    const stamp = signature ? signature(item) : render(item);
    let entry = cache.get(id);
    if (!entry || entry.node.parentNode !== target || entry.stamp !== stamp) {
      const template = container.ownerDocument.createElement('template');
      template.innerHTML = (signature ? render(item) : stamp).trim();
      const node = template.content.firstElementChild;
      if (!node) throw new Error('A workspace row must have one root element');
      node.dataset.workspaceKey = id;
      if (entry?.node.parentNode === target) {
        const focused = entry.node.contains(container.ownerDocument.activeElement)
          ? [...entry.node.querySelectorAll(focusable)].indexOf(container.ownerDocument.activeElement) : -1;
        if (cursor === entry.node) cursor = node;
        entry.node.replaceWith(node);
        if (focused >= 0) node.querySelectorAll(focusable)[focused]?.focus({ preventScroll: true });
      }
      entry = { node, stamp }; cache.set(id, entry);
    }
    if (entry.node !== cursor) target.insertBefore(entry.node, cursor);
    cursor = entry.node.nextElementSibling;
  }
}
