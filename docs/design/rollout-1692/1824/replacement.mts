// A second owned device for the final comparison after the first was genuinely revoked.
import { readFile,writeFile } from 'node:fs/promises';
import {join} from 'node:path';
import {AuditTrail} from '@/lib/audit-trail';
import {createKiosk,updateKiosk} from '@/lib/time-tracking/kiosk/kiosk-store';
import {verifySuiteDatabase,integrationAdminPool,integrationDbModule,closeIntegrationPools} from '@/test/integration-database';
const dir=process.argv[2];await verifySuiteDatabase();const seed=JSON.parse(await readFile(join(dir,'kiosk-private.json'),'utf8')),fixture=JSON.parse(await readFile(join(dir,'fixture-private.json'),'utf8'));
if(fixture.kind!=='disposable'||seed.organizationId!==fixture.actors['small-admin'].organizationId)throw Error('Owned fixture required');
const pool=integrationAdminPool(),{db}=await integrationDbModule();
try{
 const {rows:[actor]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[fixture.actors['small-admin'].employeeId,seed.organizationId]);
 const input={organizationId:seed.organizationId,actorUserId:actor.user_id};
 const created=await db.transaction(async tx=>{const audit=new AuditTrail();const issued=await createKiosk(tx,audit,{...input,name:'R025 comparison kiosk',locationId:seed.locationId,timezone:'Europe/Berlin'});await updateKiosk(tx,audit,{...input,kioskId:issued.kioskId,change:{offlineModeEnabled:true,badgeScannerEnabled:true,badgeCameraEnabled:true,nfcFobReaderEnabled:true}});return issued;});
 await writeFile(join(dir,'kiosk-private.json'),JSON.stringify({...seed,...created,previousKioskId:seed.kioskId},null,2),{mode:0o600});
 await writeFile(join(dir,'device-private.json'),'null',{mode:0o600});console.log('Prepared second owned kiosk via existing owners; original revocation and work remain intact.');
}finally{await closeIntegrationPools();}
