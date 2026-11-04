import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const session = vi.hoisted(() => ({
	userId: "t1540-owner",
	organizationId: "t1540-org",
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
const holderId = "15400000-0000-4000-8000-000000000001";
const ownerId = "15400000-0000-4000-8000-000000000002";
async function clean() {
	await pool.query("delete from organization where id like 't1540-%'");
	await pool.query('delete from "user" where id like $1', ["t1540-%"]);
}
beforeAll(async () => {
	await clean();
	for (const org of ["t1540-org", "t1540-other"])
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
			[`t1540-${name}`, `${name}@t1540.example.test`],
		);
		await pool.query(
			"insert into member(id,user_id,organization_id,role,status,created_at) values($1,$1,$2,$3,'approved',now())",
			[`t1540-${name}`, `t1540-${org}`, role],
		);
	}
	for (const [id, name, role] of [
		[holderId, "holder", "employee"],
		[ownerId, "owner", "employee"],
		["15400000-0000-4000-8000-000000000003", "manager", "manager"],
	])
		await pool.query(
			"insert into employee(id,user_id,organization_id,role,is_active,updated_at) values($1,$2,'t1540-org',$3,true,now())",
			[id, `t1540-${name}`, role],
		);
});
afterAll(clean);
beforeEach(async () => {
	session.userId = "t1540-owner";
	session.organizationId = "t1540-org";
	clock.now = "2026-11-04T23:30:00Z";
	await pool.query(
		"delete from equipment_assignment where organization_id='t1540-org'",
	);
	await pool.query(
		"delete from equipment_command where organization_id='t1540-org'",
	);
	await pool.query(
		"delete from equipment_setup_command where organization_id='t1540-org'",
	);
	await pool.query(
		"delete from equipment_item where organization_id='t1540-org'",
	);
	await pool.query(
		"delete from equipment_type where organization_id='t1540-org'",
	);
	await pool.query(
		"delete from equipment_policy where organization_id='t1540-org'",
	);
	await pool.query(
		"update employee set is_active=true where organization_id='t1540-org'",
	);
	await pool.query("update member set role='admin' where id='t1540-admin'");
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
it("receives two shirts and closes one as lost without reporting a third physical receipt", async () => {
	const type = await quantityType();
	const result = await issue(type.id);
	if (!result.success || !result.data.ok)
		throw new Error(JSON.stringify(result));
	const id = result.data.id;
	expect(await receive(id)).toMatchObject({
		success: true,
		data: { ok: true, revision: 2 },
	});
	expect(
		await actions.changeEquipment({
			kind: "close_return",
			requestId: crypto.randomUUID(),
			assignmentId: id,
			expectedRevision: 2,
			outcome: "lost",
			quantity: 1,
			reason: "Missing after site move",
		}),
	).toMatchObject({ success: true, data: { ok: true, revision: 3 } });
	expect((await overview()).assignments).toMatchObject([
		{
			quantity: 3,
			physicallyReceivedQuantity: 2,
			lostQuantity: 1,
			waivedQuantity: 0,
			recoveredQuantity: 0,
			outstandingQuantity: 0,
			outstanding: false,
			held: true,
			canReceive: false,
			exceptions: [
				{
					kind: "lost",
					quantity: 1,
					receivedQuantity: 0,
					reason: "Missing after site move",
					actorName: "t1540-owner",
					recordedAt: "2026-11-04T23:30:00Z",
				},
			],
		},
	]);
	expect((await overview({ outstanding: true })).assignments).toEqual([]);
	session.userId = "t1540-holder";
	expect(await actions.getMyEquipment()).toMatchObject({
		success: true,
		data: {
			assignments: [
				{
					physicallyReceivedQuantity: 2,
					lostQuantity: 1,
					outstandingQuantity: 0,
					canCloseException: false,
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
function close(assignmentId: string, extra: Record<string, unknown> = {}) {
	return actions.changeEquipment({
		kind: "close_return",
		requestId: crypto.randomUUID(),
		assignmentId,
		expectedRevision: 1,
		outcome: "lost",
		quantity: 1,
		reason: "Missing after site move",
		...extra,
	});
}
function recover(
	assignmentId: string,
	exceptionId: string,
	extra: Record<string, unknown> = {},
) {
	return actions.changeEquipment({
		kind: "receive_exception",
		requestId: crypto.randomUUID(),
		assignmentId,
		exceptionId,
		expectedRevision: 2,
		quantity: 1,
		actualDate: "2026-11-05",
		condition: "worn",
		notes: "Found in old office",
		...extra,
	});
}
it("links partial physical recovery to its original loss without settling it twice", async () => {
	const { assignment } = await issued();
	expect(await close(assignment.id, { quantity: 2 })).toMatchObject({
		success: true,
		data: { ok: true },
	});
	const loss = (await overview()).assignments[0].exceptions[0];
	expect(await recover(assignment.id, loss.id)).toMatchObject({
		success: true,
		data: { ok: true, revision: 3 },
	});
	expect((await overview()).assignments).toMatchObject([
		{
			physicallyReceivedQuantity: 1,
			lostQuantity: 2,
			recoveredQuantity: 1,
			outstandingQuantity: 1,
			exceptions: [
				{
					id: loss.id,
					quantity: 2,
					receivedQuantity: 1,
					reason: "Missing after site move",
					canReceive: true,
				},
			],
			receipts: [
				{
					exceptionId: loss.id,
					quantity: 1,
					condition: "worn",
					notes: "Found in old office",
					actualDate: "2026-11-05",
				},
			],
		},
	]);
	expect(
		await receive(assignment.id, { expectedRevision: 3, quantity: 2 }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "excess_quantity" },
	});
	expect(
		await receive(assignment.id, { expectedRevision: 3, quantity: 1 }),
	).toMatchObject({ success: true, data: { ok: true, revision: 4 } });
	expect(
		await recover(assignment.id, loss.id, { expectedRevision: 4 }),
	).toMatchObject({ success: true, data: { ok: true, revision: 5 } });
	expect((await overview()).assignments).toMatchObject([
		{
			physicallyReceivedQuantity: 3,
			lostQuantity: 2,
			recoveredQuantity: 2,
			outstandingQuantity: 0,
			held: false,
			exceptions: [
				{ id: loss.id, quantity: 2, receivedQuantity: 2, canReceive: false },
			],
		},
	]);
});

it("requires a reason and positive whole quantities, refuses excess and issued-to-keep closures", async () => {
	const { assignment } = await issued();
	for (const extra of [
		{ reason: "" },
		{ reason: "   " },
		{ reason: "x".repeat(4001) },
		{ quantity: 0 },
		{ quantity: -1 },
		{ quantity: 0.5 },
	])
		expect(await close(assignment.id, extra)).toMatchObject({
			success: true,
			data: { ok: false, reason: "invalid_input" },
		});
	expect(await close(assignment.id, { quantity: 4 })).toMatchObject({
		success: true,
		data: { ok: false, reason: "excess_quantity" },
	});
	expect(
		await close(assignment.id, {
			outcome: "waived",
			quantity: 2,
			reason: "  Approved uniform allowance  ",
		}),
	).toMatchObject({ success: true, data: { ok: true, revision: 2 } });
	expect(
		await close(assignment.id, { expectedRevision: 2, quantity: 2 }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "excess_quantity" },
	});
	expect((await overview()).assignments).toMatchObject([
		{
			physicallyReceivedQuantity: 0,
			waivedQuantity: 2,
			outstandingQuantity: 1,
			exceptions: [{ reason: "Approved uniform allowance" }],
		},
	]);
	const keep = await issue((await overview()).availableQuantityTypes[0].id, {
		returnRequired: false,
		explicitDeadline: null,
		expectedRevision: 2,
	});
	if (!keep.success || !keep.data.ok) throw new Error(JSON.stringify(keep));
	expect(await close(keep.data.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "return_not_required" },
	});
});
it("requires another administrator for own loss or waiver and another receiver for own recovery", async () => {
	const { assignment } = await issued({ employeeId: ownerId });
	for (const outcome of ["lost", "waived"])
		expect(await close(assignment.id, { outcome })).toMatchObject({
			success: true,
			data: { ok: false, reason: "self_exception" },
		});
	expect((await overview()).assignments[0].canCloseException).toBe(false);
	session.userId = "t1540-admin";
	expect(await close(assignment.id)).toMatchObject({
		success: true,
		data: { ok: true },
	});
	const loss = (await overview()).assignments[0].exceptions[0];
	session.userId = "t1540-owner";
	expect(await recover(assignment.id, loss.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "self_receipt" },
	});
	expect((await overview()).assignments[0].exceptions[0].canReceive).toBe(
		false,
	);
	session.userId = "t1540-admin";
	expect(await recover(assignment.id, loss.id)).toMatchObject({
		success: true,
		data: { ok: true },
	});
});
it("replays committed closures and recoveries only for their actor and exact payload", async () => {
	const { assignment } = await issued();
	const command = {
		kind: "close_return",
		assignmentId: assignment.id,
		requestId: crypto.randomUUID(),
		expectedRevision: 1,
		quantity: 1,
		outcome: "lost",
		reason: "Missing after site move",
	};
	const [one, two] = await Promise.all([
		actions.changeEquipment(command),
		actions.changeEquipment(command),
	]);
	expect(one).toMatchObject({ success: true, data: { ok: true, revision: 2 } });
	expect(two).toEqual(one);
	expect(
		await actions.changeEquipment({ ...command, reason: "Changed reason" }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "request_conflict" },
	});
	session.userId = "t1540-admin";
	expect(await actions.changeEquipment(command)).toMatchObject({
		success: true,
		data: { ok: false, reason: "request_conflict" },
	});
	const loss = (await overview()).assignments[0].exceptions[0];
	const receipt = { requestId: crypto.randomUUID() };
	const [a, b] = await Promise.all([
		recover(assignment.id, loss.id, receipt),
		recover(assignment.id, loss.id, receipt),
	]);
	expect(a).toMatchObject({ success: true, data: { ok: true, revision: 3 } });
	expect(b).toEqual(a);
	expect(
		await recover(assignment.id, loss.id, { ...receipt, condition: "damaged" }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "request_conflict" },
	});
	expect((await overview()).assignments).toMatchObject([
		{
			lostQuantity: 1,
			recoveredQuantity: 1,
			physicallyReceivedQuantity: 1,
			outstandingQuantity: 2,
			exceptions: [{ quantity: 1, receivedQuantity: 1 }],
			receipts: [{ quantity: 1 }],
		},
	]);
});
it("serializes competing partial closures, receipts, and recoveries without oversettlement", async () => {
	const { assignment } = await issued();
	const results = await Promise.all([
		close(assignment.id, { quantity: 2 }),
		close(assignment.id, { quantity: 2, outcome: "waived" }),
		receive(assignment.id, { quantity: 2 }),
	]);
	expect(results.filter((r) => r.success && r.data.ok)).toHaveLength(1);
	expect(results.filter((r) => r.success && !r.data.ok)).toHaveLength(2);
	const current = (await overview()).assignments[0];
	expect(current.outstandingQuantity).toBe(1);
	expect(
		await close(assignment.id, {
			expectedRevision: current.revision,
			quantity: 2,
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "excess_quantity" },
	});
	// A separate assignment has two lost shirts and two competing recoveries of both.
	const next = await issue((await overview()).availableQuantityTypes[0].id, {
		expectedRevision: 2,
	});
	if (!next.success || !next.data.ok) throw new Error(JSON.stringify(next));
	await close(next.data.id, { quantity: 2 });
	const loss = (await overview()).assignments.find((a) => a.id === next.data.id)
		?.exceptions[0];
	if (!loss) throw new Error("Expected a recorded loss");
	const recoveries = await Promise.all([
		recover(next.data.id, loss.id, { quantity: 2 }),
		recover(next.data.id, loss.id, { quantity: 2 }),
	]);
	expect(recoveries.filter((r) => r.success && r.data.ok)).toHaveLength(1);
	expect(
		await recover(next.data.id, loss.id, { expectedRevision: 3 }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "excess_quantity" },
	});
	expect(
		(await overview()).assignments.find((a) => a.id === next.data.id),
	).toMatchObject({
		lostQuantity: 2,
		recoveredQuantity: 2,
		physicallyReceivedQuantity: 2,
		outstandingQuantity: 1,
	});
});
async function individual() {
	await quantityType();
	const type = await setup({
		kind: "create_type",
		name: "Laptop",
		trackingMode: "individual",
		defaultReturnRequired: true,
	});
	const item = await setup({
		kind: "register_item",
		typeId: type.id,
		identifier: "L-1540",
	});
	const result = await actions.changeEquipment({
		kind: "issue_individual",
		requestId: crypto.randomUUID(),
		expectedRevision: 1,
		itemId: item.id,
		employeeId: holderId,
		actualDate: "2026-11-02",
		condition: "good",
		returnRequired: true,
	});
	if (!result.success || !result.data.ok)
		throw new Error(JSON.stringify(result));
	return { item, assignment: result.data };
}
it("holds a lost item until linked recovery and keeps damaged recovery unavailable until separate clearance", async () => {
	const { item, assignment } = await individual();
	await close(assignment.id);
	const view = await overview();
	const loss = view.assignments[0].exceptions[0];
	expect(view).toMatchObject({
		availableItems: [],
		assignments: [
			{ outstandingQuantity: 0, held: true, physicallyReceivedQuantity: 0 },
		],
		readinessItems: [{ inCustody: true, canClear: false }],
	});
	const reissue = () =>
		actions.changeEquipment({
			kind: "issue_individual",
			requestId: crypto.randomUUID(),
			expectedRevision: 2,
			itemId: item.id,
			employeeId: ownerId,
			actualDate: "2026-11-05",
			condition: "good",
			returnRequired: true,
		});
	expect(await reissue()).toMatchObject({
		success: true,
		data: { ok: false, reason: "item_unavailable" },
	});
	expect(
		await actions.changeEquipment({
			kind: "receive_individual",
			requestId: crypto.randomUUID(),
			assignmentId: assignment.id,
			expectedRevision: 2,
			actualDate: "2026-11-05",
			condition: "good",
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "excess_quantity" },
	});
	expect(
		await recover(assignment.id, loss.id, { condition: "damaged" }),
	).toMatchObject({ success: true, data: { ok: true, revision: 3 } });
	const recovered = await overview();
	expect(recovered).toMatchObject({
		availableItems: [],
		assignments: [
			{
				lostQuantity: 1,
				recoveredQuantity: 1,
				physicallyReceivedQuantity: 1,
				outstandingQuantity: 0,
				held: false,
				receipt: { condition: "damaged", exceptionId: loss.id },
			},
		],
		readinessItems: [
			{ status: "unavailable", inCustody: false, canClear: true },
		],
	});
	expect(
		await actions.changeEquipment({
			kind: "issue_individual",
			requestId: crypto.randomUUID(),
			expectedRevision: 3,
			itemId: item.id,
			employeeId: ownerId,
			actualDate: "2026-11-05",
			condition: "good",
			returnRequired: true,
		}),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "item_unavailable" },
	});
	expect(
		await actions.changeEquipment({
			kind: "clear_item",
			requestId: crypto.randomUUID(),
			expectedRevision: 3,
			itemId: item.id,
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	expect((await overview()).availableItems).toMatchObject([{ id: item.id }]);
});
it("keeps waived individual equipment in custody until a linked physical receipt", async () => {
	const { item, assignment } = await individual();
	expect(
		await close(assignment.id, {
			outcome: "waived",
			reason: "Permission to keep on departure",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	let view = await overview();
	const waiver = view.assignments[0].exceptions[0];
	expect(view.availableItems).toEqual([]);
	expect(view.assignments[0]).toMatchObject({
		waivedQuantity: 1,
		lostQuantity: 0,
		outstandingQuantity: 0,
		held: true,
	});
	expect(
		await recover(assignment.id, waiver.id, { condition: "good" }),
	).toMatchObject({ success: true, data: { ok: true } });
	view = await overview();
	expect(view.availableItems).toMatchObject([{ id: item.id }]);
	expect(view.assignments[0]).toMatchObject({
		waivedQuantity: 1,
		recoveredQuantity: 0,
		outstandingQuantity: 0,
		physicallyReceivedQuantity: 1,
		held: false,
		exceptions: [
			{
				id: waiver.id,
				reason: "Permission to keep on departure",
				receivedQuantity: 1,
			},
		],
	});
});
it("rejects unauthorized and foreign references and validates recovery dates in the organization zone", async () => {
	const { assignment } = await issued();
	await close(assignment.id);
	const loss = (await overview()).assignments[0].exceptions[0];
	for (const actor of ["holder", "manager"]) {
		session.userId = `t1540-${actor}`;
		expect(await close(assignment.id, { expectedRevision: 2 })).toMatchObject({
			success: true,
			data: { ok: false, reason: "forbidden" },
		});
		expect(await recover(assignment.id, loss.id)).toMatchObject({
			success: true,
			data: { ok: false, reason: "forbidden" },
		});
	}
	session.userId = "t1540-foreign";
	session.organizationId = "t1540-other";
	expect(await close(assignment.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "not_found" },
	});
	expect(await recover(assignment.id, loss.id)).toMatchObject({
		success: true,
		data: { ok: false, reason: "not_found" },
	});
	session.userId = "t1540-owner";
	session.organizationId = "t1540-org";
	expect(await recover(assignment.id, crypto.randomUUID())).toMatchObject({
		success: true,
		data: { ok: false, reason: "not_found" },
	});
	expect(
		await recover(assignment.id, loss.id, { actualDate: "2026-11-04" }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "conflicting_history" },
	});
	expect(
		await recover(assignment.id, loss.id, { actualDate: "2026-11-06" }),
	).toMatchObject({
		success: true,
		data: { ok: false, reason: "future_date" },
	});
	expect(await recover(assignment.id, loss.id, { quantity: 2 })).toMatchObject({
		success: true,
		data: { ok: false, reason: "excess_quantity" },
	});
	expect(await recover(assignment.id, loss.id, { quantity: 0 })).toMatchObject({
		success: true,
		data: { ok: false, reason: "invalid_input" },
	});
	expect((await overview()).assignments[0]).toMatchObject({
		physicallyReceivedQuantity: 0,
		lostQuantity: 1,
		outstandingQuantity: 2,
		receipts: [],
	});
});
