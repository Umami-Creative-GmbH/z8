import {r,f,req,save,directory} from './common.mjs';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const db=new(req('pg').Client)({connectionString:r.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});await db.connect();
try{
 const admin=f.actors['small-admin'],target=f.actors['small-employee'];
 const actors=Object.values(f.actors).map(x=>x.employeeId);
 const {rows:[former]}=await db.query('select id,user_id from employee where organization_id=$1 and not(id=any($2::uuid[])) order by id limit 1',[admin.organizationId,actors]);
 if(!former)throw Error('No independent synthetic employee');
 const {rows:[owner]}=await db.query('select user_id from employee where id=$1 and organization_id=$2',[admin.employeeId,admin.organizationId]);
 await db.query('update organization set timezone=$2 where id=$1',[admin.organizationId,'Pacific/Kiritimati']);
 await db.query('update employee set employee_number=$3 where id=$1 and organization_id=$2',[target.employeeId,admin.organizationId,'R047-002']);
 await db.query('update employee set is_active=false where id=$1 and organization_id=$2',[former.id,admin.organizationId]);
 const requests=[];
 for(let i=0;i<28;i++){
  const id=randomUUID(),status=['open','submitted','accepted','cancelled'][i%4],title='R047 record '+String(i+1).padStart(2,'0'),employee=i===27?former.id:target.employeeId;
  await db.query(`insert into employee_document_request(id,organization_id,employee_id,category,title,note,deadline,status,created_by) values($1,$2,$3,$4,$5,$6,'2026-11-01',$7,$8)`,[id,admin.organizationId,employee,i%2?'other':'certificate',title,'Please supply a current document. Uploaded documents stay in the file after return or cancellation.',status,owner.user_id]);
  await db.query(`insert into employee_document_request_event(organization_id,request_id,kind,actor_user_id,occurred_at) values($1,$2,'created',$3,now())`,[admin.organizationId,id,owner.user_id]);
  if(i===0)await db.query(`insert into employee_document_request_event(organization_id,request_id,kind,actor_user_id,reason,occurred_at) values($1,$2,'returned',$3,'Synthetic prior return: clearer certificate required.',now())`,[admin.organizationId,id,owner.user_id]);
  requests.push({id,status,title});
 }
 await writeFile(join(directory,'queue-seed-private.json'),JSON.stringify({requests,former:former.id}));
 await save('seed.json',{requests:28,statuses:['open','submitted','accepted','cancelled'],formerHistoryRecords:1,priorReturnContext:1,qualification:'Initial synthetic domain prerequisites only; no public creation, upload, offboarding, auth, membership, or grant mutation proof.'});
 console.log('Seeded 28 domain-only request prerequisites and one former-file context.');
}finally{await db.end();}
