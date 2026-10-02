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
export function initPublicExperience(doc=globalThis.document) {
  const root=doc?.querySelector('[data-product-window]');if(!root||root.dataset.initialized==='true')return;
  root.dataset.initialized='true';const tabs=[...root.querySelectorAll('[data-public-product]')];
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
