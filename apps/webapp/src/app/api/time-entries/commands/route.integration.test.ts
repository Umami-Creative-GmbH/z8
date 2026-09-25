/**
 * #275 / T11 runtime evidence: frozen direct-HTTP clock commands.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real `/api/time-entries/commands` handlers (capabilities, submit, lookup) and
 * the legacy `POST /api/time-entries` run against that database through the real
 * coordinators, completed-work operations and append collaborator. Only the
 * session, external billing provisioning, notification delivery, the public-origin
 * resolver, the authoritative server clock and the Next cache are replaced.
 * Adoption is enabled per test organization by inserting its append control row
 * directly: production has no activation setter.
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
	server: "https://app.t275.test" as string | null,
	notifications: [] as string[],
	/** Runs once between a submission's replay check and its fresh preflight. */
	beforeFreshPreflight: null as (() => Promise<void>) | null,
}));

vi.mock("@/lib/time-tracking/validation", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/time-tracking/validation")>();
	return {
		...original,
		validateTimeEntry: async (...args: Parameters<typeof original.validateTimeEntry>) => {
			const hook = harness.beforeFreshPreflight;
			harness.beforeFreshPreflight = null;
			await hook?.();
			return original.validateTimeEntry(...args);
		},
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

vi.mock("@/lib/billing/guard", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/billing/guard")>()),
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("@/lib/domain/request-origin", () => ({
	resolvePublicRequestOrigin: async () => {
		if (!harness.server) throw new Error("Unknown origin");
		return harness.server;
	},
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
	sendClockOutApprovalNotifications: async () => {
		harness.notifications.push("pending");
	},
	sendClockOutApprovedNotification: async () => {
		harness.notifications.push("approved");
	},
}));

const commands = await import("./route");
const lookupRoute = await import("./[operationId]/route");
const legacyRoute = await import("../route");
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
	describe.skip(`direct clock commands PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t275-clock-command-org",
	otherOrganization: "t275-clock-command-other-org",
	requesterUser: "t275-requester-user",
	peerUser: "t275-peer-user",
	requester: "f1000000-0000-4000-8000-000000000001",
	peer: "f1000000-0000-4000-8000-000000000002",
	projectA: "f3000000-0000-4000-8000-000000000001",
	assignmentA: "f3000000-0000-4000-8000-000000000002",
	projectB: "f3000000-0000-4000-8000-000000000003",
} as const;
const server = "https://app.t275.test";
const now = parseInstant("2026-09-20T10:00:00Z");
const days = (count: number) => ({ hours: count * 24 });

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

type Command = Record<string, unknown> & { operationId: string };

function context(overrides: Record<string, unknown> = {}) {
	return {
		userId: ids.requesterUser,
		organizationId: ids.organization,
		employeeId: ids.requester,
		server,
		...overrides,
	};
}

function clockInCommand(overrides: Record<string, unknown> = {}): Command {
	return {
		version: 2,
		operationId: randomUUID(),
		kind: "clock_in",
		admission: "immediate",
		occurredAt: now.toString(),
		timezone: "Europe/Berlin",
		context: context(),
		workLocationType: "home",
		...overrides,
	};
}

function clockOutCommand(
	target: Record<string, string>,
	overrides: Record<string, unknown> = {},
): Command {
	return {
		version: 2,
		operationId: randomUUID(),
		kind: "clock_out",
		admission: "immediate",
		occurredAt: now.toString(),
		timezone: "Europe/Berlin",
		context: context(),
		target,
		project: { kind: "preserve" },
		workCategory: { kind: "preserve" },
		...overrides,
	};
}

async function submit(command: unknown) {
	const response = await commands.POST(
		new Request(`${server}/api/time-entries/commands`, {
			method: "POST",
			body: JSON.stringify(command),
		}),
	);
	return { status: response.status, body: (await response.json()) as Record<string, any> };
}

async function lookup(operationId: string) {
	const response = await lookupRoute.GET(
		new Request(`${server}/api/time-entries/commands/${operationId}`),
		{
			params: Promise.resolve({ operationId }),
		},
	);
	return { status: response.status, body: (await response.json()) as Record<string, any> };
}

describeIntegration("frozen direct-HTTP clock commands on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 6 });

	function actAs(userId: string, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	/** Every row a command can write, to prove "no writes" by equality. */
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

	async function receipt(operationId: string) {
		const { rows } = await admin.query("select * from completed_work_operation where id = $1", [
			operationId,
		]);
		return only(rows);
	}

	async function period(clockInId: string) {
		const { rows } = await admin.query<{
			id: string;
			is_active: boolean;
			start_time: Date;
			end_time: Date | null;
			duration_minutes: number | null;
			clock_out_id: string | null;
			canonical_record_id: string | null;
			work_location_type: string | null;
			graph_revision: number;
		}>(
			`select id, is_active, start_time, end_time, duration_minutes, clock_out_id,
			        canonical_record_id, work_location_type, graph_revision
			 from work_period where clock_in_id = $1`,
			[clockInId],
		);
		return only(rows);
	}

	async function cleanup() {
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
			 ($1, 'T275 commands', $1, $3), ($2, 'T275 other', $2, $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Requester', 't275-requester@example.test', $3, $3),
			 ($2, 'Peer', 't275-peer@example.test', $3, $3)`,
			[ids.requesterUser, ids.peerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t275-member-requester', $1, $3, 'member', 'approved', $5),
			 ('t275-member-peer', $1, $4, 'member', 'approved', $5),
			 ('t275-member-requester-other', $2, $3, 'member', 'approved', $5)`,
			[ids.organization, ids.otherOrganization, ids.requesterUser, ids.peerUser, timestamp],
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
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at) values
			 ($1, $2, 'Project A', 'active', true, $3, $4), ($5, $2, 'Project B', 'active', true, $3, $4)`,
			[ids.projectA, ids.organization, ids.requesterUser, timestamp, ids.projectB],
		);
		await admin.query(
			`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
			 values ($1, $2, $3, 'employee', $4, $5)`,
			[ids.assignmentA, ids.projectA, ids.organization, ids.requester, ids.requesterUser],
		);
		await setAdmission("active");
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
			throw new Error("Direct clock command PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		harness.now = now;
		harness.server = server;
		harness.notifications.length = 0;
		harness.beforeFreshPreflight = null;
		actAs(ids.requesterUser);
		await seed();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	it("advertises capabilities and the server-derived context, gated by adoption", async () => {
		const read = async () => {
			const response = await commands.GET(new Request(`${server}/api/time-entries/commands`));
			return { status: response.status, body: await response.json() };
		};
		expect(await read()).toEqual({
			status: 200,
			body: {
				commandVersions: [2],
				kinds: ["clock_in", "clock_out"],
				submit: "available",
				lookup: "available",
				admission: {
					immediate: { pastSeconds: 300, futureSeconds: 300 },
					delayed: { pastSeconds: 604800, futureSeconds: 300 },
				},
				context: context(),
			},
		});
		await setAdmission("inactive");
		expect((await read()).body.submit).toBe("unavailable");
		harness.userId = null;
		expect((await read()).status).toBe(401);
	});

	it("starts live work with a committed receipt and replays the same command without writes", async () => {
		const command = clockInCommand();

		const executed = await submit(command);

		expect(executed.status).toBe(201);
		expect(executed.body).toMatchObject({
			outcome: "executed",
			operationId: command.operationId,
			receipt: {
				kind: "start_live_work",
				result: {
					version: 1,
					operationId: command.operationId,
					owner: { employeeId: ids.requester },
					actor: { kind: "human", userId: ids.requesterUser },
					clockInEntryId: command.operationId,
					start: {
						at: "2026-09-20T10:00:00Z",
						// The server derives the offset from the captured zone.
						utcOffsetMinutes: 120,
						timezone: "Europe/Berlin",
						timezoneSource: "browser",
					},
					attribution: { workLocationType: "home" },
					revisions: { workPeriod: { result: 0 } },
					append: { admission: "append", previousEntryId: null, previousHash: null },
				},
			},
		});
		const started = await period(command.operationId);
		expect(started).toMatchObject({
			is_active: true,
			start_time: new Date("2026-09-20T10:00:00Z"),
			end_time: null,
			work_location_type: "home",
		});
		expect(await receipt(command.operationId)).toMatchObject({
			organization_id: ids.organization,
			employee_id: ids.requester,
			kind: "start_live_work",
			writer: "direct_http",
			writer_version: 1,
			command_version: 2,
			command,
			append_admission: "append",
			actor_kind: "human",
			actor_user_id: ids.requesterUser,
			work_period_id: started.id,
		});
		const { rows: entry } = await admin.query(
			"select type, device_info, utc_offset_minutes, timezone, created_by from time_entry where id = $1",
			[command.operationId],
		);
		expect(only(entry)).toEqual({
			type: "clock_in",
			device_info: "api",
			utc_offset_minutes: 120,
			timezone: "Europe/Berlin",
			created_by: ids.requesterUser,
		});
		const { rows: positions } = await admin.query(
			"select tip_entry_id, version, last_operation from time_entry_append_position where employee_id = $1",
			[ids.requester],
		);
		expect(only(positions)).toEqual({
			tip_entry_id: command.operationId,
			version: 1,
			last_operation: "live_clock_in",
		});

		const before = await snapshot();
		const replayed = await submit(command);
		expect(replayed).toEqual({
			status: 200,
			body: { ...executed.body, outcome: "replayed" },
		});
		expect(await snapshot()).toEqual(before);
	});

	it("treats a changed command under a committed identity as a collision", async () => {
		const command = clockInCommand();
		await submit(command);
		const before = await snapshot();

		for (const changed of [
			{ ...command, workLocationType: "office" },
			{ ...command, occurredAt: now.add({ seconds: 1 }).toString() },
			{ ...command, admission: "delayed" },
			// Same identity under the other kind.
			clockOutCommand({ workPeriodId: randomUUID() }, { operationId: command.operationId }),
		]) {
			expect(await submit(changed)).toEqual({
				status: 409,
				body: { outcome: "rejected", operationId: command.operationId, code: "collision" },
			});
		}
		expect(await snapshot()).toEqual(before);
	});

	it("closes the work created by the named clock-in operation through the completed-work operation", async () => {
		const start = clockInCommand();
		await submit(start);
		harness.now = now.add({ hours: 8, seconds: 40 });
		const close = clockOutCommand(
			{ clockInOperationId: start.operationId },
			{
				occurredAt: harness.now.toString(),
				project: { kind: "replace", id: ids.projectA },
			},
		);

		const executed = await submit(close);

		expect(executed.status).toBe(201);
		expect(executed.body).toMatchObject({
			outcome: "executed",
			receipt: {
				kind: "close_active_work",
				result: {
					operationId: close.operationId,
					clockInEntryId: start.operationId,
					clockOutEntryId: close.operationId,
					segment: {
						startAt: "2026-09-20T10:00:00Z",
						endAt: "2026-09-20T18:00:40Z",
						durationMinutes: 481,
						startUtcOffsetMinutes: 120,
						endUtcOffsetMinutes: 120,
						endTimezone: "Europe/Berlin",
					},
					attribution: { projectId: ids.projectA, workLocationType: "home" },
					revisions: { workPeriod: { source: 0, result: 1 } },
					approvalState: "approved",
				},
			},
		});
		expect(await period(start.operationId)).toMatchObject({
			is_active: false,
			end_time: new Date("2026-09-20T18:00:40Z"),
			duration_minutes: 481,
			clock_out_id: close.operationId,
			canonical_record_id: expect.any(String),
			graph_revision: 1,
		});
		expect(await receipt(close.operationId)).toMatchObject({
			kind: "close_active_work",
			writer: "direct_http",
			command_version: 2,
			command: close,
		});
		const { rows: entry } = await admin.query(
			"select device_info, previous_entry_id from time_entry where id = $1",
			[close.operationId],
		);
		expect(only(entry)).toEqual({ device_info: "api", previous_entry_id: start.operationId });

		// Replay is independent of the server clock and of the current active state.
		harness.now = now.add(days(9));
		const before = await snapshot();
		expect(await submit(close)).toEqual({
			status: 200,
			body: { outcome: "replayed", operationId: close.operationId, receipt: executed.body.receipt },
		});
		expect(await snapshot()).toEqual(before);
	});

	it("keeps current attribution eligibility checks and writes nothing when they fail", async () => {
		const start = clockInCommand();
		await submit(start);
		const before = await snapshot();

		const outcome = await submit(
			clockOutCommand(
				{ clockInOperationId: start.operationId },
				{ project: { kind: "replace", id: ids.projectB } },
			),
		);

		expect(outcome).toMatchObject({
			status: 422,
			body: { outcome: "rejected", code: "attribution_not_allowed", field: "projectId" },
		});
		expect(await snapshot()).toEqual(before);
		expect((await lookup(outcome.body.operationId)).body.outcome).toBe("not_committed");
	});

	it("never closes a different active period than the one the command targets", async () => {
		const first = clockInCommand();
		await submit(first);
		harness.now = now.add({ hours: 1 });
		await submit(
			clockOutCommand(
				{ clockInOperationId: first.operationId },
				{ occurredAt: harness.now.toString() },
			),
		);
		harness.now = now.add({ hours: 2 });
		const second = clockInCommand({ occurredAt: harness.now.toString() });
		await submit(second);
		const before = await snapshot();

		const stale = await submit(
			clockOutCommand(
				{ clockInOperationId: first.operationId },
				{ occurredAt: harness.now.toString() },
			),
		);
		const byPeriod = await submit(
			clockOutCommand(
				{ workPeriodId: (await period(first.operationId)).id },
				{ occurredAt: harness.now.toString() },
			),
		);
		const unknown = await submit(
			clockOutCommand({ clockInOperationId: randomUUID() }, { occurredAt: harness.now.toString() }),
		);

		expect([stale.status, stale.body.code]).toEqual([409, "target_not_active"]);
		expect([byPeriod.status, byPeriod.body.code]).toEqual([409, "target_not_active"]);
		expect([unknown.status, unknown.body.code]).toEqual([409, "target_unknown"]);
		expect(await snapshot()).toEqual(before);
		expect((await period(second.operationId)).is_active).toBe(true);
	});

	it("admits immediate and delayed commands only inside their elapsed-age windows", async () => {
		const before = await snapshot();
		const rejected = [
			clockInCommand({ occurredAt: now.subtract({ minutes: 5, milliseconds: 1 }).toString() }),
			clockInCommand({ occurredAt: now.add({ minutes: 5, milliseconds: 1 }).toString() }),
			clockInCommand({
				admission: "delayed",
				occurredAt: now.subtract({ hours: 7 * 24, milliseconds: 1 }).toString(),
			}),
			clockInCommand({
				admission: "delayed",
				occurredAt: now.add({ minutes: 5, milliseconds: 1 }).toString(),
			}),
		];
		const outcomes = [];
		for (const command of rejected) outcomes.push(await submit(command));
		expect(outcomes.map(({ status, body }) => [status, body.code, body.reason])).toEqual([
			[422, "admission_window", "too_old"],
			[422, "admission_window", "in_future"],
			[422, "admission_window", "too_old"],
			[422, "admission_window", "in_future"],
		]);
		expect(await snapshot()).toEqual(before);
		// Rejected uncommitted identities stay recoverable: nothing committed.
		expect((await lookup(rejected[0]!.operationId)).body.outcome).toBe("not_committed");

		const delayedStart = clockInCommand({
			admission: "delayed",
			occurredAt: now.subtract(days(7)).toString(),
		});
		expect((await submit(delayedStart)).status).toBe(201);
		const delayedClose = clockOutCommand(
			{ clockInOperationId: delayedStart.operationId },
			{ admission: "delayed", occurredAt: now.subtract(days(7)).add({ hours: 4 }).toString() },
		);
		expect((await submit(delayedClose)).status).toBe(201);
		expect(await period(delayedStart.operationId)).toMatchObject({
			start_time: new Date("2026-09-13T10:00:00Z"),
			end_time: new Date("2026-09-13T14:00:00Z"),
			duration_minutes: 240,
		});
		// The same instant sent as immediate is outside the immediate window.
		const immediate = await submit(
			clockInCommand({ occurredAt: now.subtract(days(6)).toString() }),
		);
		expect([immediate.status, immediate.body.reason]).toEqual([422, "too_old"]);
	});

	it("refuses delayed starts that overlap existing work and allows adjacency", async () => {
		const start = clockInCommand({
			admission: "delayed",
			occurredAt: now.subtract(days(2)).toString(),
		});
		await submit(start);
		await submit(
			clockOutCommand(
				{ clockInOperationId: start.operationId },
				{ admission: "delayed", occurredAt: now.subtract(days(2)).add({ hours: 4 }).toString() },
			),
		);
		const before = await snapshot();

		const overlapping = await submit(
			clockInCommand({
				admission: "delayed",
				occurredAt: now.subtract(days(2)).add({ hours: 3, minutes: 59 }).toString(),
			}),
		);
		expect([overlapping.status, overlapping.body.code]).toEqual([409, "occupancy_conflict"]);
		expect(await snapshot()).toEqual(before);

		const adjacent = await submit(
			clockInCommand({
				admission: "delayed",
				occurredAt: now.subtract(days(2)).add({ hours: 4 }).toString(),
			}),
		);
		expect(adjacent.status).toBe(201);

		const whileActive = await submit(clockInCommand());
		expect([whileActive.status, whileActive.body.code]).toEqual([409, "already_clocked_in"]);
	});

	it("rejects commands whose captured context disagrees with server-derived authority", async () => {
		const before = await snapshot();
		const cases: [Record<string, unknown>, string[]][] = [
			[{ organizationId: ids.otherOrganization }, ["organizationId"]],
			[{ employeeId: ids.peer }, ["employeeId"]],
			[{ userId: ids.peerUser }, ["userId"]],
			[{ server: "https://other.t275.test" }, ["server"]],
		];
		for (const [overrides, fields] of cases) {
			const outcome = await submit(clockInCommand({ context: context(overrides) }));
			expect(outcome.status).toBe(409);
			expect(outcome.body).toMatchObject({ code: "context_mismatch", fields });
		}
		// Switching the active organization never resubmits into the new one.
		actAs(ids.requesterUser, ids.otherOrganization);
		const switched = await submit(clockInCommand());
		expect(switched.status).toBe(403);
		expect(switched.body.code).toBe("access_denied");
		actAs(ids.requesterUser);
		harness.server = null;
		expect((await submit(clockInCommand())).body.fields).toEqual(["server"]);
		expect(await snapshot()).toEqual(before);
	});

	it("keeps fresh submission gated off without adoption but replays committed receipts in every mode", async () => {
		const committed = clockInCommand();
		await submit(committed);
		await setAdmission("inactive");
		const before = await snapshot();

		expect((await submit(committed)).status).toBe(200);
		const fresh = await submit(
			clockOutCommand(
				{ clockInOperationId: committed.operationId },
				{ occurredAt: now.toString() },
			),
		);
		expect([fresh.status, fresh.body.code]).toEqual([409, "not_adopted"]);
		await admin.query("delete from time_entry_append_control where organization_id = $1", [
			ids.organization,
		]);
		const start = clockInCommand({ operationId: randomUUID() });
		expect((await submit(start)).body.code).toBe("not_adopted");
		expect(await snapshot()).toEqual(before);
		expect((await lookup(start.operationId)).body.outcome).toBe("not_committed");
	});

	it("looks up outcomes without creating work, scoped to the authenticated employee", async () => {
		const command = clockInCommand();
		const executed = await submit(command);
		const unknownId = randomUUID();
		const before = await snapshot();

		expect(await lookup(command.operationId)).toEqual({
			status: 200,
			body: {
				outcome: "committed",
				operationId: command.operationId,
				receipt: executed.body.receipt,
				command,
				evidence: "standing",
			},
		});
		expect((await lookup(unknownId)).body).toEqual({
			outcome: "not_committed",
			operationId: unknownId,
		});
		// Another employee learns nothing about this receipt.
		actAs(ids.peerUser);
		expect((await lookup(command.operationId)).body).toEqual({
			outcome: "conflict",
			operationId: command.operationId,
		});
		expect(await snapshot()).toEqual(before);

		// Later changes to the work do not unmake the commit, but are reported.
		actAs(ids.requesterUser);
		await admin.query("update work_period set deleted_at = now() where clock_in_id = $1", [
			command.operationId,
		]);
		expect((await lookup(command.operationId)).body).toMatchObject({
			outcome: "committed",
			evidence: "changed",
		});
		// A resend of a command whose evidence changed keeps the conflict behavior.
		expect((await submit(command)).body.code).toBe("collision");
		harness.userId = null;
		expect((await lookup(command.operationId)).status).toBe(401);
	});

	it("serializes concurrent identical submissions into one execution and one replay", async () => {
		const command = clockInCommand();
		const outcomes = await Promise.all([submit(command), submit(command)]);
		expect(outcomes.map(({ status }) => status).sort()).toEqual([200, 201]);
		const { rows } = await admin.query(
			"select count(*)::int as receipts from completed_work_operation where organization_id = $1",
			[ids.organization],
		);
		expect(only(rows)).toEqual({ receipts: 1 });
	});

	it("returns the committed clock-out to a retry whose target went stale in a race", async () => {
		const start = clockInCommand();
		await submit(start);
		harness.now = now.add({ hours: 2 });
		const close = clockOutCommand(
			{ clockInOperationId: start.operationId },
			{ occurredAt: harness.now.toString() },
		);
		let first: Awaited<ReturnType<typeof submit>> | undefined;
		// The identical request commits after this retry's replay check, so the
		// retry's preflight finds its target already closed.
		harness.beforeFreshPreflight = async () => {
			first = await submit(close);
		};

		const retry = await submit(close);

		expect(first?.status).toBe(201);
		expect(retry).toEqual({
			status: 200,
			body: { outcome: "replayed", operationId: close.operationId, receipt: first?.body.receipt },
		});
		const { rows } = await admin.query(
			"select count(*)::int as receipts from completed_work_operation where id = $1",
			[close.operationId],
		);
		expect(only(rows)).toEqual({ receipts: 1 });
	});

	it("serializes concurrent identical clock-outs into one closure", async () => {
		const start = clockInCommand();
		await submit(start);
		harness.now = now.add({ hours: 2 });
		const close = clockOutCommand(
			{ clockInOperationId: start.operationId },
			{ occurredAt: harness.now.toString() },
		);
		const outcomes = await Promise.all([submit(close), submit(close), submit(close)]);
		expect(outcomes.map(({ status }) => status).sort()).toEqual([200, 200, 201]);
		for (const { body } of outcomes) expect(body.receipt).toEqual(outcomes[0]?.body.receipt);
		const { rows } = await admin.query(
			`select count(*)::int as receipts, count(distinct wp.clock_out_id)::int as closures
			 from completed_work_operation r join work_period wp on wp.id = r.work_period_id
			 where r.id = $1`,
			[close.operationId],
		);
		expect(only(rows)).toEqual({ receipts: 1, closures: 1 });
	});

	it("deletes start receipts with the organization's time history", async () => {
		await submit(clockInCommand());
		await clearOrganizationTimeData(ids.organization);
		expect((await snapshot()).receipts).toBeNull();
	});

	it("recovers a committed legacy action id beyond the seven-day replay window", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		try {
			vi.setSystemTime(new Date("2026-09-20T10:00:00Z"));
			const actionId = randomUUID();
			const body = {
				id: actionId,
				type: "clock_in",
				timestamp: "2026-09-20T10:00:00.000Z",
				browserTimezone: "UTC",
				utcOffsetMinutes: 0,
				replay: true,
			};
			const post = async () => {
				const response = await legacyRoute.POST(
					new Request(`${server}/api/time-entries`, {
						method: "POST",
						body: JSON.stringify(body),
					}) as never,
				);
				return { status: response.status, body: await response.json() };
			};
			const committed = await post();
			expect(committed.status).toBe(201);
			const before = await snapshot();

			vi.setSystemTime(new Date("2026-09-28T10:00:00Z"));
			const recovered = await post();

			expect(recovered).toEqual(committed);
			expect(await snapshot()).toEqual(before);
		} finally {
			vi.useRealTimers();
		}
	});
});
