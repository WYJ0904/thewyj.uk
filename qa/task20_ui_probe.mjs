// Inject before navigation. Sampling visible frames catches transient login UI,
// unlike a final DOM assertion or a document-load count.
export function authVisibilityProbe() {
  const report = { frames: 0, loginFrames: 0, guestFrames: 0, events: [] };
  window.__qa20AuthFrames = report;
  let previous = '';
  const visible = selector => {
    const element = document.querySelector(selector);
    if (!element || !element.getClientRects().length) return false;
    for (let node = element; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const sample = () => {
    report.frames++;
    const login = visible('#authPanel');
    const guest = visible('#navGuestActions');
    if (login) report.loginFrames++;
    if (guest) report.guestFrames++;
    const state = login ? 'login' : guest ? 'guest' : visible('#sessionRecovery') ? 'restoring' : visible('#appShell') ? 'content' : 'starting';
    if (state !== previous && report.events.length < 40) {
      report.events.push({ state, atMs: Math.round(performance.now()) });
      previous = state;
    }
    if (performance.now() < 20000) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}
