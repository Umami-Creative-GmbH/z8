// Fixture-only faults and independent persisted readback; never production config.
import {writeFile,readFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {repo,dir,runtime,fixture,pool} from './fixture.mjs';
const command=process.argv[3],a=fixture.actors['small-admin'];
try{
 if(command==='outage')await pool.query('alter table equipment_command rename to equipment_command_r020_outage');
 else if(command==='restore')await pool.query('alter table equipment_command_r020_outage rename to equipment_command');
 else if(command==='outage-read')await pool.query('alter table equipment_assignment rename to equipment_assignment_r020_outage');
 else if(command==='restore-read')await pool.query('alter table equipment_assignment_r020_outage rename to equipment_assignment');
 else if(command==='revoke')await pool.query("update member set role='member' where user_id=(select user_id from employee where id=$1 and organization_id=$2) and organization_id=$2",[a.employeeId,a.organizationId]);
 else if(command==='grant')await pool.query("update member set role='admin' where user_id=(select user_id from employee where id=$1 and organization_id=$2) and organization_id=$2",[a.employeeId,a.organizationId]);
 else if(command==='stale')await pool.query('update equipment_assignment set revision=revision+1 where organization_id=$1 and employee_id=$2 and item_id is null',[a.organizationId,fixture.actors['small-employee'].employeeId]);
 else if(command==='readback'){
  const {rows}=await pool.query(`select t.name as type,i.identifier,a.quantity,a.received_quantity,a.lost_quantity,a.waived_quantity,a.revision,i.status,i.in_custody,
   (select count(*)::int from equipment_handover h where h.assignment_id=a.id) as handovers,
   (select count(*)::int from equipment_correction c where c.assignment_id=a.id) as amendments,
   (select count(*)::int from equipment_case_hold_event c where c.assignment_id=a.id and c.kind='place') as holds_placed,
   (select count(*)::int from equipment_case_hold_event c where c.assignment_id=a.id and c.kind='release') as holds_released
   from equipment_assignment a join equipment_type t on t.id=a.type_id left join equipment_item i on i.id=a.item_id where a.organization_id=$1 order by t.name`,[a.organizationId]);
  console.log(JSON.stringify(rows,null,2));
 }else if(command==='hold-command'||command==='hold-read'){
  await unlink(join(dir,'lock-release')).catch(error=>{if(error.code!=='ENOENT')throw error;});
  const locked=await pool.connect();
  await locked.query('begin');await locked.query(command==='hold-command'?'lock table equipment_command in access exclusive mode':'lock table equipment_assignment in access exclusive mode');
  await writeFile(join(dir,'lock-ready'),'ready','utf8');console.log('Owned fixture lock acquired');
  let released=false;for(let i=0;i<1200;i++){try{await readFile(join(dir,'lock-release'),'utf8');released=true;break;}catch{}await new Promise(done=>setTimeout(done,100));}
  await locked.query('rollback');locked.release();if(!released)throw Error('Fixture lock timed out; released automatically');
 }else if(command==='second-org'){
  const {rows:[e]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[a.employeeId,a.organizationId]);
  await pool.query("insert into member(id,user_id,organization_id,role,created_at) values(gen_random_uuid(),$1,$2,'admin',now()) on conflict do nothing",[e.user_id,fixture.actors['large-admin'].organizationId]);
 }else throw Error('Unknown fixture command');
}finally{await pool.end();}
