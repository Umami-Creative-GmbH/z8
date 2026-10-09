/**
 * #327 / T62 runtime evidence: the legacy direct clock writer in adopted organizations,
 * and since #483 the route as a legacy command adapter over the Clocking module.
 *
 * Local contract: pnpm --filter webapp test:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real legacy `POST /api/time-entries` handler (membership, employee, capture checks,
 * the #266 queue fence and the production Clocking module) runs against that database. Only the session, request
 * headers, external billing provisioning, notification delivery and the Next cache are
 * replaced. Adoption is enabled per test organization by inserting its append control
 * row directly, as the operator's activation step does: production has no setter.
 */

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	headers: {} as Record<string, string>,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers(harness.headers) }));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

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

vi.mock("@/lib/billing/guard", async (importOriginal) =>
	(await import("@/test/integration-harness")).billingGuard(importOriginal),
);

const legacyRoute = await import("./route");

const ids = {
	organization: "t327-legacy-writer-org",
	requesterUser: "t327-requester-user",
	peerUser: "t327-peer-user",
	requester: "f3270000-0000-4000-8000-000000000001",
	peer: "f3270000-0000-4000-8000-000000000002",
} as const;
const server = "https://app.t327.test";
const adoptionKey = JSON.stringify(["completed-work-adoption", ids.organization]);

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describe("legacy direct clock writer in adopted organizations on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
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

	async function waitFor<T>(label: string, probe: () => Promise<T | undefined>): Promise<T> {
		const deadline = Date.now() + 15_000;
		while (Date.now() < deadline) {
			const value = await probe();
			if (value !== undefined) return value;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		throw new Error(`Timed out waiting for ${label}`);
	}

	/** Backends blocked (directly) by the holder's locks. */
	function waitForWaiters(holderPid: number, count = 1) {
		return waitFor(`${count} backend(s) blocked by ${holderPid}`, async () => {
			const { rows } = await admin.query<{ pid: number }>(
				`select pid from pg_stat_activity
				 where datname = current_database() and wait_event_type = 'Lock'
				   and $1 = any(pg_blocking_pids(pid))
				 order by pid`,
				[holderPid],
			);
			return rows.length >= count ? rows.map((row) => row.pid) : undefined;
		});
	}

	async function setAdmission(mode: "active" | "inactive" | null) {
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

	/** Every row a clock write can touch, to prove "no writes" by equality. */
	async function snapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
			   (select json_agg(row_to_json(t) order by t.employee_id) from time_entry_append_position t where organization_id = $1) as positions,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts`,
			[ids.organization],
		);
		return only(rows);
	}

	async function post(body: Record<string, unknown>, headers: Record<string, string> = {}) {
		harness.headers = headers;
		const response = await legacyRoute.POST(
			new Request(`${server}/api/time-entries`, {
				method: "POST",
				body: JSON.stringify(body),
			}) as never,
		);
		return { status: response.status, body: (await response.json()) as Record<string, any> };
	}

	/** An identity-less legacy clock action at server time. */
	const legacyClock = (type: "clock_in" | "clock_out") => ({ type });

	/** A captured extension action (cohort X3): UUID identity, capture evidence, replay flag. */
	const extensionClock = (type: "clock_in" | "clock_out", id: string = randomUUID()) => ({
		id,
		type,
		timestamp: new Date().toISOString(),
		browserTimezone: "UTC",
		utcOffsetMinutes: 0,
		replay: true,
	});

	/** A legacy desktop clock action: a server-unchecked instant, no identity. */
	const desktopClock = (type: "clock_in" | "clock_out", timestamp: string) => ({ type, timestamp });

	async function workPeriods() {
		const { rows } = await admin.query<{
			start_time: Date;
			end_time: Date | null;
			canonical_record_id: string | null;
		}>(
			`select start_time, end_time, canonical_record_id from work_period
			 where employee_id = $1 order by start_time`,
			[ids.requester],
		);
		return rows;
	}

	const refused = {
		status: 409,
		body: {
			error: "This organization only accepts coordinated clock commands",
			code: "append_adopted",
		},
	};

	async function cleanup() {
		await admin.query("drop function if exists t327_park() cascade");
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id in ($1, $2)', [ids.requesterUser, ids.peerUser]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T327 legacy writer', $1, $2)`,
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
			 ($1, 'Requester', 't327-requester@example.test', $3, $3),
			 ($2, 'Peer', 't327-peer@example.test', $3, $3)`,
			[ids.requesterUser, ids.peerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t327-member-requester', $1, $2, 'member', 'approved', $4),
			 ('t327-member-peer', $1, $3, 'member', 'approved', $4)`,
			[ids.organization, ids.requesterUser, ids.peerUser, timestamp],
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

	/**
	 * Parks the next clock write on a lock the returned holder owns, after the writer
	 * has taken the shared adoption gate and the employee key.
	 */
	async function parkNextEntryInsert() {
		await admin.query(`create function t327_park() returns trigger language plpgsql as $$
			begin perform pg_advisory_xact_lock(hashtextextended('t327-park', 0)); return new; end $$`);
		await admin.query(
			"create trigger t327_park before insert on time_entry for each row execute function t327_park()",
		);
		const holder = await openHolder();
		await holder.query("select pg_advisory_xact_lock(hashtextextended('t327-park', 0))");
		return holder;
	}

	beforeEach(async () => {
		for (const holder of [...openHolders]) await holder.commit();
		harness.userId = ids.requesterUser;
		harness.organizationId = ids.organization;
		harness.headers = {};
		await seed();
	});

	afterAll(async () => {
		for (const holder of [...openHolders]) await holder.commit();
		await cleanup();
	});

	it("keeps the legacy writer for organizations without an active control", async () => {
		await setAdmission("inactive");
		await expect(post(legacyClock("clock_in"))).resolves.toMatchObject({ status: 201 });
		await expect(post(legacyClock("clock_out"))).resolves.toMatchObject({ status: 201 });

		await setAdmission(null);
		await expect(post(legacyClock("clock_in"))).resolves.toMatchObject({ status: 201 });
	});

	it("closes legacy work with its canonical record and follows the closure up", async () => {
		await setAdmission(null);
		await expect(post(desktopClock("clock_in", "2026-07-22T08:00:00Z"))).resolves.toMatchObject({
			status: 201,
		});
		const clockOut = await post(desktopClock("clock_out", "2026-07-22T10:00:00Z"));

		expect(clockOut).toMatchObject({ status: 201, body: { entry: { type: "clock_out" } } });
		// Only the entry answers; closure advice stays with the web.
		expect(Object.keys(clockOut.body)).toEqual(["entry"]);
		expect(clockOut.body.entry).not.toHaveProperty("complianceWarnings");
		expect(await workPeriods()).toEqual([
			{
				start_time: new Date("2026-07-22T08:00:00Z"),
				end_time: new Date("2026-07-22T10:00:00Z"),
				canonical_record_id: expect.any(String),
			},
		]);
		const { rows: balances } = await admin.query(
			"select is_dirty from employee_work_balance where employee_id = $1",
			[ids.requester],
		);
		expect(balances).toEqual([{ is_dirty: true }]);
	});

	it("refuses a legacy clock-in inside recorded work or on a blocking holiday, never a clock-out", async () => {
		await setAdmission(null);
		await post(desktopClock("clock_in", "2026-07-22T08:00:00Z"));
		await post(desktopClock("clock_out", "2026-07-22T10:00:00Z"));
		const before = await snapshot();

		await expect(post(desktopClock("clock_in", "2026-07-22T09:00:00Z"))).resolves.toEqual({
			status: 409,
			body: { error: "Clock-in overlaps recorded work" },
		});
		expect(await snapshot()).toEqual(before);

		await expect(post(desktopClock("clock_in", "2026-07-22T20:00:00Z"))).resolves.toMatchObject({
			status: 201,
		});
		await admin.query(
			`insert into holiday_category (id, organization_id, type, name, blocks_time_entry, updated_at)
			 values ('f3270000-0000-4000-8000-000000000021', $1, 'public_holiday', 'Closed', true, now())`,
			[ids.organization],
		);
		await admin.query(
			`insert into holiday (id, organization_id, category_id, name, start_date, end_date, created_by, updated_at)
			 values ('f3270000-0000-4000-8000-000000000022', $1, 'f3270000-0000-4000-8000-000000000021',
			         'Closing day', '2026-07-23T00:00:00', '2026-07-23T23:59:59', $2, now())`,
			[ids.organization, ids.requesterUser],
		);
		// A holiday never leaves live work running.
		await expect(post(desktopClock("clock_out", "2026-07-23T02:00:00Z"))).resolves.toMatchObject({
			status: 201,
		});
		const closed = await snapshot();
		await expect(post(desktopClock("clock_in", "2026-07-23T08:00:00Z"))).resolves.toEqual({
			status: 409,
			body: { error: "Clock-in is not allowed on a holiday" },
		});
		expect(await snapshot()).toEqual(closed);
	});

	it("refuses fresh legacy clock-ins and clock-outs in an adopted organization without writes", async () => {
		// Work opened before adoption; adoption does not strand it for the legacy writer's
		// replacement, only for the legacy writer itself.
		await setAdmission(null);
		await expect(post(legacyClock("clock_in"))).resolves.toMatchObject({ status: 201 });
		await setAdmission("active");
		const before = await snapshot();

		await expect(post(legacyClock("clock_out"))).resolves.toEqual(refused);
		await expect(post(extensionClock("clock_out"))).resolves.toEqual(refused);
		expect(await snapshot()).toEqual(before);

		// A fresh clock-in on an employee without history is refused just the same.
		harness.userId = ids.peerUser;
		await expect(post(legacyClock("clock_in"))).resolves.toEqual(refused);
		expect(await snapshot()).toEqual(before);
	});

	it("answers with a status every legacy queue reader retains", async () => {
		await setAdmission("active");
		// Extension cohorts keep a row on 409 (the #266 fence rewrites only their 400).
		const extension = await post(extensionClock("clock_in"), {
			origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
		});
		expect(extension).toEqual(refused);
	});

	it("still answers committed legacy actions after adoption, with no writes", async () => {
		await setAdmission(null);
		// A queued action resends its captured instant; another instant is another command.
		const clockInAction = extensionClock("clock_in");
		const clockOutAction = extensionClock("clock_out");
		const clockIn = await post(clockInAction);
		const clockOut = await post(clockOutAction);
		expect([clockIn.status, clockOut.status]).toEqual([201, 201]);
		await setAdmission("active");
		const before = await snapshot();

		await expect(post(clockInAction)).resolves.toEqual(clockIn);
		await expect(post(clockOutAction)).resolves.toEqual(clockOut);
		expect(await snapshot()).toEqual(before);
	});

	it("drains an in-flight legacy write before an activation becomes visible", async () => {
		await setAdmission(null);
		const park = await parkNextEntryInsert();
		const inFlight = post(legacyClock("clock_in"));
		await waitForWaiters(park.pid);

		// The operator's activation takes the exclusive adoption gate and waits for
		// the legacy write, which holds the shared gate.
		const operator = await openHolder();
		const activation = operator.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
			adoptionKey,
		]);
		await waitFor("activation blocked by the in-flight legacy write", async () => {
			const { rows } = await admin.query(
				`select 1 from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'`,
				[operator.pid],
			);
			return rows.length > 0 ? true : undefined;
		});
		await park.commit();

		await expect(inFlight).resolves.toMatchObject({ status: 201 });
		await activation;
		await operator.query(
			"insert into time_entry_append_control (organization_id, mode) values ($1, 'active')",
			[ids.organization],
		);
		await operator.commit();

		await expect(post(legacyClock("clock_out"))).resolves.toEqual(refused);
	});

	it("refuses a legacy write that arrives while an activation commits", async () => {
		await setAdmission(null);
		const operator = await openHolder();
		await operator.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [adoptionKey]);
		await operator.query(
			"insert into time_entry_append_control (organization_id, mode) values ($1, 'active')",
			[ids.organization],
		);
		const before = await snapshot();

		const arriving = post(legacyClock("clock_in"));
		await waitForWaiters(operator.pid);
		await operator.commit();

		await expect(arriving).resolves.toEqual(refused);
		expect(await snapshot()).toEqual(before);
	});

	it("keeps other organizations' legacy writers independent of an activation", async () => {
		// Only this organization's gate is exclusive; the peer writes through its own.
		const otherOrganization = "t327-legacy-writer-other-org";
		await admin.query("delete from organization where id = $1", [otherOrganization]);
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T327 other', $1, now())`,
			[otherOrganization],
		);
		try {
			await admin.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ('t327-member-peer-other', $1, $2, 'member', 'approved', now())`,
				[otherOrganization, ids.peerUser],
			);
			await admin.query(
				`insert into employee (id, user_id, organization_id, role, updated_at)
				 values ('f3270000-0000-4000-8000-000000000009', $1, $2, 'employee', now())`,
				[ids.peerUser, otherOrganization],
			);
			const operator = await openHolder();
			await operator.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
				adoptionKey,
			]);

			harness.userId = ids.peerUser;
			harness.organizationId = otherOrganization;
			await expect(post(legacyClock("clock_in"))).resolves.toMatchObject({ status: 201 });
			await operator.commit();
		} finally {
			await admin.query("delete from organization where id = $1", [otherOrganization]);
		}
	});

	describe("project tasks on legacy clock-outs (#875)", () => {
		const project = {
			a: "f3270000-0000-4000-8000-0000000000a1",
			b: "f3270000-0000-4000-8000-0000000000b1",
		} as const;
		const tasks = {
			open: "f3270000-0000-4000-8000-0000000000a2",
			done: "f3270000-0000-4000-8000-0000000000a3",
			otherProject: "f3270000-0000-4000-8000-0000000000b2",
		} as const;

		beforeEach(async () => {
			await setAdmission(null);
			await admin.query(
				`insert into project (id, organization_id, name, status, is_active, created_by, updated_at)
				 values ($1, $3, 'Project A', 'active', true, $4, now()),
				        ($2, $3, 'Project B', 'active', true, $4, now())`,
				[project.a, project.b, ids.organization, ids.requesterUser],
			);
			await admin.query(
				`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
				 select gen_random_uuid(), p, $2, 'employee', $3, $4 from unnest($1::uuid[]) as p`,
				[[project.a, project.b], ids.organization, ids.requester, ids.requesterUser],
			);
			await admin.query(
				`insert into project_task
				 (id, organization_id, project_id, name, state, done_at, done_by, created_by, updated_at) values
				 ($1, $4, $5, 'Design', 'open', null, null, $7, now()),
				 ($2, $4, $5, 'Shipped', 'done', now(), $7, $7, now()),
				 ($3, $4, $6, 'Elsewhere', 'open', null, null, $7, now())`,
				[
					tasks.open,
					tasks.done,
					tasks.otherProject,
					ids.organization,
					project.a,
					project.b,
					ids.requesterUser,
				],
			);
			await post(desktopClock("clock_in", "2026-07-22T08:00:00Z"));
		});

		async function bookedTask() {
			const { rows } = await admin.query<{ project: string | null; task: string | null }>(
				"select project_id as project, task_id as task from work_period where employee_id = $1",
				[ids.requester],
			);
			return only(rows);
		}

		it("books the named task of the named project", async () => {
			const clockOut = await post({
				...desktopClock("clock_out", "2026-07-22T10:00:00Z"),
				projectId: project.a,
				taskId: tasks.open,
			});

			expect(clockOut).toMatchObject({ status: 201, body: { entry: { type: "clock_out" } } });
			expect(await bookedTask()).toEqual({ project: project.a, task: tasks.open });
		});

		it("books no task when none is named", async () => {
			await post({ ...desktopClock("clock_out", "2026-07-22T10:00:00Z"), projectId: project.a });

			expect(await bookedTask()).toEqual({ project: project.a, task: null });
		});

		it.each([
			["a done task", tasks.done, "task_done"],
			["another project's task", tasks.otherProject, "task_other_project"],
			["an unknown task", "f3270000-0000-4000-8000-0000000000ff", "task_not_found"],
			["a malformed task id", "not-a-task", "task_not_found"],
		])("refuses %s with the stable reason and writes nothing", async (_label, taskId, reason) => {
			const before = await snapshot();

			const clockOut = await post({
				...desktopClock("clock_out", "2026-07-22T10:00:00Z"),
				projectId: project.a,
				taskId,
			});

			expect(clockOut).toEqual({
				status: 400,
				body: {
					error: "Cannot book time to this task",
					code: "attribution_not_allowed",
					field: "taskId",
					reason,
				},
			});
			expect(await snapshot()).toEqual(before);
		});
	});
});
