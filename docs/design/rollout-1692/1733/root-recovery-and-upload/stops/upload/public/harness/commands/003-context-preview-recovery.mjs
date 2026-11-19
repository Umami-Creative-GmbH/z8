await p.waitForFunction(()=>document.querySelector('main')?.innerText.includes('unknown.pdf'));
globalThis.ctxRequests=[];let fail=true;
await p.setRequestInterception(true);const intercept=async q=>{if(q.isInterceptResolutionHandled())return;if(q.method()==='GET'&&new URL(q.url()).pathname==='/api/auth/context'){ctxRequests.push({method:'GET',path:'/api/auth/context',controlled503:fail});if(fail){fail=false;await q.respond({status:503,contentType:'application/json',body:JSON.stringify({error:'Controlled disposable context read failure'})});return;}}await q.continue();};p.on('request',intercept);
try{await h.click(p,'Refresh data');await p.waitForFunction(()=>[...document.querySelectorAll('[role=alert]')].some(e=>e.checkVisibility()&&e.textContent.includes('Your current organization could not be confirmed')));
check('actual failed context GET gates protected file preview and retains safe one-h1',ctxRequests.length===1&&(await dom()).h1.length===1&&!((await dom()).main??'').includes('unknown.pdf'));await cap('context-read-failed');
await h.click(p,'Retry');await p.waitForFunction(()=>document.querySelector('main')?.innerText.includes('unknown.pdf'));check('local context Retry invokes second actual GET and restores same batch',ctxRequests.length===2);await cap('context-read-recovered');
}finally{p.off('request',intercept);await p.setRequestInterception(false);}
results.contextRecovery={requests:ctxRequests,mechanism:'One actual context GET controlled503 through HeaderRefresh; local Retry reaches real endpoint',scopeGateUnmountDraftRetention:false};
let cancelled=0;await db.query('BEGIN');try{
await db.query('LOCK TABLE payslip_batch_file IN ACCESS EXCLUSIVE MODE');await h.click(p,'Refresh data');
const rows=await poll(async()=>{await db.query('select pg_stat_clear_snapshot()');const xs=(await db.query("select pid from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and state='active' and wait_event_type='Lock' and query ilike 'select %' and query ilike '%payslip_batch_file%' and pg_backend_pid()=any(pg_blocking_pids(pid))")).rows;return xs.length?xs:null;},400);
for(const row of rows){assert.equal((await db.query('select pg_cancel_backend($1) ok',[row.pid])).rows[0].ok,true);cancelled++;}
}finally{await db.query('ROLLBACK');}
await p.waitForFunction(()=>[...document.querySelectorAll('[role=alert]')].some(e=>e.checkVisibility()&&e.textContent.includes('The payslip batch could not be loaded.')));
check('actual preview SELECT failure replaces stale preview with generic error and local Retry',!(await dom()).main.includes('unknown.pdf'));await cap('preview-read-failed');
await h.click(p,'Retry');await p.waitForFunction(()=>document.querySelector('main')?.innerText.includes('unknown.pdf'));await cap('preview-read-recovered');
check('actual local preview Retry restores all five staged records',await p.$$eval('main [role=checkbox]',es=>es.length===5));results.previewRecovery={mechanism:'Own ACCESS EXCLUSIVE payslip_batch_file lock; only SELECTs proven blocked by own backend via pg_blocking_pids were cancelled; rollback finally',cancelledOwnSelects:cancelled,retryRestoresFive:true};
return{contextRequests:ctxRequests.length,previewCancelledSelects:cancelled,contextAndPreviewRecovered:true};
