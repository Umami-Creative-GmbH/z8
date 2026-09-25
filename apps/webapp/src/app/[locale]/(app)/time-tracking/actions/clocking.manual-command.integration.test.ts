/**
 * #308 / T44 runtime evidence: strict versioned manual commands through the
 * protected preparation and the completed-work operation.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real public `createManualTimeEntry` server action (authentication, billing,
 * target resolution, v2 routing) runs against that database, together with the
 * real approval routing and the real live `clockIn`. Only the request/session,
 * billing provisioning, notification delivery and Next cache boundaries are
 * replaced; the authoritative clock can be pinned per test to exercise one
 * evaluation instant. Append admission is enabled per organization by inserting
 * its control row directly: production has no setter.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import type { ManualTimeEntryCommand } from "@/lib/time-tracking/manual-command";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	now: null as Instant | null,
}));

vi.mock("@/db", async () => {
	const { Pool } = await import("pg");
	const { drizzle } = await import("drizzle-orm/node-postgres");
	const authSchema = await import("@/db/auth-schema");
	const schema = await import("@/db/schema");
	const { configurePostgresUtcTypes, withUtcPostgresSession } = await import("@/db/postgres-utc");
	configurePostgresUtcTypes();
	const pool = new Pool(
		withUtcPostgresSession({
			connectionString:
				process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL ??
				"postgresql://unconfigured@127.0.0.1:1/unconfigured",
			max: 12,
		}),
	);
	const db = drizzle({ client: pool, schema: { ...authSchema, ...schema } });
	return { ...authSchema, ...schema, db, pool };
});

vi.mock("@/lib/datetime/temporal-core", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...original,
		systemClock: Object.freeze({
			nowInstant: () => harness.now ?? original.systemClock.nowInstant(),
		}),
	};
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/cache")>()),
	revalidatePath: vi.fn(),
	revalidateTag: vi.fn(),
}));

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

vi.mock("@/lib/auth-helpers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/auth-helpers")>();
	const { db } = await import("@/db");
	const { loadOrganizationPrincipalContext } = await import("@/lib/authorization/principal-loader");
	return {
		...original,
		// The real loader on the test database, without Better Auth's session store.
		getPrincipalContext: async () =>
			harness.userId && harness.organizationId
				? loadOrganizationPrincipalContext(db, {
						userId: harness.userId,
						organizationId: harness.organizationId,
					})
				: null,
	};
});

vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("@/lib/notifications/triggers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/notifications/triggers")>();
	return Object.fromEntries(
		Object.entries(original).map(([name, value]) => [
			name,
			typeof value === "function" ? async () => undefined : value,
		]),
	);
});

vi.mock("./approvals", async (importOriginal) => ({
	...(await importOriginal<typeof import("./approvals")>()),
	sendManualEntryApprovalNotifications: async () => undefined,
	sendManualEntryApprovedNotification: async () => undefined,
}));

vi.mock("./shared", async (importOriginal) => {
	const original = await importOriginal<typeof import("./shared")>();
	return {
		...original,
		logger: {
			...original.logger,
			error: () => {},
			warn: () => {},
			info: () => {},
			debug: () => {},
		},
	};
});

const { createManualTimeEntry, lookupManualTimeEntry } = await import("../actions");
const { clockIn, clockOut } = await import("./clocking");
const { clearOrganizationTimeData } = await import("@/lib/demo/demo-data.service");

const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
const testSentinel = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL;
const integrationRequired = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED === "1";
const integrationConfiguration = resolveApprovalWorkflowRepositoryTestConfiguration({
	databaseUrl,
	required: integrationRequired,
	sentinel: testSentinel,
});
if (integrationConfiguration.status === "error") {
	throw new Error(
		`Invalid approval workflow repository test configuration: ${integrationConfiguration.reason}`,
	);
}
const describeIntegration =
	integrationConfiguration.status === "enabled" ? describe : describe.skip;
if (integrationConfiguration.status === "unavailable") {
	describe.skip(`manual command PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t308-manual-org",
	otherOrganization: "t308-other-org",
	employeeUser: "t308-employee-user",
	managerUser: "t308-manager-user",
	ownerUser: "t308-owner-user",
	peerUser: "t308-peer-user",
	employee: "e3080000-0000-4000-8000-000000000001",
	manager: "e3080000-0000-4000-8000-000000000002",
	owner: "e3080000-0000-4000-8000-000000000003",
	peer: "e3080000-0000-4000-8000-000000000004",
	managerLink: "e3080000-0000-4000-8000-000000000010",
	project: "e3080000-0000-4000-8000-000000000020",
	projectAssignment: "e3080000-0000-4000-8000-000000000021",
	changePolicy: "e3080000-0000-4000-8000-000000000030",
	changePolicyAssignment: "e3080000-0000-4000-8000-000000000031",
	holidayCategory: "e3080000-0000-4000-8000-000000000040",
	holiday: "e3080000-0000-4000-8000-000000000041",
	category: "e3080000-0000-4000-8000-000000000050",
	categorySet: "e3080000-0000-4000-8000-000000000051",
	categorySetAssignment: "e3080000-0000-4000-8000-000000000052",
} as const;
const users = [ids.employeeUser, ids.managerUser, ids.ownerUser, ids.peerUser];

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

type Endpoint = ManualTimeEntryCommand["clockIn"];
const at = (
	time: string,
	displayedOffsetMinutes: number,
	occurrence: Endpoint["occurrence"] = null,
) => ({
	time,
	occurrence,
	displayedOffsetMinutes,
});

/** A Berlin summer entry for the signed-in employee unless overridden. */
function manualCommand(overrides: Partial<ManualTimeEntryCommand> = {}): ManualTimeEntryCommand {
	return {
		version: 2,
		submissionId: randomUUID(),
		targetEmployeeId: ids.employee,
		date: "2026-09-01",
		clockIn: at("08:00", 120),
		clockOut: at("12:30", 120),
		zone: { basis: "target", timezone: "Europe/Berlin" },
		browserTimezone: "Europe/Berlin",
		reason: "  Forgot to clock in  ",
		projectId: null,
		workCategoryId: null,
		...overrides,
	};
}

