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
			"insert into organization(id,name,slug,timezone,equipment_enabled,created_at) values($1,$1,$1,'Europe/Berlin',true,now())",
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
		"delete from employee_deactivation where organization_id='t1544-org'",
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
	await issue(type.id, { actualDate: "2026-10-01" });
	const original = (await overview()).assignments[0];
	const command = {
		kind: "correct_issue",
		requestId: crypto.randomUUID(),
		assignmentId: original.id,
		expectedRevision: 1,
		quantity: 4,
		actualDate: null,
		condition: "worn",
		notes: "Corrected count",
		returnRequired: true,
		explicitDeadline: "2026-11-03",
		employmentPeriodId: null,
		reason: "Stock count confirmed four shirts",
	};
	expect(await actions.changeEquipment(command)).toMatchObject({
		success: true,
		data: { ok: true, revision: 2 },
	});
	const effective = (await overview()).assignments[0];
	expect(effective).toMatchObject({
		quantity: 4,
		outstandingQuantity: 4,
		explicitDeadline: "2026-11-03",
		issue: { actualDate: null, condition: "worn", notes: "Corrected count" },
		corrections: [
			{
				reason: "Stock count confirmed four shirts",
				actorId: "t1544-owner",
				recordedAt: "2026-11-04T23:30:00Z",
				expectedRevision: 1,
				before: { quantity: 3, actualDate: "2026-10-01" },
				after: { quantity: 4, actualDate: null },
			},
		],
	});
	expect(await actions.changeEquipment(command)).toMatchObject({
		success: true,
		data: { ok: true, revision: 2 },
	});
	expect((await overview()).assignments[0].corrections).toHaveLength(1);
	session.userId = "t1544-admin";
	expect(await actions.changeEquipment(command)).toMatchObject({
		success: true,
		data: { ok: false, reason: "request_conflict" },
	});
});
async function amendIssue(
	assignmentId: string,
	extra: Record<string, unknown> = {},
) {
	const a = required(
		(await overview()).assignments.find((a) => a.id === assignmentId),
	);
	return actions.changeEquipment({
		kind: "correct_issue",
		requestId: crypto.randomUUID(),
		assignmentId,
		expectedRevision: a.revision,
		quantity: a.quantity,
		actualDate: a.issue.actualDate,
		condition: a.issue.condition,
		notes: a.issue.notes ?? "",
		returnRequired: a.returnRequired,
		explicitDeadline: a.explicitDeadline,
		employmentPeriodId: a.employmentPeriodId,
		reason: "Corrected from the signed handover",
		...extra,
	});
}
async function amendReceipt(
	assignmentId: string,
	extra: Record<string, unknown> = {},
) {
	const a = required(
		(await overview()).assignments.find((a) => a.id === assignmentId),
	);
	const h = a.receipts[0];
	return actions.changeEquipment({
		kind: "correct_receipt",
		requestId: crypto.randomUUID(),
		assignmentId,
		handoverId: h.id,
		expectedRevision: a.revision,
		quantity: h.quantity,
		actualDate: h.actualDate,
		condition: h.condition,
		notes: h.notes ?? "",
		reason: "Receipt count was entered incorrectly",
		...extra,
	});
}
it("restores only the corrected physical balance, rejects excess settlements and future or conflicting dates, and fences concurrent stale forms", async () => {
	const type = await quantityType();
	await issue(type.id, { actualDate: "2026-11-01" });
	const a = (await overview()).assignments[0];
	expect(await receive(a.id)).toMatchObject({ data: { ok: true } });
	expect(await amendReceipt(a.id, { quantity: 0 })).toMatchObject({
		data: { ok: true },
	});
	expect((await overview()).assignments[0]).toMatchObject({
		physicallyReceivedQuantity: 0,
		outstandingQuantity: 3,
		receipts: [{ quantity: 0 }],
		corrections: [{ before: { quantity: 2 }, after: { quantity: 0 } }],
	});
	expect(await amendReceipt(a.id, { quantity: 4 })).toMatchObject({
		data: { ok: false, reason: "excess_quantity" },
	});
	expect(await amendReceipt(a.id, { actualDate: "2026-11-06" })).toMatchObject({
		data: { ok: false, reason: "future_date" },
	});
	expect(await amendReceipt(a.id, { actualDate: "2026-10-31" })).toMatchObject({
		data: { ok: false, reason: "conflicting_history" },
	});
	const results = await Promise.all([
		amendReceipt(a.id, { quantity: 1, expectedRevision: 3 }),
		amendReceipt(a.id, { quantity: 2, expectedRevision: 3 }),
	]);
	expect(results.filter((r) => r.success && r.data.ok)).toHaveLength(1);
	expect(
		results.filter(
			(r) => r.success && !r.data.ok && r.data.reason === "stale_revision",
		),
	).toHaveLength(1);
	expect((await overview()).assignments[0].corrections).toHaveLength(2);
});
async function command(change: Record<string, unknown>) {
	return actions.changeEquipment({ requestId: crypto.randomUUID(), ...change });
}
async function close(assignmentId: string, quantity = 3) {
	const a = required(
		(await overview()).assignments.find((a) => a.id === assignmentId),
	);
	expect(
		await command({
			kind: "close_return",
			assignmentId,
			quantity,
			outcome: "lost",
			reason: "Missing at inventory",
			expectedRevision: a.revision,
		}),
	).toMatchObject({ data: { ok: true } });
	return required(
		(await overview()).assignments.find((a) => a.id === assignmentId),
	);
}
async function amendException(
	assignmentId: string,
	extra: Record<string, unknown> = {},
) {
	const a = required(
		(await overview()).assignments.find((a) => a.id === assignmentId),
	);
	return command({
		kind: "correct_exception",
		assignmentId,
		exceptionId: a.exceptions[0].id,
		expectedRevision: a.revision,
		quantity: 1,
		outcome: "lost",
		decisionReason: "One shirt still missing",
		reason: "Two shirts located in the locker",
		...extra,
	});
}
it("partially reverses exceptions without inventing receipts, preserves recovery linkage and uses the effective remaining decision for later receipts", async () => {
	const type = await quantityType();
	await issue(type.id);
	const a = await close((await overview()).assignments[0].id);
	expect(await amendException(a.id, { quantity: 2 })).toMatchObject({
		data: { ok: true },
	});
	expect((await overview()).assignments[0]).toMatchObject({
		lostQuantity: 2,
		outstandingQuantity: 1,
		physicallyReceivedQuantity: 0,
		held: true,
		exceptions: [{ quantity: 2, receivedQuantity: 0 }],
	});
	expect(
		await command({
			kind: "receive_exception",
			assignmentId: a.id,
			exceptionId: a.exceptions[0].id,
			expectedRevision: 3,
			quantity: 1,
			actualDate: "2026-11-05",
			condition: "good",
		}),
	).toMatchObject({ data: { ok: true } });
	expect(await amendException(a.id, { quantity: 0 })).toMatchObject({
		data: { ok: false, reason: "recovery_conflict" },
	});
	expect(await amendException(a.id, { quantity: 1 })).toMatchObject({
		data: { ok: true },
	});
	expect((await overview()).assignments[0]).toMatchObject({
		lostQuantity: 1,
		outstandingQuantity: 2,
		physicallyReceivedQuantity: 1,
		recoveredQuantity: 1,
	});
	expect(
		await command({
			kind: "receive_exception",
			assignmentId: a.id,
			exceptionId: a.exceptions[0].id,
			expectedRevision: 5,
			quantity: 1,
			actualDate: "2026-11-05",
			condition: "good",
		}),
	).toMatchObject({ data: { ok: false, reason: "excess_quantity" } });
	expect(await amendReceipt(a.id, { quantity: 0 })).toMatchObject({
		data: { ok: true },
	});
	expect(await amendException(a.id, { quantity: 0 })).toMatchObject({
		data: { ok: true },
	});
	expect((await overview()).assignments[0]).toMatchObject({
		lostQuantity: 0,
		outstandingQuantity: 3,
		physicallyReceivedQuantity: 0,
		recoveredQuantity: 0,
		exceptions: [{ quantity: 0, receivedQuantity: 0 }],
	});
});

