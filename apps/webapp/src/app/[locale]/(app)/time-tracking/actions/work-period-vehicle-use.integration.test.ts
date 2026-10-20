/**
 * #1120 runtime evidence: vehicle use on a completed work period, edited through the
 * work-period edit dialog's server action under the work-location change policy, on a
 * disposable PostgreSQL database.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * The real server actions run (`clockIn`/`clockOut`, `updateWorkPeriodTimes`,
 * `getWorkPeriodTimeEditContext`, the approval inbox decision and detail). Only the
 * request/session, billing, the Next cache, notification delivery, the change-policy
 * capability and the CASL preflights are replaced.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { seedSuspendedIntendedDriver } from "@/lib/organization/driving-licence/testing/recording.test.fixture";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1120-org" as string,
	isOrgAdmin: false,
	capability: { type: "direct", reason: "no_policy" } as
		| { type: "direct"; reason: string }
		| { type: "approval_required" }
		| { type: "forbidden"; daysBack: number },
}));

vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: {
								id: harness.userId,
								role: "user",
								name: harness.userId,
								email: `${harness.userId}@example.test`,
							},
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));
vi.mock("@/lib/auth-helpers", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/auth-helpers")>()),
	isOrgAdminCasl: async () => harness.isOrgAdmin,
	canApproveFor: async () => false,
	getAuthContext: async () => {
		if (!harness.userId) return null;
		const { db } = await import("@/db");
		const { employee } = await import("@/db/schema");
		const { and, eq } = await import("drizzle-orm");
		const [row] = await db
			.select()
			.from(employee)
			.where(
				and(
					eq(employee.userId, harness.userId),
					eq(employee.organizationId, harness.organizationId),
				),
			)
			.limit(1);
		return {
			user: {
				id: harness.userId,
				name: harness.userId,
				email: `${harness.userId}@example.test`,
			},
			session: { activeOrganizationId: harness.organizationId },
			employee: row
				? {
						id: row.id,
						organizationId: row.organizationId,
						role: row.role,
						teamId: row.teamId,
					}
				: null,
		};
	},
}));
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("./policy-helpers", async (importOriginal) => ({
	...(await importOriginal<typeof import("./policy-helpers")>()),
	getEditCapabilityForPeriod: async () => harness.capability,
}));
vi.mock("@/lib/notifications/triggers", async (original) =>
	(await import("@/test/integration-harness")).notificationTriggers(original),
);
vi.mock("@/lib/notifications/notification-service", () => ({
	createNotification: async () => null,
}));
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("./shared", async (importOriginal) => {
	const original = await importOriginal<typeof import("./shared")>();
	const quiet = () => {};
	return {
		...original,
		logger: {
			...original.logger,
			error: quiet,
			warn: quiet,
			info: quiet,
			debug: quiet,
		},
	};
});

const { db } = await import("@/db");
const { clockIn, clockOut } = await import("./clocking");
const { getWorkPeriodTimeEditContext, updateWorkPeriodTimes } = await import(
	"./work-period-time-edit"
);
await import("@/lib/approvals/init");
const { approveApprovalInboxItem } = await import(
	"@/lib/approvals/inbox/decision-service"
);
const { getApprovalInboxDetail } = await import(
	"@/lib/approvals/inbox/read-service"
);
const { submitPeriodSubmission } = await import(
	"@/lib/time-tracking/period-submissions/submission-service"
);
const { createManualTimeEntry } = await import("../actions");
const { getWorkPeriodsForMonth } = await import(
	"@/lib/calendar/work-period-service"
);

const ORG = "t1120-org";
const OTHER_ORG = "t1120-other-org";
const ids = {
	admin: "e1120000-0000-4000-8000-000000000001",
	manager: "e1120000-0000-4000-8000-000000000002",
	requester: "e1120000-0000-4000-8000-000000000003",
	van: "e1120000-0000-4000-8000-000000000021",
	archived: "e1120000-0000-4000-8000-000000000022",
	foreign: "e1120000-0000-4000-8000-000000000023",
	closedMonth: "e1120000-0000-4000-8000-000000000031",
} as const;
type Person = "admin" | "manager" | "requester";
const userOf = (person: Person) => `t1120-${person}`;
const SEEDED_AT = new Date("2026-06-01T00:00:00Z");
const WORK_START = parseInstant("2026-07-22T08:00:00Z");
const WORK_END = parseInstant("2026-07-22T12:00:00Z");

const admin = integrationAdminPool();

function actAs(person: Person, roles: { isOrgAdmin?: boolean } = {}) {
	harness.userId = userOf(person);
	harness.organizationId = ORG;
	harness.isOrgAdmin = roles.isOrgAdmin ?? false;
}

async function cleanup() {
	await admin.query("delete from organization where id = any($1::text[])", [
		[ORG, OTHER_ORG],
	]);
	await admin.query('delete from "user" where id like $1', ["t1120-%"]);
}

async function setAdmission(mode: "active" | "inactive") {
	await admin.query(
		`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
		 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
		[ORG, mode],
	);
}

async function setVehicleUse(
	mode: "off" | "asked" | "expected",
	enabled = true,
) {
	await admin.query(
		`insert into vehicle_use_setting (organization_id, enabled) values ($1, $2)
		 on conflict (organization_id) do update set enabled = excluded.enabled`,
		[ORG, enabled],
	);
	await admin.query(
		"delete from vehicle_use_assignment where organization_id = $1 and assignment_type = 'organization'",
		[ORG],
	);
	await admin.query(
		`insert into vehicle_use_assignment (organization_id, assignment_type, priority, mode, created_by)
		 values ($1, 'organization', 0, $2, $3)`,
		[ORG, mode, userOf("admin")],
	);
}

async function seed() {
	await cleanup();
	for (const organizationId of [ORG, OTHER_ORG]) {
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values ($1, $1, $1, 'UTC', $2)`,
			[organizationId, SEEDED_AT],
		);
	}
	const people: [Person, string, string][] = [
		["admin", "admin", "admin"],
		["manager", "member", "manager"],
		["requester", "member", "employee"],
	];
	for (const [person, memberRole, employeeRole] of people) {
		await admin.query(
			'insert into "user" (id, name, email, created_at, updated_at) values ($1, $1, $2, $3, $3)',
			[userOf(person), `${userOf(person)}@example.test`, SEEDED_AT],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ($1, $2, $3, $4, 'approved', $5)`,
			[`t1120-member-${person}`, ORG, userOf(person), memberRole, SEEDED_AT],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at)
			 values ($1, $2, $3, $4, $5)`,
			[ids[person], userOf(person), ORG, employeeRole, SEEDED_AT],
		);
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 values ($1, 'en', 'UTC', '24h', $2)`,
			[userOf(person), SEEDED_AT],
		);
	}
	await admin.query(
		`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
		 values ($1, $2, $3, true, $4)`,
		[randomUUID(), ids.requester, ids.manager, userOf("admin")],
	);
	await admin.query(
		`insert into approval_workflow_rollout
		 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
		 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2),
		        ($1, 'time_correction', 'legacy', 'legacy', $2, $2)`,
		[ORG, SEEDED_AT],
	);
	await admin.query(
		`insert into organization_vehicle (id, organization_id, name, licence_plate, archived_at) values
		 ($1, $4, 'Van', 'B-VN 100', null),
		 ($2, $4, 'Old car', 'B-OC 1', $6),
		 ($3, $5, 'Foreign car', 'M-FC 9', null)`,
		[ids.van, ids.archived, ids.foreign, ORG, OTHER_ORG, SEEDED_AT],
	);
	await setAdmission("active");
	await setVehicleUse("asked");
	harness.capability = { type: "direct", reason: "no_policy" };
}

/** Real clock-in and clock-out of one person. */
async function recordWork(person: Person, start = WORK_START, end = WORK_END) {
	actAs(person, { isOrgAdmin: person === "admin" });
	await expect(
		clockIn("office", { instant: start, browserTimezone: "UTC" }),
	).resolves.toMatchObject({ success: true });
	await expect(
		clockOut(undefined, undefined, {
			submissionId: randomUUID(),
			instant: end,
			browserTimezone: "UTC",
		}),
	).resolves.toMatchObject({ success: true });
	const { rows } = await admin.query<{ id: string }>(
		`select id from work_period
		 where organization_id = $1 and employee_id = $2 and start_time = $3 and deleted_at is null`,
		[ORG, ids[person], new Date(start.epochMilliseconds)],
	);
	const id = rows[0]?.id;
	if (!id) throw new Error("work not recorded");
	return id;
}

