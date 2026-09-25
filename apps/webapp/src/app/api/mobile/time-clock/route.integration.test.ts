/**
 * Runtime evidence for committed clock-out recovery on the legacy mobile route.
 * Preservation for installed mobile apps after the mobile retirement (#283).
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real `POST /api/mobile/time-clock` handler runs against that database through
 * the real mobile access checks, the web clocking actions, coordinators and
 * completed-work operations. Only the session lookup, external billing provisioning,
 * notification delivery, the authoritative server clock and the Next cache are
 * replaced. The legacy actions also read wall-clock time, so the tests stay near it.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";

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
								id: "mobile-legacy-session",
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/billing/guard")>()),
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("@/lib/datetime/temporal-core", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...original,
		systemClock: Object.freeze({
			nowInstant: () => harness.now ?? original.systemClock.nowInstant(),
		}),
	};
});

vi.mock("@/app/[locale]/(app)/time-tracking/actions/approvals", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/app/[locale]/(app)/time-tracking/actions/approvals")
	>()),
	sendClockOutApprovalNotifications: async () => {},
	sendClockOutApprovedNotification: async () => {},
}));

const legacyMobileRoute = await import("./route");

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
	describe.skip(`legacy mobile clock PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "mobile-legacy-clock-org",
	requesterUser: "mobile-legacy-requester-user",
	requester: "f2830000-0000-4000-8000-000000000001",
} as const;
const server = "https://app.mobile-legacy.test";
const mobileHeaders = { authorization: "Bearer mobile-legacy-token", "x-z8-app-type": "mobile" };
const skewError = { error: "Clock action timestamp is outside the allowed skew" };

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

function evidence(at: Date) {
	return { timestamp: at.toISOString(), browserTimezone: "UTC", utcOffsetMinutes: 0 };
}

function serverAt(at: Date) {
	harness.now = parseInstant(at.toISOString());
}

async function submitLegacy(body: Record<string, unknown>) {
	const response = await legacyMobileRoute.POST(
		new Request(`${server}/api/mobile/time-clock`, {
			method: "POST",
			headers: { ...mobileHeaders, "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
	return { status: response.status, body: (await response.json()) as Record<string, any> };
}

describeIntegration("legacy mobile clock-out recovery on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 6 });

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	/** Every row a clock action can write, to prove "no writes" by equality. */
	async function snapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
			   (select json_agg(row_to_json(t) order by t.employee_id) from time_entry_append_position t where organization_id = $1) as positions,
			   (select json_agg(row_to_json(t) order by t.employee_id) from employee_work_balance t where organization_id = $1) as balances,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts`,
			[ids.organization],
		);
		return only(rows);
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = $1', [ids.requesterUser]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'Mobile legacy', $1, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, 'Requester', 'mobile-legacy-requester@example.test', $2, $2)`,
			[ids.requesterUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('mobile-legacy-member', $1, $2, 'member', 'approved', $3)`,
			[ids.organization, ids.requesterUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at)
			 values ($1, $2, $3, 'employee', $4)`,
			[ids.requester, ids.requesterUser, ids.organization, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at) values ($1, 'UTC', $2)`,
			[ids.requesterUser, timestamp],
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
			throw new Error("Legacy mobile clock PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		harness.userId = ids.requesterUser;
		harness.organizationId = ids.organization;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	/** Clocks in an hour ago and out now; returns the committed clock-out. */
	async function clockInAndOut() {
		const closedAt = new Date();
		const startedAt = new Date(closedAt.getTime() - 60 * 60_000);
		serverAt(startedAt);
		const clockIn = await submitLegacy({
			action: "clock_in",
			workLocationType: "office",
			...evidence(startedAt),
		});
		expect(clockIn.status).toBe(200);
		serverAt(closedAt);
		const clockOut = { action: "clock_out", submissionId: randomUUID(), ...evidence(closedAt) };
		const executed = await submitLegacy(clockOut);
		expect(executed).toMatchObject({ status: 200, body: { success: true } });
		return { clockIn, clockOut, executed, closedAt };
	}

	it.each(["active", "inactive"] as const)(
		"replays a committed clock-out beyond the five-minute skew (append control %s)",
		async (mode) => {
			await setAdmission(mode);
			const { clockOut, executed, closedAt } = await clockInAndOut();
			const before = await snapshot();

			// The app resends the same clock-out ten minutes, then nine days, later.
			for (const delay of [10 * 60_000, 9 * 24 * 60 * 60_000]) {
				serverAt(new Date(closedAt.getTime() + delay));
				const replayed = await submitLegacy(clockOut);
				expect(replayed).toMatchObject({ status: 200, body: { success: true } });
				expect(replayed.body.data.id).toBe(executed.body.data.id);
				expect(await snapshot()).toEqual(before);
			}

			// An uncommitted clock-out keeps the fresh five-minute skew.
			expect(
				await submitLegacy({
					action: "clock_out",
					submissionId: randomUUID(),
					...evidence(closedAt),
				}),
			).toEqual({ status: 400, body: skewError });
			expect(await snapshot()).toEqual(before);
		},
	);

	it("keeps the skew for a submission ID that names a committed clock-in", async () => {
		await setAdmission("active");
		const { clockIn, closedAt } = await clockInAndOut();
		serverAt(new Date(closedAt.getTime() + 10 * 60_000));
		const before = await snapshot();

		expect(
			await submitLegacy({
				action: "clock_out",
				submissionId: clockIn.body.data.id,
				...evidence(closedAt),
			}),
		).toEqual({ status: 400, body: skewError });
		expect(await snapshot()).toEqual(before);
	});
});
