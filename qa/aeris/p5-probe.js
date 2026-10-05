/* Test-only instrumentation, injected before application code. No payload values. */
(() => {
  const started = performance.now(), timeouts = new Map(), intervals = new Map(), observers = new Map();
  const mutations = [], writes = [], json = { parseCount: 0, parseMs: 0, stringifyCount: 0, stringifyMs: 0, bytes: 0 };
  const longTasks = [], events = [], shifts = [];
  const nativeTimeout = window.setTimeout.bind(window), nativeClear = window.clearTimeout.bind(window);
  window.setTimeout = (callback, ms, ...args) => {
    let id; id = nativeTimeout((...values) => { timeouts.delete(id); typeof callback === 'function' ? callback(...values) : (0,eval)(callback); }, ms, ...args);
    timeouts.set(id, { ms: Number(ms || 0) }); return id;
  };
  window.clearTimeout = id => { timeouts.delete(id); nativeClear(id); };
  const nativeInterval = window.setInterval.bind(window), clearInterval = window.clearInterval.bind(window);
  window.setInterval = (callback, ms, ...args) => { const id = nativeInterval(callback, ms, ...args); intervals.set(id, { ms }); return id; };
  window.clearInterval = id => { intervals.delete(id); clearInterval(id); };
  for (const name of ['MutationObserver','ResizeObserver','IntersectionObserver']) {
    const Original = window[name]; if (!Original) continue;
    window[name] = class extends Original {
      observe(...args) { observers.set(this, name); return super.observe(...args); }
      disconnect() { observers.delete(this); return super.disconnect(); }
    };
  }
  const inner = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', { ...inner, set(value) { const at=performance.now();inner.set.call(this,value);mutations.push({id:this.id||this.tagName,ms:performance.now()-at,at}); } });
  const storageSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key,value) { const at=performance.now();const result=storageSet.call(this,key,value);writes.push({prefix:String(key).split(':')[0],bytes:String(value).length,ms:performance.now()-at,at});return result; };
  for (const operation of ['parse','stringify']) {
    const original=JSON[operation]; JSON[operation]=function(...args){const at=performance.now();const result=original.apply(this,args);json[operation+'Count']++;json[operation+'Ms']+=performance.now()-at;json.bytes+=operation==='parse'?String(args[0]).length:String(result||'').length;return result;};
  }
  for (const [type,target] of [['longtask',longTasks],['event',events],['layout-shift',shifts]]) {
    try { new PerformanceObserver(list=>{for(const e of list.getEntries())target.push({name:e.name,at:e.startTime,duration:e.duration,value:e.value||0,interactionId:e.interactionId||0});}).observe({type,buffered:true,...(type==='event'?{durationThreshold:16}:{})}); } catch (_) {}
  }
  window.__p5Probe = {
    mark: () => performance.now(),
    read(since=started) {
      const elements=[...document.body.querySelectorAll('*')];
      const hiddenRoots=[...document.querySelectorAll('#appShell > .hidden,#workspace.hidden,#projectApp.hidden')];
      const hiddenElements=new Set(hiddenRoots.flatMap(root=>[root,...root.querySelectorAll('*')]));
      return { started,elapsed:performance.now()-started,domElements:elements.length,hiddenElements:hiddenElements.size,
        timeouts:timeouts.size,intervals:[...intervals.values()],observers:[...observers.values()],
        mutations:mutations.filter(x=>x.at>=since),storageWrites:writes.filter(x=>x.at>=since),json:{...json},
        longTasks:longTasks.filter(x=>x.at>=since),events:events.filter(x=>x.at>=since),layoutShifts:shifts.filter(x=>x.at>=since),
        resources:performance.getEntriesByType('resource').map(r=>({path:new URL(r.name).pathname,bytes:r.decodedBodySize,transfer:r.transferSize,ms:r.duration,type:r.initiatorType})),
        heap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null,
        generated:{finance:document.querySelectorAll('[data-finance-transaction]').length,pending:document.querySelectorAll('[data-canonical-identity]').length,tools:document.querySelectorAll('[data-tool-card]').length},
      };
    },
  };
})();
