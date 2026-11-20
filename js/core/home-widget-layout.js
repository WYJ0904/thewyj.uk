/** UI preferences only. Content is shared; viewport geometry is never shared. */
export const HOME_WIDGET_VERSION = 2;
export const WORKSPACE_SCHEMA_VERSION = 1;
export const WORKSPACE_MODULE_IDS = Object.freeze(['learning', 'finance', 'tools', 'transfer', 'activity', 'account']);
export const WORKSPACE_DENSITIES = Object.freeze(['comfortable', 'compact']);
export const WORKSPACE_MODULE_META = Object.freeze({
  learning: Object.freeze({ id: 'learning', title: '语言学习', kicker: 'LEARNING', route: '/language', cta: '进入学习' }),
  finance: Object.freeze({ id: 'finance', title: '本月账本', kicker: 'FINANCE', route: '/finance', cta: '打开账本' }),
  tools: Object.freeze({ id: 'tools', title: '实用工具箱', kicker: 'TOOLS', route: '/tools', cta: '打开工具箱' }),
  transfer: Object.freeze({ id: 'transfer', title: '文件传输', kicker: 'TRANSFER', route: '/transfer', cta: '文件传输' }),
  activity: Object.freeze({ id: 'activity', title: '最近活动', kicker: 'ACTIVITY', route: '/select#homeRecentActivity', cta: '查看通知' }),
  account: Object.freeze({ id: 'account', title: '会员与数据服务', kicker: 'ACCOUNT', route: '/account', cta: '账户与会员' }),
});
export const WIDGET_IDS = Object.freeze(['learning', 'finance', 'tools']);
export const WIDGET_MODES = Object.freeze({
  learning: { latest:'最近学习', today:'今日进度', streak:'连续学习', wrong:'错题数量' },
  finance: { balance:'月度余额', income:'本月收入', expense:'本月支出' },
  tools: { recent:'最近工具', favorites:'收藏工具', workflow:'最近工作流' },
});
const desktopDefaults = {
  learning:{size:'medium',rotation:2,x:.03,y:.04},
  finance:{size:'medium',rotation:-2,x:.92,y:.41},
  tools:{size:'medium',rotation:1,x:.10,y:.94},
};
const contentDefaults={learning:'latest',finance:'balance',tools:'recent'};
export function defaultHomeWidgets() {
  return {version:HOME_WIDGET_VERSION,...Object.fromEntries(WIDGET_IDS.map((id,index)=>[id,{
    contentMode:contentDefaults[id],
    layouts:{desktop:{...desktopDefaults[id]},mobile:{size:'medium',rotation:index%2?-1.5:1.5-index%3*.25,x:index%2?.88:.12+index%3*.09,y:.15+index%3*.2}},
  }]))};
}
export const clampWidgetValue=(value,low,high,fallback)=>
  (typeof value==='number'||typeof value==='string'&&value.trim())&&Number.isFinite(Number(value))
    ?Math.max(low,Math.min(high,Number(value))):fallback;
