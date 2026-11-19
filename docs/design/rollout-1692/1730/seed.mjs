import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pool,fixture,dir} from './fixture.mjs';
try {
 const actor=fixture.actors['small-restricted'],owner=fixture.actors['small-admin'];
 const {rows:[ownerProfile]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[owner.employeeId,owner.organizationId]);
 await pool.query('update organization set personnel_files_enabled=true, timezone=$2 where id=$1',[owner.organizationId,'Pacific/Kiritimati']);
 await pool.query('update employee set employee_number=$2 where id=$1',[actor.employeeId,'R047-002']);
 const ids=[];
 for(let i=0;i<28;i++) {
  const id=randomUUID(),status=['open','submitted','accepted','cancelled'][i%4];
  await pool.query(`insert into employee_document_request(id,organization_id,employee_id,category,title,note,deadline,status,created_by) values($1,$2,$3,$4,$5,$6,'2026-11-01',$7,$8)`,[id,owner.organizationId,actor.employeeId,i%2?'other':'certificate','R047 record '+String(i+1).padStart(2,'0'),'Please supply a current document. Uploaded documents stay in the file after a return or cancellation.',status,ownerProfile.user_id]);
  ids.push({id,status});
 }
 await writeFile(join(dir,'1730-private.json'),JSON.stringify({requests:ids,employeeId:actor.employeeId}));
 console.log('Seeded 28 synthetic request records; these are fixture prerequisites, not public-action outcomes.');
} finally {await pool.end();}
