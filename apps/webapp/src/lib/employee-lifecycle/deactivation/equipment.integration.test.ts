import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { countBillableSeats } from "@/lib/effect/services/billing/billable-seat-count";
import { registerKioskFob, resolveActiveKioskFob } from "@/lib/time-tracking/kiosk/fob-store";
import { resolveEmployeeOrganizationAccess } from "../access";
import { createDepartureCommands } from "../commands";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "../testing/database.test.fixture";

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

vi.mock("@/lib/auth-helpers", async (original) => {
	const actual = await original<typeof import("@/lib/auth-helpers")>();
	const { db } = await import("@/db");
	const { loadOrganizationPrincipalContext } = await import("@/lib/authorization/principal-loader");
	return {
		...actual,
		getAuthContext: async () => ({
			user: { id: context.userId },
			session: { activeOrganizationId: context.organizationId },
		}),
		getPrincipalContext: async () =>
			loadOrganizationPrincipalContext(db, {
				userId: context.userId,
				organizationId: context.organizationId,
			}),
	};
});
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/lib/queue", async (original) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(original),
);
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
const { deactivateEmployeeAction, previewEmployeeDeactivationAction, reactivateEmployeeAction } =
	await import("@/app/[locale]/(app)/settings/employees/employee-lifecycle.actions");
const { getReactivationChecklistAction } = await import(
	"@/app/[locale]/(app)/settings/employees/employee-reactivation.actions"
);
function deactivate(employeeId: string, requestId = randomUUID()) {
	return deactivateEmployeeAction({
		employeeId,
		requestId,
		replacementManagers: {},
	});
}
function preview(employeeId: string) {
	return previewEmployeeDeactivationAction({
		employeeId,
		replacementManagers: {},
	});
}
it("previews outstanding equipment on the organization-local deactivation day and recomputes new assignments on submit", async () => {
	const target = await fixture.seedEmployee();
	const early = await issue(target.employeeId, "2026-10-20");
	context.now = "2026-10-20T22:30:00Z";
	expect(await preview(target.employeeId)).toMatchObject({
		success: true,
		data: {
			equipment: [
				{
					assignmentId: early.id,
					outstandingQuantity: 3,
					effectiveDeadline: "2026-10-20",
				},
			],
		},
	});
	const fresh = await issue(target.employeeId);
	expect(await deactivate(target.employeeId)).toMatchObject({ success: true });
	expect(await equipment(target.employeeId)).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				id: early.id,
				effectiveDeadline: "2026-10-20",
				departureDeadline: "2026-10-21",
			}),
			expect.objectContaining({
				id: fresh.id,
				effectiveDeadline: "2026-10-21",
				outstandingQuantity: 3,
				employmentPeriodId: target.employmentPeriodId,
			}),
		]),
	);
});

it("reactivation and later schedules preserve old deadlines and deactivation lineage while old retries leave fresh equipment alone", async () => {
	const target = await fixture.seedEmployee();
	const old = await issue(target.employeeId);
	const requestId = randomUUID();
	expect(await deactivate(target.employeeId, requestId)).toMatchObject({
		success: true,
	});
	context.now = "2026-10-22T08:00:00Z";
	expect(await reactivateEmployeeAction(target.employeeId)).toMatchObject({
		success: true,
	});
	const fresh = await issue(target.employeeId);
	const departure = await schedule(target.employeeId, "2026-10-28");
	expect(await equipment(target.employeeId)).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				id: old.id,
				effectiveDeadline: "2026-10-20",
				departureId: null,
				deactivationId: expect.any(String),
				employmentPeriodId: target.employmentPeriodId,
			}),
			expect.objectContaining({
				id: fresh.id,
				effectiveDeadline: "2026-10-28",
				departureId: departure.departureId,
				deactivationId: null,
			}),
		]),
	);
	expect(await preview(target.employeeId)).toMatchObject({
		success: true,
		data: {
			equipment: expect.arrayContaining([
				expect.objectContaining({
					assignmentId: old.id,
					effectiveDeadline: "2026-10-20",
				}),
				expect.objectContaining({
					assignmentId: fresh.id,
					effectiveDeadline: "2026-10-22",
				}),
			]),
		},
	});
	expect(await deactivate(target.employeeId, requestId)).toMatchObject({
		success: true,
	});
	expect(await actions.getEmployeeEquipment(target.employeeId)).toMatchObject({
		success: true,
		data: {
			employees: expect.arrayContaining([
				expect.objectContaining({ id: target.employeeId, former: false }),
			]),
		},
	});
	await commands().cancelDeparture(actor(), {
		employeeId: target.employeeId,
		departureId: departure.departureId,
		expectedRevision: 1,
		requestId: randomUUID(),
	});
	expect(await equipment(target.employeeId)).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				id: old.id,
				effectiveDeadline: "2026-10-20",
				departureId: null,
			}),
			expect.objectContaining({
				id: fresh.id,
				effectiveDeadline: null,
				deactivationId: null,
			}),
		]),
	);
});

