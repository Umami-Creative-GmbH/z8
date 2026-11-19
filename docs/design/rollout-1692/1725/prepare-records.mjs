import {fixture,pool} from '../1719/fixture.mjs';
try{
 const a=fixture.actors['small-admin'];const {rows:[owner]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[a.employeeId,a.organizationId]);
 await pool.query("update employee set employee_number='R042-'||left(id::text,8) where organization_id=$1",[a.organizationId]);
 for(const table of ['work_category','absence_category']){
  const column=table==='work_category'?'work_category_id':'absence_category_id';
  await pool.query(`insert into payroll_wage_type_mapping(organization_id,${column},datev_wage_type_code,created_by,updated_at) select organization_id,id,$2,$3,now() from ${table} where organization_id=$1`,[a.organizationId,table==='work_category'?'1000':'2000',owner.user_id]);
 }
 console.log('Assigned synthetic personnel identifiers and file wage codes for real fixture work/absence rows.');
}finally{await pool.end();}
