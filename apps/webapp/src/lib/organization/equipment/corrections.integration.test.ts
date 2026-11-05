import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const session = vi.hoisted(() => ({
	userId: "t1544-owner",
	organizationId: "t1544-org",
}));
const clock = vi.hoisted(() => ({ now: "2026-11-04T23:30:00Z" }));
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: session.userId, role: "user" },
				session: {
					id: `session-${session.userId}`,
					userId: session.userId,
					activeOrganizationId: session.organizationId,
				},
			}),
		},
	},
}));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual =
		await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: { nowInstant: () => actual.parseInstant(clock.now) },
	};
});

const actions = await import("./actions");
const pool = integrationAdminPool();
const holderId = "15440000-0000-4000-8000-000000000001";
const ownerId = "15440000-0000-4000-8000-000000000002";
async function clean() {
	await pool.query("delete from organization where id like 't1544-%'");
	await pool.query('delete from "user" where id like $1', ["t1544-%"]);
}
beforeAll(async () => {
	await clean();
	for (const org of ["t1544-org", "t1544-other"])
		await pool.query(
			"insert into organization(id,name,slug,timezone,created_at) values($1,$1,$1,'Europe/Berlin',now())",
			[org],
		);
	for (const [name, org, role] of [
		["owner", "org", "owner"],
		["admin", "org", "admin"],
		["holder", "org", "member"],
		["manager", "org", "member"],
		["foreign", "other", "owner"],
	]) {
		await pool.query(
			'insert into "user"(id,name,email,created_at,updated_at) values($1,$1,$2,now(),now())',
			[`t1544-${name}`, `${name}@t1544.example.test`],
		);
		await pool.query(
			"insert into member(id,user_id,organization_id,role,status,created_at) values($1,$1,$2,$3,'approved',now())",
			[`t1544-${name}`, `t1544-${org}`, role],
		);
	}
	for (const [id, name, role] of [
		[holderId, "holder", "employee"],
		[ownerId, "owner", "employee"],
		["15440000-0000-4000-8000-000000000003", "manager", "manager"],
	])
		await pool.query(
			"insert into employee(id,user_id,organization_id,role,is_active,updated_at) values($1,$2,'t1544-org',$3,true,now())",
			[id, `t1544-${name}`, role],
		);
});
afterAll(clean);
beforeEach(async () => {
	session.userId = "t1544-owner";
	session.organizationId = "t1544-org";
	clock.now = "2026-11-04T23:30:00Z";
	await pool.query(
		"delete from equipment_assignment where organization_id='t1544-org'",
	);
	await pool.query(
		"delete from equipment_command where organization_id='t1544-org'",
	);
	await pool.query(
		"delete from equipment_setup_command where organization_id='t1544-org'",
	);
	await pool.query(
		"delete from equipment_officer_grant where organization_id='t1544-org'",
	);
	await pool.query(
		"delete from equipment_former_team_scope where organization_id='t1544-org'",
	);
	await pool.query(
		"delete from equipment_exception where organization_id='t1544-org'",
	);
	await pool.query(
		"delete from employee_employment_period where organization_id='t1544-org'",
	);
	await pool.query(
		"delete from equipment_item where organization_id='t1544-org'",
	);
	await pool.query(
		"delete from equipment_type where organization_id='t1544-org'",
	);
	await pool.query(
		"delete from equipment_policy where organization_id='t1544-org'",
	);
	await pool.query(
		"update employee set is_active=true, deactivated_at=null where organization_id='t1544-org'",
	);
	await pool.query("update member set role='admin' where id='t1544-admin'");
});
async function setup(input: Record<string, unknown>) {
	const result = await actions.changeEquipmentSetup({
		requestId: crypto.randomUUID(),
		...input,
	});
	if (!result.success || !result.data.ok)
		throw new Error(JSON.stringify(result));
	return result.data;
}
async function quantityType() {
	await setup({
		kind: "configure_policy",
		retentionMonths: 24,
		expectedRevision: 0,
	});
	return setup({
		kind: "create_type",
		name: "Shirt · size M",
		trackingMode: "quantity",
		defaultReturnRequired: true,
	});
}
async function issue(typeId: string, extra: Record<string, unknown> = {}) {
	return actions.changeEquipment({
		kind: "record_historical_quantity",
		requestId: crypto.randomUUID(),
		typeId,
		employeeId: holderId,
		expectedRevision: 1,
		quantity: 3,
		actualDate: null,
		condition: "good",
		notes: "Three size-M shirts",
		returnRequired: true,
		explicitDeadline: "2026-11-04",
		...extra,
	});
}
async function overview(filters: Record<string, unknown> = {}) {
	const result = await actions.getEquipmentOverview(filters);
	if (!result.success) throw new Error(JSON.stringify(result));
	return result.data;
}
function receive(assignmentId: string, extra: Record<string, unknown> = {}) {
	return actions.changeEquipment({
		kind: "receive_quantity",
		requestId: crypto.randomUUID(),
		assignmentId,
		expectedRevision: 1,
		quantity: 2,
		actualDate: "2026-11-04",
		condition: "good",
		notes: "Two good shirts",
		...extra,
	});
}

