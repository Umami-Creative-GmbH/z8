/**
 * #311 / T46 runtime evidence: organization timezone changes participate in the
 * shared configuration protection and commit a durable balance-rebuild intent
 * that is executed separately.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real public `updateOrganizationTimezone` and `createManualTimeEntry` server
 * actions, the real balance consumers and the real `cron:work-balance` processor
 * run against that database. Only the request/session, SSO session store, billing
 * provisioning, notification delivery and Next cache boundaries are replaced.
 * Adoption is enabled per organization by inserting its append control row
 * directly: production has no setter.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import type { ManualTimeEntryCommand } from "@/lib/time-tracking/manual-command";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
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
	// A terminated worker backend surfaces on its query; keep the process alive.
	pool.on("error", () => {});
	pool.on("connect", (client) => client.on("error", () => {}));
	const db = drizzle({ client: pool, schema: { ...authSchema, ...schema } });
	return { ...authSchema, ...schema, db, pool };
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

vi.mock("@/lib/enterprise-identity/session-sso-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/enterprise-identity/session-sso-store")>()),
	canAccessOrganizationWithSso: async () => true,
}));

vi.mock("@/lib/auth-helpers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/auth-helpers")>();
	const { db } = await import("@/db");
	const { loadOrganizationPrincipalContext } = await import("@/lib/authorization/principal-loader");
	return {
		...original,
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

vi.mock("@/app/[locale]/(app)/time-tracking/actions/approvals", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/app/[locale]/(app)/time-tracking/actions/approvals")
	>()),
	sendManualEntryApprovalNotifications: async () => undefined,
	sendManualEntryApprovedNotification: async () => undefined,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
		child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
	}),
}));

const { updateOrganizationTimezone } = await import("./actions");
const { createManualTimeEntry } = await import("@/app/[locale]/(app)/time-tracking/actions");
const { getEmployeeWorkBalance, getEmployeeWorkBalances, listEmployeesForWorkBalanceBatch } =
	await import("@/lib/work-balance/service");
const { processWorkBalanceRebuildIntents } = await import("@/lib/work-balance/rebuild-intents");
const { runWorkBalanceRefresh } = await import("@/lib/jobs/work-balance");

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
	describe.skip(`organization timezone PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t311-timezone-org",
	otherOrganization: "t311-other-org",
	ownerUser: "t311-owner-user",
	adminUser: "t311-admin-user",
	employeeUser: "t311-employee-user",
	lateUser: "t311-late-user",
	owner: "e3110000-0000-4000-8000-000000000001",
	employee: "e3110000-0000-4000-8000-000000000002",
	admin: "e3110000-0000-4000-8000-000000000003",
	/** The employee user's record in the other organization. */
	otherEmployee: "e3110000-0000-4000-8000-000000000004",
	lateEmployee: "e3110000-0000-4000-8000-000000000005",
} as const;
const users = [ids.ownerUser, ids.adminUser, ids.employeeUser, ids.lateUser];
const organizationEmployees = [ids.owner, ids.employee, ids.admin].sort();
const RESET_MARKER_DATE = "0001-01-01";

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

/** A New York entry on 2026-09-01 (EDT, UTC-4) for the employee, by default. */
function manualCommand(overrides: Partial<ManualTimeEntryCommand> = {}): ManualTimeEntryCommand {
	return {
		version: 2,
		submissionId: randomUUID(),
		targetEmployeeId: ids.employee,
		date: "2026-09-01",
		clockIn: { time: "08:00", occurrence: null, displayedOffsetMinutes: -240 },
		clockOut: { time: "12:30", occurrence: null, displayedOffsetMinutes: -240 },
		zone: { basis: "target", timezone: "America/New_York" },
		browserTimezone: "America/New_York",
		reason: "Forgot to clock in",
		projectId: null,
		workCategoryId: null,
		...overrides,
	};
}

