/**
 * #1125 / #1231 runtime evidence: completing a clock-out's vehicle use through the
 * completed-work amendment, in both admissions through the same caller code.
 *
 * The real `clockIn`/`clockOut` actions record the work and the real
 * `completeClockOutVehicleUse` completes it against PostgreSQL. Only the
 * request/session, external billing provisioning and the Next cache are replaced.
 * What the amended work carries is work records' contract
 * (`lib/time-tracking/work-records/amend.integration.test.ts`); this suite keeps the
 * caller: it never chooses by admission, and only where work records appended is a
 * receipt committed.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: { activeOrganizationId: harness.organizationId },
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

const { clockIn, clockOut } = await import("@/app/[locale]/(app)/time-tracking/actions/clocking");
const { completeClockOutVehicleUse } = await import("./clock-out-completion-store");
const { expectRecordAgreement } = await import(
	"@/lib/time-tracking/work-records/__tests__/expect-record-agreement"
);

const ids = {
	organization: "t1231-vehicle-completion-org",
	user: "t1231-vehicle-completion-user",
	employee: "e1231000-0000-4000-8000-000000000001",
	van: "e1231000-0000-4000-8000-000000000061",
} as const;
const workStart = parseInstant("2026-07-22T08:00:00Z");
const workEnd = parseInstant("2026-07-22T16:00:00Z");

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describe("clock-out vehicle use completion on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = $1', [ids.user]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T1231 vehicle use', $1, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, $1, $1 || '@example.test', $2, $2)`,
			[ids.user, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('t1231-member', $1, $2, 'member', 'approved', $3)`,
			[ids.organization, ids.user, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at)
			 values ($1, $2, $3, 'employee', $4)`,
			[ids.employee, ids.user, ids.organization, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at) values ($1, 'Europe/Berlin', $2)`,
			[ids.user, timestamp],
		);
		await admin.query(
			`insert into organization_vehicle (id, organization_id, name, licence_plate)
			 values ($1, $2, 'Van', 'B-VN 100')`,
			[ids.van, ids.organization],
		);
	}

	/** Real clock-in and clock-out without vehicle use, then vehicle use is asked. */
	async function recordWork() {
		harness.userId = ids.user;
		harness.organizationId = ids.organization;
		await expect(
			clockIn("office", { instant: workStart, browserTimezone: "Europe/Berlin" }),
		).resolves.toMatchObject({ success: true });
		await expect(
			clockOut(undefined, undefined, {
				submissionId: randomUUID(),
				instant: workEnd,
				browserTimezone: "Europe/Berlin",
			}),
		).resolves.toMatchObject({ success: true });
		await admin.query(
			`insert into vehicle_use_setting (organization_id, enabled) values ($1, true)`,
			[ids.organization],
		);
		await admin.query(
			`insert into vehicle_use_assignment (organization_id, assignment_type, priority, mode, created_by)
			 values ($1, 'organization', 0, 'asked', $2)`,
			[ids.organization, ids.user],
		);
		const { rows } = await admin.query<{
			id: string;
			clock_out_id: string;
			graph_revision: number;
		}>(
			`select id, clock_out_id, graph_revision from work_period
			 where organization_id = $1 and deleted_at is null`,
			[ids.organization],
		);
		return only(rows);
	}

	beforeEach(seed);

	afterAll(cleanup);

	it.each([
		["active", 1],
		["inactive", 0],
	] as const)(
		"completes the closed work's vehicle use under %s admission",
		async (admission, receiptCount) => {
			await setAdmission(admission);
			const period = await recordWork();

			await expect(
				completeClockOutVehicleUse({
					organizationId: ids.organization,
					employeeId: ids.employee,
					actorUserId: ids.user,
					workPeriodId: period.id,
					clockOutId: period.clock_out_id,
					supplied: {
						vehicle: { kind: "organization", vehicleId: ids.van },
						startKm: 12_000,
						endKm: 12_085,
					},
					now: workEnd.add({ hours: 1 }),
				}),
			).resolves.toEqual({
				vehicle: { kind: "organization", vehicleId: ids.van },
				startKm: 12_000,
				endKm: 12_085,
				distanceKm: 85,
			});

			const { rows } = await admin.query<{
				graph_revision: number;
				period: unknown;
				detail: unknown;
			}>(
				`select wp.graph_revision,
				   json_build_object('vehicle', wp.vehicle_id, 'start', wp.odometer_start_km,
				     'end', wp.odometer_end_km, 'distance', wp.driven_distance_km) as period,
				   json_build_object('vehicle', w.vehicle_id, 'start', w.odometer_start_km,
				     'end', w.odometer_end_km, 'distance', w.driven_distance_km) as detail
				 from work_period wp
				 join time_record_work w on w.record_id = wp.canonical_record_id
				 where wp.id = $1`,
				[period.id],
			);
			const van = { vehicle: ids.van, start: 12_000, end: 12_085, distance: 85 };
			expect(only(rows)).toEqual({
				graph_revision: period.graph_revision + 1,
				period: van,
				detail: van,
			});
			await expectRecordAgreement({ organizationId: ids.organization });
			const { rows: receipts } = await admin.query<{ writer: string }>(
				`select writer from completed_work_operation
				 where organization_id = $1 and kind = 'amend_completed_work'`,
				[ids.organization],
			);
			expect(receipts).toHaveLength(receiptCount);
			expect(receipts.map(({ writer }) => writer)).toEqual(
				Array(receiptCount).fill("work_period_attribution_edit"),
			);
		},
	);
});
