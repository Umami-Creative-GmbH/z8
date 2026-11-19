import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {dir,fixture,pool} from './fixture.mjs';
try {
 const holder=fixture.actors['small-employee'],target=fixture.actors['small-manager'];
 const {rows:[user]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[holder.employeeId,holder.organizationId]);
 const grant=randomUUID();
 await pool.query("insert into payroll_access_grant(id,organization_id,payroll_employee_id,scope,created_by,updated_at) values($1,$2,$3,'specific',$4,now())",[grant,holder.organizationId,holder.employeeId,user.user_id]);
 await pool.query('insert into payroll_access_employee(organization_id,grant_id,employee_id,created_by) values($1,$2,$3,$4)',[holder.organizationId,grant,target.employeeId,user.user_id]);
 await pool.query('update employee set is_active=false where id=$1 and organization_id=$2',[target.employeeId,holder.organizationId]);
 await writeFile(join(dir,'r044-scope.json'),JSON.stringify({holder,target,grant,userId:user.user_id,uncovered:fixture.actors['small-restricted'].employeeId,foreign:fixture.actors['large-employee'].employeeId}));
 console.log('Created synthetic current-member specific payroll grant covering former target only. No personnel/expense grant added.');
} finally {await pool.end();}