function cleanGeometry(value,fallback) {
  const item=value&&typeof value==='object'?value:{};
  return {size:['small','medium','large'].includes(item.size)?item.size:fallback.size,
    rotation:Math.round(clampWidgetValue(item.rotation,-6,6,fallback.rotation)*2)/2,
    x:clampWidgetValue(item.x,0,1,fallback.x),y:clampWidgetValue(item.y,0,1,fallback.y)};
}
export function sanitizeHomeWidgets(value) {
  const clean=defaultHomeWidgets();
  if(!value||typeof value!=='object'||![1,HOME_WIDGET_VERSION].includes(value.version))return clean;
  for(const id of WIDGET_IDS){
    const item=value[id];if(!item||typeof item!=='object')continue;
    clean[id].contentMode=Object.hasOwn(WIDGET_MODES[id],item.contentMode)?item.contentMode:contentDefaults[id];
    // v1 had desktop geometry only. Preserve it exactly; create independent mobile defaults.
    clean[id].layouts.desktop=cleanGeometry(value.version===1?item:item.layouts?.desktop,clean[id].layouts.desktop);
    if(value.version===HOME_WIDGET_VERSION)clean[id].layouts.mobile=cleanGeometry(item.layouts?.mobile,clean[id].layouts.mobile);
  }
  return clean;
}
export const legacyHomeWidgetStorageKey=id=>'aerisHomeWidgets:v1:'+encodeURIComponent(String(id||'guest'));
export const homeWidgetStorageKey=id=>'aerisHomeWidgets:v2:'+encodeURIComponent(String(id||'guest'));
export const isHomeWidgetDesktop=(width,height=0,coarse=false)=>Number(width)>=981&&!(coarse&&height>0&&Math.min(width,height)<=600);
export const widgetGeometry=(config,id,profile)=>config[id].layouts[profile];
export const widgetProfile=(config,profile)=>Object.fromEntries(WIDGET_IDS.map(id=>[id,widgetGeometry(config,id,profile)]));
export function rotatedWidgetBox(width,height,rotation) {
  const angle=Math.abs(rotation)*Math.PI/180;
  return {width:width*Math.cos(angle)+height*Math.sin(angle),height:height*Math.cos(angle)+width*Math.sin(angle)};
}
const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
/** Accepted desktop finite layout. Includes rotated corners and collision handling. */
export function layoutHomeWidgets(config,stage,sizes,priority='') {
  const placed={},padding=12;
  for(const id of [...Object.keys(sizes).filter(x=>x!==priority),...(priority?[priority]:[])]){
    const item=config[id],size=sizes[id],box=rotatedWidgetBox(size.width,size.height,item.rotation);
    const roomX=Math.max(0,stage.width-box.width-padding*2),roomY=Math.max(0,stage.height-box.height-padding*2);
    const wanted={x:padding+item.x*roomX,y:padding+item.y*roomY,...box},candidates=[wanted];
    for(let y=0;y<=6;y++)for(let x=0;x<=4;x++)candidates.push({x:padding+roomX*x/4,y:padding+roomY*y/6,...box});
    const penalty=c=>Object.values(placed).reduce((sum,p)=>sum+Math.max(0,overlap(c,p.box)/Math.min(box.width*box.height,p.box.width*p.box.height)-.54),0);
    candidates.sort((a,b)=>(penalty(a)-penalty(b))*100000+Math.hypot(a.x-wanted.x,a.y-wanted.y)-Math.hypot(b.x-wanted.x,b.y-wanted.y));
    const best=candidates[0];
    placed[id]={x:best.x+(box.width-size.width)/2,y:best.y+(box.height-size.height)/2,box:best,normalizedX:roomX?(best.x-padding)/roomX:0,normalizedY:roomY?(best.y-padding)/roomY:0};
  }
  return placed;
}
export const MOBILE_WIDGET_SIZES=Object.freeze({small:{width:222,height:144},medium:{width:272,height:188},large:{width:312,height:242}});
/** Independent flow slots. No desktop coordinates, scaling, drag or global canvas. */
export function layoutMobileWidgets(config,stageWidth,sizes=MOBILE_WIDGET_SIZES) {
  const padding=Math.min(12,Math.max(4,stageWidth*.035)),verticalRoom=16;
  return Object.fromEntries(Object.entries(config).map(([id,item])=>{
    const preferred=sizes[item.size],angle=Math.abs(item.rotation)*Math.PI/180;
    const width=Math.max(1,Math.floor(Math.min(preferred.width,(stageWidth-2*padding-preferred.height*Math.sin(angle))/Math.cos(angle))));
    const box=rotatedWidgetBox(width,preferred.height,item.rotation),roomX=Math.max(0,stageWidth-box.width-2*padding);
    const bx=padding+item.x*roomX,by=padding+item.y*verticalRoom;
    return [id,{width,height:preferred.height,x:bx+(box.width-width)/2,y:by+(box.height-preferred.height)/2,
      slotHeight:Math.ceil(box.height+2*padding+verticalRoom),box:{x:bx,y:by,...box}}];
  }));
}

export function defaultWorkspaceBento() {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    order: [...WORKSPACE_MODULE_IDS],
    hidden: [],
    density: 'comfortable',
    customized: false,
  };
}

