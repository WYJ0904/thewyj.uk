/** Cosmetic timing is bounded; a deadline is not permission to show a workspace. */
export function completeStartupSplash({screen,image,reveal,whenReady,reducedMotion=false,
  minimumVisibleMs=450,maxWaitMs=2500,setTimer=globalThis.setTimeout,clearTimer=globalThis.clearTimeout}) {
  if(!screen&&!whenReady)return Promise.resolve().then(()=>reveal?.({reason:'ready'}));
  const visibleMs=screen&&!reducedMotion?minimumVisibleMs:0,exitMs=screen&&!reducedMotion?180:0;
  const imageFailed=()=>screen?.classList.add('image-failed');
  image?.addEventListener('error',imageFailed,{once:true});
  if(image?.complete&&!image.naturalWidth)imageFailed();
  return new Promise((resolve,reject)=>{
    let minimumElapsed=false,disposition=whenReady?null:{reason:'ready'},started=false,deadline,failure;
    const finish=()=>{screen?.setAttribute('aria-hidden','true');screen?.remove();image?.removeEventListener('error',imageFailed);if(failure)reject(failure);else resolve();};
    const exit=()=>{
      if(started||!minimumElapsed||!disposition)return;
      started=true;clearTimer(deadline);
      try{reveal?.(disposition);}catch(error){failure=error;}
      screen?.classList.add('is-exiting');
      // Never wait for an animation frame in a hidden/background document.
      if(exitMs)setTimer(finish,exitMs);else finish();
    };
    setTimer(()=>{minimumElapsed=true;exit();},visibleMs);
    if(whenReady){
      deadline=setTimer(()=>{if(!disposition){disposition={reason:'timeout'};exit();}},maxWaitMs);
      Promise.resolve().then(()=>typeof whenReady==='function'?whenReady():whenReady).then(()=>{
        if(!disposition){disposition={reason:'ready'};exit();}
      },error=>{if(!disposition){disposition={reason:'error',error};exit();}});
    }
  });
}

/** OFF/error can show the supported safe interface; unknown identity/policy cannot. */
export function canPresentWorkspace({sessionPresent,accountVerified,policyStatus}) {
  return (!sessionPresent||accountVerified===true)&&['enabled','disabled','error'].includes(policyStatus);
}

/** Event-driven readiness, with identity ownership for login/BFCache transitions. */
export function waitForPresentation({read,subscribe,owner,strictOwner=false}) {
  return new Promise((resolve,reject)=>{
    let settled=false,unsubscribe=()=>{};
    const check=()=>{
      if(settled)return;
      try{
        const current=read();
        if(strictOwner&&current.owner!==owner){const error=new Error('账户已切换');error.name='AbortError';error.code='account_changed';throw error;}
        if(!canPresentWorkspace(current))return;
        settled=true;unsubscribe();resolve(current.policyStatus);
      }catch(error){settled=true;unsubscribe();reject(error);}
    };
    unsubscribe=subscribe(check)||(()=>{});if(settled)unsubscribe();else check();
  });
}
