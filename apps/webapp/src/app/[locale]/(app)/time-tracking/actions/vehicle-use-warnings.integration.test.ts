/**
 * #1121 runtime evidence: vehicle use plausibility warnings from the manual entry
 * and edit dialog server actions, and on the approver's time-correction card, on a
 * disposable PostgreSQL database.
 *
 * The real server actions run (`clockIn`/`clockOut`, `updateWorkPeriodTimes`, the
 * warning checks, the approval inbox detail). Only the request/session, billing, the
 * Next cache, notification delivery, the change-policy capability and the CASL
 * preflights are replaced.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1121-warn-org" as string,
	isOrgAdmin: false,
	capability: { type: "direct", reason: "no_policy" } as
		| { type: "direct"; reason: string }
		| { type: "approval_required" },
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
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
			user: { id: harness.userId, name: harness.userId, email: `${harness.userId}@example.test` },
			session: { activeOrganizationId: harness.organizationId },
			employee: row
				? { id: row.id, organizationId: row.organizationId, role: row.role, teamId: row.teamId }
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
		logger: { ...original.logger, error: quiet, warn: quiet, info: quiet, debug: quiet },
	};
});

const { clockIn, clockOut } = await import("./clocking");
const { checkWorkPeriodVehicleUseWarnings, updateWorkPeriodTimes } = await import(
	"./work-period-time-edit"
);
const { checkVehicleUseWarnings } = await import("./vehicle-use-warnings");
const { changeLiveVehicleUse, getClockVehicleUseContext } = await import("./clock-vehicle-use");
await import("@/lib/approvals/init");
const { getApprovalInboxDetail } = await import("@/lib/approvals/inbox/read-service");

const ORG = "t1121-warn-org";
const ids = {
	admin: "f1121100-0000-4000-8000-000000000001",
	manager: "f1121100-0000-4000-8000-000000000002",
	requester: "f1121100-0000-4000-8000-000000000003",
	colleague: "f1121100-0000-4000-8000-000000000004",
	van: "f1121100-0000-4000-8000-000000000021",
} as const;
type Person = "admin" | "manager" | "requester" | "colleague";
const userOf = (person: Person) => `t1121-warn-${person}`;
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
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query('delete from "user" where id like $1', ["t1121-warn-%"]);
}

/** A completed work period with the van, inserted directly (the colleague's earlier trip). */
async function vanTrip(person: Person, start: string, end: string, startKm: number, endKm: number) {
	const clockInId = randomUUID();
	await admin.query(
		`insert into time_entry (id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
		   timezone, timezone_source, hash, created_by, created_at)
		 values ($1, $2, $3, 'clock_in', $4, 0, 'UTC', 'backfill', $6, $5, $4)`,
		[clockInId, ids[person], ORG, new Date(start), userOf(person), `hash-${clockInId}`],
	);
	await withCanonicalRecords(admin, (client) =>
		client.query(
			`insert into work_period (id, employee_id, organization_id, clock_in_id, start_time, end_time,
			   duration_minutes, is_active, vehicle_kind, vehicle_id, odometer_start_km, odometer_end_km,
			   driven_distance_km, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, false, 'organization', $8, $9, $10, $11, $5)`,
			[
				randomUUID(),
				ids[person],
				ORG,
				clockInId,
				new Date(start),
				new Date(end),
				Math.round((Date.parse(end) - Date.parse(start)) / 60_000),
				ids.van,
				startKm,
				endKm,
				endKm - startKm,
			],
		),
	);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values ($1, $1, $1, 'UTC', $2)`,
		[ORG, SEEDED_AT],
	);
	const people: [Person, string, string][] = [
		["admin", "admin", "admin"],
		["manager", "member", "manager"],
		["requester", "member", "employee"],
		["colleague", "member", "employee"],
	];
	for (const [person, memberRole, employeeRole] of people) {
		await admin.query(
			'insert into "user" (id, name, email, created_at, updated_at) values ($1, $1, $2, $3, $3)',
			[userOf(person), `${userOf(person)}@example.test`, SEEDED_AT],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ($1, $2, $3, $4, 'approved', $5)`,
			[`t1121-warn-member-${person}`, ORG, userOf(person), memberRole, SEEDED_AT],
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
		`insert into time_entry_append_control (organization_id, mode) values ($1, 'active')`,
		[ORG],
	);
	await admin.query(
		`insert into organization_vehicle (id, organization_id, name, licence_plate) values ($1, $2, 'Van', 'B-VN 100')`,
		[ids.van, ORG],
	);
	await admin.query(
		`insert into vehicle_use_setting (organization_id, enabled) values ($1, true)`,
		[ORG],
	);
	await admin.query(
		`insert into vehicle_use_assignment (organization_id, assignment_type, priority, mode, created_by)
		 values ($1, 'organization', 0, 'asked', $2)`,
		[ORG, userOf("admin")],
	);
	// The colleague drove the van the day before and read 12,500 km at the end.
	await vanTrip("colleague", "2026-07-21T08:00:00Z", "2026-07-21T12:00:00Z", 12_400, 12_500);
	harness.capability = { type: "direct", reason: "no_policy" };
}

