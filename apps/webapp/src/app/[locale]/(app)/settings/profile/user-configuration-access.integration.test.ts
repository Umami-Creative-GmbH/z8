/**
 * #312 / T47 runtime evidence: user timezone, first settings-row and global
 * access (ban) writers take the user's exclusive configuration/access guard in
 * their original transaction, across every organization of the user, and a
 * timezone change records user-scoped balance-rebuild intents that run separately.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real public `updateTimezone`, `updateWeekStartDay`, `startOnboarding`,
 * `banUserAction`/`unbanUserAction` and `createManualTimeEntry` server actions,
 * the real `setUserLocale` (Telegram and language switcher), the real balance
 * consumers and the real `cron:work-balance` processor run against that database.
 * Only the request/session, SSO session store, Better Auth session revocation,
 * billing provisioning, notification delivery and Next cache boundaries are
 * replaced. Adoption is enabled per organization by inserting its append control
 * row directly: production has no setter.
 */

import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import type { ManualTimeEntryCommand } from "@/lib/time-tracking/manual-command";

// Concurrent actions each keep their own request session.
const { sessions } = await vi.hoisted(async () => {
	const { AsyncLocalStorage } = await import("node:async_hooks");
	return {
		sessions: new AsyncLocalStorage<{
			userId: string;
			organizationId: string;
			role: "user" | "admin";
		}>(),
	};
});

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
			max: 16,
		}),
	);
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
		// Session revocation belongs to Better Auth's store, not this database.
		$context: Promise.resolve({
			internalAdapter: { deleteUserSessions: async () => undefined },
		}),
		api: {
			getSession: async () => {
				const current = sessions.getStore();
				return current
					? {
							user: {
								id: current.userId,
								email: `${current.userId}@example.test`,
								name: current.userId,
								role: current.role,
							},
							session: {
								id: `t312-session-${current.userId}`,
								userId: current.userId,
								activeOrganizationId: current.organizationId,
							},
						}
					: null;
			},
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
		getPrincipalContext: async () => {
			const current = sessions.getStore();
			return current
				? loadOrganizationPrincipalContext(db, {
						userId: current.userId,
						organizationId: current.organizationId,
					})
				: null;
		},
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

const { updateTimezone, updateWeekStartDay } = await import("./actions");
const { startOnboarding } = await import("@/app/[locale]/onboarding/welcome/actions");
const { banUserAction, unbanUserAction } = await import(
	"@/app/[locale]/(admin)/platform-admin/users/actions"
);
const { createManualTimeEntry } = await import("@/app/[locale]/(app)/time-tracking/actions");
const { setUserLocale } = await import("@/lib/bot-platform/i18n");
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
	describe.skip(`user configuration access PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	orgA: "t312-org-a",
	orgB: "t312-org-b",
	/** An organization the user joins while a change waits (restart scope). */
	orgC: "t312-org-c",
	user: "t312-user",
	colleagueUser: "t312-colleague-user",
	platformAdminUser: "t312-platform-admin",
	employeeA: "e3120000-0000-4000-8000-00000000000a",
	employeeB: "e3120000-0000-4000-8000-00000000000b",
	employeeC: "e3120000-0000-4000-8000-00000000000c",
	colleagueA: "e3120000-0000-4000-8000-0000000000c1",
} as const;
const organizations = [ids.orgA, ids.orgB, ids.orgC];
const users = [ids.user, ids.colleagueUser, ids.platformAdminUser];
const employeeOf = { [ids.orgA]: ids.employeeA, [ids.orgB]: ids.employeeB } as const;
const RESET_MARKER_DATE = "0001-01-01";
const userGuard = JSON.stringify(["work-user-configuration-access", ids.user]);

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

const berlin = (time: string) => ({ time, occurrence: null, displayedOffsetMinutes: 120 });

/** The user's own Berlin summer entry (the organization zone) in the given organization. */
function manualCommand(
	organizationId: typeof ids.orgA | typeof ids.orgB,
	overrides: Partial<ManualTimeEntryCommand> = {},
): ManualTimeEntryCommand {
	return {
		version: 2,
		submissionId: randomUUID(),
		targetEmployeeId: employeeOf[organizationId],
		date: "2026-09-01",
		clockIn: berlin("08:00"),
		clockOut: berlin("12:30"),
		zone: { basis: "target", timezone: "Europe/Berlin" },
		browserTimezone: "Europe/Berlin",
		reason: "Forgot to clock in",
		projectId: null,
		workCategoryId: null,
		...overrides,
	};
}

/** The key the manual transaction takes after its protection and employee coordination. */
const submissionIdentity = (organizationId: string, command: ManualTimeEntryCommand) =>
	JSON.stringify([organizationId, "manual_time_submission", "time_entry", command.submissionId]);

describeIntegration("user configuration and access mutations on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 12 });

	function as<T>(
		userId: string,
		organizationId: string,
		action: () => Promise<T>,
		role: "user" | "admin" = "user",
	) {
		return sessions.run({ userId, organizationId, role }, action);
	}

	const submit = (
		organizationId: typeof ids.orgA | typeof ids.orgB,
		command: ManualTimeEntryCommand,
	) => as(ids.user, organizationId, () => createManualTimeEntry(command));
	const changeTimezone = (timezone: string) =>
		as(ids.user, ids.orgA, () => updateTimezone(timezone));
	const ban = () =>
		as(ids.platformAdminUser, ids.orgA, () => banUserAction(ids.user, "Policy", null), "admin");
	const unban = () => as(ids.platformAdminUser, ids.orgA, () => unbanUserAction(ids.user), "admin");

	const openHolds = new Set<PoolClient>();

	/** Opens a transaction holding the result of `statement`, released on demand. */
	async function hold(statement: string, params: unknown[]) {
		const client: PoolClient = await admin.connect();
		openHolds.add(client);
		await client.query("begin");
		await client.query(statement, params);
		return {
			async release() {
				if (!openHolds.delete(client)) return;
				await client.query("commit");
				client.release();
			},
		};
	}

	const holdAdvisoryLock = (key: string) =>
		hold("select pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);

	/** Waits until `count` transactions wait on exactly this advisory key. */
	async function waitForWaiterOn(key: string, count = 1) {
		for (let attempt = 0; attempt < 200; attempt += 1) {
			const { rows } = await admin.query<{ waiting: number }>(
				`select count(*)::int as waiting from pg_locks l, (select hashtextextended($1, 0) as k) h
				 where l.locktype = 'advisory' and not l.granted
				   and l.classid = ((h.k >> 32) & 4294967295)::oid
				   and l.objid = (h.k & 4294967295)::oid`,
				[key],
			);
			if ((rows[0]?.waiting ?? 0) >= count) return;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		throw new Error(`No transaction waited on ${key}`);
	}

	/** Waits until some transaction waits on a row or transaction lock. */
	async function waitForRowWaiter() {
		for (let attempt = 0; attempt < 200; attempt += 1) {
			const { rows } = await admin.query(
				"select 1 from pg_locks where locktype <> 'advisory' and not granted limit 1",
			);
			if (rows.length > 0) return;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		throw new Error("No transaction waited on a row lock");
	}

	/**
	 * Starts the user's submission and pauses it on its identity key, after it
	 * holds its shared configuration/access protection and employee coordination.
	 */
	async function pausedSubmission(
		organizationId: typeof ids.orgA | typeof ids.orgB,
		command = manualCommand(organizationId),
	) {
		const identity = await holdAdvisoryLock(submissionIdentity(organizationId, command));
		const pending = submit(organizationId, command);
		await waitForWaiterOn(submissionIdentity(organizationId, command));
		return { pending, release: () => identity.release() };
	}

	/**
	 * Parks a writer after it took the user's exclusive guard: every settings-row
	 * insertion takes a key-share lock on the user row, and an existing row's
	 * upsert or a ban's update locks that row.
	 */
	const holdUserRow = () => hold('select 1 from "user" where id = $1 for update', [ids.user]);

	async function setAppend(organizationId: string, mode: "active" | null) {
		await admin.query("delete from time_entry_append_control where organization_id = $1", [
			organizationId,
		]);
		if (mode) {
			await admin.query(
				"insert into time_entry_append_control (organization_id, mode) values ($1, $2)",
				[organizationId, mode],
			);
		}
	}

	async function settings() {
		const { rows } = await admin.query<{
			timezone: string;
			week_start_day: string;
			locale: string | null;
			onboarding_step: string | null;
		}>(
			"select timezone, week_start_day, locale, onboarding_step from user_settings where user_id = $1",
			[ids.user],
		);
		return rows[0] ?? null;
	}

	async function intents() {
		const { rows } = await admin.query<{
			organization_id: string;
			reason: string;
			user_id: string | null;
			requested_by: string | null;
			attempts: number;
			last_error: string | null;
		}>(
			`select organization_id, reason, user_id, requested_by, attempts, last_error
			 from work_balance_rebuild_intent where organization_id = any($1::text[])
			 order by organization_id, requested_at`,
			[organizations],
		);
		return rows;
	}

	async function resetEmployees() {
		const { rows } = await admin.query<{ employee_id: string }>(
			`select employee_id from employee_work_balance
			 where organization_id = any($1::text[]) and computed_from_date = $2 order by employee_id`,
			[organizations, RESET_MARKER_DATE],
		);
		return rows.map((row) => row.employee_id);
	}

	async function workFor(employeeId: string) {
		const { rows } = await admin.query("select id from work_period where employee_id = $1", [
			employeeId,
		]);
		return rows;
	}

	/** Makes every full-rebuild reset fail until the trigger is dropped. */
	async function failRebuilds() {
		await admin.query(`create or replace function t312_fail_rebuild() returns trigger language plpgsql as $$
			begin
				if new.computed_from_date = '${RESET_MARKER_DATE}' then
					raise exception 't312 injected rebuild failure';
				end if;
				return new;
			end $$`);
		await admin.query(
			"create trigger t312_fail_rebuild before insert or update on employee_work_balance for each row execute function t312_fail_rebuild()",
		);
	}

	async function restoreRebuilds() {
		await admin.query("drop function if exists t312_fail_rebuild() cascade");
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

	async function cleanup() {
		await restoreRebuilds();
		await admin.query("drop function if exists t312_fail_intent() cascade");
		await admin.query("delete from platform_admin_audit_log where admin_user_id = $1", [
			ids.platformAdminUser,
		]);
		await admin.query("delete from organization where id = any($1::text[])", [organizations]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at)
			 select id, id, id, 'Europe/Berlin', $2 from unnest($1::text[]) as id`,
			[organizations, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at, role)
			 select user_id, user_id, user_id || '@example.test', $2, $2,
			        case when user_id = $3 then 'admin' else 'user' end
			 from unnest($1::text[]) as user_id`,
			[users, timestamp, ids.platformAdminUser],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t312-m-a', $1, $3, 'member', 'approved', $5),
			 ('t312-m-b', $2, $3, 'member', 'approved', $5),
			 ('t312-m-colleague', $1, $4, 'member', 'approved', $5)`,
			[ids.orgA, ids.orgB, ids.user, ids.colleagueUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $3, 'employee', $7), ($4, $2, $5, 'employee', $7), ($6, $8, $3, 'employee', $7)`,
			[
				ids.employeeA,
				ids.user,
				ids.orgA,
				ids.employeeB,
				ids.orgB,
				ids.colleagueA,
				timestamp,
				ids.colleagueUser,
			],
		);
		// No user settings rows: every employee falls back to the organization zone.
		for (const organizationId of organizations) {
			await admin.query(
				`insert into approval_workflow_rollout
				 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
				 values ($1, 'manual_time_submission', 'legacy', 'legacy', now(), now())`,
				[organizationId],
			);
			await setAppend(organizationId, "active");
		}
		await seedBalance(ids.employeeA, ids.orgA);
		await seedBalance(ids.employeeB, ids.orgB);
		await seedBalance(ids.colleagueA, ids.orgA);
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
			throw new Error("User configuration access PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		await seed();
	});

	// A failed race must not leave its paused side holding locks for the next test.
	afterEach(async () => {
		for (const client of openHolds) {
			await client.query("rollback");
			client.release();
		}
		openHolds.clear();
		await new Promise((resolve) => setTimeout(resolve, 200));
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	describe("timezone change and user-scoped rebuild intents", () => {
		it("commits the zone with one intent per adopted organization and rebuilds only the user's employees", async () => {
			await expect(changeTimezone("America/New_York")).resolves.toMatchObject({ success: true });

			expect(await settings()).toMatchObject({ timezone: "America/New_York" });
			// The post-commit execution consumed both organizations' intents.
			expect(await intents()).toEqual([]);
			expect(await resetEmployees()).toEqual([ids.employeeA, ids.employeeB].sort());
		});

		it("rolls the zone back in every organization when an intent cannot be written", async () => {
			await admin.query(`create or replace function t312_fail_intent() returns trigger language plpgsql as $$
				begin
					if new.organization_id = '${ids.orgB}' then raise exception 't312 injected intent failure'; end if;
					return new;
				end $$`);
			await admin.query(
				"create trigger t312_fail_intent before insert on work_balance_rebuild_intent for each row execute function t312_fail_intent()",
			);

			await expect(changeTimezone("America/New_York")).resolves.toMatchObject({
				success: false,
				error: "Failed to update timezone",
			});

			expect(await settings()).toBeNull();
			expect(await intents()).toEqual([]);
			expect(await resetEmployees()).toEqual([]);
		});

		it("reports a committed change as saved when its rebuild fails and recovers on the worker", async () => {
			await failRebuilds();

			await expect(changeTimezone("America/New_York")).resolves.toMatchObject({ success: true });

			expect(await settings()).toMatchObject({ timezone: "America/New_York" });
			expect(await intents()).toEqual([
				expect.objectContaining({
					organization_id: ids.orgA,
					reason: "user_timezone",
					user_id: ids.user,
					requested_by: ids.user,
					attempts: 1,
				}),
				expect.objectContaining({ organization_id: ids.orgB, user_id: ids.user, attempts: 1 }),
			]);
			expect((await intents())[0]?.last_error).toContain("t312 injected rebuild failure");
			expect(await resetEmployees()).toEqual([]);

			await restoreRebuilds();
			const result = await runWorkBalanceRefresh();

			expect(result.rebuildIntents).toMatchObject({ organizationsRebuilt: 2, failures: [] });
			expect(await intents()).toEqual([]);
			for (const [organizationId, employeeId] of Object.entries(employeeOf)) {
				await expect(getEmployeeWorkBalance({ employeeId, organizationId })).resolves.toMatchObject(
					{ employeeId, actualMinutes: 0 },
				);
			}
		});

		it("keeps an unchanged zone free of rebuild work", async () => {
			await admin.query(
				"insert into user_settings (user_id, timezone, updated_at) values ($1, 'Europe/Berlin', now())",
				[ids.user],
			);

			await expect(changeTimezone("Europe/Berlin")).resolves.toMatchObject({ success: true });

			expect(await intents()).toEqual([]);
			expect(await resetEmployees()).toEqual([]);
		});

		it("keeps the legacy in-transaction reset for an organization that has not adopted", async () => {
			await setAppend(ids.orgB, null);
			await failRebuilds();

			// Organization B's reset runs inside the save, so its failure fails the whole save.
			await expect(changeTimezone("America/New_York")).resolves.toMatchObject({ success: false });
			expect(await settings()).toBeNull();
			expect(await intents()).toEqual([]);

			await restoreRebuilds();
			await expect(changeTimezone("America/New_York")).resolves.toMatchObject({ success: true });
			expect(await intents()).toEqual([]);
			expect(await resetEmployees()).toEqual([ids.employeeA, ids.employeeB].sort());
		});
	});

	describe("protection against multi-organization manual submissions", () => {
		it("makes a timezone change wait for an in-flight submission in another organization", async () => {
			const submission = await pausedSubmission(ids.orgB);

			const change = changeTimezone("America/New_York");
			await waitForWaiterOn(userGuard);
			expect(await settings()).toBeNull();

			await submission.release();
			await expect(submission.pending).resolves.toMatchObject({ success: true });
			await expect(change).resolves.toMatchObject({ success: true });
			expect(await settings()).toMatchObject({ timezone: "America/New_York" });
			expect(await workFor(ids.employeeB)).toHaveLength(1);
		});

		it("makes submissions in every organization wait for a change and then reconfirm the zone", async () => {
			const userRow = await holdUserRow();
			const change = changeTimezone("America/New_York");
			await waitForRowWaiter();

			const inA = submit(ids.orgA, manualCommand(ids.orgA));
			const inB = submit(ids.orgB, manualCommand(ids.orgB));
			await waitForWaiterOn(userGuard, 2);

			await userRow.release();
			await expect(change).resolves.toMatchObject({ success: true });
			for (const submission of [inA, inB]) {
				await expect(submission).resolves.toMatchObject({
					rejection: {
						reason: "reconfirmation_required",
						detail: "zone_changed",
						timezone: "America/New_York",
					},
				});
			}
			expect(await workFor(ids.employeeA)).toEqual([]);
			expect(await workFor(ids.employeeB)).toEqual([]);

			// The committed zone governs new submissions immediately.
			const newYork = (time: string) => ({ time, occurrence: null, displayedOffsetMinutes: -240 });
			await expect(
				submit(
					ids.orgB,
					manualCommand(ids.orgB, {
						clockIn: newYork("08:00"),
						clockOut: newYork("12:30"),
						zone: { basis: "target", timezone: "America/New_York" },
						browserTimezone: "America/New_York",
					}),
				),
			).resolves.toMatchObject({ success: true });
			const { rows } = await admin.query<{ start_time: Date; utc_offset_minutes: number }>(
				`select period.start_time, entry.utc_offset_minutes from work_period period
				 join time_entry entry on entry.id = period.clock_in_id where period.employee_id = $1`,
				[ids.employeeB],
			);
			expect(only(rows)).toMatchObject({
				start_time: new Date("2026-09-01T12:00:00Z"),
				utc_offset_minutes: -240,
			});
		});

		it("revalidates a same-zone source change without reconfirmation", async () => {
			const userRow = await holdUserRow();
			// The organization zone becomes the user's own setting: same effective zone.
			const change = changeTimezone("Europe/Berlin");
			await waitForRowWaiter();
			const submission = submit(ids.orgA, manualCommand(ids.orgA));
			await waitForWaiterOn(userGuard);

			await userRow.release();
			await expect(change).resolves.toMatchObject({ success: true });
			await expect(submission).resolves.toMatchObject({ success: true });
			expect(await settings()).toMatchObject({ timezone: "Europe/Berlin" });
			expect(await workFor(ids.employeeA)).toHaveLength(1);
		});
	});

	describe("first settings-row insertion (absent rows)", () => {
		it("makes a preference's first row wait for an in-flight submission", async () => {
			const submission = await pausedSubmission(ids.orgA);

			const preference = as(ids.user, ids.orgA, () => updateWeekStartDay("monday"));
			await waitForWaiterOn(userGuard);
			expect(await settings()).toBeNull();

			await submission.release();
			await expect(submission.pending).resolves.toMatchObject({ success: true });
			await expect(preference).resolves.toMatchObject({ success: true });
			expect(await settings()).toMatchObject({ week_start_day: "monday", timezone: "UTC" });
		});

		it("orders the UTC fallback a first row introduces before later submissions", async () => {
			const userRow = await holdUserRow();
			const preference = as(ids.user, ids.orgA, () => updateWeekStartDay("monday"));
			await waitForRowWaiter();
			const submission = submit(ids.orgA, manualCommand(ids.orgA));
			await waitForWaiterOn(userGuard);

			await userRow.release();
			await expect(preference).resolves.toMatchObject({ success: true });
			// The schema default replaced the organization fallback with UTC.
			await expect(submission).resolves.toMatchObject({
				rejection: { reason: "reconfirmation_required", detail: "zone_changed", timezone: "UTC" },
			});
			expect(await workFor(ids.employeeA)).toEqual([]);
		});

		it.each([
			[
				"the bot and language-switcher locale",
				() => setUserLocale(ids.user, "de"),
				{ locale: "de" },
			],
			[
				"onboarding",
				() => as(ids.user, ids.orgB, () => startOnboarding()),
				{ onboarding_step: "welcome" },
			],
		] as const)("protects %s entry point's first row", async (_name, firstRow, expected) => {
			const submission = await pausedSubmission(ids.orgB);

			const write = firstRow();
			await waitForWaiterOn(userGuard);
			expect(await settings()).toBeNull();

			await submission.release();
			await expect(submission.pending).resolves.toMatchObject({ success: true });
			await expect(write).resolves.not.toMatchObject({ success: false });
			expect(await settings()).toMatchObject({ timezone: "UTC", ...expected });
		});
	});

	describe("scope restart", () => {
		it("restarts with an organization the user joined while the change waited", async () => {
			const submission = await pausedSubmission(ids.orgA);
			const change = changeTimezone("America/New_York");
			await waitForWaiterOn(userGuard);

			// An unprotected provisioning path (#318) adds the user to organization C.
			await admin.query(
				"insert into employee (id, user_id, organization_id, role, updated_at) values ($1, $2, $3, 'employee', now())",
				[ids.employeeC, ids.user, ids.orgC],
			);
			await seedBalance(ids.employeeC, ids.orgC);
			await failRebuilds();
			await submission.release();
			await expect(submission.pending).resolves.toMatchObject({ success: true });
			await expect(change).resolves.toMatchObject({ success: true });

			// The restarted attempt gated and recorded organization C as well.
			expect((await intents()).map((row) => row.organization_id)).toEqual([
				ids.orgA,
				ids.orgB,
				ids.orgC,
			]);
			await restoreRebuilds();
			await processWorkBalanceRebuildIntents();
			expect(await resetEmployees()).toEqual([ids.employeeA, ids.employeeB, ids.employeeC].sort());
		});

		it("restarts without an organization the user left while the change waited", async () => {
			const submission = await pausedSubmission(ids.orgA);
			const change = changeTimezone("America/New_York");
			await waitForWaiterOn(userGuard);

			// An unprotected cleanup path (#318) removes the user's employee in organization B.
			await admin.query("delete from employee where id = $1", [ids.employeeB]);
			await failRebuilds();
			// A stale scope would still write organization B's intent; make that fail the save.
			await admin.query(`create or replace function t312_fail_intent() returns trigger language plpgsql as $$
				begin
					if new.organization_id = '${ids.orgB}' then raise exception 't312 stale organization intent'; end if;
					return new;
				end $$`);
			await admin.query(
				"create trigger t312_fail_intent before insert on work_balance_rebuild_intent for each row execute function t312_fail_intent()",
			);
			await submission.release();
			await expect(submission.pending).resolves.toMatchObject({ success: true });
			await expect(change).resolves.toMatchObject({ success: true });

			expect((await intents()).map((row) => row.organization_id)).toEqual([ids.orgA]);
		});
	});

	describe("global access (platform ban)", () => {
		it("makes a ban wait for an in-flight submission in any organization, then refuses new ones", async () => {
			const submission = await pausedSubmission(ids.orgB);

			const banning = ban();
			await waitForWaiterOn(userGuard);

			await submission.release();
			await expect(submission.pending).resolves.toMatchObject({ success: true });
			await expect(banning).resolves.toMatchObject({ success: true });

			await expect(submit(ids.orgA, manualCommand(ids.orgA))).resolves.toMatchObject({
				success: false,
			});
			expect(await workFor(ids.employeeA)).toEqual([]);
		});

		it("refuses submissions in every organization that waited for a ban", async () => {
			const userRow = await holdUserRow();
			const banning = ban();
			await waitForRowWaiter();

			const inA = submit(ids.orgA, manualCommand(ids.orgA));
			const inB = submit(ids.orgB, manualCommand(ids.orgB));
			await waitForWaiterOn(userGuard, 2);

			await userRow.release();
			await expect(banning).resolves.toMatchObject({ success: true });
			for (const submission of [inA, inB]) {
				await expect(submission).resolves.toMatchObject({
					success: false,
					rejection: { reason: "target_not_authorized" },
				});
			}
			expect(await workFor(ids.employeeA)).toEqual([]);
			expect(await workFor(ids.employeeB)).toEqual([]);

			// Lifting the ban restores access.
			await expect(unban()).resolves.toMatchObject({ success: true });
			await expect(submit(ids.orgA, manualCommand(ids.orgA))).resolves.toMatchObject({
				success: true,
			});
		});

		it("makes an unban wait for a submission holding the user's protection", async () => {
			await admin.query('update "user" set banned = true where id = $1', [ids.user]);
			const guardHolder = await hold(
				"select pg_advisory_xact_lock_shared(hashtextextended($1, 0))",
				[userGuard],
			);
			const lifting = unban();
			await waitForWaiterOn(userGuard);
			const { rows } = await admin.query<{ banned: boolean }>(
				'select banned from "user" where id = $1',
				[ids.user],
			);
			expect(only(rows).banned).toBe(true);

			await guardHolder.release();
			await expect(lifting).resolves.toMatchObject({ success: true });
		});
	});

	describe("rebuild execution and consumer freshness", () => {
		it("hides only the changed user's projections while the rebuild is pending", async () => {
			await failRebuilds();
			await expect(changeTimezone("America/New_York")).resolves.toMatchObject({ success: true });

			for (const [organizationId, employeeId] of Object.entries(employeeOf)) {
				await expect(getEmployeeWorkBalance({ employeeId, organizationId })).resolves.toBeNull();
			}
			// The colleague in the same organization keeps a current projection.
			await expect(
				getEmployeeWorkBalance({ employeeId: ids.colleagueA, organizationId: ids.orgA }),
			).resolves.toMatchObject({ balanceMinutes: 120 });
			const team = await getEmployeeWorkBalances({
				employeeIds: [ids.employeeA, ids.colleagueA],
				organizationId: ids.orgA,
			});
			expect([...team.keys()]).toEqual([ids.colleagueA]);
			// The batch leaves the user's employees to the rebuild but not the colleague.
			await admin.query(
				"update employee_work_balance set is_dirty = true where employee_id = any($1::uuid[])",
				[[ids.employeeA, ids.colleagueA]],
			);
			const batch = await listEmployeesForWorkBalanceBatch(1000);
			const batched = batch.map((row) => row.id);
			expect(batched).toContain(ids.colleagueA);
			expect(batched).not.toContain(ids.employeeA);
			expect(batched).not.toContain(ids.employeeB);

			await restoreRebuilds();
			await processWorkBalanceRebuildIntents();
			expect(await resetEmployees()).toEqual([ids.employeeA, ids.employeeB].sort());
			// Reset markers remain not-current until the refresh recomputes them.
			await expect(
				getEmployeeWorkBalance({ employeeId: ids.employeeA, organizationId: ids.orgA }),
			).resolves.toBeNull();
		});

		it("widens to the whole organization when an organization intent is also pending", async () => {
			await failRebuilds();
			await expect(changeTimezone("America/New_York")).resolves.toMatchObject({ success: true });
			await admin.query(
				`insert into work_balance_rebuild_intent (organization_id, reason, requested_at)
				 values ($1, 'organization_timezone', now())`,
				[ids.orgA],
			);
			await restoreRebuilds();

			await expect(
				processWorkBalanceRebuildIntents({ organizationId: ids.orgA }),
			).resolves.toMatchObject({
				organizationsRebuilt: 1,
				failures: [],
			});
			expect(await resetEmployees()).toEqual([ids.employeeA, ids.colleagueA].sort());
			// Organization B's user intent is still pending and still scoped to the user.
			expect(await intents()).toEqual([
				expect.objectContaining({ organization_id: ids.orgB, user_id: ids.user }),
			]);
		});

		it("rejects an intent whose reason and user scope disagree", async () => {
			await expect(
				admin.query(
					`insert into work_balance_rebuild_intent (organization_id, reason, requested_at)
					 values ($1, 'user_timezone', now())`,
					[ids.orgA],
				),
			).rejects.toThrow(/work_balance_rebuild_intent_scope_check/);
			await expect(
				admin.query(
					`insert into work_balance_rebuild_intent (organization_id, reason, user_id, requested_at)
					 values ($1, 'organization_timezone', $2, now())`,
					[ids.orgA, ids.user],
				),
			).rejects.toThrow(/work_balance_rebuild_intent_scope_check/);
		});
	});
});
