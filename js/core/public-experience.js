/** P3 public window: real local interactions, no authenticated writes or timers. */
export function publicTextMetrics(value) {
  const text=String(value ?? '');return {characters:Array.from(text).length,lines:text.length?text.split(/\r\n|\r|\n/).length:0};
}
export function publicBudgetBalance(income,expense) {
  const minor=value=>{const n=Number(value);return Number.isFinite(n)&&n>=0&&n<=999999999?Math.round(n*100):0;};
  return (minor(income)-minor(expense))/100;
}
export function publicLearningResult(answer) {
  return answer==='phone'?'正确，電話的意思是“电话”。':'再想一下：電話的意思是“电话”。';
}
/** Presentation of the existing membership owner's catalog; no pricing rules. */
export function publicPlanCatalog(plans) {
  const result={modules:[],permanent:[]};
  for(const plan of Array.isArray(plans)?plans:[]){
    if(plan.purchasable!==true||!Number.isSafeInteger(plan.price_cents)||plan.price_cents<0||!/^\w{3}$/.test(plan.currency||''))continue;
    let price;try{price=new Intl.NumberFormat('zh-CN',{style:'currency',currency:plan.currency}).format(plan.price_cents/100);}catch{continue;}
    const term=plan.lifetime===true?'永久':Number(plan.duration_months)===1?'每月':Number(plan.duration_months)>0?`${plan.duration_months} 个月`:'';
    const group=plan.lifetime===true||plan.entitlements?.includes('all_features_access')?'permanent':'modules';
    result[group].push({code:plan.code,name:plan.name,price,term,description:plan.description||''});
  }
  return result;
}
export function renderPublicPlanCatalog(doc,plans,error='') {
  const catalog=publicPlanCatalog(plans);
  for(const [group,id]of [['modules','publicModulePlans'],['permanent','publicPermanentPlans']]){
    const list=doc.getElementById(id);if(!list)continue;
    const nodes=catalog[group].map(plan=>{const item=doc.createElement('li');item.dataset.planCode=plan.code;const name=doc.createElement('span');name.textContent=plan.name;const price=doc.createElement('strong');price.textContent=`${plan.price} · ${plan.term}`;item.append(name,price);return item;});
    if(!nodes.length){const item=doc.createElement('li');item.textContent=error?'目录暂不可用，请在账户页面查看。':'当前没有可购买的对应方案。';nodes.push(item);}list.replaceChildren(...nodes);
  }
  const status=doc.getElementById('publicPlanStatus');if(status)status.textContent=error?'当前套餐目录读取失败，其他入口仍可使用。':'价格与权益来自当前套餐目录，具体开通规则以账户页面为准。';
  doc.getElementById('publicPlanRetryBtn')?.classList.toggle('hidden',!error);
}
export function initPublicExperience(doc=globalThis.document) {
  const root=doc?.querySelector('[data-product-window]');if(!root||root.dataset.initialized==='true')return;
  root.dataset.initialized='true';const tabs=[...root.querySelectorAll('[data-public-product]')];
  doc.querySelectorAll('#publicHome [data-public-trigger]').forEach(button=>button.addEventListener('click',event=>{event.preventDefault();doc.getElementById(button.dataset.publicTrigger)?.click();}));
  doc.querySelectorAll('#publicHome [data-public-open]').forEach(button=>button.addEventListener('click',()=>{const tab=tabs.find(item=>item.dataset.publicProduct===button.dataset.publicOpen);tab?.click();tab?.focus({preventScroll:true});root.scrollIntoView({block:'start',behavior:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}));
  // The restored P2 gallery owns only disclosure selection, never product data.
  const gallery=doc.querySelector('[data-core-card-gallery]');
  const cards=[...(gallery?.querySelectorAll('[data-core-capability]')||[])];
  for(const [index,card]of cards.entries()){
    const trigger=card.querySelector('.capability-trigger');
    trigger.addEventListener('focus',()=>trigger.click());
    trigger.addEventListener('click',()=>{
      for(const item of cards){
        const active=item===card;
        item.classList.toggle('active',active);
        item.querySelector('.capability-trigger').setAttribute('aria-expanded',String(active));
        item.querySelector('.capability-body').hidden=!active;
      }
    });
    trigger.addEventListener('keydown',event=>{
      let next=index;
      if(event.key==='ArrowRight'||event.key==='ArrowDown')next=(index+1)%cards.length;
      else if(event.key==='ArrowLeft'||event.key==='ArrowUp')next=(index+cards.length-1)%cards.length;
      else if(event.key==='Home')next=0;
      else if(event.key==='End')next=cards.length-1;
      else return;
      event.preventDefault();
      const button=cards[next].querySelector('.capability-trigger');button.click();button.focus({preventScroll:true});
    });
  }
  function select(tab,{focus=false}={}) {
    for(const button of tabs){const active=button===tab;button.setAttribute('aria-selected',String(active));button.setAttribute('aria-expanded',String(active));button.tabIndex=active?0:-1;const panel=doc.getElementById(button.getAttribute('aria-controls'));panel.hidden=!active;panel.classList.toggle('active',active);}
    root.dataset.selected=tab.dataset.publicProduct;if(focus)tab.focus();
  }
  for(const [index,tab]of tabs.entries()){
    tab.addEventListener('click',()=>select(tab));
    tab.addEventListener('keydown',event=>{let next=index;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();select(tabs[next],{focus:true});});
  }
  const answers=[...root.querySelectorAll('[data-public-answer]')];
  for(const button of answers)button.addEventListener('click',()=>{for(const answer of answers)answer.setAttribute('aria-pressed',String(answer===button));doc.getElementById('publicLearningResult').textContent=publicLearningResult(button.dataset.publicAnswer);});
  doc.getElementById('publicLearningReset')?.addEventListener('click',()=>{for(const answer of answers)answer.setAttribute('aria-pressed','false');doc.getElementById('publicLearningResult').textContent='选择一个答案。';});
  const input=doc.getElementById('publicTextInput');const textChanged=()=>{const value=publicTextMetrics(input.value);doc.getElementById('publicTextCharacters').textContent=String(value.characters);doc.getElementById('publicTextLines').textContent=String(value.lines);};
  input?.addEventListener('input',textChanged);doc.getElementById('publicTextClear')?.addEventListener('click',()=>{input.value='';textChanged();input.focus();});
  const income=doc.getElementById('publicBudgetIncome'),expense=doc.getElementById('publicBudgetExpense');const budgetChanged=()=>{doc.getElementById('publicBudgetBalance').textContent=new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(publicBudgetBalance(income.value,expense.value));};
  income?.addEventListener('input',budgetChanged);expense?.addEventListener('input',budgetChanged);
  const files=doc.getElementById('publicFilesInput');doc.getElementById('publicFilesChoose')?.addEventListener('click',()=>files.click());
  files?.addEventListener('change',()=>{const preview=doc.getElementById('publicFilesPreview');const list=[...files.files].slice(0,3);const nodes=list.map(file=>{const item=doc.createElement('li');item.textContent=`${file.name} · ${new Intl.NumberFormat('zh-CN',{maximumFractionDigits:1}).format(file.size/1024)} KB`;return item;});if(!nodes.length){const item=doc.createElement('li');item.textContent='尚未选择文件。';nodes.push(item);}if(files.files.length>3){const item=doc.createElement('li');item.textContent=`另有 ${files.files.length-3} 个文件`;nodes.push(item);}preview.replaceChildren(...nodes);});
  select(tabs[0]);
}