async function transfer(assignmentId: string) {
	const a = required(
		(await overview()).assignments.find((a) => a.id === assignmentId),
	);
	const destination = await command({
		kind: "transfer_equipment",
		assignmentId,
		employeeId: ownerId,
		quantity: 2,
		expectedRevision: a.revision,
		expectedIssuanceRevision: required(a.transfer).expectedIssuanceRevision,
		receipt: { actualDate: "2026-11-03", condition: "good" },
		issue: {
			actualDate: "2026-11-04",
			condition: "worn",
			returnRequired: true,
		},
	});
	expect(destination).toMatchObject({ data: { ok: true } });
	return required(
		(await overview()).assignments.find((a) => a.employeeId === ownerId),
	);
}
it("amends both linked transfer quantities atomically and refuses contradictory single-leg dates or quantities", async () => {
	const type = await quantityType();
	await issue(type.id, { actualDate: "2026-11-01" });
	const a = (await overview()).assignments[0];
	const destination = await transfer(a.id);
	// Receiving one's own destination is forbidden, but independently confirming the source is allowed.
	expect(await amendReceipt(a.id, { quantity: 1 })).toMatchObject({
		data: { ok: false, reason: "transfer_conflict" },
	});
	expect(await amendReceipt(a.id, { actualDate: "2026-11-05" })).toMatchObject({
		data: { ok: false, reason: "transfer_conflict" },
	});
	session.userId = "t1544-admin";
	const transferChange = {
		kind: "correct_transfer",
		assignmentId: a.id,
		expectedRevision: 2,
		destinationAssignmentId: destination.id,
		expectedDestinationRevision: 1,
		quantity: 1,
		receipt: {
			actualDate: "2026-11-02",
			condition: "worn",
			notes: "One shirt transferred",
		},
		issue: {
			actualDate: "2026-11-03",
			condition: "worn",
			notes: "One shirt issued",
		},
		reason: "Counted one shirt in the transfer bag",
	};
	expect(await command(transferChange)).toMatchObject({ data: { ok: true } });
	expect(
		(await overview()).assignments.find((row) => row.id === a.id),
	).toMatchObject({
		physicallyReceivedQuantity: 1,
		outstandingQuantity: 2,
		receipts: [{ quantity: 1 }],
		corrections: [{ reason: transferChange.reason }],
	});
	expect(
		(await overview()).assignments.find((row) => row.id === destination.id),
	).toMatchObject({
		quantity: 1,
		issue: { quantity: 1 },
		corrections: [{ reason: transferChange.reason }],
	});
});

