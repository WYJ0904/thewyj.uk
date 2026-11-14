export function updateCopyrightYear(root = document, date = new Date()) {
  const year = String(Math.max(2025,date.getFullYear()));
  root.querySelectorAll('[data-copyright-year]').forEach(node=>{ node.textContent=year; });
}
updateCopyrightYear();
