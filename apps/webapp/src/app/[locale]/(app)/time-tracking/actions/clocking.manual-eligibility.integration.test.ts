/**
 * #315 / T50 runtime evidence: project and category eligibility mutations
 * serialize with protected manual preparation.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real settings server actions (projects and work categories) race the real
 * public `createManualTimeEntry` action in both arrival orders. Only the
 * request/session, SSO proof, billing provisioning, notification delivery and
 * Next cache boundaries are replaced. A writer is held inside its own
 * transaction by a row lock taken from a side connection, so the test observes
 * whether it already holds exclusive configuration protection at that point.
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

const harness = vi.hoisted(() => ({ now: null as Instant | null }));

// Concurrent actions each keep their own request session.
const { sessions } = await vi.hoisted(async () => {
	const { AsyncLocalStorage } = await import("node:async_hooks");
	return {
		sessions: new AsyncLocalStorage<{ userId: string; organizationId: string }>(),
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
			getSession: async () => {
				const current = sessions.getStore();
				return current
					? {
							user: { id: current.userId, role: "user" },
							session: {
								id: `t315-session-${current.userId}`,
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
		// The real loader on the test database, without Better Auth's session store.
		getPrincipalContext: async () => {
			const current = sessions.getStore();
			return current ? loadOrganizationPrincipalContext(db, current) : null;
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

vi.mock("@/lib/audit-logger", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/audit-logger")>()),
	logAudit: async () => undefined,
}));

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

const { createManualTimeEntry } = await import("../actions");
const { getManualEntryTargetContext } = await import("./manual-entry-context");
const projects = await import("@/app/[locale]/(app)/settings/projects/actions");
const categories = await import("@/app/[locale]/(app)/settings/work-categories/actions");

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
	describe.skip(`manual eligibility PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t315-eligibility-org",
	otherOrganization: "t315-other-org",
	employeeUser: "t315-employee-user",
	ownerUser: "t315-owner-user",
	otherUser: "t315-other-user",
	employee: "e3150000-0000-4000-8000-000000000001",
	owner: "e3150000-0000-4000-8000-000000000002",
	otherEmployee: "e3150000-0000-4000-8000-000000000003",
	team: "e3150000-0000-4000-8000-000000000010",
	otherTeam: "e3150000-0000-4000-8000-000000000011",
	project: "e3150000-0000-4000-8000-000000000020",
	projectAssignment: "e3150000-0000-4000-8000-000000000021",
	otherProject: "e3150000-0000-4000-8000-000000000022",
	category: "e3150000-0000-4000-8000-000000000050",
	categorySet: "e3150000-0000-4000-8000-000000000051",
	categorySetAssignment: "e3150000-0000-4000-8000-000000000052",
	otherCategory: "e3150000-0000-4000-8000-000000000053",
	otherCategorySet: "e3150000-0000-4000-8000-000000000054",
} as const;
const users = [ids.employeeUser, ids.ownerUser, ids.otherUser];

type Endpoint = ManualTimeEntryCommand["clockIn"];
const at = (time: string, displayedOffsetMinutes: number): Endpoint => ({
	time,
	occurrence: null,
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
		reason: "Forgot to clock in",
		projectId: null,
		workCategoryId: null,
		...overrides,
	};
}

type Mutation = {
	name: string;
	/** Eligibility of the selection before the mutation. */
	eligibleBefore: boolean;
	arrange: () => Promise<void>;
	selection: () => Pick<ManualTimeEntryCommand, "projectId" | "workCategoryId">;
	/** Blocks the writer's first dependent write from a side connection. */
	rowLock: () => [string, unknown[]];
	mutate: () => Promise<{ success: boolean }>;
};

