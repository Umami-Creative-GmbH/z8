// Guarded, synthetic setup only. Never use against customer/provider databases.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const repo=process.cwd(), dir=resolve(process.argv[2]);
const runtime=JSON.parse(await readFile(join(dir,'runtime-private.json'),'utf8'));
const fixture=JSON.parse(await readFile(join(dir,'fixture-private.json'),'utf8'));
const services=JSON.parse(await readFile(join(dir,'services.json'),'utf8'));
if(fixture.kind!=='disposable'||runtime.env.POSTGRES_HOST!=='127.0.0.1'||!/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/.test(runtime.env.POSTGRES_DB))throw Error('Disposable fixture required');
for(const c of services.containers)if(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim()!==services.label)throw Error('Ownership mismatch');
const require=createRequire(join(repo,'apps/webapp/package.json')), {Pool}=require('pg');
const pool=new Pool({host:runtime.env.POSTGRES_HOST,port:Number(runtime.env.POSTGRES_PORT),database:runtime.env.POSTGRES_DB,user:runtime.env.POSTGRES_USER,password:runtime.env.POSTGRES_PASSWORD});
try{
const a=fixture.actors['small-admin'], e=fixture.actors['small-employee'], m=fixture.actors['small-manager'];
const user=async actor=>(await pool.query('select user_id from employee where id=$1 and organization_id=$2',[actor.employeeId,actor.organizationId])).rows[0].user_id;
const au=await user(a), mu=await user(m), eu=await user(e);
if((await pool.query('select 1 from driving_licence_policy where organization_id=$1',[a.organizationId])).rowCount)throw Error('Use fresh fixture');
await pool.query("insert into driving_licence_policy (organization_id,enabled,interval_months,timezone,reminder_lead_days,retention_months,retention_justification,updated_at,updated_by) values ($1,true,6,'Europe/Berlin','[30,7]',12,'Synthetic fixture retention only',now(),$2)",[a.organizationId,au]);
await pool.query("insert into driving_licence_verifier_grant (organization_id,verifier_employee_id,scope,granted_by) values ($1,$2,'all',$3)",[a.organizationId,a.employeeId,au]);
for(const actor of [a,e])await pool.query("insert into driving_licence_intended_driver_assignment (organization_id,assignment_type,employee_id,priority,required,created_by,updated_by) values ($1,'employee',$2,2,true,$3,$3)",[a.organizationId,actor.employeeId,au]);
const {rows:[ended]}=await pool.query('select id from employee where organization_id=$1 and id<>all($2::uuid[]) limit 1',[a.organizationId,[a.employeeId,e.employeeId,m.employeeId,fixture.actors['small-restricted'].employeeId]]);
for(const [actor,verifier,vu,endedRecord] of [[a,m,mu,false],[e,a,au,false],[{employeeId:ended.id},a,au,true]]){
const classes=[{code:'B',result:'successful',expiryDate:null,restrictions:'Corrective lenses'}];
const {rows:[period]}=await pool.query('select id from employee_employment_period where organization_id=$1 and employee_id=$2 and ended_at is null',[a.organizationId,actor.employeeId]);
const {rows:[check]}=await pool.query("insert into driving_licence_check (organization_id,employee_id,verifier_employee_id,verifier_user_id,employee_name,verifier_name,controlled_at,command_id,policy_version,interval_months,deadline_timezone,document_issued_on,document_expires_on,original_inspected,identity_confirmed,employee_declaration,declaration_text,verifier_confirmed,classes,failure_scope) values ($1,$2,$3,$4,'Synthetic Driver','Synthetic Verifier',now(),gen_random_uuid(),1,6,'Europe/Berlin','2020-01-01','2035-01-01',true,true,true,'No known impediment; restrictions met',true,$5,'classes') returning id",[a.organizationId,actor.employeeId,verifier.employeeId,vu,JSON.stringify(classes)]);
await pool.query("insert into driving_authorization (organization_id,employee_id,employment_period_id,class_code,supporting_check_id,last_successful_at,routine_valid_through,document_valid_through,valid_through,deadline_timezone,expires_at,restrictions,state) values ($1,$2,$5,'B',$3,now(),'2027-05-15','2035-01-01','2027-05-15','Europe/Berlin','2027-05-15T22:00:00Z','Corrective lenses',$4)",[a.organizationId,actor.employeeId,check.id,endedRecord?'ended':'active',period?.id??null]);
}
await pool.query("insert into driving_licence_reminder_delivery (organization_id,employee_id,occasion_key,recipient_user_id,email_state,email_attempts,created_at) values ($1,$2,'synthetic-uncertain',$3,'attempted',1,now())",[a.organizationId,e.employeeId,eu]);
await pool.query('update driving_licence_verifier_grant d set employment_period_id=p.id from employee_employment_period p where d.organization_id=$1 and p.organization_id=d.organization_id and p.employee_id=d.verifier_employee_id and p.ended_at is null',[a.organizationId]);
const {rows:[role]}=await pool.query("insert into custom_role (organization_id,name,created_by,updated_at) values ($1,'Synthetic driving planner',$2,now()) returning id",[a.organizationId,au]);
await pool.query("insert into custom_role_permission (custom_role_id,action,subject) values ($1,'read','DrivingAuthorization')",[role.id]);
for(const actor of [a,m])await pool.query('insert into employee_custom_role (employee_id,custom_role_id,assigned_by) values ($1,$2,$3)',[actor.employeeId,role.id,au]);
console.log('Seeded scoped synthetic licence policy, explicit verifier grant, two intended drivers, retained ended evidence and uncertain reminder.');
}finally{await pool.end();}
