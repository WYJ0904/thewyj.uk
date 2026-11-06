/** The cosmetic splash must not own application readiness or require a frame. */
export function completeStartupSplash({screen,image,reveal,reducedMotion=false,setTimer=globalThis.setTimeout}) {
  if (!screen) return Promise.resolve().then(() => reveal?.());
  const visibleMs=reducedMotion?0:450,exitMs=reducedMotion?0:180;
  const imageFailed=()=>screen.classList.add('image-failed');
  image?.addEventListener('error',imageFailed,{once:true});
  if(image?.complete&&!image.naturalWidth)imageFailed();
  return new Promise((resolve,reject)=>{
    setTimer(()=>{
      let failure;
      try { reveal?.(); } catch(error) { failure=error; }
      const finish=()=>{
        screen.setAttribute('aria-hidden','true');screen.remove();
        image?.removeEventListener('error',imageFailed);
        if(failure)reject(failure);else resolve();
      };
      // Hidden documents may receive timers but no animation frames. Starting
      // the existing transition is cosmetic; completion never waits for RAF.
      screen.classList.add('is-exiting');
      if(exitMs)setTimer(finish,exitMs);else finish();
    },visibleMs);
  });
}
