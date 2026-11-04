import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const session = vi.hoisted(() => ({
	userId: "t1538-owner",
	organizationId: "t1538-org",
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
const holderId = "15380000-0000-4000-8000-000000000001";
const ownerId = "15380000-0000-4000-8000-000000000002";
async function clean() {
	await pool.query("delete from organization where id like 't1538-%'");
	await pool.query('delete from "user" where id like $1', ["t1538-%"]);
}
beforeAll(async () => {
	await clean();
	for (const org of ["t1538-org", "t1538-other"])
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
			[`t1538-${name}`, `${name}@t1538.example.test`],
		);
		await pool.query(
			"insert into member(id,user_id,organization_id,role,status,created_at) values($1,$1,$2,$3,'approved',now())",
			[`t1538-${name}`, `t1538-${org}`, role],
		);
	}
	for (const [id, name, role] of [
		[holderId, "holder", "employee"],
		[ownerId, "owner", "employee"],
		["15380000-0000-4000-8000-000000000003", "manager", "manager"],
	])
		await pool.query(
			"insert into employee(id,user_id,organization_id,role,is_active,updated_at) values($1,$2,'t1538-org',$3,true,now())",
			[id, `t1538-${name}`, role],
		);
});
afterAll(clean);
beforeEach(async () => {
	session.userId = "t1538-owner";
	session.organizationId = "t1538-org";
	clock.now = "2026-11-04T23:30:00Z";
	await pool.query(
		"delete from equipment_assignment where organization_id='t1538-org'",
	);
	await pool.query(
		"delete from equipment_command where organization_id='t1538-org'",
	);
	await pool.query(
		"delete from equipment_setup_command where organization_id='t1538-org'",
	);
	await pool.query(
		"delete from equipment_item where organization_id='t1538-org'",
	);
	await pool.query(
		"delete from equipment_type where organization_id='t1538-org'",
	);
	await pool.query(
		"delete from equipment_policy where organization_id='t1538-org'",
	);
	await pool.query(
		"update employee set is_active=true where organization_id='t1538-org'",
	);
	await pool.query("update member set role='admin' where id='t1538-admin'");
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
		kind: "issue_quantity",
		requestId: crypto.randomUUID(),
		typeId,
		employeeId: holderId,
		expectedRevision: 1,
		quantity: 3,
		actualDate: "2026-11-02",
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
it("issues three shirts and independently receives two good shirts and one damaged shirt with honest totals", async () => {
	const type = await quantityType();
	const issued = await issue(type.id);
	expect(issued).toMatchObject({
		success: true,
		data: { ok: true, revision: 1 },
	});
	if (!issued.success || !issued.data.ok)
		throw new Error(JSON.stringify(issued));
	expect(await receive(issued.data.id)).toMatchObject({
		success: true,
		data: { ok: true, revision: 2 },
	});
	expect(
		(await overview({ outstanding: true, overdue: true, typeId: type.id }))
			.assignments,
	).toMatchObject([
		{
			itemId: null,
			typeId: type.id,
			trackingMode: "quantity",
			quantity: 3,
			physicallyReceivedQuantity: 2,
			outstandingQuantity: 1,
			outstanding: true,
			held: true,
			revision: 2,
			receipts: [
				{
					quantity: 2,
					condition: "good",
					actualDate: "2026-11-04",
					notes: "Two good shirts",
					actorName: "t1538-owner",
					recordedAt: "2026-11-04T23:30:00Z",
				},
			],
		},
	]);
	session.userId = "t1538-admin";
	expect(
		await receive(issued.data.id, {
			expectedRevision: 2,
			quantity: 1,
			actualDate: "2026-11-05",
			condition: "damaged",
			notes: "Torn sleeve",
		}),
	).toMatchObject({ success: true, data: { ok: true, revision: 3 } });
	expect((await overview({ outstanding: true })).assignments).toEqual([]);
	session.userId = "t1538-holder";
	expect(await actions.getMyEquipment()).toMatchObject({
		success: true,
		data: {
			canManage: false,
			assignments: [
				{
					quantity: 3,
					physicallyReceivedQuantity: 3,
					outstandingQuantity: 0,
					outstanding: false,
					overdue: false,
					held: false,
					issue: { quantity: 3, notes: "Three size-M shirts" },
					receipts: [
						{
							quantity: 2,
							condition: "good",
							notes: "Two good shirts",
							actorName: "t1538-owner",
						},
						{
							quantity: 1,
							condition: "damaged",
							notes: "Torn sleeve",
							actorName: "t1538-admin",
							actualDate: "2026-11-05",
						},
					],
				},
			],
		},
	});
});

async function issued(extra: Record<string, unknown> = {}) {
	const type = await quantityType();
	const result = await issue(type.id, extra);
	if (!result.success || !result.data.ok)
		throw new Error(JSON.stringify(result));
	return { type, assignment: result.data };
}
it("serializes competing partial receipts, refuses oversettlement and replays each accepted request exactly once", async () => {
	const { assignment } = await issued();
	const requestId = crypto.randomUUID();
	const results = await Promise.all([
		receive(assignment.id, { requestId }),
		receive(assignment.id, { requestId }),
	]);
	expect(results[0]).toEqual(results[1]);
	expect(results.filter((r) => r.success && r.data.ok)).toHaveLength(2);
	expect((await overview()).assignments).toMatchObject([
		{
			quantity: 3,
			physicallyReceivedQuantity: 2,
			outstandingQuantity: 1,
			revision: 2,
			receipts: [{ quantity: 2 }],
		},
	]);
	expect(
		await receive(assignment.id, { expectedRevision: 2, quantity: 2 }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "excess_quantity" },
	});
	expect(
		await receive(assignment.id, { requestId, notes: "Changed payload" }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "request_conflict" },
	});
	session.userId = "t1538-admin";
	expect(await receive(assignment.id, { requestId })).toMatchObject({
		success: true,
		data: { ok: false, reason: "request_conflict" },
	});
	const lastRequest = crypto.randomUUID();
	const last = {
		expectedRevision: 2,
		quantity: 1,
		requestId: lastRequest,
		condition: "damaged",
	};
	const final = await Promise.all([
		receive(assignment.id, last),
		receive(assignment.id, last),
	]);
	expect(final[0]).toMatchObject({
		success: true,
		data: { ok: true, revision: 3 },
	});
	expect(final[1]).toEqual(final[0]);
	expect((await overview()).assignments[0]).toMatchObject({
		physicallyReceivedQuantity: 3,
		outstandingQuantity: 0,
		revision: 3,
	});
	expect((await overview()).assignments[0].receipts).toHaveLength(2);
	expect(
		await receive(assignment.id, { expectedRevision: 3, quantity: 1 }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "already_received" },
	});
});
it("replays issuance without duplicating agreements and refuses changed or foreign actors on the same identity", async () => {
	const type = await quantityType();
	const requestId = crypto.randomUUID();
	const results = await Promise.all([
		issue(type.id, { requestId }),
		issue(type.id, { requestId }),
	]);
	expect(results[0]).toMatchObject({ success: true, data: { ok: true } });
	expect(results[1]).toEqual(results[0]);
	expect((await overview()).assignments).toHaveLength(1);
	expect(await issue(type.id, { requestId, quantity: 4 })).toMatchObject({
		success: true,
		data: { ok: false, reason: "request_conflict" },
	});
	session.userId = "t1538-admin";
	expect(await issue(type.id, { requestId })).toMatchObject({
		success: true,
		data: { ok: false, reason: "request_conflict" },
	});
	session.userId = "t1538-manager";
	expect(await issue(type.id, { requestId })).toMatchObject({
		success: true,
		data: { ok: false, reason: "forbidden" },
	});
});
it("rejects zero, negative, fractional, nonnumeric and database-overflow quantities on both commands", async () => {
	const type = await quantityType();
	for (const quantity of [
		0,
		-1,
		1.5,
		"2",
		Number.NaN,
		Number.POSITIVE_INFINITY,
		2147483648,
	])
		expect(await issue(type.id, { quantity })).toMatchObject({
			success: true,
			data: { ok: false, reason: "invalid_input" },
		});
	expect((await overview()).assignments).toEqual([]);
	const result = await issue(type.id);
	if (!result.success || !result.data.ok)
		throw new Error(JSON.stringify(result));
	for (const quantity of [
		0,
		-1,
		0.5,
		"2",
		Number.NaN,
		Number.POSITIVE_INFINITY,
		2147483648,
	])
		expect(await receive(result.data.id, { quantity })).toMatchObject({
			success: true,
			data: { ok: false, reason: "invalid_input" },
		});
	expect(await receive(result.data.id, { quantity: 4 })).toMatchObject({
		success: true,
		data: { ok: false, reason: "excess_quantity" },
	});
	expect((await overview()).assignments[0]).toMatchObject({
		physicallyReceivedQuantity: 0,
		outstandingQuantity: 3,
		revision: 1,
		receipts: [],
	});
});
it("keeps issued-to-keep quantities free of obligations while recording voluntary partial receipts", async () => {
	const { type, assignment } = await issued({
		returnRequired: false,
		explicitDeadline: null,
	});
	expect((await overview()).assignments[0]).toMatchObject({
		returnRequired: false,
		explicitDeadline: null,
		outstandingQuantity: 0,
		physicallyReceivedQuantity: 0,
		held: true,
		overdue: false,
	});
	expect((await overview({ outstanding: true })).assignments).toEqual([]);
	expect(await receive(assignment.id)).toMatchObject({
		success: true,
		data: { ok: true },
	});
	expect((await overview()).assignments[0]).toMatchObject({
		physicallyReceivedQuantity: 2,
		outstandingQuantity: 0,
		held: true,
	});
	const currentType = (await overview()).availableQuantityTypes.find(
		(t) => t.id === type.id,
	);
	if (!currentType) throw new Error("Expected selectable quantity type");
	await setup({
		kind: "update_type",
		id: type.id,
		expectedRevision: currentType.revision,
		name: "Shirt · size M",
		trackingMode: "quantity",
		defaultReturnRequired: false,
	});
	expect((await overview()).assignments[0].returnRequired).toBe(false);
	expect(
		await receive(assignment.id, { expectedRevision: 2, quantity: 1 }),
	).toMatchObject({ success: true, data: { ok: true } });
	expect((await overview()).assignments[0]).toMatchObject({
		quantity: 3,
		physicallyReceivedQuantity: 3,
		outstandingQuantity: 0,
		held: false,
	});
});
it("isolates self-return, manager and personal access while allowing another administrator to receive", async () => {
	const { assignment, type } = await issued({ employeeId: ownerId });
	expect((await overview()).assignments[0].canReceive).toBe(false);
	expect(await receive(assignment.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "self_receipt" },
	});
	for (const actor of ["t1538-holder", "t1538-manager"]) {
		session.userId = actor;
		expect(await issue(type.id, { expectedRevision: 2 })).toMatchObject({
			success: true,
			data: { ok: false, reason: "forbidden" },
		});
		expect(await receive(assignment.id)).toMatchObject({
			success: true,
			data: { ok: false, reason: "forbidden" },
		});
		expect(await actions.getEquipmentOverview()).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await actions.getEmployeeEquipment(ownerId)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await actions.getMyEquipment()).toMatchObject({
			success: true,
			data: { assignments: [], availableQuantityTypes: [] },
		});
	}
	session.userId = "t1538-admin";
	expect(await receive(assignment.id)).toMatchObject({
		success: true,
		data: { ok: true },
	});
	session.userId = "t1538-owner";
	expect(await actions.getMyEquipment()).toMatchObject({
		success: true,
		data: {
			assignments: [
				{
					quantity: 3,
					physicallyReceivedQuantity: 2,
					outstandingQuantity: 1,
					canReceive: false,
				},
			],
		},
	});
});
it("isolates foreign types, employees and assignments and refuses raw individual receipt bypass", async () => {
	const { type, assignment } = await issued();
	expect(
		await actions.changeEquipment({
			kind: "receive_individual",
			requestId: crypto.randomUUID(),
			assignmentId: assignment.id,
			expectedRevision: 1,
			condition: "good",
			actualDate: "2026-11-04",
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "quantity_required" },
	});
	expect(
		await receive(assignment.id, {
			organizationId: "t1538-other",
			actorId: "t1538-admin",
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "invalid_input" },
	});
	session.organizationId = "t1538-other";
	session.userId = "t1538-foreign";
	expect((await overview()).assignments).toEqual([]);
	expect((await overview()).availableQuantityTypes).toEqual([]);
	expect(await issue(type.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "not_found" },
	});
	expect(await receive(assignment.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "not_found" },
	});
	expect(await actions.getEmployeeEquipment(holderId)).toMatchObject({
		success: true,
		data: { assignments: [] },
	});
	session.organizationId = "t1538-org";
	session.userId = "t1538-owner";
	expect((await overview()).assignments[0]).toMatchObject({
		physicallyReceivedQuantity: 0,
		outstandingQuantity: 3,
	});
});
it("honors organization-local dates, stale type revisions, required policy and mode, and refuses future or pre-issue receipts", async () => {
	const type = await quantityType();
	expect(await issue(type.id, { expectedRevision: 0 })).toMatchObject({
		success: true,
		data: { ok: false, reason: "stale_revision" },
	});
	expect(await issue(type.id, { returnRequired: false })).toMatchObject({
		success: true,
		data: { ok: false, reason: "invalid_input" },
	});
	expect(
		await issue(type.id, { actualDate: "2026-11-06", explicitDeadline: null }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "future_date" },
	});
	expect(await issue(type.id, { actualDate: "2026-11-05" })).toMatchObject({
		success: true,
		data: { ok: false, reason: "conflicting_history" },
	});
	expect(await issue(type.id, { actualDate: "2026-02-30" })).toMatchObject({
		success: true,
		data: { ok: false, reason: "invalid_input" },
	});
	const individual = await setup({
		kind: "create_type",
		name: "Laptop",
		trackingMode: "individual",
		defaultReturnRequired: true,
	});
	expect(await issue(individual.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "quantity_required" },
	});
	await pool.query(
		"delete from equipment_policy where organization_id='t1538-org'",
	);
	expect(await issue(type.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "policy_required" },
	});
	await setup({
		kind: "configure_policy",
		retentionMonths: 24,
		expectedRevision: 0,
	});
	const issued = await issue(type.id, {
		actualDate: "2026-11-05",
		explicitDeadline: "2026-11-05",
	});
	if (!issued.success || !issued.data.ok)
		throw new Error(JSON.stringify(issued));
	expect((await overview({ overdue: true })).assignments).toEqual([]);
	expect(await receive(issued.data.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "conflicting_history" },
	});
	expect(
		await receive(issued.data.id, { actualDate: "2026-11-06" }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "future_date" },
	});
	expect(
		await receive(issued.data.id, { actualDate: "2026-11-05", quantity: 1 }),
	).toMatchObject({ success: true, data: { ok: true } });
	expect(
		await setup({
			kind: "update_type",
			id: type.id,
			name: "Shirt",
			trackingMode: "quantity",
			expectedRevision: 2,
			defaultReturnRequired: false,
		}),
	).toMatchObject({ ok: true });
	expect((await overview()).assignments[0].returnRequired).toBe(true);
});
it("preserves former-holder receipts and history after archival without permitting new issuance or former actor access", async () => {
	const { type, assignment } = await issued();
	await pool.query("update employee set is_active=false where id=$1", [
		holderId,
	]);
	expect(await issue(type.id, { expectedRevision: 2 })).toMatchObject({
		success: true,
		data: { ok: false, reason: "employee_not_current" },
	});
	await setup({ kind: "archive_type", id: type.id, expectedRevision: 2 });
	expect((await overview()).availableQuantityTypes).toEqual([]);
	expect(
		(await overview({ former: true, holderId, outstanding: true })).assignments,
	).toMatchObject([{ former: true, outstandingQuantity: 3 }]);
	expect((await overview({ former: false })).assignments).toEqual([]);
	expect(await receive(assignment.id)).toMatchObject({
		success: true,
		data: { ok: true },
	});
	expect(await actions.getEmployeeEquipment(holderId)).toMatchObject({
		success: true,
		data: {
			assignments: [
				{ former: true, physicallyReceivedQuantity: 2, outstandingQuantity: 1 },
			],
		},
	});
	session.userId = "t1538-holder";
	expect(await actions.getMyEquipment()).toMatchObject({ success: false });
	session.userId = "t1538-owner";
	expect(
		await issue(type.id, { employeeId: ownerId, expectedRevision: 3 }),
	).toMatchObject({ success: true, data: { ok: false, reason: "archived" } });
});

