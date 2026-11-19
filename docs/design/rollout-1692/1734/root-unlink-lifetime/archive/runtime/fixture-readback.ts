import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {integrationAdminPool,verifySuiteDatabase,closeIntegrationPools} from '@/test/integration-database';
async function main(){
 const phase=process.argv[2];if(!/^[a-z0-9-]+$/.test(phase??''))throw Error('Phase required');
 await verifySuiteDatabase();const directory=resolve('../../.tmp/1734-independent-checks/runtime');
 const seed=JSON.parse(await readFile(resolve(directory,'r051-private.json'),'utf8'));const pool=integrationAdminPool();
 try{
  const {rows:absences}=await pool.query('select * from absence_entry where organization_id=$1 and id=any($2::uuid[]) order by id',[seed.organizationId,seed.absences.map((a:{id:string})=>a.id)]);
  const {rows:history}=await pool.query('select * from absence_change_request where organization_id=$1 order by id',[seed.organizationId]);
  const {rows:documents}=await pool.query("select id,employee_id,category,title,visibility,absence_entry_id,mime_type,size_bytes,checksum_sha256 from employee_document where organization_id=$1 and title='Synthetic independent linked note' order by id",[seed.organizationId]);
  const {rows:[refused]}=await pool.query("select count(*)::int as count from employee_document where organization_id=$1 and title='Synthetic revoked draft'",[seed.organizationId]);
  const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const result={phase,absences:absences.length,absenceRecordsSha256:sha(absences),historyRows:history.length,historySha256:sha(history),refusedDraftPersistedDocuments:refused.count,documents:documents.map(d=>({id:d.id,expectedEmployee:d.employee_id===seed.target,category:d.category,title:d.title,visibility:d.visibility,linkedAbsenceId:d.absence_entry_id,mime:d.mime_type,bytes:d.size_bytes,sha256:d.checksum_sha256}))};
  await writeFile(resolve(directory,phase+'-readback-private.json'),JSON.stringify({absences,history,documents},null,2));await writeFile(resolve(directory,'..',phase+'-readback.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }finally{await closeIntegrationPools();}
}
main().catch(()=>{console.error('Guarded synthetic readback failed.');process.exitCode=1;});