describeIntegration("strict versioned manual commands on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 8 });

	function actAs(userId: string, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	function submit(
		command: ManualTimeEntryCommand | Record<string, unknown>,
		as = ids.employeeUser,
	) {
		actAs(as);
		return createManualTimeEntry(command as ManualTimeEntryCommand);
	}

	async function setAppend(mode: "active" | "inactive" | null) {
		await admin.query("delete from time_entry_append_control where organization_id = $1", [
			ids.organization,
		]);
		if (mode) {
			await admin.query(
				"insert into time_entry_append_control (organization_id, mode) values ($1, $2)",
				[ids.organization, mode],
			);
		}
	}

	/** Every row a manual submission can write, to prove "no writes" by equality. */
	async function snapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
			   (select json_agg(row_to_json(t) order by t.record_id) from time_record_work t where organization_id = $1) as details,
			   (select json_agg(row_to_json(t) order by t.id) from time_record_allocation t where organization_id = $1) as allocations,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts,
			   (select json_agg(row_to_json(t) order by t.employee_id) from time_entry_append_position t where organization_id = $1) as positions,
			   (select json_agg(row_to_json(t) order by t.id) from approval_request t where organization_id = $1) as requests,
			   (select json_agg(row_to_json(t) order by t.id) from employee_work_balance t where organization_id = $1) as balances,
			   (select json_agg(row_to_json(t) order by t.id) from work_break_adjustment_intent t where organization_id = $1) as break_intents`,
			[ids.organization],
		);
		return only(rows);
	}

	async function periods() {
		const { rows } = await admin.query<{
			id: string;
			start_time: Date;
			end_time: Date | null;
			duration_minutes: number | null;
			approval_status: string;
			graph_revision: number;
			canonical_record_id: string | null;
			project_id: string | null;
			clock_in_id: string;
			clock_out_id: string | null;
		}>(
			"select * from work_period where organization_id = $1 and employee_id = $2 order by start_time",
			[ids.organization, ids.employee],
		);
		return rows;
	}

	async function holdAdvisoryLock(key: string) {
		const client = await admin.connect();
		await client.query("begin");
		await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
		return {
			async release() {
				await client.query("commit");
				client.release();
			},
		};
	}

	async function waitForAdvisoryWaiter() {
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const { rows } = await admin.query(
				"select 1 from pg_locks where locktype = 'advisory' and not granted limit 1",
			);
			if (rows.length > 0) return;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error("No transaction waited on an advisory lock");
	}

	async function cleanup() {
		await admin.query("drop function if exists t308_fail() cascade");
		await admin.query("drop function if exists t310_hold() cascade");
		await admin.query("drop function if exists t327_park() cascade");
		await admin.query("drop function if exists t327_fail() cascade");
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T308 manual', $1, 'Europe/Berlin', $3), ($2, 'T308 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t308-m-employee', $1, $2, 'member', 'approved', $6),
			 ('t308-m-manager', $1, $3, 'member', 'approved', $6),
			 ('t308-m-owner', $1, $4, 'owner', 'approved', $6),
			 ('t308-m-peer', $1, $5, 'member', 'approved', $6)`,
			[ids.organization, ids.employeeUser, ids.managerUser, ids.ownerUser, ids.peerUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $9, 'employee', $10), ($3, $4, $9, 'manager', $10),
			 ($5, $6, $9, 'employee', $10), ($7, $8, $9, 'employee', $10)`,
			[
				ids.employee,
				ids.employeeUser,
				ids.manager,
				ids.managerUser,
				ids.owner,
				ids.ownerUser,
				ids.peer,
				ids.peerUser,
				ids.organization,
				timestamp,
			],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at) values
			 ($1, 'Europe/Berlin', $4), ($2, 'UTC', $4), ($3, 'Europe/Berlin', $4)`,
			[ids.employeeUser, ids.managerUser, ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $2, $3, true, $4, now(), now())`,
			[ids.managerLink, ids.employee, ids.manager, ids.managerUser],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'manual_time_submission', 'legacy', 'legacy', now(), now())`,
			[ids.organization],
		);
		await setAppend("active");
	}

	async function seedChangePolicy(input: {
		selfServiceDays: number;
		approvalDays: number;
		effectiveFrom?: string | null;
		effectiveUntil?: string | null;
	}) {
		await admin.query(
			`insert into change_policy
			 (id, organization_id, name, self_service_days, approval_days, created_by, updated_at)
			 values ($1, $2, 'T308 policy', $3, $4, $5, now())`,
			[
				ids.changePolicy,
				ids.organization,
				input.selfServiceDays,
				input.approvalDays,
				ids.ownerUser,
			],
		);
		await admin.query(
			`insert into change_policy_assignment
			 (id, policy_id, organization_id, assignment_type, priority, effective_from, effective_until, created_by, updated_at)
			 values ($1, $2, $3, 'organization', 0, $4, $5, $6, now())`,
			[
				ids.changePolicyAssignment,
				ids.changePolicy,
				ids.organization,
				input.effectiveFrom ?? null,
				input.effectiveUntil ?? null,
				ids.ownerUser,
			],
		);
	}

	beforeAll(async () => {
		const enabled = await verifyApprovalWorkflowRepositoryTestDatabase({
			databaseUrl,
			required: integrationRequired,
			sentinel: testSentinel,
			currentDatabase: async () => {
				const result = await admin.query<{ database_name: string }>(
					"select current_database() as database_name",
				);
				return result.rows[0]?.database_name ?? "";
			},
		});
		if (enabled.status !== "enabled") {
			throw new Error("Manual command PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		harness.now = null;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	describe("adoption gating", () => {
		it("writes nothing for a version-2 command until the organization adopts", async () => {
			await setAppend(null);
			const before = await snapshot();

			await expect(submit(manualCommand())).resolves.toMatchObject({
				success: false,
				code: "manual_entry_not_adopted",
			});
			await setAppend("inactive");
			await expect(submit(manualCommand())).resolves.toMatchObject({
				success: false,
				code: "manual_entry_not_adopted",
			});
			expect(await snapshot()).toEqual(before);
		});

		it("keeps legacy input legacy before adoption and replay-only after it", async () => {
			await setAppend(null);
			const legacy = {
				submissionId: randomUUID(),
				date: "2026-09-02",
				clockInTime: "09:00",
				clockOutTime: "10:00",
				reason: "Legacy form",
				timezone: "Europe/Berlin",
				browserTimezone: "Europe/Berlin",
			};
			const committed = await submit(legacy);
			expect(committed).toMatchObject({ success: true });
			const { rows: receiptsBefore } = await admin.query(
				"select id from completed_work_operation where organization_id = $1",
				[ids.organization],
			);
			expect(receiptsBefore).toEqual([]);

			await setAppend("active");
			const before = await snapshot();
			// The committed legacy submission still replays exactly.
			await expect(submit(legacy)).resolves.toEqual(committed);
			// Fresh legacy input is refused once absence is established.
			await expect(
				submit({ ...legacy, submissionId: randomUUID(), date: "2026-09-03" }),
			).resolves.toMatchObject({ success: false, code: "manual_entry_refresh_required" });
			expect(await snapshot()).toEqual(before);
		});
	});

	describe("committed graph and replay", () => {
		it("commits the exact interval, captures, receipt and balance intent in one operation", async () => {
			const command = manualCommand();

			const result = await submit(command);

			expect(result).toEqual({
				success: true,
				data: {
					workPeriodId: command.submissionId,
					requiresApproval: false,
					disposition: "executed",
				},
			});
			const period = only(await periods());
			expect(period).toMatchObject({
				id: command.submissionId,
				start_time: new Date("2026-09-01T06:00:00Z"),
				end_time: new Date("2026-09-01T10:30:00Z"),
				duration_minutes: 270,
				approval_status: "approved",
				graph_revision: 1,
			});
			const { rows: entries } = await admin.query(
				`select id, type, timestamp, utc_offset_minutes, timezone, timezone_source, notes, created_by, previous_entry_id
				 from time_entry where organization_id = $1 order by timestamp`,
				[ids.organization],
			);
			expect(entries).toEqual([
				expect.objectContaining({
					id: period.clock_in_id,
					type: "clock_in",
					utc_offset_minutes: 120,
					timezone: "Europe/Berlin",
					timezone_source: "browser",
					notes: "Manual entry: Forgot to clock in",
					created_by: ids.employeeUser,
					previous_entry_id: null,
				}),
				expect.objectContaining({
					id: period.clock_out_id,
					type: "clock_out",
					utc_offset_minutes: 120,
					notes: "Forgot to clock in",
					previous_entry_id: period.clock_in_id,
				}),
			]);
			const record = only(
				(
					await admin.query("select * from time_record where organization_id = $1", [
						ids.organization,
					])
				).rows,
			);
			expect(record).toMatchObject({
				id: period.canonical_record_id,
				origin: "manual",
				approval_state: "approved",
				duration_minutes: 270,
			});
			const receipt = only(
				(
					await admin.query("select * from completed_work_operation where organization_id = $1", [
						ids.organization,
					])
				).rows,
			);
			expect(receipt).toMatchObject({
				id: command.submissionId,
				kind: "create_completed_work",
				writer: "manual_entry",
				command_version: 2,
				append_admission: "append",
				actor_kind: "human",
				actor_user_id: ids.employeeUser,
				work_period_id: command.submissionId,
			});
			// Submitted representation, untrimmed, separate from the normalized result.
			expect(receipt.command).toEqual(command);
			expect(receipt.result).toMatchObject({
				segment: {
					startAt: "2026-09-01T06:00:00Z",
					endAt: "2026-09-01T10:30:00Z",
					durationMinutes: 270,
					startUtcOffsetMinutes: 120,
					endUtcOffsetMinutes: 120,
				},
				interpretation: {
					timezone: "Europe/Berlin",
					captureSource: "browser",
					targetZone: { timezone: "Europe/Berlin", source: "employee" },
					onBehalf: false,
					approvalIntent: { intent: "direct", reason: "no_policy" },
				},
				approval: { participation: "none" },
				append: { admission: "append", previousEntryId: null, tipEntryId: period.clock_out_id },
				followUps: expect.arrayContaining([
					{
						kind: "work_balance_refresh",
						delivery: "committed_intent",
						dirtyFromDate: "2026-09-01",
					},
				]),
			});
			expect(
				only(
					(
						await admin.query(
							"select admitted_operation, last_operation, tip_entry_id, entry_count from time_entry_append_position where employee_id = $1",
							[ids.employee],
						)
					).rows,
				),
			).toEqual({
				admitted_operation: "manual_entry",
				last_operation: "manual_entry",
				tip_entry_id: period.clock_out_id,
				entry_count: 2,
			});
			expect(
				only(
					(
						await admin.query(
							"select is_dirty, dirty_from_date from employee_work_balance where employee_id = $1",
							[ids.employee],
						)
					).rows,
				),
			).toMatchObject({ is_dirty: true });
		});

		it("replays the exact command without writes and refuses a changed command under the identity", async () => {
			const command = manualCommand();
			await submit(command);
			const before = await snapshot();

			await expect(submit(structuredClone(command))).resolves.toEqual({
				success: true,
				data: {
					workPeriodId: command.submissionId,
					requiresApproval: false,
					disposition: "replayed",
				},
			});
			await expect(submit({ ...command, reason: "Different reason" })).resolves.toMatchObject({
				success: false,
				code: "manual_entry_collision",
			});
			expect(await snapshot()).toEqual(before);
		});

		it("still replays a committed command after a return to inactive", async () => {
			const command = manualCommand();
			await submit(command);
			await setAppend("inactive");
			const before = await snapshot();

			await expect(submit(command)).resolves.toMatchObject({
				success: true,
				data: { workPeriodId: command.submissionId, disposition: "replayed" },
			});
			expect(await snapshot()).toEqual(before);
		});

		it("replays before fresh checks, and deleted work is a collision, never recreated", async () => {
			const command = manualCommand();
			await submit(command);
			// A later configuration change does not reinterpret the committed command.
			await admin.query("update user_settings set timezone = 'Asia/Tokyo' where user_id = $1", [
				ids.employeeUser,
			]);
			await expect(submit(command)).resolves.toMatchObject({
				success: true,
				data: { disposition: "replayed" },
			});

			await admin.query("update work_period set deleted_at = now() where id = $1", [
				command.submissionId,
			]);
			await expect(submit(command)).resolves.toMatchObject({
				success: false,
				code: "manual_entry_collision",
			});
			expect(await periods()).toHaveLength(1);
		});

		it("rolls back every row when a late write fails", async () => {
			await admin.query(`create function t308_fail() returns trigger language plpgsql as $$
				begin raise exception 'injected receipt failure'; end $$`);
			await admin.query(
				"create trigger t308_fail before insert on completed_work_operation for each row execute function t308_fail()",
			);
			const before = await snapshot();

			await expect(submit(manualCommand())).resolves.toMatchObject({ success: false });

			expect(await snapshot()).toEqual(before);
		});
	});

	describe("zone and DST interpretation", () => {
		it("rejects a spring-forward time and a missing occurrence choice with nothing written", async () => {
			const before = await snapshot();
			await expect(
				submit(
					manualCommand({
						date: "2026-03-29",
						clockIn: at("02:30", 60),
						clockOut: at("05:00", 120),
					}),
				),
			).resolves.toMatchObject({
				success: false,
				code: "nonexistent_time",
				rejection: { reason: "nonexistent_time", endpoint: "clockIn" },
			});
			await expect(
				submit(
					manualCommand({
						date: "2025-10-26",
						clockIn: at("01:00", 120),
						clockOut: at("02:30", 60),
					}),
				),
			).resolves.toMatchObject({
				success: false,
				rejection: {
					reason: "occurrence_required",
					endpoint: "clockOut",
					earlierOffsetMinutes: 120,
					laterOffsetMinutes: 60,
				},
			});
			expect(await snapshot()).toEqual(before);
		});

		it("interprets both explicit occurrences and orders repeated-hour endpoints by UTC", async () => {
			const command = manualCommand({
				date: "2025-10-26",
				clockIn: at("02:40", 120, "earlier"),
				clockOut: at("02:10", 60, "later"),
			});

			await expect(submit(command)).resolves.toMatchObject({ success: true });

			expect(only(await periods())).toMatchObject({
				start_time: new Date("2025-10-26T00:40:00Z"),
				end_time: new Date("2025-10-26T01:10:00Z"),
				duration_minutes: 30,
			});
			const { rows } = await admin.query(
				"select utc_offset_minutes from time_entry where organization_id = $1 order by timestamp",
				[ids.organization],
			);
			expect(rows.map((row) => row.utc_offset_minutes)).toEqual([120, 60]);
		});

		it("requires reconfirmation for a changed zone, ambiguity or displayed offset", async () => {
			const before = await snapshot();
			await admin.query("update user_settings set timezone = 'Europe/Paris' where user_id = $1", [
				ids.employeeUser,
			]);
			// Paris shares Berlin's offsets; a different IANA zone still needs confirmation.
			await expect(submit(manualCommand())).resolves.toMatchObject({
				success: false,
				rejection: {
					reason: "reconfirmation_required",
					detail: "zone_changed",
					timezone: "Europe/Paris",
				},
			});
			await admin.query("update user_settings set timezone = 'Europe/Berlin' where user_id = $1", [
				ids.employeeUser,
			]);
			await expect(
				submit(manualCommand({ clockIn: at("08:00", 120, "later") })),
			).resolves.toMatchObject({
				rejection: { reason: "reconfirmation_required", detail: "ambiguity_changed" },
			});
			await expect(submit(manualCommand({ clockOut: at("12:30", 60) }))).resolves.toMatchObject({
				rejection: {
					reason: "reconfirmation_required",
					detail: "offset_mismatch",
					endpoint: "clockOut",
				},
			});
			expect(await snapshot()).toEqual(before);
		});

		it("revalidates a same-zone fallback-source change without reconfirmation", async () => {
			await admin.query("delete from user_settings where user_id = $1", [ids.employeeUser]);

			const command = manualCommand({ browserTimezone: null });
			await expect(submit(command)).resolves.toMatchObject({ success: true });

			const { rows } = await admin.query(
				"select result from completed_work_operation where id = $1",
				[command.submissionId],
			);
			expect(only(rows).result.interpretation).toMatchObject({
				captureSource: "user_setting",
				targetZone: { timezone: "Europe/Berlin", source: "organization" },
			});
		});

		it("continues a self entry once in the browser zone, never for an on-behalf entry", async () => {
			const browser = manualCommand({
				zone: { basis: "browser", timezone: "America/New_York" },
				browserTimezone: "America/New_York",
				clockIn: at("08:00", -240),
				clockOut: at("09:00", -240),
			});
			await expect(submit(browser)).resolves.toMatchObject({ success: true });
			expect(only(await periods())).toMatchObject({
				start_time: new Date("2026-09-01T12:00:00Z"),
			});

			await expect(
				submit({ ...browser, submissionId: randomUUID(), date: "2026-09-02" }, ids.managerUser),
			).resolves.toMatchObject({
				success: false,
				rejection: { reason: "invalid_command", field: "zone.basis" },
			});
		});
	});

	describe("interval, holiday and eligibility validation", () => {
		it("rejects future, nonpositive and over-24-hour intervals and invalid fields", async () => {
			harness.now = parseInstant("2026-09-01T09:00:00Z");
			const before = await snapshot();
			await expect(submit(manualCommand())).resolves.toMatchObject({
				rejection: { reason: "future_endpoint" },
			});
			await expect(
				submit(manualCommand({ clockIn: at("08:00", 120), clockOut: at("08:00", 120) })),
			).resolves.toMatchObject({ rejection: { reason: "nonpositive_interval" } });
			await expect(
				submit(
					manualCommand({
						date: "2025-10-26",
						clockIn: at("00:00", 120),
						clockOut: at("23:01", 60),
					}),
				),
			).resolves.toMatchObject({ rejection: { reason: "interval_too_long" } });
			await expect(submit({ ...manualCommand(), reason: " " })).resolves.toMatchObject({
				rejection: { reason: "invalid_command", field: "reason" },
			});
			await expect(submit({ ...manualCommand(), date: "2026-02-30" })).resolves.toMatchObject({
				rejection: { reason: "invalid_command", field: "date" },
			});
			expect(await snapshot()).toEqual(before);
		});

		it("blocks holidays by the effective zone's local date", async () => {
			await admin.query(
				"update user_settings set timezone = 'Pacific/Auckland' where user_id = $1",
				[ids.employeeUser],
			);
			await admin.query(
				`insert into holiday_category (id, organization_id, type, name, blocks_time_entry, updated_at)
				 values ($1, $2, 'public_holiday', 'Closed', true, now())`,
				[ids.holidayCategory, ids.organization],
			);
			await admin.query(
				`insert into holiday (id, organization_id, category_id, name, start_date, end_date, created_by, updated_at)
				 values ($1, $2, $3, 'Christmas', '2025-12-25T00:00:00', '2025-12-25T23:59:59', $4, now())`,
				[ids.holiday, ids.organization, ids.holidayCategory, ids.ownerUser],
			);
			const auckland = (overrides: Partial<ManualTimeEntryCommand>) =>
				manualCommand({
					zone: { basis: "target", timezone: "Pacific/Auckland" },
					browserTimezone: null,
					clockIn: at("09:00", 780),
					clockOut: at("10:00", 780),
					...overrides,
				});

			// 09:00 on the 25th in Auckland is still the 24th in UTC.
			await expect(submit(auckland({ date: "2025-12-25" }))).resolves.toMatchObject({
				success: false,
				code: "holiday_blocked",
				holidayName: "Christmas",
			});
			await expect(submit(auckland({ date: "2025-12-23" }))).resolves.toMatchObject({
				success: true,
			});
		});

		it("requires a category from the target's current effective set", async () => {
			harness.now = parseInstant("2026-09-10T10:00:00Z");
			await admin.query(
				`insert into work_category (id, organization_id, name, created_by, updated_at)
				 values ($1, $2, 'Night', $3, now())`,
				[ids.category, ids.organization, ids.ownerUser],
			);
			await admin.query(
				`insert into work_category_set (id, organization_id, name, created_by, updated_at)
				 values ($1, $2, 'T308 set', $3, now())`,
				[ids.categorySet, ids.organization, ids.ownerUser],
			);
			await admin.query(
				"insert into work_category_set_category (set_id, category_id) values ($1, $2)",
				[ids.categorySet, ids.category],
			);
			const command = manualCommand({ workCategoryId: ids.category });
			await expect(submit(command)).resolves.toMatchObject({
				success: false,
				code: "category_ineligible",
			});
			// Effective only after the evaluation instant: still not available.
			await admin.query(
				`insert into work_category_set_assignment
				 (id, set_id, organization_id, assignment_type, employee_id, priority, effective_from, created_by, updated_at)
				 values ($1, $2, $3, 'employee', $4, 2, '2026-09-10T11:00:00', $5, now())`,
				[ids.categorySetAssignment, ids.categorySet, ids.organization, ids.employee, ids.ownerUser],
			);
			await expect(submit(command)).resolves.toMatchObject({ code: "category_ineligible" });
			await admin.query(
				"update work_category_set_assignment set effective_from = null where id = $1",
				[ids.categorySetAssignment],
			);
			await expect(submit(command)).resolves.toMatchObject({ success: true });
			expect(only(await periods())).toMatchObject({ id: command.submissionId });
		});

		it("requires an active, bookable, assigned project", async () => {
			await admin.query(
				`insert into project (id, organization_id, name, status, is_active, created_by, updated_at)
				 values ($1, $2, 'T308 project', 'active', true, $3, now())`,
				[ids.project, ids.organization, ids.ownerUser],
			);
			const command = manualCommand({ projectId: ids.project });
			await expect(submit(command)).resolves.toMatchObject({
				success: false,
				code: "project_ineligible",
			});
			await admin.query(
				`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
				 values ($1, $2, $3, 'employee', $4, $5)`,
				[ids.projectAssignment, ids.project, ids.organization, ids.employee, ids.ownerUser],
			);
			await expect(submit({ ...command, submissionId: randomUUID() })).resolves.toMatchObject({
				success: true,
			});
			const { rows } = await admin.query(
				"select project_id, allocation_kind, weight_percent from time_record_allocation where organization_id = $1",
				[ids.organization],
			);
			expect(rows).toEqual([
				{ project_id: ids.project, allocation_kind: "project", weight_percent: 100 },
			]);
		});
	});

	describe("exact occupancy", () => {
		it("never trims: any nondeleted work in any state occupies, deleted work does not, adjacency is valid", async () => {
			// Recorded work from the real operation, then moved to each state.
			const recorded = async (clockIn: string, clockOut: string) => {
				const command = manualCommand({ clockIn: at(clockIn, 120), clockOut: at(clockOut, 120) });
				await expect(submit(command)).resolves.toMatchObject({ success: true });
				return command.submissionId;
			};
			const approved = await recorded("07:00", "08:00");
			const rejected = await recorded("12:00", "13:00");
			const deleted = await recorded("09:00", "10:00");
			await admin.query("update work_period set approval_status = 'rejected' where id = $1", [
				rejected,
			]);
			await admin.query("update work_period set deleted_at = now() where id = $1", [deleted]);
			const before = await snapshot();

			// 08:00–12:30 Berlin = 06:00–10:30Z: adjacent to the approved period,
			// overlapping the rejected one, over the deleted one.
			await expect(submit(manualCommand())).resolves.toMatchObject({
				success: false,
				code: "occupancy_conflict",
				rejection: {
					reason: "occupancy_conflict",
					occupants: [{ kind: "work_period", id: rejected }],
				},
			});
			expect(await snapshot()).toEqual(before);

			await expect(submit(manualCommand({ clockOut: at("12:00", 120) }))).resolves.toMatchObject({
				success: true,
			});
			expect((await periods()).map((period) => period.id)).toContain(approved);
		});

		it("lets an active period that began on an earlier day occupy from its start", async () => {
			actAs(ids.employeeUser);
			await expect(
				clockIn("office", {
					instant: parseInstant("2026-08-31T20:00:00Z"),
					browserTimezone: "Europe/Berlin",
				}),
			).resolves.toMatchObject({ success: true });
			const active = only(await periods()).id;

			await expect(submit(manualCommand())).resolves.toMatchObject({
				rejection: {
					reason: "occupancy_conflict",
					occupants: [{ kind: "work_period", id: active }],
				},
			});
		});

		it("commits exactly one of two concurrent overlapping submissions", async () => {
			const [first, second] = await Promise.all([
				submit(manualCommand()),
				submit(manualCommand({ clockIn: at("09:00", 120), clockOut: at("13:00", 120) })),
			]);

			const outcomes = [first, second].map((result) =>
				result.success
					? "committed"
					: result.success === false && "code" in result
						? result.code
						: "?",
			);
			expect(outcomes.sort()).toEqual(["committed", "occupancy_conflict"]);
			expect(await periods()).toHaveLength(1);
		});

		it("holds manual work behind live clocking on the shared employee key", async () => {
			const holder = await holdAdvisoryLock(ids.employee);
			const pending = submit(manualCommand());
			await waitForAdvisoryWaiter();
			expect(await periods()).toEqual([]);
			await holder.release();
			await expect(pending).resolves.toMatchObject({ success: true });

			// Live clock-in after the manual entry keeps its own occupancy rule.
			actAs(ids.employeeUser);
			await expect(clockIn("office", { browserTimezone: "Europe/Berlin" })).resolves.toMatchObject({
				success: true,
			});
		});
	});

	describe("configuration protection", () => {
		it("waits while an organization configuration writer holds exclusive protection", async () => {
			const holder = await holdAdvisoryLock(
				JSON.stringify(["work-organization-configuration", ids.organization]),
			);
			const pending = submit(manualCommand());
			await waitForAdvisoryWaiter();
			// The configuration change commits first; the submission then reads it.
			await admin.query("update user_settings set timezone = 'Europe/Paris' where user_id = $1", [
				ids.employeeUser,
			]);
			await holder.release();

			await expect(pending).resolves.toMatchObject({
				rejection: { reason: "reconfirmation_required", detail: "zone_changed" },
			});
		});

		it("waits on the target user's configuration/access protection", async () => {
			const holder = await holdAdvisoryLock(
				JSON.stringify(["work-user-configuration-access", ids.employeeUser]),
			);
			const pending = submit(manualCommand());
			await waitForAdvisoryWaiter();
			await admin.query("update employee set is_active = false where id = $1", [ids.employee]);
			await holder.release();

			await expect(pending).resolves.toMatchObject({
				success: false,
				rejection: { reason: "target_not_authorized" },
			});
			expect(await periods()).toEqual([]);
		});
	});

	// #327: manual and live clocking race on empty history in both arrival orders.
	// The first writer parks at its first entry insert, after it holds the employee
	// key; the second then waits on that key, sees the committed work and is refused.
	describe("manual and live clock-in arrival order (#327)", () => {
		// 10:00 Berlin, inside the default 08:00–12:30 Berlin manual interval.
		const liveStart = parseInstant("2026-09-01T08:00:00Z");

		async function parkNextEntryInsert() {
			await admin.query(`create function t327_park() returns trigger language plpgsql as $$
				begin perform pg_advisory_xact_lock(hashtextextended('t327-park', 0)); return new; end $$`);
			await admin.query(
				"create trigger t327_park before insert on time_entry for each row execute function t327_park()",
			);
			return holdAdvisoryLock("t327-park");
		}

		async function waitForAdvisoryWaiters(count: number) {
			for (let attempt = 0; attempt < 200; attempt += 1) {
				const { rows } = await admin.query<{ waiting: number }>(
					"select count(*)::int as waiting from pg_locks where locktype = 'advisory' and not granted",
				);
				if ((rows[0]?.waiting ?? 0) >= count) return;
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			throw new Error(`Fewer than ${count} transactions waited on advisory locks`);
		}

		function liveClockIn() {
			actAs(ids.employeeUser);
			return clockIn("office", { instant: liveStart, browserTimezone: "Europe/Berlin" });
		}

		it("refuses a manual entry that arrives while a live clock-in commits over it", async () => {
			const park = await parkNextEntryInsert();
			const live = liveClockIn();
			await waitForAdvisoryWaiters(1);
			const manual = submit(manualCommand());
			await waitForAdvisoryWaiters(2);
			await park.release();

			await expect(live).resolves.toMatchObject({ success: true });
			const active = only(await periods());
			await expect(manual).resolves.toMatchObject({
				success: false,
				code: "occupancy_conflict",
				rejection: { occupants: [{ kind: "work_period", id: active.id }] },
			});
			expect(await periods()).toHaveLength(1);
		});

		it("refuses a live clock-in that arrives while a manual entry commits around it", async () => {
			const park = await parkNextEntryInsert();
			const manual = submit(manualCommand());
			await waitForAdvisoryWaiters(1);
			const live = liveClockIn();
			await waitForAdvisoryWaiters(2);
			await park.release();

			await expect(manual).resolves.toMatchObject({ success: true });
			const before = await snapshot();
			await expect(live).resolves.toEqual({
				success: false,
				error: "This time overlaps other recorded work",
				code: "occupancy_conflict",
			});
			expect(await snapshot()).toEqual(before);
		});

		it("admits a live clock-in adjacent to committed manual work", async () => {
			await expect(submit(manualCommand())).resolves.toMatchObject({ success: true });

			actAs(ids.employeeUser);
			// 12:30 Berlin: the manual interval is half-open, so its end is free.
			await expect(
				clockIn("office", {
					instant: parseInstant("2026-09-01T10:30:00Z"),
					browserTimezone: "Europe/Berlin",
				}),
			).resolves.toMatchObject({ success: true });
		});
	});

	// #327: one failure matrix across the adopted writers of an employee graph. A
	// failure at any protected write rolls back the whole operation (graph, canonical
	// record, receipt, append position and committed intents), another employee keeps
	// writing while the failure is armed, and the same command then commits.
	describe("failure at every protected write (#327)", () => {
		async function armFailure(table: string) {
			await admin.query(`create function t327_fail() returns trigger language plpgsql as $$
				declare fields jsonb := to_jsonb(new);
				begin
				  if coalesce(
				       fields->>'employee_id',
				       (select employee_id::text from time_record where id::text = fields->>'record_id')
				     ) = '${ids.employee}' then
				    raise exception 't327 injected failure on %', TG_TABLE_NAME;
				  end if;
				  return new;
				end $$`);
			await admin.query(
				`create trigger t327_fail before insert or update on ${table}
				 for each row execute function t327_fail()`,
			);
		}

		async function disarm() {
			await admin.query("drop function if exists t327_fail() cascade");
		}

		const liveStart = parseInstant("2026-09-01T06:00:00Z");
		const liveEnd = parseInstant("2026-09-01T10:00:40Z");

		function liveClockIn(as: string) {
			actAs(as);
			return clockIn("office", { instant: liveStart, browserTimezone: "Europe/Berlin" });
		}

		function liveClockOut(as: string, submissionId: string) {
			actAs(as);
			return clockOut(undefined, undefined, {
				submissionId,
				instant: liveEnd,
				browserTimezone: "Europe/Berlin",
			});
		}

		type Writer = {
			/** Work that must exist before the operation under test (never failed). */
			prepare?: (as: string) => Promise<void>;
			run: (as: string) => Promise<{ success: boolean }>;
		};

		const writers: Record<string, () => Writer> = {
			"live clock-in": () => ({ run: liveClockIn }),
			"live clock-out": () => {
				const submissions = new Map<string, string>();
				return {
					prepare: async (as) => {
						await expect(liveClockIn(as)).resolves.toMatchObject({ success: true });
					},
					run: (as) => {
						const submissionId = submissions.get(as) ?? randomUUID();
						submissions.set(as, submissionId);
						return liveClockOut(as, submissionId);
					},
				};
			},
			"manual version 2": () => {
				const commands = new Map<string, ManualTimeEntryCommand>();
				return {
					run: (as) => {
						const target = as === ids.peerUser ? ids.peer : ids.employee;
						const command = commands.get(as) ?? manualCommand({ targetEmployeeId: target });
						commands.set(as, command);
						return submit(structuredClone(command), as);
					},
				};
			},
		};

		const cases: [string, string][] = [
			["live clock-in", "time_entry"],
			["live clock-in", "work_period"],
			["live clock-in", "time_entry_append_position"],
			["live clock-out", "time_entry"],
			["live clock-out", "work_period"],
			["live clock-out", "time_record"],
			["live clock-out", "time_record_work"],
			["live clock-out", "completed_work_operation"],
			["live clock-out", "time_entry_append_position"],
			["live clock-out", "employee_work_balance"],
			["live clock-out", "work_break_adjustment_intent"],
			["manual version 2", "time_entry"],
			["manual version 2", "work_period"],
			["manual version 2", "time_record"],
			["manual version 2", "time_record_work"],
			["manual version 2", "completed_work_operation"],
			["manual version 2", "time_entry_append_position"],
			["manual version 2", "employee_work_balance"],
		];

		it.each(cases)("%s rolls back entirely when %s fails", async (name, table) => {
			const writer = writers[name]();
			await writer.prepare?.(ids.employeeUser);
			await writer.prepare?.(ids.peerUser);
			await armFailure(table);
			try {
				const before = await snapshot();
				await expect(writer.run(ids.employeeUser)).resolves.toMatchObject({ success: false });
				expect(await snapshot()).toEqual(before);

				// Another employee's graph is not held by the failed operation.
				await expect(writer.run(ids.peerUser)).resolves.toMatchObject({ success: true });
			} finally {
				await disarm();
			}

			await expect(writer.run(ids.employeeUser)).resolves.toMatchObject({ success: true });
		});
	});

	describe("policy, age and approval", () => {
		it("evaluates inclusive calendar-day age at one instant in the effective zone", async () => {
			await seedChangePolicy({ selfServiceDays: 1, approvalDays: 2 });
			// 00:30 on 2026-09-04 in Berlin; still the 3rd in UTC.
			harness.now = parseInstant("2026-09-03T22:30:00Z");

			await expect(submit(manualCommand({ date: "2026-09-03" }))).resolves.toMatchObject({
				data: { requiresApproval: false },
			});
			const withinApproval = manualCommand({
				date: "2026-09-01",
				clockIn: at("13:00", 120),
				clockOut: at("14:00", 120),
			});
			await expect(submit(withinApproval)).resolves.toMatchObject({
				success: true,
				data: { requiresApproval: true },
			});
			const beyond = manualCommand({ date: "2026-08-20" });
			await expect(submit(beyond)).resolves.toMatchObject({
				success: true,
				data: { requiresApproval: true },
			});
			const { rows } = await admin.query(
				"select id, result from completed_work_operation where organization_id = $1",
				[ids.organization],
			);
			const intents = Object.fromEntries(rows.map((row) => [row.id, row.result.interpretation]));
			expect(intents[withinApproval.submissionId]).toMatchObject({
				daysBack: 3,
				evaluatedAt: "2026-09-03T22:30:00Z",
				approvalIntent: { intent: "approval", reason: "within_approval_window" },
				policy: { policyId: ids.changePolicy, level: "organization" },
			});
			expect(intents[beyond.submissionId]).toMatchObject({
				approvalIntent: { intent: "approval", reason: "beyond_approval_window" },
			});
			const pending = await admin.query(
				`select status, approver_id from approval_request where organization_id = $1 and entity_id = $2`,
				[ids.organization, withinApproval.submissionId],
			);
			expect(only(pending.rows)).toMatchObject({ status: "pending", approver_id: ids.manager });
			expect(rows.find((row) => row.id === withinApproval.submissionId)?.result).toMatchObject({
				approvalState: "pending",
				approval: { participation: "manual_time_submission", outcome: "default_created" },
			});
		});

		it("ignores expired and not-yet-effective assignments", async () => {
			harness.now = parseInstant("2026-09-10T10:00:00Z");
			await seedChangePolicy({
				selfServiceDays: 0,
				approvalDays: 0,
				effectiveUntil: "2026-09-10T09:00:00",
			});
			await expect(submit(manualCommand())).resolves.toMatchObject({
				data: { requiresApproval: false },
			});
			await admin.query(
				"update change_policy_assignment set effective_until = null, effective_from = '2026-09-10T11:00:00' where id = $1",
				[ids.changePolicyAssignment],
			);
			await expect(submit(manualCommand({ date: "2026-09-02" }))).resolves.toMatchObject({
				data: { requiresApproval: false },
			});
		});

		it("exempts owner/admin self entries and authorized on-behalf entries, and refuses unrelated targets", async () => {
			await seedChangePolicy({ selfServiceDays: 0, approvalDays: 0 });
			await expect(
				submit(manualCommand({ targetEmployeeId: ids.owner }), ids.ownerUser),
			).resolves.toMatchObject({ success: true, data: { requiresApproval: false } });

			const onBehalf = manualCommand({ browserTimezone: null });
			await expect(submit(onBehalf, ids.managerUser)).resolves.toMatchObject({
				success: true,
				data: { requiresApproval: false },
			});
			const { rows } = await admin.query(
				"select actor_user_id, result from completed_work_operation where id = $1",
				[onBehalf.submissionId],
			);
			expect(only(rows)).toMatchObject({
				actor_user_id: ids.managerUser,
				result: {
					actors: {
						requester: { userId: ids.employeeUser },
						submitting: { userId: ids.managerUser },
					},
					interpretation: {
						onBehalf: true,
						captureSource: "manager_target_user_setting",
						approvalIntent: { intent: "direct", reason: "on_behalf" },
					},
				},
			});

			await expect(
				submit(manualCommand({ targetEmployeeId: ids.peer, date: "2026-09-02" }), ids.managerUser),
			).resolves.toMatchObject({ success: false, code: "target_not_authorized" });

			// An owner whose employee role is ordinary may create for colleagues;
			// a plain employee may not.
			await expect(
				submit(
					manualCommand({ targetEmployeeId: ids.peer, date: "2026-09-03", browserTimezone: null }),
					ids.ownerUser,
				),
			).resolves.toMatchObject({ success: true, data: { requiresApproval: false } });
			await expect(
				submit(manualCommand({ date: "2026-09-04", browserTimezone: null }), ids.peerUser),
			).resolves.toMatchObject({ success: false, code: "target_not_authorized" });
		});

		it("rolls back unroutable required approval atomically", async () => {
			await seedChangePolicy({ selfServiceDays: 0, approvalDays: 30 });
			await admin.query("delete from employee_managers where id = $1", [ids.managerLink]);
			const before = await snapshot();

			await expect(submit(manualCommand())).resolves.toMatchObject({
				success: false,
				code: "approval_unroutable",
			});

			expect(await snapshot()).toEqual(before);
		});
	});

	describe("frozen command recovery (#310)", () => {
		const own = { userId: ids.employeeUser, organizationId: ids.organization };

		function lookup(
			command: unknown,
			as: string = ids.employeeUser,
			context: { userId: string; organizationId: string } = {
				userId: as,
				organizationId: ids.organization,
			},
		) {
			actAs(as);
			return lookupManualTimeEntry(command, context);
		}

		async function waitForAdvisoryWaiters(count: number) {
			for (let attempt = 0; attempt < 100; attempt += 1) {
				const { rows } = await admin.query<{ waiting: number }>(
					"select count(*)::int as waiting from pg_locks where locktype = 'advisory' and not granted",
				);
				if ((rows[0]?.waiting ?? 0) >= count) return;
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			throw new Error(`Fewer than ${count} transactions waited on advisory locks`);
		}

		it("reports the original participation of a committed command separately from its current status", async () => {
			await seedChangePolicy({ selfServiceDays: 1, approvalDays: 30 });
			harness.now = parseInstant("2026-09-10T10:00:00Z");
			const command = manualCommand();
			await expect(submit(command)).resolves.toMatchObject({
				success: true,
				data: { requiresApproval: true },
			});
			const before = await snapshot();

			await expect(lookup(structuredClone(command))).resolves.toEqual({
				status: "committed",
				data: {
					workPeriodId: command.submissionId,
					requiresApproval: true,
					disposition: "replayed",
					currentApprovalStatus: "pending",
				},
			});
			expect(await snapshot()).toEqual(before);
			// A later decision changes the current status, never the committed outcome.
			await admin.query("update work_period set approval_status = 'approved' where id = $1", [
				command.submissionId,
			]);
			await expect(lookup(command)).resolves.toMatchObject({
				status: "committed",
				data: { requiresApproval: true, currentApprovalStatus: "approved" },
			});
			await expect(createManualTimeEntry(command, own)).resolves.toMatchObject({
				success: true,
				data: { requiresApproval: true, disposition: "replayed" },
			});
		});

		it("answers not_committed for an absent identity without writing, and an exact retry then commits it", async () => {
			const command = manualCommand();
			const before = await snapshot();

			await expect(lookup(command)).resolves.toEqual({ status: "not_committed" });
			expect(await snapshot()).toEqual(before);

			actAs(ids.employeeUser);
			await expect(createManualTimeEntry(command, own)).resolves.toMatchObject({
				success: true,
				data: { workPeriodId: command.submissionId, disposition: "executed" },
			});
			await expect(lookup(command)).resolves.toMatchObject({ status: "committed" });
			expect(await periods()).toHaveLength(1);
		});

		it("answers in every admission mode and never creates work", async () => {
			const committed = manualCommand();
			await submit(committed);
			await setAppend("inactive");
			const before = await snapshot();

			await expect(lookup(committed)).resolves.toMatchObject({ status: "committed" });
			await expect(lookup(manualCommand({ date: "2026-09-02" }))).resolves.toEqual({
				status: "not_committed",
			});
			await setAppend(null);
			await expect(lookup(committed)).resolves.toMatchObject({ status: "committed" });
			expect(await snapshot()).toEqual(before);
		});

		it("reports conflicts for a changed command, deleted work and legacy work under the identity", async () => {
			const command = manualCommand();
			await submit(command);
			await expect(lookup({ ...command, reason: "Edited reason" })).resolves.toEqual({
				status: "conflict",
			});
			await admin.query("update work_period set deleted_at = now() where id = $1", [
				command.submissionId,
			]);
			await expect(lookup(command)).resolves.toEqual({ status: "conflict" });

			await setAppend(null);
			const legacy = {
				submissionId: randomUUID(),
				date: "2026-09-03",
				clockInTime: "09:00",
				clockOutTime: "10:00",
				reason: "Legacy form",
				timezone: "Europe/Berlin",
				browserTimezone: "Europe/Berlin",
			};
			await expect(submit(legacy)).resolves.toMatchObject({ success: true });
			await expect(
				lookup(manualCommand({ submissionId: legacy.submissionId, date: "2026-09-03" })),
			).resolves.toEqual({ status: "conflict" });
		});

		it("keeps unsupported representations distinct from absence", async () => {
			await expect(
				lookup({
					submissionId: randomUUID(),
					date: "2026-09-02",
					clockInTime: "09:00",
					clockOutTime: "10:00",
					reason: "Legacy form",
				}),
			).resolves.toEqual({ status: "unsupported" });
			await expect(lookup({ ...manualCommand(), version: 3 })).resolves.toEqual({
				status: "unsupported",
			});
			await expect(lookup({ ...manualCommand(), extra: true })).resolves.toEqual({
				status: "unsupported",
			});
		});

		it("waits for an in-flight submission holding the identity and then reports its commit", async () => {
			await admin.query(`create function t310_hold() returns trigger language plpgsql as $$
				begin perform pg_advisory_xact_lock(hashtextextended('t310-hold', 0)); return new; end $$`);
			await admin.query(
				"create trigger t310_hold before insert on completed_work_operation for each row execute function t310_hold()",
			);
			const holder = await holdAdvisoryLock("t310-hold");
			const command = manualCommand();
			const submission = submit(command);
			await waitForAdvisoryWaiters(1);

			const pendingLookup = lookup(command);
			await waitForAdvisoryWaiters(2);
			await holder.release();

			await expect(submission).resolves.toMatchObject({ success: true });
			await expect(pendingLookup).resolves.toMatchObject({
				status: "committed",
				data: { workPeriodId: command.submissionId },
			});
		});

		it("refuses another user, organization or unauthorized target before reading the identity", async () => {
			const command = manualCommand();
			await submit(command);
			const before = await snapshot();

			// The manager may create for the employee, but this command belongs to the employee's session.
			await expect(lookup(command, ids.managerUser, own)).resolves.toMatchObject({
				status: "refused",
				code: "context_mismatch",
			});
			actAs(ids.managerUser);
			await expect(
				createManualTimeEntry(manualCommand({ date: "2026-09-02" }), own),
			).resolves.toMatchObject({ success: false, code: "context_mismatch" });
			await expect(
				lookup(command, ids.employeeUser, {
					userId: ids.employeeUser,
					organizationId: ids.otherOrganization,
				}),
			).resolves.toMatchObject({ status: "refused", code: "context_mismatch" });
			// A plain colleague may not create for the target at all.
			await expect(lookup(command, ids.peerUser)).resolves.toMatchObject({
				status: "refused",
				code: "target_not_authorized",
			});
			harness.userId = null;
			await expect(lookupManualTimeEntry(command, own)).resolves.toMatchObject({
				status: "refused",
				code: "not_authenticated",
			});
			expect(await snapshot()).toEqual(before);
		});
	});

	it("removes manual receipts, positions and records with the organization's time history", async () => {
		await submit(manualCommand());
		await clearOrganizationTimeData(ids.organization);

		const after = await snapshot();
		expect(after).toMatchObject({
			periods: null,
			entries: null,
			records: null,
			receipts: null,
			positions: null,
		});
	});
});
