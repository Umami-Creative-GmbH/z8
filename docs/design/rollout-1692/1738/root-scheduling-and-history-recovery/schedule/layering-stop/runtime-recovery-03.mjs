import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';
const dir=resolve('.tmp/1738-independent-checks'),meta=JSON.parse(await readFile(join(dir,'browser-controller-01.private.json'),'utf8'));const hash=s=>createHash('sha256').update(s).digest('hex');
async function call(method,args={},name){const r=await fetch(`http://127.0.0.1:${meta.port}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method,args})});const raw=await r.text(),v=JSON.parse(raw);if(name){await writeFile(join(dir,name+'.raw-private.json'),raw,{flag:'wx'});await writeFile(join(dir,name+'.json'),JSON.stringify({rawSha256:hash(raw),...v},null,2),{flag:'wx'});}if(!v.ok)throw Error(method+': '+v.error.message);return v.data;}
const before=(await call('actions')).observations.length;const results={};
assert.ok(!(await call('state')).text.includes('Coverage could not be loaded'));
await call('failure',{name:'getTargetHeatmapData',mode:'abort'},'coverage-failure-arm-03');
try{
 await call('selector',{selector:'button[aria-label="Refresh data"]'});
 await call('waitText',{text:'Coverage could not be loaded. Retry to check staffing.'});
await new Promise(r=>setTimeout(r,1000));
 const failed=await call('state',{},'coverage-live-failed-03');assert.ok(failed.text.includes('Retry'));assert.ok(failed.text.includes('Shift Schedule'));assert.ok(failed.text.includes('Publish (1)'));
 await call('evaluate',{code:"document.querySelectorAll('button').forEach(b=>{if(b.textContent.trim()==='Publish (1)')b.focus()}); true"});
 const tooltip=await call('evaluate',{code:"document.querySelector('[data-slot=tooltip-content]')?.textContent ?? null"},'coverage-live-failed-publish-03');
 results.failure={visibleAlert:true,localRetry:true,publishStillEnabled:failed.buttons.find(b=>b.text==='Publish (1)')?.disabled===false,tooltip};
 await call('capture',{name:'current-coverage-unavailable-1600-03.png'},'coverage-live-failed-geometry-03');
 await call('failure',{name:'getTargetHeatmapData',mode:'hold'});
 await call('click',{text:'Retry'});
 const pending=await call('state',{},'coverage-live-retry-pending-03');
 results.pending={held:(await call('actions')).held,text:pending.text.includes('Loading coverage')||pending.text.includes('Refreshing coverage'),retryDisabled:pending.buttons.filter(b=>b.text==='Retry').every(b=>b.disabled)};
 assert.ok(results.pending.held===1);assert.ok(results.pending.text||results.pending.retryDisabled);
 await call('failure',{name:'getTargetHeatmapData',mode:'clear'});
 await call('waitText',{text:'Loading coverage',present:false});await call('waitText',{text:'Coverage could not be loaded',present:false});
 results.recovered={clearAlert:!(await call('state')).text.includes('Coverage could not be loaded')};
}finally{await call('failure',{name:'getTargetHeatmapData',mode:'clear'});}
await call('failure',{name:'getShiftTemplates',mode:'abort'});
try{
 await call('selector',{selector:'button[aria-label="Refresh data"]'});
 await call('waitText',{text:'Templates or compliance information could not be refreshed.'});
 const failed=await call('state',{},'supporting-live-failed-03');assert.ok(failed.text.includes('Independent morning'));
 await call('failure',{name:'getShiftTemplates',mode:'hold'});await call('failure',{name:'getScheduleComplianceSummary',mode:'hold'});
 await call('click',{text:'Retry'});
 const pending=await call('state',{},'supporting-live-pending-03');assert.ok(pending.buttons.some(b=>b.text==='Retry'&&b.disabled));
 results.supporting={retainedTemplate:true,pendingRetryDisabled:true,held:(await call('actions')).held};
 await call('failure',{name:'getShiftTemplates',mode:'clear'});await call('failure',{name:'getScheduleComplianceSummary',mode:'clear'});
 await call('waitText',{text:'Templates or compliance information could not be refreshed.',present:false});
}finally{await call('failure',{name:'getShiftTemplates',mode:'clear'});await call('failure',{name:'getScheduleComplianceSummary',mode:'clear'});}
const after=(await call('actions',{},'read-recovery-action-counts-03')).observations.slice(before);const writes=after.filter(o=>['publishShifts','upsertShift','deleteShift'].includes(o.name));assert.equal(writes.length,0);
await writeFile(join(dir,'runtime-read-recovery-result-03.json'),JSON.stringify({verdict:'PASS',...results,actualNextActionTransport:true,queryDataFabricated:false,zeroSchedulingWrites:true,readCalls:after.length,counts:Object.fromEntries([...new Set(after.map(o=>o.name))].map(n=>[n,after.filter(o=>o.name===n).length])),automaticRetries:'included separately from explicit local Retry in action observations',fixture:'fresh canonical own small-admin; normal public development login; notifications denied'},null,2),{flag:'wx'});
console.log('Actual coverage/supporting read failure, pending local recovery and zero scheduling writes passed.');
