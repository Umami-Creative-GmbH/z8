import {readOwnedFixtureDirectory} from './owned-fixture-path.mjs';
﻿import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.env.Z8_1737_REPO??''),pointer=resolve(process.argv[2]??'');assert.ok(process.env.Z8_1737_REPO&&process.argv[2]);
const directory=await readOwnedFixtureDirectory(root,pointer);
assert.equal(process.env.POSTGRES_HOST,'127.0.0.1');assert.match(process.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
const {verifySuiteDatabase,integrationAdminPool,closeIntegrationPools}=await import(pathToFileURL(join(root,'apps/webapp/src/test/integration-database.ts')).href);
const {withCanonicalRecords}=await import(pathToFileURL(join(root,'apps/webapp/src/lib/time-tracking/work-records/__tests__/historical-work.ts')).href);
try{
 await verifySuiteDatabase();const pool=integrationAdminPool();const fixture=JSON.parse(await readFile(join(directory,'fixture-private.json'),'utf8'));assert.equal(fixture.kind,'disposable');const actor=fixture.actors['small-admin'];assert.ok(actor?.employeeId&&actor?.organizationId);
 const {rows:[employee]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[actor.employeeId,actor.organizationId]);assert.ok(employee?.user_id);
 await withCanonicalRecords(pool,async client=>{
  const {rows:[existing]}=await client.query('select count(*)::int as count from work_period where organization_id=$1 and driven_distance_km>0',[actor.organizationId]);assert.equal(existing.count,0,'Seed requires a fresh own synthetic organization with no driving records; never rerun or delete records');
  const vehicle=randomUUID();await client.query('insert into organization_vehicle (id,organization_id,name,licence_plate,archived_at,created_by,updated_at) values ($1,$2,$3,$4,now(),$5,now())',[vehicle,actor.organizationId,'Archived fixture van','FIX-1737',employee.user_id]);
  // These are fixed synthetic UTC instants at the database boundary. Explicit fixed-zone capture agrees with each stored offset.
  for(const [start,end,offset,timezone,distance,own] of [['2025-12-31T23:30:00Z','2026-01-01T00:30:00Z',120,'Etc/GMT-2',101,false],['2026-01-31T23:30:00Z','2026-02-01T00:30:00Z',120,'Etc/GMT-2',29,true],['2026-02-28T23:30:00Z','2026-03-01T00:30:00Z',-300,'Etc/GMT+5',17,false]]){
   const ci=randomUUID(),co=randomUUID();for(const [id,type,instant]of [[ci,'clock_in',start],[co,'clock_out',end]])await client.query('insert into time_entry (id,employee_id,organization_id,type,timestamp,utc_offset_minutes,timezone,timezone_source,hash,created_by) values ($1,$2,$3,$4,$5,$6,$7,\'user_setting\',$8,$9)',[id,actor.employeeId,actor.organizationId,type,instant,offset,timezone,id,employee.user_id]);
   await client.query('insert into work_period(employee_id,organization_id,clock_in_id,clock_out_id,start_time,end_time,duration_minutes,is_active,vehicle_kind,vehicle_id,driven_distance_km,updated_at) values ($1,$2,$3,$4,$5,$6,60,false,$7,$8,$9,now())',[actor.employeeId,actor.organizationId,ci,co,start,end,own?'own':'organization',own?null:vehicle,distance]);
  }
 });
 console.log(JSON.stringify({status:'seeded',scope:'own disposable small-admin organization only',expected:{totalKm:147,months:{'2026-01':101,'2026-02':46,'2026-03':0},archivedVan:{name:'Archived fixture van',plate:'FIX-1737',totalKm:118},ownVehicleKm:29},method:'verifySuiteDatabase + withCanonicalRecords; domain records only; identities/grants/memberships unchanged'}));
}catch(error){await writeFile(join(directory,'root-seed-error-private.json'),JSON.stringify({name:error.name,message:error.message,detail:error.detail,stack:error.stack}),{mode:0o600});console.error(JSON.stringify({status:'seed-failed',name:error?.name??'Error',message:error?.code==='ERR_ASSERTION'?'Disposable fixture precondition failed; no repeat seeding or cleanup attempted.':'Seed failed; inspect own private database diagnostics locally.'}));process.exitCode=1;}finally{await closeIntegrationPools();}