it("amends issue evidence with a reason while retaining the original and replaying only for its actor", async () => {
 const type = await quantityType();
 await issue(type.id, {actualDate: "2026-10-01"});
 const original = (await overview()).assignments[0];
 const command = {kind: "correct_issue", requestId: crypto.randomUUID(), assignmentId: original.id, expectedRevision: 1, quantity: 4, actualDate: null, condition: "worn", notes: "Corrected count", returnRequired: true, explicitDeadline: "2026-11-03", employmentPeriodId: null, reason: "Stock count confirmed four shirts"};
 expect(await actions.changeEquipment(command)).toMatchObject({success: true, data: {ok:true, revision:2}});
 const effective = (await overview()).assignments[0];
 expect(effective).toMatchObject({quantity:4, outstandingQuantity:4, explicitDeadline:"2026-11-03", issue:{actualDate:null,condition:"worn",notes:"Corrected count"}, corrections:[{reason:"Stock count confirmed four shirts",actorId:"t1544-owner",recordedAt:"2026-11-04T23:30:00Z",expectedRevision:1,before:{quantity:3,actualDate:"2026-10-01"},after:{quantity:4,actualDate:null}}]});
 expect(await actions.changeEquipment(command)).toMatchObject({success:true,data:{ok:true,revision:2}});
 expect((await overview()).assignments[0].corrections).toHaveLength(1);
 session.userId = "t1544-admin";
 expect(await actions.changeEquipment(command)).toMatchObject({success:true,data:{ok:false,reason:"request_conflict"}});
});
async function amendIssue(assignmentId:string, extra:Record<string,unknown>={}) {
 const a=(await overview()).assignments.find(a=>a.id===assignmentId)!;
 return actions.changeEquipment({kind:"correct_issue",requestId:crypto.randomUUID(),assignmentId,expectedRevision:a.revision,quantity:a.quantity,actualDate:a.issue.actualDate,condition:a.issue.condition,notes:a.issue.notes??"",returnRequired:a.returnRequired,explicitDeadline:a.explicitDeadline,employmentPeriodId:a.employmentPeriodId,reason:"Corrected from the signed handover",...extra});
}
async function amendReceipt(assignmentId:string, extra:Record<string,unknown>={}) {
 const a=(await overview()).assignments.find(a=>a.id===assignmentId)!;
 const h=a.receipts[0];
 return actions.changeEquipment({kind:"correct_receipt",requestId:crypto.randomUUID(),assignmentId,handoverId:h.id,expectedRevision:a.revision,quantity:h.quantity,actualDate:h.actualDate,condition:h.condition,notes:h.notes??"",reason:"Receipt count was entered incorrectly",...extra});
}
it("restores only the corrected physical balance, rejects excess settlements and future or conflicting dates, and fences concurrent stale forms", async () => {
 const type=await quantityType(); await issue(type.id,{actualDate:"2026-11-01"});
 const a=(await overview()).assignments[0];
 expect(await receive(a.id)).toMatchObject({data:{ok:true}});
 expect(await amendReceipt(a.id,{quantity:0})).toMatchObject({data:{ok:true}});
 expect((await overview()).assignments[0]).toMatchObject({physicallyReceivedQuantity:0,outstandingQuantity:3,receipts:[{quantity:0}],corrections:[{before:{quantity:2},after:{quantity:0}}]});
 expect(await amendReceipt(a.id,{quantity:4})).toMatchObject({data:{ok:false,reason:"excess_quantity"}});
 expect(await amendReceipt(a.id,{actualDate:"2026-11-06"})).toMatchObject({data:{ok:false,reason:"future_date"}});
 expect(await amendReceipt(a.id,{actualDate:"2026-10-31"})).toMatchObject({data:{ok:false,reason:"conflicting_history"}});
 const results=await Promise.all([amendReceipt(a.id,{quantity:1,expectedRevision:3}),amendReceipt(a.id,{quantity:2,expectedRevision:3})]);
 expect(results.filter(r=>r.success&&r.data.ok)).toHaveLength(1);
 expect(results.filter(r=>r.success&&!r.data.ok&&r.data.reason==="stale_revision")).toHaveLength(1);
 expect((await overview()).assignments[0].corrections).toHaveLength(2);
});
async function command(change:Record<string,unknown>) {
 return actions.changeEquipment({requestId:crypto.randomUUID(),...change});
}
async function close(assignmentId:string, quantity=3) {
 const a=(await overview()).assignments.find(a=>a.id===assignmentId)!;
 expect(await command({kind:"close_return",assignmentId,quantity,outcome:"lost",reason:"Missing at inventory",expectedRevision:a.revision})).toMatchObject({data:{ok:true}});
 return (await overview()).assignments.find(a=>a.id===assignmentId)!;
}
async function amendException(assignmentId:string,extra:Record<string,unknown>={}) {
 const a=(await overview()).assignments.find(a=>a.id===assignmentId)!;
 return command({kind:"correct_exception",assignmentId,exceptionId:a.exceptions[0].id,expectedRevision:a.revision,quantity:1,outcome:"lost",decisionReason:"One shirt still missing",reason:"Two shirts located in the locker",...extra});
}
it("partially reverses exceptions without inventing receipts, preserves recovery linkage and uses the effective remaining decision for later receipts",async()=>{
 const type=await quantityType();await issue(type.id); const a=await close((await overview()).assignments[0].id);
 expect(await amendException(a.id,{quantity:2})).toMatchObject({data:{ok:true}});
 expect((await overview()).assignments[0]).toMatchObject({lostQuantity:2,outstandingQuantity:1,physicallyReceivedQuantity:0,held:true,exceptions:[{quantity:2,receivedQuantity:0}]});
 expect(await command({kind:"receive_exception",assignmentId:a.id,exceptionId:a.exceptions[0].id,expectedRevision:3,quantity:1,actualDate:"2026-11-05",condition:"good"})).toMatchObject({data:{ok:true}});
 expect(await amendException(a.id,{quantity:0})).toMatchObject({data:{ok:false,reason:"recovery_conflict"}});
 expect(await amendException(a.id,{quantity:1})).toMatchObject({data:{ok:true}});
 expect((await overview()).assignments[0]).toMatchObject({lostQuantity:1,outstandingQuantity:2,physicallyReceivedQuantity:1,recoveredQuantity:1});
 expect(await command({kind:"receive_exception",assignmentId:a.id,exceptionId:a.exceptions[0].id,expectedRevision:5,quantity:1,actualDate:"2026-11-05",condition:"good"})).toMatchObject({data:{ok:false,reason:"excess_quantity"}});
 expect(await amendReceipt(a.id,{quantity:0})).toMatchObject({data:{ok:true}});
 expect(await amendException(a.id,{quantity:0})).toMatchObject({data:{ok:true}});
 expect((await overview()).assignments[0]).toMatchObject({lostQuantity:0,outstandingQuantity:3,physicallyReceivedQuantity:0,recoveredQuantity:0,exceptions:[{quantity:0,receivedQuantity:0}]});
});

