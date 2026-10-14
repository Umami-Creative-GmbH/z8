/**
 * #1225 contract of work records on PostgreSQL: amending completed work (times,
 * work attribution, or both) in both admissions through `applyWorkRecordChange`,
 * inside the real work transaction.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * Completed work is recorded through the real web clock-in and clock-out; the
 * period submission through the real submission service. Only the
 * request/session, billing provisioning, the Next cache and e-mail,
 * notification and delivery side channels are replaced.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1225-org",
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
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
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/lib/app-url", async (original) => ({
	...(await original<typeof import("@/lib/app-url")>()),
	getOrganizationBaseUrl: async () => "https://t1225.example.test",
}));
vi.mock("@/lib/email/email-service", async () =>
	(await import("@/test/integration-harness")).emailService(),
);
vi.mock("@/lib/notifications/triggers", async (original) =>
	(await import("@/test/integration-harness")).notificationTriggers(original),
);
vi.mock("@/lib/queue", async (original) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(original),
);
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("@/lib/notifications/notification-service", () => ({
	createNotification: async () => null,
}));

const { db } = await import("@/db");
const { clockIn, clockOut } = await import("@/app/[locale]/(app)/time-tracking/actions/clocking");
const { withCompletedWorkTransaction } = await import("../completed-work-transaction");
const { submitPeriodSubmission } = await import("../period-submissions/submission-service");
const { closeMonth } = await import("../closed-months/store");
const { applyWorkRecordChange, readWorkRecord } = await import(".");
const { expectRecordAgreement } = await import("./__tests__/expect-record-agreement");
const { calculateHash } = await import("../blockchain");
type AmendWorkRecord = import(".").AmendWorkRecord;
type DeleteWorkRecord = import(".").DeleteWorkRecord;
type DivideWorkRecord = import(".").DivideWorkRecord;
type WorkRecordExpected = import(".").WorkRecordExpected;

const ORG = "t1225-org";
const ids = {
	owner: "e1225000-0000-4000-8000-000000000001",
	manager: "e1225000-0000-4000-8000-000000000002",
	requester: "e1225000-0000-4000-8000-000000000003",
	project: "e1225000-0000-4000-8000-000000000021",
	customer: "e1225000-0000-4000-8000-000000000022",
	otherProject: "e1225000-0000-4000-8000-000000000023",
	task: "e1225000-0000-4000-8000-000000000024",
	costCenter: "e1225000-0000-4000-8000-000000000031",
	van: "e1225000-0000-4000-8000-000000000041",
} as const;
type Person = "owner" | "manager" | "requester";
const userOf = (person: Person) => `t1225-${person}`;
const SEEDED_AT = new Date("2026-06-01T00:00:00Z");
const WORK_START = parseInstant("2026-07-22T08:00:40Z");
const WORK_END = parseInstant("2026-07-22T17:00:31Z");
const BERLIN_SUMMER = {
	utcOffsetMinutes: 120,
	timezone: "Europe/Berlin",
	timezoneSource: "user_setting",
} as const;

const admin = integrationAdminPool();

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

async function cleanup() {
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query('delete from "user" where id like $1', ["t1225-%"]);
}

async function seed(appendControl: "active" | "inactive") {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values ($1, $1, $1, 'Europe/Berlin', $2)`,
		[ORG, SEEDED_AT],
	);
	const people: [Person, string, string][] = [
		["owner", "owner", "admin"],
		["manager", "member", "manager"],
		["requester", "member", "employee"],
	];
	for (const [person, memberRole, employeeRole] of people) {
		await admin.query(
			'insert into "user" (id, name, email, created_at, updated_at) values ($1, $1, $2, $3, $3)',
			[userOf(person), `${userOf(person)}@example.test`, SEEDED_AT],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ($1, $2, $3, $4, 'approved', $5)`,
			[`t1225-member-${person}`, ORG, userOf(person), memberRole, SEEDED_AT],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values ($1, $2, $3, $4, $5)`,
			[ids[person], userOf(person), ORG, employeeRole, SEEDED_AT],
		);
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 values ($1, 'en', 'Europe/Berlin', '24h', $2)`,
			[userOf(person), SEEDED_AT],
		);
	}
	await admin.query(
		`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
		 values ($1, $2, $3, true, $4)`,
		[randomUUID(), ids.requester, ids.manager, userOf("owner")],
	);
	await admin.query(
		`insert into customer (id, organization_id, name, created_by, updated_at)
		 values ($1, $2, 'Acme', $3, $4)`,
		[ids.customer, ORG, userOf("owner"), SEEDED_AT],
	);
	for (const [id, name, billableDefault] of [
		[ids.project, "Project", false],
		[ids.otherProject, "Other project", true],
	] as const) {
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, customer_id, billable_default, created_by, updated_at)
			 values ($1, $2, $3, 'active', true, $4, $5, $6, $7)`,
			[id, ORG, name, ids.customer, billableDefault, userOf("owner"), SEEDED_AT],
		);
		await admin.query(
			`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
			 values ($1, $2, $3, 'employee', $4, $5)`,
			[randomUUID(), id, ORG, ids.requester, userOf("owner")],
		);
	}
	await admin.query(
		`insert into project_task (id, organization_id, project_id, name, created_by, updated_at)
		 values ($1, $2, $3, 'Task', $4, $5)`,
		[ids.task, ORG, ids.project, userOf("owner"), SEEDED_AT],
	);
	await admin.query(
		`insert into cost_center (id, organization_id, name, updated_at) values ($1, $2, 'Cost centre', $3)`,
		[ids.costCenter, ORG, SEEDED_AT],
	);
	await admin.query(
		`insert into time_entry_append_control (organization_id, mode) values ($1, $2)`,
		[ORG, appendControl],
	);
}

/** Real clock-in and clock-out of the requester on the project, in the given zone. */
async function recordWork(
	start: Instant = WORK_START,
	end: Instant = WORK_END,
	zone = "Europe/Berlin",
) {
	harness.userId = userOf("requester");
	await expect(clockIn("office", { instant: start, browserTimezone: zone })).resolves.toMatchObject(
		{ success: true },
	);
	await expect(
		clockOut(ids.project, undefined, {
			submissionId: randomUUID(),
			instant: end,
			browserTimezone: zone,
		}),
	).resolves.toMatchObject({ success: true });
	const { rows } = await admin.query<{
		id: string;
		clock_in_id: string;
		clock_out_id: string;
		canonical_record_id: string;
		graph_revision: number;
	}>(
		`select id, clock_in_id, clock_out_id, canonical_record_id, graph_revision from work_period
		 where organization_id = $1 and start_time = $2 and deleted_at is null`,
		[ORG, new Date(start.epochMilliseconds)],
	);
	return only(rows);
}