describeIntegration("project and category eligibility coordination on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 8 });

	function actAs<T>(userId: string, action: () => Promise<T>): Promise<T> {
		return sessions.run({ userId, organizationId: ids.organization }, action);
	}

	function submit(command: ManualTimeEntryCommand | Record<string, unknown>) {
		return actAs(ids.employeeUser, () => createManualTimeEntry(command as ManualTimeEntryCommand));
	}

	/** Settings writers run as the organization owner. */
	function asOwner<T>(write: () => Promise<T>): Promise<T> {
		return actAs(ids.ownerUser, write);
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

	async function periods() {
		const { rows } = await admin.query<{
			id: string;
			project_id: string | null;
			work_category_id: string | null;
		}>(
			"select id, project_id, work_category_id from work_period where organization_id = $1 order by start_time",
			[ids.organization],
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

	async function holdRowLock([statement, parameters]: [string, unknown[]]) {
		const client = await admin.connect();
		await client.query("begin");
		const { rowCount } = await client.query(statement, parameters);
		if (rowCount !== 1) throw new Error(`Row lock matched ${rowCount} rows`);
		return {
			async release() {
				await client.query("commit");
				client.release();
			},
		};
	}

	/** Backends of this database blocked on a heavyweight, row or advisory lock. */
	async function waitForLockWaiters(count: number) {
		for (let attempt = 0; attempt < 200; attempt += 1) {
			const { rows } = await admin.query<{ waiting: number }>(
				`select count(*)::int as waiting from pg_stat_activity
				 where datname = current_database() and wait_event_type = 'Lock'`,
			);
			if ((rows[0]?.waiting ?? 0) >= count) return;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		throw new Error(`Fewer than ${count} transactions waited on a lock`);
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
			 ($1, 'T315 eligibility', $1, 'Europe/Berlin', $3), ($2, 'T315 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t315-m-employee', $1, $3, 'member', 'approved', $6),
			 ('t315-m-owner', $1, $4, 'owner', 'approved', $6),
			 ('t315-m-other', $2, $5, 'member', 'approved', $6)`,
			[
				ids.organization,
				ids.otherOrganization,
				ids.employeeUser,
				ids.ownerUser,
				ids.otherUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into team (id, organization_id, name, updated_at) values
			 ($1, $3, 'T315 team', $5), ($2, $4, 'T315 other team', $5)`,
			[ids.team, ids.otherTeam, ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, team_id, role, updated_at) values
			 ($1, $2, $7, $9, 'employee', $10), ($3, $4, $7, null, 'admin', $10),
			 ($5, $6, $8, $11, 'employee', $10)`,
			[
				ids.employee,
				ids.employeeUser,
				ids.owner,
				ids.ownerUser,
				ids.otherEmployee,
				ids.otherUser,
				ids.organization,
				ids.otherOrganization,
				ids.team,
				timestamp,
				ids.otherTeam,
			],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at) values ($1, 'Europe/Berlin', $2)`,
			[ids.employeeUser, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'manual_time_submission', 'legacy', 'legacy', now(), now())`,
			[ids.organization],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at) values
			 ($1, $3, 'T315 project', 'active', true, $5, now()),
			 ($2, $4, 'T315 foreign project', 'active', true, $5, now())`,
			[ids.project, ids.otherProject, ids.organization, ids.otherOrganization, ids.ownerUser],
		);
		await admin.query(
			`insert into work_category (id, organization_id, name, created_by, updated_at) values
			 ($1, $3, 'T315 night', $5, now()), ($2, $4, 'T315 foreign', $5, now())`,
			[ids.category, ids.otherCategory, ids.organization, ids.otherOrganization, ids.ownerUser],
		);
		await admin.query(
			`insert into work_category_set (id, organization_id, name, created_by, updated_at) values
			 ($1, $3, 'T315 set', $5, now()), ($2, $4, 'T315 foreign set', $5, now())`,
			[
				ids.categorySet,
				ids.otherCategorySet,
				ids.organization,
				ids.otherOrganization,
				ids.ownerUser,
			],
		);
		await admin.query(
			"insert into work_category_set_category (set_id, category_id) values ($1, $2), ($3, $4)",
			[ids.categorySet, ids.category, ids.otherCategorySet, ids.otherCategory],
		);
		await setAppend("active");
	}

	async function assignProjectToEmployee() {
		await admin.query(
			`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
			 values ($1, $2, $3, 'employee', $4, $5)`,
			[ids.projectAssignment, ids.project, ids.organization, ids.employee, ids.ownerUser],
		);
	}

	async function assignSetToEmployee() {
		await admin.query(
			`insert into work_category_set_assignment
			 (id, set_id, organization_id, assignment_type, employee_id, priority, created_by, updated_at)
			 values ($1, $2, $3, 'employee', $4, 2, $5, now())`,
			[ids.categorySetAssignment, ids.categorySet, ids.organization, ids.employee, ids.ownerUser],
		);
	}

	const withProject = () => ({ projectId: ids.project, workCategoryId: null });
	const withCategory = () => ({ projectId: null, workCategoryId: ids.category });

	const mutations: Mutation[] = [
		{
			name: "a project status leaving the bookable lifecycle",
			eligibleBefore: true,
			arrange: assignProjectToEmployee,
			selection: withProject,
			rowLock: () => ["select 1 from project where id = $1 for update", [ids.project]],
			mutate: () => asOwner(() => projects.updateProject(ids.project, { status: "completed" })),
		},
		{
			name: "a removed project assignment",
			eligibleBefore: true,
			arrange: assignProjectToEmployee,
			selection: withProject,
			rowLock: () => [
				"select 1 from project_assignment where id = $1 for update",
				[ids.projectAssignment],
			],
			mutate: () => asOwner(() => projects.removeProjectAssignment(ids.projectAssignment)),
		},
		{
			name: "an inserted team project assignment where none existed",
			eligibleBefore: false,
			arrange: async () => {},
			selection: withProject,
			rowLock: () => ["select 1 from project where id = $1 for update", [ids.project]],
			mutate: () => asOwner(() => projects.addProjectAssignment(ids.project, "team", ids.team)),
		},
		{
			name: "an inserted employee project assignment where none existed",
			eligibleBefore: false,
			arrange: async () => {},
			selection: withProject,
			rowLock: () => ["select 1 from project where id = $1 for update", [ids.project]],
			mutate: () =>
				asOwner(() => projects.addProjectAssignment(ids.project, "employee", ids.employee)),
		},
		{
			name: "a category removed from the set contents",
			eligibleBefore: true,
			arrange: assignSetToEmployee,
			selection: withCategory,
			rowLock: () => [
				"select 1 from work_category_set_category where set_id = $1 and category_id = $2 for update",
				[ids.categorySet, ids.category],
			],
			mutate: () => asOwner(() => categories.updateSetCategories(ids.categorySet, [])),
		},
		{
			name: "a category added to the set contents",
			eligibleBefore: false,
			arrange: async () => {
				await admin.query("delete from work_category_set_category where set_id = $1", [
					ids.categorySet,
				]);
				await assignSetToEmployee();
			},
			selection: withCategory,
			rowLock: () => ["select 1 from work_category where id = $1 for update", [ids.category]],
			mutate: () => asOwner(() => categories.updateSetCategories(ids.categorySet, [ids.category])),
		},
		{
			name: "a deactivated category",
			eligibleBefore: true,
			arrange: assignSetToEmployee,
			selection: withCategory,
			rowLock: () => ["select 1 from work_category where id = $1 for update", [ids.category]],
			mutate: () => asOwner(() => categories.deleteOrganizationCategory(ids.category)),
		},
		{
			name: "a deactivated category set",
			eligibleBefore: true,
			arrange: assignSetToEmployee,
			selection: withCategory,
			rowLock: () => [
				"select 1 from work_category_set where id = $1 for update",
				[ids.categorySet],
			],
			mutate: () => asOwner(() => categories.deleteWorkCategorySet(ids.categorySet)),
		},
		{
			name: "a removed effective set assignment",
			eligibleBefore: true,
			arrange: assignSetToEmployee,
			selection: withCategory,
			rowLock: () => [
				"select 1 from work_category_set_assignment where id = $1 for update",
				[ids.categorySetAssignment],
			],
			mutate: () => asOwner(() => categories.deleteSetAssignment(ids.categorySetAssignment)),
		},
		{
			name: "an inserted effective set assignment where none existed",
			eligibleBefore: false,
			arrange: async () => {},
			selection: withCategory,
			rowLock: () => [
				"select 1 from work_category_set where id = $1 for update",
				[ids.categorySet],
			],
			mutate: () =>
				asOwner(() =>
					categories.createSetAssignment({
						setId: ids.categorySet,
						organizationId: ids.organization,
						assignmentType: "employee",
						employeeId: ids.employee,
					}),
				),
		},
	];

	function expectOutcome(
		result: Awaited<ReturnType<typeof createManualTimeEntry>>,
		eligible: boolean,
		command: ManualTimeEntryCommand,
	) {
		if (eligible) {
			expect(result).toMatchObject({ success: true });
			return;
		}
		expect(result).toMatchObject({
			success: false,
			code: command.projectId ? "project_ineligible" : "category_ineligible",
		});
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
			throw new Error("Manual eligibility PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		harness.now = parseInstant("2026-09-10T10:00:00Z");
		await seed();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	describe.each(mutations)("$name", (mutation) => {
		it("waits for a submission already holding shared protection, which keeps prior eligibility", async () => {
			await mutation.arrange();
			const command = manualCommand(mutation.selection());
			// The submission takes shared configuration protection, then waits on the employee key.
			const employeeKey = await holdAdvisoryLock(ids.employee);
			let submission: ReturnType<typeof submit>;
			let write: ReturnType<Mutation["mutate"]>;
			try {
				submission = submit(command);
				await waitForLockWaiters(1);
				write = mutation.mutate();
				await waitForLockWaiters(2);
			} finally {
				await employeeKey.release();
			}

			expectOutcome(await submission, mutation.eligibleBefore, command);
			await expect(write).resolves.toMatchObject({ success: true });

			// Afterwards a fresh submission sees the committed change.
			const next = manualCommand({ ...mutation.selection(), date: "2026-09-02" });
			expectOutcome(await submit(next), !mutation.eligibleBefore, next);
		});

		it("holds a later submission until the mutation commits, which then decides eligibility", async () => {
			await mutation.arrange();
			const command = manualCommand(mutation.selection());
			// The writer is stopped at its first dependent write, inside its transaction.
			const row = await holdRowLock(mutation.rowLock());
			let submission: ReturnType<typeof submit>;
			let write: ReturnType<Mutation["mutate"]>;
			try {
				write = mutation.mutate();
				await waitForLockWaiters(1);
				submission = submit(command);
				await waitForLockWaiters(2);
				expect(await periods()).toEqual([]);
			} finally {
				await row.release();
			}

			await expect(write).resolves.toMatchObject({ success: true });
			expectOutcome(await submission, !mutation.eligibleBefore, command);
		});
	});

	describe("organization references", () => {
		it("rejects project assignments to another organization's team or employee", async () => {
			await expect(
				asOwner(() => projects.addProjectAssignment(ids.project, "team", ids.otherTeam)),
			).resolves.toMatchObject({ success: false });
			await expect(
				asOwner(() => projects.addProjectAssignment(ids.project, "employee", ids.otherEmployee)),
			).resolves.toMatchObject({ success: false });
			await expect(
				asOwner(() => projects.addProjectAssignment(ids.otherProject, "employee", ids.employee)),
			).resolves.toMatchObject({ success: false });
			const { rows } = await admin.query("select id from project_assignment");
			expect(rows).toEqual([]);
		});

		it("rejects set assignments that reference another organization or mismatch their level", async () => {
			const create = (input: Partial<Parameters<typeof categories.createSetAssignment>[0]>) =>
				asOwner(() =>
					categories.createSetAssignment({
						setId: ids.categorySet,
						organizationId: ids.organization,
						assignmentType: "employee",
						...input,
					}),
				);

			await expect(create({ employeeId: ids.otherEmployee })).resolves.toMatchObject({
				success: false,
			});
			await expect(
				create({ assignmentType: "team", teamId: ids.otherTeam }),
			).resolves.toMatchObject({ success: false });
			await expect(
				create({ setId: ids.otherCategorySet, employeeId: ids.employee }),
			).resolves.toMatchObject({ success: false });
			// A level without its target, or with a foreign one, is not an assignment.
			await expect(create({ employeeId: null })).resolves.toMatchObject({ success: false });
			await expect(
				create({ assignmentType: "organization", employeeId: ids.employee }),
			).resolves.toMatchObject({ success: false });
			await expect(
				create({ assignmentType: "team", teamId: ids.team, employeeId: ids.employee }),
			).resolves.toMatchObject({ success: false });
			const { rows } = await admin.query("select id from work_category_set_assignment");
			expect(rows).toEqual([]);

			await expect(create({ employeeId: ids.employee })).resolves.toMatchObject({
				success: true,
			});
		});

		it("rejects another organization's project and category in a manual command", async () => {
			await expect(submit(manualCommand({ projectId: ids.otherProject }))).resolves.toMatchObject({
				success: false,
				code: "project_ineligible",
			});
			await expect(
				submit(manualCommand({ workCategoryId: ids.otherCategory })),
			).resolves.toMatchObject({ success: false, code: "category_ineligible" });
			expect(await periods()).toEqual([]);
		});
	});

	describe("one eligibility meaning for form choices and preparation", () => {
		it("offers exactly the projects and categories a submission accepts", async () => {
			const project = (
				id: string,
				status: string,
				isActive = true,
				organizationId = ids.organization,
			) =>
				admin.query(
					`insert into project (id, organization_id, name, status, is_active, created_by, updated_at)
					 values ($1::uuid, $2, $1::text, $3, $4, $5, now())`,
					[id, organizationId, status, isActive, ids.ownerUser],
				);
			const assign = (projectId: string, column: "employee_id" | "team_id", target: string) =>
				admin.query(
					`insert into project_assignment (id, project_id, organization_id, assignment_type, ${column}, created_by)
					 values (gen_random_uuid(), $1, $2, $3, $4, $5)`,
					[
						projectId,
						ids.organization,
						column === "team_id" ? "team" : "employee",
						target,
						ids.ownerUser,
					],
				);
			const candidates = {
				direct: "e3150000-0000-4000-8000-000000000030",
				team: "e3150000-0000-4000-8000-000000000031",
				paused: "e3150000-0000-4000-8000-000000000032",
				completed: "e3150000-0000-4000-8000-000000000033",
				inactive: "e3150000-0000-4000-8000-000000000034",
				unassigned: "e3150000-0000-4000-8000-000000000035",
				foreign: "e3150000-0000-4000-8000-000000000036",
			};
			await project(candidates.direct, "active");
			await project(candidates.team, "planned");
			await project(candidates.paused, "paused");
			await project(candidates.completed, "completed");
			await project(candidates.inactive, "active", false);
			await project(candidates.unassigned, "active");
			await project(candidates.foreign, "active", true, ids.otherOrganization);
			await assign(candidates.direct, "employee_id", ids.employee);
			await assign(candidates.team, "team_id", ids.team);
			await assign(candidates.paused, "employee_id", ids.employee);
			await assign(candidates.completed, "employee_id", ids.employee);
			await assign(candidates.inactive, "employee_id", ids.employee);
			// An assignment row of this organization that points at a foreign project.
			await assign(candidates.foreign, "employee_id", ids.employee);
			await assignSetToEmployee();

			const context = await actAs(ids.employeeUser, () => getManualEntryTargetContext({}));
			expect(context.success).toBe(true);
			if (!context.success) return;
			const offered = new Set(context.data.projects.map((choice) => choice.id));
			expect([...offered].sort()).toEqual(
				[candidates.direct, candidates.team, candidates.paused].sort(),
			);
			expect(context.data.categories.map((choice) => choice.id)).toEqual([ids.category]);

			let day = 1;
			for (const projectId of Object.values(candidates)) {
				const command = manualCommand({
					projectId,
					date: `2026-09-0${day}`,
				});
				day += 1;
				expectOutcome(await submit(command), offered.has(projectId), command);
			}
			expectOutcome(
				await submit(manualCommand({ workCategoryId: ids.category, date: "2026-09-09" })),
				true,
				manualCommand({ workCategoryId: ids.category }),
			);
		});

		it("distinguishes an explicit null selection from a missing one", async () => {
			const { projectId: _projectId, ...missingProject } = manualCommand();
			await expect(submit(missingProject)).resolves.toMatchObject({
				success: false,
				code: "invalid_command",
				rejection: { reason: "invalid_command" },
			});
			const { workCategoryId: _categoryId, ...missingCategory } = manualCommand();
			await expect(submit(missingCategory)).resolves.toMatchObject({
				success: false,
				code: "invalid_command",
				rejection: { reason: "invalid_command" },
			});
			expect(await periods()).toEqual([]);

			await expect(submit(manualCommand())).resolves.toMatchObject({ success: true });
			expect(await periods()).toEqual([
				expect.objectContaining({ project_id: null, work_category_id: null }),
			]);
		});
	});

	describe("committed replay", () => {
		it("replays a committed version-2 command after its project and category were revoked", async () => {
			await assignProjectToEmployee();
			await assignSetToEmployee();
			const command = manualCommand({ projectId: ids.project, workCategoryId: ids.category });
			const committed = await submit(command);
			expect(committed).toMatchObject({ success: true });

			await expect(
				asOwner(() => projects.updateProject(ids.project, { status: "archived" })),
			).resolves.toMatchObject({ success: true });
			await expect(
				asOwner(() => categories.deleteSetAssignment(ids.categorySetAssignment)),
			).resolves.toMatchObject({ success: true });

			await expect(submit(structuredClone(command))).resolves.toEqual({
				...committed,
				data: { ...(committed as { data: object }).data, disposition: "replayed" },
			});
			expect(await periods()).toHaveLength(1);
		});

		it("replays a committed legacy submission after its project and category were revoked", async () => {
			await setAppend(null);
			await assignProjectToEmployee();
			await assignSetToEmployee();
			const legacy = {
				submissionId: randomUUID(),
				date: "2026-09-02",
				clockInTime: "09:00",
				clockOutTime: "10:00",
				reason: "Legacy form",
				timezone: "Europe/Berlin",
				browserTimezone: "Europe/Berlin",
				projectId: ids.project,
				workCategoryId: ids.category,
			};
			const committed = await submit(legacy);
			expect(committed).toMatchObject({ success: true });

			await expect(
				asOwner(() => projects.removeProjectAssignment(ids.projectAssignment)),
			).resolves.toMatchObject({ success: true });
			await expect(
				asOwner(() => categories.updateSetCategories(ids.categorySet, [])),
			).resolves.toMatchObject({ success: true });

			await expect(submit(legacy)).resolves.toEqual(committed);
			expect(await periods()).toEqual([
				expect.objectContaining({ project_id: ids.project, work_category_id: ids.category }),
			]);
		});
	});
});
