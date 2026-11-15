// Run once on a newly prepared owned fixture: pnpm node docs/design/rollout-1692/1714/seed-runtime.mjs <private-fixture-directory>
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const repo=process.cwd(), dir=resolve(process.argv[2]);
const runtime=JSON.parse(await readFile(join(dir,'runtime-private.json'),'utf8'));
const fixture=JSON.parse(await readFile(join(dir,'fixture-private.json'),'utf8'));
const services=JSON.parse(await readFile(join(dir,'services.json'),'utf8'));
if(fixture.kind!=='disposable'||runtime.env.POSTGRES_HOST!=='127.0.0.1'||!/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/.test(runtime.env.POSTGRES_DB))throw Error('Disposable fixture required');
for(const c of services.containers) if(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim()!==services.label)throw Error('Ownership mismatch');
const require=createRequire(join(repo,'apps/webapp/package.json'));
const {Pool}=require('pg');
const pool=new Pool({host:runtime.env.POSTGRES_HOST,port:Number(runtime.env.POSTGRES_PORT),database:runtime.env.POSTGRES_DB,user:runtime.env.POSTGRES_USER,password:runtime.env.POSTGRES_PASSWORD});
try{
 const a=fixture.actors['small-admin'];
 const {rows:[prior]}=await pool.query('select count(*)::int as total from work_policy_violation where organization_id=$1',[a.organizationId]);
 if(prior.total!==0)throw Error('Use a new fixture; synthetic compliance findings already exist.');
 const {rows:[e]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[a.employeeId,a.organizationId]);
 await pool.query("insert into work_policy_violation (employee_id,organization_id,violation_date,violation_type,details) values ($1,$2,now(),'rest_period',$3)",[a.employeeId,a.organizationId,JSON.stringify({actualMinutes:480,limitMinutes:660})]);
 await pool.query("insert into audit_log (organization_id,entity_type,entity_id,action,performed_by) values ($1,'employee',$2,'permission.revoked',$3)",[a.organizationId,a.employeeId,e.user_id]);
 console.log('Stored one synthetic rest-period finding and one sensitive audit event in the small organization only.');
}finally{await pool.end();}
