import {passwordChecks,passwordIssues} from './password-policy.js?release=20261127-aeris-p5-cache-fix';
let fieldSerial=0;

export function wirePasswordVisibility(input) {
  if(!input || input.dataset.passwordVisibilityAttached)return;
  input.dataset.passwordVisibilityAttached='true';
  const oldGroup=input.closest('.secret-input-row,.admin-secret-input-wrap');
  if(oldGroup?.querySelector('button'))return;
  const group=document.createElement('span');group.className='task27-password-input';input.before(group);group.append(input);
  const label=group.closest('label');
  if(label){if(!input.id)input.id=`task27Password${++fieldSerial}`;label.htmlFor=input.id;label.after(group);}
  const button=document.createElement('button');button.type='button';button.textContent='显示';button.setAttribute('aria-label','显示密码');button.setAttribute('aria-pressed','false');
  if(input.id)button.setAttribute('aria-controls',input.id);
  button.addEventListener('click',()=>{const show=input.type==='password';input.type=show?'text':'password';button.textContent=show?'隐藏':'显示';button.setAttribute('aria-label',show?'隐藏密码':'显示密码');button.setAttribute('aria-pressed',String(show));});group.append(button);
}
export function wireNewPasswordField(input) {
  if(!input || input.dataset.passwordPolicyAttached)return;
  input.dataset.passwordPolicyAttached='true';input.minLength=9;input.maxLength=256;
  wirePasswordVisibility(input);
  const feedback=document.createElement('div');feedback.className='task27-password-requirements';feedback.id=(input.id||'task27NewPassword')+'Requirements';feedback.setAttribute('aria-live','polite');
  const list=document.createElement('ul');feedback.append(list);
  const items=passwordChecks('').slice(0,5).map(check=>{const item=document.createElement('li');item.dataset.passwordRule=check.key;list.append(item);return item;});
  const error=document.createElement('p');error.className='error';feedback.append(error);
  (input.closest('.task27-password-input,.secret-input-row') || input).after(feedback);
  input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),feedback.id].filter(Boolean).join(' '));
  const update=()=>{const checks=passwordChecks(input.value);checks.slice(0,5).forEach((check,i)=>{items[i].textContent=`${check.valid?'✓':'○'} ${check.label}${check.valid?'（已满足）':''}`;items[i].dataset.met=String(check.valid);});const issues=passwordIssues(input.value);input.setCustomValidity(input.value&&issues.length?issues.map(issue=>issue.label).join('；'):'');error.textContent=issues.filter(issue=>['maximum','control','common'].includes(issue.key)).map(issue=>issue.label).join('；');};
  input.addEventListener('input',update);input.addEventListener('change',update);update();
}
