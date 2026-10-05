/** Detach inactive rendered rows without cloning, losing drafts or data ownership. */
export function createParkedRows(container) {
  let parked = null;
  return Object.freeze({
    park() {
      const root = container();
      if (!root || parked || !root.firstChild) return;
      parked = root.ownerDocument.createDocumentFragment();
      while (root.firstChild) parked.appendChild(root.firstChild);
    },
    resume() {
      const root = container();
      if (!root || !parked) return;
      root.appendChild(parked);
      parked = null;
    },
    clear() { parked = null; container()?.replaceChildren(); },
  });
}
