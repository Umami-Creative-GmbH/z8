import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { countBillableSeats } from "@/lib/effect/services/billing/billable-seat-count";
import {
	registerKioskFob,
	resolveActiveKioskFob,
} from "@/lib/time-tracking/kiosk/fob-store";
import { resolveEmployeeOrganizationAccess } from "../access";
import { createDepartureCommands } from "../commands";
import { previewEmployeeDeparture } from "../queries";
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
	const actual =
		await original<typeof import("@/lib/datetime/temporal-core")>();
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
	await fixture.pool.query(
		"update organization set timezone='Europe/Berlin' where id=$1",
		[context.organizationId],
	);
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
	if (!result.success || !result.data.ok)
		throw new Error(JSON.stringify(result));
	return result.data;
}
async function issue(
	employeeId: string,
	explicitDeadline: string | null = null,
) {
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
	if (!result.success || !result.data.ok)
		throw new Error(JSON.stringify(result));
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
	const { loadOrganizationPrincipalContext } = await import(
		"@/lib/authorization/principal-loader"
	);
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
const {
	deactivateEmployeeAction,
	previewEmployeeDeactivationAction,
	reactivateEmployeeAction,
} = await import(
	"@/app/[locale]/(app)/settings/employees/employee-lifecycle.actions"
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
	const current = (await equipment(target.employeeId)).find(
		(a) => a.id === held.id,
	)!;
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
	expect(await equipment(target.employeeId)).toMatchObject([
		{ outstandingQuantity: 2 },
	]);
	expect(await reactivateEmployeeAction(target.employeeId)).toMatchObject({
		success: true,
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
