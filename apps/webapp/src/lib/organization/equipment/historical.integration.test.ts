import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const session = vi.hoisted(() => ({
	userId: "t1543-owner",
	organizationId: "t1543-org",
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
const holderId = "15430000-0000-4000-8000-000000000001";
const ownerId = "15430000-0000-4000-8000-000000000002";
async function clean() {
	await pool.query("delete from organization where id like 't1543-%'");
	await pool.query('delete from "user" where id like $1', ["t1543-%"]);
}
beforeAll(async () => {
	await clean();
	for (const org of ["t1543-org", "t1543-other"])
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
			[`t1543-${name}`, `${name}@t1543.example.test`],
		);
		await pool.query(
			"insert into member(id,user_id,organization_id,role,status,created_at) values($1,$1,$2,$3,'approved',now())",
			[`t1543-${name}`, `t1543-${org}`, role],
		);
	}
	for (const [id, name, role] of [
		[holderId, "holder", "employee"],
		[ownerId, "owner", "employee"],
		["15430000-0000-4000-8000-000000000003", "manager", "manager"],
	])
		await pool.query(
			"insert into employee(id,user_id,organization_id,role,is_active,updated_at) values($1,$2,'t1543-org',$3,true,now())",
			[id, `t1543-${name}`, role],
		);
});
afterAll(clean);
beforeEach(async () => {
	session.userId = "t1543-owner";
	session.organizationId = "t1543-org";
	clock.now = "2026-11-04T23:30:00Z";
	await pool.query(
		"delete from equipment_assignment where organization_id='t1543-org'",
	);
	await pool.query(
		"delete from equipment_command where organization_id='t1543-org'",
	);
	await pool.query(
		"delete from equipment_setup_command where organization_id='t1543-org'",
	);
	await pool.query(
		"delete from equipment_officer_grant where organization_id='t1543-org'",
	);
	await pool.query(
		"delete from equipment_former_team_scope where organization_id='t1543-org'",
	);
	await pool.query(
		"delete from equipment_exception where organization_id='t1543-org'",
	);
	await pool.query(
		"delete from employee_employment_period where organization_id='t1543-org'",
	);
	await pool.query(
		"delete from equipment_item where organization_id='t1543-org'",
	);
	await pool.query(
		"delete from equipment_type where organization_id='t1543-org'",
	);
	await pool.query(
		"delete from equipment_policy where organization_id='t1543-org'",
	);
	await pool.query(
		"update employee set is_active=true, deactivated_at=null where organization_id='t1543-org'",
	);
	await pool.query("update member set role='admin' where id='t1543-admin'");
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
it("records unknown historical quantity holdings without inventing an issue date and keeps UTC entry evidence", async () => {
	const type = await quantityType();
	const result = await issue(type.id);
	expect(result).toMatchObject({
		success: true,
		data: { ok: true, revision: 1 },
	});
	expect((await overview()).assignments).toMatchObject([
		{
			trackingMode: "quantity",
			quantity: 3,
			outstandingQuantity: 3,
			outstanding: true,
			issue: {
				actualDate: null,
				historical: true,
				condition: "good",
				actorId: "t1543-owner",
				recordedAt: "2026-11-04T23:30:00Z",
			},
		},
	]);
});

it("links a known former holding to its original employment period while refusing fresh issuance", async () => {
	const type = await quantityType();
	const periodId = "15430000-0000-4000-8000-000000000011";
	await pool.query(
		"insert into employee_employment_period(id,organization_id,employee_id,status,started_at,ended_at,start_provenance) values($1,'t1543-org',$2,'closed','2026-01-01T00:00Z','2026-10-01T16:00Z','recorded')",
		[periodId, holderId],
	);
	await pool.query("update employee set is_active=false where id=$1", [
		holderId,
	]);
	expect(
		await issue(type.id, { kind: "issue_quantity", actualDate: "2026-09-20" }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "employee_not_current" },
	});
	expect(await issue(type.id, { actualDate: "2026-09-20" })).toMatchObject({
		success: true,
		data: { ok: true },
	});
	expect((await overview({ former: true })).assignments).toMatchObject([
		{
			employmentPeriodId: periodId,
			former: true,
			outstandingQuantity: 3,
			issue: {
				actualDate: "2026-09-20",
				historical: true,
				recordedAt: "2026-11-04T23:30:00Z",
			},
		},
	]);
});

async function individual() {
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
	const item = await setup({
		kind: "register_item",
		typeId: type.id,
		identifier: "HIST-01",
	});
	return { type, item };
}
function individualCommand(
	itemId: string,
	extra: Record<string, unknown> = {},
) {
	return {
		kind: "record_historical_individual",
		itemId,
		employeeId: holderId,
		requestId: crypto.randomUUID(),
		expectedRevision: 1,
		actualDate: null,
		condition: "unknown",
		returnRequired: true,
		...extra,
	};
}
it("replays concurrent historical commands once, binds actor and payload, and preserves independent return terms", async () => {
	const type = await quantityType();
	const requestId = crypto.randomUUID();
	const results = await Promise.all([
		issue(type.id, { requestId }),
		issue(type.id, { requestId }),
	]);
	expect(results[0]).toEqual(results[1]);
	expect(results[0]).toMatchObject({ success: true, data: { ok: true } });
	expect((await overview()).assignments).toHaveLength(1);
	expect(await issue(type.id, { requestId, quantity: 4 })).toMatchObject({
		success: true,
		data: { ok: false, reason: "request_conflict" },
	});
	session.userId = "t1543-admin";
	expect(await issue(type.id, { requestId })).toMatchObject({
		success: true,
		data: { ok: false, reason: "request_conflict" },
	});
	expect(
		await issue(type.id, {
			returnRequired: false,
			explicitDeadline: null,
			actualDate: "2026-08-01",
			expectedRevision: 2,
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	const kept = (await overview()).assignments.find((a) => !a.returnRequired);
	expect(kept).toMatchObject({
		held: true,
		outstandingQuantity: 0,
		overdue: false,
		explicitDeadline: null,
		issue: { historical: true, actualDate: "2026-08-01" },
	});
	expect(await issue(type.id, { returnRequired: false })).toMatchObject({
		success: true,
		data: { ok: false, reason: "invalid_input" },
	});
});
it("serializes individual historical custody and refuses both dated overlap and unknown chronology after a recorded receipt", async () => {
	const { item } = await individual();
	const first = await actions.changeEquipment(individualCommand(item.id));
	expect(first).toMatchObject({ success: true, data: { ok: true } });
	if (!first.success || !first.data.ok) throw new Error(JSON.stringify(first));
	expect(
		await actions.changeEquipment(
			individualCommand(item.id, {
				expectedRevision: 2,
				actualDate: "2026-10-01",
			}),
		),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "item_unavailable" },
	});
	expect(
		await actions.changeEquipment({
			kind: "receive_individual",
			assignmentId: first.data.id,
			requestId: crypto.randomUUID(),
			expectedRevision: 1,
			actualDate: "2026-11-03",
			condition: "good",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	for (const actualDate of ["2026-11-02", null])
		expect(
			await actions.changeEquipment(
				individualCommand(item.id, { expectedRevision: 3, actualDate }),
			),
		).toMatchObject({
			success: true,
			data: { ok: false, reason: "conflicting_history" },
		});
	expect(
		await actions.changeEquipment(
			individualCommand(item.id, {
				expectedRevision: 3,
				actualDate: "2026-11-04",
			}),
		),
	).toMatchObject({ success: true, data: { ok: true } });
	const history = (await overview()).assignments;
	expect(history).toHaveLength(2);
	expect(history.filter((a) => a.held)).toHaveLength(1);
	expect(history.find((a) => !a.held)).toMatchObject({
		issue: { actualDate: null },
		receipt: { actualDate: "2026-11-03" },
		outstandingQuantity: 0,
	});
});
it("requires explicit historical unknowns and real fresh handover dates, using the organization calendar for future refusal", async () => {
	const type = await quantityType();
	for (const extra of [
		{ actualDate: undefined },
		{ kind: "issue_quantity", actualDate: null },
		{ kind: "issue_quantity", actualDate: undefined },
	])
		expect(await issue(type.id, extra)).toMatchObject({
			success: true,
			data: { ok: false, reason: "invalid_input" },
		});
	expect(await issue(type.id, { actualDate: "2026-11-06" })).toMatchObject({
		success: true,
		data: { ok: false, reason: "future_date" },
	});
	expect(
		await issue(type.id, {
			actualDate: "2026-11-05",
			explicitDeadline: "2026-11-06",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	expect((await overview()).assignments[0].issue).toMatchObject({
		actualDate: "2026-11-05",
		recordedAt: "2026-11-04T23:30:00Z",
	});
});
it("refuses arbitrary former people outside live officer scope and refuses replay after scope revocation", async () => {
	const type = await quantityType();
	await pool.query("update employee set is_active=false where id=$1", [
		holderId,
	]);
	await actions.changeEquipmentOfficerGrant({
		kind: "set_officer_grant",
		requestId: crypto.randomUUID(),
		employeeId: "15430000-0000-4000-8000-000000000003",
		expectedRevision: 0,
		scope: "selected",
		teamIds: [],
		employeeIds: [ownerId],
	});
	session.userId = "t1543-manager";
	expect((await overview()).employees.map((e) => e.id)).toEqual([ownerId]);
	expect(await issue(type.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "forbidden" },
	});
	expect(await actions.getEmployeeEquipment(holderId)).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
	session.userId = "t1543-owner";
	await actions.changeEquipmentOfficerGrant({
		kind: "set_officer_grant",
		requestId: crypto.randomUUID(),
		employeeId: "15430000-0000-4000-8000-000000000003",
		expectedRevision: 1,
		scope: "selected",
		teamIds: [],
		employeeIds: [holderId],
	});
	session.userId = "t1543-manager";
	const requestId = crypto.randomUUID();
	expect(await issue(type.id, { requestId })).toMatchObject({
		success: true,
		data: { ok: true },
	});
	expect((await overview()).employees).toMatchObject([
		{ id: holderId, former: true },
	]);
	session.userId = "t1543-owner";
	await actions.changeEquipmentOfficerGrant({
		kind: "revoke_officer_grant",
		requestId: crypto.randomUUID(),
		employeeId: "15430000-0000-4000-8000-000000000003",
		expectedRevision: 2,
	});
	session.userId = "t1543-manager";
	expect(await issue(type.id, { requestId })).toMatchObject({
		success: true,
		data: { ok: false, reason: "forbidden" },
	});
});
it("never lets historical entry cross organizations or expose foreign lineage choices", async () => {
	const type = await quantityType();
	session.organizationId = "t1543-other";
	session.userId = "t1543-foreign";
	const foreignType = await actions.changeEquipmentSetup({
		kind: "create_type",
		name: "Foreign",
		trackingMode: "quantity",
		defaultReturnRequired: true,
		requestId: crypto.randomUUID(),
	});
	expect(foreignType).toMatchObject({ success: true, data: { ok: true } });
	session.organizationId = "t1543-org";
	session.userId = "t1543-owner";
	if (!foreignType.success || !foreignType.data.ok)
		throw new Error(JSON.stringify(foreignType));
	expect(await issue(foreignType.data.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "not_found" },
	});
	expect(
		await issue(type.id, { employeeId: crypto.randomUUID() }),
	).toMatchObject({ success: true, data: { ok: false, reason: "not_found" } });
	expect(
		await issue(type.id, { employmentPeriodId: crypto.randomUUID() }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "conflicting_history" },
	});
	session.organizationId = "t1543-other";
	session.userId = "t1543-foreign";
	expect((await overview()).assignments).toEqual([]);
	expect(await issue(type.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "not_found" },
	});
});
it("keeps self-receipt and exception accounting intact for unknown historical holdings", async () => {
	const type = await quantityType();
	const own = await issue(type.id, { employeeId: ownerId });
	if (!own.success || !own.data.ok) throw new Error(JSON.stringify(own));
	expect(await receive(own.data.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "self_receipt" },
	});
	expect(
		await actions.changeEquipment({
			kind: "close_return",
			requestId: crypto.randomUUID(),
			assignmentId: own.data.id,
			expectedRevision: 1,
			quantity: 1,
			outcome: "lost",
			reason: "Missing",
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "self_exception" },
	});
	const holding = await issue(type.id, { expectedRevision: 2 });
	if (!holding.success || !holding.data.ok)
		throw new Error(JSON.stringify(holding));
	expect(await receive(holding.data.id)).toMatchObject({
		success: true,
		data: { ok: true },
	});
	expect(
		await actions.changeEquipment({
			kind: "close_return",
			requestId: crypto.randomUUID(),
			assignmentId: holding.data.id,
			expectedRevision: 2,
			quantity: 1,
			outcome: "lost",
			reason: "Missing shirt",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	let assignment = (await overview()).assignments.find(
		(a) => a.id === holding.data.id,
	);
	expect(assignment).toMatchObject({
		physicallyReceivedQuantity: 2,
		lostQuantity: 1,
		outstandingQuantity: 0,
		held: true,
	});
	expect(
		await actions.changeEquipment({
			kind: "receive_exception",
			requestId: crypto.randomUUID(),
			assignmentId: holding.data.id,
			exceptionId: assignment?.exceptions?.[0].id,
			expectedRevision: 3,
			quantity: 1,
			actualDate: "2026-11-05",
			condition: "worn",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	assignment = (await overview()).assignments.find(
		(a) => a.id === holding.data.id,
	);
	expect(assignment).toMatchObject({
		physicallyReceivedQuantity: 3,
		lostQuantity: 1,
		recoveredQuantity: 1,
		outstandingQuantity: 0,
		held: false,
		issue: { actualDate: null },
	});
});

it("keeps rehire lineage explicit when the historical date is unknown and validates selected periods", async () => {
	const type = await quantityType();
	const original = "15430000-0000-4000-8000-000000000011";
	const rehire = "15430000-0000-4000-8000-000000000012";
	await pool.query(
		"insert into employee_employment_period(id,organization_id,employee_id,status,started_at,ended_at,start_provenance) values($1,'t1543-org',$3,'closed','2026-01-01T00:00Z','2026-09-01T16:00Z','recorded'),($2,'t1543-org',$3,'open','2026-10-01T00:00Z',null,'recorded')",
		[original, rehire, holderId],
	);
	expect((await overview()).employmentPeriods?.map((p) => p.id).sort()).toEqual(
		[original, rehire],
	);
	expect(await issue(type.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "conflicting_history" },
	});
	expect(
		await issue(type.id, {
			employmentPeriodId: rehire,
			actualDate: "2026-08-01",
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "conflicting_history" },
	});
	expect(await issue(type.id, { employmentPeriodId: original })).toMatchObject({
		success: true,
		data: { ok: true },
	});
	expect((await overview()).assignments).toMatchObject([
		{ employmentPeriodId: original, issue: { actualDate: null } },
	]);
});
it("registers historical identity atomically for former subjects and retains policy, type and identity rules", async () => {
	const { type } = await individual();
	await pool.query("update employee set is_active=false where id=$1", [
		holderId,
	]);
	const command = {
		kind: "register_historical_individual",
		typeId: type.id,
		employeeId: holderId,
		identifier: "HIST-NEW",
		expectedRevision: 0,
		requestId: crypto.randomUUID(),
		actualDate: null,
		condition: "unknown",
		returnRequired: true,
	};
	const created = await actions.changeEquipment(command);
	expect(created).toMatchObject({ success: true, data: { ok: true } });
	expect(await actions.changeEquipment(command)).toEqual(created);
	expect(
		await actions.changeEquipment({
			...command,
			requestId: crypto.randomUUID(),
			identifier: " hist-new ",
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "identifier_taken" },
	});
	const setupView = await actions.getEquipmentSetup();
	if (!setupView.success) throw new Error(JSON.stringify(setupView));
	const currentType = setupView.data.types.find((t) => t.id === type.id);
	await setup({
		kind: "archive_type",
		id: type.id,
		expectedRevision: currentType?.revision,
	});
	expect(
		await actions.changeEquipment({
			...command,
			requestId: crypto.randomUUID(),
			identifier: "ANOTHER",
		}),
	).toMatchObject({ success: true, data: { ok: false, reason: "archived" } });
	const row = (await overview()).assignments[0];
	expect(row).toMatchObject({
		identifier: "HIST-NEW",
		former: true,
		outstandingQuantity: 1,
		issue: { actualDate: null, condition: "unknown" },
	});
});

it("refuses a known historical date after an employment period ended at organization-local midnight", async () => {
	const type = await quantityType();
	await pool.query(
		"insert into employee_employment_period(id,organization_id,employee_id,status,started_at,ended_at,start_provenance) values($1,'t1543-org',$2,'closed','2026-01-01T00:00Z','2026-10-31T23:00Z','recorded')",
		["15430000-0000-4000-8000-000000000011", holderId],
	);
	await pool.query("update employee set is_active=false where id=$1", [
		holderId,
	]);
	expect(await issue(type.id, { actualDate: "2026-11-01" })).toMatchObject({
		success: true,
		data: { ok: false, reason: "conflicting_history" },
	});
	expect(await issue(type.id, { actualDate: "2026-10-31" })).toMatchObject({
		success: true,
		data: { ok: true },
	});
});

it("uses recorded original deactivation timezone for historical return deadlines after the organization zone changed", async () => {
	const type = await quantityType();
	const period = "15430000-0000-4000-8000-000000000011";
	await pool.query(
		"insert into employee_employment_period(id,organization_id,employee_id,status,started_at,ended_at,start_provenance) values($1,'t1543-org',$2,'closed','2026-01-01T00:00Z','2026-10-30T22:30Z','recorded')",
		[period, holderId],
	);
	await pool.query(
		"insert into employee_deactivation(organization_id,employee_id,employment_period_id,deactivated_at,created_by,reason,request_id,request_fingerprint,plan) values('t1543-org',$1,$2,'2026-10-30T22:30Z','t1543-owner','employee_deactivated',$3,'historical-fixture',$4)",
		[
			holderId,
			period,
			crypto.randomUUID(),
			JSON.stringify({ timeZone: "Pacific/Auckland" }),
		],
	);
	await pool.query(
		"update employee set is_active=false, deactivated_at='2026-10-30T22:30Z' where id=$1",
		[holderId],
	);
	expect(await issue(type.id, { explicitDeadline: null })).toMatchObject({
		success: true,
		data: { ok: true },
	});
	expect((await overview()).assignments).toMatchObject([
		{
			employmentPeriodId: period,
			departureId: null,
			departureDeadline: "2026-10-31",
			effectiveDeadline: "2026-10-31",
			issue: { actualDate: null },
		},
	]);
});
