/** The cosmetic splash must not own application readiness or require a frame. */
export function completeStartupSplash({screen, image, reveal, whenReady, reducedMotion = false, setTimer = globalThis.setTimeout}) {
  if (!screen) return Promise.resolve().then(() => reveal?.());
  const visibleMs = reducedMotion ? 0 : 450, exitMs = reducedMotion ? 0 : 180;
  const imageFailed = () => screen.classList.add('image-failed');
  image?.addEventListener('error', imageFailed, { once: true });
  if (image?.complete && !image.naturalWidth) imageFailed();

  let isReady = !whenReady;
  let timerFired = false;
  let exitStarted = false;

  return new Promise((resolve, reject) => {
    let failure;
    const finish = () => {
      screen.setAttribute('aria-hidden', 'true');
      screen.remove();
      image?.removeEventListener('error', imageFailed);
      if (failure) reject(failure); else resolve();
    };

    const startExit = () => {
      if (exitStarted) return;
      exitStarted = true;
      try { reveal?.(); } catch (error) { failure = error; }
      // Hidden documents may receive timers but no animation frames. Starting
      // the existing transition is cosmetic; completion never waits for RAF.
      screen.classList.add('is-exiting');
      if (exitMs) setTimer(finish, exitMs); else finish();
    };

    if (whenReady) {
      Promise.resolve().then(whenReady).then(() => {
        isReady = true;
        if (timerFired) startExit();
      }).catch(() => {
        isReady = true;
        if (timerFired) startExit();
      });
      // Bounded safety timeout so startup never hangs indefinitely
      setTimer(() => {
        isReady = true;
        if (timerFired) startExit();
      }, 2500);
    }

    setTimer(() => {
      timerFired = true;
      if (isReady) startExit();
    }, visibleMs);
  });
}

