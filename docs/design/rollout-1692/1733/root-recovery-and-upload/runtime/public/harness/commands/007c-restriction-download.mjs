globalThis.restricted=[];
for(const actor of ['small-manager','small-employee']){
 const c=await browser1733.createBrowserContext();await c.setPermission(h.r.origin,{permission:{name:'notifications'},state:'denied'});const page=await c.newPage();page.setDefaultTimeout(45000);
 try{await h.login(page,actor);await page.goto(h.r.origin+initialPath,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.body.innerText.includes('Page not found'));
 const result={actor,denied:true,protectedFilenamesVisible:await page.evaluate(()=>document.body.innerText.includes('unknown.pdf')||document.body.innerText.includes('100-200.pdf')),source:await h.source()};check(actor+' receives actual protected batch denial',!result.protectedFilenamesVisible);restricted.push(result);
 }finally{await c.close();}
}
const c=await browser1733.createBrowserContext();await c.setPermission(h.r.origin,{permission:{name:'notifications'},state:'denied'});const page=await c.newPage();page.setDefaultTimeout(45000);
try{await h.login(page,'small-employee');await h.go(page,'/my-documents');await page.waitForSelector('a[aria-label^="Download "]');
 const links=await page.$$eval('a[aria-label^="Download "]',es=>es.map(e=>({label:e.getAttribute('aria-label'),href:e.getAttribute('href')})));check('shared saved payslips reach actual employee My Documents',links.length===2);
 const{mkdir,readFile}=await import('node:fs/promises'),{join}=await import('node:path');const path=join(h.directory,'downloads');await mkdir(path,{recursive:true});const cd=await browser1733.target().createCDPSession();const events=[];let guid,name;
 cd.on('Browser.downloadWillBegin',e=>{guid=e.guid;name=e.suggestedFilename;events.push({event:'willBegin',guid:e.guid,fileName:e.suggestedFilename,urlPath:new URL(e.url).pathname});});cd.on('Browser.downloadProgress',e=>events.push({event:'progress',guid:e.guid,state:e.state,totalBytes:e.totalBytes,receivedBytes:e.receivedBytes}));
 await cd.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:path,browserContextId:c.id,eventsEnabled:true});await page.click('a[aria-label^="Download "]');await poll(()=>events.some(e=>e.event==='progress'&&e.guid===guid&&e.state==='completed'));
 const bytes=await readFile(join(path,name)),expected=await readFile(join(h.directory,'inputs','batch.zip'));const zip=await h.req('jszip').loadAsync(expected);let equal=null;for(const n of Object.keys(zip.files)){if(!n.endsWith('.pdf'))continue;const b=await zip.file(n).async('nodebuffer');if(bytes.equals(b))equal=n;}
 check('protected browser download completes and equals an original saved PDF',!!equal&&events.some(e=>e.state==='completed'&&e.receivedBytes===bytes.length));
 results.download={actor:'small-employee',source:await h.source(),events,bytes:bytes.length,sha256:h.sha(bytes),matchesOriginal:equal,privatePath:join(path,name),completed:true,pdfHeader:bytes.subarray(0,8).toString()};results.restricted=restricted;await cd.detach();return{restricted:restricted.map(x=>({actor:x.actor,denied:x.denied})),download:{completed:true,bytes:bytes.length,sha256:h.sha(bytes),matchesOriginal:equal}};
}finally{await c.close();}
