/** Presentation-only state; folding never controls loading or synchronization. */
export function createFinanceDisclosure({ element, storage, accountId, section, defaultOpen }) {
  let boundAccount = "";
  const key = (kind) => `wyjFinanceFold:v1:${encodeURIComponent(String(accountId() || "guest"))}:${section}:${kind}`;
  const read = (kind) => { try { return storage.getItem(key(kind)); } catch { return null; } };
  const write = (kind, value) => { try { storage.setItem(key(kind), value); } catch { /* preferences only */ } };
  function restore() {
    if (!element) return;
    const account = String(accountId() || "guest");
    if (boundAccount === account) return;
    boundAccount = account;
    const saved = read("open");
    element.open = saved === "open" || (saved !== "closed" && defaultOpen);
  }
  element?.addEventListener?.("toggle", () => {
    write("open", element.open ? "open" : "closed");
  });
  function pending(ids) {
    restore();
    if (!element) return;
    let previous;
    try { previous = JSON.parse(read("seen") || "null"); } catch { previous = null; }
    if (Array.isArray(previous) && ids.some(id => !previous.includes(id))) element.open = true;
    write("seen", JSON.stringify(ids));
  }
  return Object.freeze({ restore, pending });
}