/** Books the recorded work to the project's task, in both records. */
async function bookTask(period: { id: string; canonical_record_id: string }) {
	await admin.query("update work_period set task_id = $2 where id = $1", [period.id, ids.task]);
	await admin.query(
		"update time_record_allocation set task_id = $2 where record_id = $1 and allocation_kind = 'project'",
		[period.canonical_record_id, ids.task],
	);
}

function expectedOf(workPeriodId: string): Promise<WorkRecordExpected> {
	return withCompletedWorkTransaction(
		{ organizationId: ORG, employeeId: ids.requester, actorUserId: userOf("requester") },
		async (scope) => {
			const current = await readWorkRecord(scope, {
				organizationId: ORG,
				employeeId: ids.requester,
				workPeriodId,
			});
			if (!current) throw new Error("work not found");
			return current.expected;
		},
	);
}

const CORRECTION = {
	notes: "Forgot to clock in",
	entries: { createdBy: userOf("requester"), ipAddress: "203.0.113.7", deviceInfo: "t1225" },
	appendOperation: "completed_work_correction",
} as const;

function amend(
	expected: WorkRecordExpected,
	overrides: Omit<Partial<AmendWorkRecord>, "kind"> = {},
): AmendWorkRecord {
	return {
		kind: "amend",
		organizationId: ORG,
		employeeId: ids.requester,
		expected,
		actorUserId: userOf("requester"),
		...overrides,
	};
}

function retime(clockInAt: Instant | null, clockOutAt: Instant | null) {
	return {
		...CORRECTION,
		...(clockInAt ? { clockIn: { at: clockInAt, capture: BERLIN_SUMMER } } : {}),
		...(clockOutAt ? { clockOut: { at: clockOutAt, capture: BERLIN_SUMMER } } : {}),
	};
}

function apply(change: AmendWorkRecord | DeleteWorkRecord | DivideWorkRecord) {
	return withCompletedWorkTransaction(
		{ organizationId: ORG, employeeId: ids.requester, actorUserId: change.actorUserId },
		(scope) => applyWorkRecordChange(scope, change),
	);
}

/** Every row an amendment can write, to prove "nothing written" by equality. */
async function snapshot() {
	const { rows } = await admin.query(
		`select
		   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
		   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
		   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
		   (select json_agg(row_to_json(t) order by t.record_id) from time_record_work t where organization_id = $1) as works,
		   (select json_agg(row_to_json(t) order by t.id) from time_record_allocation t where organization_id = $1) as allocations,
		   (select json_agg(row_to_json(t) order by t.employee_id) from time_entry_append_position t where organization_id = $1) as positions,
		   (select json_agg(row_to_json(t) order by t.employee_id) from employee_work_balance t where organization_id = $1) as balances,
		   (select json_agg(row_to_json(t) order by t.id) from period_submission t where organization_id = $1) as submissions`,
		[ORG],
	);
	return only(rows);
}

async function workOf(workPeriodId: string) {
	const { rows } = await admin.query<{
		clock_in_id: string;
		clock_out_id: string;
		start_time: Date;
		end_time: Date;
		duration_minutes: number;
		graph_revision: number;
		project_id: string | null;
		task_id: string | null;
		is_billable: boolean;
		record_start: Date;
		record_end: Date;
		record_duration: number;
		record_updated_by: string | null;
		allocations: string[];
	}>(
		`select wp.clock_in_id, wp.clock_out_id, wp.start_time, wp.end_time, wp.duration_minutes,
		        wp.graph_revision, wp.project_id, wp.task_id, wp.is_billable,
		        tr.start_at as record_start, tr.end_at as record_end, tr.duration_minutes as record_duration,
		        tr.updated_by as record_updated_by,
		        (select array_agg(a.allocation_kind || ':' || coalesce(a.project_id::text, a.cost_center_id::text)
		           || ':' || coalesce(a.task_id::text, '-') || ':' || a.is_billable
		           order by a.allocation_kind::text) from time_record_allocation a where a.record_id = tr.id) as allocations
		 from work_period wp join time_record tr on tr.id = wp.canonical_record_id
		 where wp.id = $1`,
		[workPeriodId],
	);
	return only(rows);
}