/** Real clock-in and clock-out of the requester. */
async function recordWork() {
	actAs("requester");
	await expect(
		clockIn("office", { instant: WORK_START, browserTimezone: "UTC" }),
	).resolves.toMatchObject({ success: true });
	await expect(
		clockOut(undefined, undefined, {
			submissionId: randomUUID(),
			instant: WORK_END,
			browserTimezone: "UTC",
		}),
	).resolves.toMatchObject({ success: true });
	const { rows } = await admin.query<{ id: string }>(
		`select id from work_period
		 where organization_id = $1 and employee_id = $2 and start_time = $3 and deleted_at is null`,
		[ORG, ids.requester, new Date(WORK_START.epochMilliseconds)],
	);
	const id = rows[0]?.id;
	if (!id) throw new Error("work not recorded");
	return id;
}

/** 12,000 → 13,700 km in four hours: below the last end reading, 425 km/h, 1,700 km. */
const implausibleVanUse = {
	vehicle: { kind: "organization" as const, vehicleId: ids.van },
	startKm: 12_000,
	endKm: 13_700,
};
const times = {
	clockInDate: "2026-07-22",
	clockInTime: "08:00",
	clockOutDate: "2026-07-22",
	clockOutTime: "12:00",
};
const allWarnings = [
	{ code: "start_below_last_end", lastRecordedEndKm: 12_500 },
	{ code: "speed_above_limit", averageKmh: 425 },
	{ code: "distance_above_limit", distanceKm: 1_700 },
];