export function sanitizeWorkspaceBento(raw) {
  const source = raw && typeof raw === 'object' && raw.workspace && typeof raw.workspace === 'object'
    ? raw.workspace
    : (raw && typeof raw === 'object' && (Array.isArray(raw.order) || Array.isArray(raw.hidden) || typeof raw.density === 'string') ? raw : null);
  const defaults = defaultWorkspaceBento();
  if (!source) return defaults;
  if (source.schemaVersion !== undefined && Number(source.schemaVersion) > WORKSPACE_SCHEMA_VERSION) {
    return defaults;
  }
  const seen = new Set();
  const order = [];
  if (Array.isArray(source.order)) {
    for (const id of source.order) {
      if (WORKSPACE_MODULE_IDS.includes(id) && !seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
  }
  for (const id of WORKSPACE_MODULE_IDS) {
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  const hiddenSet = new Set();
  const hidden = [];
  if (Array.isArray(source.hidden)) {
    for (const id of source.hidden) {
      if (WORKSPACE_MODULE_IDS.includes(id) && !hiddenSet.has(id)) {
        hiddenSet.add(id);
        hidden.push(id);
      }
    }
  }
  const density = WORKSPACE_DENSITIES.includes(source.density) ? source.density : defaults.density;
  const orderChanged = order.some((id, idx) => id !== defaults.order[idx]);
  const customized = Boolean(source.customized) || orderChanged || hidden.length > 0 || density !== defaults.density;
  return { schemaVersion: WORKSPACE_SCHEMA_VERSION, order, hidden, density, customized };
}

export function hasFutureWorkspaceSchema(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (Number(raw.version) > HOME_WIDGET_VERSION) return true;
  return Number(raw.workspace?.schemaVersion) > WORKSPACE_SCHEMA_VERSION;
}

export function mergeHomeWidgetsRecord(existingRaw, workspaceConfig) {
  const base = sanitizeHomeWidgets(existingRaw);
  return { ...base, workspace: sanitizeWorkspaceBento(workspaceConfig) };
}

export function visibleWorkspaceOrder(config) {
  const hiddenSet = new Set(config.hidden || []);
  return (config.order || WORKSPACE_MODULE_IDS).filter((id) => !hiddenSet.has(id));
}

export function moveWorkspaceVisibleModule(config, moduleId, delta) {
  const clean = sanitizeWorkspaceBento(config);
  const visible = visibleWorkspaceOrder(clean);
  const currentIdx = visible.indexOf(moduleId);
  if (currentIdx < 0) return clean;
  const targetIdx = currentIdx + delta;
  if (targetIdx < 0 || targetIdx >= visible.length) return clean;
  const targetId = visible[targetIdx];
  const nextOrder = [...clean.order];
  const fullA = nextOrder.indexOf(moduleId);
  const fullB = nextOrder.indexOf(targetId);
  if (fullA < 0 || fullB < 0) return clean;
  nextOrder[fullA] = targetId;
  nextOrder[fullB] = moduleId;
  return sanitizeWorkspaceBento({ ...clean, order: nextOrder, customized: true });
}

export function applyWorkspaceVisibleOrder(config, visibleKeys) {
  const clean = sanitizeWorkspaceBento(config);
  const hiddenSet = new Set(clean.hidden);
  const validVisible = [];
  const used = new Set();
  for (const id of visibleKeys || []) {
    if (WORKSPACE_MODULE_IDS.includes(id) && !hiddenSet.has(id) && !used.has(id)) {
      used.add(id);
      validVisible.push(id);
    }
  }
  for (const id of visibleWorkspaceOrder(clean)) {
    if (!used.has(id)) {
      used.add(id);
      validVisible.push(id);
    }
  }
  let vCursor = 0;
  const nextOrder = clean.order.map((id) => (hiddenSet.has(id) ? id : validVisible[vCursor++]));
  return sanitizeWorkspaceBento({ ...clean, order: nextOrder, customized: true });
}

export function setWorkspaceModuleHidden(config, moduleId, hidden) {
  const clean = sanitizeWorkspaceBento(config);
  if (!WORKSPACE_MODULE_IDS.includes(moduleId)) return clean;
  const nextHidden = hidden
    ? [...new Set([...clean.hidden, moduleId])]
    : clean.hidden.filter((id) => id !== moduleId);
  return sanitizeWorkspaceBento({ ...clean, hidden: nextHidden, customized: true });
}

export function diffWorkspaceDraftFields(saved, draft) {
  const a = sanitizeWorkspaceBento(saved);
  const b = sanitizeWorkspaceBento(draft);
  const fields = [];
  if (a.order.some((id, idx) => id !== b.order[idx])) fields.push('模块顺序');
  const hiddenA = [...a.hidden].sort().join(',');
  const hiddenB = [...b.hidden].sort().join(',');
  if (hiddenA !== hiddenB) fields.push('隐藏/显示模块');
  if (a.density !== b.density) fields.push('布局密度');
  return fields;
}
