import { getSafeStorage, safeStorageSet } from "./storage.js?v=20261009-aeris-release-b-preview3";
import { HOME_WIDGET_VERSION, WIDGET_IDS, WIDGET_MODES, defaultHomeWidgets, sanitizeHomeWidgets, homeWidgetStorageKey, legacyHomeWidgetStorageKey, isHomeWidgetDesktop, rotatedWidgetBox, layoutHomeWidgets, layoutMobileWidgets, widgetGeometry, widgetProfile, clampWidgetValue } from "./home-widget-layout.js?v=20261009-aeris-release-b-preview3";
export { HOME_WIDGET_VERSION, WIDGET_IDS, WIDGET_MODES, defaultHomeWidgets, sanitizeHomeWidgets, homeWidgetStorageKey, legacyHomeWidgetStorageKey, isHomeWidgetDesktop, rotatedWidgetBox, layoutHomeWidgets, layoutMobileWidgets, widgetGeometry, widgetProfile };
const clamp=clampWidgetValue;
export const homeWidgetDragMoved = (x,y) => Math.hypot(x,y) >= 6;

/** Owns only UI preferences and gestures. Dashboard passes existing owner projections. */
export function createHomeWidgets({ root, accountId, navigate, storage = getSafeStorage(), view = window }) {
  const stage = root.querySelector(".public-hero-scene"), dialog = root.querySelector("#homeWidgetEditor"), form = dialog.querySelector("form");
  const cards = Object.fromEntries(WIDGET_IDS.map(id => [id, stage.querySelector(`[data-home-widget=${id}]`)]));
  const slots=Object.fromEntries(WIDGET_IDS.map(id=>{const card=cards[id],slot=root.ownerDocument.createElement('div');slot.className='home-widget-slot';card.before(slot);slot.append(card);return [id,slot];}));
  const labels = { learning:"学习记录",finance:"本月账本",tools:"最近工具" };
  let owner = null, config = defaultHomeWidgets(), draft = null, edited = "", interaction = null, frame = 0;
  const desktopNow=()=>isHomeWidgetDesktop(view.innerWidth,view.innerHeight,view.matchMedia?.('(pointer: coarse)').matches||false);
  let desktop=desktopNow(),profile=desktop?'desktop':'mobile',future=false,lastSnapshot=null,suppressed=null;
  const geometry=(value,id)=>widgetGeometry(value,id,profile);
  const text = (el,value) => { if(el && el.textContent!==String(value))el.textContent=String(value); };
  const notice = value => text(root.querySelector("#homeWidgetMessage"),value);
  function persist() {
    if (!owner) { notice("演示布局仅在本次预览中生效。"); return; }
    if (future) { notice("这是较新版本的布局配置。本次调整仅预览，原配置会保留。"); return; }
    const raw=JSON.stringify(config);
    notice(safeStorageSet(storage,homeWidgetStorageKey(owner),raw) ? "卡片设置已保存。" : "本次设置已应用；浏览器未能保存，下次进入会使用原布局。");
  }
  function setAccount() {
    const next=String(accountId() || ""); if(next===owner)return;
    cancelGesture(); if(dialog.open)dialog.close(); draft=null; edited=""; owner=next; future=false; lastSnapshot=null; config=defaultHomeWidgets();
    if(owner)try{const raw=storage.getItem(homeWidgetStorageKey(owner))??storage.getItem(legacyHomeWidgetStorageKey(owner));if(raw&&raw.length<=8192){const saved=JSON.parse(raw);future=Number(saved?.version)>HOME_WIDGET_VERSION;config=sanitizeHomeWidgets(saved);}}catch(_){ /* corrupt preferences never affect actual data */ }
    notice(""); apply();
  }
  function apply(priority="") {
    const value=draft||config;let layout=null;
    root.dataset.widgetLayout=profile;
    for(const id of WIDGET_IDS){const card=cards[id],item=geometry(value,id);card.dataset.size=item.size;card.style.setProperty("--widget-angle",`${item.rotation}deg`);}
    if(desktop){
      const bounds={width:stage.clientWidth,height:stage.clientHeight};
      const sizes=Object.fromEntries(WIDGET_IDS.map(id=>[id,{width:cards[id].offsetWidth,height:cards[id].offsetHeight}]));
      layout=layoutHomeWidgets(widgetProfile(value,profile),bounds,sizes,priority);
      for(const id of WIDGET_IDS){cards[id].style.setProperty("--widget-x",`${layout[id].x}px`);cards[id].style.setProperty("--widget-y",`${layout[id].y}px`);}
    }else if(stage.clientWidth>0){
      layout=layoutMobileWidgets(widgetProfile(value,profile),stage.clientWidth);
      for(const id of WIDGET_IDS){const item=layout[id];cards[id].style.setProperty('--widget-width',`${item.width}px`);cards[id].style.setProperty('--widget-x',`${item.x}px`);cards[id].style.setProperty('--widget-y',`${item.y}px`);slots[id].style.height=`${item.slotHeight}px`;}
    }
    if(lastSnapshot)paint(lastSnapshot);
    return layout;
  }
  function fillEditor() {
    const item=geometry(draft,edited); form.elements.size.value=item.size;form.elements.rotation.value=item.rotation;form.elements.contentMode.value=draft[edited].contentMode;
    form.elements.x.value=Math.round(item.x*100);form.elements.y.value=Math.round(item.y*100);
    text(form.querySelector("output"),`${item.rotation}°`);
    form.querySelector("[data-widget-position-fields]").hidden=false;
    text(form.querySelector('legend'),desktop?'桌面位置':'手机位置 · 安全边界内');
  }
  function openEditor(id) {
    setAccount(); if(interaction)return;edited=id;draft=sanitizeHomeWidgets(config);
    text(dialog.querySelector("h2"),`设置${labels[id]} · ${desktop?'桌面':'手机'}布局`);
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
    cards.tools.dataset.hasContinue=String(!link.hidden);
  }
  function render(snapshot) { setAccount();lastSnapshot=snapshot;paint(snapshot); }
  function cancelGesture() {
    if(frame)view.cancelAnimationFrame(frame);frame=0;
    if(interaction){const current=interaction;interaction=null;config[current.id].layouts.desktop=current.original;cards[current.id].removeAttribute('data-dragging');try{current.handle.releasePointerCapture(current.pointerId);}catch(_){}}
  }
  function start(event) {
    const handle=event.target.closest("[data-widget-drag]");
    if(!handle||!desktop||!stage.dataset.editing||event.button!==0||event.isPrimary===false)return;
    event.preventDefault();setAccount();const id=handle.dataset.widgetDrag, bounds=stage.getBoundingClientRect(), card=cards[id], rect=card.getBoundingClientRect();
    interaction={id,handle,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,latestX:event.clientX,latestY:event.clientY,moved:false,bounds,rect,width:card.offsetWidth,height:card.offsetHeight,original:{...config[id].layouts.desktop}};
    handle.setPointerCapture(event.pointerId);card.dataset.dragging="true";
  }
  function paintGesture() {
      if(!interaction)return;const i=interaction,dx=i.latestX-i.startX,dy=i.latestY-i.startY;
      i.moved ||= homeWidgetDragMoved(dx,dy);
      if(!i.moved)return;
      const item=config[i.id].layouts.desktop,box=rotatedWidgetBox(i.width,i.height,item.rotation),roomX=Math.max(1,i.bounds.width-box.width-24),roomY=Math.max(1,i.bounds.height-box.height-24);
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
    if(!commit)config[i.id].layouts.desktop=i.original;
    cards[i.id].removeAttribute("data-dragging");try{i.handle.releasePointerCapture(i.pointerId);}catch(_){}
    const layout=apply(i.id);
    if(commit){if(layout){config[i.id].layouts.desktop.x=layout[i.id].normalizedX;config[i.id].layouts.desktop.y=layout[i.id].normalizedY;}suppressed={id:i.id,until:view.performance.now()+500};persist();}
  }
  root.addEventListener("click",event=>{
    const edit=event.target.closest("[data-widget-edit]");if(edit){event.stopPropagation();openEditor(edit.dataset.widgetEdit);return;}
    if(event.target.closest("[data-widget-drag]")){event.preventDefault();return;}
    if(event.target.closest("#homeLayoutToggle")){stage.dataset.editing=stage.dataset.editing?"":"true";root.querySelector("#homeLayoutToggle").setAttribute("aria-pressed",String(Boolean(stage.dataset.editing)));return;}
    if(event.target.closest("#homeLayoutReset")){const defaults=defaultHomeWidgets();for(const id of WIDGET_IDS)config[id].layouts[profile]={...defaults[id].layouts[profile]};draft=null;apply();persist();return;}
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
    const item=config[id].layouts.desktop;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight')item.x=clamp(item.x+(event.key==='ArrowLeft'?-amount:amount),0,1,0);
    else item.y=clamp(item.y+(event.key==='ArrowUp'?-amount:amount),0,1,0);
    const layout=apply(id);if(layout){item.x=layout[id].normalizedX;item.y=layout[id].normalizedY;}persist();
  });
  form.addEventListener("input",()=>{
    if(!draft)return;draft[edited].layouts[profile]={size:form.elements.size.value,rotation:form.elements.rotation.value,x:Number(form.elements.x.value)/100,y:Number(form.elements.y.value)/100};draft[edited].contentMode=form.elements.contentMode.value;draft=sanitizeHomeWidgets(draft);
    text(form.querySelector("output"),`${geometry(draft,edited).rotation}°`);apply(edited);
  });
  form.addEventListener("submit",event=>{event.preventDefault();if(!dialog.open||!draft)return;config=sanitizeHomeWidgets(draft);draft=null;persist();dialog.close();apply();});
  form.addEventListener("click",event=>{
    if(event.target.closest("[data-widget-reset]")){draft[edited].layouts[profile]={...defaultHomeWidgets()[edited].layouts[profile]};fillEditor();apply(edited);}
    if(event.target.closest("[data-widget-angle-reset]")){draft[edited].layouts[profile].rotation=defaultHomeWidgets()[edited].layouts[profile].rotation;fillEditor();apply(edited);}
    if(event.target.closest("[data-widget-cancel]"))dialog.close();
  });
  // close is queued: an older dialog session must not clear a newly opened draft.
  dialog.addEventListener("close",()=>{if(dialog.open)return;draft=null;edited="";apply();});
  const resize=()=>{const next=desktopNow();cancelGesture();if(next!==desktop&&dialog.open){draft=null;edited='';dialog.close();}desktop=next;profile=desktop?'desktop':'mobile';apply();if(draft)fillEditor();};
  view.addEventListener("resize",resize);
  let observedWidth=-1,observedHeight=-1;
  const observer=new view.ResizeObserver(entries=>{const {width,height}=entries[0].contentRect;if(width===observedWidth&&height===observedHeight)return;observedWidth=width;observedHeight=height;if(frame||interaction)return;frame=view.requestAnimationFrame(()=>{frame=0;apply();});});observer.observe(stage);
  setAccount();
  return Object.freeze({render,setAccount,snapshot:()=>sanitizeHomeWidgets(config),hide:()=>{const active=Boolean(interaction);cancelGesture();if(active)apply();if(dialog.open)dialog.close();},dispose:()=>{cancelGesture();observer.disconnect();view.removeEventListener("resize",resize);}});
}