describe("vehicle use plausibility warnings on PostgreSQL (#1121)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

	beforeEach(async () => {
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("warns on a manual entry for the signed-in employee, and never for someone they may not enter work for", async () => {
		actAs("requester");
		await expect(
			checkVehicleUseWarnings({
				vehicleUse: implausibleVanUse,
				manual: { date: "2026-07-22", clockInTime: "08:00", clockOutTime: "12:00" },
			}),
		).resolves.toEqual({ success: true, data: { warnings: allWarnings } });

		await expect(
			checkVehicleUseWarnings({
				targetEmployeeId: ids.colleague,
				vehicleUse: implausibleVanUse,
				manual: { date: "2026-07-22", clockInTime: "08:00", clockOutTime: "12:00" },
			}),
		).resolves.toMatchObject({ success: false });
	});

	it("warns at clock-in when the van is on another employee's running work", async () => {
		const clockInId = randomUUID();
		await admin.query(
			`insert into time_entry (id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
			   timezone, timezone_source, hash, created_by, created_at)
			 values ($1, $2, $3, 'clock_in', now() - interval '1 hour', 0, 'UTC', 'backfill', $4, $5, now())`,
			[clockInId, ids.colleague, ORG, `hash-${clockInId}`, userOf("colleague")],
		);
		await admin.query(
			`insert into work_period (id, employee_id, organization_id, clock_in_id, start_time, is_active,
			   vehicle_kind, vehicle_id, odometer_start_km, updated_at)
			 values ($1, $2, $3, $4, now() - interval '1 hour', true, 'organization', $5, 12500, now())`,
			[randomUUID(), ids.colleague, ORG, clockInId, ids.van],
		);
		actAs("requester");
		await expect(
			checkVehicleUseWarnings({
				vehicleUse: { vehicle: { kind: "organization", vehicleId: ids.van }, startKm: 12_500 },
			}),
		).resolves.toEqual({
			success: true,
			data: { warnings: [{ code: "vehicle_on_other_live_work" }] },
		});
	});

	it("warns in the edit dialog over the edited times, and saving still succeeds", async () => {
		const workPeriodId = await recordWork();
		actAs("requester");
		await expect(
			checkWorkPeriodVehicleUseWarnings({ workPeriodId, vehicleUse: implausibleVanUse, ...times }),
		).resolves.toEqual({ success: true, data: { warnings: allWarnings } });
		// Over a whole day the speed is plausible.
		await expect(
			checkWorkPeriodVehicleUseWarnings({
				workPeriodId,
				vehicleUse: implausibleVanUse,
				...times,
				clockInTime: "00:00",
				clockOutTime: "23:00",
			}),
		).resolves.toEqual({
			success: true,
			data: { warnings: [allWarnings[0], allWarnings[2]] },
		});

		await expect(
			updateWorkPeriodTimes({
				workPeriodId,
				submissionId: randomUUID(),
				...times,
				vehicleUse: implausibleVanUse,
				reason: "",
			}),
		).resolves.toMatchObject({ success: true, data: { status: "applied" } });
	});

	it("gives another employee's work no warnings unless they may edit it", async () => {
		const workPeriodId = await recordWork();
		actAs("colleague");
		await expect(
			checkWorkPeriodVehicleUseWarnings({ workPeriodId, vehicleUse: implausibleVanUse, ...times }),
		).resolves.toMatchObject({ success: false });
	});

	it("shows the approver of a correction the same warnings", async () => {
		const workPeriodId = await recordWork();
		harness.capability = { type: "approval_required" };
		actAs("requester");
		await expect(
			updateWorkPeriodTimes({
				workPeriodId,
				submissionId: randomUUID(),
				...times,
				vehicleUse: implausibleVanUse,
				reason: "Drove the van",
			}),
		).resolves.toMatchObject({ success: true, data: { status: "pending" } });
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
		const warningRow = detail.sections
			.flatMap((section) => (section.type === "key_value" ? section.rows : []))
			.find(
				(row) =>
					typeof row.label === "object" &&
					"key" in row.label &&
					row.label.key === "approvals:approvals.vehicleUseWarnings",
			);
		expect(warningRow).toMatchObject({
			tone: "warning",
			value: {
				key: "approvals:approvals.vehicleUseWarningList",
				params: {
					warnings: [
						{
							key: "approvals:approvals.vehicleUseWarning.startBelowLastEnd",
							params: { lastEndKm: 12_500 },
						},
						{
							key: "approvals:approvals.vehicleUseWarning.speedAboveLimit",
							params: { speed: 425, limit: 150 },
						},
						{
							key: "approvals:approvals.vehicleUseWarning.distanceAboveLimit",
							params: { distance: 1_700, limit: 1_500 },
						},
					],
				},
			},
		});
	});
});

describe("clocking vehicle use from the web clock on PostgreSQL (#1122)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

	beforeEach(async () => {
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	const van = { kind: "organization" as const, vehicleId: ids.van };

	it("gives the clock the mode, the vehicles with their last end reading, and the live vehicle use", async () => {
		actAs("requester");
		await expect(getClockVehicleUseContext()).resolves.toMatchObject({
			success: true,
			data: {
				mode: "asked",
				vehicles: [expect.objectContaining({ id: ids.van, licencePlate: "B-VN 100" })],
				lastEndKmByVehicleId: { [ids.van]: 12_500 },
				live: null,
			},
		});

		await expect(
			clockIn("office", {
				submissionId: randomUUID(),
				browserTimezone: "UTC",
				vehicleUse: { vehicle: van, startKm: 12_500 },
			}),
		).resolves.toMatchObject({ success: true });

		await expect(getClockVehicleUseContext()).resolves.toMatchObject({
			success: true,
			data: {
				live: {
					workPeriodId: expect.any(String),
					vehicleUse: { vehicle: van, startKm: 12_500, endKm: null, distanceKm: null },
				},
			},
		});
	});

	it("changes the live vehicle use while clocked in, warns before the clock-out and records its end reading", async () => {
		actAs("requester");
		await clockIn("office", {
			submissionId: randomUUID(),
			browserTimezone: "UTC",
			vehicleUse: { vehicle: { kind: "own" } },
		});
		const context = await getClockVehicleUseContext();
		const workPeriodId = context.success ? context.data.live?.workPeriodId : undefined;
		if (!workPeriodId) throw new Error("no live work");

		await expect(
			changeLiveVehicleUse({ workPeriodId, vehicleUse: { vehicle: van, startKm: 12_000 } }),
		).resolves.toEqual({
			success: true,
			data: { vehicleUse: { vehicle: van, startKm: 12_000, endKm: null, distanceKm: null } },
		});
		const warned = await checkVehicleUseWarnings({
			vehicleUse: { vehicle: van, startKm: 12_000, endKm: 13_700 },
			closingWorkPeriodId: workPeriodId,
		});
		expect(warned.success && warned.data.warnings.map(({ code }) => code)).toEqual(
			expect.arrayContaining(["start_below_last_end", "distance_above_limit"]),
		);
		await expect(
			clockOut(undefined, undefined, {
				submissionId: randomUUID(),
				browserTimezone: "UTC",
				vehicleUse: { endKm: 12_040 },
			}),
		).resolves.toMatchObject({ success: true });

		const { rows } = await admin.query(
			`select vehicle_id, odometer_start_km, odometer_end_km, driven_distance_km
			   from work_period where id = $1`,
			[workPeriodId],
		);
		expect(rows).toEqual([
			{
				vehicle_id: ids.van,
				odometer_start_km: 12_000,
				odometer_end_km: 12_040,
				driven_distance_km: 40,
			},
		]);
		// Clocked out, there is no live work left to change.
		await expect(changeLiveVehicleUse({ workPeriodId, vehicleUse: null })).resolves.toMatchObject({
			success: false,
			code: "not_clocked_in",
		});
	});

	it("refuses an invalid live start reading with its refusal code", async () => {
		actAs("requester");
		await clockIn("office", { submissionId: randomUUID(), browserTimezone: "UTC" });
		const context = await getClockVehicleUseContext();
		const workPeriodId = context.success ? context.data.live?.workPeriodId : undefined;
		if (!workPeriodId) throw new Error("no live work");

		await expect(
			changeLiveVehicleUse({ workPeriodId, vehicleUse: { vehicle: van, startKm: 1.5 } }),
		).resolves.toMatchObject({ success: false, code: "invalid_reading" });
	});
});
