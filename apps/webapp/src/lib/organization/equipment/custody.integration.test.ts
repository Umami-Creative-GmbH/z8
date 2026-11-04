import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const session = vi.hoisted(() => ({
	userId: "t1537-owner",
	organizationId: "t1537-org",
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
const holderId = "15370000-0000-4000-8000-000000000001";
const ownerId = "15370000-0000-4000-8000-000000000002";
async function clean() {
	await pool.query("delete from organization where id like 't1537-%'");
	await pool.query('delete from "user" where id like $1', ["t1537-%"]);
}
beforeAll(async () => {
	await clean();
	for (const org of ["t1537-org", "t1537-other"])
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
			[`t1537-${name}`, `${name}@t1537.example.test`],
		);
		await pool.query(
			"insert into member(id,user_id,organization_id,role,status,created_at) values($1,$1,$2,$3,'approved',now())",
			[`t1537-${name}`, `t1537-${org}`, role],
		);
	}
	for (const [id, name, role] of [
		[holderId, "holder", "employee"],
		[ownerId, "owner", "employee"],
		["15370000-0000-4000-8000-000000000003", "manager", "manager"],
	])
		await pool.query(
			"insert into employee(id,user_id,organization_id,role,is_active,updated_at) values($1,$2,'t1537-org',$3,true,now())",
			[id, `t1537-${name}`, role],
		);
});
afterAll(clean);
beforeEach(async () => {
	session.userId = "t1537-owner";
	session.organizationId = "t1537-org";
	clock.now = "2026-11-04T23:30:00Z";
	await pool.query(
		"delete from equipment_assignment where organization_id='t1537-org'",
	);
	await pool.query(
		"delete from equipment_command where organization_id='t1537-org'",
	);
	await pool.query(
		"delete from equipment_setup_command where organization_id='t1537-org'",
	);
	await pool.query(
		"delete from equipment_item where organization_id='t1537-org'",
	);
	await pool.query(
		"delete from equipment_type where organization_id='t1537-org'",
	);
	await pool.query(
		"delete from equipment_policy where organization_id='t1537-org'",
	);
	await pool.query(
		"update employee set is_active=true where organization_id='t1537-org'",
	);
	await pool.query("update member set role='admin' where id='t1537-admin'");
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
async function item() {
	await setup({
		kind: "configure_policy",
		retentionMonths: 24,
		expectedRevision: 0,
	});
	const type = await setup({
		kind: "create_type",
		name: "Laptop",
		trackingMode: "individual",
		defaultReturnRequired: true,
	});
	return setup({ kind: "register_item", typeId: type.id, identifier: "L-01" });
}
async function issue(itemId: string, extra: Record<string, unknown> = {}) {
	return actions.changeEquipment({
		kind: "issue_individual",
		requestId: crypto.randomUUID(),
		itemId,
		employeeId: holderId,
		expectedRevision: 1,
		actualDate: "2026-11-02",
		condition: "good",
		notes: "Charger included",
		returnRequired: true,
		explicitDeadline: "2026-11-04",
		...extra,
	});
}

it("issues and reads an attributable agreement, then receives it without losing history", async () => {
	const registered = await item();
	const issued = await issue(registered.id);
	expect(issued).toMatchObject({
		success: true,
		data: { ok: true, revision: 1 },
	});
	expect(await actions.getEquipmentSetup()).toMatchObject({
		success: true,
		data: { items: [{ id: registered.id, inCustody: true }] },
	});
	const overview = await actions.getEquipmentOverview({
		outstanding: true,
		overdue: true,
	});
	expect(overview).toMatchObject({
		success: true,
		data: {
			timezone: "Europe/Berlin",
			today: "2026-11-05",
			assignments: [
				{
					employeeId: holderId,
					holderName: "t1537-holder",
					identifier: "L-01",
					returnRequired: true,
					explicitDeadline: "2026-11-04",
					outstanding: true,
					overdue: true,
					issue: {
						actualDate: "2026-11-02",
						condition: "good",
						notes: "Charger included",
						actorName: "t1537-owner",
						recordedAt: "2026-11-04T23:30:00Z",
					},
				},
			],
		},
	});
	if (!issued.success || !issued.data.ok) throw new Error("Issue failed");
	const received = await actions.changeEquipment({
		kind: "receive_individual",
		requestId: crypto.randomUUID(),
		assignmentId: issued.data.id,
		expectedRevision: 1,
		actualDate: "2026-11-04",
		condition: "worn",
		notes: "Received with charger",
	});
	expect(received).toMatchObject({
		success: true,
		data: { ok: true, revision: 2 },
	});
	expect(await actions.getEmployeeEquipment(holderId)).toMatchObject({
		success: true,
		data: {
			assignments: [
				{
					outstanding: false,
					overdue: false,
					held: false,
					revision: 2,
					receipt: {
						actualDate: "2026-11-04",
						condition: "worn",
						notes: "Received with charger",
						actorName: "t1537-owner",
					},
				},
			],
			availableItems: [{ id: registered.id, revision: 3 }],
		},
	});
	session.userId = "t1537-holder";
	expect(await actions.getMyEquipment()).toMatchObject({
		success: true,
		data: {
			assignments: [{ identifier: "L-01", held: false }],
			canManage: false,
			availableItems: [],
			employees: [],
		},
	});
});

async function issued(extra: Record<string, unknown> = {}) {
	const registered = await item();
	const result = await issue(registered.id, extra);
	if (!result.success || !result.data.ok)
		throw new Error(JSON.stringify(result));
	return { registered, assignment: result.data };
}
function receive(assignmentId: string, extra: Record<string, unknown> = {}) {
	return actions.changeEquipment({
		kind: "receive_individual",
		requestId: crypto.randomUUID(),
		assignmentId,
		expectedRevision: 1,
		actualDate: "2026-11-05",
		condition: "good",
		...extra,
	});
}
async function overview(filters: Record<string, unknown> = {}) {
	const result = await actions.getEquipmentOverview(filters);
	if (!result.success) throw new Error(JSON.stringify(result));
	return result.data;
}

it("requires a policy and an active individual type on fresh issuance, even for registered identities", async () => {
	const registered = await item();
	await pool.query(
		"delete from equipment_policy where organization_id='t1537-org'",
	);
	expect(await issue(registered.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "policy_required" },
	});
	expect((await overview()).assignments).toEqual([]);
	await setup({
		kind: "configure_policy",
		retentionMonths: 24,
		expectedRevision: 0,
	});
	const setupResult = await actions.getEquipmentSetup();
	if (!setupResult.success) throw new Error("Expected setup");
	const type = setupResult.data.types[0];
	await setup({
		kind: "archive_type",
		id: type.id,
		expectedRevision: type.revision,
	});
	expect(await issue(registered.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "archived" },
	});
	expect((await overview()).availableItems).toEqual([]);
});

it("preserves required agreements after default changes and permits receipt after type archival", async () => {
	const { registered, assignment } = await issued({ explicitDeadline: null });
	const setupResult = await actions.getEquipmentSetup();
	if (!setupResult.success) throw new Error("Expected setup");
	const type = setupResult.data.types[0];
	const changed = await setup({
		kind: "update_type",
		id: type.id,
		expectedRevision: type.revision,
		name: "Laptop",
		trackingMode: "individual",
		defaultReturnRequired: false,
	});
	expect(
		(await overview({ typeId: type.id, outstanding: true })).assignments,
	).toMatchObject([
		{ returnRequired: true, explicitDeadline: null, overdue: false },
	]);
	expect((await overview({ typeId: crypto.randomUUID() })).assignments).toEqual(
		[],
	);
	await setup({
		kind: "archive_type",
		id: type.id,
		expectedRevision: changed.revision,
	});
	expect(await receive(assignment.id)).toMatchObject({
		success: true,
		data: { ok: true },
	});
	expect(
		await issue(registered.id, {
			expectedRevision: 3,
			actualDate: "2026-11-05",
			explicitDeadline: null,
		}),
	).toMatchObject({ success: true, data: { ok: false, reason: "archived" } });
});

it("allows self-issuance but requires another authorized person to receive even an owner's equipment", async () => {
	const { assignment } = await issued({ employeeId: ownerId });
	expect((await overview()).assignments[0].canReceive).toBe(false);
	expect(await receive(assignment.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "self_receipt" },
	});
	session.userId = "t1537-holder";
	expect(await receive(assignment.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "forbidden" },
	});
	session.userId = "t1537-admin";
	expect(await receive(assignment.id)).toMatchObject({
		success: true,
		data: { ok: true },
	});
});

