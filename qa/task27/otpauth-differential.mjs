import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import {Miniflare} from 'miniflare';
import {base32,randomBytes,totpAt,totpUri,matchingTotpStep} from '../../functions/_lib/task27-crypto.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const lab=path.resolve(process.env.AERIS_TASK27_ORACLE_DIR || path.join(root,'.wrangler/task27-reference/otpauth-lab'));
const libraryPath=path.join(lab,'node_modules/otpauth/dist/otpauth.node.mjs');
const otp=await import(pathToFileURL(libraryPath));
const jsQR=createRequire(import.meta.url)(path.join(lab,'node_modules/jsqr/dist/jsQR.js'));
const vendor=await readFile(path.join(root,'vendor/qrcode.js'),'utf8');
const context={module:{exports:{}},exports:{},TextEncoder};vm.runInNewContext(vendor,context);
const qrFactory=context.module.exports;
assert.equal(typeof qrFactory,'function');
const proof={reference:'https://github.com/hectorm/otpauth',version:otp.version,license:'MIT',production_dependency_added:false,checks:[],real_authenticator_apps:'OWNER_NOT_TESTED'};
const out=path.join(root,'.wrangler/task27-oracle');await mkdir(out,{recursive:true});
try{
 let vectors=0;
 for(let i=0;i<256;i++){
  const secret=base32(randomBytes(20)),timestamp=[59000,1111111109000,20000000000000,Date.UTC(2055,0,1),Date.now()][i%5]+i*30000;
  const reference=new otp.TOTP({issuer:'Aeris',label:'synthetic',secret:otp.Secret.fromBase32(secret),algorithm:'SHA1',digits:6,period:30});
  const code=await totpAt(secret,Math.floor(timestamp/30000));assert.equal(code,reference.generate({timestamp}));
  assert.equal(await matchingTotpStep(secret,code,timestamp),Math.floor(timestamp/30000));
  assert.notEqual(reference.validate({token:code,timestamp,window:1}),null);
  vectors++;
 }
 proof.checks.push({name:'Web Crypto vs OTPAuth independent generation and validation',status:'PASS',vectors});
 let uriCases=0;
 for(const username of ['synthetic-user','用户样本','alice+lab@example.test','label:with:colon']){
  const secret=base32(randomBytes(20)),uri=totpUri(username,secret),parsed=otp.URI.parse(uri);
  assert.equal(parsed.issuer,'Aeris');assert.equal(parsed.label,username);assert.equal(parsed.secret.base32,secret);assert.equal(parsed.algorithm,'SHA1');assert.equal(parsed.digits,6);assert.equal(parsed.period,30);
  const qr=qrFactory(0,'M');qr.addData(uri);qr.make();const modules=qr.getModuleCount(),scale=4,width=(modules+8)*scale,pixels=new Uint8ClampedArray(width*width*4).fill(255);
  for(let row=0;row<modules;row++)for(let col=0;col<modules;col++)if(qr.isDark(row,col))for(let y=0;y<scale;y++)for(let x=0;x<scale;x++){const offset=(((row+4)*scale+y)*width+(col+4)*scale+x)*4;pixels[offset]=pixels[offset+1]=pixels[offset+2]=0;}
  const decoded=jsQR(pixels,width,width);assert.ok(decoded);assert.equal(decoded.data,uri);
  const timestamp=Date.now(),fromQr=otp.URI.parse(decoded.data).generate({timestamp}),fromLink=otp.URI.parse(uri).generate({timestamp}),fromManual=new otp.TOTP({issuer:'Aeris',label:username,secret:otp.Secret.fromBase32(secret),algorithm:'SHA1',digits:6,period:30}).generate({timestamp});
  assert.equal(fromQr,fromLink);assert.equal(fromLink,fromManual);assert.equal(fromManual,await totpAt(secret,Math.floor(timestamp/30000)));uriCases++;
 }
 proof.checks.push({name:'existing QR encoder independently decoded; URI/link/manual configurations equivalent',status:'PASS',cases:uriCases,decoder:'jsQR 1.4.0 (MIT), isolated test tool only'});
 const esm=await readFile(path.join(lab,'node_modules/otpauth/dist/otpauth.esm.js'),'utf8');
 const secret=base32(randomBytes(20)),timestamp=Date.UTC(2050,0,1),expected=await totpAt(secret,Math.floor(timestamp/30000));
 await writeFile(path.join(out,'otpauth-reference.mjs'),esm);
 const entry=path.join(out,'reference-worker.mjs');
 await writeFile(entry,"import {TOTP,Secret} from './otpauth-reference.mjs'; export default {fetch(request,env){const totp=new TOTP({issuer:'Aeris',label:'synthetic',secret:Secret.fromBase32(env.REFERENCE_SECRET),algorithm:'SHA1',digits:6,period:30});return Response.json({token:totp.generate({timestamp:Number(env.REFERENCE_TIMESTAMP)})});}};");
 const runtime=new Miniflare({modules:true,compatibilityDate:'2026-08-06',scriptPath:entry,bindings:{REFERENCE_SECRET:secret,REFERENCE_TIMESTAMP:String(timestamp)}});
 try{const response=await runtime.dispatchFetch('https://oracle.local/');assert.equal((await response.json()).token,expected);}finally{await runtime.dispose();}
 proof.checks.push({name:'OTPAuth default browser ESM evaluated in actual workerd',status:'PASS',compatibility_date:'2026-08-06',esm_sha256:createHash('sha256').update(esm).digest('hex')});
 proof.status='PASS';
}catch(error){proof.status='FAIL';proof.error=error.message;process.exitCode=1;console.error(error.stack);}
finally{await writeFile(path.join(out,'result.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));}