type VehicleUseInput = NonNullable<
	Parameters<typeof updateWorkPeriodTimes>[0]["vehicleUse"]
>;

function editVehicleUse(
	person: Person,
	workPeriodId: string,
	vehicleUse: VehicleUseInput | null,
	reason = "",
) {
	actAs(person, { isOrgAdmin: person === "admin" });
	return updateWorkPeriodTimes({
		workPeriodId,
		submissionId: randomUUID(),
		clockInDate: "2026-07-22",
		clockInTime: "08:00",
		clockOutDate: "2026-07-22",
		clockOutTime: "12:00",
		vehicleUse,
		reason,
	});
}

async function vehicleColumns(workPeriodId: string) {
	const { rows } = await admin.query<Record<string, unknown>>(
		`select wp.vehicle_kind, wp.vehicle_id, wp.odometer_start_km, wp.odometer_end_km,
		        wp.driven_distance_km,
		        w.vehicle_kind as detail_vehicle_kind, w.vehicle_id as detail_vehicle_id,
		        w.odometer_start_km as detail_start, w.odometer_end_km as detail_end,
		        w.driven_distance_km as detail_distance
		 from work_period wp
		 join time_record_work w on w.record_id = wp.canonical_record_id
		 where wp.organization_id = $1 and wp.id = $2`,
		[ORG, workPeriodId],
	);
	return rows[0];
}

