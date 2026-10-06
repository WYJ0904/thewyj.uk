import { getSafeStorage, safeStorageSet } from "./storage.js?v=20261006-home-refinement-1";

export const HOME_WIDGET_VERSION = 1;
export const WIDGET_IDS = Object.freeze(["learning", "finance", "tools"]);
export const WIDGET_MODES = Object.freeze({
  learning: { latest: "最近学习", today: "今日进度", streak: "连续学习", wrong: "错题数量" },
  finance: { balance: "月度余额", income: "本月收入", expense: "本月支出" },
  tools: { recent: "最近工具", favorites: "收藏工具", workflow: "最近工作流" },
});
const defaults = {
  learning: { size: "medium", rotation: 2, x: 0.03, y: 0.04, contentMode: "latest" },
  finance: { size: "medium", rotation: -2, x: 0.92, y: 0.41, contentMode: "balance" },
  tools: { size: "medium", rotation: 1, x: 0.10, y: 0.94, contentMode: "recent" },
};
export function defaultHomeWidgets() {
  return { version: HOME_WIDGET_VERSION, ...Object.fromEntries(WIDGET_IDS.map(id => [id, { ...defaults[id] }])) };
}
const clamp = (value, low, high, fallback) => (typeof value === 'number' || (typeof value === 'string' && value.trim())) && Number.isFinite(Number(value))
  ? Math.max(low, Math.min(high, Number(value))) : fallback;
