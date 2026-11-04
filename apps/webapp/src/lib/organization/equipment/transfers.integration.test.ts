import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const session = vi.hoisted(() => ({
	userId: "t1542-owner",
	organizationId: "t1542-org",
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
const holderId = "15420000-0000-4000-8000-000000000001";
const ownerId = "15420000-0000-4000-8000-000000000002";
async function clean() {
	await pool.query("delete from organization where id like 't1542-%'");
	await pool.query('delete from "user" where id like $1', ["t1542-%"]);
}
beforeAll(async () => {
	await clean();
	for (const org of ["t1542-org", "t1542-other"])
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
			[`t1542-${name}`, `${name}@t1542.example.test`],
		);
		await pool.query(
			"insert into member(id,user_id,organization_id,role,status,created_at) values($1,$1,$2,$3,'approved',now())",
			[`t1542-${name}`, `t1542-${org}`, role],
		);
	}
	for (const [id, name, role] of [
		[holderId, "holder", "employee"],
		[ownerId, "owner", "employee"],
		["15420000-0000-4000-8000-000000000003", "manager", "manager"],
	])
		await pool.query(
			"insert into employee(id,user_id,organization_id,role,is_active,updated_at) values($1,$2,'t1542-org',$3,true,now())",
			[id, `t1542-${name}`, role],
		);
});
afterAll(clean);
beforeEach(async () => {
	session.userId = "t1542-owner";
	session.organizationId = "t1542-org";
	clock.now = "2026-11-04T23:30:00Z";
	await pool.query(
		"delete from equipment_assignment where organization_id='t1542-org'",
	);
	await pool.query(
		"delete from equipment_command where organization_id='t1542-org'",
	);
	await pool.query(
		"delete from equipment_setup_command where organization_id='t1542-org'",
	);
	await pool.query(
		"delete from equipment_item where organization_id='t1542-org'",
	);
	await pool.query(
		"delete from equipment_type where organization_id='t1542-org'",
	);
	await pool.query(
		"delete from equipment_policy where organization_id='t1542-org'",
	);
	await pool.query(
		"update employee set is_active=true where organization_id='t1542-org'",
	);
	await pool.query("update member set role='admin' where id='t1542-admin'");
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

async function transferCommand(
	assignmentId: string,
	extra: Record<string, unknown> = {},
) {
	const current = await overview();
	const source = current.assignments.find(
		(assignment) => assignment.id === assignmentId,
	);
	if (!source) throw new Error("Missing source assignment");
	return {
		kind: "transfer_equipment",
		requestId: crypto.randomUUID(),
		assignmentId,
		expectedRevision: source.revision,
		expectedIssuanceRevision: source.itemId
			? current.readinessItems.find((item) => item.id === source.itemId)
					?.revision
			: current.availableQuantityTypes.find((type) => type.id === source.typeId)
					?.revision,
		employeeId: ownerId,
		quantity: 1,
		receipt: {
			actualDate: "2026-11-03",
			condition: "worn",
			notes: "Received from holder",
		},
		issue: {
			actualDate: "2026-11-04",
			condition: "good",
			notes: "Checked before issuance",
			returnRequired: false,
			explicitDeadline: null,
		},
		...extra,
	};
}
async function quantityAssignment() {
	const type = await quantityType();
	const issued = await issue(type.id);
	if (!issued.success || !issued.data.ok)
		throw new Error(JSON.stringify(issued));
	return issued.data.id;
}
async function individualAssignment() {
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
		identifier: "TRANSFER-L01",
	});
	const issued = await actions.changeEquipment({
		kind: "issue_individual",
		requestId: crypto.randomUUID(),
		itemId: item.id,
		employeeId: holderId,
		expectedRevision: 1,
		actualDate: "2026-11-02",
		condition: "good",
		returnRequired: true,
	});
	if (!issued.success || !issued.data.ok)
		throw new Error(JSON.stringify(issued));
	return { assignmentId: issued.data.id, itemId: item.id };
}

it("transfers two of three shirts through independent receipt and new issuance with new return terms", async () => {
	const type = await quantityType();
	const issued = await issue(type.id);
	if (!issued.success || !issued.data.ok)
		throw new Error(JSON.stringify(issued));
	const command = {
		kind: "transfer_equipment",
		requestId: crypto.randomUUID(),
		assignmentId: issued.data.id,
		expectedRevision: 1,
		expectedIssuanceRevision: (await overview()).availableQuantityTypes[0]
			.revision,
		employeeId: ownerId,
		quantity: 2,
		receipt: {
			actualDate: "2026-11-03",
			condition: "worn",
			notes: "Received from holder",
		},
		issue: {
			actualDate: "2026-11-04",
			condition: "good",
			notes: "Checked before issuance",
			returnRequired: false,
			explicitDeadline: null,
		},
	};
	const transferred = await actions.changeEquipment(command);
	expect(transferred).toMatchObject({
		success: true,
		data: { ok: true, revision: 1 },
	});
	if (!transferred.success || !transferred.data.ok)
		throw new Error(JSON.stringify(transferred));
	expect(transferred.data.id).not.toBe(issued.data.id);
	expect(await actions.getEmployeeEquipment(holderId)).toMatchObject({
		success: true,
		data: {
			assignments: [
				{
					employeeId: holderId,
					quantity: 3,
					physicallyReceivedQuantity: 2,
					outstandingQuantity: 1,
					receipts: [
						{
							quantity: 2,
							condition: "worn",
							notes: "Received from holder",
							actualDate: "2026-11-03",
							actorName: "t1542-owner",
						},
					],
				},
			],
		},
	});
	expect(await actions.getMyEquipment()).toMatchObject({
		success: true,
		data: {
			assignments: [
				{
					id: transferred.data.id,
					employeeId: ownerId,
					quantity: 2,
					returnRequired: false,
					explicitDeadline: null,
					outstandingQuantity: 0,
					issue: {
						quantity: 2,
						condition: "good",
						notes: "Checked before issuance",
						actualDate: "2026-11-04",
						actorName: "t1542-owner",
						recordedAt: "2026-11-04T23:30:00Z",
					},
					receipts: [],
				},
			],
		},
	});
	// The unchanged actor-bound command replays both handovers, not either leg.
	expect(await actions.changeEquipment(command)).toEqual(transferred);
	expect((await overview()).assignments).toHaveLength(2);
});

it("refuses issuance before the combined receipt for quantities without changing either history", async () => {
	const id = await quantityAssignment();
	const command = await transferCommand(id, {
		issue: {
			actualDate: "2026-11-02",
			condition: "good",
			returnRequired: true,
		},
	});
	expect(await actions.changeEquipment(command)).toMatchObject({
		success: true,
		data: { ok: false, reason: "conflicting_history" },
	});
	expect((await overview()).assignments).toMatchObject([
		{ id, physicallyReceivedQuantity: 0, receipts: [], revision: 1 },
	]);
	expect((await overview()).assignments).toHaveLength(1);
});

it("offers an authorized transfer and preserves an individual item's two employee histories with one holder", async () => {
	const { assignmentId, itemId } = await individualAssignment();
	expect((await overview()).assignments[0]).toMatchObject({
		transfer: { expectedIssuanceRevision: 2, defaultReturnRequired: true },
	});
	const result = await actions.changeEquipment(
		await transferCommand(assignmentId),
	);
	expect(result).toMatchObject({ success: true, data: { ok: true } });
	const current = await overview();
	expect(current.assignments.filter((a) => a.held)).toMatchObject([
		{ employeeId: ownerId, itemId, quantity: 1, receipts: [] },
	]);
	expect(current.assignments.find((a) => a.id === assignmentId)).toMatchObject({
		employeeId: holderId,
		held: false,
		physicallyReceivedQuantity: 1,
		receipt: { condition: "worn" },
	});
	expect(
		current.assignments.find((a) => a.employeeId === ownerId),
	).toMatchObject({ issue: { condition: "good" }, returnRequired: false });
});

it.each([0, -1, 1.5, 4])(
	"refuses quantity %s without changing the source or creating a target assignment",
	async (quantity) => {
		const id = await quantityAssignment();
		expect(
			await actions.changeEquipment(await transferCommand(id, { quantity })),
		).toMatchObject({
			success: true,
			data: {
				ok: false,
				reason: quantity === 4 ? "excess_quantity" : "invalid_input",
			},
		});
		expect((await overview()).assignments).toMatchObject([
			{ id, physicallyReceivedQuantity: 0, receipts: [], revision: 1 },
		]);
		expect((await overview()).assignments).toHaveLength(1);
	},
);

it("rolls back source receipt on invalid target references, employment, dates and terms", async () => {
	const id = await quantityAssignment();
	for (const extra of [
		{ employeeId: "15420000-0000-4000-8000-000000000099" },
		{
			issue: {
				actualDate: "2026-11-06",
				condition: "good",
				returnRequired: true,
			},
		},
		{
			issue: {
				actualDate: "2026-11-04",
				condition: "good",
				returnRequired: false,
				explicitDeadline: "2026-11-05",
			},
		},
		{
			issue: {
				actualDate: "2026-11-04",
				condition: "good",
				returnRequired: true,
				explicitDeadline: "2026-11-03",
			},
		},
	]) {
		expect(
			await actions.changeEquipment(await transferCommand(id, extra)),
		).toMatchObject({ success: true, data: { ok: false } });
		expect((await overview()).assignments).toMatchObject([
			{ id, physicallyReceivedQuantity: 0, receipts: [], revision: 1 },
		]);
		expect((await overview()).assignments).toHaveLength(1);
	}
	const command = await transferCommand(id);
	await pool.query("update member set role='owner' where id='t1542-admin'");
	await pool.query("update employee set is_active=false where id=$1", [
		ownerId,
	]);
	// An admin can receive, but cannot freshly issue to a former owner employee.
	session.userId = "t1542-admin";
	expect(await actions.changeEquipment(command)).toMatchObject({
		success: true,
		data: { ok: false, reason: "employee_not_current" },
	});
	expect((await overview()).assignments).toHaveLength(1);
	expect((await overview()).assignments[0].receipts).toEqual([]);
	await pool.query("update employee set is_active=true where id=$1", [ownerId]);
	expect(await actions.changeEquipment(command)).toMatchObject({
		success: true,
		data: { ok: true },
	});
});

it("requires another staff receiver for their own source even when self issuance is permitted", async () => {
	const type = await quantityType();
	const issued = await issue(type.id, { employeeId: ownerId });
	if (!issued.success || !issued.data.ok)
		throw new Error(JSON.stringify(issued));
	const command = await transferCommand(issued.data.id, {
		employeeId: holderId,
	});
	expect(await actions.changeEquipment(command)).toMatchObject({
		success: true,
		data: { ok: false, reason: "self_receipt" },
	});
	expect((await overview()).assignments[0]).toMatchObject({
		revision: 1,
		receipts: [],
	});
	session.userId = "t1542-admin";
	expect(await actions.changeEquipment(command)).toMatchObject({
		success: true,
		data: { ok: true },
	});
});

it.each(["mark_item_unavailable", "retire_item"])(
	"never releases custody when %s blocks the target issuance",
	async (kind) => {
		const { assignmentId, itemId } = await individualAssignment();
		await actions.changeEquipment({
			kind,
			itemId,
			expectedRevision: 2,
			requestId: crypto.randomUUID(),
		});
		const command = await transferCommand(assignmentId);
		expect(await actions.changeEquipment(command)).toMatchObject({
			success: true,
			data: { ok: false, reason: "item_unavailable" },
		});
		const current = await overview();
		expect(current.assignments).toHaveLength(1);
		expect(current.assignments[0]).toMatchObject({
			held: true,
			receipts: [],
			transfer: undefined,
		});
		expect(current.readinessItems[0]).toMatchObject({ inCustody: true });
	},
);

it("refuses a damaged combined receipt without implicit clearance or rewritten evidence", async () => {
	const { assignmentId, itemId } = await individualAssignment();
	const command = await transferCommand(assignmentId, {
		receipt: {
			actualDate: "2026-11-03",
			condition: "damaged",
			notes: "Cracked case",
		},
	});
	expect(await actions.changeEquipment(command)).toMatchObject({
		success: true,
		data: { ok: false, reason: "item_unavailable" },
	});
	expect((await overview()).assignments).toMatchObject([
		{ id: assignmentId, held: true, receipts: [] },
	]);
	expect(
		await actions.changeEquipment({
			kind: "receive_individual",
			requestId: crypto.randomUUID(),
			assignmentId,
			expectedRevision: 1,
			...command.receipt,
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	expect((await overview()).readinessItems[0]).toMatchObject({
		status: "unavailable",
		inCustody: false,
		history: [],
	});
	expect(
		await actions.changeEquipment({
			kind: "clear_item",
			requestId: crypto.randomUUID(),
			itemId,
			expectedRevision: 3,
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	expect((await overview()).assignments[0].receipt).toMatchObject({
		condition: "damaged",
		notes: "Cracked case",
	});
});

it("serializes a competing partial receipt and transfer without oversettling or leaving half a transfer", async () => {
	const id = await quantityAssignment();
	const command = await transferCommand(id, { quantity: 2 });
	const results = await Promise.all([
		actions.changeEquipment(command),
		receive(id),
	]);
	expect(results.filter((r) => r.success && r.data.ok)).toHaveLength(1);
	expect(
		results.filter(
			(r) => r.success && !r.data.ok && r.data.reason === "stale_revision",
		),
	).toHaveLength(1);
	const current = await overview();
	expect(current.assignments.find((a) => a.id === id)).toMatchObject({
		physicallyReceivedQuantity: 2,
		outstandingQuantity: 1,
		receipts: [{ quantity: 2 }],
		revision: 2,
	});
	expect(current.assignments.filter((a) => a.id !== id)).toHaveLength(
		results[0].success && results[0].data.ok ? 1 : 0,
	);
});

it("serializes individual transfers and concurrent retries into exactly one new holder", async () => {
	const { assignmentId } = await individualAssignment();
	const command = await transferCommand(assignmentId);
	const replay = await Promise.all([
		actions.changeEquipment(command),
		actions.changeEquipment(command),
	]);
	expect(replay[0]).toMatchObject({ success: true, data: { ok: true } });
	expect(replay[1]).toEqual(replay[0]);
	expect(
		await actions.changeEquipment({
			...command,
			requestId: crypto.randomUUID(),
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "stale_revision" },
	});
	const current = await overview();
	expect(current.assignments).toHaveLength(2);
	expect(current.assignments.filter((a) => a.held)).toHaveLength(1);
	expect(
		current.assignments.find((a) => a.id === assignmentId)?.receipts,
	).toHaveLength(1);
});

it("rechecks actor authority and binds replay to actor and payload in the active organization", async () => {
	const id = await quantityAssignment();
	const command = await transferCommand(id);
	for (const name of ["holder", "manager"]) {
		session.userId = `t1542-${name}`;
		expect(await actions.changeEquipment(command)).toMatchObject({
			success: true,
			data: { ok: false, reason: "forbidden" },
		});
	}
	session.userId = "t1542-owner";
	expect(await actions.changeEquipment(command)).toMatchObject({
		success: true,
		data: { ok: true },
	});
	expect(
		await actions.changeEquipment({ ...command, quantity: 2 }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "request_conflict" },
	});
	session.userId = "t1542-admin";
	expect(await actions.changeEquipment(command)).toMatchObject({
		success: true,
		data: { ok: false, reason: "request_conflict" },
	});
	await pool.query("update member set role='owner' where id='t1542-admin'");
	await pool.query("update member set role='member' where id='t1542-owner'");
	session.userId = "t1542-owner";
	expect(await actions.changeEquipment(command)).toMatchObject({
		success: true,
		data: { ok: false, reason: "forbidden" },
	});
	await pool.query("update member set role='owner' where id='t1542-owner'");
	session.userId = "t1542-foreign";
	session.organizationId = "t1542-other";
	expect(await actions.changeEquipment(command)).toMatchObject({
		success: true,
		data: { ok: false, reason: "not_found" },
	});
});

it("rolls back receipt and request identity on a target database failure so the unchanged command can retry", async () => {
	const id = await quantityAssignment();
	const command = await transferCommand(id);
	await pool.query(`create or replace function t1542_fail_transfer() returns trigger language plpgsql as $$ begin
		if new.organization_id='t1542-org' and new.employee_id='15420000-0000-4000-8000-000000000002' then raise exception 'target failure'; end if;
		return new; end $$`);
	await pool.query(
		"create trigger t1542_fail_transfer before insert on equipment_assignment for each row execute function t1542_fail_transfer()",
	);
	try {
		expect(await actions.changeEquipment(command)).toMatchObject({
			success: false,
			code: "DatabaseError",
		});
		expect((await overview()).assignments).toMatchObject([
			{ id, held: true, revision: 1, receipts: [] },
		]);
		expect((await overview()).assignments).toHaveLength(1);
	} finally {
		await pool.query(
			"drop trigger t1542_fail_transfer on equipment_assignment",
		);
		await pool.query("drop function t1542_fail_transfer()");
	}
	expect(await actions.changeEquipment(command)).toMatchObject({
		success: true,
		data: { ok: true },
	});
	expect((await overview()).assignments).toHaveLength(2);
});
