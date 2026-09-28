/**
 * The Clocking module's break (close-and-resume), through `run` only (#480):
 * legacy and append admission × client, derived and server operation identities.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * The work transactions are the real coordinated adapter, and follow-ups are
 * recorded. Only billing provisioning and the Next request/cache boundaries are
 * replaced.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	billing: { canAccess: true } as { canAccess: boolean; reason?: string },
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => harness.billing,
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

const { createClocking } = await import("./clocking");
const { recordingFollowUps } = await import("./follow-ups");
const { coordinatedTransactions } = await import("./transactions");
const { canonicalWorkRecordClient } = await import(
	"@/lib/time-tracking/canonical-work-record"
);
type BreakCommand = import("./types").BreakCommand;
type ClockTransactions = import("./transactions").ClockTransactions;

const ids = {
	organization: "t480-clocking-org",
	user: "t480-employee-user",
	otherUser: "t480-other-user",
	employee: "f4800000-0000-4000-8000-000000000001",
	other: "f4800000-0000-4000-8000-000000000002",
	project: "f4800000-0000-4000-8000-000000000011",
	workCategory: "f4800000-0000-4000-8000-000000000012",
	holidayCategory: "f4800000-0000-4000-8000-000000000021",
	holiday: "f4800000-0000-4000-8000-000000000022",
} as const;
const workStart = parseInstant("2026-07-22T08:00:00Z");
const resumeAt = parseInstant("2026-07-22T10:00:00Z");

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describe("Clocking break through run on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function newClocking(transactions: ClockTransactions = coordinatedTransactions()) {
		const followUps = recordingFollowUps();
		const clocking = createClocking({
			clock: { nowInstant: () => resumeAt } as never,
			transactions,
			followUps,
		});
		return { clocking, followUps };
	}

	function takeBreak(overrides: Partial<BreakCommand> = {}): BreakCommand {
		return {
			organizationId: ids.organization,
			principal: { kind: "user", userId: ids.user },
			subject: { employeeId: ids.employee },
			identity: { origin: "client", id: randomUUID() },
			channel: "web",
			at: { kind: "occurred", instant: resumeAt },
			zone: { device: "Europe/Berlin", fallback: "UTC" },
			body: { kind: "break", breakMinutes: 15 },
			...overrides,
		};
	}

	/** Live work started through the module, with a project the break carries or keeps. */
	async function startWork(at: Instant = workStart) {
		const { clocking } = newClocking();
		await expect(
			clocking.run({
				...takeBreak(),
				at: { kind: "occurred", instant: at },
				body: { kind: "clock_in", workLocationType: "home" },
			}),
		).resolves.toMatchObject({ outcome: "executed" });
		const { rows } = await admin.query<{ id: string }>(
			`update work_period set project_id = $2 where employee_id = $1 and end_time is null returning id`,
			[ids.employee, ids.project],
		);
		return only(rows);
	}

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	/** Every row a break can write, to prove "no writes" by equality. */
	async function snapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
			   (select json_agg(row_to_json(t) order by t.record_id) from time_record_work t where organization_id = $1) as record_work,
			   (select json_agg(row_to_json(t) order by t.id) from time_record_allocation t where organization_id = $1) as allocations,
			   (select json_agg(row_to_json(t) order by t.employee_id) from time_entry_append_position t where organization_id = $1) as positions,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts`,
			[ids.organization],
		);
		return only(rows);
	}

	async function periods() {
		const { rows } = await admin.query<{
			id: string;
			clock_in_id: string;
			start_time: Date;
			end_time: Date | null;
			duration_minutes: number | null;
			is_active: boolean;
			approval_status: string;
			project_id: string | null;
			work_location_type: string | null;
		}>(
			`select id, clock_in_id, start_time, end_time, duration_minutes, is_active,
			        approval_status, project_id, work_location_type
			 from work_period where employee_id = $1 and deleted_at is null order by start_time`,
			[ids.employee],
		);
		return rows;
	}

	/** The canonical work record a closed period points at, with its attribution. */
	async function canonicalRecord(periodId: string) {
		const { rows } = await admin.query(
			`select wp.duration_minutes as period_duration, tr.start_at, tr.end_at, tr.duration_minutes,
			        tr.record_kind, tr.approval_state, tr.origin, tr.created_by,
			        trw.work_category_id, trw.work_location_type,
			        (select json_agg(tra.project_id) from time_record_allocation tra
			         where tra.record_id = tr.id and tra.allocation_kind = 'project') as project_ids
			 from work_period wp
			 join time_record tr on tr.id = wp.canonical_record_id
			 left join time_record_work trw on trw.record_id = tr.id
			 where wp.id = $1`,
			[periodId],
		);
		return only(rows);
	}

	async function addHoliday(day: string) {
		await admin.query(
			`insert into holiday_category (id, organization_id, type, name, blocks_time_entry, updated_at)
			 values ($1, $2, 'public_holiday', 'Closed', true, now())`,
			[ids.holidayCategory, ids.organization],
		);
		await admin.query(
			`insert into holiday (id, organization_id, category_id, name, start_date, end_date, created_by, updated_at)
			 values ($1, $2, $3, 'Closing day', $4, $5, $6, now())`,
			[
				ids.holiday,
				ids.organization,
				ids.holidayCategory,
				`${day}T00:00:00`,
				`${day}T23:59:59`,
				ids.user,
			],
		);
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id in ($1, $2)', [ids.user, ids.otherUser]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T480 clocking', $1, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Employee', 't480-employee@example.test', $3, $3),
			 ($2, 'Other', 't480-other@example.test', $3, $3)`,
			[ids.user, ids.otherUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't480-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[ids.organization, timestamp, [ids.user, ids.otherUser]],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $5, 'employee', $6), ($3, $4, $5, 'manager', $6)`,
			[ids.employee, ids.user, ids.other, ids.otherUser, ids.organization, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[[ids.user, ids.otherUser], timestamp],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at)
			 values ($1, $2, 'Project', 'active', true, $3, $4)`,
			[ids.project, ids.organization, ids.otherUser, timestamp],
		);
		await admin.query(
			`insert into work_category (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Category', $3, $4)`,
			[ids.workCategory, ids.organization, ids.otherUser, timestamp],
		);
	}

	beforeEach(async () => {
		harness.billing = { canAccess: true };
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	describe.each([
		["legacy", "inactive"],
		["append", "active"],
	] as const)("%s admission", (admission, mode) => {
		beforeEach(async () => {
			await setAdmission(mode);
		});

		it("closes the work at the break start, resumes it, and follows up the closure", async () => {
			const active = await startWork();
			const { clocking, followUps } = newClocking();
			const command = takeBreak();

			const outcome = await clocking.run(command);

			const [closed, resumed] = await periods();
			expect(outcome).toEqual({
				outcome: "executed",
				result: { workPeriodId: resumed?.id, start: expect.anything() },
			});
			expect(outcome.outcome === "executed" && outcome.result.start.toString()).toBe(
				"2026-07-22T10:00:00Z",
			);
			expect(closed).toMatchObject({
				id: active.id,
				end_time: new Date("2026-07-22T09:45:00Z"),
				duration_minutes: 105,
				is_active: false,
				approval_status: "approved",
				project_id: ids.project,
			});
			expect(resumed).toMatchObject({
				clock_in_id: command.identity.id,
				start_time: new Date("2026-07-22T10:00:00Z"),
				is_active: true,
				work_location_type: "home",
				// Only the append writer carries the closed work's attribution.
				project_id: admission === "append" ? ids.project : null,
			});
			// Every executed closure gets the clock-out's follow-ups, legacy included.
			expect(followUps.closures).toEqual([
				{
					organizationId: ids.organization,
					employeeId: ids.employee,
					actorUserId: ids.user,
					workPeriodId: active.id,
					start: expect.anything(),
					durationMinutes: 105,
					projectId: ids.project,
					surchargeSnapshot: expect.objectContaining({ version: expect.anything() }),
					// The append operation commits its own balance refresh intent.
					balanceRefreshCommitted: admission === "append",
					timezone: "UTC",
				},
			]);
			expect(followUps.closures[0]?.start.toString()).toBe("2026-07-22T08:00:00Z");
			// Each endpoint keeps its own capture.
			const { rows: entries } = await admin.query<{ type: string; timezone: string }>(
				`select type, timezone from time_entry where employee_id = $1 order by timestamp`,
				[ids.employee],
			);
			expect(entries).toEqual([
				{ type: "clock_in", timezone: "Europe/Berlin" },
				{ type: "clock_out", timezone: "Europe/Berlin" },
				{ type: "clock_in", timezone: "Europe/Berlin" },
			]);
		});

		it("writes the closed segment's canonical work record from the period", async () => {
			const active = await startWork();
			await admin.query("update work_period set work_category_id = $2 where id = $1", [
				active.id,
				ids.workCategory,
			]);
			const { clocking } = newClocking();

			await expect(clocking.run(takeBreak())).resolves.toMatchObject({ outcome: "executed" });

			expect(await canonicalRecord(active.id)).toEqual({
				period_duration: 105,
				start_at: new Date("2026-07-22T08:00:00Z"),
				end_at: new Date("2026-07-22T09:45:00Z"),
				duration_minutes: 105,
				record_kind: "work",
				approval_state: "approved",
				origin: "clock",
				created_by: ids.user,
				work_category_id: ids.workCategory,
				work_location_type: "home",
				project_ids: [ids.project],
			});
		});

		it.each(["client", "derived"] as const)(
			"replays a committed %s identity without writes or follow-ups",
			async (origin) => {
				await startWork();
				const { clocking, followUps } = newClocking();
				const command = takeBreak({ identity: { origin, id: randomUUID() } });
				const executed = await clocking.run(command);
				expect(executed).toMatchObject({ outcome: "executed" });
				const committed = await snapshot();

				const retry = await clocking.run(command);

				expect(retry).toEqual({
					outcome: "replayed",
					result: executed.outcome === "executed" && executed.result,
				});
				expect(await snapshot()).toEqual(committed);
				expect(followUps.closures).toHaveLength(1);
			},
		);

		it("never replays a server identity", async () => {
			await startWork();
			const { clocking } = newClocking();
			const command = takeBreak({ identity: { origin: "server", id: randomUUID() } });
			await expect(clocking.run(command)).resolves.toMatchObject({ outcome: "executed" });
			const committed = await snapshot();

			// The resumed work started at the same instant, so the repeat cannot close it.
			await expect(clocking.run(command)).resolves.toEqual({
				outcome: "refused",
				failure: { code: "invalid_interval" },
			});
			expect(await snapshot()).toEqual(committed);
		});

		it("refuses the same identity with a different break as a collision", async () => {
			await startWork();
			const { clocking } = newClocking();
			const command = takeBreak();
			await expect(clocking.run(command)).resolves.toMatchObject({ outcome: "executed" });
			const committed = await snapshot();

			await expect(
				clocking.run({ ...command, body: { kind: "break", breakMinutes: 20 } }),
			).resolves.toMatchObject({ outcome: "refused", failure: { code: "collision" } });
			expect(await snapshot()).toEqual(committed);
		});

		it("refuses an identity another command already used as a collision", async () => {
			const { clocking } = newClocking();
			const clockIn = {
				...takeBreak(),
				at: { kind: "occurred", instant: workStart },
				body: { kind: "clock_in", workLocationType: "home" },
			} as const;
			await expect(clocking.run(clockIn)).resolves.toMatchObject({ outcome: "executed" });
			const committed = await snapshot();

			await expect(clocking.run(takeBreak({ identity: clockIn.identity }))).resolves.toMatchObject({
				outcome: "refused",
				failure: { code: "collision" },
			});
			expect(await snapshot()).toEqual(committed);
		});

		it("refuses a blocking holiday only for the resumed half", async () => {
			await addHoliday("2026-07-22");
			await startWork(parseInstant("2026-07-21T22:00:00Z"));
			const { clocking } = newClocking();
			const before = await snapshot();

			await expect(clocking.run(takeBreak())).resolves.toEqual({
				outcome: "refused",
				failure: { code: "holiday_blocked", holidayName: "Closing day" },
			});
			expect(await snapshot()).toEqual(before);

			// Closing on the holiday and resuming after it is a break like any other.
			await expect(
				clocking.run(
					takeBreak({
						at: { kind: "occurred", instant: parseInstant("2026-07-23T00:10:00Z") },
						body: { kind: "break", breakMinutes: 20 },
					}),
				),
			).resolves.toMatchObject({ outcome: "executed" });
		});

		it("refuses a break whose resumed interval other work occupies, without writes", async () => {
			await startWork();
			// Completed work that ends after the resume instant occupies it.
			await admin.query(
				`insert into work_period (id, organization_id, employee_id, clock_in_id, start_time, end_time,
				  duration_minutes, is_active, approval_status, updated_at)
				 select $1, $2, $3, clock_in_id, '2026-07-22T10:30:00Z', '2026-07-22T11:00:00Z', 30, false, 'approved', now()
				 from work_period where employee_id = $3 and end_time is null`,
				[randomUUID(), ids.organization, ids.employee],
			);
			const { clocking, followUps } = newClocking();
			const before = await snapshot();

			await expect(clocking.run(takeBreak())).resolves.toEqual({
				outcome: "refused",
				failure: { code: "occupancy_conflict" },
			});
			expect(await snapshot()).toEqual(before);
			expect(followUps.closures).toEqual([]);
		});

		it.each([
			["a pending time correction", "time_entry", "time_correction"],
			["its pending approval", null, "approval"],
		] as const)(
			"refuses a break while the work waits for %s",
			async (_name, requestEntity, review) => {
				const active = await startWork();
				if (requestEntity) {
					await admin.query(
						`insert into approval_request
						 (id, organization_id, entity_type, entity_id, requested_by, approver_id, status, reason, created_at, updated_at)
						 values ($1, $2, $3, $4, $5, $6, 'pending', 'Correction', now(), now())`,
						[randomUUID(), ids.organization, requestEntity, active.id, ids.employee, ids.other],
					);
				} else {
					await admin.query("update work_period set approval_status = 'pending' where id = $1", [
						active.id,
					]);
				}
				const { clocking } = newClocking();
				const before = await snapshot();

				await expect(clocking.run(takeBreak())).resolves.toEqual({
					outcome: "refused",
					failure: { code: "under_review", review },
				});
				expect(await snapshot()).toEqual(before);
			},
		);

		it("refuses without live work, and a break as long as the work", async () => {
			const { clocking } = newClocking();
			await expect(clocking.run(takeBreak())).resolves.toEqual({
				outcome: "refused",
				failure: { code: "not_clocked_in" },
			});
			await startWork();
			const before = await snapshot();

			await expect(
				clocking.run(takeBreak({ body: { kind: "break", breakMinutes: 120 } })),
			).resolves.toEqual({ outcome: "refused", failure: { code: "invalid_interval" } });
			expect(await snapshot()).toEqual(before);
		});

		it("refuses billing, another employee and malformed breaks without writes", async () => {
			await startWork();
			const { clocking } = newClocking();
			const before = await snapshot();

			harness.billing = { canAccess: false, reason: "subscription_expired" };
			await expect(clocking.run(takeBreak())).resolves.toEqual({
				outcome: "refused",
				failure: { code: "billing_required", reason: "subscription_expired" },
			});
			harness.billing = { canAccess: true };
			await expect(
				clocking.run(takeBreak({ principal: { kind: "user", userId: ids.otherUser } })),
			).resolves.toEqual({ outcome: "refused", failure: { code: "access_denied" } });
			for (const breakMinutes of [0, 1.5]) {
				await expect(
					clocking.run(takeBreak({ body: { kind: "break", breakMinutes } })),
				).resolves.toEqual({ outcome: "refused", failure: { code: "invalid_break_duration" } });
			}

			expect(await snapshot()).toEqual(before);
		});

		it("replays a matching break that commits after the first replay read", async () => {
			await startWork();
			const real = coordinatedTransactions();
			const { clocking: racing } = newClocking();
			const command = takeBreak();
			let raced = false;
			// The real adapter, paused after the first (replay) transaction so the
			// matching command commits before this one reads its target.
			const { clocking, followUps } = newClocking({
				...real,
				async run(scope, operation) {
					const result = await real.run(scope, operation);
					if (!raced) {
						raced = true;
						await expect(racing.run(command)).resolves.toMatchObject({ outcome: "executed" });
					}
					return result;
				},
			});

			await expect(clocking.run(command)).resolves.toMatchObject({ outcome: "replayed" });
			expect((await periods()).map(({ is_active }) => is_active)).toEqual([false, true]);
			expect(followUps.closures).toEqual([]);
		});
	});

	it("rolls back the whole legacy break when its canonical record fails to write", async () => {
		await setAdmission("inactive");
		await startWork();
		const { clocking, followUps } = newClocking();
		const create = canonicalWorkRecordClient.createForCompletedPeriod;
		// The record's rows are written, then the write fails.
		const failing = vi
			.spyOn(canonicalWorkRecordClient, "createForCompletedPeriod")
			.mockImplementationOnce(async (input, client) => {
				await create(input, client);
				throw new Error("canonical record write failed");
			});
		const before = await snapshot();

		try {
			await expect(clocking.run(takeBreak())).resolves.toMatchObject({
				outcome: "refused",
				failure: { code: "unconfirmed" },
			});
			expect(failing).toHaveBeenCalledOnce();
		} finally {
			failing.mockRestore();
		}
		expect(await snapshot()).toEqual(before);
		expect(followUps.closures).toEqual([]);
	});

	it("replays a legacy break after the organization adopts appends", async () => {
		await setAdmission("inactive");
		await startWork();
		const { clocking } = newClocking();
		const command = takeBreak();
		const executed = await clocking.run(command);
		expect(executed).toMatchObject({ outcome: "executed" });
		await setAdmission("active");
		const committed = await snapshot();

		await expect(clocking.run(command)).resolves.toEqual({
			outcome: "replayed",
			result: executed.outcome === "executed" && executed.result,
		});
		expect(await snapshot()).toEqual(committed);
	});
});
