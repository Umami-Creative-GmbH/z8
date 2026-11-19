// SANITIZED PUBLIC REFERENCE CLONE; DO NOT EXECUTE. Explicit __PLACEHOLDERS__ replace machine/scratch pointers.
// This models the test-server transport boundary; it does not reproduce canonical storage, authentication, or PostgreSQL.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';

const root=resolve('__PUBLIC_REFERENCE_SCRATCH__');
const phase=process.argv[2]??'attempt';
assert.match(phase,/^[a-z0-9-]+$/);
const secondName=process.argv[3]??'300.pdf';
assert.match(secondName,/^[a-z0-9-]+\.pdf$/);
const req=createRequire(resolve('apps/webapp/package.json'));
const esbuild=createRequire(resolve('package.json'))('./node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js');
const puppeteer=createRequire(resolve('package.json'))('puppeteer-core');
mkdirSync(root,{recursive:true});
await esbuild.build({entryPoints:[resolve(root,'caller.tsx')],outfile:resolve(root,'caller.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':resolve('apps/webapp/src')},nodePaths:[resolve('apps/webapp/node_modules')],define:{'process.env.NODE_ENV':'"development"'},logLevel:'silent'});
const pdf=Buffer.from('%PDF-1.4\n% synthetic upload transport probe\n%%EOF\n');
const pdfPath=resolve(root,'300.pdf');writeFileSync(pdfPath,pdf);
const secondPath=resolve(root,secondName);if(secondPath!==pdfPath)writeFileSync(secondPath,pdf);
const metadata=new Map(),objects=new Map(),events=[],staged=[],stageAttempts=[];
const server=createServer(async(request,response)=>{
  const path=new URL(request.url,'http://localhost').pathname;
  const chunks=[];for await(const chunk of request)chunks.push(chunk);const bytes=Buffer.concat(chunks);
  const send=(status,headers={},body='')=>{events.push({method:request.method,path,status});response.writeHead(status,headers);response.end(body);};
  if(request.method==='GET'&&path==='/')return send(200,{'Content-Type':'text/html'},'<div id="root"></div><script src="/caller.js"></script>');
  if(request.method==='GET'&&path==='/caller.js')return send(200,{'Content-Type':'text/javascript'},readFileSync(resolve(root,'caller.js')));
  if(request.method==='OPTIONS')return send(204,{'Tus-Resumable':'1.0.0','Tus-Version':'1.0.0','Tus-Extension':'creation,creation-with-upload','Access-Control-Allow-Methods':'OPTIONS,POST,HEAD,PATCH'});
  if(request.method==='POST'&&path==='/api/tus'){
    const key='upload-'+(metadata.size+1);const length=Number(request.headers['upload-length']);
    metadata.set(key,{length,offset:bytes.length});objects.set(key,bytes);
    return send(201,{'Tus-Resumable':'1.0.0',Location:'/api/tus/'+key,'Upload-Offset':String(bytes.length)});
  }
  if(path.startsWith('/api/tus/')){
    const key=decodeURIComponent(path.slice('/api/tus/'.length)),upload=metadata.get(key);
    if(!upload)return send(404,{'Tus-Resumable':'1.0.0'});
    if(request.method==='HEAD')return send(200,{'Tus-Resumable':'1.0.0','Upload-Offset':String(upload.offset),'Upload-Length':String(upload.length)});
    if(request.method==='PATCH'){
      objects.set(key,Buffer.concat([objects.get(key)??Buffer.alloc(0),bytes]));upload.offset+=bytes.length;
      return send(204,{'Tus-Resumable':'1.0.0','Upload-Offset':String(upload.offset)});
    }
  }
  if(request.method==='POST'&&path==='/api/upload/personnel-file/payslip-batch'){
    const input=JSON.parse(bytes.toString('utf8'));
    stageAttempts.push(input);
    if(!objects.has(input.tusFileKey))return send(500,{'Content-Type':'application/json'},JSON.stringify({error:'Processing failed'}));
    assert.equal(objects.get(input.tusFileKey).equals(pdf),true);
    objects.delete(input.tusFileKey);staged.push({batchId:input.batchId,fileName:input.fileName,key:input.tusFileKey});
    return send(200,{'Content-Type':'application/json'},JSON.stringify({success:true}));
  }
  return send(404);
});
let browser,base,observed;
try{
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
  base='http://127.0.0.1:'+server.address().port;
  browser=await puppeteer.launch({executablePath:'__CHROME_EXECUTABLE__',headless:true,args:['--disable-notifications','--disable-background-networking','--no-first-run']});
  const page=await browser.newPage();await page.setRequestInterception(true);
  page.on('request',request=>{if(request.url().startsWith(base+'/')||request.url()==='about:blank')void request.continue();else void request.abort();});
  await page.goto(base,{waitUntil:'networkidle0'});
  await page.waitForSelector('input[type=file]');
  await (await page.$('input[type=file]')).uploadFile(pdfPath);
  await page.waitForFunction(()=>document.querySelector('[aria-label="Staged files"]').textContent==='1',{timeout:5000});
  await page.click('button');
  await page.waitForFunction(()=>document.querySelector('[aria-label="Current batch"]').textContent==='probe-batch-2');
  await (await page.$('input[type=file]')).uploadFile(secondPath);
  await page.waitForFunction(()=>Number(document.querySelector('[aria-label="Staged files"]').textContent)+Number(document.querySelector('[aria-label="Failed files"]').textContent)>0,{timeout:5000});
  observed=await page.evaluate(()=>({batch:document.querySelector('[aria-label="Current batch"]').textContent,staged:Number(document.querySelector('[aria-label="Staged files"]').textContent),failed:Number(document.querySelector('[aria-label="Failed files"]').textContent),status:document.querySelector('[role="status"]').textContent}));
  assert.equal(observed.staged,1,'The same PDF must stage in a second batch after the first consumes its temporary object');
  assert.equal(staged.length,2);assert.notEqual(staged[0].key,staged[1].key);
}catch(error){process.exitCode=1;observed={...observed,error:error.message};}
finally{
  if(browser)await browser.close();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  const result={phase,secondName,realClientHook:true,realBrowser:true,testServerModelsConsumedTemporaryObjects:true,fullApplicationOrCanonicalStorage:false,sourceSha256:createHash('sha256').update(readFileSync('apps/webapp/src/components/personnel-file/use-payslip-batch-upload.ts')).digest('hex'),observed,events,stageAttempts,staged,browserClosed:true,listenerClosed:!server.listening,exit:process.exitCode??0};
  writeFileSync(resolve(root,phase+'.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}
