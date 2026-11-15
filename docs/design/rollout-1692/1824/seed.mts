// Guarded local fixture setup, not a UI enrollment/issuance acceptance claim.
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AuditTrail } from "@/lib/audit-trail";
import { createKiosk, updateKiosk } from "@/lib/time-tracking/kiosk/kiosk-store";
import { issueKioskPin } from "@/lib/time-tracking/kiosk/pin-store";
import { issueKioskBadge } from "@/lib/time-tracking/kiosk/badge-store";
import { closeIntegrationPools, integrationAdminPool, integrationDbModule, verifySuiteDatabase } from "@/test/integration-database";

const directory = process.argv[2];
await verifySuiteDatabase();
const fixture = JSON.parse(await readFile(join(directory, "fixture-private.json"), "utf8"));
if (fixture.kind !== "disposable") throw Error("Disposable fixture required");
const pool = integrationAdminPool();
const { db } = await integrationDbModule();
const admin = fixture.actors["small-admin"], target = fixture.actors["small-employee"];
if (!/^perf-small-[a-f0-9]+$/.test(admin.organizationId) || admin.organizationId !== target.organizationId) throw Error("Owned synthetic organization required");
try {
 const { rows: [actor] } = await pool.query('select user_id from employee where id=$1 and organization_id=$2', [admin.employeeId, admin.organizationId]);
 let locationId = randomUUID();
 await pool.query("insert into location (id,organization_id,name,created_by,updated_at) values ($1,$2,'R025 Berlin workshop',$3,now()) on conflict (organization_id,name) do nothing", [locationId, admin.organizationId, actor.user_id]);
 locationId = (await pool.query("select id from location where organization_id=$1 and name='R025 Berlin workshop'",[admin.organizationId])).rows[0].id;
 for (const label of ["small-employee", "small-restricted"]) await pool.query('insert into employee_assigned_location (organization_id,employee_id,location_id,created_by) values ($1,$2,$3,$4) on conflict do nothing', [admin.organizationId, fixture.actors[label].employeeId, locationId, actor.user_id]);
 await pool.query("insert into time_entry_append_control (organization_id,mode) values ($1,'active') on conflict (organization_id) do update set mode='active'",[admin.organizationId]);
 const input = { organizationId: admin.organizationId, actorUserId: actor.user_id };
 const issued = await db.transaction(async tx => {
  const audit = new AuditTrail();
  const issued = await createKiosk(tx, audit, {...input, name:"R025 entrance kiosk", locationId, timezone:"Europe/Berlin"});
  await updateKiosk(tx, audit, {...input, kioskId:issued.kioskId, change:{offlineModeEnabled:true,badgeScannerEnabled:true,badgeCameraEnabled:true,nfcFobReaderEnabled:true}});
  return issued;
 });
 const pins: Record<string,string> = {};
 for(const label of ["small-employee", "small-restricted"]) pins[label] = (await issueKioskPin(db, {...input,employeeId:fixture.actors[label].employeeId})).pin;
 const badge = await issueKioskBadge(db, {...input,employeeId:target.employeeId}, async delivery=>delivery.credential);
 await writeFile(join(directory,"kiosk-private.json"),JSON.stringify({ ...issued, locationId, organizationId:admin.organizationId, employeeId:target.employeeId, pins, badge:badge.delivery },null,2),{mode:0o600});
 console.log("Seeded owned kiosk/location/assignment via guarded fixture, existing kiosk/PIN/badge owners; secrets retained privately.");
} finally { await closeIntegrationPools(); }
