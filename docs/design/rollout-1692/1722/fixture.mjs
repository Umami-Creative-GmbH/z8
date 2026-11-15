// Only this ticket's generated disposable fixture. Never accepts application env.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const dir=resolve(process.argv[2]),mode=process.argv[3]??'prepare';
const read=async n=>JSON.parse(await readFile(join(dir,n),'utf8'));
const r=await read('runtime-private.json'),f=await read('fixture-private.json'),s=await read('services.json'),seed=await read('r030-private.json');
assert.equal(f.kind,'disposable'); assert.equal(r.env.POSTGRES_HOST,'127.0.0.1'); assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of s.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),s.label);
const require=createRequire(resolve('apps/webapp/package.json')), {Client}=require('pg');
const db=new Client({connectionString:r.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});await db.connect();
const a=f.actors['small-employee'],org=a.organizationId;
try{
 if(mode==='prepare'){
  const user=(await db.query('select user_id from employee where id=$1 and organization_id=$2',[a.employeeId,org])).rows[0].user_id;
  await db.query("update absence_entry set status='rejected',rejection_reason='R030 coverage needed: choose another day',approved_at=now() where id=$1 and organization_id=$2",[seed.ids[0].absenceId,org]);
  await db.query("update approval_request set status='rejected',rejection_reason='R030 coverage needed' where id=$1 and organization_id=$2",[seed.ids[0].requestId,org]);
  const expense=(await db.query("insert into travel_expense_claim(organization_id,employee_id,type,status,trip_start,trip_end,original_currency,original_amount,calculated_currency,calculated_amount,submitted_at,decided_at,created_by,updated_at,destination_city) values($1,$2,'receipt','rejected','2026-11-01','2026-11-01','EUR',42.50,'EUR',42.50,now(),now(),$3,now(),'R030 Berlin') returning id",[org,a.employeeId,user])).rows[0].id;
  const other=f.actors['large-admin'].organizationId;
  await db.query("insert into member(id,organization_id,user_id,role,status,created_at) values(gen_random_uuid(),$1,$2,'member','approved',now()) on conflict do nothing",[other,user]);
  await writeFile(join(dir,'r030-extra-private.json'),JSON.stringify({expense,other,user}));
  console.log('Prepared one rejected absence, one pending absence, one pending correction and one rejected legacy expense; scoped second membership.');
 }else if(mode==='fault')await db.query('alter table travel_expense_claim rename to r030_held_travel_expense_claim');
 else if(mode==='recover')await db.query('alter table r030_held_travel_expense_claim rename to travel_expense_claim');
 else if(mode==='readback'){
  const absent=(await db.query('select status from absence_entry where id=$1 and organization_id=$2',[seed.ids[1].absenceId,org])).rows;
  const correction=(await db.query('select status from approval_request where id=$1 and organization_id=$2',[seed.correction,org])).rows;
  console.log(JSON.stringify({absence:absent,correction}));
 }else throw Error('Unknown fixture operation');
}finally{await db.end();}
