// A fresh synthetic kiosk-only employee has no pre-adoption history to repair or waive.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createKioskOnlyEmployee } from '@/lib/time-tracking/kiosk/kiosk-only-employee';
import { issueKioskPin } from '@/lib/time-tracking/kiosk/pin-store';
import { issueKioskBadge } from '@/lib/time-tracking/kiosk/badge-store';
import { verifySuiteDatabase, integrationAdminPool, integrationDbModule, closeIntegrationPools } from '@/test/integration-database';
const dir=process.argv[2];await verifySuiteDatabase();
const seed=JSON.parse(await readFile(join(dir,'kiosk-private.json'),'utf8'));
const fixture=JSON.parse(await readFile(join(dir,'fixture-private.json'),'utf8'));
if(fixture.kind!=='disposable'||fixture.actors['small-admin'].organizationId!==seed.organizationId)throw Error('Owned fixture required');
const pool=integrationAdminPool(),{db}=await integrationDbModule();
try{
 const {rows:[admin]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[fixture.actors['small-admin'].employeeId,seed.organizationId]);
 const input={organizationId:seed.organizationId,actorUserId:admin.user_id};
 const target=await createKioskOnlyEmployee(db,{...input,firstName:'R025',lastName:'Clock worker',locationIds:[seed.locationId]});
 const pin=await issueKioskPin(db,{...input,employeeId:target.employeeId});
 const badge=await issueKioskBadge(db,{...input,employeeId:target.employeeId},async delivery=>delivery.credential);
 await writeFile(join(dir,'kiosk-private.json'),JSON.stringify({...seed,employeeId:target.employeeId,employeeName:'R025 Clock worker',pins:{...seed.pins,'small-employee':pin.pin},badge:badge.delivery},null,2),{mode:0o600});
 console.log('Created fresh synthetic kiosk-only worker via existing authorized employee/PIN/badge owners. No historical work repaired, deleted or waived.');
}finally{await closeIntegrationPools();}
