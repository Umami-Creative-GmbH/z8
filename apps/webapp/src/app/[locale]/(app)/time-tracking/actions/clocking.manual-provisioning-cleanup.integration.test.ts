/**
 * #318 / T53 runtime evidence: the remaining provisioning, import, demo and
 * cleanup writers of manual dependencies participate in the configuration
 * protocol.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real public `createManualTimeEntry` action races the real mutation owners:
 * the reviewed-import setup committer, the demo generators and cleanups, the
 * organization cleanup job and the membership provisioning owners. A fresh
 * submission is parked on the employee key (rank 5) while it holds the shared
 * organization configuration (rank 3) and user configuration/access (rank 4)
 * guards; a participating writer must then wait on the exclusive counterpart.
 * Only the request/session, billing provisioning, notification delivery and
 * Next cache boundaries are replaced; each caller keeps its own identity
 * through async context. Writers are paused with real PostgreSQL locks.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
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
			updateUser: async () => ({ status: true }),
			getSession: async () => {
				const identity = currentIdentity();
				return identity
					? {
							user: { id: identity.userId, role: "user" },
							session: {
								id: `t318-session-${identity.userId}`,
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

vi.mock("@/lib/billing/seat-sync-trigger", () => ({
	reconcileBillingSeatsForOrganization: async () => undefined,
	syncBillingSeatsAfterMemberChange: async () => undefined,
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
const { commitAcceptedRowsForEntity } = await import("@/lib/import-review/committers");
const demo = await import("@/lib/demo/demo-data.service");
const { deleteNonAdminEmployeesData } = await import("@/lib/demo/delete-non-admin");
const { generateDemoEmployees } = await import("@/lib/demo/employee-generator");
const { runOrganizationCleanup } = await import("@/lib/jobs/organization-cleanup");
const { db } = await import("@/db");
const { Effect, Layer } = await import("effect");
const { ensureEmployeeForOrganizationMember } = await import(
	"@/lib/auth/organization-member-provisioning"
);
const { DatabaseServiceLive } = await import("@/lib/effect/services/database.service");
const { AuthServiceLive } = await import("@/lib/effect/services/auth.service");
const { InviteCodeService, InviteCodeServiceLive } = await import(
	"@/lib/effect/services/invite-code.service"
);
const { PendingMemberService, PendingMemberServiceLive } = await import(
	"@/lib/effect/services/pending-member.service"
);
const { OnboardingService, OnboardingServiceLive } = await import(
	"@/lib/effect/services/onboarding.service"
);
const services = Layer.mergeAll(
	InviteCodeServiceLive,
	PendingMemberServiceLive,
	OnboardingServiceLive,
).pipe(Layer.provide(Layer.merge(DatabaseServiceLive, AuthServiceLive)));

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
	describe.skip(`provisioning/cleanup coordination PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t318-config-org",
	otherOrganization: "t318-other-org",
	employeeUser: "t318-employee-user",
	managerUser: "t318-manager-user",
	ownerUser: "t318-owner-user",
	otherOwnerUser: "t318-other-owner-user",
	employee: "e3180000-0000-4000-8000-000000000001",
	manager: "e3180000-0000-4000-8000-000000000002",
	owner: "e3180000-0000-4000-8000-000000000003",
	otherOwner: "e3180000-0000-4000-8000-000000000004",
	otherEmployee: "e3180000-0000-4000-8000-000000000005",
	managerLink: "e3180000-0000-4000-8000-000000000010",
	blockingCategory: "e3180000-0000-4000-8000-000000000040",
} as const;
const users = [ids.employeeUser, ids.managerUser, ids.ownerUser, ids.otherOwnerUser];
const organizationGuard = JSON.stringify(["work-organization-configuration", ids.organization]);
const userGuard = (userId: string) => JSON.stringify(["work-user-configuration-access", userId]);

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

function submit(command: ManualTimeEntryCommand) {
	return as(ids.employeeUser, () => createManualTimeEntry(command));
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

describeIntegration("provisioning, import, demo and cleanup writers on PostgreSQL", () => {
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
	 * it already holds the shared organization configuration guard (rank 3) and
	 * the shared guards of its actor and target (rank 4).
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
	 * The writer must wait on `guard` while a fresh submission holds it shared,
	 * so the submission commits on the prior configuration. A writer that skips
	 * the guard commits early and times out here.
	 */
	async function writeBehindParkedSubmission<T>(
		guard: string,
		write: () => Promise<T>,
		whileWaiting?: () => Promise<void>,
	) {
		const parked = await parkedSubmission();
		let released = false;
		try {
			const writer = track(write());
			await waitFor(() => advisoryWaiter(guard), "the writer on the configuration guard");
			expect(writer.settled).toBe(false);
			await whileWaiting?.();
			await parked.release();
			released = true;
			const submitted = await parked.pending;
			return { submitted, written: await writer.promise };
		} finally {
			if (!released) await parked.release();
		}
	}

	async function rowLockWaiter() {
		const { rows } = await admin.query(
			"select 1 from pg_locks where locktype in ('transactionid', 'tuple') and not granted",
		);
		return rows.length > 0;
	}

	/**
	 * Parks a writer on a row lock after it took its exclusive guards; a fresh
	 * submission must then wait on the organization configuration guard for the
	 * writer's commit and read its change.
	 */
	async function submitBehindParkedWriter<T>(
		rowLock: { statement: string; values: unknown[] },
		write: () => Promise<T>,
		submission: () => Promise<unknown> = () => submit(manualCommand()),
	) {
		const row = await holdInTransaction(rowLock.statement, rowLock.values);
		let released = false;
		try {
			const writer = track(write());
			await waitFor(rowLockWaiter, "the writer on the held row");
			const pending = track(submission());
			await waitFor(
				() => advisoryWaiter(organizationGuard),
				"the submission on the organization configuration guard",
			);
			expect(pending.settled).toBe(false);
			expect(writer.settled).toBe(false);
			await row.release();
			released = true;
			const written = await writer.promise;
			return { written, submitted: await pending.promise };
		} finally {
			if (!released) await row.release();
		}
	}

	async function cleanup() {
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
		// Generated demo users that no longer belong to any organization.
		await admin.query(
			`delete from "user" u where u.email like 'demo-%@demo.invalid'
			 and not exists (select 1 from member m where m.user_id = u.id)`,
		);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T318 config', $1, 'Europe/Berlin', $3), ($2, 'T318 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t318-m-employee', $1, $3, 'member', 'approved', $7),
			 ('t318-m-manager', $1, $4, 'member', 'approved', $7),
			 ('t318-m-owner', $1, $5, 'owner', 'approved', $7),
			 ('t318-m-other-owner', $2, $6, 'owner', 'approved', $7),
			 ('t318-m-other-employee', $2, $3, 'member', 'approved', $7)`,
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
			 ($5, $6, $9, 'admin', $11), ($7, $8, $10, 'admin', $11), ($12, $2, $10, 'employee', $11)`,
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
				ids.otherEmployee,
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

	async function seedBlockingCategory() {
		await admin.query(
			`insert into holiday_category (id, organization_id, type, name, blocks_time_entry, updated_at)
			 values ($1, $2, 'company_holiday', 'Closed', true, now())`,
			[ids.blockingCategory, ids.organization],
		);
	}

	/** One accepted reviewed-import setup row in a committing batch. */
	async function stageSetupRow(entityType: string, normalizedPayload: Record<string, unknown>) {
		const batchId = randomUUID();
		const jobId = randomUUID();
		await admin.query(
			`insert into import_batch
			 (id, organization_id, provider, status, selected_scope, date_range, started_by, committed_by, created_at, updated_at)
			 values ($1, $2, 'clockodo', 'committing', '{}', '{"startDate":"2021-01-01","endDate":"2026-12-31"}', $3, $3, now(), now())`,
			[batchId, ids.organization, ids.ownerUser],
		);
		await admin.query(
			`insert into import_batch_job
			 (id, batch_id, organization_id, kind, status, entity_type, partition_key, created_at, updated_at)
			 values ($1, $2, $3, 'commit', 'queued', $4, $4, now(), now())`,
			[jobId, batchId, ids.organization, entityType],
		);
		const sourcePayload = { id: randomUUID() };
		await admin.query(
			`insert into import_staged_row
			 (id, batch_id, organization_id, entity_type, provider_source_id, source_payload_hash,
			  source_payload, normalized_payload, row_status, issue_severity, created_at, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, 'accepted', 'none', now(), now())`,
			[
				randomUUID(),
				batchId,
				ids.organization,
				entityType,
				sourcePayload.id,
				createHash("sha256").update(JSON.stringify(sourcePayload)).digest("hex"),
				sourcePayload,
				normalizedPayload,
			],
		);
		return {
			type: "import-review-commit" as const,
			batchId,
			jobId,
			organizationId: ids.organization,
			entityType: entityType as "holiday",
			committedBy: ids.ownerUser,
		};
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
			throw new Error("Provisioning/cleanup coordination PostgreSQL is disabled");
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

	describe("reviewed-import setup commits", () => {
		it("commits a blocking holiday only after a fresh submission on the prior calendar", async () => {
			await seedBlockingCategory();
			const job = await stageSetupRow("holiday", {
				name: "Imported closing day",
				categoryId: ids.blockingCategory,
				date: "2026-09-01T00:00:00Z",
			});

			const { submitted, written } = await writeBehindParkedSubmission(organizationGuard, () =>
				commitAcceptedRowsForEntity(job),
			);

			expect(submitted).toMatchObject({ success: true });
			expect(written).toMatchObject({ committedRows: 1, failedRows: 0 });
			expect(await submit(freshCommand())).toMatchObject({
				success: false,
				code: "holiday_blocked",
				holidayName: "Imported closing day",
			});
		});

		it("commits a work category only after a fresh submission", async () => {
			const job = await stageSetupRow("work_category", { name: "Imported category" });

			const { submitted, written } = await writeBehindParkedSubmission(organizationGuard, () =>
				commitAcceptedRowsForEntity({ ...job, entityType: "work_category" }),
			);

			expect(submitted).toMatchObject({ success: true });
			expect(written).toMatchObject({ committedRows: 1, failedRows: 0 });
		});
	});

	describe("membership provisioning", () => {
		// The employee user joins the other organization afresh: a user-global
		// change of the target's employees, ordered by the target's user guard.
		async function otherEmployeeIds() {
			const { rows } = await admin.query(
				"select id from employee where user_id = $1 and organization_id = $2",
				[ids.employeeUser, ids.otherOrganization],
			);
			return rows.map((row) => row.id as string);
		}
		const noOtherEmployeeYet = async () => {
			expect(await otherEmployeeIds()).toEqual([]);
		};

		async function leaveOtherOrganization(options: { membership: boolean }) {
			await admin.query("delete from employee where id = $1", [ids.otherEmployee]);
			if (options.membership) {
				await admin.query("delete from member where id = 't318-m-other-employee'");
			}
		}

		it("ensureEmployeeForOrganizationMember waits on the member's user guard", async () => {
			await leaveOtherOrganization({ membership: false });

			const { submitted } = await writeBehindParkedSubmission(
				userGuard(ids.employeeUser),
				() =>
					ensureEmployeeForOrganizationMember(db, {
						mode: "membershipAccepted",
						userId: ids.employeeUser,
						organizationId: ids.otherOrganization,
						memberRole: "member",
					}),
				noOtherEmployeeYet,
			);

			expect(submitted).toMatchObject({ success: true });
			expect(await otherEmployeeIds()).toHaveLength(1);
		});

		it("invite-code redemption waits on the member's user guard before its row lock", async () => {
			await leaveOtherOrganization({ membership: true });
			await admin.query(
				`insert into invite_code (organization_id, code, label, requires_approval, created_by)
				 values ($1, 'T318-JOIN', 'Join', false, $2)`,
				[ids.otherOrganization, ids.otherOwnerUser],
			);

			const { submitted, written } = await writeBehindParkedSubmission(
				userGuard(ids.employeeUser),
				() =>
					Effect.runPromise(
						InviteCodeService.pipe(
							Effect.flatMap((service) =>
								service.useCode({ code: "T318-JOIN", userId: ids.employeeUser }),
							),
							Effect.provide(services),
						),
					),
				async () => {
					await noOtherEmployeeYet();
					// The guard precedes the invite-code row lock.
					const { rows } = await admin.query(
						"select 1 from invite_code where code = 'T318-JOIN' for update nowait",
					);
					expect(rows).toHaveLength(1);
				},
			);

			expect(submitted).toMatchObject({ success: true });
			expect(written).toMatchObject({ success: true, status: "approved" });
			expect(await otherEmployeeIds()).toHaveLength(1);
		});

		it("pending-member rejection waits on the member's user guard", async () => {
			await leaveOtherOrganization({ membership: true });
			const { rows: codes } = await admin.query(
				`insert into invite_code (organization_id, code, label, requires_approval, created_by)
				 values ($1, 'T318-ASK', 'Ask', true, $2) returning id`,
				[ids.otherOrganization, ids.otherOwnerUser],
			);
			await admin.query(
				`insert into member (id, organization_id, user_id, role, status, invite_code_id, created_at)
				 values ('t318-m-pending', $1, $2, 'member', 'pending', $3, now())`,
				[ids.otherOrganization, ids.employeeUser, only(codes).id],
			);

			const { submitted } = await writeBehindParkedSubmission(
				userGuard(ids.employeeUser),
				() =>
					Effect.runPromise(
						PendingMemberService.pipe(
							Effect.flatMap((service) =>
								service.reject({
									memberId: "t318-m-pending",
									organizationId: ids.otherOrganization,
									rejectedBy: ids.otherOwnerUser,
								}),
							),
							Effect.provide(services),
						),
					),
				async () => {
					// The guard precedes the member row lock.
					const { rows } = await admin.query(
						"select status from member where id = 't318-m-pending' for update nowait",
					);
					expect(rows).toEqual([{ status: "pending" }]);
				},
			);

			expect(submitted).toMatchObject({ success: true });
			const { rows } = await admin.query("select 1 from member where id = 't318-m-pending'");
			expect(rows).toEqual([]);
		});

		it("onboarding employee creation waits on the member's user guard", async () => {
			await leaveOtherOrganization({ membership: false });

			const { submitted } = await writeBehindParkedSubmission(
				userGuard(ids.employeeUser),
				() =>
					as(
						ids.employeeUser,
						() =>
							Effect.runPromise(
								OnboardingService.pipe(
									Effect.flatMap((service) =>
										service.updateProfile({
											firstName: "Erin",
											lastName: "Employee",
											weekStartDay: "monday",
											timeFormat: "24h",
											helpImproveProduct: false,
										}),
									),
									Effect.provide(services),
								),
							),
						ids.otherOrganization,
					),
				noOtherEmployeeYet,
			);

			expect(submitted).toMatchObject({ success: true });
			expect(await otherEmployeeIds()).toHaveLength(1);
		});
	});

	describe("organization cleanup job", () => {
		it("deletes a soft-deleted organization only after a fresh submission, and nothing else", async () => {
			await admin.query(
				"update organization set deleted_at = now() - interval '6 days' where id = $1",
				[ids.organization],
			);

			const { submitted, written } = await writeBehindParkedSubmission(organizationGuard, () =>
				runOrganizationCleanup(),
			);

			expect(submitted).toMatchObject({ success: true });
			expect(written).toMatchObject({ success: true, organizationsDeleted: 1 });
			const { rows: organizations } = await admin.query(
				"select id from organization where id = any($1::text[])",
				[[ids.organization, ids.otherOrganization]],
			);
			expect(organizations.map((row) => row.id)).toEqual([ids.otherOrganization]);
			const { rows: employees } = await admin.query(
				"select id from employee where user_id = $1",
				[ids.employeeUser],
			);
			expect(employees.map((row) => row.id)).toEqual([ids.otherEmployee]);
		});
	});

	describe("runtime demo configuration", () => {
		const demoOptions = (overrides: Partial<Parameters<typeof demo.generateDemoData>[0]> = {}) => ({
			organizationId: ids.organization,
			dateRange: { start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-08-31T00:00:00Z") },
			includeTimeEntries: false,
			includeAbsences: false,
			includeTeams: false,
			includeProjects: false,
			createdBy: ids.ownerUser,
			...overrides,
		});

		const demoWriters: Array<{ name: string; write: () => Promise<unknown> }> = [
			{
				name: "generateDemoTeams",
				write: () => demo.generateDemoTeams(demoOptions({ includeTeams: true, teamCount: 1 })),
			},
			{
				name: "generateDemoProjects",
				write: () => demo.generateDemoProjects(demoOptions({ includeProjects: true, projectCount: 1 })),
			},
			{
				name: "generateDemoWorkCategories",
				write: () => demo.generateDemoWorkCategories(demoOptions({ includeWorkCategories: true })),
			},
			{
				name: "generateDemoChangePolicies",
				write: () => demo.generateDemoChangePolicies(demoOptions({ includeChangePolicies: true })),
			},
			{
				name: "generateDemoManagerAssignments",
				write: () => demo.generateDemoManagerAssignments(demoOptions()),
			},
		];

		it.each(demoWriters)("$name waits for a fresh submission", async ({ write }) => {
			const { submitted } = await writeBehindParkedSubmission(organizationGuard, write);
			expect(submitted).toMatchObject({ success: true });
		});

		it("generateDemoEmployees waits for a fresh submission", async () => {
			const { submitted, written } = await writeBehindParkedSubmission(organizationGuard, () =>
				generateDemoEmployees({ organizationId: ids.organization, count: 1, includeManagers: true }),
			);
			expect(submitted).toMatchObject({ success: true });
			expect(written).toMatchObject({ usersCreated: 1, employeesCreated: 1, managersCreated: 1 });
		});

		it("clearOrganizationTimeData removes demo configuration before a fresh submission reads it", async () => {
			const demoTeam = randomUUID();
			await admin.query(
				"insert into team (id, organization_id, name, description, updated_at) values ($1, $2, 'Sales', 'Demo team - Sales', now())",
				[demoTeam, ids.organization],
			);
			await admin.query("update employee set team_id = $1 where id = $2", [demoTeam, ids.employee]);

			const { written, submitted } = await submitBehindParkedWriter(
				{ statement: "select 1 from team where id = $1 for update", values: [demoTeam] },
				() => demo.clearOrganizationTimeData(ids.organization, ids.ownerUser),
			);

			expect(written).toMatchObject({ teamsDeleted: 1, employeesUnassignedFromTeams: 1 });
			expect(submitted).toMatchObject({ success: true });
		});

		it("deleteNonAdminEmployeesData removes users before a fresh submission reads them", async () => {
			const { written, submitted } = await submitBehindParkedWriter(
				{ statement: "select 1 from member where id = 't318-m-employee' for update", values: [] },
				() => deleteNonAdminEmployeesData(ids.organization, ids.ownerUser),
				() =>
					as(ids.ownerUser, () =>
						createManualTimeEntry(manualCommand({ targetEmployeeId: ids.owner })),
					),
			);

			expect(written).toMatchObject({ employeesDeleted: 2, membersDeleted: 2 });
			expect(submitted).toMatchObject({ success: true });
			const { rows } = await admin.query("select id from employee where organization_id = $1", [
				ids.otherOrganization,
			]);
			expect(rows.map((row) => row.id).sort()).toEqual([ids.otherOwner, ids.otherEmployee].sort());
		});

		it("never moves another organization's employee into a demo team", async () => {
			await demo.generateDemoTeams(
				demoOptions({ includeTeams: true, teamCount: 1, employeeIds: [ids.employee, ids.otherEmployee] }),
			);

			const { rows } = await admin.query("select id, team_id from employee where id = any($1::uuid[])", [
				[ids.employee, ids.otherEmployee],
			]);
			expect(rows.find((row) => row.id === ids.otherEmployee)?.team_id).toBeNull();
			expect(rows.find((row) => row.id === ids.employee)?.team_id).not.toBeNull();
		});
	});
});
