import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool,fixture} from './fixture.mjs';
const holder=fixture.actors['small-employee'],admin=fixture.actors['small-admin'];
try {
 await pool.query("delete from equipment_assignment where organization_id=$1 and type_id in (select id from equipment_type where organization_id=$1 and name like 'R029 %')",[holder.organizationId]);
 await pool.query("delete from equipment_type where organization_id=$1 and name like 'R029 %'",[holder.organizationId]);
 const {rows:[actor]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[admin.employeeId,admin.organizationId]);
 for(const [name,keep,received,lost,waived,recovered] of [
  ['R029 Personal gloves',true,0,0,0,0],['R029 Received kit',false,3,0,0,0],
  ['R029 Lost kit',false,0,3,0,0],['R029 Waived kit',false,0,0,3,0],
  ['R029 Recovered kit',false,1,3,0,1],
 ]) {
  const type=randomUUID(),assignment=randomUUID();
  await pool.query('insert into equipment_type(id,organization_id,name,tracking_mode,default_return_required) values($1,$2,$3,\'quantity\',$4)',[type,holder.organizationId,name,!keep]);
  await pool.query('insert into equipment_assignment(id,organization_id,type_id,employee_id,quantity,received_quantity,lost_quantity,waived_quantity,exception_received_quantity,return_required,received) values($1,$2,$3,$4,3,$5,$6,$7,$8,$9,$10)',[assignment,holder.organizationId,type,holder.employeeId,received,lost,waived,recovered,!keep,received===3]);
  const issue=randomUUID();
  await pool.query("insert into equipment_handover(id,organization_id,assignment_id,kind,quantity,actual_date,condition,notes,actor_id,recorded_at) values($1,$2,$3,'issue',3,'2026-10-01','good','R029 original handover',$4,'2026-10-01T10:00:00Z')",[issue,holder.organizationId,assignment,actor.user_id]);
  let exception=null;
  if(lost||waived){exception=randomUUID();await pool.query("insert into equipment_exception(id,organization_id,assignment_id,kind,quantity,received_quantity,reason,actor_id,recorded_at) values($1,$2,$3,$4,3,$5,'R029 reasoned decision',$6,'2026-10-02T10:00:00Z')",[exception,holder.organizationId,assignment,lost?'lost':'waived',recovered,actor.user_id]);}
  if(received)await pool.query("insert into equipment_handover(organization_id,assignment_id,kind,quantity,actual_date,condition,notes,actor_id,exception_id,recorded_at) values($1,$2,'receipt',$3,'2026-10-03','worn','R029 physical evidence',$4,$5,'2026-10-03T10:00:00Z')",[holder.organizationId,assignment,received,actor.user_id,exception]);
  if(keep){
   const before={quantity:3,actualDate:'2026-10-01',condition:'good',notes:'R029 original handover'},after={...before,condition:'worn',notes:'R029 effective handover'};
   await pool.query('update equipment_handover set effective=$2 where id=$1',[issue,after]);
   await pool.query("insert into equipment_correction(organization_id,assignment_id,handover_id,expected_revision,reason,actor_id,before,after,recorded_at) values($1,$2,$3,1,'R029 signed amendment',$4,$5,$6,'2026-10-04T10:00:00Z')",[holder.organizationId,assignment,issue,actor.user_id,before,after]);
  }
 }
 const {rows}=await pool.query('select count(*)::int as n from equipment_assignment where employee_id=$1 and organization_id=$2',[holder.employeeId,holder.organizationId]);assert.equal(rows[0].n,7);
 console.log('Seeded seven own assignments: partial, held, keep/amended, received, lost, waived, recovered.');
}finally{await pool.end();}