export function sanitizeHomeWidgets(value) {
  const clean = defaultHomeWidgets();
  if (!value || typeof value !== "object" || value.version !== HOME_WIDGET_VERSION) return clean;
  for (const id of WIDGET_IDS) {
    const item = value[id]; if (!item || typeof item !== "object") continue;
    clean[id] = {
      size: ["small", "medium", "large"].includes(item.size) ? item.size : defaults[id].size,
      rotation: Math.round(clamp(item.rotation, -6, 6, defaults[id].rotation) * 2) / 2,
      x: clamp(item.x, 0, 1, defaults[id].x), y: clamp(item.y, 0, 1, defaults[id].y),
      contentMode: Object.hasOwn(WIDGET_MODES[id], item.contentMode) ? item.contentMode : defaults[id].contentMode,
    };
  }
  return clean;
}
export const homeWidgetStorageKey = accountId => "aerisHomeWidgets:v1:" + encodeURIComponent(String(accountId || "guest"));
export const isHomeWidgetDesktop = width => Number(width) >= 981;
export function rotatedWidgetBox(width, height, rotation) {
  const angle = Math.abs(rotation) * Math.PI / 180;
  return { width: width * Math.cos(angle) + height * Math.sin(angle), height: height * Math.cos(angle) + width * Math.sin(angle) };
}
const overlap = (a,b) => Math.max(0, Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))
  * Math.max(0, Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
/** Finite Hero layout only. Bounds include rotated corners; all sizes stay readable. */
export function layoutHomeWidgets(config, stage, sizes, priority = "") {
  const placed = {}, padding = 12;
  for (const id of [...WIDGET_IDS.filter(x => x !== priority), ...(priority ? [priority] : [])]) {
    const item = config[id], size = sizes[id], box = rotatedWidgetBox(size.width, size.height, item.rotation);
    const roomX = Math.max(0, stage.width - box.width - padding * 2), roomY = Math.max(0, stage.height - box.height - padding * 2);
    const wanted = { x: padding + item.x * roomX, y: padding + item.y * roomY, ...box };
    const candidates = [wanted];
    for (let y=0;y<=6;y++) for(let x=0;x<=4;x++) candidates.push({ x:padding+roomX*x/4,y:padding+roomY*y/6,...box });
    const penalty = candidate => Object.values(placed).reduce((sum,p) => sum + Math.max(0, overlap(candidate,p.box)/Math.min(box.width*box.height,p.box.width*p.box.height)-.54),0);
    candidates.sort((a,b) => (penalty(a)-penalty(b))*100000 + Math.hypot(a.x-wanted.x,a.y-wanted.y)-Math.hypot(b.x-wanted.x,b.y-wanted.y));
    const best = candidates[0];
    placed[id] = { x: best.x + (box.width-size.width)/2, y: best.y + (box.height-size.height)/2, box:best,
      normalizedX: roomX ? (best.x-padding)/roomX : 0, normalizedY: roomY ? (best.y-padding)/roomY : 0 };
  }
  return placed;
}
export const homeWidgetDragMoved = (x,y) => Math.hypot(x,y) >= 6;

/** Owns only UI preferences and gestures. Dashboard passes existing owner projections. */
export function createHomeWidgets({ root, accountId, navigate, storage = getSafeStorage(), view = window }) {
  const stage = root.querySelector(".public-hero-scene"), dialog = root.querySelector("#homeWidgetEditor"), form = dialog.querySelector("form");
  const cards = Object.fromEntries(WIDGET_IDS.map(id => [id, stage.querySelector(`[data-home-widget=${id}]`)]));
  const labels = { learning:"学习记录",finance:"本月账本",tools:"最近工具" };
  let owner = null, config = defaultHomeWidgets(), draft = null, edited = "", interaction = null, frame = 0;
  let desktop = isHomeWidgetDesktop(view.innerWidth), future = false, lastSnapshot = null, suppressed = null;
  const text = (el,value) => { if(el && el.textContent!==String(value))el.textContent=String(value); };
  const notice = value => text(root.querySelector("#homeWidgetMessage"),value);
  function persist() {
    if (!owner) { notice("演示布局仅在本次预览中生效。"); return; }
    if (future) { notice("这是较新版本的布局配置。恢复默认后才能重新保存。"); return; }
    const raw=JSON.stringify(config);
    notice(safeStorageSet(storage,homeWidgetStorageKey(owner),raw) ? "卡片设置已保存。" : "本次设置已应用；浏览器未能保存，下次进入会使用原布局。");
  }
  function setAccount() {
    const next=String(accountId() || ""); if(next===owner)return;
    cancelGesture(); if(dialog.open)dialog.close(); draft=null; edited=""; owner=next; future=false; lastSnapshot=null; config=defaultHomeWidgets();
    if(owner)try{const raw=storage.getItem(homeWidgetStorageKey(owner));if(raw&&raw.length<=8192){const saved=JSON.parse(raw);future=Number(saved?.version)>HOME_WIDGET_VERSION;config=sanitizeHomeWidgets(saved);}}catch(_){ /* corrupt preferences never affect actual data */ }
    notice(""); apply();
  }
  function apply(priority="") {
    const value=draft||config;let layout=null;
    for(const id of WIDGET_IDS){const card=cards[id];card.dataset.size=value[id].size;card.style.setProperty("--widget-angle",`${desktop?value[id].rotation:0}deg`);}
    if(desktop){
      const bounds={width:stage.clientWidth,height:stage.clientHeight};
      const sizes=Object.fromEntries(WIDGET_IDS.map(id=>[id,{width:cards[id].offsetWidth,height:cards[id].offsetHeight}]));
      layout=layoutHomeWidgets(value,bounds,sizes,priority);
      for(const id of WIDGET_IDS){cards[id].style.setProperty("--widget-x",`${layout[id].x}px`);cards[id].style.setProperty("--widget-y",`${layout[id].y}px`);}
    }else for(const id of WIDGET_IDS){cards[id].style.removeProperty("--widget-x");cards[id].style.removeProperty("--widget-y");}
    if(lastSnapshot)paint(lastSnapshot);
    return layout;
  }
  function fillEditor() {
    const item=draft[edited]; form.elements.size.value=item.size;form.elements.rotation.value=item.rotation;form.elements.contentMode.value=item.contentMode;
    form.elements.x.value=Math.round(item.x*100);form.elements.y.value=Math.round(item.y*100);
    text(form.querySelector("output"),`${item.rotation}°`);
    form.querySelector("[data-widget-position-fields]").hidden=!desktop;
  }
  function openEditor(id) {
    setAccount(); if(interaction)return;edited=id;draft=sanitizeHomeWidgets(config);
    text(dialog.querySelector("h2"),`设置${labels[id]}`);
    form.elements.contentMode.replaceChildren(...Object.entries(WIDGET_MODES[id]).map(([value,label])=>{const option=root.ownerDocument.createElement("option");option.value=value;option.textContent=label;return option;}));
    fillEditor();dialog.showModal();
  }
  function paint(snapshot) {
    const value=draft||config;
    for(const id of WIDGET_IDS){
      const model=snapshot[id], mode=value[id].contentMode, choice=model.modes?.[mode] || model;
      const suffix=id[0].toUpperCase()+id.slice(1);
      text(root.querySelector(`#homeScene${suffix}Label`),choice.label||labels[id]);
      text(root.querySelector(`#homeScene${suffix}Value`),choice.value||"尚未读取");
      const valueNode=root.querySelector(`#homeScene${suffix}Value`);if(valueNode.title!==String(choice.value||''))valueNode.title=String(choice.value||'');
      text(root.querySelector(`#homeScene${suffix}Detail`),choice.detail||"");
      text(root.querySelector(`#homeScene${suffix}Status`),choice.status||"");
      text(cards[id].querySelector("[data-widget-extra]"),choice.extra||model.extra||"");
      text(cards[id].querySelector("[data-widget-demo]"),snapshot.demo?"演示":"");
      cards[id].querySelector("[data-widget-demo]").hidden=!snapshot.demo;
      cards[id].dataset.state=choice.state||model.state||"empty";
      cards[id].querySelector(".home-widget-main").setAttribute("aria-label",`${choice.label||labels[id]}：${choice.value||"尚未读取"}，打开${id==='learning'?'学习':id==='finance'?'账本':'工具箱'}`);
    }
    const link=cards.tools.querySelector("[data-widget-continue]");
    link.hidden=!snapshot.tools.continuePath || value.tools.contentMode!=="recent";
    link.dataset.widgetContinue=snapshot.tools.continuePath||"";
  }
  function render(snapshot) { setAccount();lastSnapshot=snapshot;paint(snapshot); }
  function cancelGesture() {
    if(frame)view.cancelAnimationFrame(frame);frame=0;
    if(interaction){const current=interaction;interaction=null;config[current.id]=current.original;cards[current.id].removeAttribute('data-dragging');try{current.handle.releasePointerCapture(current.pointerId);}catch(_){}}
  }
  function start(event) {
    const handle=event.target.closest("[data-widget-drag]");
    if(!handle||!desktop||!stage.dataset.editing||event.button!==0||event.isPrimary===false)return;
    event.preventDefault();setAccount();const id=handle.dataset.widgetDrag, bounds=stage.getBoundingClientRect(), card=cards[id], rect=card.getBoundingClientRect();
    interaction={id,handle,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,latestX:event.clientX,latestY:event.clientY,moved:false,bounds,rect,width:card.offsetWidth,height:card.offsetHeight,original:{...config[id]}};
    handle.setPointerCapture(event.pointerId);card.dataset.dragging="true";
  }
  function paintGesture() {
      if(!interaction)return;const i=interaction,dx=i.latestX-i.startX,dy=i.latestY-i.startY;
      i.moved ||= homeWidgetDragMoved(dx,dy);
      if(!i.moved)return;
      const item=config[i.id],box=rotatedWidgetBox(i.width,i.height,item.rotation),roomX=Math.max(1,i.bounds.width-box.width-24),roomY=Math.max(1,i.bounds.height-box.height-24);
      item.x=clamp((i.rect.x-i.bounds.x-12+dx)/roomX,0,1,i.original.x);item.y=clamp((i.rect.y-i.bounds.y-12+dy)/roomY,0,1,i.original.y);
      // Measurements are cached at gesture start; motion only updates transforms.
      cards[i.id].style.setProperty("--widget-x",`${12+item.x*roomX+(box.width-i.width)/2}px`);
      cards[i.id].style.setProperty("--widget-y",`${12+item.y*roomY+(box.height-i.height)/2}px`);
  }
  function move(event) {
    if(!interaction||event.pointerId!==interaction.pointerId)return;
    interaction.latestX=event.clientX;interaction.latestY=event.clientY;
    if(!frame)frame=view.requestAnimationFrame(()=>{frame=0;paintGesture();});
  }
  function end(event) {
    if(!interaction||event.pointerId!==interaction.pointerId)return;
    if(event.type==='pointerup'){interaction.latestX=event.clientX;interaction.latestY=event.clientY;paintGesture();}
    const i=interaction, commit=event.type==='pointerup'&&i.moved;
    if(frame)view.cancelAnimationFrame(frame);frame=0;interaction=null;
    if(!commit)config[i.id]=i.original;
    cards[i.id].removeAttribute("data-dragging");try{i.handle.releasePointerCapture(i.pointerId);}catch(_){}
    const layout=apply(i.id);
    if(commit){if(layout){config[i.id].x=layout[i.id].normalizedX;config[i.id].y=layout[i.id].normalizedY;}suppressed={id:i.id,until:view.performance.now()+500};persist();}
  }
  root.addEventListener("click",event=>{
    const edit=event.target.closest("[data-widget-edit]");if(edit){event.stopPropagation();openEditor(edit.dataset.widgetEdit);return;}
    if(event.target.closest("[data-widget-drag]")){event.preventDefault();return;}
    if(event.target.closest("#homeLayoutToggle")){stage.dataset.editing=stage.dataset.editing?"":"true";root.querySelector("#homeLayoutToggle").setAttribute("aria-pressed",String(Boolean(stage.dataset.editing)));return;}
    if(event.target.closest("#homeLayoutReset")){config=defaultHomeWidgets();future=false;draft=null;apply();persist();return;}
    const onward=event.target.closest("[data-widget-continue]");if(onward){navigate(onward.dataset.widgetContinue);return;}
    const main=event.target.closest("[data-home-widget-open]");if(!main)return;
    const id=main.dataset.homeWidgetOpen;if(interaction||(event.detail>0&&suppressed?.id===id&&view.performance.now()<suppressed.until)){event.preventDefault();suppressed=null;return;}
    navigate(id);
  });
  stage.addEventListener("pointerdown",start);stage.addEventListener("pointermove",move);stage.addEventListener("pointerup",end);stage.addEventListener("pointercancel",end);
  stage.addEventListener('lostpointercapture',event=>{if(interaction&&event.pointerId===interaction.pointerId){cancelGesture();apply();}});
  stage.addEventListener("keydown",event=>{
    const handle=event.target.closest("[data-widget-drag]");if(!handle||!desktop||!event.key.startsWith("Arrow"))return;
    event.preventDefault();const id=handle.dataset.widgetDrag,amount=event.shiftKey?.08:.02;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight')config[id].x=clamp(config[id].x+(event.key==='ArrowLeft'?-amount:amount),0,1,0);
    else config[id].y=clamp(config[id].y+(event.key==='ArrowUp'?-amount:amount),0,1,0);
    const layout=apply(id);if(layout){config[id].x=layout[id].normalizedX;config[id].y=layout[id].normalizedY;}persist();
  });
  form.addEventListener("input",()=>{
    if(!draft)return;draft[edited]=sanitizeHomeWidgets({version:1,[edited]:{size:form.elements.size.value,rotation:form.elements.rotation.value,x:Number(form.elements.x.value)/100,y:Number(form.elements.y.value)/100,contentMode:form.elements.contentMode.value}})[edited];
    text(form.querySelector("output"),`${draft[edited].rotation}°`);apply(edited);
  });
  form.addEventListener("submit",event=>{event.preventDefault();config=draft;draft=null;persist();dialog.close();apply();});
  form.addEventListener("click",event=>{
    if(event.target.closest("[data-widget-reset]")){draft[edited]={...defaults[edited]};fillEditor();apply(edited);}
    if(event.target.closest("[data-widget-angle-reset]")){draft[edited].rotation=defaults[edited].rotation;fillEditor();apply(edited);}
    if(event.target.closest("[data-widget-cancel]"))dialog.close();
  });
  dialog.addEventListener("close",()=>{draft=null;edited="";apply();});
  const resize=()=>{desktop=isHomeWidgetDesktop(view.innerWidth);cancelGesture();apply();if(draft)fillEditor();};
  view.addEventListener("resize",resize);
  let observedWidth=-1,observedHeight=-1;
  const observer=new view.ResizeObserver(entries=>{const {width,height}=entries[0].contentRect;if(width===observedWidth&&height===observedHeight)return;observedWidth=width;observedHeight=height;if(frame||interaction)return;frame=view.requestAnimationFrame(()=>{frame=0;apply();});});observer.observe(stage);
  setAccount();
  return Object.freeze({render,setAccount,snapshot:()=>sanitizeHomeWidgets(config),hide:()=>{const active=Boolean(interaction);cancelGesture();if(active)apply();if(dialog.open)dialog.close();},dispose:()=>{cancelGesture();observer.disconnect();view.removeEventListener("resize",resize);}});
}