async function transfer(assignmentId:string) {
 const a=(await overview()).assignments.find(a=>a.id===assignmentId)!;
 const destination=await command({kind:"transfer_equipment",assignmentId,employeeId:ownerId,quantity:2,expectedRevision:a.revision,expectedIssuanceRevision:a.transfer!.expectedIssuanceRevision,receipt:{actualDate:"2026-11-03",condition:"good"},issue:{actualDate:"2026-11-04",condition:"worn",returnRequired:true}});
 expect(destination).toMatchObject({data:{ok:true}});
 return (await overview()).assignments.find(a=>a.employeeId===ownerId)!;
}
it("amends both linked transfer quantities atomically and refuses contradictory single-leg dates or quantities", async()=>{
 const type=await quantityType(); await issue(type.id,{actualDate:"2026-11-01"}); const a=(await overview()).assignments[0];
 const destination=await transfer(a.id);
 // Receiving one's own destination is forbidden, but independently confirming the source is allowed.
 expect(await amendReceipt(a.id,{quantity:1})).toMatchObject({data:{ok:false,reason:"transfer_conflict"}});
 expect(await amendReceipt(a.id,{actualDate:"2026-11-05"})).toMatchObject({data:{ok:false,reason:"transfer_conflict"}});
 session.userId="t1544-admin";
 const transferChange={kind:"correct_transfer",assignmentId:a.id,expectedRevision:2,destinationAssignmentId:destination.id,expectedDestinationRevision:1,quantity:1,receipt:{actualDate:"2026-11-02",condition:"worn",notes:"One shirt transferred"},issue:{actualDate:"2026-11-03",condition:"worn",notes:"One shirt issued"},reason:"Counted one shirt in the transfer bag"};
 expect(await command(transferChange)).toMatchObject({data:{ok:true}});
 expect((await overview()).assignments.find(row=>row.id===a.id)).toMatchObject({physicallyReceivedQuantity:1,outstandingQuantity:2,receipts:[{quantity:1}],corrections:[{reason:transferChange.reason}]});
 expect((await overview()).assignments.find(row=>row.id===destination.id)).toMatchObject({quantity:1,issue:{quantity:1},corrections:[{reason:transferChange.reason}]});
});

it("cannot orphan a recovery when increasing and later reducing an amended loss decision",async()=>{
 const type=await quantityType();await issue(type.id);const a=await close((await overview()).assignments[0].id);
 expect(await amendIssue(a.id,{quantity:5})).toMatchObject({data:{ok:true}});
 expect(await amendException(a.id,{quantity:5})).toMatchObject({data:{ok:true}});
 expect(await command({kind:"receive_exception",assignmentId:a.id,exceptionId:a.exceptions[0].id,expectedRevision:4,quantity:4,actualDate:"2026-11-05",condition:"damaged"})).toMatchObject({data:{ok:true}});
 expect((await overview()).assignments[0]).toMatchObject({quantity:5,physicallyReceivedQuantity:4,lostQuantity:5,outstandingQuantity:0,recoveredQuantity:4});
 expect(await amendException(a.id,{quantity:3})).toMatchObject({data:{ok:false,reason:"recovery_conflict"}});
});
