/** Coalesce numeric progress and persistence without changing upload scheduling. */
export const QUEUE_PERSIST_DELAY_MS = 250;

export function createTransferUpdateScheduler({
  updateProgress,
  persist,
  generation = () => 0,
  requestFrame = (callback) => typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(callback) : setTimeout(callback, 16),
  cancelFrame = (handle) => typeof cancelAnimationFrame === "function"
    ? cancelAnimationFrame(handle) : clearTimeout(handle),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let frame = null;
  let timer = null;
  let pendingOwner = 0;
  function cancelProgress() {
    if (frame !== null) cancelFrame(frame);
    frame = null;
  }
  function cancelPersistence() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  return Object.freeze({
    progress() {
      if (frame !== null) return;
      const owner = generation();
      frame = requestFrame(() => {
        frame = null;
        if (owner === generation()) updateProgress();
      });
    },
    persistLater() {
      if (timer !== null) return;
      const owner = generation();
      pendingOwner = owner;
      timer = setTimer(() => {
        timer = null;
        if (owner === generation()) persist();
      }, QUEUE_PERSIST_DELAY_MS);
    },
    persistNow() {
      cancelPersistence();
      persist();
    },
    flushPending() {
      if (timer === null) return;
      const owner = pendingOwner;
      cancelPersistence();
      if (owner === generation()) persist();
    },
    cancelProgress,
    cancel() { cancelProgress(); cancelPersistence(); },
  });
}
