import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {repo,dir,pool,runtime,fixture} from './fixture.mjs';
const {S3Client,PutObjectCommand}=createRequire(join(repo,'apps/webapp/package.json'))('@aws-sdk/client-s3');
const s3=new S3Client({endpoint:runtime.env.S3_PUBLIC_ENDPOINT,region:runtime.env.S3_PUBLIC_REGION,forcePathStyle:true,credentials:{accessKeyId:runtime.env.S3_PUBLIC_ACCESS_KEY_ID,secretAccessKey:runtime.env.S3_PUBLIC_SECRET_ACCESS_KEY}});
try {
 const actor=fixture.actors['small-employee'],admin=fixture.actors['small-admin'];
 const {rows:[count]}=await pool.query('select count(*)::int n from employee_document where organization_id=$1',[actor.organizationId]);
 if(count.n) throw Error('Use an untouched disposable fixture');
 await pool.query('update organization set personnel_files_enabled=true where id=$1',[actor.organizationId]);
 const ids={};
 for(const [label,category,visibility,employeeId] of [['shared','certificate','shared',actor.employeeId],['hr','certificate','hr_only',actor.employeeId],['foreign','other','shared',admin.employeeId],['payslip','payslip','shared',actor.employeeId]]){
  const id=randomUUID(),bytes=Buffer.from('%PDF-1.4\nSynthetic '+label+'\n%%EOF'),key=`personnel-files/${actor.organizationId}/${employeeId}/${id}-${label}.pdf`;
  await s3.send(new PutObjectCommand({Bucket:runtime.env.S3_PUBLIC_BUCKET,Key:key,Body:bytes,ContentType:'application/pdf'}));
  await pool.query(`insert into employee_document(id,organization_id,employee_id,category,title,document_date,visibility,storage_provider,storage_bucket,storage_key,file_name,mime_type,size_bytes,checksum_sha256,pay_period_year,pay_period_month) values($1,$2,$3,$4,$5,'2026-11-01',$6,'s3-private',$7,$8,$9,'application/pdf',$10,$11,$12,$13)`,[id,actor.organizationId,employeeId,category,label==='hr'?'HR confidential only':label==='foreign'?'Foreign employee record':label==='payslip'?'October payslip':'First aid certificate',visibility,runtime.env.S3_PUBLIC_BUCKET,key,label+'.pdf',bytes.length,createHash('sha256').update(bytes).digest('hex'),category==='payslip'?2026:null,category==='payslip'?10:null]);
  ids[label]=id;
 }
 for(const [title,deadline,status] of [['Later certificate','2026-12-30','open'],['Overdue renewal','2026-11-01','open'],['Completed request','2026-10-01','accepted']]){
  const id=randomUUID();await pool.query(`insert into employee_document_request(id,organization_id,employee_id,category,title,note,deadline,status,created_by,renewed_document_id) values($1,$2,$3,'certificate',$4,'Synthetic request: upload your current certificate.',$5,$6,$7,$8)`,[id,actor.organizationId,actor.employeeId,title,deadline,status,admin.userId,title==='Overdue renewal'?ids.hr:null]);ids[title]=id;
 }
 await writeFile(join(dir,'1720-private.json'),JSON.stringify(ids));
 console.log('Seeded shared/private/foreign documents and three requests in the owned fixture.');
} finally {s3.destroy();await pool.end();}
