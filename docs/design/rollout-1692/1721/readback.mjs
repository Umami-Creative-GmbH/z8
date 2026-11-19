import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {repo,pool,fixture} from './fixture.mjs';
const a=fixture.actors['small-employee'];
try{
 const {rows}=await pool.query(`select coalesce(i.identifier,t.name) as item,a.quantity,a.received_quantity,a.lost_quantity,a.waived_quantity,a.exception_received_quantity,a.return_required,
 (select count(*)::int from equipment_handover h where h.assignment_id=a.id and h.organization_id=a.organization_id) as handovers,
 (select count(*)::int from equipment_correction c where c.assignment_id=a.id and c.organization_id=a.organization_id) as amendments
 from equipment_assignment a join equipment_type t on t.id=a.type_id and t.organization_id=a.organization_id left join equipment_item i on i.id=a.item_id and i.organization_id=a.organization_id where a.employee_id=$1 and a.organization_id=$2 order by item`,[a.employeeId,a.organizationId]);
 assert.equal(rows.length,7);assert.deepEqual(rows.find(r=>r.item==='Fixture shirts'),{item:'Fixture shirts',quantity:3,received_quantity:2,lost_quantity:0,waived_quantity:0,exception_received_quantity:0,return_required:true,handovers:2,amendments:0});
 assert.equal(rows.find(r=>r.item==='R029 Personal gloves').amendments,1);
 await writeFile(join(repo,'docs/design/rollout-1692/1721/persisted-readback.json'),JSON.stringify({scope:'own employee in Performance small, organization-filtered SQL evidence; presentation still uses the public authorized reader',rows},null,2)+'\n');console.log('Verified persisted seven-record fixture evidence and partial/amendment totals.');
}finally{await pool.end();}
