/**
 * #273 / T09 runtime evidence for evidence-based live clock-in append admission.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real `clockIn` server action runs against that database; the shared
 * clocking service's legacy closer stands in for a competing legacy writer.
 * Only the request/session, external billing provisioning, notification
 * delivery, and Next cache boundaries are replaced. Append adoption is enabled per test organization by inserting its
 * control row directly: production has no activation setter.
 */

import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { calculateHash } from "@/lib/time-tracking/blockchain";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	warnings: [] as { context: unknown; message: unknown }[],
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

vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("./approvals", async (importOriginal) => ({
	...(await importOriginal<typeof import("./approvals")>()),
	sendClockOutApprovalNotifications: async () => {},
	sendClockOutApprovedNotification: async () => {},
}));

vi.mock("./shared", async (importOriginal) => {
	const original = await importOriginal<typeof import("./shared")>();
	const record = (context: unknown, message?: unknown) => {
		harness.warnings.push({ context, message });
	};
	return {
		...original,
		logger: {
			...original.logger,
			error: record,
			warn: record,
			info: () => {},
			debug: () => {},
		},
	};
});

const { clockIn } = await import("./clocking");
const { ClockingAppendAdoptedError, clockingService } = await import(
	"@/lib/time-tracking/clocking-service"
);
const { withWebClockInTransaction } = await import("@/lib/time-tracking/web-clock-in-transaction");
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
	describe.skip(`web clock-in PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const clockInAt = parseInstant("2026-07-22T08:00:00Z");
const clockOutAt = parseInstant("2026-07-22T16:00:00Z");
const ids = {
	organization: "t273-web-clock-in-org",
	otherOrganization: "t273-web-clock-in-other-org",
	requesterUser: "t273-requester-user",
	peerUser: "t273-peer-user",
	requester: "d7000000-0000-4000-8000-000000000001",
	peer: "d7000000-0000-4000-8000-000000000002",
} as const;
const reviewResult = {
	success: false,
	code: "append_review_required",
	error:
		"Your time history needs review before you can clock in. Please contact your administrator.",
};

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

type SeedEntry = {
	id: string;
	type: "clock_in" | "clock_out";
	timestamp: string;
	createdAt: string;
	previousHash: string | null;
	previousEntryId: string | null;
	hash: string;
	isSuperseded?: boolean;
	organizationId?: string;
};

let entrySequence = 0;
/** A standard-hash entry following `previous` by explicit ID+hash, or hash only. */
function seedEntry(
	previous: SeedEntry | null,
	type: SeedEntry["type"],
	timestamp: string,
	createdAt: string,
	options: { link?: "explicit" | "hash-only"; isSuperseded?: boolean } = {},
): SeedEntry {
	entrySequence += 1;
	const previousHash = previous?.hash ?? null;
	return {
		id: `d8000000-0000-4000-8000-${entrySequence.toString().padStart(12, "0")}`,
		type,
		timestamp,
		createdAt,
		previousHash,
		previousEntryId: previous && options.link !== "hash-only" ? previous.id : null,
		hash: calculateHash({
			employeeId: ids.requester,
			type,
			timestamp: new Date(timestamp).toISOString(),
			previousHash,
		}),
		isSuperseded: options.isSuperseded,
	};
}

describeIntegration("web clock-in append admission on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 12 });
	const openHolders = new Set<Holder>();

	type Holder = {
		pid: number;
		query: (text: string, params?: unknown[]) => Promise<unknown>;
		commit: () => Promise<void>;
	};

	async function openHolder(): Promise<Holder> {
		const client: PoolClient = await admin.connect();
		await client.query("begin");
		await client.query("set local lock_timeout = '20s'");
		const { rows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
		let open = true;
		const holder: Holder = {
			pid: only(rows).pid,
			query: (text, params) => client.query(text, params),
			commit: async () => {
				if (!open) return;
				open = false;
				openHolders.delete(holder);
				try {
					await client.query("commit");
				} finally {
					client.release();
				}
			},
		};
		openHolders.add(holder);
		return holder;
	}

	async function holdAdvisory(key: string) {
		const holder = await openHolder();
		await holder.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
		return holder;
	}

	async function waitFor<T>(label: string, probe: () => Promise<T | undefined>): Promise<T> {
		const deadline = Date.now() + 15_000;
		while (Date.now() < deadline) {
			const value = await probe();
			if (value !== undefined) return value;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		throw new Error(`Timed out waiting for ${label}`);
	}

	async function lockWaiters(holderPid: number) {
		const { rows } = await admin.query<{ pid: number }>(
			`select pid from pg_stat_activity
			 where datname = current_database() and wait_event_type = 'Lock'
			   and $1 = any(pg_blocking_pids(pid))
			 order by pid`,
			[holderPid],
		);
		return rows.map((row) => row.pid);
	}

	function waitForWaiters(holderPid: number, count = 1) {
		return waitFor(`${count} backend(s) blocked by ${holderPid}`, async () => {
			const pids = await lockWaiters(holderPid);
			return pids.length >= count ? pids : undefined;
		});
	}

	async function advisoryHeld(pid: number, key: string) {
		const { rows } = await admin.query<{ mode: string; granted: boolean }>(
			`select mode, granted from pg_locks
			 where pid = $1 and locktype = 'advisory' and objsubid = 1
			   and ((classid::bigint << 32) | objid::bigint) = hashtextextended($2, 0)`,
			[pid, key],
		);
		return rows.map((row) => `${row.mode}:${row.granted ? "held" : "waiting"}`);
	}

	const keys = {
		adoption: JSON.stringify(["completed-work-adoption", ids.organization]),
		organization: JSON.stringify(["work-organization-configuration", ids.organization]),
		requesterAccess: JSON.stringify(["work-user-configuration-access", ids.requesterUser]),
		employee: ids.requester,
	};

	function clockInAs(userId: string = ids.requesterUser) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
		return clockIn("office", { instant: clockInAt, browserTimezone: "UTC" });
	}

	async function activateAppendAdmission(organizationId: string = ids.organization) {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, 'active')
			 on conflict (organization_id) do update set mode = 'active'`,
			[organizationId],
		);
	}

	async function insertEntries(entries: readonly SeedEntry[], employeeId: string = ids.requester) {
		for (const entry of entries) {
			await admin.query(
				`insert into time_entry
				 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone,
				  timezone_source, previous_entry_id, hash, previous_hash, is_superseded,
				  created_at, created_by)
				 values ($1, $2, $3, $4, $5, 0, 'UTC', 'user_setting', $6, $7, $8, $9, $10, $11)`,
				[
					entry.id,
					employeeId,
					entry.organizationId ?? ids.organization,
					entry.type,
					new Date(entry.timestamp),
					entry.previousEntryId,
					entry.hash,
					entry.previousHash,
					entry.isSuperseded ?? false,
					new Date(entry.createdAt),
					ids.requesterUser,
				],
			);
		}
	}

	async function entries(employeeId: string = ids.requester) {
		const { rows } = await admin.query<{
			id: string;
			type: string;
			hash: string;
			previous_hash: string | null;
			previous_entry_id: string | null;
		}>(
			`select id, type, hash, previous_hash, previous_entry_id from time_entry
			 where employee_id = $1 order by created_at, id`,
			[employeeId],
		);
		return rows;
	}

	async function position(employeeId: string = ids.requester) {
		const { rows } = await admin.query<{
			tip_entry_id: string;
			tip_hash: string;
			version: number;
			entry_count: number;
			admission: string;
			admitted_tip_entry_id: string | null;
			admitted_tip_hash: string | null;
			admitted_entry_count: number;
			admitted_operation: string;
			last_operation: string;
		}>(
			`select tip_entry_id, tip_hash, version, entry_count, admission, admitted_tip_entry_id,
			        admitted_tip_hash, admitted_entry_count, admitted_operation, last_operation
			 from time_entry_append_position where organization_id = $1 and employee_id = $2`,
			[ids.organization, employeeId],
		);
		return rows[0] ?? null;
	}

	async function openPeriods(employeeId: string = ids.requester) {
		const { rows } = await admin.query<{ id: string; clock_in_id: string }>(
			"select id, clock_in_id from work_period where employee_id = $1 and end_time is null",
			[employeeId],
		);
		return rows;
	}

	/**
	 * Closes the open period without writing an entry, so only the period changes. It
	 * ends before the fixed clock-in instant, which adopted starts refuse to overlap (#327).
	 */
	async function closePeriodOutsideAppend(employeeId: string = ids.requester) {
		await admin.query(
			`update work_period set start_time = start_time - interval '2 hours',
			        end_time = start_time - interval '1 hour', duration_minutes = 60, is_active = false
			 where employee_id = $1 and end_time is null`,
			[employeeId],
		);
	}

	function reviewReasons() {
		return harness.warnings.flatMap((warning) => {
			const context = warning.context as {
				appendReviewRequirement?: {
					organizationId: string;
					employeeId: string;
					reasons: { kind: string }[];
				};
			};
			return context.appendReviewRequirement ? [context.appendReviewRequirement] : [];
		});
	}

	async function cleanup() {
		await admin.query("drop trigger if exists t273_fail_period on work_period");
		await admin.query("drop function if exists t273_fail_period()");
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id in ($1, $2)', [ids.requesterUser, ids.peerUser]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T273 web clock-in', $1, $3), ($2, 'T273 other', $2, $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Requester', 't273-requester@example.test', $3, $3),
			 ($2, 'Peer', 't273-peer@example.test', $3, $3)`,
			[ids.requesterUser, ids.peerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't273-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[ids.organization, timestamp, [ids.requesterUser, ids.peerUser]],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $5, 'employee', $6), ($3, $4, $5, 'employee', $6)`,
			[ids.requester, ids.requesterUser, ids.peer, ids.peerUser, ids.organization, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[[ids.requesterUser, ids.peerUser], timestamp],
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
			throw new Error("Web clock-in PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		harness.warnings.length = 0;
		await seed();
	});

	afterEach(async () => {
		for (const holder of [...openHolders]) await holder.commit();
		await admin.query("drop trigger if exists t273_fail_period on work_period");
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	it("keeps the legacy head selection while no control row or an inactive one exists", async () => {
		const history = [seedEntry(null, "clock_in", "2026-07-20T08:00:00Z", "2026-07-20T08:00:00Z")];
		await insertEntries(history);

		await expect(clockInAs()).resolves.toMatchObject({ success: true });
		expect((await entries()).at(-1)).toMatchObject({
			previous_hash: history[0].hash,
			previous_entry_id: null,
		});

		await closePeriodOutsideAppend();
		await admin.query("insert into time_entry_append_control (organization_id) values ($1)", [
			ids.organization,
		]);
		await expect(clockInAs()).resolves.toMatchObject({ success: true });
		expect((await entries()).at(-1)?.previous_entry_id).toBeNull();
		expect(await position()).toBeNull();
	});

	it("acquires the adoption, configuration, access and employee locks in protocol order", async () => {
		await activateAppendAdmission();
		const employeeHolder = await holdAdvisory(keys.employee);
		const action = clockInAs();
		const [waiter] = await waitForWaiters(employeeHolder.pid);

		expect(await advisoryHeld(waiter, keys.adoption)).toEqual(["ShareLock:held"]);
		expect(await advisoryHeld(waiter, keys.organization)).toEqual(["ShareLock:held"]);
		expect(await advisoryHeld(waiter, keys.requesterAccess)).toEqual(["ShareLock:held"]);
		expect(await advisoryHeld(waiter, keys.employee)).toEqual(["ExclusiveLock:waiting"]);

		await employeeHolder.commit();
		await expect(action).resolves.toMatchObject({ success: true });
	});

	it("reads the append control under the adoption gate, so activation drains clock-ins", async () => {
		const activation = await holdAdvisory(keys.adoption);
		const action = clockInAs();
		await waitForWaiters(activation.pid);
		// The exclusive adoption holder activates while the clock-in waits for its gate.
		await activation.query(
			"insert into time_entry_append_control (organization_id, mode) values ($1, 'active')",
			[ids.organization],
		);
		await activation.commit();

		await expect(action).resolves.toMatchObject({ success: true });
		const [created] = await entries();
		expect(await position()).toMatchObject({
			tip_entry_id: created.id,
			admission: "empty_history",
		});
	});

	it("admits genuinely empty history as a root with both predecessor fields null", async () => {
		await activateAppendAdmission();

		const result = await clockInAs();

		expect(result).toMatchObject({ success: true });
		const created = only(await entries());
		expect(created).toMatchObject({ previous_hash: null, previous_entry_id: null });
		expect(await position()).toEqual({
			tip_entry_id: created.id,
			tip_hash: created.hash,
			version: 1,
			entry_count: 1,
			admission: "empty_history",
			admitted_tip_entry_id: null,
			admitted_tip_hash: null,
			admitted_entry_count: 0,
			admitted_operation: "live_clock_in",
			last_operation: "live_clock_in",
		});
		expect(only(await openPeriods()).clock_in_id).toBe(created.id);
	});

	it("serializes concurrent first clock-ins on empty history into one root and position", async () => {
		await activateAppendAdmission();
		const employeeHolder = await holdAdvisory(keys.employee);
		const first = clockInAs();
		const second = clockInAs();
		await waitForWaiters(employeeHolder.pid, 2);
		await employeeHolder.commit();

		const results = await Promise.all([first, second]);

		expect(results.filter((result) => result.success)).toHaveLength(1);
		expect(results.filter((result) => !result.success)).toEqual([
			{ success: false, error: "You are already clocked in" },
		]);
		const created = only(await entries());
		expect(await position()).toMatchObject({
			tip_entry_id: created.id,
			version: 1,
			entry_count: 1,
		});
		expect(await openPeriods()).toHaveLength(1);
	});

	it("appends to the verified tip, not the latest-created row, across tied and backdated history", async () => {
		await activateAppendAdmission();
		const e1 = seedEntry(null, "clock_in", "2026-07-20T08:00:00Z", "2026-07-20T08:00:00Z");
		const e2 = seedEntry(e1, "clock_out", "2026-07-20T16:00:00Z", "2026-07-20T16:00:00Z");
		// Retained inactive and hash-only history participates in the lineage.
		const e3 = seedEntry(e2, "clock_in", "2026-07-21T08:00:00Z", "2026-07-21T08:00:00Z", {
			link: "hash-only",
			isSuperseded: true,
		});
		// Tied creation time with e3.
		const e4 = seedEntry(e3, "clock_out", "2026-07-21T12:00:00Z", "2026-07-21T08:00:00Z");
		// A backdated pair appended last but created and dated earliest.
		const e5 = seedEntry(e4, "clock_in", "2026-07-19T08:00:00Z", "2026-07-19T00:00:00Z");
		const e6 = seedEntry(e5, "clock_out", "2026-07-19T12:00:00Z", "2026-07-19T00:00:00Z");
		await insertEntries([e6, e3, e1, e5, e2, e4]);

		await expect(clockInAs()).resolves.toMatchObject({ success: true });

		const seeded = new Set([e1, e2, e3, e4, e5, e6].map((entry) => entry.id));
		const created = only((await entries()).filter((entry) => !seeded.has(entry.id)));
		expect(created).toMatchObject({ previous_entry_id: e6.id, previous_hash: e6.hash });
		expect(created.hash).toBe(
			calculateHash({
				employeeId: ids.requester,
				type: "clock_in",
				timestamp: "2026-07-22T08:00:00.000Z",
				previousHash: e6.hash,
			}),
		);
		expect(await position()).toMatchObject({
			tip_entry_id: created.id,
			version: 1,
			entry_count: 7,
			admission: "verified_lineage",
			admitted_tip_entry_id: e6.id,
			admitted_tip_hash: e6.hash,
			admitted_entry_count: 6,
		});
	});

	const reviewShapes: {
		name: string;
		history: () => SeedEntry[];
		reasons: string[];
		setup?: (history: SeedEntry[]) => Promise<void>;
	}[] = [
		{
			name: "competing heads",
			history: () => {
				const root = seedEntry(null, "clock_in", "2026-07-20T08:00:00Z", "2026-07-20T08:00:00Z");
				return [
					root,
					seedEntry(root, "clock_out", "2026-07-20T12:00:00Z", "2026-07-20T12:00:00Z"),
					seedEntry(root, "clock_out", "2026-07-20T16:00:00Z", "2026-07-20T16:00:00Z"),
				];
			},
			reasons: ["fork"],
		},
		{
			name: "disconnected import islands",
			history: () => {
				const first = seedEntry(null, "clock_in", "2026-07-20T08:00:00Z", "2026-07-20T08:00:00Z");
				const second = seedEntry(null, "clock_in", "2026-07-21T08:00:00Z", "2026-07-21T08:00:00Z");
				return [
					first,
					seedEntry(first, "clock_out", "2026-07-20T16:00:00Z", "2026-07-20T16:00:00Z"),
					second,
					seedEntry(second, "clock_out", "2026-07-21T16:00:00Z", "2026-07-21T16:00:00Z"),
				];
			},
			reasons: ["multiple_roots"],
		},
		{
			name: "a hole left by a deleted predecessor",
			history: () => {
				const root = seedEntry(null, "clock_in", "2026-07-20T08:00:00Z", "2026-07-20T08:00:00Z");
				const deleted = seedEntry(
					root,
					"clock_out",
					"2026-07-20T16:00:00Z",
					"2026-07-20T16:00:00Z",
				);
				return [
					root,
					seedEntry(deleted, "clock_in", "2026-07-21T08:00:00Z", "2026-07-21T08:00:00Z", {
						link: "hash-only",
					}),
				];
			},
			reasons: ["missing_predecessor"],
		},
		{
			name: "an explicit ID contradicting its hash",
			history: () => {
				const root = seedEntry(null, "clock_in", "2026-07-20T08:00:00Z", "2026-07-20T08:00:00Z");
				const other = seedEntry(root, "clock_out", "2026-07-20T16:00:00Z", "2026-07-20T16:00:00Z");
				const next = seedEntry(other, "clock_in", "2026-07-21T08:00:00Z", "2026-07-21T08:00:00Z");
				return [root, other, { ...next, previousEntryId: root.id }];
			},
			reasons: ["predecessor_hash_mismatch"],
		},
		{
			// Identical hash inputs legitimately give equal hashes. The standard hash
			// commits previousHash, so a duplicate never sits on one verified path: only
			// the structure blocks, and explicit IDs keep it from reading as ambiguous.
			name: "duplicate hashes disambiguated by explicit IDs",
			history: () => {
				const left = seedEntry(null, "clock_in", "2026-07-20T08:00:00Z", "2026-07-20T08:00:00Z");
				const right = {
					...left,
					id: seedEntry(null, "clock_in", left.timestamp, left.createdAt).id,
				};
				const leftOut = seedEntry(
					left,
					"clock_out",
					"2026-07-20T16:00:00Z",
					"2026-07-20T16:00:00Z",
				);
				const rightOut = {
					...leftOut,
					id: seedEntry(right, "clock_out", leftOut.timestamp, leftOut.createdAt).id,
					previousEntryId: right.id,
				};
				return [left, right, leftOut, rightOut];
			},
			reasons: ["multiple_roots"],
		},
		{
			name: "a hash-only link into duplicate hashes",
			history: () => {
				const left = seedEntry(null, "clock_in", "2026-07-20T08:00:00Z", "2026-07-20T08:00:00Z");
				// Created later, so latest-created selection would pick it.
				const right = {
					...left,
					id: seedEntry(null, "clock_in", left.timestamp, left.createdAt).id,
					createdAt: "2026-07-20T09:00:00Z",
				};
				return [
					left,
					right,
					seedEntry(left, "clock_out", "2026-07-20T16:00:00Z", "2026-07-20T16:00:00Z", {
						link: "hash-only",
					}),
				];
			},
			reasons: ["ambiguous_predecessor", "multiple_roots"],
		},
		{
			name: "an unestablished provider hash format",
			history: () => [
				{
					...seedEntry(null, "clock_in", "2026-07-20T08:00:00Z", "2026-07-20T08:00:00Z"),
					hash: calculateHash({
						employeeId: `${ids.requester}|${ids.organization}`,
						type: "clock_in",
						timestamp: "2026-07-20 08:00:00",
						previousHash: "imported",
					}),
				},
			],
			reasons: ["unverified_hash"],
		},
		{
			name: "work without any scoped entries",
			history: () => [],
			setup: async () => {
				const foreign = {
					...seedEntry(null, "clock_in", "2026-07-20T08:00:00Z", "2026-07-20T08:00:00Z"),
					organizationId: ids.otherOrganization,
				};
				await insertEntries([foreign]);
				await admin.query(
					`insert into work_period (employee_id, organization_id, clock_in_id, start_time,
					  end_time, duration_minutes, is_active, updated_at)
					 values ($1, $2, $3, $4, $4, 0, false, $4)`,
					[ids.requester, ids.organization, foreign.id, new Date(foreign.timestamp)],
				);
			},
			reasons: ["history_without_entries"],
		},
	];

	it.each(reviewShapes)(
		"returns an employee-scoped review requirement for $name",
		async ({ history, reasons, setup }) => {
			await activateAppendAdmission();
			const seeded = history();
			await insertEntries(seeded);
			await setup?.(seeded);
			const before = await entries();

			await expect(clockInAs()).resolves.toEqual(reviewResult);

			expect(await entries()).toEqual(before);
			expect(await openPeriods()).toEqual([]);
			expect(await position()).toBeNull();
			const [requirement] = reviewReasons();
			expect(requirement).toMatchObject({
				organizationId: ids.organization,
				employeeId: ids.requester,
			});
			expect([...new Set(requirement.reasons.map((reason) => reason.kind))].sort()).toEqual(
				reasons,
			);
		},
	);

	it("keeps other employees writable while one employee's history is held", async () => {
		await activateAppendAdmission();
		const root = seedEntry(null, "clock_in", "2026-07-20T08:00:00Z", "2026-07-20T08:00:00Z");
		await insertEntries([
			root,
			seedEntry(root, "clock_out", "2026-07-20T12:00:00Z", "2026-07-20T12:00:00Z"),
			seedEntry(root, "clock_out", "2026-07-20T16:00:00Z", "2026-07-20T16:00:00Z"),
		]);

		await expect(clockInAs()).resolves.toEqual(reviewResult);
		// An in-flight writer holding the requester's key does not serialize the peer.
		const requesterHolder = await holdAdvisory(keys.employee);
		await expect(clockInAs(ids.peerUser)).resolves.toMatchObject({ success: true });
		await requesterHolder.commit();

		expect(await position(ids.peer)).toMatchObject({ admission: "empty_history", version: 1 });
		expect(await position()).toBeNull();
	});

	it("holds fresh appends after a non-participating writer changes adopted history", async () => {
		await activateAppendAdmission();
		await expect(clockInAs()).resolves.toMatchObject({ success: true });
		const admitted = await position();

		// The uncoordinated clocking core refuses fresh writes once the organization
		// adopted (#327), without writing anything.
		await expect(
			clockingService.clockOut({
				employeeId: ids.requester,
				organizationId: ids.organization,
				createdBy: ids.requesterUser,
				actionId: randomUUID(),
				action: {
					instant: clockOutAt,
					utcOffsetMinutes: 0,
					timezone: "UTC",
					timezoneSource: "browser",
				},
				source: { ipAddress: null, deviceInfo: "web" },
			}),
		).rejects.toBeInstanceOf(ClockingAppendAdoptedError);
		expect(await position()).toEqual(admitted);

		// A binary that predates that fence (an undrained old server) still selects
		// the latest-created head and does not advance the position, so its write is
		// unexpected for this scope.
		const tip = only(await entries());
		await insertEntries([
			{
				id: randomUUID(),
				type: "clock_out",
				timestamp: clockOutAt.toString(),
				previousEntryId: null,
				hash: calculateHash({
					employeeId: ids.requester,
					type: "clock_out",
					timestamp: "2026-07-22T16:00:00.000Z",
					previousHash: tip.hash,
				}),
				previousHash: tip.hash,
				createdAt: new Date().toISOString(),
			},
		]);
		await closePeriodOutsideAppend();
		const before = await entries();

		await expect(clockInAs()).resolves.toEqual(reviewResult);

		expect(await entries()).toEqual(before);
		expect(await position()).toEqual(admitted);
		expect(only(reviewReasons()).reasons).toEqual([
			{ kind: "unexpected_history_change", expectedEntryCount: 1, actualEntryCount: 2 },
		]);
	});

	it("holds fresh appends when the adopted tip's committed hash changes", async () => {
		await activateAppendAdmission();
		await expect(clockInAs()).resolves.toMatchObject({ success: true });
		const tip = only(await entries());
		await closePeriodOutsideAppend();
		await admin.query("update time_entry set hash = $2 where id = $1", [tip.id, "0".repeat(64)]);

		await expect(clockInAs()).resolves.toEqual(reviewResult);
		expect(only(reviewReasons()).reasons).toEqual([
			{ kind: "position_tip_changed", tipEntryId: tip.id },
			{ kind: "unverified_hash", entryId: tip.id },
		]);
	});

	it("detects an offsetting insert and removal that leave the entry count unchanged", async () => {
		await activateAppendAdmission();
		const e1 = seedEntry(null, "clock_in", "2026-07-20T08:00:00Z", "2026-07-20T08:00:00Z");
		const e2 = seedEntry(e1, "clock_out", "2026-07-20T16:00:00Z", "2026-07-20T16:00:00Z");
		await insertEntries([e1, e2]);
		await expect(clockInAs()).resolves.toMatchObject({ success: true });
		const tip = only((await entries()).filter((entry) => entry.id !== e1.id && entry.id !== e2.id));
		await closePeriodOutsideAppend();
		// A non-participating writer appends after the tip while another removes e1.
		await insertEntries([
			{
				...seedEntry(null, "clock_out", "2026-07-22T12:00:00Z", "2026-07-22T12:00:00Z"),
				previousHash: tip.hash,
				hash: calculateHash({
					employeeId: ids.requester,
					type: "clock_out",
					timestamp: "2026-07-22T12:00:00.000Z",
					previousHash: tip.hash,
				}),
			},
		]);
		await admin.query("delete from time_entry where id = $1", [e1.id]);

		await expect(clockInAs()).resolves.toEqual(reviewResult);
		expect(
			only(reviewReasons())
				.reasons.map((reason) => reason.kind)
				.sort(),
		).toEqual(["predecessor_outside_scope", "unexpected_history_change"]);
	});

	it("fails closed when two unlocked admissions race to establish a position", async () => {
		// Coordinated callers serialize on the employee key; this proves the position
		// itself refuses a second establishment even without that key.
		await activateAppendAdmission();
		const { db } = await import("@/db");
		const { timeEntry } = await import("@/db/schema");
		const { admitTimeEntryAppend, TimeEntryAppendPositionChangedError } = await import(
			"@/lib/time-tracking/time-entry-append"
		);
		const timestamp = new Date("2026-07-22T08:00:00.000Z");
		const hash = calculateHash({
			employeeId: ids.requester,
			type: "clock_in",
			timestamp: timestamp.toISOString(),
			previousHash: null,
		});
		type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
		const admit = async (tx: Tx, entryId: string) => {
			const result = await admitTimeEntryAppend(
				tx,
				{ organizationId: ids.organization, employeeId: ids.requester },
				"live_clock_in",
			);
			if (result.kind !== "admitted") throw new Error("Expected admission");
			return async () => {
				await tx.insert(timeEntry).values({
					id: entryId,
					employeeId: ids.requester,
					organizationId: ids.organization,
					type: "clock_in",
					timestamp,
					utcOffsetMinutes: 0,
					timezone: "UTC",
					timezoneSource: "user_setting",
					hash,
					previousHash: null,
					createdBy: ids.requesterUser,
				});
				await result.append.record({
					id: entryId,
					hash,
					previousEntryId: null,
					previousHash: null,
				});
			};
		};
		const [first, second] = [randomUUID(), randomUUID()];
		let secondAdmitted!: () => void;
		let firstCommitted!: () => void;
		const secondReady = new Promise<void>((resolve) => {
			secondAdmitted = resolve;
		});
		const firstDone = new Promise<void>((resolve) => {
			firstCommitted = resolve;
		});
		const late = db.transaction(async (tx) => {
			const finish = await admit(tx, second);
			secondAdmitted();
			await firstDone;
			await finish();
		});
		await secondReady;
		await db.transaction(async (tx) => (await admit(tx, first))());
		firstCommitted();

		await expect(late).rejects.toBeInstanceOf(TimeEntryAppendPositionChangedError);
		expect((await entries()).map((entry) => entry.id)).toEqual([first]);
		expect(await position()).toMatchObject({ tip_entry_id: first, version: 1 });
	});

	it("keeps committed tip evidence from being removed under its position", async () => {
		await activateAppendAdmission();
		await expect(clockInAs()).resolves.toMatchObject({ success: true });
		const tip = only(await entries());
		await admin.query("delete from work_period where employee_id = $1", [ids.requester]);

		await expect(
			admin.query("delete from time_entry where id = $1", [tip.id]),
		).rejects.toMatchObject({ code: "23503" });
	});

	it("advances the position explicitly from one admitted append to the next", async () => {
		await activateAppendAdmission();
		await expect(clockInAs()).resolves.toMatchObject({ success: true });
		const first = only(await entries());
		await closePeriodOutsideAppend();

		await expect(clockInAs()).resolves.toMatchObject({ success: true });

		const second = only((await entries()).filter((entry) => entry.id !== first.id));
		expect(second).toMatchObject({ previous_entry_id: first.id, previous_hash: first.hash });
		expect(await position()).toMatchObject({
			tip_entry_id: second.id,
			tip_hash: second.hash,
			version: 2,
			entry_count: 2,
			admission: "empty_history",
			admitted_entry_count: 0,
		});
	});

	it("replays a committed clock-in action without advancing the tip", async () => {
		await activateAppendAdmission();
		await expect(clockInAs()).resolves.toMatchObject({ success: true });
		const committed = only(await entries());
		const admitted = await position();

		const replay = await withWebClockInTransaction(
			{ organizationId: ids.organization, employeeId: ids.requester, userId: ids.requesterUser },
			(coordination) =>
				clockingService.clockIn({
					coordination,
					actionId: committed.id,
					employeeId: ids.requester,
					organizationId: ids.organization,
					createdBy: ids.requesterUser,
					action: {
						instant: clockInAt,
						utcOffsetMinutes: 0,
						timezone: "UTC",
						timezoneSource: "browser",
					},
					source: { ipAddress: null, deviceInfo: "web" },
					workLocationType: "office",
				}),
		);

		expect(replay.entry).toMatchObject({ id: committed.id, hash: committed.hash });
		expect(await entries()).toEqual([committed]);
		expect(await position()).toEqual(admitted);
	});

	it.each([
		{ name: "empty history", admittedFirst: false },
		{ name: "an adopted position", admittedFirst: true },
	])("rolls back the entry and position with failed work from $name", async ({ admittedFirst }) => {
		await activateAppendAdmission();
		if (admittedFirst) {
			await expect(clockInAs()).resolves.toMatchObject({ success: true });
			await closePeriodOutsideAppend();
		}
		const before = { entries: await entries(), position: await position() };
		await admin.query(
			`create function t273_fail_period() returns trigger language plpgsql as $$
			 begin
			   if new.employee_id = '${ids.requester}' then raise exception 't273 injected failure'; end if;
			   return new;
			 end $$`,
		);
		await admin.query(
			"create trigger t273_fail_period before insert on work_period for each row execute function t273_fail_period()",
		);

		await expect(clockInAs()).resolves.toEqual({
			success: false,
			error: "Failed to clock in. Please try again.",
		});

		expect(await entries()).toEqual(before.entries);
		expect(await position()).toEqual(before.position);
		expect(await openPeriods()).toEqual([]);
	});

	it("removes append positions with the history in organization time-data cleanup", async () => {
		await activateAppendAdmission();
		await expect(clockInAs()).resolves.toMatchObject({ success: true });
		await expect(clockInAs(ids.peerUser)).resolves.toMatchObject({ success: true });

		await clearOrganizationTimeData(ids.organization);

		const { rows } = await admin.query<{ positions: number; entries: number }>(
			`select
			   (select count(*)::int from time_entry_append_position where organization_id = $1) as positions,
			   (select count(*)::int from time_entry where organization_id = $1) as entries`,
			[ids.organization],
		);
		expect(only(rows)).toEqual({ positions: 0, entries: 0 });
	});

	it("removes an employee's position when the employee is deleted", async () => {
		await activateAppendAdmission();
		await expect(clockInAs(ids.peerUser)).resolves.toMatchObject({ success: true });

		await admin.query("delete from employee where id = $1", [ids.peer]);

		expect(await position(ids.peer)).toBeNull();
	});
});