describeIntegration("organization timezone changes and balance rebuilds on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 8 });

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	function changeTimezone(timezone: string, as: string = ids.ownerUser) {
		actAs(as);
		return updateOrganizationTimezone(ids.organization, timezone);
	}

	async function setAppend(mode: "active" | null) {
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

	async function organizationTimezone() {
		const { rows } = await admin.query<{ timezone: string }>(
			"select timezone from organization where id = $1",
			[ids.organization],
		);
		return only(rows).timezone;
	}

	async function intents(organizationId: string = ids.organization) {
		const { rows } = await admin.query<{
			id: string;
			reason: string;
			requested_by: string | null;
			attempts: number;
			last_error: string | null;
		}>(
			"select id, reason, requested_by, attempts, last_error from work_balance_rebuild_intent where organization_id = $1 order by requested_at",
			[organizationId],
		);
		return rows;
	}

	async function balances() {
		const { rows } = await admin.query<{
			employee_id: string;
			organization_id: string;
			computed_from_date: string;
			is_dirty: boolean;
		}>(
			"select employee_id, organization_id, computed_from_date::text, is_dirty from employee_work_balance where organization_id in ($1, $2) order by employee_id",
			[ids.organization, ids.otherOrganization],
		);
		return rows;
	}

	async function resetEmployees() {
		return (await balances())
			.filter((row) => row.computed_from_date === RESET_MARKER_DATE)
			.map((row) => row.employee_id)
			.sort();
	}

	const heldLocks = new Set<() => Promise<void>>();

	async function holdLock(statement: string, parameters: unknown[]) {
		const client = await admin.connect();
		await client.query("begin");
		await client.query(statement, parameters);
		const release = async () => {
			heldLocks.delete(release);
			await client.query("commit");
			client.release();
		};
		heldLocks.add(release);
		return { release };
	}

	const holdAdvisoryLock = (key: string) =>
		holdLock("select pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);

	async function waitFor(query: string, parameters: unknown[] = [], label = query) {
		for (let attempt = 0; attempt < 200; attempt += 1) {
			const { rows } = await admin.query(query, parameters);
			if (rows.length > 0) return rows;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		throw new Error(`Timed out waiting for: ${label}`);
	}

	const waitForAdvisoryWaiters = (count = 1) =>
		waitFor(
			"select 1 from pg_locks where locktype = 'advisory' and not granted having count(*) >= $1",
			[count],
			`${count} advisory waiter(s)`,
		);

	/** Makes every full-rebuild reset fail until the trigger is dropped. */
	async function failRebuilds() {
		await admin.query(`create or replace function t311_fail_rebuild() returns trigger language plpgsql as $$
			begin
				if new.computed_from_date = '${RESET_MARKER_DATE}' then
					raise exception 't311 injected rebuild failure';
				end if;
				return new;
			end $$`);
		await admin.query(
			"create trigger t311_fail_rebuild before insert or update on employee_work_balance for each row execute function t311_fail_rebuild()",
		);
	}

	async function restoreRebuilds() {
		await admin.query("drop function if exists t311_fail_rebuild() cascade");
	}

	async function cleanup() {
		await restoreRebuilds();
		await admin.query("drop function if exists t311_fail_intent() cascade");
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seedBalance(employeeId: string, organizationId: string) {
		await admin.query(
			`insert into employee_work_balance
			 (employee_id, organization_id, actual_minutes, required_minutes, balance_minutes,
			  computed_from_date, computed_through_date, computed_at, is_dirty, updated_at)
			 values ($1, $2, 600, 480, 120, '2026-01-01', '2026-08-31', now(), false, now())`,
			[employeeId, organizationId],
		);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T311 timezone', $1, 'Europe/Berlin', $3), ($2, 'T311 other', $2, 'Europe/Berlin', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t311-m-owner', $1, $3, 'owner', 'approved', $6),
			 ('t311-m-admin', $1, $4, 'admin', 'approved', $6),
			 ('t311-m-employee', $1, $5, 'member', 'approved', $6),
			 ('t311-m-other', $2, $5, 'member', 'approved', $6)`,
			[
				ids.organization,
				ids.otherOrganization,
				ids.ownerUser,
				ids.adminUser,
				ids.employeeUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $7, 'admin', $9), ($3, $4, $7, 'employee', $9),
			 ($5, $6, $7, 'admin', $9), ($8, $4, $10, 'employee', $9)`,
			[
				ids.owner,
				ids.ownerUser,
				ids.employee,
				ids.employeeUser,
				ids.admin,
				ids.adminUser,
				ids.organization,
				ids.otherEmployee,
				timestamp,
				ids.otherOrganization,
			],
		);
		// No user settings rows: every employee falls back to the organization zone.
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'manual_time_submission', 'legacy', 'legacy', now(), now())`,
			[ids.organization],
		);
		for (const employeeId of organizationEmployees) {
			await seedBalance(employeeId, ids.organization);
		}
		await seedBalance(ids.otherEmployee, ids.otherOrganization);
		await setAppend("active");
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
			throw new Error("Organization timezone PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		harness.userId = null;
		harness.organizationId = null;
		await seed();
	});

	afterEach(async () => {
		// A failed assertion must not leave a lock that stalls later tests.
		for (const release of [...heldLocks]) await release();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	describe("atomic save and durable intent", () => {
		it("commits the zone with a durable intent and rebuilds the routed scope separately", async () => {
			await expect(changeTimezone("America/New_York")).resolves.toMatchObject({ success: true });

			expect(await organizationTimezone()).toBe("America/New_York");
			// The post-commit execution consumed the intent.
			expect(await intents()).toEqual([]);
			expect(await resetEmployees()).toEqual(organizationEmployees);
			// The same user's employee in another organization is not in scope.
			expect((await balances()).find((row) => row.employee_id === ids.otherEmployee)).toMatchObject(
				{ computed_from_date: "2026-01-01", is_dirty: false },
			);
		});

		it("rolls the zone back when the durable intent cannot be written", async () => {
			await admin.query(`create or replace function t311_fail_intent() returns trigger language plpgsql as $$
				begin raise exception 't311 injected intent failure'; end $$`);
			await admin.query(
				"create trigger t311_fail_intent before insert on work_balance_rebuild_intent for each row execute function t311_fail_intent()",
			);
			const before = await balances();

			await expect(changeTimezone("America/New_York")).resolves.toMatchObject({ success: false });

			expect(await organizationTimezone()).toBe("Europe/Berlin");
			expect(await intents()).toEqual([]);
			expect(await balances()).toEqual(before);
		});

		it("reports a committed save as saved when its rebuild fails and recovers on the worker", async () => {
			await failRebuilds();

			await expect(changeTimezone("America/New_York")).resolves.toMatchObject({ success: true });

			expect(await organizationTimezone()).toBe("America/New_York");
			const [pending] = await intents();
			expect(pending).toMatchObject({
				reason: "organization_timezone",
				requested_by: ids.ownerUser,
				attempts: 1,
			});
			expect(pending?.last_error).toContain("t311 injected rebuild failure");
			expect(await resetEmployees()).toEqual([]);

			await restoreRebuilds();
			const result = await runWorkBalanceRefresh();

			expect(result.rebuildIntents).toMatchObject({ organizationsRebuilt: 1, failures: [] });
			expect(await intents()).toEqual([]);
			// The same run recomputed every reset balance in the committed zone.
			for (const employeeId of organizationEmployees) {
				await expect(
					getEmployeeWorkBalance({ employeeId, organizationId: ids.organization }),
				).resolves.toMatchObject({ employeeId, actualMinutes: 0 });
			}
		});

		it("keeps the unchanged zone free of rebuild work", async () => {
			await expect(changeTimezone("Europe/Berlin")).resolves.toMatchObject({ success: true });

			expect(await intents()).toEqual([]);
			expect(await resetEmployees()).toEqual([]);
		});

		it("keeps the legacy in-transaction reset for an organization that has not adopted", async () => {
			await setAppend(null);
			await failRebuilds();

			// The legacy reset runs inside the save, so its failure fails the save.
			await expect(changeTimezone("America/New_York")).resolves.toMatchObject({ success: false });
			expect(await organizationTimezone()).toBe("Europe/Berlin");

			await restoreRebuilds();
			await expect(changeTimezone("America/New_York")).resolves.toMatchObject({ success: true });
			expect(await intents()).toEqual([]);
			expect(await resetEmployees()).toEqual(organizationEmployees);
		});
	});

	describe("configuration protection", () => {
		it("waits for in-flight manual interpretation holding shared protection", async () => {
			const submission = await holdLock(
				"select pg_advisory_xact_lock_shared(hashtextextended($1, 0))",
				[JSON.stringify(["work-organization-configuration", ids.organization])],
			);
			const pending = changeTimezone("America/New_York");
			await waitForAdvisoryWaiters();
			expect(await organizationTimezone()).toBe("Europe/Berlin");

			await submission.release();
			await expect(pending).resolves.toMatchObject({ success: true });
			expect(await organizationTimezone()).toBe("America/New_York");
		});

		it("makes new manual submissions wait for and use the committed zone immediately", async () => {
			await failRebuilds();
			// Park the save after it took exclusive protection, at the organization row.
			const rowHolder = await holdLock("select 1 from organization where id = $1 for update", [
				ids.organization,
			]);
			const save = changeTimezone("America/New_York");
			await waitFor(
				"select 1 from pg_locks where not granted and locktype <> 'advisory'",
				[],
				"the save waiting on the organization row",
			);
			actAs(ids.employeeUser);
			const berlinCommand = manualCommand({
				clockIn: { time: "08:00", occurrence: null, displayedOffsetMinutes: 120 },
				clockOut: { time: "12:30", occurrence: null, displayedOffsetMinutes: 120 },
				zone: { basis: "target", timezone: "Europe/Berlin" },
				browserTimezone: "Europe/Berlin",
			});
			const submission = createManualTimeEntry(berlinCommand);
			await waitForAdvisoryWaiters();

			await rowHolder.release();
			await expect(save).resolves.toMatchObject({ success: true });
			await expect(submission).resolves.toMatchObject({
				rejection: { reason: "reconfirmation_required", detail: "zone_changed" },
			});

			// The rebuild is still pending, and the new zone already governs submissions.
			expect(await intents()).toHaveLength(1);
			actAs(ids.employeeUser);
			await expect(createManualTimeEntry(manualCommand())).resolves.toMatchObject({
				success: true,
			});
			const { rows } = await admin.query<{ start_time: Date; utc_offset_minutes: number }>(
				`select period.start_time, entry.utc_offset_minutes from work_period period
				 join time_entry entry on entry.id = period.clock_in_id
				 where period.organization_id = $1 and period.employee_id = $2`,
				[ids.organization, ids.employee],
			);
			expect(only(rows)).toMatchObject({
				start_time: new Date("2026-09-01T12:00:00Z"),
				utc_offset_minutes: -240,
			});
		});

		it("takes no employee coordination or balance locks inside the save", async () => {
			const employeeHolder = await holdAdvisoryLock(ids.employee);
			const balanceHolder = await holdAdvisoryLock(
				`work-balance:${ids.organization}:${ids.employee}`,
			);
			const save = changeTimezone("America/New_York");

			// The save commits while both are held; only the separate rebuild waits.
			await waitFor(
				"select 1 from organization where id = $1 and timezone = 'America/New_York'",
				[ids.organization],
				"the committed zone",
			);
			expect(await intents()).toHaveLength(1);
			await waitForAdvisoryWaiters();

			await balanceHolder.release();
			await expect(save).resolves.toMatchObject({ success: true });
			await employeeHolder.release();
			expect(await intents()).toEqual([]);
			expect(await resetEmployees()).toEqual(organizationEmployees);
		});

		it("refuses a non-owner before any change", async () => {
			await expect(changeTimezone("America/New_York", ids.adminUser)).resolves.toMatchObject({
				success: false,
				code: "AuthorizationError",
			});
			expect(await organizationTimezone()).toBe("Europe/Berlin");
			expect(await intents()).toEqual([]);
		});

		it("revalidates the owner under the actor's access protection", async () => {
			const accessWriter = await holdAdvisoryLock(
				JSON.stringify(["work-user-configuration-access", ids.ownerUser]),
			);
			const save = changeTimezone("America/New_York");
			await waitForAdvisoryWaiters();
			// Ownership moves to the admin (the organization must keep an owner).
			await admin.query("update member set role = 'owner' where id = 't311-m-admin'");
			await admin.query("update member set role = 'member' where id = 't311-m-owner'");
			await accessWriter.release();

			await expect(save).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
			expect(await organizationTimezone()).toBe("Europe/Berlin");
			expect(await intents()).toEqual([]);
		});
	});

	describe("separate rebuild execution", () => {
		it("routes every employee of the organization at execution, and nothing outside it", async () => {
			await failRebuilds();
			await expect(changeTimezone("America/New_York")).resolves.toMatchObject({ success: true });
			// Created after the save committed, before the rebuild ran.
			await admin.query(
				"insert into employee (id, user_id, organization_id, role, updated_at) values ($1, $2, $3, 'employee', now())",
				[ids.lateEmployee, ids.lateUser, ids.organization],
			);
			await seedBalance(ids.lateEmployee, ids.organization);
			await restoreRebuilds();

			await expect(processWorkBalanceRebuildIntents()).resolves.toMatchObject({
				organizationsRebuilt: 1,
				failures: [],
			});

			expect(await resetEmployees()).toEqual([...organizationEmployees, ids.lateEmployee].sort());
			expect(await intents()).toEqual([]);
		});

		it("survives worker process loss, is claimed once, and completes on retry", async () => {
			await failRebuilds();
			await expect(changeTimezone("America/New_York")).resolves.toMatchObject({ success: true });
			await restoreRebuilds();
			const [first, second] = organizationEmployees;
			const holder = await holdAdvisoryLock(`work-balance:${ids.organization}:${second}`);

			const lost = processWorkBalanceRebuildIntents();
			await waitForAdvisoryWaiters();
			// A concurrent worker skips the claimed intent instead of rebuilding twice.
			await expect(processWorkBalanceRebuildIntents()).resolves.toMatchObject({
				organizationsRebuilt: 0,
				failures: [],
			});
			const [worker] = await waitFor(
				"select pid from pg_stat_activity where wait_event_type = 'Lock' and wait_event = 'advisory'",
			);
			await admin.query("select pg_terminate_backend($1)", [worker.pid]);
			const lostResult = await lost;
			await holder.release();

			expect(lostResult.failures).toHaveLength(1);
			// The first employee's reset rolled back with the lost transaction.
			expect((await balances()).find((row) => row.employee_id === first)).toMatchObject({
				computed_from_date: "2026-01-01",
			});
			expect(await intents()).toMatchObject([{ attempts: 2 }]);

			await expect(processWorkBalanceRebuildIntents()).resolves.toMatchObject({
				organizationsRebuilt: 1,
			});
			expect(await intents()).toEqual([]);
			expect(await resetEmployees()).toEqual(organizationEmployees);
		});
	});

	describe("projection freshness", () => {
		it("keeps consumers from reading projections as current while the rebuild is pending", async () => {
			await failRebuilds();
			await expect(changeTimezone("America/New_York")).resolves.toMatchObject({ success: true });

			// The stored rows are still clean, but they were computed in the old zone.
			expect((await balances()).every((row) => !row.is_dirty)).toBe(true);
			await expect(
				getEmployeeWorkBalance({ employeeId: ids.employee, organizationId: ids.organization }),
			).resolves.toBeNull();
			const team = await getEmployeeWorkBalances({
				employeeIds: organizationEmployees,
				organizationId: ids.organization,
			});
			expect(team.size).toBe(0);
			// Batch refresh leaves the organization to the rebuild.
			const batch = await listEmployeesForWorkBalanceBatch(1000);
			expect(batch.some((row) => row.organizationId === ids.organization)).toBe(false);

			// Another organization's projection stays current.
			await expect(
				getEmployeeWorkBalance({
					employeeId: ids.otherEmployee,
					organizationId: ids.otherOrganization,
				}),
			).resolves.toMatchObject({ balanceMinutes: 120 });

			await restoreRebuilds();
			await processWorkBalanceRebuildIntents();
			// Reset markers remain not-current until the refresh recomputes them.
			await expect(
				getEmployeeWorkBalance({ employeeId: ids.employee, organizationId: ids.organization }),
			).resolves.toBeNull();
		});
	});
});
