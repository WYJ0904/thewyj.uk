const https=require('node:https'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const qa=__dirname,root=path.resolve(qa,'../../../..');
const cases=new Map(),events=[];
const hash=x=>crypto.createHash('sha256').update(String(x)).digest('hex').slice(0,12);
const txn=(id,version=1)=>({id,direction:'income',amount_minor:123,currency:'CNY',merchant:'QA synthetic',occurred_at_ms:Date.now(),status:'active',revision:1,sync_version:version,source_kind:'automatic'});
function state(id){if(!cases.has(id))cases.set(id,{id,records:[],transactions:[txn('txn:qa3-old')],version:1,counts:{bootstrap:0,changes:0,summary:0,posts:0},holds:new Map(),holdAt:[],applied:new Set(),owner:'',altOwner:'',failPost:false});return cases.get(id)}
const clone=x=>JSON.parse(JSON.stringify(x));
function output(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
function trace(s,stage,owner){events.push({seq:events.length+1,caseId:s.id,stage,ownerHash:hash(owner),time:Date.now()});fs.writeFileSync(path.join(qa,'../network-timeline.json'),JSON.stringify(events,null,2));}
const server=https.createServer({key:fs.readFileSync(path.join(qa,'tls/qa-server-key.pem')),cert:fs.readFileSync(path.join(qa,'res/raw/aeris_qa_ca.pem'))},async(req,res)=>{
 try{
  const url=new URL(req.url,'https://127.0.0.1:18787');
  if(url.pathname==='/finance'){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'});res.end(fs.readFileSync(path.join(qa,'fixture.html')));return;}
  if(/^\/js\/(core|finance)\/[a-z0-9-]+\.js$/.test(url.pathname)){res.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8','Cache-Control':'no-store'});res.end(fs.readFileSync(path.join(root,url.pathname.slice(1))));return;}
  if(url.pathname==='/qa/control'){
   let body='';for await(const c of req){body+=c;if(body.length>50000)throw Error('QA_CONTROL_TOO_LARGE')};const b=JSON.parse(body);
   if(!/^T\d{2}$/.test(b.caseId))throw Error('QA_CASE_REQUIRED');const s=state(b.caseId);
   if(b.action!=='status')trace(s,'control:'+b.action+(b.key?':'+String(b.key).replace(/[^a-zA-Z0-9]/g,''):''),b.owner||s.owner);
   if(b.action==='setup'){s.owner=b.owner;s.records=b.records||[];s.transactions=b.transactions||[txn('txn:qa3-old')];s.version=Math.max(1,...s.transactions.map(t=>Number(t.sync_version)||1));s.counts={bootstrap:0,changes:0,summary:0,posts:0};s.applied=new Set();s.holdAt=[];s.holdSummary=false;s.failPost=false;}
   if(b.action==='arm'){s.counts={bootstrap:0,changes:0,summary:0,posts:0};s.holdAt=b.holdAt||[2];}
   if(b.action==='add'){s.version++;const t=txn('txn:qa3-new-'+s.version,s.version);t.notification_event_ids=['qa3-new-event-'+s.version];s.transactions.push(t);output(res,{ok:true,transaction:t,eventId:t.notification_event_ids[0]});return;}
   if(b.action==='release'){const waiting=s.holds.get(String(b.key));if(waiting){s.holds.delete(String(b.key));waiting();}}
   if(b.action==='records'){s.records=b.records||[];}
   if(b.action==='holdSummary'){s.holdSummary=true;s.altOwner=b.altOwner||'';s.altRecords=b.altRecords||[];s.altTransactions=[{...txn('txn:qa3-owner-b'),merchant:'QA owner B'}];}
   if(b.action==='failPost'){s.failPost=b.enabled===true;}
   if(b.action==='observe'){
    trace(s,'observe-'+b.request,s.owner);const payload={ok:true,request:b.request};
    res.once('finish',()=>trace(s,'response:observe'+b.request,s.owner));
    if(b.request==='A'){trace(s,'hold:observeA',s.owner);s.holds.set('observeA',()=>output(res,payload));return;}
    output(res,payload);return;
   }
   output(res,{ok:true,counts:s.counts,holds:[...s.holds.keys()],version:s.version,applied:s.applied.size});return;
  }
  if(url.pathname.startsWith('/api/')){
   const caseId=req.headers['x-qa-case'],owner=String(req.headers['x-qa-account']||'');
   if(!/^T\d{2}$/.test(caseId||'')||!owner.startsWith('qa3-')){output(res,{error:'QA_ONLY'},403);return;}
   const s=state(caseId);trace(s,url.pathname.split('/').slice(2).join('/'),owner);
   res.once('finish',()=>trace(s,'response:'+url.pathname.split('/').slice(2).join('/'),owner));
   const ledgerRows=owner===s.altOwner?s.altTransactions:s.transactions,ledgerVersion=owner===s.altOwner?1:s.version;
   if(url.pathname==='/api/notification/pending-summary'){
    s.counts.summary++;const records=clone(owner===s.altOwner?s.altRecords:s.records);const payload={records,total_count:records.filter(r=>r.state==='pending').length,truncated:false};
    if(s.holdSummary&&owner!==s.altOwner){s.holdSummary=false;trace(s,'hold:summary',owner);s.holds.set('summary',()=>output(res,payload));return;}
    output(res,payload);return;
   }
   if(url.pathname==='/api/finance/bootstrap'){s.counts.bootstrap++;output(res,{transaction_count:ledgerRows.filter(t=>t.status==='active').length,server_version:ledgerVersion,categories:[],budgets:[]});return;}
   if(url.pathname==='/api/finance/transactions'){output(res,{transactions:clone(ledgerRows)});return;}
   if(url.pathname==='/api/finance/changes'){
    s.counts.changes++;const seq=s.counts.changes,since=Number(url.searchParams.get('since')||0);
    const payload={changes:clone(ledgerRows.filter(t=>t.sync_version>since).map(t=>({entity_type:'transaction',entity_id:t.id,version:t.sync_version,payload:{transaction:t}}))),server_version:ledgerVersion,next_since:ledgerVersion,has_more:false};
    if(s.holdAt.includes(seq)){trace(s,'hold:changes'+seq,owner);s.holds.set('changes'+seq,()=>output(res,payload));return;}
    output(res,payload);return;
   }
   if(url.pathname==='/api/finance/sync'&&req.method==='POST'){
    s.counts.posts++;if(s.failPost){req.socket.destroy();return;}
    let body='';for await(const c of req)body+=c;const b=JSON.parse(body);for(const op of b.operations||[])s.applied.add(op.operation_id);
    output(res,{operation_results:[],changes:[],server_version:s.version,next_since:s.version,has_more:false});return;
   }
   output(res,{error:'QA_ROUTE_NOT_IMPLEMENTED'},404);return;
  }
  res.writeHead(404);res.end();
 }catch(e){if(!res.headersSent)output(res,{error:'QA_FIXTURE_ERROR'},500);}
});
server.listen(18787,'127.0.0.1',()=>console.log(JSON.stringify({stage:'QA_TLS_READY',origin:'https://127.0.0.1:18787',bind:'loopback-only',certificateSha256:hash(fs.readFileSync(path.join(qa,'res/raw/aeris_qa_ca.pem')))})));
