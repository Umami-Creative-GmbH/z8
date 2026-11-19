// Synthetic records only; the imported guard verifies all three owned containers.
import {pool,fixture} from '../1719/fixture.mjs';
try {
 const a=fixture.actors['small-admin'],m=fixture.actors['small-manager'];
 const {rows:[owner]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[a.employeeId,a.organizationId]);a.userId=owner.user_id;
 for(const actor of [a,m]) await pool.query("insert into payroll_access_grant(organization_id,payroll_employee_id,scope,created_by,updated_at) values($1,$2,'all',$3,now())",[actor.organizationId,actor.employeeId,a.userId]);
 await pool.query("insert into payroll_export_format(id,name,version,updated_at) values('datev_lohn','DATEV Lohn & Gehalt','2024.1',now()) on conflict(id) do nothing");
 await pool.query("insert into payroll_export_config(organization_id,format_id,config,created_by,updated_at) values($1,'datev_lohn',$2::jsonb,$3,now())",[a.organizationId,JSON.stringify({mandantennummer:'12345',beraternummer:'1234567',personnelNumberType:'employeeNumber',includeZeroHours:false}),a.userId]);
 console.log('Seeded synthetic payroll grants and DATEV file configuration; no provider credentials.');
} finally {await pool.end();}