it("keeps employee and manager reads personal and denies direct staff mutations", async () => {
	const { registered, assignment } = await issued();
	for (const actor of ["t1537-holder", "t1537-manager"]) {
		session.userId = actor;
		expect(await actions.getEquipmentOverview()).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await actions.getEmployeeEquipment(ownerId)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await issue(registered.id)).toMatchObject({
			success: true,
			data: { ok: false, reason: "forbidden" },
		});
		expect(await receive(assignment.id)).toMatchObject({
			success: true,
			data: { ok: false, reason: "forbidden" },
		});
	}
	session.userId = "t1537-holder";
	expect(await actions.getMyEquipment()).toMatchObject({
		success: true,
		data: { assignments: [{ employeeId: holderId }] },
	});
	session.userId = "t1537-manager";
	expect(await actions.getMyEquipment()).toMatchObject({
		success: true,
		data: { assignments: [] },
	});
});

it("retains custody of issued-to-keep equipment until receipt and snapshots overrides independently of defaults", async () => {
	const { registered, assignment } = await issued({
		returnRequired: false,
		explicitDeadline: null,
	});
	const setupView = await actions.getEquipmentSetup();
	if (!setupView.success) throw new Error("Setup read failed");
	const type = setupView.data.types[0];
	await setup({
		kind: "update_type",
		id: type.id,
		expectedRevision: type.revision,
		name: "Laptop",
		trackingMode: "individual",
		defaultReturnRequired: true,
	});
	expect((await overview()).assignments[0]).toMatchObject({
		returnRequired: false,
		explicitDeadline: null,
		outstanding: false,
		overdue: false,
		held: true,
	});
	expect((await overview()).availableItems).toEqual([]);
	expect(await issue(registered.id, { expectedRevision: 2 })).toMatchObject({
		success: true,
		data: { ok: false, reason: "item_unavailable" },
	});
	expect(await receive(assignment.id)).toMatchObject({
		success: true,
		data: { ok: true },
	});
	expect(
		await issue(registered.id, {
			expectedRevision: 3,
			actualDate: "2026-11-05",
			explicitDeadline: null,
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	expect((await overview()).assignments).toHaveLength(2);
});

it("fulfills a damaged receipt without making the item ready to issue", async () => {
	const { registered, assignment } = await issued();
	expect(
		await receive(assignment.id, {
			condition: "damaged",
			notes: "Screen cracked",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	expect((await overview()).assignments[0]).toMatchObject({
		outstanding: false,
		held: false,
		receipt: { condition: "damaged", notes: "Screen cracked" },
	});
	expect((await overview()).availableItems).toEqual([]);
	expect(await issue(registered.id, { expectedRevision: 3 })).toMatchObject({
		success: true,
		data: { ok: false, reason: "item_unavailable" },
	});
});

it("has one holder and one receipt under simultaneous commands and actor-bound retries", async () => {
	const registered = await item();
	const requestId = crypto.randomUUID();
	const results = await Promise.all([
		issue(registered.id, { requestId }),
		issue(registered.id, { requestId }),
	]);
	expect(results.filter((r) => r.success && r.data.ok)).toHaveLength(2);
	const first = results[0];
	expect(results[1]).toEqual(first);
	expect((await overview()).assignments).toHaveLength(1);
	expect(
		await issue(registered.id, { requestId, notes: "Changed" }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "request_conflict" },
	});
	session.userId = "t1537-admin";
	expect(await issue(registered.id, { requestId })).toMatchObject({
		success: true,
		data: { ok: false, reason: "request_conflict" },
	});
	if (!first.success || !first.data.ok) throw new Error("Issue failed");
	const receiptRequest = crypto.randomUUID();
	const receipts = await Promise.all([
		receive(first.data.id, { requestId: receiptRequest }),
		receive(first.data.id, { requestId: receiptRequest }),
	]);
	expect(receipts[0]).toEqual(receipts[1]);
	expect(receipts.filter((r) => r.success && r.data.ok)).toHaveLength(2);
	expect((await overview()).assignments[0].revision).toBe(2);
	expect(await receive(first.data.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "stale_revision" },
	});
	expect(
		await receive(first.data.id, {
			requestId: receiptRequest,
			condition: "worn",
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "request_conflict" },
	});
});

it("serializes two distinct issuances of one item into exactly one holder", async () => {
	const registered = await item();
	const results = await Promise.all([
		issue(registered.id),
		issue(registered.id, { employeeId: ownerId }),
	]);
	expect(results.filter((r) => r.success && r.data.ok)).toHaveLength(1);
	expect(
		results.filter(
			(r) => r.success && !r.data.ok && r.data.reason === "stale_revision",
		),
	).toHaveLength(1);
	expect((await overview()).assignments).toHaveLength(1);
});

it("rejects invalid and conflicting dates in the organization zone, including reissue before the prior receipt", async () => {
	const registered = await item();
	for (const extra of [
		{ actualDate: "2026-02-30" },
		{ actualDate: "2026-1-2" },
		{ condition: "perfect" },
		{ returnRequired: false },
		{ notes: "a".repeat(4001) },
	])
		expect(await issue(registered.id, extra)).toMatchObject({
			success: true,
			data: { ok: false, reason: "invalid_input" },
		});
	expect(
		await issue(registered.id, {
			actualDate: "2026-11-06",
			explicitDeadline: null,
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "future_date" },
	});
	const result = await issue(registered.id, {
		actualDate: "2026-11-05",
		explicitDeadline: "2026-11-05",
	});
	expect(result).toMatchObject({ success: true, data: { ok: true } });
	if (!result.success || !result.data.ok) throw new Error("Issue failed");
	expect((await overview({ overdue: true })).assignments).toEqual([]);
	expect(
		await receive(result.data.id, { actualDate: "2026-11-04" }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "conflicting_history" },
	});
	expect(
		await receive(result.data.id, { actualDate: "2026-11-06" }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "future_date" },
	});
	expect((await overview()).assignments[0]).toMatchObject({
		held: true,
		outstanding: true,
		revision: 1,
		receipt: null,
	});
	expect(await receive(result.data.id)).toMatchObject({
		success: true,
		data: { ok: true },
	});
	expect(await issue(registered.id, { expectedRevision: 3 })).toMatchObject({
		success: true,
		data: { ok: false, reason: "conflicting_history" },
	});
});

it("keeps former holders discoverable for receipt but refuses new issuance and former actor access", async () => {
	const { registered, assignment } = await issued();
	await pool.query(
		"update employee set is_active=false where organization_id='t1537-org' and id=$1",
		[holderId],
	);
	expect(
		(await overview({ former: true, holderId, outstanding: true })).assignments,
	).toMatchObject([{ employeeId: holderId, former: true }]);
	expect((await overview({ former: false })).assignments).toEqual([]);
	expect(await issue(registered.id, { expectedRevision: 2 })).toMatchObject({
		success: true,
		data: { ok: false, reason: "employee_not_current" },
	});
	session.userId = "t1537-holder";
	expect(await actions.getMyEquipment()).toMatchObject({ success: false });
	session.userId = "t1537-admin";
	expect(await receive(assignment.id)).toMatchObject({
		success: true,
		data: { ok: true },
	});
	expect(await actions.getEmployeeEquipment(holderId)).toMatchObject({
		success: true,
		data: { assignments: [{ former: true, held: false }] },
	});
	await pool.query("update member set role='owner' where id='t1537-admin'");
	await pool.query(
		"update employee set is_active=false where organization_id='t1537-org' and id=$1",
		[ownerId],
	);
	session.userId = "t1537-owner";
	expect(await actions.getEquipmentOverview()).toMatchObject({
		success: false,
	});
	expect(await issue(registered.id)).toMatchObject({ success: false });
});

it("isolates foreign item, employee, assignment and filter identifiers even through direct action calls", async () => {
	const { registered, assignment } = await issued();
	session.organizationId = "t1537-other";
	session.userId = "t1537-foreign";
	expect((await overview()).assignments).toEqual([]);
	expect(await issue(registered.id)).toMatchObject({
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
	expect(
		(await overview({ holderId, typeId: crypto.randomUUID() })).assignments,
	).toEqual([]);
	session.userId = "t1537-owner";
	expect(await actions.getEquipmentOverview()).toMatchObject({
		success: false,
	});
});

it("rolls failed receipt evidence and custody back and lets the same command retry successfully", async () => {
	const { assignment } = await issued();
	const requestId = crypto.randomUUID();
	// A database failure after the evidence insert proves the entire command rolls back.
	await pool.query(`CREATE FUNCTION t1537_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.organization_id = 't1537-org' AND NEW.received THEN RAISE EXCEPTION 'simulated receipt write failure'; END IF;
    RETURN NEW; END $$;
    CREATE TRIGGER t1537_fail_receipt BEFORE UPDATE ON equipment_assignment FOR EACH ROW EXECUTE FUNCTION t1537_fail_receipt()`);
	try {
		expect(await receive(assignment.id, { requestId })).toMatchObject({
			success: false,
			code: "DatabaseError",
		});
		expect((await overview()).assignments[0]).toMatchObject({
			held: true,
			outstanding: true,
			receipt: null,
			revision: 1,
		});
	} finally {
		await pool.query(
			"DROP TRIGGER t1537_fail_receipt ON equipment_assignment; DROP FUNCTION t1537_fail_receipt()",
		);
	}
	expect(await receive(assignment.id, { requestId })).toMatchObject({
		success: true,
		data: { ok: true, revision: 2 },
	});
});

it("serializes issuance with the real departure boundary and refuses fresh issuance after the live cutoff", async () => {
	const registered = await item();
	const { db } = await import("@/db");
	const { createDepartureCommands } = await import(
		"@/lib/employee-lifecycle/commands"
	);
	const { createDepartureClockOut } = await import(
		"@/lib/employee-lifecycle/clock-out"
	);
	const { parseInstant } = await import("@/lib/datetime/temporal-core");
	await pool.query(
		"insert into employee_employment_period(id,organization_id,employee_id,status,started_at,start_provenance) values('15370000-0000-4000-8000-000000000100','t1537-org',$1,'open','2026-01-01Z','recorded')",
		[holderId],
	);
	const commands = createDepartureCommands({
		db,
		clock: { nowInstant: () => parseInstant(clock.now) },
		clockOut: createDepartureClockOut(),
	});
	const actor = { userId: "t1537-owner", organizationId: "t1537-org" };
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
	const targetId = "15370000-0000-4000-8000-000000000003";
	await pool.query(
		"insert into employee_employment_period(id,organization_id,employee_id,status,started_at,start_provenance) values('15370000-0000-4000-8000-000000000101','t1537-org',$1,'open','2026-01-01Z','recorded')",
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
