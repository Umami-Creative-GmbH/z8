/**
 * #547: a legacy organization's break enforcement counts the breaks already taken on
 * the closed work's own local day, never on the day the follow-up runs. #549: it applies
 * the break rule in force when the work ended, looked up within its organization.
 *
 * PostgreSQL contract: pnpm --filter webapp test:integration
 * The real follow-up effect (`clockOutFollowUpEffects.enforceBreaks`) and the real
 * departure `clock_postprocess` handler run against seeded legacy work. The clock is
 * pinned (only `Date`) to the day the follow-up runs.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

const { clockOutFollowUpEffects } = await import("@/lib/time-tracking/clocking");
const { createClockPostprocessHandler } = await import(
	"@/lib/employee-lifecycle/clock-postprocess"
);

const ids = {
	organization: "t547-break-day-org",
	otherOrganization: "t547-break-day-other-org",
	user: "t547-employee-user",
	employee: "f5470000-0000-4000-8000-000000000001",
	policy: "f5472000-0000-4000-8000-000000000001",
	regulation: "f5472000-0000-4000-8000-000000000002",
	breakRule: "f5472000-0000-4000-8000-000000000003",
	policyAssignment: "f5472000-0000-4000-8000-000000000004",
} as const;

type Capture = { timezone: string | null; utcOffsetMinutes: number };
const UTC: Capture = { timezone: "UTC", utcOffsetMinutes: 0 };

type WorkOptions = {
	capture?: Capture;
	organizationId?: string;
	deleted?: boolean;
	rejected?: boolean;
};

describe("legacy break enforcement judges the work by its own day and policy on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = $1', [ids.user]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at)
			 values ($1, 'T547 breaks', $1, $3), ($2, 'T547 other', $2, $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, $1, $1 || '@example.test', $2, $2)`,
			[ids.user, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('t547-member', $1, $2, 'member', 'approved', $3)`,
			[ids.organization, ids.user, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at)
			 values ($1, $2, $3, 'employee', $4)`,
			[ids.employee, ids.user, ids.organization, timestamp],
		);
		// The viewer's setting names another zone than the work's own capture.
		await admin.query(
			"insert into user_settings (user_id, timezone, updated_at) values ($1, 'UTC', $2)",
			[ids.user, timestamp],
		);
		await admin.query(
			`insert into work_policy
			 (id, organization_id, name, schedule_enabled, regulation_enabled, is_active, created_by, updated_at)
			 values ($1, $2, 'T547 break', false, true, true, $3, $4)`,
			[ids.policy, ids.organization, ids.user, timestamp],
		);
		await admin.query(
			`insert into work_policy_regulation (id, policy_id, max_uninterrupted_minutes, updated_at)
			 values ($1, $2, 360, $3)`,
			[ids.regulation, ids.policy, timestamp],
		);
		await admin.query(
			`insert into work_policy_break_rule
			 (id, regulation_id, working_minutes_threshold, required_break_minutes, updated_at)
			 values ($1, $2, 360, 30, $3)`,
			[ids.breakRule, ids.regulation, timestamp],
		);
		await admin.query(
			`insert into work_policy_assignment
			 (id, policy_id, organization_id, assignment_type, employee_id, priority, is_active, created_by, updated_at)
			 values ($1, $2, $3, 'employee', $4, 2, true, $5, $6)`,
			[ids.policyAssignment, ids.policy, ids.organization, ids.employee, ids.user, timestamp],
		);
	}

	/** A second policy requiring 45 minutes after 6 hours, in `organizationId`. */
	async function stricterPolicy(organizationId: string) {
		const [policyId, regulationId] = [randomUUID(), randomUUID()];
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into work_policy
			 (id, organization_id, name, schedule_enabled, regulation_enabled, is_active, created_by, updated_at)
			 values ($1, $2, 'T549 stricter break', false, true, true, $3, $4)`,
			[policyId, organizationId, ids.user, timestamp],
		);
		await admin.query(
			`insert into work_policy_regulation (id, policy_id, max_uninterrupted_minutes, updated_at)
			 values ($1, $2, 360, $3)`,
			[regulationId, policyId, timestamp],
		);
		await admin.query(
			`insert into work_policy_break_rule
			 (id, regulation_id, working_minutes_threshold, required_break_minutes, updated_at)
			 values ($1, $2, 360, 45, $3)`,
			[randomUUID(), regulationId, timestamp],
		);
		return policyId;
	}

	/** The assignment priorities the schema names: the employee's wins over the default. */
	const assignmentPriority = { employee: 2, organization: 0 } as const;

	/** Assigns `policyId` to the employee or as the organization default, in force in `window`. */
	async function assignPolicy(
		policyId: string,
		organizationId: string,
		type: keyof typeof assignmentPriority,
		window: { from?: string; until?: string } = {},
	) {
		await admin.query(
			`insert into work_policy_assignment
			 (policy_id, organization_id, assignment_type, employee_id, priority, effective_from,
			  effective_until, is_active, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, true, $8, now())`,
			[
				policyId,
				organizationId,
				type,
				type === "employee" ? ids.employee : null,
				assignmentPriority[type],
				window.from ? new Date(window.from) : null,
				window.until ? new Date(window.until) : null,
				ids.user,
			],
		);
	}

	/** Completed legacy work: its clock-in and clock-out entries and the period. */
	async function work(start: string, end: string, options: WorkOptions = {}) {
		const organizationId = options.organizationId ?? ids.organization;
		const capture = options.capture ?? UTC;
		const entry = async (type: "clock_in" | "clock_out", at: string) => {
			const { rows } = await admin.query<{ id: string }>(
				`insert into time_entry
				 (employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone,
				  timezone_source, hash, created_by)
				 values ($1, $2, $3, $4, $5, $6, 'user_setting', $7, $8) returning id`,
				[
					ids.employee,
					organizationId,
					type,
					new Date(at),
					capture.utcOffsetMinutes,
					capture.timezone,
					`t547-${randomUUID()}`,
					ids.user,
				],
			);
			return rows[0]?.id;
		};
		const clockInId = await entry("clock_in", start);
		const clockOutId = await entry("clock_out", end);
		const durationMinutes = Math.floor((Date.parse(end) - Date.parse(start)) / 60_000);
		const { rows } = await admin.query<{ id: string }>(
			`insert into work_period
			 (employee_id, organization_id, clock_in_id, clock_out_id, start_time, end_time,
			  duration_minutes, is_active, approval_status, deleted_at, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $5) returning id`,
			[
				ids.employee,
				organizationId,
				clockInId,
				clockOutId,
				new Date(start),
				new Date(end),
				durationMinutes,
				options.rejected ? "rejected" : "approved",
				options.deleted ? new Date(end) : null,
			],
		);
		const id = rows[0]?.id;
		if (!id) throw new Error("work period insert failed");
		return { id, durationMinutes };
	}

	/** The clock-out follow-up's break enforcement, run at `runAt`. */
	function followUp(closed: { id: string; durationMinutes: number }, runAt: string) {
		vi.useFakeTimers({ toFake: ["Date"], now: new Date(runAt) });
		return clockOutFollowUpEffects.enforceBreaks({
			employeeId: ids.employee,
			organizationId: ids.organization,
			workPeriodId: closed.id,
			durationMinutes: closed.durationMinutes,
			timezone: "UTC",
			createdBy: ids.user,
		});
	}

	/** A departure's durable `clock_postprocess` task, run at `runAt`. */
	async function departurePostprocess(
		closed: { id: string; durationMinutes: number; start: string },
		runAt: string,
	) {
		vi.useFakeTimers({ toFake: ["Date"], now: new Date(runAt) });
		const progress: Record<string, unknown>[] = [];
		const { enforceBreaks, reconcileSurcharges, markBalanceDirty, checkProjectBudget } =
			clockOutFollowUpEffects;
		await createClockPostprocessHandler({
			enforceBreaks,
			reconcileSurcharges,
			markBalanceDirty,
			checkProjectBudget,
		})(
			{
				id: randomUUID(),
				organizationId: ids.organization,
				employeeId: ids.employee,
				employmentPeriodId: randomUUID(),
				departureId: null,
				kind: "clock_postprocess",
				payload: {
					workPeriodId: closed.id,
					durationMinutes: closed.durationMinutes,
					periodStartedAt: closed.start,
					timezone: "Europe/Berlin",
					createdBy: ids.user,
					surchargeSnapshot: null,
					balanceRefreshCommitted: true,
				},
				claimToken: randomUUID(),
				attemptCount: 1,
			},
			{ recordProgress: async (patch) => void progress.push(patch) },
		);
		return progress;
	}

	async function periods() {
		const { rows } = await admin.query<{
			id: string;
			start_time: Date;
			end_time: Date;
			duration_minutes: number;
			was_auto_adjusted: boolean;
		}>(
			`select id, start_time, end_time, duration_minutes, was_auto_adjusted
			 from work_period where organization_id = $1 order by start_time, id`,
			[ids.organization],
		);
		return rows;
	}

	beforeEach(async () => {
		await seed();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	afterAll(async () => {
		vi.useRealTimers();
		await cleanup();
	});

	it("counts the earlier breaks of the work's day when the clock-out follow-up runs the next day", async () => {
		await work("2026-07-22T06:00:00Z", "2026-07-22T07:00:00Z");
		// 7h01m after a 30-minute break: the rule's 30 minutes are already taken.
		const closed = await work("2026-07-22T07:30:00Z", "2026-07-22T14:31:00Z");
		const before = await periods();

		await expect(followUp(closed, "2026-07-23T09:00:00Z")).resolves.toEqual({
			wasAdjusted: false,
			affectedWorkPeriodIds: [closed.id],
		});
		expect(await periods()).toEqual(before);
	});

	it("counts the earlier breaks of the work's day in a departure postprocess after the cutoff", async () => {
		const berlin: Capture = { timezone: "Europe/Berlin", utcOffsetMinutes: 120 };
		await work("2026-07-22T06:00:00Z", "2026-07-22T07:00:00Z", { capture: berlin });
		// Closed at the cutoff, local midnight after the last working day.
		const start = "2026-07-22T07:30:00Z";
		const closed = await work(start, "2026-07-22T22:00:00Z", { capture: berlin });
		const before = await periods();

		const progress = await departurePostprocess({ ...closed, start }, "2026-07-22T22:17:00Z");

		expect(progress).toEqual([{ breaksEnforced: true, affectedWorkPeriodIds: [closed.id] }]);
		expect(await periods()).toEqual(before);
	});

	it.each([
		["its captured zone", { timezone: "America/New_York", utcOffsetMinutes: -240 }],
		["its captured offset without a zone", { timezone: null, utcOffsetMinutes: -240 }],
	])("counts a night shift's breaks from its start day in %s", async (_label, capture) => {
		// 19:00-20:00 and 20:30-03:31 New York time: the shift starts on July 22 there,
		// but on July 23 in UTC, the zone the follow-up is given.
		await work("2026-07-22T23:00:00Z", "2026-07-23T00:00:00Z", { capture });
		const closed = await work("2026-07-23T00:30:00Z", "2026-07-23T07:31:00Z", { capture });
		const before = await periods();

		await expect(followUp(closed, "2026-07-23T07:35:00Z")).resolves.toMatchObject({
			wasAdjusted: false,
		});
		expect(await periods()).toEqual(before);
	});

	it.each([
		["soft-deleted", { deleted: true }],
		["rejected", { rejected: true }],
		["another organization's", { organizationId: ids.otherOrganization }],
	] as const)("does not count a break after %s earlier work", async (_label, options) => {
		await work("2026-07-22T06:00:00Z", "2026-07-22T07:00:00Z", options);
		const closed = await work("2026-07-22T07:30:00Z", "2026-07-22T14:31:00Z");

		await expect(followUp(closed, "2026-07-22T14:35:00Z")).resolves.toMatchObject({
			wasAdjusted: true,
			adjustment: { breakMinutes: 30 },
		});
		expect((await periods()).filter((period) => period.id === closed.id)).toMatchObject([
			{ end_time: new Date("2026-07-22T13:30:00Z"), was_auto_adjusted: true },
		]);
	});

	// #549: the rule is the one in force when the closed work ended, in its organization.
	it("applies the break rule in force at the work's end when the assignment changed before enforcement", async () => {
		// The 45-minute policy applies when the work starts and again from the next day;
		// the 30-minute one only from mid-work until that evening, so it holds at the end.
		await admin.query(
			"update work_policy_assignment set effective_from = $2, effective_until = $3 where id = $1",
			[ids.policyAssignment, new Date("2026-07-22T10:00:00Z"), new Date("2026-07-22T20:00:00Z")],
		);
		const stricter = await stricterPolicy(ids.organization);
		await assignPolicy(stricter, ids.organization, "employee", { until: "2026-07-22T09:59:59Z" });
		await assignPolicy(stricter, ids.organization, "employee", { from: "2026-07-23T00:00:00Z" });
		const closed = await work("2026-07-22T07:30:00Z", "2026-07-22T14:31:00Z");

		await expect(followUp(closed, "2026-07-23T09:00:00Z")).resolves.toMatchObject({
			wasAdjusted: true,
			adjustment: { breakMinutes: 30, regulationName: "T547 break" },
		});
	});

	it("ignores the employee's assignment in another organization", async () => {
		// The organization's own rule is its default; the other organization's
		// employee-level assignment names the same employee id.
		await admin.query("delete from work_policy_assignment where id = $1", [ids.policyAssignment]);
		await assignPolicy(ids.policy, ids.organization, "organization");
		await assignPolicy(
			await stricterPolicy(ids.otherOrganization),
			ids.otherOrganization,
			"employee",
		);
		const closed = await work("2026-07-22T07:30:00Z", "2026-07-22T14:31:00Z");

		await expect(followUp(closed, "2026-07-22T14:35:00Z")).resolves.toMatchObject({
			wasAdjusted: true,
			adjustment: { breakMinutes: 30, regulationName: "T547 break" },
		});
	});

	it("does not count a gap before work that starts after the closed work ends", async () => {
		const closed = await work("2026-07-22T07:30:00Z", "2026-07-22T14:31:00Z");
		await work("2026-07-22T15:01:00Z", "2026-07-22T16:00:00Z");

		await expect(followUp(closed, "2026-07-22T16:05:00Z")).resolves.toMatchObject({
			wasAdjusted: true,
			adjustment: { breakMinutes: 30 },
		});
	});
});
