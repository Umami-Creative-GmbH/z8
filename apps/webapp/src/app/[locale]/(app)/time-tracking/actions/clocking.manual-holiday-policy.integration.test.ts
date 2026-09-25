/**
 * #316 / T51 runtime evidence: organization holiday/blocking-category and
 * change-policy writers participate in the manual configuration protocol.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real public `createManualTimeEntry` action races the real mutation owners:
 * the org-admin holiday/category HTTP routes, the holiday settings actions and the
 * change-policy settings actions. Only the request/session, billing provisioning,
 * notification delivery and Next cache boundaries are replaced; each caller keeps
 * its own identity through async context so concurrent calls cannot swap sessions.
 * Writers are paused with real PostgreSQL locks, never with mocked transactions.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import type { ManualTimeEntryCommand } from "@/lib/time-tracking/manual-command";

type Identity = { userId: string; organizationId: string };

const harness = vi.hoisted(() => ({
	identity: null as { getStore(): Identity | undefined } | null,
	now: null as Instant | null,
}));

function currentIdentity(): Identity | null {
	return harness.identity?.getStore() ?? null;
}

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

vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => {},
}));

vi.mock("next/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/cache")>()),
	revalidatePath: vi.fn(),
	revalidateTag: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => {
				const identity = currentIdentity();
				return identity
					? {
							user: { id: identity.userId, role: "user" },
							session: {
								id: `t316-session-${identity.userId}`,
								userId: identity.userId,
								activeOrganizationId: identity.organizationId,
							},
						}
					: null;
			},
		},
	},
}));

vi.mock("@/lib/auth-helpers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/auth-helpers")>();
	const { db } = await import("@/db");
	const { loadOrganizationPrincipalContext } = await import("@/lib/authorization/principal-loader");
	const { defineAbilityFor } = await import("@/lib/authorization/ability");
	// The real loader on the test database, without Better Auth's session store.
	const getPrincipalContext = async () => {
		const identity = currentIdentity();
		return identity ? loadOrganizationPrincipalContext(db, identity) : null;
	};
	return {
		...original,
		getPrincipalContext,
		getAbility: async () => {
			const principal = await getPrincipalContext();
			return principal ? defineAbilityFor(principal) : null;
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

const identities = new AsyncLocalStorage<Identity>();
harness.identity = identities;

const { createManualTimeEntry } = await import("../actions");
const holidaysRoute = await import("@/app/api/org-admin/holidays/route");
const holidayRoute = await import("@/app/api/org-admin/holidays/[id]/route");
const holidayImportRoute = await import("@/app/api/org-admin/holidays/import/route");
const categoriesRoute = await import("@/app/api/org-admin/holiday-categories/route");
const categoryRoute = await import("@/app/api/org-admin/holiday-categories/[id]/route");
const holidayActions = await import("@/app/[locale]/(app)/settings/holidays/actions");
const policyActions = await import("@/app/[locale]/(app)/settings/change-policies/actions");

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
	describe.skip(`holiday/policy coordination PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t316-config-org",
	otherOrganization: "t316-other-org",
	employeeUser: "t316-employee-user",
	managerUser: "t316-manager-user",
	ownerUser: "t316-owner-user",
	otherOwnerUser: "t316-other-owner-user",
	employee: "e3160000-0000-4000-8000-000000000001",
	manager: "e3160000-0000-4000-8000-000000000002",
	owner: "e3160000-0000-4000-8000-000000000003",
	otherOwner: "e3160000-0000-4000-8000-000000000004",
	managerLink: "e3160000-0000-4000-8000-000000000010",
	strictPolicy: "e3160000-0000-4000-8000-000000000030",
	trustPolicy: "e3160000-0000-4000-8000-000000000031",
	otherPolicy: "e3160000-0000-4000-8000-000000000032",
	organizationAssignment: "e3160000-0000-4000-8000-000000000035",
	employeeAssignment: "e3160000-0000-4000-8000-000000000036",
	blockingCategory: "e3160000-0000-4000-8000-000000000040",
	openCategory: "e3160000-0000-4000-8000-000000000041",
	holiday: "e3160000-0000-4000-8000-000000000045",
} as const;
const users = [ids.employeeUser, ids.managerUser, ids.ownerUser, ids.otherOwnerUser];
const organizationGuard = JSON.stringify(["work-organization-configuration", ids.organization]);

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

type Endpoint = ManualTimeEntryCommand["clockIn"];
const at = (time: string, displayedOffsetMinutes = 120): Endpoint => ({
	time,
	occurrence: null,
	displayedOffsetMinutes,
});

/** A Berlin summer self entry for the employee on 2026-09-01 unless overridden. */
function manualCommand(overrides: Partial<ManualTimeEntryCommand> = {}): ManualTimeEntryCommand {
	return {
		version: 2,
		submissionId: randomUUID(),
		targetEmployeeId: ids.employee,
		date: "2026-09-01",
		clockIn: at("08:00"),
		clockOut: at("12:30"),
		zone: { basis: "target", timezone: "Europe/Berlin" },
		browserTimezone: "Europe/Berlin",
		reason: "Forgot to clock in",
		projectId: null,
		workCategoryId: null,
		...overrides,
	};
}

