// Guarded synthetic setup only. Does not replace application readers or decisions.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const dir=resolve(process.argv[2]);const load=async n=>JSON.parse(await readFile(join(dir,n),'utf8'));
const runtime=await load('runtime-private.json'),fixture=await load('fixture-private.json'),services=await load('services.json');
assert.equal(fixture.kind,'disposable');assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const name of services.containers) assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',name],{encoding:'utf8'}).trim(),services.label);
const require=createRequire(resolve('apps/webapp/package.json'));const {Client}=require('pg');
const db=new Client({connectionString:runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});await db.connect();
try{
 const employee=fixture.actors['small-employee'],manager=fixture.actors['small-manager'],admin=fixture.actors['small-admin'],org=employee.organizationId;
 assert.equal(manager.organizationId,org);
 await db.query('begin');
 await db.query('insert into employee_managers (employee_id,manager_id,is_primary,assigned_by) select $1,$2,true,user_id from employee where id=$3 and organization_id=$4 on conflict do nothing',[employee.employeeId,manager.employeeId,admin.employeeId,org]);
 const category=(await db.query("insert into absence_category(organization_id,type,name,counts_against_vacation,requires_approval,color,updated_at) values ($1,'custom','R009 review leave',false,true,'#2563eb',now()) returning id",[org])).rows[0].id;
 const ids=[];
 for(let n=1;n<=12;n++) {
  const day=`2026-12-${String(n+1).padStart(2,'0')}`;
  const a=(await db.query("insert into absence_entry(employee_id,organization_id,category_id,start_date,end_date,start_period,end_period,status,notes,updated_at) values($1,$2,$3,$4,$4,$5,$5,'pending',$6,now()) returning id",[employee.employeeId,org,category,day,n===1?'am':'full_day',`R009 request ${n}: review the complete evidence, including coverage and the requested leave dates. This note must stay readable on a phone.`])).rows[0].id;
  const request=(await db.query("insert into approval_request(organization_id,entity_type,entity_id,requested_by,approver_id,status,updated_at) values($1,'absence_entry',$2,$3,$4,'pending',now()) returning id",[org,a,employee.employeeId,manager.employeeId])).rows[0].id;ids.push({absenceId:a,requestId:request});
 }
 // Existing synthetic period; metadata-only correction retains captured endpoint evidence.
 const period=(await db.query('select id from work_period where organization_id=$1 and employee_id=$2 order by start_time limit 1',[org,employee.employeeId])).rows[0];
 assert.ok(period);
 const correction=(await db.query("insert into approval_request(organization_id,entity_type,entity_id,requested_by,approver_id,status,reason,metadata,updated_at) values($1,'time_entry',$2,$3,$4,'pending',$5,$6::jsonb,now()) returning id",[org,period.id,employee.employeeId,manager.employeeId,'R009 correction reason: customer visit ended at home; retain this full request evidence for the manager.',JSON.stringify({timeCorrection:{action:'edit',workLocationType:'home',workCategoryId:null},timeCorrectionOriginalWorkMetadata:{workLocationType:'office',workCategoryId:null}})])).rows[0].id;
 await db.query('commit');
 await writeFile(join(dir,'r009-private.json'),JSON.stringify({organizationId:org,ids,correction,periodId:period.id}));
 console.log('Prepared 12 synthetic pending absences and one metadata correction in the assigned manager scope.');
}catch(e){await db.query('rollback');throw e;}finally{await db.end();}