async function submitWeek() {
	await admin.query(
		`insert into period_submission_cadence_change
		 (id, organization_id, cadence, week_start_day, changed_at, changed_by)
		 values ($1, $2, 'weekly', 'monday', '2026-06-01T00:00:00Z', $3)`,
		[randomUUID(), ORG, userOf("owner")],
	);
	const submitted = await submitPeriodSubmission(
		{ organizationId: ORG, userId: userOf("requester"), periodStartDate: "2026-07-20" },
		{ database: db, clock: { nowInstant: () => parseInstant("2026-07-26T12:00:00Z") } },
	);
	if (submitted.kind !== "submitted") throw new Error(`not submitted: ${submitted.reason}`);
	return async () => {
		const { rows } = await admin.query(
			"select status, closed_cause from period_submission where organization_id = $1 and id = $2",
			[ORG, submitted.submissionId],
		);
		return only(rows);
	};
}

/**
 * A correction entry recorded while its change waits for approval, as a time
 * correction submission records it: chained after the latest entry, superseded
 * (inactive) and replacing the endpoint.
 */
async function recordPendingCorrection(
	period: { clock_in_id: string; clock_out_id: string },
	at: string,
	endpoint: "clock_in" | "clock_out" = "clock_in",
): Promise<string> {
	const id = randomUUID();
	const { rows } = await admin.query<{ id: string; hash: string }>(
		`select id, hash from time_entry where organization_id = $1 and employee_id = $2
		 order by created_at desc, id desc limit 1`,
		[ORG, ids.requester],
	);
	const { id: previousEntryId, hash: previousHash } = only(rows);
	const hash = calculateHash({
		employeeId: ids.requester,
		type: "correction",
		timestamp: new Date(at).toISOString(),
		previousHash,
	});
	await admin.query(
		`insert into time_entry (id, employee_id, organization_id, type, timestamp, hash, previous_hash,
		   previous_entry_id, replaces_entry_id, is_superseded, notes, created_by, utc_offset_minutes,
		   timezone, timezone_source)
		 values ($1, $2, $3, 'correction', $4, $5, $6, $7, $8, true, 'Pending correction', $9, 120,
		         'Europe/Berlin', 'user_setting')`,
		[
			id,
			ids.requester,
			ORG,
			new Date(at),
			hash,
			previousHash,
			previousEntryId,
			endpoint === "clock_in" ? period.clock_in_id : period.clock_out_id,
			userOf("requester"),
		],
	);
	// The submission records it on the append position, where there is one.
	await admin.query(
		`update time_entry_append_position
		 set tip_entry_id = $3, tip_hash = $4, entry_count = entry_count + 1, version = version + 1
		 where organization_id = $1 and employee_id = $2`,
		[ORG, ids.requester, id, hash],
	);
	return id;
}

async function driveVan(period: { id: string; canonical_record_id: string }) {
	await admin.query(
		`insert into vehicle_use_setting (organization_id, enabled) values ($1, true)
		 on conflict (organization_id) do update set enabled = excluded.enabled`,
		[ORG],
	);
	await admin.query(
		`insert into organization_vehicle (id, organization_id, name, licence_plate)
		 values ($1, $2, 'Van', 'B-VN 1225')`,
		[ids.van, ORG],
	);
	for (const [table, key, id] of [
		["work_period", "id", period.id],
		["time_record_work", "record_id", period.canonical_record_id],
	] as const) {
		await admin.query(
			`update ${table} set vehicle_kind = 'organization', vehicle_id = $2,
			   odometer_start_km = 12000, odometer_end_km = null, driven_distance_km = null
			 where ${key} = $1`,
			[id, ids.van],
		);
	}
}

/**
 * The one contract in both admissions. Only the admission's writer differs:
 * append admission rounds new times half up and advances the append position;
 * legacy admission floors them and chains after the latest entry.
 */
const ADMISSIONS = [
	// 07:30:20-17:00:31 is 9h30m11s; 08:00:40-16:30:50 is 8h30m10s.
	{ admission: "append", appendControl: "active", retimed: 570, clockOutMoved: 510 },
	{ admission: "legacy", appendControl: "inactive", retimed: 570, clockOutMoved: 510 },
] as const;

describe.each(ADMISSIONS)(
	"work records: amend in $admission admission on PostgreSQL (#1225)",
	amendContract,
);

