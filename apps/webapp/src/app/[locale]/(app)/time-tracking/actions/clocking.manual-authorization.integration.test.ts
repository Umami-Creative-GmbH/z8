/**
 * #313 / T48 runtime evidence: organization authorization mutations participate
 * in the manual work transaction's configuration/access protocol.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real public `createManualTimeEntry` action races the real settings
 * actions and departure commands that change membership, employee role,
 * direct reports, target active/team state and custom permissions. Only the
 * request/session (including SSO session admission), billing provisioning,
 * notification delivery and Next cache boundaries are replaced. Each race pauses one side on a lock it takes after
 * its protection, then proves the other side waits on the exact protection key
 * rather than on an unrelated lock.
 */

import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
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
		getPrincipalContext: async () =>
			harness.userId && harness.organizationId
				? loadOrganizationPrincipalContext(db, {
						userId: harness.userId,
						organizationId: harness.organizationId,
					})
				: null,
	};
});

// The mocked session has no stored SSO provenance to admit.
vi.mock("@/lib/enterprise-identity/session-sso-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/enterprise-identity/session-sso-store")>()),
	canAccessOrganizationWithSso: async () => true,
}));

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

vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	const quiet = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
	return { ...original, createLogger: () => quiet };
});

const { createManualTimeEntry } = await import("../actions");
const { assignManagersAction, updateEmployeeAction } = await import(
	"../../settings/employees/employee-mutations.actions"
);
const { deactivateEmployeeAction } = await import(
	"../../settings/employees/employee-lifecycle.actions"
);
const { addTeamMember, deleteTeam } = await import("../../settings/teams/actions");
const { assignRoleToEmployee, deleteCustomRole, setRolePermissions } = await import(
	"../../settings/roles/actions"
);
const { grantTeamPermissions } = await import("../../settings/permissions/actions");
const { createProductionDepartureCommands } = await import("@/lib/employee-lifecycle/runtime");

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
	describe.skip(`manual authorization PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t313-auth-org",
	employeeUser: "t313-employee-user",
	managerUser: "t313-manager-user",
	secondManagerUser: "t313-second-manager-user",
	outsiderUser: "t313-outsider-manager-user",
	ownerUser: "t313-owner-user",
	peerUser: "t313-peer-user",
	employee: "e3130000-0000-4000-8000-000000000001",
	manager: "e3130000-0000-4000-8000-000000000002",
	secondManager: "e3130000-0000-4000-8000-000000000003",
	outsider: "e3130000-0000-4000-8000-000000000004",
	owner: "e3130000-0000-4000-8000-000000000005",
	peer: "e3130000-0000-4000-8000-000000000006",
	managerLink: "e3130000-0000-4000-8000-000000000010",
	secondManagerLink: "e3130000-0000-4000-8000-000000000011",
	team: "e3130000-0000-4000-8000-000000000020",
	emptyTeam: "e3130000-0000-4000-8000-000000000021",
	customRole: "e3130000-0000-4000-8000-000000000030",
} as const;
const users = [
	ids.employeeUser,
	ids.managerUser,
	ids.secondManagerUser,
	ids.outsiderUser,
	ids.ownerUser,
	ids.peerUser,
];

const organizationGuard = JSON.stringify(["work-organization-configuration", ids.organization]);
const userGuard = (userId: string) => JSON.stringify(["work-user-configuration-access", userId]);

const at = (time: string) => ({ time, occurrence: null, displayedOffsetMinutes: 120 });

/** An on-behalf Berlin summer entry for the employee. */
function manualCommand(overrides: Partial<ManualTimeEntryCommand> = {}): ManualTimeEntryCommand {
	return {
		version: 2,
		submissionId: randomUUID(),
		targetEmployeeId: ids.employee,
		date: "2026-09-01",
		clockIn: at("08:00"),
		clockOut: at("12:30"),
		zone: { basis: "target", timezone: "Europe/Berlin" },
		browserTimezone: null,
		reason: "Forgot to clock in",
		projectId: null,
		workCategoryId: null,
		...overrides,
	};
}

/** The key the manual transaction takes after its protection and employee coordination. */
const submissionIdentity = (command: ManualTimeEntryCommand) =>
	JSON.stringify([ids.organization, "manual_time_submission", "time_entry", command.submissionId]);

describeIntegration("organization authorization mutations on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 12 });

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	function submit(command: ManualTimeEntryCommand, as: string) {
		actAs(as);
		return createManualTimeEntry(command);
	}

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
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const { rows } = await admin.query<{ waiting: number }>(
				`select count(*)::int as waiting from pg_locks l, (select hashtextextended($1, 0) as k) h
				 where l.locktype = 'advisory' and not l.granted
				   and l.classid = ((h.k >> 32) & 4294967295)::oid
				   and l.objid = (h.k & 4294967295)::oid`,
				[key],
			);
			if ((rows[0]?.waiting ?? 0) >= count) return;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error(`No transaction waited on ${key}`);
	}

	/** Waits until some transaction waits on a row or transaction lock. */
	async function waitForRowWaiter() {
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const { rows } = await admin.query(
				"select 1 from pg_locks where locktype <> 'advisory' and not granted limit 1",
			);
			if (rows.length > 0) return;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error("No transaction waited on a row lock");
	}

	/**
	 * Starts a submission and pauses it on its identity key, after it holds its
	 * shared configuration/access protection and employee coordination.
	 */
	async function pausedSubmission(command: ManualTimeEntryCommand, as: string) {
		const identity = await holdAdvisoryLock(submissionIdentity(command));
		const pending = submit(command, as);
		await waitForWaiterOn(submissionIdentity(command));
		return { pending, release: () => identity.release() };
	}

	async function workFor(employeeId: string) {
		const { rows } = await admin.query(
			"select id from work_period where organization_id = $1 and employee_id = $2",
			[ids.organization, employeeId],
		);
		return rows;
	}

	async function managerLinks() {
		const { rows } = await admin.query<{ manager_id: string }>(
			"select manager_id from employee_managers where employee_id = $1 order by manager_id",
			[ids.employee],
		);
		return rows.map((row) => row.manager_id);
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at)
			 values ($1, 'T313 authorization', $1, 'Europe/Berlin', $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 'm-' || user_id, $1, user_id,
			        case when user_id = $3 then 'owner' else 'member' end, 'approved', $4
			 from unnest($2::text[]) as user_id`,
			[ids.organization, users, ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into team (id, organization_id, name, updated_at) values
			 ($1, $3, 'T313 team', $4), ($2, $3, 'T313 empty team', $4)`,
			[ids.team, ids.emptyTeam, ids.organization, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, team_id, updated_at) values
			 ($1, $2, $13, 'employee', $14, $15),
			 ($3, $4, $13, 'manager', $14, $15),
			 ($5, $6, $13, 'manager', null, $15),
			 ($7, $8, $13, 'manager', $14, $15),
			 ($9, $10, $13, 'employee', null, $15),
			 ($11, $12, $13, 'employee', null, $15)`,
			[
				ids.employee,
				ids.employeeUser,
				ids.manager,
				ids.managerUser,
				ids.secondManager,
				ids.secondManagerUser,
				ids.outsider,
				ids.outsiderUser,
				ids.owner,
				ids.ownerUser,
				ids.peer,
				ids.peerUser,
				ids.organization,
				ids.team,
				timestamp,
			],
		);
		await admin.query(
			`insert into team_membership (organization_id, team_id, employee_id)
			 values ($1, $2, $3), ($1, $2, $4), ($1, $2, $5)`,
			[ids.organization, ids.team, ids.employee, ids.manager, ids.outsider],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'Europe/Berlin', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by) values
			 ($1, $3, $4, true, $6), ($2, $3, $5, false, $6)`,
			[
				ids.managerLink,
				ids.secondManagerLink,
				ids.employee,
				ids.manager,
				ids.secondManager,
				ids.ownerUser,
			],
		);
		await admin.query(
			`insert into custom_role (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'T313 reporting', $3, $4)`,
			[ids.customRole, ids.organization, ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into custom_role_permission (custom_role_id, action, subject)
			 values ($1, 'read', 'Report')`,
			[ids.customRole],
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
			throw new Error("Manual authorization PostgreSQL is disabled");
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

	describe("direct reports", () => {
		it("holds a revocation until an in-flight on-behalf submission commits under the authority it validated", async () => {
			const command = manualCommand();
			const submission = await pausedSubmission(command, ids.managerUser);

			actAs(ids.ownerUser);
			const revocation = assignManagersAction(ids.employee, {
				managers: [{ managerId: ids.secondManager, isPrimary: true }],
			});
			// Sorted acquisition reaches the target's protection first.
			await waitForWaiterOn(userGuard(ids.employeeUser));
			expect(await managerLinks()).toEqual([ids.manager, ids.secondManager].sort());

			await submission.release();
			await expect(submission.pending).resolves.toMatchObject({ success: true });
			await expect(revocation).resolves.toMatchObject({ success: true });
			expect(await managerLinks()).toEqual([ids.secondManager]);
			expect(await workFor(ids.employee)).toHaveLength(1);
		});

		it("makes a submission wait for an in-flight revocation and then refuses it", async () => {
			const link = await hold("select id from employee_managers where id = $1 for update", [
				ids.managerLink,
			]);
			actAs(ids.ownerUser);
			const revocation = assignManagersAction(ids.employee, {
				managers: [{ managerId: ids.secondManager, isPrimary: true }],
			});
			await waitForRowWaiter();

			// The revocation holds both users' protection; the submission's sorted
			// acquisition waits at the target's.
			const pending = submit(manualCommand(), ids.managerUser);
			await waitForWaiterOn(userGuard(ids.employeeUser));
			await link.release();

			await expect(revocation).resolves.toMatchObject({ success: true });
			await expect(pending).resolves.toMatchObject({
				success: false,
				code: "target_not_authorized",
			});
			expect(await workFor(ids.employee)).toEqual([]);
		});

		it("holds an absent assignment's insertion until an in-flight submission for its target commits", async () => {
			await expect(submit(manualCommand(), ids.outsiderUser)).resolves.toMatchObject({
				success: false,
				code: "target_not_authorized",
			});

			const command = manualCommand({ date: "2026-09-02" });
			const submission = await pausedSubmission(command, ids.ownerUser);
			actAs(ids.ownerUser);
			const grant = assignManagersAction(ids.employee, {
				managers: [
					{ managerId: ids.manager, isPrimary: true },
					{ managerId: ids.secondManager, isPrimary: false },
					{ managerId: ids.outsider, isPrimary: false },
				],
			});
			// No row exists to lock yet: only the target's protection orders the insertion.
			await waitForWaiterOn(userGuard(ids.employeeUser));
			expect(await managerLinks()).not.toContain(ids.outsider);
			await submission.release();

			await expect(submission.pending).resolves.toMatchObject({ success: true });
			await expect(grant).resolves.toMatchObject({ success: true });
			await expect(
				submit(manualCommand({ date: "2026-09-03" }), ids.outsiderUser),
			).resolves.toMatchObject({ success: true });
		});

		it("never broadens a manager's scope to team members who are not direct reports", async () => {
			await expect(
				submit(manualCommand({ targetEmployeeId: ids.outsider }), ids.managerUser),
			).resolves.toMatchObject({ success: false, code: "target_not_authorized" });

			const command = manualCommand({ targetEmployeeId: ids.peer });
			const submission = await pausedSubmission(command, ids.ownerUser);
			actAs(ids.ownerUser);
			const joining = addTeamMember(ids.team, ids.peer);
			await waitForWaiterOn(userGuard(ids.peerUser));
			await submission.release();
			await expect(submission.pending).resolves.toMatchObject({ success: true });
			await expect(joining).resolves.toMatchObject({ success: true });

			// Sharing the manager's team grants nothing.
			await expect(
				submit(manualCommand({ targetEmployeeId: ids.peer, date: "2026-09-02" }), ids.managerUser),
			).resolves.toMatchObject({ success: false, code: "target_not_authorized" });
		});
	});

	describe("employee role and target state", () => {
		it("refuses a submission that waited for its actor's role demotion", async () => {
			const manager = await hold("select id from employee where id = $1 for update", [ids.manager]);
			actAs(ids.ownerUser);
			const demotion = updateEmployeeAction(ids.manager, { role: "employee" });
			await waitForRowWaiter();

			const pending = submit(manualCommand(), ids.managerUser);
			await waitForWaiterOn(userGuard(ids.managerUser));
			await manager.release();

			await expect(demotion).resolves.toMatchObject({ success: true });
			await expect(pending).resolves.toMatchObject({
				success: false,
				code: "target_not_authorized",
			});
		});

		it("keeps an owner's creation authority whatever their employee role, and holds the role change", async () => {
			const command = manualCommand();
			const submission = await pausedSubmission(command, ids.ownerUser);
			actAs(ids.ownerUser);
			const promotion = updateEmployeeAction(ids.owner, { role: "manager" });
			await waitForWaiterOn(userGuard(ids.ownerUser));
			await submission.release();

			await expect(submission.pending).resolves.toMatchObject({ success: true });
			await expect(promotion).resolves.toMatchObject({ success: true });
			await expect(
				submit(manualCommand({ date: "2026-09-02" }), ids.ownerUser),
			).resolves.toMatchObject({ success: true });
			// An ordinary colleague still may not create for the employee.
			await expect(
				submit(manualCommand({ date: "2026-09-03" }), ids.peerUser),
			).resolves.toMatchObject({ success: false, code: "target_not_authorized" });
		});

		it("holds the target's deactivation until an in-flight submission commits", async () => {
			const command = manualCommand();
			const submission = await pausedSubmission(command, ids.managerUser);
			actAs(ids.ownerUser);
			const deactivation = deactivateEmployeeAction(ids.employee);
			await waitForWaiterOn(userGuard(ids.employeeUser));
			await submission.release();

			await expect(submission.pending).resolves.toMatchObject({ success: true });
			await expect(deactivation).resolves.toMatchObject({ success: true });
			await expect(
				submit(manualCommand({ date: "2026-09-02" }), ids.managerUser),
			).resolves.toMatchObject({ success: false });
			expect(await workFor(ids.employee)).toHaveLength(1);
		});

		it("takes the target's protection before the employee lock when scheduling a departure", async () => {
			const command = manualCommand();
			const submission = await pausedSubmission(command, ids.managerUser);
			const departure = createProductionDepartureCommands().scheduleDeparture(
				{ userId: ids.ownerUser, organizationId: ids.organization },
				{
					employeeId: ids.employee,
					requestId: randomUUID(),
					expectedRevision: null,
					lastWorkingDay: "2026-12-31",
					replacementEmployeeId: null,
					acknowledgeUnassignedDuties: true,
				},
			);
			await waitForWaiterOn(userGuard(ids.employeeUser));
			await submission.release();

			await expect(submission.pending).resolves.toMatchObject({ success: true });
			await expect(departure).resolves.toBeDefined();
		});
	});

	describe("custom and team permissions", () => {
		it("holds custom-role definition changes organization-wide while a submission is in flight", async () => {
			const command = manualCommand();
			const submission = await pausedSubmission(command, ids.managerUser);
			actAs(ids.ownerUser);
			const replacement = setRolePermissions(ids.customRole, [
				{ action: "read", subject: "Report" },
				{ action: "generate", subject: "Report" },
			]);
			await waitForWaiterOn(organizationGuard);
			await submission.release();
			await expect(submission.pending).resolves.toMatchObject({ success: true });
			await expect(replacement).resolves.toMatchObject({ success: true });

			const second = await pausedSubmission(manualCommand({ date: "2026-09-02" }), ids.managerUser);
			actAs(ids.ownerUser);
			const deletion = deleteCustomRole(ids.customRole);
			await waitForWaiterOn(organizationGuard);
			await second.release();
			await expect(second.pending).resolves.toMatchObject({ success: true });
			await expect(deletion).resolves.toMatchObject({ success: true });
		});

		it("holds a custom-role assignment and a team-permission grant on the holder's protection", async () => {
			const command = manualCommand();
			const submission = await pausedSubmission(command, ids.managerUser);
			actAs(ids.ownerUser);
			const assignment = assignRoleToEmployee(ids.manager, ids.customRole);
			await waitForWaiterOn(userGuard(ids.managerUser));
			actAs(ids.ownerUser);
			const grant = grantTeamPermissions({
				employeeId: ids.manager,
				teamId: null,
				permissions: { canCreateTeams: true, canApproveTeamRequests: true },
			});
			await waitForWaiterOn(userGuard(ids.managerUser), 2);
			await submission.release();

			await expect(submission.pending).resolves.toMatchObject({ success: true });
			await expect(assignment).resolves.toMatchObject({ success: true });
			await expect(grant).resolves.toMatchObject({ success: true });
		});

		it("holds a team deletion organization-wide while a submission is in flight", async () => {
			const command = manualCommand();
			const submission = await pausedSubmission(command, ids.managerUser);
			actAs(ids.ownerUser);
			const deletion = deleteTeam(ids.emptyTeam);
			await waitForWaiterOn(organizationGuard);
			await submission.release();

			await expect(submission.pending).resolves.toMatchObject({ success: true });
			await expect(deletion).resolves.toMatchObject({ success: true });
		});
	});
});
