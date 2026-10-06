const parkedContainers = new WeakMap();

/** Background reconciliation shares the mounted list's original row owner. */
export function rowRenderRoot(container) {
  return parkedContainers.get(container) || container;
}

/** Detach inactive rendered rows without cloning, losing drafts or data ownership. */
export function createParkedRows(container) {
  let parked = null;
  return Object.freeze({
    park() {
      const root = container();
      if (!root || parked || !root.firstChild) return;
      parked = root.ownerDocument.createDocumentFragment();
      while (root.firstChild) parked.appendChild(root.firstChild);
      parkedContainers.set(root, parked);
    },
    resume() {
      const root = container();
      if (!root || !parked) return;
      root.appendChild(parked);
      parkedContainers.delete(root);
      parked = null;
    },
    clear() {
      const root = container();
      if (root) parkedContainers.delete(root);
      parked = null;
      root?.replaceChildren();
    },
  });
}
