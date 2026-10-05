import assert from 'node:assert/strict';
import {putPartWithRecovery} from '../js/transfer/upload-part.js';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
class Request {
 constructor(script){this.script=script;this.upload={};this.headers={};this.aborted=false;}
 open(method,url){this.method=method;this.url=url;}
 setRequestHeader(k,v){this.headers[k]=v;}
 send(body){this.body=body;this.script(this);}
 abort(){this.aborted=true;this.onabort?.();}
 complete(status=201,text='{}'){if(this.aborted)return;this.status=status;this.responseText=text;this.onload();}
}
const body=new Blob(['immutable part']);const calls=[];
const common={url:'/api/transfer/uploads/owned/files/owned/parts/6',body,headers:{'X-Part-Sha256':'same-digest'},idleTimeoutMs:25,retryDelayMs:0};
await putPartWithRecovery({...common,createRequest:()=>{const index=calls.length;const x=new Request(r=>{if(index)r.complete();});calls.push(x);return x;}});
assert.equal(calls.length,2);assert.equal(calls[0].aborted,true);
for(const x of calls){assert.equal(x.body,body);assert.equal(x.url,common.url);assert.equal(x.headers['X-Part-Sha256'],'same-digest');}
let progressRequest;await putPartWithRecovery({...common,createRequest:()=>progressRequest=new Request(async r=>{for(let i=0;i<5;i++){await wait(10);r.upload.onprogress({loaded:i+1});}r.complete();})});assert.equal(progressRequest.aborted,false,'active slow uploads must retain their socket');
const duplicates=[];
await putPartWithRecovery({...common,createRequest:()=>{
 const index=duplicates.length,x=new Request(r=>{
  if(index)return r.complete();
  r.readyState=2;r.onreadystatechange();r.upload.onprogress({loaded:10});
  const interval=setInterval(()=>{if(r.aborted)return clearInterval(interval);r.upload.onprogress({loaded:10});r.onreadystatechange();},5);
 });duplicates.push(x);return x;
}});
assert.equal(duplicates.length,2,'duplicate progress/state events cannot suppress recovery');
assert.equal(duplicates[0].aborted,true);
const acknowledgements=[];
await putPartWithRecovery({...common,idleTimeoutMs:100,acknowledgementTimeoutMs:25,createRequest:()=>{
 const index=acknowledgements.length,x=new Request(r=>{
  if(index)return r.complete();
  r.upload.onload();let received=0;
  const interval=setInterval(()=>{if(r.aborted)return clearInterval(interval);r.onprogress({loaded:++received});},5);
 });acknowledgements.push(x);return x;
}});
assert.equal(acknowledgements.length,2,'response progress cannot extend the post-upload acknowledgement budget');
assert.equal(acknowledgements[0].aborted,true);
assert.equal(acknowledgements[0].body,acknowledgements[1].body);
let count=0;const cancel=new AbortController();const pending=putPartWithRecovery({...common,signal:cancel.signal,createRequest:()=>{count++;return new Request(()=>{});}});cancel.abort();await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(count,1,'user cancel never retries');
count=0;await assert.rejects(putPartWithRecovery({...common,createRequest:()=>{count++;return new Request(r=>r.complete(403,'{"code":"forbidden","error":"denied"}'));}}),e=>e.code==='forbidden');assert.equal(count,1,'permission/integrity failures are not retried');
count=0;await assert.rejects(putPartWithRecovery({...common,attempts:3,createRequest:()=>{count++;return new Request(r=>r.onerror());}}),e=>e.code==='part_network_error');assert.equal(count,3,'network recovery stays bounded');
console.log('PASS stalled part recovery, immutable retry, real-progress watchdog, acknowledgement deadline, cancel, hard failure and retry bound');