function amendContract({
	admission,
	appendControl,
	retimed,
	clockOutMoved,
}: (typeof ADMISSIONS)[number]) {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

	beforeEach(async () => {
		await seed(appendControl);
	});

	afterAll(async () => {
		await cleanup();
	});

	it("moves the times of both records with replacing corrections, in agreement", async () => {
		const source = await recordWork();
		const expected = await expectedOf(source.id);

		const result = await apply(
			amend(expected, {
				times: retime(parseInstant("2026-07-22T07:30:20Z"), null),
			}),
		);

		await expectRecordAgreement({ organizationId: ORG });
		if (result.kind !== "amended") throw new Error(`refused: ${result.kind}`);
		const work = await workOf(source.id);
		expect(work).toMatchObject({
			clock_out_id: source.clock_out_id,
			start_time: new Date("2026-07-22T07:30:20Z"),
			end_time: new Date("2026-07-22T17:00:31Z"),
			duration_minutes: retimed,
			graph_revision: source.graph_revision + 1,
			record_start: new Date("2026-07-22T07:30:20Z"),
			record_duration: retimed,
			record_updated_by: userOf("requester"),
		});
		expect(work.clock_in_id).not.toBe(source.clock_in_id);
		const { rows: entries } = await admin.query(
			`select id, type, replaces_entry_id, is_superseded, superseded_by_id, notes, utc_offset_minutes,
			        ip_address, created_by, previous_entry_id
			 from time_entry where id = any($1::uuid[]) order by created_at, id`,
			[[source.clock_in_id, work.clock_in_id]],
		);
		expect(entries).toEqual([
			expect.objectContaining({
				id: source.clock_in_id,
				is_superseded: true,
				superseded_by_id: work.clock_in_id,
			}),
			expect.objectContaining({
				id: work.clock_in_id,
				type: "correction",
				replaces_entry_id: source.clock_in_id,
				is_superseded: false,
				notes: "Forgot to clock in",
				utc_offset_minutes: 120,
				ip_address: "203.0.113.7",
				created_by: userOf("requester"),
				// The clock-out was the employee's latest entry, in either admission's chain.
				previous_entry_id: source.clock_out_id,
			}),
		]);
		expect(result).toMatchObject({
			changes: { clockIn: true, clockOut: false, attribution: [] },
			source: { revision: source.graph_revision, segment: { durationMinutes: 540 } },
			segment: { clockInEntryId: work.clock_in_id, durationMinutes: retimed },
			after: { workPeriodId: source.id, revision: source.graph_revision + 1 },
			appended: {
				admission,
				corrections: [
					{ endpoint: "clock_in", entryId: work.clock_in_id, replacesEntryId: source.clock_in_id },
				],
			},
		});
	});

	it("adopts a recorded correction entry by reference instead of appending it again (#1226)", async () => {
		const source = await recordWork();
		const pending = await recordPendingCorrection(source, "2026-07-22T07:30:20Z");
		const expected = await expectedOf(source.id);
		const before = await snapshot();

		const result = await apply(
			amend(expected, { times: { ...CORRECTION, clockIn: { adopt: pending } } }),
		);

		await expectRecordAgreement({ organizationId: ORG });
		if (result.kind !== "amended") throw new Error(`refused: ${result.kind}`);
		expect(await workOf(source.id)).toMatchObject({
			clock_in_id: pending,
			start_time: new Date("2026-07-22T07:30:20Z"),
			duration_minutes: retimed,
			graph_revision: source.graph_revision + 1,
			record_start: new Date("2026-07-22T07:30:20Z"),
			record_duration: retimed,
		});
		const { rows: entries } = await admin.query(
			`select id, is_superseded, superseded_by_id from time_entry where id = any($1::uuid[]) order by created_at, id`,
			[[source.clock_in_id, pending]],
		);
		expect(entries).toEqual([
			{ id: source.clock_in_id, is_superseded: true, superseded_by_id: pending },
			{ id: pending, is_superseded: false, superseded_by_id: null },
		]);
		// Nothing is appended: the entry count and the append position stay.
		const after = await snapshot();
		expect(after.entries).toHaveLength(before.entries.length);
		expect(after.positions).toEqual(before.positions);
		expect(result).toMatchObject({
			changes: { clockIn: true, clockOut: false },
			appended: {
				admission,
				corrections: [
					{
						endpoint: "clock_in",
						entryId: pending,
						replacesEntryId: source.clock_in_id,
						adopted: true,
					},
				],
				entries: [{ id: pending }],
			},
		});
	});

	it("adopts one endpoint and appends the other in one change (#1226)", async () => {
		const source = await recordWork();
		const pending = await recordPendingCorrection(source, "2026-07-22T07:30:20Z");

		const result = await apply(
			amend(await expectedOf(source.id), {
				times: {
					...CORRECTION,
					clockIn: { adopt: pending },
					clockOut: { at: parseInstant("2026-07-22T16:30:50Z"), capture: BERLIN_SUMMER },
				},
			}),
		);

		await expectRecordAgreement({ organizationId: ORG });
		if (result.kind !== "amended") throw new Error(`refused: ${result.kind}`);
		expect(result.appended.corrections).toEqual([
			expect.objectContaining({ endpoint: "clock_in", entryId: pending, adopted: true }),
			expect.objectContaining({
				endpoint: "clock_out",
				replacesEntryId: source.clock_out_id,
				adopted: false,
			}),
		]);
		const work = await workOf(source.id);
		expect(work).toMatchObject({
			clock_in_id: pending,
			end_time: new Date("2026-07-22T16:30:50Z"),
		});
		expect(work.clock_out_id).toBe(result.appended.corrections[1]?.entryId);
	});

	it("refuses to adopt an entry that is not a pending correction of the endpoint (#1226)", async () => {
		const source = await recordWork();
		const ofClockOut = await recordPendingCorrection(source, "2026-07-22T16:00:00Z", "clock_out");
		const expected = await expectedOf(source.id);
		const before = await snapshot();

		await expect(
			apply(amend(expected, { times: { ...CORRECTION, clockIn: { adopt: ofClockOut } } })),
		).resolves.toEqual({ kind: "adopted_entry_mismatch" });
		await expect(
			apply(amend(expected, { times: { ...CORRECTION, clockIn: { adopt: source.clock_out_id } } })),
		).resolves.toEqual({ kind: "adopted_entry_mismatch" });
		expect(await snapshot()).toEqual(before);
	});

	it("rounds new times in the admission's arithmetic", async () => {
		const source = await recordWork();
		const result = await apply(
			amend(await expectedOf(source.id), {
				times: retime(null, parseInstant("2026-07-22T16:30:50Z")),
			}),
		);
		if (result.kind !== "amended") throw new Error(`refused: ${result.kind}`);
		// 08:00:40-16:30:50 is 8h30m10s in either arithmetic.
		expect(await workOf(source.id)).toMatchObject({ duration_minutes: clockOutMoved });
		const half = await apply(
			amend(result.after, { times: retime(null, parseInstant("2026-07-22T16:31:10Z")) }),
		);
		if (half.kind !== "amended") throw new Error(`refused: ${half.kind}`);
		// 8h30m30s: append rounds half up, legacy floors.
		expect((await workOf(source.id)).duration_minutes).toBe(admission === "append" ? 511 : 510);
		await expectRecordAgreement({ organizationId: ORG });
	});

	it("changes the project; the task follows and the new project's billable default applies", async () => {
		const source = await recordWork();
		await bookTask(source);
		await admin.query(
			`insert into time_record_allocation (organization_id, record_id, allocation_kind, cost_center_id, weight_percent)
			 values ($1, $2, 'cost_center', $3, 100)`,
			[ORG, source.canonical_record_id, ids.costCenter],
		);
		const before = await snapshot();

		const result = await apply(
			amend(await expectedOf(source.id), { attribution: { project: ids.otherProject } }),
		);

		await expectRecordAgreement({ organizationId: ORG });
		if (result.kind !== "amended") throw new Error(`refused: ${result.kind}`);
		expect(await workOf(source.id)).toMatchObject({
			clock_in_id: source.clock_in_id,
			clock_out_id: source.clock_out_id,
			duration_minutes: 540,
			graph_revision: source.graph_revision + 1,
			project_id: ids.otherProject,
			task_id: null,
			is_billable: true,
			allocations: [`cost_center:${ids.costCenter}:-:false`, `project:${ids.otherProject}:-:true`],
		});
		expect(result).toMatchObject({
			changes: { clockIn: false, clockOut: false, attribution: ["project", "task", "billable"] },
			appended: { corrections: [], entries: [] },
		});
		// Attribution alone appends no entry and leaves the append position alone.
		const after = await snapshot();
		expect([after.entries, after.positions]).toEqual([before.entries, before.positions]);
	});

	it("keeps the task on the same project and refuses billable work without a customer", async () => {
		const source = await recordWork();
		await bookTask(source);
		const result = await apply(
			amend(await expectedOf(source.id), { attribution: { billable: true } }),
		);
		if (result.kind !== "amended") throw new Error(`refused: ${result.kind}`);
		expect(await workOf(source.id)).toMatchObject({ task_id: ids.task, is_billable: true });
		expect(result.changes.attribution).toEqual(["billable"]);

		await admin.query(
			"update project set customer_id = null, billable_default = false where id = $1",
			[ids.project],
		);
		const before = await snapshot();
		await expect(
			apply(amend(result.after, { attribution: { billable: true, workCategoryId: null } })),
		).rejects.toMatchObject({ name: "BillableWorkRefusedError", reason: "no_customer" });
		expect(await snapshot()).toEqual(before);
	});

	it("changes times and attribution together in one revision step with one send-back", async () => {
		const source = await recordWork();
		const submission = await submitWeek();

		const result = await apply(
			amend(await expectedOf(source.id), {
				times: retime(parseInstant("2026-07-22T07:30:20Z"), parseInstant("2026-07-22T16:30:50Z")),
				attribution: { project: null, workLocationType: "home" },
			}),
		);

		await expectRecordAgreement({ organizationId: ORG });
		if (result.kind !== "amended") throw new Error(`refused: ${result.kind}`);
		expect(await workOf(source.id)).toMatchObject({
			graph_revision: source.graph_revision + 1,
			start_time: new Date("2026-07-22T07:30:20Z"),
			end_time: new Date("2026-07-22T16:30:50Z"),
			project_id: null,
			is_billable: false,
			allocations: null,
		});
		expect(result.changes).toEqual({
			clockIn: true,
			clockOut: true,
			attribution: ["project", "work_location"],
			approval: false,
		});
		expect(result.appended.corrections.map(({ endpoint }) => endpoint)).toEqual([
			"clock_in",
			"clock_out",
		]);
		expect(await submission()).toEqual({ status: "withdrawn", closed_cause: "change" });
	});

	it("sends the period back for vehicle use alone (ADR 0009)", async () => {
		const source = await recordWork();
		await driveVan(source);
		const submission = await submitWeek();

		const result = await apply(
			amend(await expectedOf(source.id), {
				attribution: {
					vehicleUse: {
						vehicle: { kind: "organization", vehicleId: ids.van },
						startKm: 12_000,
						endKm: 12_085,
						distanceKm: 85,
					},
				},
			}),
		);

		await expectRecordAgreement({ organizationId: ORG });
		expect(result).toMatchObject({ kind: "amended", changes: { attribution: ["vehicle_use"] } });
		expect(await submission()).toEqual({ status: "withdrawn", closed_cause: "change" });
	});

	it("refuses a change of nothing, e.g. notes alone, without writing or sending back", async () => {
		const source = await recordWork();
		const submission = await submitWeek();
		const expected = await expectedOf(source.id);
		const before = await snapshot();

		await expect(
			apply(
				amend(expected, {
					times: { ...CORRECTION, clockOut: { at: WORK_END, capture: BERLIN_SUMMER } },
					attribution: { project: ids.project },
				}),
			),
		).resolves.toEqual({ kind: "unchanged" });
		expect(await snapshot()).toEqual(before);
		expect(await submission()).toEqual({ status: "pending", closed_cause: null });
	});

	it("marks the work balance dirty from each entry's own offset", async () => {
		// New York 2026-07-10 22:00 to 2026-07-11 00:30 (UTC 07-11 02:00 to 04:30).
		const source = await recordWork(
			parseInstant("2026-07-11T02:00:00Z"),
			parseInstant("2026-07-11T04:30:00Z"),
			"America/New_York",
		);
		await admin.query(
			"update employee_work_balance set is_dirty = false, dirty_from_date = null where employee_id = $1",
			[ids.requester],
		);

		const result = await apply(
			amend(await expectedOf(source.id), { attribution: { workLocationType: "home" } }),
		);

		expect(result).toMatchObject({ effects: { workBalanceDirtyFromDate: "2026-07-10" } });
		const { rows } = await admin.query(
			"select is_dirty, dirty_from_date::text from employee_work_balance where employee_id = $1",
			[ids.requester],
		);
		expect(only(rows)).toEqual({ is_dirty: true, dirty_from_date: "2026-07-10" });
	});

	it("chains a second change through the returned expected state; the earlier one is stale", async () => {
		const source = await recordWork();
		const expected = await expectedOf(source.id);
		const first = await apply(amend(expected, { attribution: { workLocationType: "home" } }));
		if (first.kind !== "amended") throw new Error(`refused: ${first.kind}`);

		await expect(
			apply(amend(first.after, { times: retime(null, parseInstant("2026-07-22T16:00:00Z")) })),
		).resolves.toMatchObject({ kind: "amended" });

		const before = await snapshot();
		await expect(apply(amend(expected, { attribution: { project: null } }))).resolves.toEqual({
			kind: "stale",
			current: { revision: source.graph_revision + 2 },
		});
		expect(await snapshot()).toEqual(before);
		await expectRecordAgreement({ organizationId: ORG });
	});

	it("refuses a pair that disagrees as canonical_divergence without writing", async () => {
		const source = await recordWork();
		await admin.query(
			"update time_record_allocation set is_billable = true where record_id = $1 and allocation_kind = 'project'",
			[source.canonical_record_id],
		);
		const expected = await expectedOf(source.id);
		const before = await snapshot();

		await expect(
			apply(amend(expected, { attribution: { workLocationType: "home" } })),
		).resolves.toEqual({
			kind: "canonical_divergence",
			found: "locked_pair",
			disagreements: ["billable"],
		});
		expect(await snapshot()).toEqual(before);
	});

	it("refuses new times that do not end after they start, and occupied times, without writing", async () => {
		const source = await recordWork();
		const other = await recordWork(
			parseInstant("2026-07-22T18:00:00Z"),
			parseInstant("2026-07-22T19:00:00Z"),
		);
		const expected = await expectedOf(source.id);
		const before = await snapshot();

		await expect(
			apply(amend(expected, { times: retime(parseInstant("2026-07-22T17:30:00Z"), null) })),
		).resolves.toEqual({ kind: "interval_invalid" });
		await expect(
			apply(amend(expected, { times: retime(null, parseInstant("2026-07-22T18:30:00Z")) })),
		).resolves.toMatchObject({ kind: "work_occupied", occupants: [{ id: other.id }] });
		expect(await snapshot()).toEqual(before);
	});

	it("counts live work as occupying from its start onward", async () => {
		const source = await recordWork();
		harness.userId = userOf("requester");
		await expect(
			clockIn("office", {
				instant: parseInstant("2026-07-22T19:00:00Z"),
				browserTimezone: "Europe/Berlin",
			}),
		).resolves.toMatchObject({ success: true });
		const expected = await expectedOf(source.id);
		const before = await snapshot();

		await expect(
			apply(amend(expected, { times: retime(null, parseInstant("2026-07-22T21:00:00Z")) })),
		).resolves.toMatchObject({ kind: "work_occupied" });
		expect(await snapshot()).toEqual(before);
	});

	it("refuses work without a canonical work record instead of rebuilding it", async () => {
		const source = await recordWork();
		await admin.query("update work_period set canonical_record_id = null where id = $1", [
			source.id,
		]);
		const expected = await expectedOf(source.id);
		const before = await snapshot();

		await expect(
			apply(amend(expected, { attribution: { workLocationType: "home" } })),
		).resolves.toEqual({ kind: "canonical_record_missing" });
		expect(await snapshot()).toEqual(before);
	});

	it("returns month_closed from the pre-check without writing", async () => {
		const source = await recordWork();
		const expected = await expectedOf(source.id);
		const closed = await closeMonth(db, {
			organizationId: ORG,
			month: "2026-07",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: userOf("owner") },
			now: parseInstant("2026-08-03T09:00:00Z"),
		});
		expect(closed.kind).toBe("closed");
		const before = await snapshot();

		await expect(
			apply(amend(expected, { attribution: { workLocationType: "home" } })),
		).resolves.toEqual({ kind: "month_closed", month: "2026-07" });
		expect(await snapshot()).toEqual(before);
	});

	it(
		admission === "legacy"
			? "amends a legacy split's generated half, whose clock-out the split superseded"
			: "refuses an endpoint another correction superseded",
		async () => {
			const source = await recordWork();
			const divided = await apply({
				kind: "divide",
				organizationId: ORG,
				employeeId: ids.requester,
				expected: await expectedOf(source.id),
				at: parseInstant("2026-07-22T12:00:00Z"),
				notes: { before: "Morning", after: null },
				actorUserId: userOf("requester"),
				entries: {
					createdBy: userOf("requester"),
					ipAddress: null,
					deviceInfo: null,
					capture: BERLIN_SUMMER,
				},
				appendOperation: "completed_work_split",
			});
			if (divided.kind !== "divided") throw new Error(`refused: ${divided.kind}`);
			if (admission === "append") {
				await admin.query("update time_entry set is_superseded = true where id = $1", [
					source.clock_out_id,
				]);
			}

			const result = await apply(
				amend(divided.generated.after, {
					times: retime(null, parseInstant("2026-07-22T16:00:00Z")),
				}),
			);

			if (admission === "append") {
				expect(result).toEqual({ kind: "endpoint_superseded" });
				return;
			}
			await expectRecordAgreement({ organizationId: ORG });
			expect(result).toMatchObject({
				kind: "amended",
				appended: {
					corrections: [{ endpoint: "clock_out", replacesEntryId: source.clock_out_id }],
				},
			});
			// The split's clock-out keeps superseding the source clock-out.
			const { rows } = await admin.query("select superseded_by_id from time_entry where id = $1", [
				source.clock_out_id,
			]);
			expect(only(rows)).toEqual({
				superseded_by_id: divided.retained.segment.clockOutEntryId,
			});
		},
	);

	describe("the approval state (#1227)", () => {
		/** Work awaiting a decision, as a manual entry needing approval leaves it. */
		async function pendingWork() {
			const source = await recordWork();
			await admin.query(
				`update work_period set approval_status = 'pending', pending_changes = '{"ordinarySubmission":{}}'
				 where id = $1`,
				[source.id],
			);
			await admin.query("update time_record set approval_state = 'pending' where id = $1", [
				source.canonical_record_id,
			]);
			await admin.query(
				"update employee_work_balance set is_dirty = false, dirty_from_date = null where employee_id = $1",
				[ids.requester],
			);
			return source;
		}

		async function approvalOf(source: { id: string; canonical_record_id: string }) {
			const { rows } = await admin.query(
				`select wp.approval_status, wp.pending_changes, wp.graph_revision, tr.approval_state,
				        tr.updated_by
				 from work_period wp join time_record tr on tr.id = wp.canonical_record_id
				 where wp.id = $1`,
				[source.id],
			);
			return only(rows);
		}

		it.each(["approved", "rejected"] as const)(
			"decides %s on both records in one revision step, with the effects",
			async (decision) => {
				const source = await pendingWork();
				const before = await snapshot();

				const result = await apply(
					amend(await expectedOf(source.id), {
						approval: decision,
						actorUserId: userOf("manager"),
					}),
				);

				await expectRecordAgreement({ organizationId: ORG });
				if (result.kind !== "amended") throw new Error(`refused: ${result.kind}`);
				expect(result.changes).toEqual({
					clockIn: false,
					clockOut: false,
					attribution: [],
					approval: true,
				});
				expect(result.source).toMatchObject({
					approvalState: "pending",
					recordApprovalState: "pending",
				});
				expect(await approvalOf(source)).toEqual({
					approval_status: decision,
					pending_changes: null,
					graph_revision: source.graph_revision + 1,
					approval_state: decision,
					updated_by: userOf("manager"),
				});
				// The decision changes what the balance counts; it appends nothing.
				const { rows } = await admin.query(
					"select is_dirty, dirty_from_date::text from employee_work_balance where employee_id = $1",
					[ids.requester],
				);
				expect(only(rows)).toEqual({ is_dirty: true, dirty_from_date: "2026-07-22" });
				const after = await snapshot();
				expect([after.entries, after.positions]).toEqual([before.entries, before.positions]);
			},
		);

		it("decides together with adopted times and attribution in one change", async () => {
			const source = await pendingWork();
			const pending = await recordPendingCorrection(source, "2026-07-22T07:30:20Z");

			const result = await apply(
				amend(await expectedOf(source.id), {
					times: { ...CORRECTION, clockIn: { adopt: pending } },
					attribution: { workLocationType: "home" },
					approval: "approved",
				}),
			);

			await expectRecordAgreement({ organizationId: ORG });
			expect(result).toMatchObject({
				kind: "amended",
				changes: { clockIn: true, attribution: ["work_location"], approval: true },
			});
			expect(await approvalOf(source)).toMatchObject({
				approval_status: "approved",
				approval_state: "approved",
				graph_revision: source.graph_revision + 1,
			});
		});

		it("refuses a decision the work already holds as unchanged, writing nothing", async () => {
			const source = await recordWork();
			const before = await snapshot();

			await expect(
				apply(amend(await expectedOf(source.id), { approval: "approved" })),
			).resolves.toEqual({ kind: "unchanged" });
			expect(await snapshot()).toEqual(before);
		});

		it("rewrites tolerated minutes drift of the record only when the change tolerates it", async () => {
			const source = await pendingWork();
			await admin.query("update time_record set duration_minutes = 600 where id = $1", [
				source.canonical_record_id,
			]);
			const expected = await expectedOf(source.id);
			const before = await snapshot();

			await expect(apply(amend(expected, { approval: "approved" }))).resolves.toEqual({
				kind: "canonical_divergence",
				found: "locked_pair",
				disagreements: ["duration"],
			});
			expect(await snapshot()).toEqual(before);

			await expect(
				apply(amend(expected, { approval: "approved", toleratedDrift: ["duration"] })),
			).resolves.toMatchObject({ kind: "amended" });
			await expectRecordAgreement({ organizationId: ORG });
			expect((await workOf(source.id)).record_duration).toBe(540);
		});
	});
}

