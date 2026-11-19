globalThis.uploadObserved=[];const response=async x=>{const u=new URL(x.url());if(u.pathname.startsWith('/api/tus')||u.pathname==='/api/upload/personnel-file/payslip-batch'){const request=x.request();uploadObserved.push({method:request.method(),route:u.pathname.startsWith('/api/tus')?'/api/tus/<upload>':'/api/upload/personnel-file/payslip-batch',status:x.status()});}};p.on('response',response);
const{join}=await import('node:path');const{copyFile}=await import('node:fs/promises');
try{
await(await p.$('input[type=file]')).uploadFile(join(h.directory,'inputs','300.pdf'));
await p.waitForFunction(()=>[...document.querySelectorAll('[role=alert]')].some(e=>e.checkVisibility()&&e.textContent.includes('300.pdf: Processing failed')));
await poll(()=>uploadObserved.some(x=>x.route==='/api/upload/personnel-file/payslip-batch'&&x.status===500));
const failedFiles=(await db.query('select file_name from payslip_batch_file where organization_id=$1 and batch_id=$2',[org,operationalId])).rows;
check('ordinary repeated same-PDF selection reproduces public staging500 and zero added files',failedFiles.length===0);await cap('upload-repeated-file-failed');
const repeatedRequests=[...uploadObserved];uploadObserved.length=0;await copyFile(join(h.directory,'inputs','300.pdf'),join(h.directory,'inputs','300-control.pdf'));
await(await p.$('input[type=file]')).uploadFile(join(h.directory,'inputs','300-control.pdf'));await p.waitForFunction(()=>document.querySelector('main')?.innerText.includes('300-control.pdf')&&[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Save 1 payslips'&&!e.disabled));
const controls=(await db.query('select file_name,document_id from payslip_batch_file where organization_id=$1 and batch_id=$2',[org,operationalId])).rows;
check('same-PDF-bytes fresh filename control stages one file with zero documents',controls.length===1&&controls[0].file_name==='300-control.pdf'&&controls[0].document_id===null);
results.uploadStop={confirmed:true,source:await h.source(),publicRepro:['Initial batch: upload300.pdf successfully','Start another ordinary batch with same actor/org','Select identical300.pdf again','Observe uploaded1/1 plus Processing failed; stage endpoint500 and zero batch files','Repeat same ordinary selection: same500/zero files','Same bytes renamed300-control.pdf stages successfully'],repeatedRequests,freshNameControlRequests:[...uploadObserved],failedFileCount:failedFiles.length,controlFileCount:controls.length,documents:0,missingTemporaryObject:'Owned development log identifies NoSuchKey; underlying cause/fingerprint attribution remains an inference until controlled historical run',samePdfBytes:true,broaderAcceptanceStopped:true};return results.uploadStop;
}finally{p.off('response',response);}