it("cannot orphan a recovery when increasing and later reducing an amended loss decision", async () => {
	const type = await quantityType();
	await issue(type.id);
	const a = await close((await overview()).assignments[0].id);
	expect(await amendIssue(a.id, { quantity: 5 })).toMatchObject({
		data: { ok: true },
	});
	expect(await amendException(a.id, { quantity: 5 })).toMatchObject({
		data: { ok: true },
	});
	expect(
		await command({
			kind: "receive_exception",
			assignmentId: a.id,
			exceptionId: a.exceptions[0].id,
			expectedRevision: 4,
			quantity: 4,
			actualDate: "2026-11-05",
			condition: "damaged",
		}),
	).toMatchObject({ data: { ok: true } });
	expect((await overview()).assignments[0]).toMatchObject({
		quantity: 5,
		physicallyReceivedQuantity: 4,
		lostQuantity: 5,
		outstandingQuantity: 0,
		recoveredQuantity: 4,
	});
	expect(await amendException(a.id, { quantity: 3 })).toMatchObject({
		data: { ok: false, reason: "recovery_conflict" },
	});
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
		identifier: "Laptop-1544",
	});
	expect(
		await command({
			kind: "issue_individual",
			itemId: item.id,
			employeeId: holderId,
			expectedRevision: 1,
			actualDate: "2026-11-01",
			condition: "good",
			returnRequired: true,
		}),
	).toMatchObject({ data: { ok: true } });
	return (await overview()).assignments[0];
}
it("retains individual custody when reversing mistaken receipt and requires clearance after a newly damaged condition", async () => {
	const a = await individual();
	expect(
		await command({
			kind: "receive_individual",
			assignmentId: a.id,
			expectedRevision: 1,
			actualDate: "2026-11-03",
			condition: "good",
		}),
	).toMatchObject({ data: { ok: true } });
	expect(await amendReceipt(a.id, { quantity: 0 })).toMatchObject({
		data: { ok: true },
	});
	let view = await overview();
	expect(view.availableItems).toHaveLength(0);
	expect(view.assignments[0]).toMatchObject({
		held: true,
		physicallyReceivedQuantity: 0,
		outstandingQuantity: 1,
	});
	expect(
		await amendReceipt(a.id, { quantity: 1, condition: "damaged" }),
	).toMatchObject({ data: { ok: true } });
	view = await overview();
	expect(view.availableItems).toHaveLength(0);
	expect(view.readinessItems[0]).toMatchObject({
		status: "unavailable",
		inCustody: false,
	});
	expect(
		await command({
			kind: "clear_item",
			itemId: a.itemId,
			expectedRevision: view.readinessItems[0].revision,
		}),
	).toMatchObject({ data: { ok: true } });
	expect(await amendReceipt(a.id, { condition: "good" })).toMatchObject({
		data: { ok: false, reason: "readiness_conflict" },
	});
	expect((await overview()).assignments[0].receipt).toMatchObject({
		condition: "damaged",
	});
});
it("does not create overlapping individual custody or invalidate readiness in a later reissue", async () => {
	const a = await individual();
	expect(
		await command({
			kind: "receive_individual",
			assignmentId: a.id,
			expectedRevision: 1,
			actualDate: "2026-11-03",
			condition: "good",
		}),
	).toMatchObject({ data: { ok: true } });
	const available = (await overview()).availableItems[0];
	expect(
		await command({
			kind: "issue_individual",
			itemId: a.itemId,
			employeeId: ownerId,
			expectedRevision: available.revision,
			actualDate: "2026-11-04",
			condition: "good",
			returnRequired: true,
		}),
	).toMatchObject({ data: { ok: true } });
	expect(await amendReceipt(a.id, { quantity: 0 })).toMatchObject({
		data: { ok: false, reason: "conflicting_history" },
	});
	expect(await amendReceipt(a.id, { actualDate: "2026-11-05" })).toMatchObject({
		data: { ok: false, reason: "conflicting_history" },
	});
	expect(await amendReceipt(a.id, { condition: "damaged" })).toMatchObject({
		data: { ok: false, reason: "readiness_conflict" },
	});
	expect((await overview()).assignments.filter((a) => a.held)).toHaveLength(1);
});
async function grant(employeeIds: string[], expectedRevision = 0) {
	const result = await actions.changeEquipmentOfficerGrant({
		kind: "set_officer_grant",
		requestId: crypto.randomUUID(),
		employeeId: "15440000-0000-4000-8000-000000000003",
		expectedRevision,
		scope: "selected",
		teamIds: [],
		employeeIds,
	});
	expect(result).toMatchObject({ success: true, data: { ok: true } });
	return result;
}
it("rechecks revoked and cross-transfer scope before replay, with owner fallback and no implied manager authority", async () => {
	const type = await quantityType();
	await issue(type.id, { actualDate: "2026-11-01" });
	const a = (await overview()).assignments[0];
	await grant([holderId, ownerId]);
	session.userId = "t1544-manager";
	expect(await amendIssue(a.id, { notes: "Scoped correction" })).toMatchObject({
		data: { ok: true },
	});
	session.userId = "t1544-owner";
	await transfer(a.id);
	await grant([holderId], 1);
	session.userId = "t1544-manager";
	const row = (await overview()).assignments[0];
	expect(row.canCorrect).toBe(false);
	expect(
		await amendReceipt(a.id, { notes: "Outside transfer scope" }),
	).toMatchObject({ data: { ok: false, reason: "forbidden" } });
	session.userId = "t1544-owner";
	await grant([holderId, ownerId], 2);
	session.userId = "t1544-manager";
	const current = required(
		(await overview()).assignments.find((a) => a.employeeId === holderId),
	);
	const retry = {
		kind: "correct_receipt",
		requestId: crypto.randomUUID(),
		assignmentId: a.id,
		handoverId: current.receipts[0].id,
		expectedRevision: current.revision,
		quantity: 2,
		actualDate: "2026-11-03",
		condition: "good",
		notes: "Two transferred shirts",
		reason: "Transfer evidence confirmed",
	};
	expect(await actions.changeEquipment(retry)).toMatchObject({
		data: { ok: true },
	});
	session.userId = "t1544-owner";
	await grant([holderId], 3);
	session.userId = "t1544-manager";
	expect(await actions.changeEquipment(retry)).toMatchObject({
		data: { ok: false, reason: "forbidden" },
	});
	session.userId = "t1544-owner";
	expect(
		await actions.changeEquipmentOfficerGrant({
			kind: "revoke_officer_grant",
			requestId: crypto.randomUUID(),
			employeeId: "15440000-0000-4000-8000-000000000003",
			expectedRevision: 4,
		}),
	).toMatchObject({ data: { ok: true } });
	session.userId = "t1544-manager";
	expect(await actions.changeEquipment(retry)).toMatchObject({
		data: { ok: false, reason: "forbidden" },
	});
	expect((await actions.getEmployeeEquipment(holderId)).success).toBe(false);
});
it("requires independent receipt and exception confirmation even when a holder is an owner or a scoped officer", async () => {
	const type = await quantityType();
	await issue(type.id, { employeeId: ownerId });
	const a = (await overview()).assignments[0];
	session.userId = "t1544-admin";
	expect(await close(a.id, 2)).toMatchObject({ lostQuantity: 2 });
	const row = (await overview()).assignments[0];
	expect(
		await command({
			kind: "receive_exception",
			assignmentId: a.id,
			exceptionId: row.exceptions[0].id,
			expectedRevision: row.revision,
			quantity: 1,
			actualDate: "2026-11-05",
			condition: "good",
		}),
	).toMatchObject({ data: { ok: true } });
	session.userId = "t1544-owner";
	expect(await amendException(a.id)).toMatchObject({
		data: { ok: false, reason: "self_exception" },
	});
	expect(await amendReceipt(a.id, { notes: "Own receipt" })).toMatchObject({
		data: { ok: false, reason: "self_receipt" },
	});
	expect(
		await amendIssue(a.id, { returnRequired: false, explicitDeadline: null }),
	).toMatchObject({ data: { ok: false, reason: "self_exception" } });
	expect(await amendIssue(a.id, { quantity: 1 })).toMatchObject({
		data: { ok: false, reason: "self_exception" },
	});
	const own = (await overview()).assignments[0];
	expect(own).toMatchObject({
		canCorrect: true,
		canCorrectReceipt: false,
		canCorrectException: false,
	});
});
it("preserves explicit unknown historical dates, refuses new unknown dates and cross-organization record references", async () => {
	const type = await quantityType();
	await issue(type.id);
	const a = (await overview()).assignments[0];
	expect(await amendIssue(a.id, { actualDate: "2026-11-01" })).toMatchObject({
		data: { ok: true },
	});
	expect(await amendIssue(a.id, { actualDate: null })).toMatchObject({
		data: { ok: true },
	});
	expect((await overview()).assignments[0].issue).toMatchObject({
		actualDate: null,
		historical: true,
	});
	expect(
		await issue(type.id, {
			kind: "issue_quantity",
			actualDate: "2026-11-01",
			expectedRevision: (await overview()).availableQuantityTypes[0].revision,
		}),
	).toMatchObject({ data: { ok: true } });
	const fresh = required(
		(await overview()).assignments.find((a) => !a.issue.historical),
	);
	expect(await amendIssue(fresh.id, { actualDate: null })).toMatchObject({
		data: { ok: false, reason: "invalid_input" },
	});
	expect(await amendIssue(a.id, { reason: " " })).toMatchObject({
		data: { ok: false, reason: "invalid_input" },
	});
	session.userId = "t1544-foreign";
	session.organizationId = "t1544-other";
	expect(
		await command({
			kind: "correct_issue",
			assignmentId: a.id,
			expectedRevision: 1,
			quantity: 9,
			actualDate: null,
			condition: "good",
			notes: "foreign",
			returnRequired: true,
			explicitDeadline: null,
			employmentPeriodId: null,
			reason: "foreign",
		}),
	).toMatchObject({ data: { ok: false, reason: "not_found" } });
});

