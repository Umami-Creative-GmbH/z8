// pnpm node docs/design/rollout-1692/1708/prepare-history.mjs <private-fixture>
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
const dir=resolve(process.argv[2]);
const read=async file=>JSON.parse(await readFile(join(dir,file),'utf8'));
const r=await read('runtime-private.json'),f=await read('fixture-private.json'),s=await read('services.json');
assert.equal(f.kind,'disposable');assert.equal(r.env.POSTGRES_HOST,'127.0.0.1');
assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
assert.equal(s.label,'z8-performance-fixture-1450');
for(const c of s.containers){assert.match(c,/^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/);assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8'}).trim(),s.label);}
const require=createRequire(resolve('apps/webapp/package.json')), {Pool}=require('pg');
const pool=new Pool({host:r.env.POSTGRES_HOST,port:Number(r.env.POSTGRES_PORT),database:r.env.POSTGRES_DB,user:r.env.POSTGRES_USER,password:r.env.POSTGRES_PASSWORD});
try{
 const actor=f.actors['small-employee'],deputy=f.actors['small-manager'],other=f.actors['small-admin'],org=actor.organizationId;
 const own=(await pool.query('select id,user_id from employee where id=$1 and organization_id=$2',[actor.employeeId,org])).rows[0];assert.ok(own);
 const category=(await pool.query("insert into absence_category(organization_id,type,name,requires_work_time,counts_against_vacation,updated_at) values($1,'vacation','R010 history fixture',false,false,now()) returning id",[org])).rows[0].id;
 const ids={history:randomUUID(),empty:randomUUID(),cancelled:randomUUID(),undated:randomUUID(),deputy:deputy.employeeId,other:other.employeeId};
 for(const id of [ids.history,ids.empty,ids.cancelled])await pool.query("insert into absence_entry(id,employee_id,organization_id,category_id,start_date,end_date,status,updated_at) values($1,$2,$3,$4,'2026-11-09','2026-11-13','approved',now())",[id,actor.employeeId,org,category]);
 for(const [index,id] of [ids.history,ids.history,ids.history,ids.cancelled,ids.undated].entries()){
  const requestId=randomUUID(),requester=index===2?null:other.employeeId;
  if(requester)await pool.query("insert into approval_request(id,organization_id,entity_type,entity_id,requested_by,approver_id,status,updated_at) values($1,$2,'absence_entry',$3,$4,$5,'approved',now())",[requestId,org,randomUUID(),requester,actor.employeeId]);
  await pool.query("insert into approval_deputy_decision(organization_id,deputy_employee_id,acting_for_employee_id,absence_id,absence_start_date,absence_end_date,authority,entity_type,entity_id,approval_request_id,decision,decided_at) values($1,$2,$3,$4,$5,$6,'legacy',$7,$8,$9,$10,$11)",[org,index===1?other.employeeId:deputy.employeeId,actor.employeeId,id,id===ids.undated?null:'2026-11-09',id===ids.undated?null:'2026-11-13',index===2?'historical_unknown_kind':'absence_entry',randomUUID(),requestId,index===1?'rejected':'approved',`2026-11-10T${14+index}:07:00Z`]);
 }
 await pool.query('delete from absence_entry where organization_id=$1 and id=$2',[org,ids.cancelled]);
 await writeFile(join(dir,'history-private.json'),JSON.stringify(ids,null,2),{mode:0o600});
 console.log('Prepared three decision records, genuine empty absence, cancelled history and old undated history in the owned disposable fixture.');
}finally{await pool.end();}
