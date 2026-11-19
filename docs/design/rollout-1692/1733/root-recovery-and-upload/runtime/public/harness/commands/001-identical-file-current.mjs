await h.login(p,'small-admin');await h.go(p,'/settings/organization');await p.waitForSelector('#personnel-files-toggle');
if(await p.$eval('#personnel-files-toggle',e=>e.getAttribute('aria-checked')!=='true'))await p.click('#personnel-files-toggle');
await p.waitForFunction(()=>document.querySelector('#personnel-files-toggle')?.getAttribute('aria-checked')==='true');
check('feature enabled through public settings action',true);check('explicit notification-denied fixture policy',await p.evaluate(()=>typeof Notification==='undefined'||Notification.permission==='denied'));
globalThis.org=h.f.actors['small-admin'].organizationId;
globalThis.start=async()=>{await h.go(p,'/personnel-files/payslip-batches');await p.waitForSelector('input[name=payPeriodYear]');await h.click(p,'Start batch');await p.waitForFunction(()=>/\/payslip-batches\/[^/]+$/.test(location.pathname));await p.waitForSelector('input[type=file]');return(await p.evaluate(()=>location.pathname)).split('/').at(-1);};
globalThis.uploadTrace=[];
const observe=async x=>{const u=new URL(x.url());if(u.pathname.startsWith('/api/tus')||u.pathname==='/api/upload/personnel-file/payslip-batch'){const q=x.request();uploadTrace.push({method:q.method(),route:u.pathname.startsWith('/api/tus')?'/api/tus/<upload>':u.pathname,status:x.status(),uploadKey:u.pathname.startsWith('/api/tus/')?u.pathname.split('/').at(-1):null});}};
p.on('response',observe);
try{
 const file=(await import('node:path')).join(h.directory,'inputs','100.pdf');
 globalThis.firstId=await start();await(await p.$('input[type=file]')).uploadFile(file);
 await p.waitForFunction(()=>[...document.querySelectorAll('main button')].some(e=>e.textContent.trim()==='Save 1 payslips'&&!e.disabled));
 const first=(await db.query('select id,file_name,staged_storage_key,document_id from payslip_batch_file where organization_id=$1 and batch_id=$2',[org,firstId])).rows;
 globalThis.firstTrace=[...uploadTrace];uploadTrace.length=0;
 globalThis.initialId=await start();globalThis.initialPath=await p.evaluate(()=>location.pathname);
 await(await p.$('input[type=file]')).uploadFile(file);
 await p.waitForFunction(()=>[...document.querySelectorAll('main button')].some(e=>e.textContent.trim()==='Save 1 payslips'&&!e.disabled)||[...document.querySelectorAll('[role=alert]')].some(e=>e.textContent.includes('Processing failed')));
 const second=(await db.query('select id,file_name,staged_storage_key,document_id from payslip_batch_file where organization_id=$1 and batch_id=$2',[org,initialId])).rows;
 const docs=(await db.query('select count(*)::int n from employee_document where organization_id=$1',[org])).rows[0].n,notices=(await db.query('select count(*)::int n from notification where organization_id=$1',[org])).rows[0].n;
 results.identicalFile={samePhysicalPath:true,sameName:true,sameBytes:true,sameTransientContext:true,firstId,secondId:initialId,first,second,firstTrace,secondTrace:[...uploadTrace],documents:docs,notifications:notices,source:await h.source()};
 check('identical physical PDF stages in two ordinary public-start batches',first.length===1&&second.length===1&&first[0].file_name===second[0].file_name);
 check('second batch uses fresh TUS POST/PATCH/stage success',uploadTrace.some(x=>x.method==='POST'&&x.route==='/api/tus/<upload>'&&x.status===201)&&uploadTrace.some(x=>x.method==='PATCH'&&x.status===204)&&uploadTrace.some(x=>x.route==='/api/upload/personnel-file/payslip-batch'&&x.status===200)&&!uploadTrace.some(x=>x.status>=400));
 check('two batches have distinct staged keys and remain zero documents/notices',first[0].staged_storage_key!==second[0].staged_storage_key&&docs===0&&notices===0);
 return{identicalFileSuccess:true,firstTrace,secondTrace:uploadTrace,documents:docs,notifications:notices};
}finally{p.off('response',observe);}
