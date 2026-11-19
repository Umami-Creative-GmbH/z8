await p.click('#personnel-files-toggle');await p.waitForFunction(()=>document.querySelector('#personnel-files-toggle')?.getAttribute('aria-checked')==='true');
check('personnel feature enabled through public organization settings',true);
results.initialPrerequisites={canonicalSyntheticAccountsAndApprovedMemberships:true,featureInitiallyDisabled:true,featureEnabledThroughPublicUI:true,officerGrantsInitiallyAbsent:true};
await db.query('BEGIN');try{
 await db.query('LOCK TABLE payslip_batch_file IN ACCESS EXCLUSIVE MODE');
 globalThis.nav=p.goto(h.r.origin+'/en/personnel-files/payslip-batches',{waitUntil:'domcontentloaded',timeout:90000}).catch(e=>({error:e.name}));
 const blocked=await poll(async()=>{await db.query('select pg_stat_clear_snapshot()');return (await db.query("select pid from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and state='active' and query ilike '%payslip_batch%' and query ilike '%payslip_batch_file%' and pg_backend_pid()=any(pg_blocking_pids(pid))")).rows.length;},500);
 await p.waitForFunction(()=>[...document.querySelectorAll('[role=status]')].some(e=>e.checkVisibility()&&e.textContent.includes('Loading payslip batches')));
 const observed=await p.evaluate(()=>({h1:[...document.querySelectorAll('h1')].filter(e=>e.checkVisibility()).map(e=>e.textContent.trim()),status:[...document.querySelectorAll('[role=status]')].filter(e=>e.checkVisibility()).map(e=>e.textContent.trim()),start:[...document.querySelectorAll('button')].filter(e=>e.checkVisibility()&&e.textContent.trim()==='Start batch').length,history:[...document.querySelectorAll('a[href*="/personnel-files/payslip-batches/"]')].filter(e=>e.checkVisibility()).length}));
 check('actual exported route streams safe one-h1 fallback while own history SELECT blocked',observed.h1.length===1&&observed.h1[0]==='Payslip batches'&&observed.start===0&&observed.history===0);
 results.streamedFallback={blockedOwnSelectCount:blocked,observed};results.captures.push(await h.capture(p,'current-actual-streamed-loading'));
}finally{await db.query('ROLLBACK');}
await nav;await p.waitForSelector('input[name=payPeriodYear]');await p.waitForFunction(()=>[...document.querySelectorAll('button')].some(e=>e.checkVisibility()&&e.textContent.trim()==='Start batch'&&!e.disabled));
const observed=await dom();check('admitted current route has one h1 and genuine own empty history',observed.h1.length===1&&observed.main.includes('No batches yet'));
globalThis.baseline=await snapshot();results.baselineCounts=Object.fromEntries(Object.entries(baseline).map(([k,v])=>[k,v.length]));return {streamed:results.streamedFallback,resolved:{h1:observed.h1,inputs:observed.inputs,main:observed.main}};
