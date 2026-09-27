/**
 * The Clocking module's clock-in, through `run` only (#479): legacy and append
 * admission × client, derived and server operation identities.
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
type ClockInCommand = import("./types").ClockInCommand;
type ClockOutCommand = import("./types").ClockOutCommand;
type ClockTransactions = import("./transactions").ClockTransactions;

const ids = {
	organization: "t479-clocking-org",
	user: "t479-employee-user",
	otherUser: "t479-other-user",
	employee: "f4790000-0000-4000-8000-000000000001",
	other: "f4790000-0000-4000-8000-000000000002",
	holidayCategory: "f4790000-0000-4000-8000-000000000021",
	holiday: "f4790000-0000-4000-8000-000000000022",
} as const;
const clockInAt = parseInstant("2026-07-22T08:00:00Z");

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describe("Clocking clock-in through run on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function newClocking(transactions: ClockTransactions = coordinatedTransactions()) {
		const followUps = recordingFollowUps();
		const clocking = createClocking({
			clock: { nowInstant: () => clockInAt } as never,
			transactions,
			followUps,
		});
		return { clocking, followUps };
	}

	function clockIn(overrides: Partial<ClockInCommand> = {}): ClockInCommand {
		return {
			organizationId: ids.organization,
			principal: { kind: "user", userId: ids.user },
			subject: { employeeId: ids.employee },
			identity: { origin: "client", id: randomUUID() },
			channel: "web",
			at: { kind: "occurred", instant: clockInAt },
			zone: { device: "UTC", fallback: "UTC" },
			body: { kind: "clock_in", workLocationType: "remote" },
			...overrides,
		};
	}

	function clockOut(instant: Instant): ClockOutCommand {
		return {
			...clockIn(),
			at: { kind: "occurred", instant },
			body: {
				kind: "clock_out",
				project: { kind: "preserve" },
				workCategory: { kind: "preserve" },
			},
		};
	}

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	/** Every row a start can write, to prove "no writes" by equality. */
	async function snapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.employee_id) from time_entry_append_position t where organization_id = $1) as positions,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts`,
			[ids.organization],
		);
		return only(rows);
	}

	async function openPeriods() {
		const { rows } = await admin.query<{
			clock_in_id: string;
			start_time: Date;
			work_location_type: string;
			start_receipts: number;
		}>(
			`select wp.clock_in_id, wp.start_time, wp.work_location_type,
			        (select count(*)::int from completed_work_operation
			         where work_period_id = wp.id and kind = 'start_live_work') as start_receipts
			 from work_period wp where wp.employee_id = $1 and wp.end_time is null`,
			[ids.employee],
		);
		return rows;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id in ($1, $2)', [ids.user, ids.otherUser]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T479 clocking', $1, $2)`,
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
			 ($1, 'Employee', 't479-employee@example.test', $3, $3),
			 ($2, 'Other', 't479-other@example.test', $3, $3)`,
			[ids.user, ids.otherUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't479-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[ids.organization, timestamp, [ids.user, ids.otherUser]],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $5, 'employee', $6), ($3, $4, $5, 'employee', $6)`,
			[ids.employee, ids.user, ids.other, ids.otherUser, ids.organization, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[[ids.user, ids.otherUser], timestamp],
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

		it("starts live work under the operation identity and follows nothing up", async () => {
			const { clocking, followUps } = newClocking();
			const command = clockIn({ channel: "telegram-bot", zone: { device: null, fallback: "UTC" } });

			const outcome = await clocking.run(command);

			expect(outcome).toMatchObject({
				outcome: "executed",
				result: {
					id: command.identity.id,
					type: "clock_in",
					timestamp: new Date("2026-07-22T08:00:00Z"),
					deviceInfo: "telegram-bot",
					ipAddress: "bot",
					timezoneSource: "user_setting",
				},
			});
			expect(await openPeriods()).toEqual([
				{
					clock_in_id: command.identity.id,
					start_time: new Date("2026-07-22T08:00:00Z"),
					work_location_type: "remote",
					// Only the append writer keeps receipts.
					start_receipts: admission === "append" ? 1 : 0,
				},
			]);
			expect(followUps.closures).toEqual([]);
		});

		it.each(["client", "derived"] as const)(
			"replays a committed %s identity without writes",
			async (origin) => {
				const { clocking } = newClocking();
				const command = clockIn({ identity: { origin, id: randomUUID() } });
				await expect(clocking.run(command)).resolves.toMatchObject({ outcome: "executed" });
				const committed = await snapshot();

				const retry = await clocking.run(command);

				expect(retry).toEqual({
					outcome: "replayed",
					result: expect.objectContaining({ id: command.identity.id, type: "clock_in" }),
				});
				expect(await snapshot()).toEqual(committed);
			},
		);

		it("replays a committed start after its work was closed", async () => {
			const { clocking } = newClocking();
			const command = clockIn();
			await expect(clocking.run(command)).resolves.toMatchObject({ outcome: "executed" });
			await expect(clocking.run(clockOut(clockInAt.add({ hours: 1 })))).resolves.toMatchObject({
				outcome: "executed",
			});

			await expect(clocking.run(command)).resolves.toMatchObject({
				outcome: "replayed",
				result: { id: command.identity.id },
			});
		});

		it("never replays a server identity and says since when work runs", async () => {
			const { clocking } = newClocking();
			const command = clockIn({
				channel: "slack-bot",
				identity: { origin: "server", id: randomUUID() },
			});
			await expect(clocking.run(command)).resolves.toMatchObject({ outcome: "executed" });
			const committed = await snapshot();

			const repeat = await clocking.run({
				...command,
				at: { kind: "occurred", instant: clockInAt.add({ minutes: 5 }) },
			});

			expect(repeat).toEqual({
				outcome: "refused",
				failure: { code: "already_clocked_in", since: expect.anything() },
			});
			// Instants compare by their canonical strings.
			expect(
				repeat.outcome === "refused" &&
					repeat.failure.code === "already_clocked_in" &&
					repeat.failure.since.toString(),
			).toBe("2026-07-22T08:00:00Z");
			expect(await snapshot()).toEqual(committed);
		});

		it("refuses the same identity with a different command as a collision", async () => {
			const { clocking } = newClocking();
			const command = clockIn();
			await expect(clocking.run(command)).resolves.toMatchObject({ outcome: "executed" });
			const committed = await snapshot();

			const changed = await clocking.run({
				...command,
				body: { kind: "clock_in", workLocationType: "office" },
			});

			expect(changed).toMatchObject({ outcome: "refused", failure: { code: "collision" } });
			expect(await snapshot()).toEqual(committed);
		});

		it("refuses a start inside completed work as an occupancy conflict", async () => {
			const { clocking } = newClocking();
			await expect(clocking.run(clockIn())).resolves.toMatchObject({ outcome: "executed" });
			await expect(clocking.run(clockOut(clockInAt.add({ hours: 2 })))).resolves.toMatchObject({
				outcome: "executed",
			});
			const before = await snapshot();

			const inside = await clocking.run(
				clockIn({ at: { kind: "occurred", instant: clockInAt.add({ hours: 1 }) } }),
			);

			expect(inside).toEqual({ outcome: "refused", failure: { code: "occupancy_conflict" } });
			expect(await snapshot()).toEqual(before);
			// Where the completed work ends, a start is free.
			await expect(
				clocking.run(clockIn({ at: { kind: "occurred", instant: clockInAt.add({ hours: 2 }) } })),
			).resolves.toMatchObject({ outcome: "executed" });
		});

		it("replays a matching start that commits after the first replay read", async () => {
			const real = coordinatedTransactions();
			const { clocking: racing } = newClocking();
			const command = clockIn();
			let raced = false;
			// The real adapter, paused after the first (replay) transaction so the
			// matching command commits before this one starts.
			const { clocking } = newClocking({
				...real,
				async start(scope, operation) {
					const result = await real.start(scope, operation);
					if (!raced) {
						raced = true;
						await expect(racing.run(command)).resolves.toMatchObject({ outcome: "executed" });
					}
					return result;
				},
			});

			await expect(clocking.run(command)).resolves.toMatchObject({
				outcome: "replayed",
				result: { id: command.identity.id },
			});
			expect(await openPeriods()).toHaveLength(1);
		});

		it("refuses a blocking holiday with its own clock-in refusal", async () => {
			await admin.query(
				`insert into holiday_category (id, organization_id, type, name, blocks_time_entry, updated_at)
				 values ($1, $2, 'public_holiday', 'Closed', true, now())`,
				[ids.holidayCategory, ids.organization],
			);
			await admin.query(
				`insert into holiday (id, organization_id, category_id, name, start_date, end_date, created_by, updated_at)
				 values ($1, $2, $3, 'Closing day', '2026-07-22T00:00:00', '2026-07-22T23:59:59', $4, now())`,
				[ids.holiday, ids.organization, ids.holidayCategory, ids.user],
			);
			const { clocking } = newClocking();
			const before = await snapshot();

			await expect(clocking.run(clockIn())).resolves.toEqual({
				outcome: "refused",
				failure: { code: "holiday_blocked", holidayName: "Closing day" },
			});
			expect(await snapshot()).toEqual(before);
		});

		it("refuses billing, another employee, and malformed commands without writes", async () => {
			const { clocking } = newClocking();
			const before = await snapshot();

			harness.billing = { canAccess: false, reason: "subscription_expired" };
			await expect(clocking.run(clockIn())).resolves.toEqual({
				outcome: "refused",
				failure: { code: "billing_required", reason: "subscription_expired" },
			});
			harness.billing = { canAccess: true };
			await expect(
				clocking.run(clockIn({ principal: { kind: "user", userId: ids.otherUser } })),
			).resolves.toEqual({ outcome: "refused", failure: { code: "access_denied" } });
			await expect(
				clocking.run(clockIn({ identity: { origin: "client", id: "not-a-uuid" } })),
			).resolves.toEqual({ outcome: "refused", failure: { code: "invalid_command" } });
			await expect(
				clocking.run(clockIn({ body: { kind: "clock_in", workLocationType: "field" as never } })),
			).resolves.toEqual({ outcome: "refused", failure: { code: "invalid_work_location" } });

			expect(await snapshot()).toEqual(before);
		});

		it("refuses a stale command by its freshness, but replays it once committed", async () => {
			const { clocking } = newClocking();
			const stale = clockIn({
				at: { kind: "occurred", instant: clockInAt.subtract({ minutes: 10 }) },
				freshness: {
					earliest: clockInAt.subtract({ minutes: 5 }),
					latest: clockInAt.add({ minutes: 5 }),
				},
			});
			await expect(clocking.run(stale)).resolves.toEqual({
				outcome: "refused",
				failure: { code: "admission_window", reason: "too_old" },
			});

			const command = clockIn();
			await expect(clocking.run(command)).resolves.toMatchObject({ outcome: "executed" });
			// Retried after its window passed: the committed result replays.
			await expect(
				clocking.run({
					...command,
					freshness: {
						earliest: clockInAt.add({ hours: 1 }),
						latest: clockInAt.add({ hours: 2 }),
					},
				}),
			).resolves.toMatchObject({ outcome: "replayed" });
		});
	});

	it("replays a legacy start after the organization adopts appends", async () => {
		await setAdmission("inactive");
		const { clocking } = newClocking();
		const command = clockIn();
		await expect(clocking.run(command)).resolves.toMatchObject({ outcome: "executed" });
		await setAdmission("active");
		const committed = await snapshot();

		await expect(clocking.run(command)).resolves.toMatchObject({
			outcome: "replayed",
			result: { id: command.identity.id },
		});
		expect(await snapshot()).toEqual(committed);
	});
});
