import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { countBillableSeats } from "@/lib/effect/services/billing/billable-seat-count";
import { registerKioskFob, resolveActiveKioskFob } from "@/lib/time-tracking/kiosk/fob-store";
import { resolveEmployeeOrganizationAccess } from "./access";
import { createDepartureCommands } from "./commands";
import { previewEmployeeDeparture } from "./queries";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "./testing/database.test.fixture";

const context = vi.hoisted(() => ({
	userId: "",
	organizationId: "",
	now: "2026-10-20T08:00:00Z",
}));
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: context.userId, role: "user" },
				session: {
					id: `session-${context.userId}`,
					userId: context.userId,
					activeOrganizationId: context.organizationId,
				},
			}),
		},
	},
}));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual = await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: { nowInstant: () => actual.parseInstant(context.now) },
	};
});
const actions = await import("@/lib/organization/equipment/actions");
let fixture: LifecycleDatabaseFixture;
beforeAll(async () => {
	fixture = await createLifecycleDatabaseFixture();
	context.userId = fixture.ownerUserId;
	context.organizationId = fixture.organizationId;
	await fixture.pool.query("update organization set timezone='Europe/Berlin' where id=$1", [
		context.organizationId,
	]);
	await setup({
		kind: "configure_policy",
		expectedRevision: 0,
		retentionMonths: 24,
	});
});
afterAll(async () => fixture?.close());
beforeEach(() => {
	context.userId = fixture.ownerUserId;
	context.now = "2026-10-20T08:00:00Z";
});
function commands() {
	return createDepartureCommands({
		db: fixture.db,
		clock: { nowInstant: () => parseInstant(context.now) },
		clockOut: { close: async () => ({ kind: "not_running" }) },
	});
}
function actor() {
	return {
		userId: fixture.ownerUserId,
		organizationId: fixture.organizationId,
	};
}
function schedule(
	employeeId: string,
	lastWorkingDay = "2026-10-25",
	expectedRevision: number | null = null,
) {
	return commands().scheduleDeparture(actor(), {
		employeeId,
		lastWorkingDay,
		expectedRevision,
		requestId: randomUUID(),
		replacementEmployeeId: null,
		acknowledgeUnassignedDuties: false,
	});
}
async function setup(input: Record<string, unknown>) {
	const result = await actions.changeEquipmentSetup({
		requestId: randomUUID(),
		...input,
	});
	if (!result.success || !result.data.ok) throw new Error(JSON.stringify(result));
	return result.data;
}
async function issue(employeeId: string, explicitDeadline: string | null = null) {
	const type = await setup({
		kind: "create_type",
		name: "Laptop",
		trackingMode: "quantity",
		defaultReturnRequired: true,
	});
	const result = await actions.changeEquipment({
		kind: "issue_quantity",
		requestId: randomUUID(),
		employeeId,
		typeId: type.id,
		quantity: 3,
		expectedRevision: 1,
		returnRequired: true,
		explicitDeadline,
		actualDate: "2026-10-20",
		condition: "good",
	});
	if (!result.success || !result.data.ok) throw new Error(JSON.stringify(result));
	return result.data;
}
async function equipment(employeeId: string) {
	const result = await actions.getEmployeeEquipment(employeeId);
	if (!result.success) throw new Error(JSON.stringify(result));
	return result.data.assignments;
}
it("previews current required returns, recomputes on schedule, and preserves explicit dates and receipts when moving or cancelling", async () => {
	const target = await fixture.seedEmployee();
	const early = await issue(target.employeeId, "2026-10-23");
	const preview = await previewEmployeeDeparture(fixture.db, {
		...actor(),
		actorUserId: fixture.ownerUserId,
		employeeId: target.employeeId,
		lastWorkingDay: "2026-10-25",
		replacementEmployeeId: null,
		now: parseInstant(context.now),
	});
	expect(preview).toMatchObject({
		kind: "ok",
		preview: {
			equipment: [
				{
					assignmentId: early.id,
					outstandingQuantity: 3,
					effectiveDeadline: "2026-10-23",
				},
			],
		},
	});
	const later = await issue(target.employeeId);
	const departure = await schedule(target.employeeId);
	expect(await equipment(target.employeeId)).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				id: early.id,
				effectiveDeadline: "2026-10-23",
				departureDeadline: "2026-10-25",
			}),
			expect.objectContaining({
				id: later.id,
				effectiveDeadline: "2026-10-25",
				employmentPeriodId: target.employmentPeriodId,
				departureId: departure.departureId,
			}),
		]),
	);
	const receipt = await actions.changeEquipment({
		kind: "receive_quantity",
		assignmentId: later.id,
		expectedRevision: (await equipment(target.employeeId)).find((a) => a.id === later.id)?.revision,
		requestId: randomUUID(),
		quantity: 1,
		actualDate: "2026-10-20",
		condition: "good",
	});
	expect(receipt).toMatchObject({ success: true, data: { ok: true } });
	await fixture.pool.query("update organization set timezone='America/Los_Angeles' where id=$1", [
		context.organizationId,
	]);
	const moved = await schedule(target.employeeId, "2026-10-26", 1);
	const movedPreview = await previewEmployeeDeparture(fixture.db, {
		...actor(),
		actorUserId: fixture.ownerUserId,
		employeeId: target.employeeId,
		lastWorkingDay: "2026-10-26",
		replacementEmployeeId: null,
		now: parseInstant(context.now),
	});
	expect(movedPreview).toMatchObject({
		kind: "ok",
		preview: { cutoff: "2026-10-26T23:00:00Z", timezone: "Europe/Berlin" },
	});
	const immediatePreview = await previewEmployeeDeparture(fixture.db, {
		...actor(),
		actorUserId: fixture.ownerUserId,
		employeeId: target.employeeId,
		lastWorkingDay: null,
		replacementEmployeeId: null,
		now: parseInstant(context.now),
	});
	expect(immediatePreview).toMatchObject({
		kind: "ok",
		preview: {
			timezone: "America/Los_Angeles",
			equipment: expect.arrayContaining([
				expect.objectContaining({ assignmentId: later.id, effectiveDeadline: "2026-10-20" }),
			]),
		},
	});
	expect(await equipment(target.employeeId)).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				id: later.id,
				effectiveDeadline: "2026-10-26",
				outstandingQuantity: 2,
				receipts: [expect.objectContaining({ quantity: 1 })],
			}),
		]),
	);
	await commands().cancelDeparture(actor(), {
		employeeId: target.employeeId,
		departureId: moved.departureId,
		expectedRevision: 2,
		requestId: randomUUID(),
	});
	expect(await equipment(target.employeeId)).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				id: early.id,
				effectiveDeadline: "2026-10-23",
				departureDeadline: null,
			}),
			expect.objectContaining({
				id: later.id,
				effectiveDeadline: null,
				outstandingQuantity: 2,
				receipts: [expect.objectContaining({ quantity: 1 })],
			}),
		]),
	);
	await fixture.pool.query("update organization set timezone='Europe/Berlin' where id=$1", [
		context.organizationId,
	]);
});
it("ends access and the paid seat with equipment missing, captures former teams, ends the departing officer grant and keeps scoped follow-up actionable", async () => {
	const target = await fixture.seedEmployee();
	const officer = await fixture.seedEmployee();
	const team = randomUUID();
	await fixture.pool.query(
		"insert into team(id,organization_id,name,updated_at) values($1,$2,'Returns',now())",
		[team, context.organizationId],
	);
	await fixture.pool.query(
		"insert into team_membership(organization_id,employee_id,team_id) values($1,$2,$3)",
		[context.organizationId, target.employeeId, team],
	);
	for (const [employeeId, scope, teamIds] of [
		[officer.employeeId, "selected", [team]],
		[target.employeeId, "all", []],
	] as const) {
		expect(
			await actions.changeEquipmentOfficerGrant({
				kind: "set_officer_grant",
				requestId: randomUUID(),
				expectedRevision: 0,
				employeeId,
				scope,
				teamIds,
				employeeIds: [],
			}),
		).toMatchObject({ success: true, data: { ok: true } });
	}
	const missing = await issue(target.employeeId);
	const departure = await schedule(target.employeeId);
	const identity = {
		...actor(),
		employeeId: target.employeeId,
		employmentPeriodId: target.employmentPeriodId,
		...departure,
	};
	const seats = await countBillableSeats(fixture.db, context.organizationId, {
		now: parseInstant(context.now),
	});
	context.now = "2026-10-25T23:00:00Z";
	expect(
		await resolveEmployeeOrganizationAccess(fixture.db, {
			organizationId: context.organizationId,
			userId: target.userId,
			now: parseInstant(context.now),
		}),
	).toMatchObject({ allowed: false });
	expect(await commands().executeDeparture(identity)).toMatchObject({
		status: "effective",
	});
	expect(
		await countBillableSeats(fixture.db, context.organizationId, {
			now: parseInstant(context.now),
		}),
	).toBe(seats - 1);
	expect(await commands().executeDeparture(identity)).toEqual({
		status: "obsolete",
	});
	const grants = await actions.getEquipmentOfficerGrants();
	expect(grants).toMatchObject({
		success: true,
		data: {
			grants: expect.arrayContaining([
				expect.objectContaining({
					employeeId: target.employeeId,
					revoked: true,
					revision: 2,
				}),
			]),
		},
	});
	// The captured scope survives roster cleanup, including secondary teams.
	await fixture.pool.query(
		"delete from team_membership where organization_id=$1 and employee_id=$2",
		[context.organizationId, target.employeeId],
	);
	context.userId = officer.userId;
	const worklist = await actions.getEquipmentOverview({
		former: true,
		outstanding: true,
		overdue: true,
	});
	expect(worklist).toMatchObject({
		success: true,
		data: {
			assignments: expect.arrayContaining([
				expect.objectContaining({
					id: missing.id,
					canReceive: true,
					outstandingQuantity: 3,
					effectiveDeadline: "2026-10-25",
					former: true,
				}),
			]),
		},
	});
	const held = (await equipment(target.employeeId)).find((a) => a.id === missing.id);
	if (!held) throw new Error("The former employee's assignment must remain readable.");
	expect(
		await actions.changeEquipment({
			kind: "receive_quantity",
			assignmentId: missing.id,
			expectedRevision: held.revision,
			requestId: randomUUID(),
			quantity: 1,
			actualDate: "2026-10-26",
			condition: "good",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	context.userId = fixture.ownerUserId;
	const policy = await fixture.pool.query(
		"insert into work_policy(organization_id,name,created_by,updated_at) values($1,'Return policy',$2,now()) returning id",
		[context.organizationId, context.userId],
	);
	context.now = "2026-10-27T08:00:00Z";
	const rehired = await commands().rehireEmployee(actor(), {
		employeeId: target.employeeId,
		requestId: randomUUID(),
		previousEmploymentPeriodId: target.employmentPeriodId,
		role: "employee",
		teamId: null,
		primaryManagerId: null,
		workPolicyId: policy.rows[0].id,
		weeklyContractMinutes: 2400,
		contractType: "fixed",
		workModel: "onsite",
		hourlyRate: null,
		currency: "EUR",
		probationStartsOn: null,
		probationEndsOn: null,
		changeReason: "Returning",
	});
	const fresh = await issue(target.employeeId);
	expect(await commands().executeDeparture(identity)).toEqual({
		status: "obsolete",
	});
	expect(await equipment(target.employeeId)).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				id: missing.id,
				employmentPeriodId: target.employmentPeriodId,
				departureId: departure.departureId,
				outstandingQuantity: 2,
				effectiveDeadline: "2026-10-25",
			}),
			expect.objectContaining({
				id: fresh.id,
				employmentPeriodId: rehired.employmentPeriodId,
				departureId: null,
				effectiveDeadline: null,
			}),
		]),
	);
	context.userId = target.userId;
	expect(await actions.getEquipmentOverview()).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
});
it("new issuance during a pending departure inherits the frozen deadline; issuance racing cutoff is serial and fob ending is independent of physical receipt", async () => {
	const target = await fixture.seedEmployee();
	const type = await setup({
		kind: "create_type",
		name: "Access fob",
		trackingMode: "individual",
		defaultReturnRequired: true,
	});
	const item = await setup({
		kind: "register_item",
		typeId: type.id,
		identifier: `FOB-${randomUUID()}`,
	});
	const location = randomUUID(),
		kiosk = randomUUID();
	await fixture.pool.query(
		"insert into location(id,organization_id,name,created_by,updated_at) values($1,$2,'Entrance',$3,now())",
		[location, context.organizationId, context.userId],
	);
	await fixture.pool.query(
		"insert into kiosk(id,organization_id,location_id,name,timezone,updated_at) values($1,$2,$3,'Entrance','Europe/Berlin',now())",
		[kiosk, context.organizationId, location],
	);
	const serial = "04A1B2C3D4E5F6";
	await registerKioskFob(
		fixture.db,
		{
			organizationId: context.organizationId,
			employeeId: target.employeeId,
			kioskId: kiosk,
			serial,
		},
		{ nowInstant: () => parseInstant(context.now) },
	);
	const departure = await schedule(target.employeeId);
	const issued = await actions.changeEquipment({
		kind: "issue_individual",
		requestId: randomUUID(),
		employeeId: target.employeeId,
		itemId: item.id,
		expectedRevision: 1,
		returnRequired: true,
		actualDate: "2026-10-20",
		condition: "good",
	});
	expect(issued).toMatchObject({ success: true, data: { ok: true } });
	expect(await equipment(target.employeeId)).toMatchObject([
		{ effectiveDeadline: "2026-10-25", outstanding: true },
	]);
	// At the cutoff a fresh issue either precedes the cutoff, or is refused by
	// the same access rule, regardless of whether the executor has materialized it.
	const quantity = await setup({
		kind: "create_type",
		name: "Late shirt",
		trackingMode: "quantity",
		defaultReturnRequired: true,
	});
	context.now = "2026-10-25T23:00:00Z";
	const [cutoff, racing] = await Promise.all([
		commands().executeDeparture({
			organizationId: context.organizationId,
			employeeId: target.employeeId,
			employmentPeriodId: target.employmentPeriodId,
			...departure,
		}),
		actions.changeEquipment({
			kind: "issue_quantity",
			requestId: randomUUID(),
			employeeId: target.employeeId,
			typeId: quantity.id,
			quantity: 1,
			expectedRevision: 1,
			returnRequired: true,
			actualDate: "2026-10-26",
			condition: "good",
		}),
	]);
	expect(cutoff).toMatchObject({ status: "effective" });
	expect(racing).toMatchObject({
		success: true,
		data: { ok: false, reason: "employee_not_current" },
	});
	const held = (await equipment(target.employeeId))[0];
	expect(held.outstanding).toBe(true);
	expect(
		await resolveActiveKioskFob(fixture.db, {
			organizationId: context.organizationId,
			serial,
			now: parseInstant(context.now),
		}),
	).toBeNull();
	expect(
		await actions.changeEquipment({
			kind: "receive_individual",
			assignmentId: held.id,
			expectedRevision: held.revision,
			requestId: randomUUID(),
			actualDate: "2026-10-26",
			condition: "good",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	expect(
		await resolveActiveKioskFob(fixture.db, {
			organizationId: context.organizationId,
			serial,
			now: parseInstant(context.now),
		}),
	).toBeNull();
});

it("departure summaries exclude lost or waived obligations and recovery does not settle remaining quantities twice", async () => {
	const target = await fixture.seedEmployee();
	const assignment = await issue(target.employeeId);
	expect(
		await actions.changeEquipment({
			kind: "close_return",
			assignmentId: assignment.id,
			requestId: randomUUID(),
			expectedRevision: 1,
			quantity: 1,
			outcome: "lost",
			reason: "Missing laptop",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	const preview = () =>
		previewEmployeeDeparture(fixture.db, {
			...actor(),
			actorUserId: context.userId,
			employeeId: target.employeeId,
			lastWorkingDay: "2026-10-25",
			replacementEmployeeId: null,
			now: parseInstant(context.now),
		});
	expect(await preview()).toMatchObject({
		kind: "ok",
		preview: { equipment: [{ assignmentId: assignment.id, outstandingQuantity: 2 }] },
	});
	const lost = (await equipment(target.employeeId))[0];
	expect(
		await actions.changeEquipment({
			kind: "receive_exception",
			assignmentId: assignment.id,
			exceptionId: lost.exceptions[0].id,
			requestId: randomUUID(),
			expectedRevision: lost.revision,
			quantity: 1,
			actualDate: "2026-10-20",
			condition: "good",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	expect(await preview()).toMatchObject({
		kind: "ok",
		preview: { equipment: [{ assignmentId: assignment.id, outstandingQuantity: 2 }] },
	});
	const recovered = (await equipment(target.employeeId))[0];
	expect(
		await actions.changeEquipment({
			kind: "close_return",
			assignmentId: assignment.id,
			requestId: randomUUID(),
			expectedRevision: recovered.revision,
			quantity: 2,
			outcome: "waived",
			reason: "Employee may keep the rest",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	expect(await preview()).toMatchObject({ kind: "ok", preview: { equipment: [] } });
	await schedule(target.employeeId);
	expect(await equipment(target.employeeId)).toMatchObject([
		{
			outstandingQuantity: 0,
			physicallyReceivedQuantity: 1,
			lostQuantity: 1,
			waivedQuantity: 2,
			recoveredQuantity: 1,
		},
	]);
});

it("a staff-confirmed transfer to a scheduled employee inherits that employment's deadline", async () => {
	const source = await fixture.seedEmployee();
	const target = await fixture.seedEmployee();
	const assignment = await issue(source.employeeId);
	const departure = await schedule(target.employeeId);
	const sourceAssignment = (await equipment(source.employeeId))[0];
	if (!sourceAssignment.transfer)
		throw new Error("Transfer must be offered to the equipment administrator.");
	const transferred = await actions.changeEquipment({
		kind: "transfer_equipment",
		assignmentId: assignment.id,
		employeeId: target.employeeId,
		requestId: randomUUID(),
		expectedRevision: sourceAssignment.revision,
		expectedIssuanceRevision: sourceAssignment.transfer.expectedIssuanceRevision,
		quantity: 2,
		receipt: { actualDate: "2026-10-20", condition: "good" },
		issue: { actualDate: "2026-10-20", condition: "good", returnRequired: true },
	});
	expect(transferred, JSON.stringify(transferred)).toMatchObject({
		success: true,
		data: { ok: true },
	});
	expect(await equipment(target.employeeId)).toMatchObject([
		{
			quantity: 2,
			outstandingQuantity: 2,
			employmentPeriodId: target.employmentPeriodId,
			departureId: departure.departureId,
			effectiveDeadline: "2026-10-25",
		},
	]);
	expect(await equipment(source.employeeId)).toMatchObject([
		{ physicallyReceivedQuantity: 2, outstandingQuantity: 1, departureId: null },
	]);
});