it("allows only one of two distinct final receipts of a remaining unit", async () => {
	const { assignment } = await issued();
	expect(await receive(assignment.id)).toMatchObject({
		success: true,
		data: { ok: true, revision: 2 },
	});
	const results = await Promise.all([
		receive(assignment.id, {
			expectedRevision: 2,
			quantity: 1,
			condition: "good",
		}),
		receive(assignment.id, {
			expectedRevision: 2,
			quantity: 1,
			condition: "damaged",
		}),
	]);
	expect(results.filter((r) => r.success && r.data.ok)).toHaveLength(1);
	expect(
		results.filter(
			(r) => r.success && !r.data.ok && r.data.reason === "stale_revision",
		),
	).toHaveLength(1);
	expect((await overview()).assignments).toMatchObject([
		{
			quantity: 3,
			physicallyReceivedQuantity: 3,
			outstandingQuantity: 0,
			revision: 3,
		},
	]);
	expect((await overview()).assignments[0].receipts).toHaveLength(2);
});

it("serializes issuance with the real departure boundary and refuses fresh issuance after the live cutoff", async () => {
	const registered = await quantityType();
	const { db } = await import("@/db");
	const { createDepartureCommands } = await import(
		"@/lib/employee-lifecycle/commands"
	);
	const { createDepartureClockOut } = await import(
		"@/lib/employee-lifecycle/clock-out"
	);
	const { parseInstant } = await import("@/lib/datetime/temporal-core");
	await pool.query(
		"insert into employee_employment_period(id,organization_id,employee_id,status,started_at,start_provenance) values('15380000-0000-4000-8000-000000000100','t1538-org',$1,'open','2026-01-01Z','recorded')",
		[holderId],
	);
	const commands = createDepartureCommands({
		db,
		clock: { nowInstant: () => parseInstant(clock.now) },
		clockOut: createDepartureClockOut(),
	});
	const actor = { userId: "t1538-owner", organizationId: "t1538-org" };
	await commands.scheduleDeparture(actor, {
		employeeId: holderId,
		requestId: crypto.randomUUID(),
		expectedRevision: null,
		lastWorkingDay: "2026-11-05",
		replacementEmployeeId: null,
		acknowledgeUnassignedDuties: true,
	});
	clock.now = "2026-11-05T23:30:00Z";
	// The worker has not materialized the cutoff yet: the live access function must still refuse.
	expect(await issue(registered.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "employee_not_current" },
	});
	// Restore a fresh period for the concurrent case using a separate current employee.
	const targetId = "15380000-0000-4000-8000-000000000003";
	await pool.query(
		"insert into employee_employment_period(id,organization_id,employee_id,status,started_at,start_provenance) values('15380000-0000-4000-8000-000000000101','t1538-org',$1,'open','2026-01-01Z','recorded')",
		[targetId],
	);
	const [issuance, departed] = await Promise.all([
		issue(registered.id, { employeeId: targetId }),
		commands.offboardNow(actor, {
			employeeId: targetId,
			requestId: crypto.randomUUID(),
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		}),
	]);
	expect(departed).toMatchObject({ status: "effective" });
	expect(issuance.success).toBe(true);
	if (!issuance.success) throw new Error("Expected a serial equipment outcome");
	if (issuance.data.ok)
		expect((await overview({ former: true })).assignments).toMatchObject([
			{ employeeId: targetId, former: true, outstanding: true },
		]);
	else expect(issuance.data.reason).toBe("employee_not_current");
	expect(await issue(registered.id, { employeeId: targetId })).toMatchObject({
		success: true,
		data: { ok: false, reason: "employee_not_current" },
	});
});
