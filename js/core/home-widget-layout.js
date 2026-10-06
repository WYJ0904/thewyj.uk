/** UI preferences only. Content is shared; viewport geometry is never shared. */
export const HOME_WIDGET_VERSION = 2;
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
  const padding=Math.min(12,Math.max(4,stageWidth*.035)),verticalRoom=24;
  return Object.fromEntries(Object.entries(config).map(([id,item])=>{
    const preferred=sizes[item.size],angle=Math.abs(item.rotation)*Math.PI/180;
    const width=Math.max(1,Math.floor(Math.min(preferred.width,(stageWidth-2*padding-preferred.height*Math.sin(angle))/Math.cos(angle))));
    const box=rotatedWidgetBox(width,preferred.height,item.rotation),roomX=Math.max(0,stageWidth-box.width-2*padding);
    const bx=padding+item.x*roomX,by=padding+item.y*verticalRoom;
    return [id,{width,height:preferred.height,x:bx+(box.width-width)/2,y:by+(box.height-preferred.height)/2,
      slotHeight:Math.ceil(box.height+2*padding+verticalRoom),box:{x:bx,y:by,...box}}];
  }));
}