async function workRows() {
	const { rows } = await admin.query(
		`select
		   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
		   (select json_agg(row_to_json(t) order by t.record_id) from time_record_work t where organization_id = $1) as works,
		   (select count(*) from approval_request t where organization_id = $1) as requests`,
		[ORG],
	);
	return rows[0];
}

const vanUse: VehicleUseInput = {
	vehicle: { kind: "organization", vehicleId: ids.van },
	startKm: 12_000,
	endKm: 12_085,
};

describe("vehicle use on a work period on PostgreSQL (#1120)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

	beforeEach(async () => {
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it.each(["active", "inactive"] as const)(
		"an admin records vehicle use on own work in the period and its canonical record (%s admission)",
		async (admission) => {
			const workPeriodId = await recordWork("admin");
			await setAdmission(admission);

			await expect(
				editVehicleUse("admin", workPeriodId, vanUse),
			).resolves.toMatchObject({
				success: true,
				data: { status: "applied" },
			});

			expect(await vehicleColumns(workPeriodId)).toEqual({
				vehicle_kind: "organization",
				vehicle_id: ids.van,
				odometer_start_km: 12_000,
				odometer_end_km: 12_085,
				driven_distance_km: 85,
				detail_vehicle_kind: "organization",
				detail_vehicle_id: ids.van,
				detail_start: 12_000,
				detail_end: 12_085,
				detail_distance: 85,
			});
			if (admission === "active") {
				const { rows } = await admin.query<{
					result: { changes: Record<string, unknown> };
				}>(
					`select result from completed_work_operation
					 where organization_id = $1 and kind = 'amend_completed_work' and work_period_id = $2`,
					[ORG, workPeriodId],
				);
				expect(rows[0]?.result.changes).toMatchObject({
					vehicleUse: true,
					clockIn: false,
				});
			}
		},
	);

	it.each(["absent", "suspended"] as const)(
		"truthfully attributes and corrects a vehicle used with %s driving authorization",
		async (drivingState) => {
			if (drivingState === "suspended")
				await seedSuspendedIntendedDriver(admin, {
					organizationId: ORG,
					employeeId: ids.requester,
					userId: userOf("requester"),
					at: new Date(WORK_START.epochMilliseconds),
				});
			const workPeriodId = await recordWork("requester");
			expect(
				await editVehicleUse("requester", workPeriodId, vanUse),
			).toMatchObject({ success: true, data: { status: "applied" } });
			expect(
				await editVehicleUse("requester", workPeriodId, {
					...vanUse,
					endKm: 12090,
				}),
			).toMatchObject({ success: true, data: { status: "applied" } });
			expect(await vehicleColumns(workPeriodId)).toMatchObject({
				vehicle_id: ids.van,
				odometer_end_km: 12090,
				driven_distance_km: 90,
				detail_vehicle_id: ids.van,
				detail_end: 12090,
				detail_distance: 90,
			});
			expect(
				(
					await admin.query(
						`select class_code from driving_authorization where organization_id=$1 and employee_id=$2 and state='active'`,
						[ORG, ids.requester],
					)
				).rows,
			).toEqual([]);
		},
	);
	it("takes a directly entered distance only while the start reading is missing", async () => {
		const workPeriodId = await recordWork("requester");

		await expect(
			editVehicleUse("requester", workPeriodId, {
				vehicle: { kind: "own" },
				startKm: null,
				endKm: null,
				distanceKm: 42,
			}),
		).resolves.toMatchObject({ success: true, data: { status: "applied" } });

		expect(await vehicleColumns(workPeriodId)).toMatchObject({
			vehicle_kind: "own",
			vehicle_id: null,
			odometer_start_km: null,
			driven_distance_km: 42,
			detail_vehicle_kind: "own",
			detail_distance: 42,
		});
	});

	it("refuses an end reading below the start reading and writes nothing", async () => {
		const workPeriodId = await recordWork("admin");
		const before = await workRows();

		await expect(
			editVehicleUse("admin", workPeriodId, {
				...vanUse,
				startKm: 12_000,
				endKm: 11_999,
			}),
		).resolves.toMatchObject({ success: false, code: "end_before_start" });
		expect(await workRows()).toEqual(before);
	});

	it.each(["active", "inactive"] as const)(
		"applies an employee's own change directly inside the self-service window (%s admission)",
		async (admission) => {
			const workPeriodId = await recordWork("requester");
			await setAdmission(admission);

			await expect(
				editVehicleUse("requester", workPeriodId, vanUse),
			).resolves.toMatchObject({
				success: true,
				data: { status: "applied" },
			});
			expect(await vehicleColumns(workPeriodId)).toMatchObject({
				vehicle_id: ids.van,
				driven_distance_km: 85,
				detail_distance: 85,
			});
		},
	);

	it.each(["inactive", "capture"] as const)(
		"routes an own change outside the direct window through a time correction with a before/after card (evidence %s)",
		async (evidence) => {
			await admin.query(
				`insert into approval_evidence_control (organization_id, workflow_type, mode)
			 values ($1, 'time_correction', $2)`,
				[ORG, evidence],
			);
			const workPeriodId = await recordWork("requester");
			await expect(
				editVehicleUse("requester", workPeriodId, {
					vehicle: { kind: "own" },
					distanceKm: 30,
				}),
			).resolves.toMatchObject({ success: true });
			harness.capability = { type: "approval_required" };

			await expect(
				editVehicleUse("requester", workPeriodId, vanUse, "Drove the van"),
			).resolves.toMatchObject({ success: true, data: { status: "pending" } });
			// Nothing changes before the decision.
			expect(await vehicleColumns(workPeriodId)).toMatchObject({
				vehicle_kind: "own",
				driven_distance_km: 30,
			});

			const { rows } = await admin.query<{ id: string }>(
				`select id from approval_request
			 where organization_id = $1 and entity_id = $2 and status = 'pending'`,
				[ORG, workPeriodId],
			);
			const approvalId = rows[0]?.id;
			if (!approvalId) throw new Error("no pending correction");

			actAs("manager");
			const detail = await getApprovalInboxDetail({
				approvalId,
				organizationId: ORG,
				approverId: ids.manager,
			});
			const vehicleRow = detail.sections
				.flatMap((section) =>
					section.type === "key_value" ? section.rows : [],
				)
				.find((row) => row.label.key === "approvals:approvals.vehicleUse");
			expect(vehicleRow?.value).toEqual({
				kind: "change",
				original: {
					kind: "vehicle_use",
					value: {
						state: "recorded",
						vehicle: { kind: "own" },
						startKm: null,
						endKm: null,
						distanceKm: 30,
					},
				},
				requested: {
					kind: "vehicle_use",
					value: {
						state: "recorded",
						vehicle: {
							kind: "organization",
							id: ids.van,
							label: "Van (B-VN 100)",
						},
						startKm: 12_000,
						endKm: 12_085,
						distanceKm: 85,
					},
				},
			});

			await approveApprovalInboxItem({
				approvalId,
				actorEmployeeId: ids.manager,
				organizationId: ORG,
			});
			expect(await vehicleColumns(workPeriodId)).toMatchObject({
				vehicle_kind: "organization",
				vehicle_id: ids.van,
				driven_distance_km: 85,
				detail_vehicle_id: ids.van,
				detail_distance: 85,
			});
		},
	);

	it("keeps a vehicle an open time correction requests from being deleted", async () => {
		const { changeOrganizationVehicles } = await import(
			"@/lib/organization/vehicles/vehicles"
		);
		const spare = "e1120000-0000-4000-8000-000000000024";
		const workPeriodId = await recordWork("requester");
		harness.capability = { type: "approval_required" };
		await expect(
			editVehicleUse("requester", workPeriodId, vanUse, "Drove the van"),
		).resolves.toMatchObject({ success: true, data: { status: "pending" } });
		await admin.query(
			`insert into organization_vehicle (id, organization_id, name, licence_plate)
			 values ($1, $2, 'Spare', 'B-SP 1')`,
			[spare, ORG],
		);
		const remove = (vehicleId: string) =>
			changeOrganizationVehicles(db, {
				organizationId: ORG,
				actorUserId: userOf("admin"),
				change: { kind: "delete", vehicleId },
			});

		// Approving would need the van: it can only be archived meanwhile.
		await expect(remove(ids.van)).resolves.toEqual({
			ok: false,
			reason: "vehicle_used",
		});
		// A vehicle no open correction names is still deleted.
		await expect(remove(spare)).resolves.toMatchObject({ ok: true });

		const { rows } = await admin.query<{ id: string }>(
			"select id from approval_request where organization_id = $1 and status = 'pending'",
			[ORG],
		);
		await approveApprovalInboxItem({
			approvalId: rows[0]?.id ?? "",
			actorEmployeeId: ids.manager,
			organizationId: ORG,
		});
		expect(await vehicleColumns(workPeriodId)).toMatchObject({
			vehicle_id: ids.van,
		});
	});

	it("refuses an own change outside the approval window", async () => {
		const workPeriodId = await recordWork("requester");
		harness.capability = { type: "forbidden", daysBack: 14 };

		await expect(
			editVehicleUse("requester", workPeriodId, vanUse),
		).resolves.toMatchObject({
			success: false,
			code: "beyond_approval_window",
		});
		expect(await vehicleColumns(workPeriodId)).toMatchObject({
			vehicle_kind: null,
		});
	});

	it.each(["active", "inactive"] as const)(
		"refuses a change of vehicle use inside a closed month (%s admission)",
		async (admission) => {
			const adminWork = await recordWork("admin");
			const requesterWork = await recordWork("requester");
			await setAdmission(admission);
			await admin.query(
				`insert into closed_month (id, organization_id, month, scope, actor_kind, closed_by)
				 values ($1, $2, '2026-07-01', 'organization', 'user', $3)`,
				[ids.closedMonth, ORG, userOf("admin")],
			);
			for (const person of ["admin", "requester"] as const) {
				await admin.query(
					`insert into closed_month_employee
					 (organization_id, closed_month_id, employee_id, month, range_start, range_end, timezone)
					 values ($1, $2, $3, '2026-07-01', '2026-07-01T00:00:00', '2026-08-01T00:00:00', 'UTC')`,
					[ORG, ids.closedMonth, ids[person]],
				);
			}

			await expect(
				editVehicleUse("admin", adminWork, vanUse),
			).resolves.toMatchObject({
				success: false,
				code: "month_closed",
			});
			await expect(
				editVehicleUse("requester", requesterWork, vanUse),
			).resolves.toMatchObject({
				success: false,
			});
			harness.capability = { type: "approval_required" };
			await expect(
				editVehicleUse("requester", requesterWork, vanUse, "Drove the van"),
			).resolves.toMatchObject({ success: false });
			expect(await vehicleColumns(adminWork)).toMatchObject({
				vehicle_kind: null,
			});
			expect(await vehicleColumns(requesterWork)).toMatchObject({
				vehicle_kind: null,
			});
			const { rows } = await admin.query(
				"select id from approval_request where organization_id = $1",
				[ORG],
			);
			expect(rows).toHaveLength(0);
		},
	);

	it.each(["active", "inactive"] as const)(
		"sends a submitted period back when vehicle use changes (%s admission)",
		async (admission) => {
			await admin.query(
				`insert into period_submission_cadence_change
			 (id, organization_id, cadence, week_start_day, changed_at, changed_by)
			 values ($1, $2, 'weekly', 'monday', '2026-06-01T00:00:00Z', $3)`,
				[randomUUID(), ORG, userOf("admin")],
			);
			const workPeriodId = await recordWork("requester");
			const submitted = await submitPeriodSubmission(
				{
					organizationId: ORG,
					userId: userOf("requester"),
					periodStartDate: "2026-07-20",
				},
				{
					database: db,
					clock: { nowInstant: () => parseInstant("2026-07-26T12:00:00Z") },
				},
			);
			if (submitted.kind !== "submitted")
				throw new Error(`not submitted: ${submitted.reason}`);
			await setAdmission(admission);

			await expect(
				editVehicleUse("requester", workPeriodId, vanUse),
			).resolves.toMatchObject({
				success: true,
			});

			const { rows } = await admin.query<{
				status: string;
				closed_cause: string | null;
			}>(
				"select status, closed_cause from period_submission where organization_id = $1 and id = $2",
				[ORG, submitted.submissionId],
			);
			expect(rows[0]).toEqual({ status: "withdrawn", closed_cause: "change" });
		},
	);

	it("keeps vehicle use organization-scoped and never newly picks an archived vehicle", async () => {
		const workPeriodId = await recordWork("admin");

		actAs("admin", { isOrgAdmin: true });
		const context = await getWorkPeriodTimeEditContext(workPeriodId);
		expect(context).toMatchObject({
			success: true,
			data: {
				vehicleUse: {
					mode: "asked",
					vehicles: [
						{
							id: ids.van,
							name: "Van",
							licencePlate: "B-VN 100",
							archived: false,
						},
					],
				},
			},
		});

		await expect(
			editVehicleUse("admin", workPeriodId, {
				vehicle: { kind: "organization", vehicleId: ids.foreign },
			}),
		).resolves.toMatchObject({ success: false, code: "vehicle_not_found" });
		await expect(
			editVehicleUse("admin", workPeriodId, {
				vehicle: { kind: "organization", vehicleId: ids.archived },
			}),
		).resolves.toMatchObject({ success: false, code: "vehicle_archived" });

		// A vehicle archived after it was recorded stays, and its readings can still change.
		await expect(
			editVehicleUse("admin", workPeriodId, vanUse),
		).resolves.toMatchObject({
			success: true,
		});
		// A vehicle recorded on work can no longer be deleted (#1118 refuses it as `vehicle_used`).
		await expect(
			admin.query("delete from organization_vehicle where id = $1", [ids.van]),
		).rejects.toMatchObject({ code: "23503" });
		await admin.query(
			"update organization_vehicle set archived_at = now() where id = $1",
			[ids.van],
		);
		await expect(
			editVehicleUse("admin", workPeriodId, { ...vanUse, endKm: 12_090 }),
		).resolves.toMatchObject({ success: true });
		expect(await vehicleColumns(workPeriodId)).toMatchObject({
			vehicle_id: ids.van,
			driven_distance_km: 90,
		});
		actAs("admin", { isOrgAdmin: true });
		const recorded = await getWorkPeriodTimeEditContext(workPeriodId);
		expect(recorded).toMatchObject({
			success: true,
			data: {
				values: {
					vehicleUse: { vehicle: { kind: "organization", vehicleId: ids.van } },
				},
				vehicleUse: { vehicles: [{ id: ids.van, archived: true }] },
			},
		});
	});

	it("shows vehicle use on the work period and names a manager who changed it on the employee's behalf", async () => {
		const workPeriodId = await recordWork("requester");

		actAs("manager");
		await expect(
			updateWorkPeriodTimes({
				workPeriodId,
				submissionId: randomUUID(),
				clockInDate: "2026-07-22",
				clockInTime: "08:00",
				clockOutDate: "2026-07-22",
				clockOutTime: "12:00",
				vehicleUse: vanUse,
				reason: "Drove the van",
			}),
		).resolves.toMatchObject({ success: true, data: { status: "applied" } });

		const [event] = (
			await getWorkPeriodsForMonth(
				6,
				2026,
				{ organizationId: ORG, employeeId: ids.requester },
				"UTC",
			)
		).filter((candidate) => candidate.id === workPeriodId);
		expect(event?.metadata).toMatchObject({
			vehicleUse: {
				vehicle: { kind: "organization", vehicleId: ids.van },
				startKm: 12_000,
				endKm: 12_085,
				distanceKm: 85,
			},
			vehicleLabel: "Van (B-VN 100)",
			editedByName: userOf("manager"),
		});
	});

	describe("manual entry", () => {
		function manualCommand(vehicleUse: Record<string, unknown>) {
			return {
				version: 2,
				submissionId: randomUUID(),
				targetEmployeeId: ids.requester,
				date: "2026-07-22",
				clockIn: { time: "08:00", occurrence: null, displayedOffsetMinutes: 0 },
				clockOut: {
					time: "12:00",
					occurrence: null,
					displayedOffsetMinutes: 0,
				},
				zone: { basis: "target", timezone: "UTC" },
				browserTimezone: "UTC",
				reason: "Forgot to clock in",
				projectId: null,
				workCategoryId: null,
				vehicleUse,
			};
		}

		function legacyEntry(vehicleUse: VehicleUseInput) {
			return {
				submissionId: randomUUID(),
				date: "2026-07-22",
				clockInTime: "08:00",
				clockOutTime: "12:00",
				reason: "Forgot to clock in",
				timezone: "UTC",
				vehicleUse,
			};
		}

		async function manualPeriod() {
			const { rows } = await admin.query<{ id: string }>(
				"select id from work_period where organization_id = $1 and employee_id = $2",
				[ORG, ids.requester],
			);
			const id = rows[0]?.id;
			if (!id) throw new Error("no manual work");
			return id;
		}

		it("records vehicle use from a versioned manual command", async () => {
			actAs("requester");
			await expect(
				createManualTimeEntry(
					manualCommand({
						vehicle: { kind: "organization", vehicleId: ids.van },
						startKm: 500,
						endKm: 540,
						distanceKm: null,
					}) as never,
				),
			).resolves.toMatchObject({ success: true });

			const workPeriodId = await manualPeriod();
			expect(await vehicleColumns(workPeriodId)).toMatchObject({
				vehicle_id: ids.van,
				odometer_start_km: 500,
				odometer_end_km: 540,
				driven_distance_km: 40,
				detail_vehicle_id: ids.van,
				detail_distance: 40,
			});
			const { rows } = await admin.query<{
				result: { attribution: Record<string, unknown> };
			}>(
				`select result from completed_work_operation
				 where organization_id = $1 and kind = 'create_completed_work'`,
				[ORG],
			);
			expect(rows[0]?.result.attribution.vehicleUse).toEqual({
				vehicle: { kind: "organization", vehicleId: ids.van },
				startKm: 500,
				endKm: 540,
				distanceKm: 40,
			});
		});

		it("records vehicle use from a legacy manual entry", async () => {
			await setAdmission("inactive");
			actAs("requester");
			await expect(
				createManualTimeEntry(
					legacyEntry({ vehicle: { kind: "own" }, distanceKm: 12 }),
				),
			).resolves.toMatchObject({ success: true });

			expect(await vehicleColumns(await manualPeriod())).toMatchObject({
				vehicle_kind: "own",
				driven_distance_km: 12,
				detail_vehicle_kind: "own",
				detail_distance: 12,
			});
		});

		it("refuses an end reading below the start reading and vehicle use that is not asked", async () => {
			actAs("requester");
			await expect(
				createManualTimeEntry(
					manualCommand({
						vehicle: { kind: "own" },
						startKm: 500,
						endKm: 400,
						distanceKm: null,
					}) as never,
				),
			).resolves.toMatchObject({
				success: false,
				rejection: { reason: "invalid_command", field: "vehicleUse.endKm" },
			});
			await setAdmission("inactive");
			await expect(
				createManualTimeEntry(
					legacyEntry({ vehicle: { kind: "own" }, startKm: 500, endKm: 400 }),
				),
			).resolves.toMatchObject({ success: false, code: "end_before_start" });

			await setVehicleUse("off");
			await expect(
				createManualTimeEntry(
					legacyEntry({ vehicle: { kind: "own" }, distanceKm: 3 }),
				),
			).resolves.toMatchObject({ success: false, code: "vehicle_use_off" });
			await setAdmission("active");
			await expect(
				createManualTimeEntry(
					manualCommand({
						vehicle: { kind: "own" },
						startKm: null,
						endKm: null,
						distanceKm: 3,
					}) as never,
				),
			).resolves.toMatchObject({
				success: false,
				rejection: { reason: "vehicle_use_refused", code: "vehicle_use_off" },
			});
			const { rows } = await admin.query(
				"select id from work_period where organization_id = $1 and employee_id = $2",
				[ORG, ids.requester],
			);
			expect(rows).toHaveLength(0);
		});
	});

	it("keeps existing vehicle use read-only while the organization switch is off", async () => {
		const workPeriodId = await recordWork("admin");
		await expect(
			editVehicleUse("admin", workPeriodId, vanUse),
		).resolves.toMatchObject({
			success: true,
		});
		await setVehicleUse("asked", false);

		await expect(
			editVehicleUse("admin", workPeriodId, { ...vanUse, endKm: 12_100 }),
		).resolves.toMatchObject({ success: false, code: "vehicle_use_off" });
		await expect(
			editVehicleUse("admin", workPeriodId, null),
		).resolves.toMatchObject({
			success: false,
			code: "vehicle_use_off",
		});
		actAs("admin", { isOrgAdmin: true });
		expect(await getWorkPeriodTimeEditContext(workPeriodId)).toMatchObject({
			success: true,
			data: {
				vehicleUse: { mode: "off", vehicles: [{ id: ids.van }] },
				values: { vehicleUse: { distanceKm: 85 } },
			},
		});
	});
});