/** A later same-day command that does not overlap the default one. */
const freshCommand = () => manualCommand({ clockIn: at("13:00"), clockOut: at("14:00") });

function as<T>(userId: string, run: () => Promise<T>, organizationId: string = ids.organization) {
	return identities.run({ userId, organizationId }, run);
}

const asOwner = <T>(run: () => Promise<T>) => as(ids.ownerUser, run);

function submit(command: ManualTimeEntryCommand) {
	return as(ids.employeeUser, () => createManualTimeEntry(command));
}

function request(path: string, method: string, body?: unknown) {
	return new NextRequest(new URL(path, "http://localhost"), {
		method,
		...(body === undefined
			? {}
			: { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
	});
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** The committed result as an exact retry returns it: same facts, replayed. */
function replayOf(committed: unknown) {
	const { data } = committed as { data: Record<string, unknown> };
	return { success: true, data: { ...data, disposition: "replayed" } };
}

/** Awaits a route response and returns its status with its JSON body. */
async function respond(response: Promise<Response>) {
	const settled = await response;
	return { status: settled.status, body: await settled.json() };
}

function track<T>(promise: Promise<T>) {
	const state = { settled: false };
	return {
		promise: promise.finally(() => {
			state.settled = true;
		}),
		get settled() {
			return state.settled;
		},
	};
}

type Outcome = { approval: boolean } | { blocked: string } | { success: true };

function expectOutcome(result: unknown, outcome: Outcome) {
	if ("blocked" in outcome) {
		expect(result).toMatchObject({
			success: false,
			code: "holiday_blocked",
			holidayName: outcome.blocked,
		});
	} else if ("approval" in outcome) {
		expect(result).toMatchObject({ success: true, data: { requiresApproval: outcome.approval } });
	} else {
		expect(result).toMatchObject({ success: true });
	}
}

describeIntegration("holiday and change-policy configuration writers on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 8 });

	async function waitFor(check: () => Promise<boolean>, what: string) {
		for (let attempt = 0; attempt < 100; attempt += 1) {
			if (await check()) return;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error(`Timed out waiting for ${what}`);
	}

	/** Whether some transaction waits on the advisory lock `hashtextextended(key, 0)`. */
	async function advisoryWaiter(key: string) {
		const { rows } = await admin.query(
			`select 1 from pg_locks l, (select hashtextextended($1, 0) as k) h
			 where l.locktype = 'advisory' and not l.granted and l.objsubid = 1
			   and l.classid::bigint = (h.k >> 32) & 4294967295
			   and l.objid::bigint = h.k & 4294967295`,
			[key],
		);
		return rows.length > 0;
	}

	async function rowLockWaiter() {
		const { rows } = await admin.query(
			"select 1 from pg_locks where locktype in ('transactionid', 'tuple') and not granted",
		);
		return rows.length > 0;
	}

	async function holdInTransaction(statement: string, values: unknown[]) {
		const client = await admin.connect();
		await client.query("begin");
		await client.query(statement, values);
		return {
			async release() {
				await client.query("commit");
				client.release();
			},
		};
	}

	/**
	 * Starts a fresh submission and parks it on the employee key (rank 5), after
	 * it already holds the shared organization configuration guard (rank 3).
	 */
	async function parkedSubmission(command: ManualTimeEntryCommand = manualCommand()) {
		const employeeKey = await holdInTransaction(
			"select pg_advisory_xact_lock(hashtextextended($1, 0))",
			[ids.employee],
		);
		const pending = submit(command);
		await waitFor(() => advisoryWaiter(ids.employee), "the submission on the employee key");
		return { pending, release: () => employeeKey.release() };
	}

	/**
	 * The writer must wait on the exclusive organization configuration guard while
	 * a fresh submission holds it shared, so the submission commits on the prior
	 * configuration. A writer that skips the guard commits early and times out here.
	 */
	async function writeBehindParkedSubmission<T>(write: () => Promise<T>) {
		const parked = await parkedSubmission();
		let released = false;
		try {
			const writer = track(asOwner(write));
			await waitFor(
				() => advisoryWaiter(organizationGuard),
				"the writer on the organization configuration guard",
			);
			expect(writer.settled).toBe(false);
			await parked.release();
			released = true;
			const submitted = await parked.pending;
			return { submitted, written: await writer.promise };
		} finally {
			if (!released) await parked.release();
		}
	}

	/**
	 * Parks a writer on a row lock after it took the exclusive guard; a fresh
	 * submission must then wait for the writer's commit and read its change.
	 */
	async function submitBehindParkedWriter<T>(
		rowLock: { statement: string; values: unknown[] },
		write: () => Promise<T>,
		command: ManualTimeEntryCommand = manualCommand(),
	) {
		const row = await holdInTransaction(rowLock.statement, rowLock.values);
		let released = false;
		try {
			const writer = track(asOwner(write));
			await waitFor(rowLockWaiter, "the writer on the held row");
			const pending = track(submit(command));
			await waitFor(
				() => advisoryWaiter(organizationGuard),
				"the submission on the organization configuration guard",
			);
			expect(pending.settled).toBe(false);
			await row.release();
			released = true;
			const written = await writer.promise;
			return { written, submitted: await pending.promise };
		} finally {
			if (!released) await row.release();
		}
	}

	/** Every row a manual submission can write, to prove "no writes" by equality. */
	async function workSnapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts,
			   (select json_agg(row_to_json(t) order by t.id) from approval_request t where organization_id = $1) as requests`,
			[ids.organization],
		);
		return only(rows);
	}

	async function policySnapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from change_policy t where organization_id in ($1, $2)) as policies,
			   (select json_agg(row_to_json(t) order by t.id) from change_policy_assignment t where organization_id in ($1, $2)) as assignments`,
			[ids.organization, ids.otherOrganization],
		);
		return only(rows);
	}

	async function cleanup() {
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
			 ($1, 'T316 config', $1, 'Europe/Berlin', $3), ($2, 'T316 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t316-m-employee', $1, $3, 'member', 'approved', $7),
			 ('t316-m-manager', $1, $4, 'member', 'approved', $7),
			 ('t316-m-owner', $1, $5, 'owner', 'approved', $7),
			 ('t316-m-other-owner', $2, $6, 'owner', 'approved', $7)`,
			[
				ids.organization,
				ids.otherOrganization,
				ids.employeeUser,
				ids.managerUser,
				ids.ownerUser,
				ids.otherOwnerUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $9, 'employee', $11), ($3, $4, $9, 'manager', $11),
			 ($5, $6, $9, 'admin', $11), ($7, $8, $10, 'employee', $11)`,
			[
				ids.employee,
				ids.employeeUser,
				ids.manager,
				ids.managerUser,
				ids.owner,
				ids.ownerUser,
				ids.otherOwner,
				ids.otherOwnerUser,
				ids.organization,
				ids.otherOrganization,
				timestamp,
			],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at) values
			 ($1, 'Europe/Berlin', $3), ($2, 'UTC', $3)`,
			[ids.employeeUser, ids.managerUser, timestamp],
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
		await admin.query(
			"insert into time_entry_append_control (organization_id, mode) values ($1, 'active')",
			[ids.organization],
		);
	}

	async function seedCategory(id: string, blocksTimeEntry: boolean) {
		await admin.query(
			`insert into holiday_category (id, organization_id, type, name, blocks_time_entry, updated_at)
			 values ($1, $2, 'company_holiday', $3, $4, now())`,
			[id, ids.organization, blocksTimeEntry ? "Closed" : "Informational", blocksTimeEntry],
		);
	}

	async function seedHoliday(input: { categoryId: string; date: string; name?: string }) {
		await admin.query(
			`insert into holiday (id, organization_id, category_id, name, start_date, end_date, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, now())`,
			[
				ids.holiday,
				ids.organization,
				input.categoryId,
				input.name ?? "Closing day",
				`${input.date}T00:00:00`,
				`${input.date}T23:59:59`,
				ids.ownerUser,
			],
		);
	}

	/** Strict: same-day self-service, then seven approval days. Trust: no approval. */
	async function seedPolicies() {
		await admin.query(
			`insert into change_policy
			 (id, organization_id, name, self_service_days, approval_days, no_approval_required, created_by, updated_at)
			 values ($1, $3, 'Strict', 0, 7, false, $5, now()),
			        ($2, $3, 'Trust', 0, 7, true, $5, now()),
			        ($4, $6, 'Other organization', 0, 7, false, $7, now())`,
			[
				ids.strictPolicy,
				ids.trustPolicy,
				ids.organization,
				ids.otherPolicy,
				ids.ownerUser,
				ids.otherOrganization,
				ids.otherOwnerUser,
			],
		);
	}

	async function assign(input: {
		id: string;
		policyId: string;
		level: "organization" | "employee";
		effectiveFrom?: string | null;
		effectiveUntil?: string | null;
	}) {
		await admin.query(
			`insert into change_policy_assignment
			 (id, policy_id, organization_id, assignment_type, employee_id, priority, effective_from, effective_until, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
			[
				input.id,
				input.policyId,
				ids.organization,
				input.level,
				input.level === "employee" ? ids.employee : null,
				input.level === "employee" ? 2 : 0,
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
			throw new Error("Holiday/policy coordination PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		// 2026-09-03 12:00 in Berlin: an entry on the 1st is two calendar days old.
		harness.now = parseInstant("2026-09-03T10:00:00Z");
		await seed();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	type WriterCase = {
		name: string;
		setup?: () => Promise<void>;
		write: () => Promise<unknown>;
		/** The parked submission's outcome: always on the prior configuration. */
		before: Outcome;
		/** A fresh submission's outcome once the change committed. */
		after: Outcome;
	};

	const holidayWriters: WriterCase[] = [
		{
			name: "POST /api/org-admin/holidays",
			setup: () => seedCategory(ids.blockingCategory, true),
			write: () =>
				respond(
					holidaysRoute.POST(
						request("/api/org-admin/holidays", "POST", {
							name: "Company day",
							categoryId: ids.blockingCategory,
							startDate: "2026-09-01T00:00:00Z",
							endDate: "2026-09-01T23:59:59Z",
							recurrenceType: "none",
						}),
					),
				),
			before: { success: true },
			after: { blocked: "Company day" },
		},
		{
			name: "PATCH /api/org-admin/holidays/[id]",
			setup: async () => {
				await seedCategory(ids.blockingCategory, true);
				await seedHoliday({ categoryId: ids.blockingCategory, date: "2026-08-20" });
			},
			write: () =>
				respond(
					holidayRoute.PATCH(
						request(`/api/org-admin/holidays/${ids.holiday}`, "PATCH", {
							startDate: "2026-09-01T00:00:00Z",
							endDate: "2026-09-01T23:59:59Z",
						}),
						params(ids.holiday),
					),
				),
			before: { success: true },
			after: { blocked: "Closing day" },
		},
		{
			name: "DELETE /api/org-admin/holidays/[id]",
			setup: async () => {
				await seedCategory(ids.blockingCategory, true);
				await seedHoliday({ categoryId: ids.blockingCategory, date: "2026-09-01" });
			},
			write: () =>
				respond(
					holidayRoute.DELETE(
						request(`/api/org-admin/holidays/${ids.holiday}`, "DELETE"),
						params(ids.holiday),
					),
				),
			before: { blocked: "Closing day" },
			after: { success: true },
		},
		{
			name: "POST /api/org-admin/holidays/import",
			write: () =>
				respond(
					holidayImportRoute.POST(
						request("/api/org-admin/holidays/import", "POST", {
							holidays: [
								{
									name: "Imported day",
									date: "2026-09-01",
									startDate: "2026-09-01T00:00:00Z",
									endDate: "2026-09-01T23:59:59Z",
									type: "public",
								},
							],
						}),
					),
				),
			before: { success: true },
			after: { blocked: "Imported day" },
		},
		{
			name: "settings deleteHoliday",
			setup: async () => {
				await seedCategory(ids.blockingCategory, true);
				await seedHoliday({ categoryId: ids.blockingCategory, date: "2026-09-01" });
			},
			write: () => holidayActions.deleteHoliday(ids.holiday),
			before: { blocked: "Closing day" },
			after: { success: true },
		},
		{
			name: "settings bulkDeleteHolidays",
			setup: async () => {
				await seedCategory(ids.blockingCategory, true);
				await seedHoliday({ categoryId: ids.blockingCategory, date: "2026-09-01" });
			},
			write: () => holidayActions.bulkDeleteHolidays([ids.holiday]),
			before: { blocked: "Closing day" },
			after: { success: true },
		},
		{
			name: "POST /api/org-admin/holiday-categories",
			write: () =>
				respond(
					categoriesRoute.POST(
						request("/api/org-admin/holiday-categories", "POST", {
							type: "company_holiday",
							name: "New category",
						}),
					),
				),
			before: { success: true },
			after: { success: true },
		},
		{
			name: "PATCH /api/org-admin/holiday-categories/[id]",
			setup: async () => {
				await seedCategory(ids.openCategory, false);
				await seedHoliday({ categoryId: ids.openCategory, date: "2026-09-01" });
			},
			write: () =>
				respond(
					categoryRoute.PATCH(
						request(`/api/org-admin/holiday-categories/${ids.openCategory}`, "PATCH", {
							blocksTimeEntry: true,
						}),
						params(ids.openCategory),
					),
				),
			before: { success: true },
			after: { blocked: "Closing day" },
		},
		{
			name: "DELETE /api/org-admin/holiday-categories/[id]",
			setup: async () => {
				await seedCategory(ids.blockingCategory, true);
				await seedHoliday({ categoryId: ids.blockingCategory, date: "2026-09-01" });
			},
			write: () =>
				respond(
					categoryRoute.DELETE(
						request(`/api/org-admin/holiday-categories/${ids.blockingCategory}`, "DELETE"),
						params(ids.blockingCategory),
					),
				),
			before: { blocked: "Closing day" },
			after: { success: true },
		},
		{
			name: "settings deleteCategory",
			setup: () => seedCategory(ids.blockingCategory, true),
			write: () => holidayActions.deleteCategory(ids.blockingCategory),
			before: { success: true },
			after: { success: true },
		},
	];

	const policyWriters: WriterCase[] = [
		{
			name: "createChangePolicy",
			write: () =>
				policyActions.createChangePolicy(ids.organization, {
					name: "Created",
					selfServiceDays: 0,
					approvalDays: 7,
				}),
			before: { approval: false },
			after: { approval: false },
		},
		{
			name: "updateChangePolicy",
			setup: async () => {
				await seedPolicies();
				await assign({
					id: ids.organizationAssignment,
					policyId: ids.trustPolicy,
					level: "organization",
				});
			},
			write: () => policyActions.updateChangePolicy(ids.trustPolicy, { noApprovalRequired: false }),
			before: { approval: false },
			after: { approval: true },
		},
		{
			name: "deleteChangePolicy",
			setup: async () => {
				await seedPolicies();
				await assign({
					id: ids.organizationAssignment,
					policyId: ids.strictPolicy,
					level: "organization",
				});
				await assign({ id: ids.employeeAssignment, policyId: ids.trustPolicy, level: "employee" });
			},
			// The employee's trust policy goes inactive; the organization's strict one decides.
			write: () => policyActions.deleteChangePolicy(ids.trustPolicy),
			before: { approval: false },
			after: { approval: true },
		},
		{
			name: "createChangePolicyAssignment",
			setup: seedPolicies,
			write: () =>
				policyActions.createChangePolicyAssignment(ids.organization, {
					policyId: ids.strictPolicy,
					assignmentType: "organization",
				}),
			before: { approval: false },
			after: { approval: true },
		},
		{
			name: "deleteChangePolicyAssignment",
			setup: async () => {
				await seedPolicies();
				await assign({
					id: ids.organizationAssignment,
					policyId: ids.strictPolicy,
					level: "organization",
				});
				await assign({ id: ids.employeeAssignment, policyId: ids.trustPolicy, level: "employee" });
			},
			write: () => policyActions.deleteChangePolicyAssignment(ids.employeeAssignment),
			before: { approval: false },
			after: { approval: true },
		},
	];

	function expectWriterSucceeded(written: unknown) {
		if (written && typeof written === "object" && "status" in written) {
			expect((written as { status: number }).status).toBeLessThan(300);
		} else {
			expect(written).toMatchObject({ success: true });
		}
	}

	describe("every holiday/blocking-category mutation owner waits for in-flight submissions", () => {
		it.each(holidayWriters)("$name", async ({ setup, write, before, after }) => {
			await setup?.();

			const { submitted, written } = await writeBehindParkedSubmission(write);

			expectWriterSucceeded(written);
			expectOutcome(submitted, before);
			expectOutcome(await submit(freshCommand()), after);
		});
	});

	describe("every change-policy value/assignment mutation owner waits for in-flight submissions", () => {
		it.each(policyWriters)("$name", async ({ setup, write, before, after }) => {
			await setup?.();

			const { submitted, written } = await writeBehindParkedSubmission(write);

			expectWriterSucceeded(written);
			expectOutcome(submitted, before);
			expectOutcome(await submit(freshCommand()), after);
		});
	});

	describe("a submission arriving during a mutation waits and reads the committed change", () => {
		it("a created blocking holiday", async () => {
			await seedCategory(ids.blockingCategory, true);

			const { written, submitted } = await submitBehindParkedWriter(
				// The holiday's category foreign-key check waits behind this row lock.
				{
					statement: "select id from holiday_category where id = $1 for update",
					values: [ids.blockingCategory],
				},
				() =>
					respond(
						holidaysRoute.POST(
							request("/api/org-admin/holidays", "POST", {
								name: "Company day",
								categoryId: ids.blockingCategory,
								startDate: "2026-09-01T00:00:00Z",
								endDate: "2026-09-01T23:59:59Z",
								recurrenceType: "none",
							}),
						),
					),
			);

			expect(written.status).toBe(201);
			expectOutcome(submitted, { blocked: "Company day" });
			expect((await workSnapshot()).periods).toBeNull();
		});

		it("an inserted employee assignment", async () => {
			await seedPolicies();

			const { written, submitted } = await submitBehindParkedWriter(
				{
					statement: "select id from change_policy where id = $1 for update",
					values: [ids.strictPolicy],
				},
				() =>
					policyActions.createChangePolicyAssignment(ids.organization, {
						policyId: ids.strictPolicy,
						assignmentType: "employee",
						employeeId: ids.employee,
					}),
			);

			expect(written).toMatchObject({ success: true });
			expectOutcome(submitted, { approval: true });
		});

		it("a deleted assignment", async () => {
			await seedPolicies();
			await assign({
				id: ids.organizationAssignment,
				policyId: ids.strictPolicy,
				level: "organization",
			});

			const { written, submitted } = await submitBehindParkedWriter(
				{
					statement: "select id from change_policy_assignment where id = $1 for update",
					values: [ids.organizationAssignment],
				},
				() => policyActions.deleteChangePolicyAssignment(ids.organizationAssignment),
			);

			expect(written).toMatchObject({ success: true });
			expectOutcome(submitted, { approval: false });
		});
	});

	describe("fresh restart versus committed replay", () => {
		it("re-reads a policy change committed between an approval-scope restart's attempts", async () => {
			await seedPolicies();
			await assign({
				id: ids.organizationAssignment,
				policyId: ids.strictPolicy,
				level: "organization",
			});
			const parked = await parkedSubmission();
			let released = false;
			let writer: ReturnType<typeof track<unknown>>;
			try {
				writer = track(
					asOwner(() =>
						policyActions.updateChangePolicy(ids.strictPolicy, { noApprovalRequired: true }),
					),
				);
				await waitFor(
					() => advisoryWaiter(organizationGuard),
					"the writer on the organization configuration guard",
				);
				// The first attempt decides approval on the strict policy and restarts to
				// route participants; the queued writer commits before the second attempt
				// can take the shared guard, and the restart evaluates freshly.
				await parked.release();
				released = true;
			} finally {
				if (!released) await parked.release();
			}
			const submitted = await parked.pending;
			await expect(writer.promise).resolves.toMatchObject({ success: true });

			expectOutcome(submitted, { approval: false });
			const { rows } = await admin.query(
				"select count(*)::int as requests from approval_request where organization_id = $1",
				[ids.organization],
			);
			expect(rows[0].requests).toBe(0);
		});

		it("replays a committed submission after a holiday blocks its date, while fresh work is blocked", async () => {
			await seedCategory(ids.blockingCategory, true);
			const command = manualCommand();
			const committed = await submit(command);
			expectOutcome(committed, { success: true });
			const created = await asOwner(() =>
				respond(
					holidaysRoute.POST(
						request("/api/org-admin/holidays", "POST", {
							name: "Company day",
							categoryId: ids.blockingCategory,
							startDate: "2026-09-01T00:00:00Z",
							endDate: "2026-09-01T23:59:59Z",
							recurrenceType: "none",
						}),
					),
				),
			);
			expect(created.status).toBe(201);
			const before = await workSnapshot();

			await expect(submit(structuredClone(command))).resolves.toEqual(replayOf(committed));
			expect(await workSnapshot()).toEqual(before);
			expectOutcome(await submit(freshCommand()), { blocked: "Company day" });
		});

		it("replays the original approval participation after the policy changes", async () => {
			await seedPolicies();
			await assign({
				id: ids.organizationAssignment,
				policyId: ids.strictPolicy,
				level: "organization",
			});
			const command = manualCommand();
			const committed = await submit(command);
			expectOutcome(committed, { approval: true });
			await expect(
				asOwner(() =>
					policyActions.updateChangePolicy(ids.strictPolicy, { noApprovalRequired: true }),
				),
			).resolves.toMatchObject({ success: true });
			const before = await workSnapshot();

			await expect(submit(structuredClone(command))).resolves.toEqual(replayOf(committed));
			expect(await workSnapshot()).toEqual(before);
			expectOutcome(await submit(freshCommand()), { approval: false });
		});
	});

	describe("one evaluation instant for assignment windows and calendar-day age", () => {
		it("applies an assignment effective from local midnight at exactly that instant", async () => {
			await seedPolicies();
			const created = await asOwner(() =>
				policyActions.createChangePolicyAssignment(ids.organization, {
					policyId: ids.strictPolicy,
					assignmentType: "employee",
					employeeId: ids.employee,
					// Midnight starting 2026-09-04 in Berlin.
					effectiveFrom: new Date("2026-09-03T22:00:00Z"),
				}),
			);
			expect(created).toMatchObject({ success: true });
			const entry = (clockIn: string, clockOut: string) =>
				manualCommand({ date: "2026-09-03", clockIn: at(clockIn), clockOut: at(clockOut) });

			// 23:59:59.999 on the 3rd: not yet effective, and the entry is from today.
			harness.now = parseInstant("2026-09-03T21:59:59.999Z");
			expectOutcome(await submit(entry("08:00", "09:00")), { approval: false });
			// 00:00 on the 4th: effective, and the same instant makes the entry one day old.
			harness.now = parseInstant("2026-09-03T22:00:00Z");
			expectOutcome(await submit(entry("10:00", "11:00")), { approval: true });
		});

		it("stops applying an assignment at its expiry instant", async () => {
			await seedPolicies();
			const created = await asOwner(() =>
				policyActions.createChangePolicyAssignment(ids.organization, {
					policyId: ids.strictPolicy,
					assignmentType: "employee",
					employeeId: ids.employee,
					effectiveUntil: new Date("2026-09-03T22:00:00Z"),
				}),
			);
			expect(created).toMatchObject({ success: true });
			const entry = (clockIn: string, clockOut: string) =>
				manualCommand({ date: "2026-09-02", clockIn: at(clockIn), clockOut: at(clockOut) });

			harness.now = parseInstant("2026-09-03T21:59:59.999Z");
			expectOutcome(await submit(entry("08:00", "09:00")), { approval: true });
			harness.now = parseInstant("2026-09-03T22:00:00Z");
			expectOutcome(await submit(entry("10:00", "11:00")), { approval: false });
		});
	});

	describe("organization scope of assignment writes", () => {
		it("refuses another organization's policy or employee and an inactive policy, writing nothing", async () => {
			await seedPolicies();
			const before = await policySnapshot();

			for (const input of [
				{ policyId: ids.otherPolicy, assignmentType: "organization" as const },
				{
					policyId: ids.strictPolicy,
					assignmentType: "employee" as const,
					employeeId: ids.otherOwner,
				},
			]) {
				await expect(
					asOwner(() => policyActions.createChangePolicyAssignment(ids.organization, input)),
				).resolves.toMatchObject({ success: false });
			}
			await admin.query("update change_policy set is_active = false where id = $1", [
				ids.trustPolicy,
			]);
			const afterDeactivation = await policySnapshot();
			await expect(
				asOwner(() =>
					policyActions.createChangePolicyAssignment(ids.organization, {
						policyId: ids.trustPolicy,
						assignmentType: "organization",
					}),
				),
			).resolves.toMatchObject({ success: false });

			expect(afterDeactivation.assignments).toEqual(before.assignments);
			expect((await policySnapshot()).assignments).toEqual(before.assignments);
		});
	});
});
