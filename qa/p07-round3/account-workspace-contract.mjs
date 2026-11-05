import assert from 'node:assert/strict';

// Replaces the pre-P07 Escape-to-close-modal assertion with observable page
// structure and a trusted pointer navigation. The original failure is retained
// in docs/p07/evidence/round3/ci-failures.json.
export async function assertAccountWorkspaceNavigation(page){
  const before=await page.evaluate(`(()=>{const p=document.getElementById('accountModal');return{
    inMain:document.getElementById('v3MainCanvas').contains(p),modalLayer:Boolean(p.closest('.modal-layer')),
    shellInert:document.getElementById('appShell').inert,modalOpen:document.body.classList.contains('modal-open'),
    settingRows:document.querySelectorAll('#accountDetails > .account-setting-row').length,
    desktopNav:document.querySelector('#v3Sidebar [data-v3-nav="language"]').checkVisibility()}})()`);
  assert.equal(before.settingRows,8);
  assert.equal(before.inMain,true,'account must be a main-canvas page');
  assert.equal(before.modalLayer,false);assert.equal(before.shellInert,false);assert.equal(before.modalOpen,false);
  async function pointer(selector){
    await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
    await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const point=await page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);
      return{x,y,hit:h?.id||h?.tagName||null,ownsHit:Boolean(h&&(h===e||e.contains(h))),inert:Boolean(e.closest('[inert]'))}})()`);
    assert.equal(point.ownsHit,true,`account navigation is covered: ${JSON.stringify(point)}`);assert.equal(point.inert,false);
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
    return point;
  }
  let hit,route,surface;
  if(before.desktopNav){hit=await pointer('#v3Sidebar [data-v3-nav="language"]');route='/language';surface='projectPicker';}
  else{
    if(!await page.evaluate("document.getElementById('accountMenu').open"))await pointer('#accountMenu > summary');
    hit=await pointer('#homeBtn');route='/';surface='publicHome';
  }
  await page.waitFor(`location.pathname===${JSON.stringify(route)}&&!document.getElementById(${JSON.stringify(surface)}).classList.contains('hidden')`,10000,'account page navigation result');
  assert.equal(await page.evaluate("document.getElementById('accountModal').classList.contains('hidden')"),true,'prior account surface remains visible after navigation');
  return {before,hit,route,surface,actualNavigation:true};
}