it("retains deactivation lineage and its frozen-zone deadline when the same employment period is reopened", async () => {
	const type = await quantityType();
	const periodId = "15440000-0000-4000-8000-000000000011";
	const deactivationId = "15440000-0000-4000-8000-000000000012";
	await pool.query(
		"insert into employee_employment_period(id,organization_id,employee_id,status,started_at,start_provenance) values($1,'t1544-org',$2,'open','2026-01-01T00:00Z','recorded')",
		[periodId, holderId],
	);
	await pool.query(
		"insert into employee_deactivation(id,organization_id,employee_id,employment_period_id,deactivated_at,created_by,reason,request_id,request_fingerprint,plan,reactivated_at) values($1,'t1544-org',$2,$3,'2026-10-01T22:30Z','t1544-owner','employee_deactivated',gen_random_uuid(),'fixture','{\"timeZone\":\"Europe/Berlin\"}','2026-10-20T10:00Z')",
		[deactivationId, holderId, periodId],
	);
	expect(
		await issue(type.id, {
			actualDate: "2026-09-20",
			returnRequired: false,
			explicitDeadline: null,
			employmentPeriodId: periodId,
		}),
	).toMatchObject({ data: { ok: true } });
	const old = (await overview()).assignments[0];
	expect(old).toMatchObject({
		deactivationId,
		departureDeadline: null,
		employmentPeriodId: periodId,
	});
	expect(
		await issue(type.id, {
			kind: "issue_quantity",
			actualDate: "2026-11-01",
			expectedRevision: (await overview()).availableQuantityTypes[0].revision,
		}),
	).toMatchObject({ data: { ok: true } });
	const fresh = required(
		(await overview()).assignments.find((a) => a.id !== old.id),
	);
	expect(fresh).toMatchObject({
		deactivationId: null,
		departureDeadline: null,
	});
	expect(await amendIssue(old.id, { condition: "worn" })).toMatchObject({
		data: { ok: true },
	});
	expect(await amendIssue(old.id, { actualDate: "2026-10-03" })).toMatchObject({
		data: { ok: false, reason: "conflicting_history" },
	});
	expect(await amendIssue(old.id, { returnRequired: true })).toMatchObject({
		data: { ok: true },
	});
	const rows = (await overview()).assignments;
	expect(rows.find((a) => a.id === old.id)).toMatchObject({
		deactivationId,
		departureDeadline: "2026-10-02",
		employmentPeriodId: periodId,
	});
	expect(rows.find((a) => a.id === fresh.id)).toEqual(fresh);
});

