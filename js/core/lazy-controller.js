/** Loads one existing owner; router, durable state and transport remain with it. */
export function createLazyController({ load, methods = [], summary = () => ({}), loadForSummary = true, onReady = () => {}, onError = () => {} }) {
  let owner = null, pending = null, visible = false, generation = 0;
  function ensure() {
    if (owner) return Promise.resolve(owner);
    if (!pending) pending = Promise.resolve().then(load).then(value => {
      owner = value; onReady(); return owner;
    }).catch(error => { pending = null; throw error; });
    return pending;
  }
  const controller = {
    async show(...args) {
      visible = true;
      const request = ++generation, value = await ensure();
      if (!visible || request !== generation) return false;
      return value.show(...args);
    },
    hide(...args) { visible = false; generation++; return owner?.hide?.(...args); },
    resetAccount(...args) { generation++; return owner?.resetAccount?.(...args); },
    accountUpdated(...args) { return owner?.accountUpdated?.(...args); },
    dashboardSummary() {
      if (!owner && loadForSummary) void ensure().catch(onError);
      return owner?.dashboardSummary?.() ?? summary();
    },
  };
  for (const method of methods) controller[method] = (...args) => owner?.[method]?.(...args);
  return Object.freeze(controller);
}

/** Existing tools' compatibility surface, with lazy code and one state owner. */
export function installLazyTools({ loadTools, loadWorkflows, onReady = () => {}, onError = () => {} }, root = window) {
  let context = null, owner = null, pending = null, workflows = null, ready = false, generation = 0;
  function ensure() {
    if (ready) return Promise.resolve(owner);
    if (!pending) pending = Promise.resolve().then(loadTools).then(() => {
      if (!owner) throw new Error('Tools owner did not initialize');
      if (context) owner.init(context);
      ready = true; onReady(); return owner;
    }).catch(error => { pending = null; throw error; });
    return pending;
  }
  const entry = {
    init(value) { context = value; },
    isReady: () => Boolean(ready && owner?.isReady?.()),
    async prepare() { const request=++generation,value=await ensure();if(request===generation)return value.prepare?.(); },
    async show(path, options) {
      const request = ++generation, value = await ensure();
      if (request !== generation) return;
      if (path.startsWith('/tools/workflows')) {
        workflows ||= Promise.resolve().then(loadWorkflows).then(() => root.WYJWorkflows.init(context));
        await workflows;
        if (request !== generation) return;
      }
      return value.show(path, options);
    },
    async showShareViewer(path) { const request=++generation,value=await ensure();return request===generation ? value.showShareViewer(path) : true; },
    hide() { generation++; owner?.hide?.(); },
    getSummary() { if(!ready)void ensure().catch(onError);return ready ? owner.getSummary() : {favorites:[],recent:[]}; },
  };
  const surface = new Proxy(entry, {
    get(target,key) { return key in target ? target[key] : owner?.[key]; },
    set(_,key,value) { if(owner)owner[key]=value;return true; },
  });
  Object.defineProperty(root,'WYJTools',{configurable:true,get:()=>surface,set:value=>{owner=value;}});
  return surface;
}