it("ends the officer grant, access and seat with equipment missing while primary and secondary team officers retain former returns", async () => {
	const target = await fixture.seedEmployee();
	const primaryOfficer = await fixture.seedEmployee();
	const secondaryOfficer = await fixture.seedEmployee();
	const primary = randomUUID(),
		secondary = randomUUID();
	for (const id of [primary, secondary])
		await fixture.pool.query(
			"insert into team(id,organization_id,name,updated_at) values($1,$2,'Returns',now())",
			[id, context.organizationId],
		);
	await fixture.pool.query("update employee set team_id=$1 where id=$2", [
		primary,
		target.employeeId,
	]);
	await fixture.pool.query(
		"insert into team_membership(organization_id,employee_id,team_id) values($1,$2,$3)",
		[context.organizationId, target.employeeId, secondary],
	);
	for (const [employeeId, scope, teamIds] of [
		[target.employeeId, "all", []],
		[primaryOfficer.employeeId, "selected", [primary]],
		[secondaryOfficer.employeeId, "selected", [secondary]],
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
	const held = await issue(target.employeeId);
	expect(await preview(target.employeeId)).toMatchObject({
		success: true,
		data: {
			accessEnds: {
				grants: expect.arrayContaining([
					expect.objectContaining({
						kind: "equipment_officer",
						grantId: target.employeeId,
					}),
				]),
			},
		},
	});
	const seats = await countBillableSeats(fixture.db, context.organizationId, {
		now: parseInstant(context.now),
	});
	const requestId = randomUUID();
	expect(await deactivate(target.employeeId, requestId)).toMatchObject({
		success: true,
	});
	expect(
		await countBillableSeats(fixture.db, context.organizationId, {
			now: parseInstant(context.now),
		}),
	).toBe(seats - 1);
	expect(
		await resolveEmployeeOrganizationAccess(fixture.db, {
			organizationId: context.organizationId,
			userId: target.userId,
			now: parseInstant(context.now),
		}),
	).toMatchObject({ allowed: false });
	expect(await actions.getEquipmentOfficerGrants()).toMatchObject({
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
	context.now = "2026-10-21T08:00:00Z";
	for (const officer of [primaryOfficer, secondaryOfficer]) {
		context.userId = officer.userId;
		expect(
			await actions.getEquipmentOverview({
				former: true,
				outstanding: true,
				overdue: true,
			}),
		).toMatchObject({
			success: true,
			data: {
				assignments: expect.arrayContaining([
					expect.objectContaining({
						id: held.id,
						former: true,
						outstandingQuantity: 3,
						canReceive: true,
						effectiveDeadline: "2026-10-20",
					}),
				]),
			},
		});
	}
	const current = (await equipment(target.employeeId)).find((a) => a.id === held.id);
	if (!current) throw new Error("Former assignment must remain readable");
	expect(
		await actions.changeEquipment({
			kind: "receive_quantity",
			requestId: randomUUID(),
			assignmentId: held.id,
			expectedRevision: current.revision,
			quantity: 1,
			actualDate: "2026-10-21",
			condition: "good",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	context.userId = fixture.ownerUserId;
	expect(await equipment(target.employeeId)).toMatchObject([{ outstandingQuantity: 2 }]);
	expect(await reactivateEmployeeAction(target.employeeId)).toMatchObject({
		success: true,
	});
	expect(await getReactivationChecklistAction(target.employeeId)).toMatchObject({
		success: true,
		data: {
			items: expect.arrayContaining([
				expect.objectContaining({
					group: "grants",
					grant: "equipment_officer",
					href: "/settings/equipment",
				}),
			]),
		},
	});
	context.userId = target.userId;
	expect(await actions.getEquipmentOverview()).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
	context.userId = fixture.ownerUserId;
	expect(
		await actions.changeEquipmentOfficerGrant({
			kind: "set_officer_grant",
			requestId: randomUUID(),
			expectedRevision: 2,
			employeeId: target.employeeId,
			scope: "all",
			teamIds: [],
			employeeIds: [],
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	expect(await deactivate(target.employeeId, requestId)).toMatchObject({
		success: true,
	});
	expect(await actions.getEquipmentOfficerGrants()).toMatchObject({
		success: true,
		data: {
			grants: expect.arrayContaining([
				expect.objectContaining({
					employeeId: target.employeeId,
					revoked: false,
					revision: 3,
				}),
			]),
		},
	});
});

it("historical unknown-date holdings recorded after deactivation keep its frozen day and identity across reactivation", async () => {
	const target = await fixture.seedEmployee();
	context.now = "2026-10-20T22:30:00Z";
	expect(await deactivate(target.employeeId)).toMatchObject({ success: true });
	await fixture.pool.query("update organization set timezone='America/Los_Angeles' where id=$1", [
		context.organizationId,
	]);
	const type = await setup({
		kind: "create_type",
		name: "Old shirts",
		trackingMode: "quantity",
		defaultReturnRequired: true,
	});
	const recorded = await actions.changeEquipment({
		kind: "record_historical_quantity",
		requestId: randomUUID(),
		employeeId: target.employeeId,
		employmentPeriodId: target.employmentPeriodId,
		typeId: type.id,
		quantity: 2,
		expectedRevision: 1,
		actualDate: null,
		condition: "unknown",
		returnRequired: true,
	});
	expect(recorded).toMatchObject({ success: true, data: { ok: true } });
	expect(await equipment(target.employeeId)).toMatchObject([
		{
			effectiveDeadline: "2026-10-21",
			deactivationId: expect.any(String),
			issue: { actualDate: null, historical: true },
		},
	]);
	expect(await reactivateEmployeeAction(target.employeeId)).toMatchObject({ success: true });
	await schedule(target.employeeId, "2026-10-28");
	expect(await equipment(target.employeeId)).toMatchObject([
		{
			effectiveDeadline: "2026-10-21",
			departureId: null,
			deactivationId: expect.any(String),
			employmentPeriodId: target.employmentPeriodId,
		},
	]);
	await fixture.pool.query("update organization set timezone='Europe/Berlin' where id=$1", [
		context.organizationId,
	]);
});

it("fresh issuance racing deactivation serializes and physical fob receipt never restores the credential", async () => {
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
	expect(
		await actions.changeEquipment({
			kind: "issue_individual",
			requestId: randomUUID(),
			employeeId: target.employeeId,
			itemId: item.id,
			expectedRevision: 1,
			returnRequired: true,
			actualDate: "2026-10-20",
			condition: "good",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	const quantity = await setup({
		kind: "create_type",
		name: "Racing shirt",
		trackingMode: "quantity",
		defaultReturnRequired: true,
	});
	const [deactivated, issued] = await Promise.all([
		deactivate(target.employeeId),
		actions.changeEquipment({
			kind: "issue_quantity",
			requestId: randomUUID(),
			employeeId: target.employeeId,
			typeId: quantity.id,
			quantity: 1,
			expectedRevision: 1,
			returnRequired: true,
			actualDate: "2026-10-20",
			condition: "good",
		}),
	]);
	expect(deactivated).toMatchObject({ success: true });
	expect(issued).toMatchObject({ success: true });
	if (!issued.success) throw new Error("Equipment action must return a domain result");
	if (issued.data.ok) {
		expect(await equipment(target.employeeId)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: issued.data.id,
					former: true,
					effectiveDeadline: "2026-10-20",
					deactivationId: expect.any(String),
				}),
			]),
		);
	} else expect(issued.data.reason).toBe("employee_not_current");
	const fob = (await equipment(target.employeeId)).find((a) => a.itemId === item.id);
	if (!fob) throw new Error("Physical fob must remain actionable");
	expect(fob.outstanding).toBe(true);
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
			assignmentId: fob.id,
			expectedRevision: fob.revision,
			requestId: randomUUID(),
			actualDate: "2026-10-20",
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
	expect(await reactivateEmployeeAction(target.employeeId)).toMatchObject({ success: true });
	expect(
		await resolveActiveKioskFob(fixture.db, {
			organizationId: context.organizationId,
			serial,
			now: parseInstant(context.now),
		}),
	).toBeNull();
});
it("deactivation summaries distinguish lost, waived and recovered quantities from outstanding returns", async () => {
	const target = await fixture.seedEmployee();
	const held = await issue(target.employeeId);
	expect(
		await actions.changeEquipment({
			kind: "close_return",
			assignmentId: held.id,
			requestId: randomUUID(),
			expectedRevision: 1,
			quantity: 1,
			outcome: "lost",
			reason: "Missing shirt",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	let current = (await equipment(target.employeeId))[0];
	const loss = current.exceptions[0];
	expect(
		await actions.changeEquipment({
			kind: "receive_exception",
			assignmentId: held.id,
			exceptionId: loss.id,
			requestId: randomUUID(),
			expectedRevision: current.revision,
			quantity: 1,
			actualDate: "2026-10-20",
			condition: "good",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	current = (await equipment(target.employeeId))[0];
	expect(
		await actions.changeEquipment({
			kind: "close_return",
			assignmentId: held.id,
			requestId: randomUUID(),
			expectedRevision: current.revision,
			quantity: 1,
			outcome: "waived",
			reason: "Permission to keep one",
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	expect(await preview(target.employeeId)).toMatchObject({
		success: true,
		data: { equipment: [{ assignmentId: held.id, outstandingQuantity: 1 }] },
	});
	expect(await deactivate(target.employeeId)).toMatchObject({ success: true });
	expect(await equipment(target.employeeId)).toMatchObject([
		{
			outstandingQuantity: 1,
			physicallyReceivedQuantity: 1,
			lostQuantity: 1,
			waivedQuantity: 1,
			recoveredQuantity: 1,
		},
	]);
});