it("keeps a fully reversed waiver in history without releasing an item that has never been received", async () => {
	const a = await individual();
	expect(
		await command({
			kind: "close_return",
			assignmentId: a.id,
			expectedRevision: 1,
			outcome: "waived",
			quantity: 1,
			reason: "Original waiver was mistaken",
		}),
	).toMatchObject({ data: { ok: true } });
	expect(
		await amendException(a.id, { quantity: 0, outcome: "waived" }),
	).toMatchObject({ data: { ok: true } });
	const view = await overview();
	expect(view.availableItems).toHaveLength(0);
	expect(view.assignments[0]).toMatchObject({
		held: true,
		outstandingQuantity: 1,
		physicallyReceivedQuantity: 0,
		waivedQuantity: 0,
		exceptions: [{ kind: "waived", quantity: 0 }],
	});
	expect(
		await command({
			kind: "issue_individual",
			itemId: a.itemId,
			employeeId: ownerId,
			expectedRevision: view.readinessItems[0].revision,
			actualDate: "2026-11-05",
			condition: "good",
			returnRequired: true,
		}),
	).toMatchObject({ data: { ok: false, reason: "item_unavailable" } });
});
it("keeps legacy holdings in their original unrecorded employment context after a new period starts", async () => {
	const type = await quantityType();
	await issue(type.id);
	const a = (await overview()).assignments[0];
	await pool.query(
		"insert into employee_employment_period(id,organization_id,employee_id,status,started_at,start_provenance) values('15440000-0000-4000-8000-000000000021','t1544-org',$1,'open','2026-11-01T00:00Z','recorded')",
		[holderId],
	);
	expect(await amendIssue(a.id, { actualDate: "2026-10-01" })).toMatchObject({
		data: { ok: true },
	});
	expect((await overview()).assignments[0]).toMatchObject({
		employmentPeriodId: null,
		issue: { actualDate: "2026-10-01" },
	});
	expect(
		await amendIssue(a.id, {
			employmentPeriodId: "15440000-0000-4000-8000-000000000021",
		}),
	).toMatchObject({ data: { ok: false, reason: "conflicting_history" } });
});
function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined)
		throw new Error("Expected seeded public read model");
	return value;
}
it("amends both individual transfer dates together and rejects damaged receipt evidence before its later effective issuance", async () => {
	const a = await individual();
	const source = (await overview()).assignments[0];
	expect(
		await command({
			kind: "transfer_equipment",
			assignmentId: a.id,
			employeeId: ownerId,
			expectedRevision: 1,
			expectedIssuanceRevision: required(source.transfer)
				.expectedIssuanceRevision,
			quantity: 1,
			receipt: { actualDate: "2026-11-02", condition: "good" },
			issue: {
				actualDate: "2026-11-03",
				condition: "good",
				returnRequired: true,
			},
		}),
	).toMatchObject({ data: { ok: true } });
	const destination = required(
		(await overview()).assignments.find((row) => row.employeeId === ownerId),
	);
	session.userId = "t1544-admin";
	expect(
		await command({
			kind: "correct_transfer",
			assignmentId: a.id,
			destinationAssignmentId: destination.id,
			expectedRevision: 2,
			expectedDestinationRevision: 1,
			quantity: 1,
			receipt: { actualDate: "2026-11-04", condition: "good" },
			issue: { actualDate: "2026-11-05", condition: "good" },
			reason: "Both transfer dates were entered too early",
		}),
	).toMatchObject({ data: { ok: true } });
	expect(await amendReceipt(a.id, { condition: "damaged" })).toMatchObject({
		data: { ok: false, reason: "readiness_conflict" },
	});
	const rows = (await overview()).assignments;
	expect(rows.find((row) => row.id === a.id)?.receipt).toMatchObject({
		actualDate: "2026-11-04",
		condition: "good",
	});
	expect(rows.find((row) => row.id === destination.id)).toMatchObject({
		held: true,
		issue: { actualDate: "2026-11-05" },
	});
});
it("cannot reclassify an existing physical recovery as a waived receipt through an exception amendment", async () => {
	const type = await quantityType();
	await issue(type.id);
	const a = await close((await overview()).assignments[0].id);
	expect(
		await command({
			kind: "receive_exception",
			assignmentId: a.id,
			exceptionId: a.exceptions[0].id,
			expectedRevision: 2,
			quantity: 1,
			actualDate: "2026-11-05",
			condition: "good",
		}),
	).toMatchObject({ data: { ok: true } });
	expect(
		await amendException(a.id, { quantity: 3, outcome: "waived" }),
	).toMatchObject({ data: { ok: false, reason: "recovery_conflict" } });
	expect((await overview()).assignments[0]).toMatchObject({
		recoveredQuantity: 1,
		lostQuantity: 3,
		waivedQuantity: 0,
	});
});
it("does not inherit a prior deactivation when amending fresh issued-to-keep equipment after reactivation", async () => {
	const type = await quantityType();
	const periodId = "15440000-0000-4000-8000-000000000031";
	await pool.query(
		"insert into employee_employment_period(id,organization_id,employee_id,status,started_at,start_provenance) values($1,'t1544-org',$2,'open','2026-01-01T00:00Z','recorded')",
		[periodId, holderId],
	);
	await pool.query(
		"insert into employee_deactivation(organization_id,employee_id,employment_period_id,deactivated_at,created_by,reason,request_id,request_fingerprint,plan,reactivated_at) values('t1544-org',$1,$2,'2026-10-01T22:30Z','t1544-owner','employee_deactivated',gen_random_uuid(),'fixture','{\"timeZone\":\"Europe/Berlin\"}','2026-10-20T10:00Z')",
		[holderId, periodId],
	);
	expect(
		await issue(type.id, {
			kind: "issue_quantity",
			returnRequired: false,
			explicitDeadline: null,
			actualDate: "2026-11-01",
		}),
	).toMatchObject({ data: { ok: true } });
	const a = (await overview()).assignments[0];
	expect(a).toMatchObject({ departureDeadline: null, deactivationId: null });
	expect(await amendIssue(a.id, { returnRequired: true })).toMatchObject({
		data: { ok: true },
	});
	expect((await overview()).assignments[0]).toMatchObject({
		returnRequired: true,
		departureDeadline: null,
		deactivationId: null,
	});
});
it("exposes original and effective amendments through the employee's authorized personal history only", async () => {
	const type = await quantityType();
	await issue(type.id);
	const a = (await overview()).assignments[0];
	expect(
		await amendIssue(a.id, {
			notes: "Effective holding notes",
			condition: "worn",
		}),
	).toMatchObject({ data: { ok: true } });
	session.userId = "t1544-holder";
	const mine = await actions.getMyEquipment();
	expect(mine).toMatchObject({
		success: true,
		data: {
			canManage: false,
			assignments: [
				{
					canCorrect: false,
					canCorrectReceipt: false,
					canCorrectException: false,
					issue: { condition: "worn", notes: "Effective holding notes" },
					corrections: [
						{
							actorId: "t1544-owner",
							before: { condition: "good", notes: "Three size-M shirts" },
							after: { condition: "worn", notes: "Effective holding notes" },
						},
					],
				},
			],
		},
	});
	session.userId = "t1544-manager";
	expect((await actions.getEmployeeEquipment(holderId)).success).toBe(false);
});
it("replays concurrent identical corrections exactly once and rejects changed payloads under the same identity", async () => {
	const type = await quantityType();
	await issue(type.id);
	const a = (await overview()).assignments[0];
	const retry = {
		requestId: crypto.randomUUID(),
		expectedRevision: 1,
		quantity: 4,
		reason: "Independent count confirmed four",
	};
	const results = await Promise.all([
		amendIssue(a.id, retry),
		amendIssue(a.id, retry),
	]);
	expect(results[0]).toMatchObject({ data: { ok: true, revision: 2 } });
	expect(results[1]).toEqual(results[0]);
	expect((await overview()).assignments[0].corrections).toHaveLength(1);
	expect(await amendIssue(a.id, { ...retry, quantity: 5 })).toMatchObject({
		data: { ok: false, reason: "request_conflict" },
	});
});
it("rolls a linked transfer amendment back when its destination would be oversettled and refuses officer exception amendments", async () => {
	const type = await quantityType();
	await issue(type.id, { actualDate: "2026-11-01" });
	const a = (await overview()).assignments[0];
	const destination = await transfer(a.id);
	session.userId = "t1544-admin";
	expect(
		await command({
			kind: "receive_quantity",
			assignmentId: destination.id,
			expectedRevision: 1,
			quantity: 2,
			actualDate: "2026-11-05",
			condition: "good",
		}),
	).toMatchObject({ data: { ok: true } });
	expect(
		await command({
			kind: "correct_transfer",
			assignmentId: a.id,
			expectedRevision: 2,
			destinationAssignmentId: destination.id,
			expectedDestinationRevision: 2,
			quantity: 1,
			receipt: { actualDate: "2026-11-03", condition: "good" },
			issue: { actualDate: "2026-11-04", condition: "worn" },
			reason: "Conflicting transfer count",
		}),
	).toMatchObject({ data: { ok: false, reason: "excess_quantity" } });
	expect(
		(await overview()).assignments.find((row) => row.id === a.id),
	).toMatchObject({
		revision: 2,
		physicallyReceivedQuantity: 2,
		corrections: [],
	});
	session.userId = "t1544-owner";
	const withException = await close(a.id, 1);
	await grant([holderId, ownerId]);
	session.userId = "t1544-manager";
	expect(
		await amendException(a.id, {
			exceptionId: withException.exceptions[0].id,
			quantity: 0,
		}),
	).toMatchObject({ data: { ok: false, reason: "forbidden" } });
});
it("orders effective receipt history by amended actual dates and excludes voided receipts from the latest physical condition", async () => {
	const type = await quantityType();
	await issue(type.id, { quantity: 5, actualDate: "2026-11-01" });
	const a = (await overview()).assignments[0];
	expect(await receive(a.id, { actualDate: "2026-11-02" })).toMatchObject({
		data: { ok: true },
	});
	expect(
		await receive(a.id, {
			expectedRevision: 2,
			quantity: 1,
			actualDate: "2026-11-03",
			condition: "damaged",
		}),
	).toMatchObject({ data: { ok: true } });
	expect(
		await amendReceipt(a.id, { actualDate: "2026-11-04", condition: "worn" }),
	).toMatchObject({ data: { ok: true } });
	expect((await overview()).assignments[0]).toMatchObject({
		receipt: { actualDate: "2026-11-04", condition: "worn" },
		receipts: [
			{ actualDate: "2026-11-03", condition: "damaged" },
			{ actualDate: "2026-11-04", condition: "worn" },
		],
	});
	const current = (await overview()).assignments[0];
	expect(
		await amendReceipt(a.id, {
			handoverId: required(current.receipt).id,
			quantity: 0,
		}),
	).toMatchObject({ data: { ok: true } });
	expect((await overview()).assignments[0].receipt).toMatchObject({
		actualDate: "2026-11-03",
		condition: "damaged",
	});
});
it("refuses moving an ordinary issuance beyond a legacy former employee's known ending date", async () => {
	const type = await quantityType();
	expect(
		await issue(type.id, { kind: "issue_quantity", actualDate: "2026-11-01" }),
	).toMatchObject({ data: { ok: true } });
	const a = (await overview()).assignments[0];
	await pool.query(
		"update employee set is_active=false,deactivated_at='2026-11-02T12:00Z' where id=$1",
		[holderId],
	);
	expect(await amendIssue(a.id, { actualDate: "2026-11-03" })).toMatchObject({
		data: { ok: false, reason: "employee_not_current" },
	});
	expect(await amendIssue(a.id, { actualDate: "2026-10-31" })).toMatchObject({
		data: { ok: true },
	});
});
it("requires the owner/admin waiver path instead of converting a required return through ordinary amendments", async () => {
	const type = await quantityType();
	await issue(type.id);
	const a = (await overview()).assignments[0];
	expect(
		await amendIssue(a.id, { returnRequired: false, explicitDeadline: null }),
	).toMatchObject({ data: { ok: false, reason: "waiver_required" } });
	await grant([holderId]);
	session.userId = "t1544-manager";
	expect(
		await amendIssue(a.id, { returnRequired: false, explicitDeadline: null }),
	).toMatchObject({ data: { ok: false, reason: "waiver_required" } });
	session.userId = "t1544-owner";
	expect(
		await command({
			kind: "close_return",
			assignmentId: a.id,
			expectedRevision: 1,
			quantity: 3,
			outcome: "waived",
			reason: "Employee may keep these shirts",
		}),
	).toMatchObject({ data: { ok: true } });
	expect((await overview()).assignments[0]).toMatchObject({
		returnRequired: true,
		waivedQuantity: 3,
		outstandingQuantity: 0,
		physicallyReceivedQuantity: 0,
	});
});