describe.each(ADMISSIONS)(
	"work records: delete in $admission admission on PostgreSQL (#1227)",
	deleteContract,
);

/**
 * The soft delete of an approved business deletion. It shares the amend
 * harness: completed work recorded through the real clock-in and clock-out,
 * and the deletion's markers recorded as pending corrections.
 */
function deleteContract({ appendControl }: (typeof ADMISSIONS)[number]) {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const MARKER = "2026-07-22T17:00:31Z";

	beforeEach(async () => {
		await seed(appendControl);
	});

	afterAll(async () => {
		await cleanup();
	});

	async function markers(source: { clock_in_id: string; clock_out_id: string }) {
		const clockIn = await recordPendingCorrection(source, MARKER, "clock_in");
		const clockOut = await recordPendingCorrection(source, MARKER, "clock_out");
		return { clockIn: { adopt: clockIn }, clockOut: { adopt: clockOut } };
	}

	function remove(
		expected: WorkRecordExpected,
		marked: DeleteWorkRecord["markers"],
		overrides: Partial<DeleteWorkRecord> = {},
	): DeleteWorkRecord {
		return {
			kind: "delete",
			organizationId: ORG,
			employeeId: ids.requester,
			expected,
			markers: marked,
			deletion: {
				at: parseInstant("2026-07-25T09:00:00Z"),
				reason: "Recorded by mistake",
				approvalRequestId: null,
			},
			actorUserId: userOf("manager"),
			...overrides,
		};
	}

	it("soft-deletes the work as a zero-length sentinel at the adopted markers, with the effects", async () => {
		const source = await recordWork();
		const marked = await markers(source);
		const submission = await submitWeek();
		await admin.query(
			"update employee_work_balance set is_dirty = false, dirty_from_date = null where employee_id = $1",
			[ids.requester],
		);
		const before = await snapshot();

		const result = await apply(remove(await expectedOf(source.id), marked));

		if (result.kind !== "deleted") throw new Error(`refused: ${result.kind}`);
		const { rows } = await admin.query(
			`select wp.clock_in_id, wp.clock_out_id, wp.start_time, wp.end_time, wp.duration_minutes,
			        wp.graph_revision, wp.deleted_at, wp.deleted_by, wp.deletion_reason,
			        wp.deletion_approval_request_id, wp.project_id, wp.approval_status,
			        tr.start_at as record_start, tr.end_at as record_end,
			        tr.duration_minutes as record_duration, tr.approval_state
			 from work_period wp join time_record tr on tr.id = wp.canonical_record_id
			 where wp.id = $1`,
			[source.id],
		);
		expect(only(rows)).toEqual({
			clock_in_id: marked.clockIn.adopt,
			clock_out_id: marked.clockOut.adopt,
			start_time: new Date(MARKER),
			end_time: new Date(MARKER),
			duration_minutes: 0,
			graph_revision: source.graph_revision + 1,
			deleted_at: new Date("2026-07-25T09:00:00Z"),
			deleted_by: userOf("manager"),
			deletion_reason: "Recorded by mistake",
			deletion_approval_request_id: null,
			project_id: ids.project,
			approval_status: "approved",
			record_start: new Date(MARKER),
			record_end: new Date(MARKER),
			record_duration: 0,
			approval_state: "approved",
		});
		const { rows: entries } = await admin.query(
			`select id, is_superseded, superseded_by_id from time_entry
			 where id = any($1::uuid[]) order by created_at, id`,
			[[source.clock_in_id, source.clock_out_id]],
		);
		expect(entries).toEqual([
			{ id: source.clock_in_id, is_superseded: true, superseded_by_id: marked.clockIn.adopt },
			{ id: source.clock_out_id, is_superseded: true, superseded_by_id: marked.clockOut.adopt },
		]);
		expect(result).toMatchObject({
			source: { revision: source.graph_revision, segment: { durationMinutes: 540 } },
			sentinel: { clockInEntryId: marked.clockIn.adopt, durationMinutes: 0 },
			revision: source.graph_revision + 1,
			appended: {
				corrections: [
					{ endpoint: "clock_in", entryId: marked.clockIn.adopt, adopted: true },
					{ endpoint: "clock_out", entryId: marked.clockOut.adopt, adopted: true },
				],
			},
			effects: { workBalanceDirtyFromDate: "2026-07-22" },
		});
		// Nothing is appended; the deleted work no longer counts for the submitted week.
		const after = await snapshot();
		expect([after.entries.length, after.positions]).toEqual([
			before.entries.length,
			before.positions,
		]);
		expect(await submission()).toEqual({ status: "withdrawn", closed_cause: "change" });
		await expectRecordAgreement({ organizationId: ORG });
		// The interval is free again.
		await recordWork(parseInstant("2026-07-22T09:00:00Z"), parseInstant("2026-07-22T10:00:00Z"));
	});

	it("refuses markers that are not pending corrections of the endpoints, writing nothing", async () => {
		const source = await recordWork();
		const marked = await markers(source);
		const expected = await expectedOf(source.id);
		const before = await snapshot();

		await expect(
			apply(remove(expected, { clockIn: marked.clockOut, clockOut: marked.clockIn })),
		).resolves.toEqual({ kind: "adopted_entry_mismatch" });
		await expect(
			apply(remove({ ...expected, revision: expected.revision + 1 }, marked)),
		).resolves.toMatchObject({ kind: "stale" });
		expect(await snapshot()).toEqual(before);
	});

	it("returns month_closed from the pre-check without writing", async () => {
		const source = await recordWork();
		const marked = await markers(source);
		const expected = await expectedOf(source.id);
		await closeMonth(db, {
			organizationId: ORG,
			month: "2026-07",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: userOf("owner") },
			now: parseInstant("2026-08-03T09:00:00Z"),
		});
		const before = await snapshot();

		await expect(apply(remove(expected, marked))).resolves.toEqual({
			kind: "month_closed",
			month: "2026-07",
		});
		expect(await snapshot()).toEqual(before);
	});
}
