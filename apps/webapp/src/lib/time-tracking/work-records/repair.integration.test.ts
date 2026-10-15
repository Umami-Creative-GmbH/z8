/**
 * #1226 contract of work records on PostgreSQL: attaching a canonical work
 * record to completed work that has none, and repairing a pair whose records
 * disagree or miss a value, in both admissions through `applyWorkRecordChange`,
 * inside the real work transaction.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * Completed work is recorded through the real web clock-in and clock-out; the
 * period submission through the real submission service. The historical damage
 * each case repairs is written with SQL, as history left it.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { asHistory } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1226-org",
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
	getOrganizationBaseUrl: async () => "https://t1226.example.test",
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
type AttachWorkRecord = import(".").AttachWorkRecord;
type RepairWorkRecord = import(".").RepairWorkRecord;
type WorkRecordExpected = import(".").WorkRecordExpected;

const ORG = "t1226-org";
const ids = {
	owner: "e1226000-0000-4000-8000-000000000001",
	manager: "e1226000-0000-4000-8000-000000000002",
	requester: "e1226000-0000-4000-8000-000000000003",
	project: "e1226000-0000-4000-8000-000000000021",
	customer: "e1226000-0000-4000-8000-000000000022",
	otherProject: "e1226000-0000-4000-8000-000000000023",
	task: "e1226000-0000-4000-8000-000000000024",
	category: "e1226000-0000-4000-8000-000000000025",
	van: "e1226000-0000-4000-8000-000000000041",
} as const;
type Person = "owner" | "manager" | "requester";
const userOf = (person: Person) => `t1226-${person}`;
const SEEDED_AT = new Date("2026-06-01T00:00:00Z");
const WORK_START = parseInstant("2026-07-22T08:00:40Z");
const WORK_END = parseInstant("2026-07-22T17:00:31Z");

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
	await admin.query('delete from "user" where id like $1', ["t1226-%"]);
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
			[`t1226-member-${person}`, ORG, userOf(person), memberRole, SEEDED_AT],
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
		`insert into work_category (id, organization_id, name, factor, created_by, updated_at)
		 values ($1, $2, 'Travel', '1.00', $3, $4)`,
		[ids.category, ORG, userOf("owner"), SEEDED_AT],
	);
	await admin.query(
		`insert into time_entry_append_control (organization_id, mode) values ($1, $2)`,
		[ORG, appendControl],
	);
}

type RecordedWork = {
	id: string;
	clock_in_id: string;
	clock_out_id: string;
	canonical_record_id: string;
	graph_revision: number;
};

/** Real clock-in and clock-out of the requester on the project. */
async function recordWork(start: Instant = WORK_START, end: Instant = WORK_END) {
	harness.userId = userOf("requester");
	await expect(
		clockIn("office", { instant: start, browserTimezone: "Europe/Berlin" }),
	).resolves.toMatchObject({ success: true });
	await expect(
		clockOut(ids.project, undefined, {
			submissionId: randomUUID(),
			instant: end,
			browserTimezone: "Europe/Berlin",
		}),
	).resolves.toMatchObject({ success: true });
	const { rows } = await admin.query<RecordedWork>(
		`select id, clock_in_id, clock_out_id, canonical_record_id, graph_revision from work_period
		 where organization_id = $1 and start_time = $2 and deleted_at is null`,
		[ORG, new Date(start.epochMilliseconds)],
	);
	return only(rows);
}

/** Both records drove the van, as a clock-out with vehicle use records it. */
async function driveVan(period: RecordedWork) {
	await admin.query(
		`insert into vehicle_use_setting (organization_id, enabled) values ($1, true)
		 on conflict (organization_id) do update set enabled = excluded.enabled`,
		[ORG],
	);
	await admin.query(
		`insert into organization_vehicle (id, organization_id, name, licence_plate)
		 values ($1, $2, 'Van', 'B-VN 1226')`,
		[ids.van, ORG],
	);
	for (const [table, key, id] of [
		["work_period", "id", period.id],
		["time_record_work", "record_id", period.canonical_record_id],
	] as const) {
		await admin.query(
			`update ${table} set vehicle_kind = 'organization', vehicle_id = $2,
			   odometer_start_km = 12000, odometer_end_km = 12085, driven_distance_km = 85
			 where ${key} = $1`,
			[id, ids.van],
		);
	}
}

/**
 * History without a canonical work record: the record is gone and unlinked, as
 * only history before the check (#1224) can be.
 */
async function loseCanonicalRecord(period: RecordedWork) {
	await asHistory(admin, async (client) => {
		await client.query("update work_period set canonical_record_id = null where id = $1", [
			period.id,
		]);
		await client.query("delete from time_record where id = $1", [period.canonical_record_id]);
	});
}

function expectedOf(workPeriodId: string): Promise<WorkRecordExpected> {
	return withCompletedWorkTransaction(
		{ organizationId: ORG, employeeId: ids.requester, actorUserId: userOf("owner") },
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

function attach(
	expected: WorkRecordExpected,
	overrides: Omit<Partial<AttachWorkRecord>, "kind"> = {},
): AttachWorkRecord {
	return {
		kind: "attach",
		organizationId: ORG,
		employeeId: ids.requester,
		expected,
		record: {
			origin: "system",
			createdBy: userOf("requester"),
			computationMetadata: '{"surcharges":[]}',
		},
		actorUserId: userOf("owner"),
		...overrides,
	};
}

function repair(
	expected: WorkRecordExpected,
	resolution: RepairWorkRecord["resolution"],
): RepairWorkRecord {
	return {
		kind: "repair",
		organizationId: ORG,
		employeeId: ids.requester,
		expected,
		resolution,
		actorUserId: userOf("owner"),
	};
}

function apply(change: AttachWorkRecord | RepairWorkRecord) {
	return withCompletedWorkTransaction(
		{ organizationId: ORG, employeeId: ids.requester, actorUserId: userOf("owner") },
		(scope) => applyWorkRecordChange(scope, change),
	);
}

/** Every row a repair can write, to prove "nothing written" by equality. */
async function snapshot() {
	const { rows } = await admin.query(
		`select
		   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
		   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
		   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
		   (select json_agg(row_to_json(t) order by t.record_id) from time_record_work t where organization_id = $1) as works,
		   (select json_agg(row_to_json(t) order by t.id) from time_record_allocation t where organization_id = $1) as allocations,
		   (select json_agg(row_to_json(t) order by t.employee_id) from employee_work_balance t where organization_id = $1) as balances,
		   (select json_agg(row_to_json(t) order by t.id) from period_submission t where organization_id = $1) as submissions`,
		[ORG],
	);
	return only(rows);
}

async function workOf(workPeriodId: string) {
	const { rows } = await admin.query(
		`select wp.canonical_record_id, wp.duration_minutes, wp.graph_revision, wp.project_id, wp.task_id,
		        wp.is_billable, wp.work_category_id, wp.vehicle_id, wp.driven_distance_km,
		        tr.id as record_id, tr.start_at as record_start, tr.end_at as record_end,
		        tr.duration_minutes as record_duration, tr.approval_state, tr.origin, tr.created_by,
		        tr.updated_by, w.work_category_id as record_category, w.vehicle_id as record_vehicle,
		        w.driven_distance_km as record_driven, w.computation_metadata,
		        (select array_agg(a.allocation_kind || ':' || coalesce(a.project_id::text, a.cost_center_id::text)
		           || ':' || coalesce(a.task_id::text, '-') || ':' || a.is_billable
		           order by a.allocation_kind::text) from time_record_allocation a where a.record_id = tr.id) as allocations
		 from work_period wp
		 left join time_record tr on tr.id = wp.canonical_record_id
		 left join time_record_work w on w.record_id = tr.id
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

async function cleanBalance() {
	await admin.query(
		"update employee_work_balance set is_dirty = false, dirty_from_date = null where employee_id = $1",
		[ids.requester],
	);
}

async function balance() {
	const { rows } = await admin.query(
		"select is_dirty, dirty_from_date::text from employee_work_balance where employee_id = $1",
		[ids.requester],
	);
	return only(rows);
}

const ADMISSIONS = [
	{ admission: "append", appendControl: "active" },
	{ admission: "legacy", appendControl: "inactive" },
] as const;

describe.each(ADMISSIONS)(
	"work records: attach and repair in $admission admission on PostgreSQL (#1226)",
	repairContract,
);

function repairContract({ appendControl }: (typeof ADMISSIONS)[number]) {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

	beforeEach(async () => {
		await seed(appendControl);
	});

	afterAll(async () => {
		await cleanup();
	});

	it("attaches a canonical work record that copies the work, vehicle use and computation metadata", async () => {
		const source = await recordWork();
		await driveVan(source);
		await loseCanonicalRecord(source);
		const submission = await submitWeek();
		await cleanBalance();

		const result = await apply(attach(await expectedOf(source.id)));

		await expectRecordAgreement({ organizationId: ORG });
		if (result.kind !== "attached") throw new Error(`refused: ${result.kind}`);
		expect(await workOf(source.id)).toMatchObject({
			canonical_record_id: source.id,
			graph_revision: source.graph_revision + 1,
			record_id: source.id,
			record_start: new Date("2026-07-22T08:00:40Z"),
			record_end: new Date("2026-07-22T17:00:31Z"),
			record_duration: 540,
			approval_state: "approved",
			origin: "system",
			created_by: userOf("requester"),
			updated_by: userOf("owner"),
			record_vehicle: ids.van,
			record_driven: 85,
			computation_metadata: '{"surcharges":[]}',
			allocations: [`project:${ids.project}:-:false`],
		});
		expect(result).toMatchObject({
			after: { workPeriodId: source.id, revision: source.graph_revision + 1 },
			segment: { canonicalRecordId: source.id, durationMinutes: 540 },
			effects: { workBalanceDirtyFromDate: "2026-07-22" },
		});
		expect(await balance()).toEqual({ is_dirty: true, dirty_from_date: "2026-07-22" });
		expect(await submission()).toEqual({ status: "withdrawn", closed_cause: "change" });
	});

	it("refuses to attach where a canonical work record exists, and a stale expected state, without writing", async () => {
		const source = await recordWork();
		const expected = await expectedOf(source.id);
		const before = await snapshot();

		await expect(apply(attach(expected))).resolves.toEqual({ kind: "canonical_record_present" });
		await expect(apply(attach({ ...expected, revision: expected.revision + 1 }))).resolves.toEqual({
			kind: "stale",
			current: { revision: expected.revision },
		});
		expect(await snapshot()).toEqual(before);
	});

	it("returns month_closed from the attach pre-check without writing", async () => {
		const source = await recordWork();
		await loseCanonicalRecord(source);
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

		await expect(apply(attach(expected))).resolves.toEqual({
			kind: "month_closed",
			month: "2026-07",
		});
		expect(await snapshot()).toEqual(before);
	});

	it("repairs a pair that disagrees to the resolution in both records, with the effects", async () => {
		const source = await recordWork();
		await admin.query("update time_record set duration_minutes = 530 where id = $1", [
			source.canonical_record_id,
		]);
		await admin.query("update time_record_work set work_category_id = $2 where record_id = $1", [
			source.canonical_record_id,
			ids.category,
		]);
		const submission = await submitWeek();
		await cleanBalance();

		const result = await apply(
			repair(await expectedOf(source.id), {
				durationMinutes: 540,
				attribution: { workCategoryId: ids.category },
			}),
		);

		await expectRecordAgreement({ organizationId: ORG });
		if (result.kind !== "repaired") throw new Error(`refused: ${result.kind}`);
		expect(await workOf(source.id)).toMatchObject({
			graph_revision: source.graph_revision + 1,
			duration_minutes: 540,
			record_duration: 540,
			work_category_id: ids.category,
			record_category: ids.category,
			updated_by: userOf("owner"),
		});
		expect(result).toMatchObject({
			source: { revision: source.graph_revision, disagreements: ["duration", "work_category"] },
			after: { revision: source.graph_revision + 1 },
			effects: { workBalanceDirtyFromDate: "2026-07-22" },
		});
		expect(await balance()).toEqual({ is_dirty: true, dirty_from_date: "2026-07-22" });
		expect(await submission()).toEqual({ status: "withdrawn", closed_cause: "change" });
	});

	it("links an unlinked record of the same id and gives it its missing detail, vehicle use included", async () => {
		const source = await recordWork();
		await driveVan(source);
		await loseCanonicalRecord(source);
		// The record history left: the period's id, no detail, no allocation, no link.
		await admin.query(
			`insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at,
			   duration_minutes, approval_state, origin, created_by, updated_at)
			 values ($1, $2, $3, 'work', $4, $5, 540, 'approved', 'system', $6, now())`,
			[
				source.id,
				ORG,
				ids.requester,
				new Date("2026-07-22T08:00:40Z"),
				new Date("2026-07-22T17:00:31Z"),
				userOf("requester"),
			],
		);

		const result = await apply(repair(await expectedOf(source.id), {}));

		await expectRecordAgreement({ organizationId: ORG });
		if (result.kind !== "repaired") throw new Error(`refused: ${result.kind}`);
		expect(await workOf(source.id)).toMatchObject({
			canonical_record_id: source.id,
			record_vehicle: ids.van,
			record_driven: 85,
			allocations: [`project:${ids.project}:-:false`],
		});
		expect(result).toMatchObject({ source: { linked: false, detail: false } });
	});

	it("repairs the project in both records; the task follows the project", async () => {
		const source = await recordWork();
		await admin.query("update work_period set task_id = $2 where id = $1", [source.id, ids.task]);
		await admin.query(
			"update time_record_allocation set project_id = $2 where record_id = $1 and allocation_kind = 'project'",
			[source.canonical_record_id, ids.otherProject],
		);

		const result = await apply(
			repair(await expectedOf(source.id), { attribution: { project: ids.otherProject } }),
		);

		await expectRecordAgreement({ organizationId: ORG });
		expect(result).toMatchObject({ kind: "repaired" });
		expect(await workOf(source.id)).toMatchObject({
			project_id: ids.otherProject,
			task_id: null,
			is_billable: true,
			allocations: [`project:${ids.otherProject}:-:true`],
		});
	});

	it("refuses a resolution that leaves the records disagreeing, without writing", async () => {
		const source = await recordWork();
		await admin.query("update time_record set approval_state = 'pending' where id = $1", [
			source.canonical_record_id,
		]);
		await admin.query("update time_record_work set work_category_id = $2 where record_id = $1", [
			source.canonical_record_id,
			ids.category,
		]);
		const expected = await expectedOf(source.id);
		const before = await snapshot();

		await expect(
			apply(repair(expected, { attribution: { workCategoryId: ids.category } })),
		).resolves.toEqual({
			kind: "canonical_divergence",
			found: "locked_pair",
			disagreements: ["approval_state"],
		});
		expect(await snapshot()).toEqual(before);
	});

	it("refuses to overwrite a disagreeing value the resolution does not name, without writing", async () => {
		const source = await recordWork();
		await admin.query("update time_record set duration_minutes = 530 where id = $1", [
			source.canonical_record_id,
		]);
		await admin.query("update time_record_work set work_category_id = $2 where record_id = $1", [
			source.canonical_record_id,
			ids.category,
		]);
		const expected = await expectedOf(source.id);
		const before = await snapshot();

		await expect(apply(repair(expected, { durationMinutes: 540 }))).resolves.toEqual({
			kind: "canonical_divergence",
			found: "locked_pair",
			disagreements: ["work_category"],
		});
		// A repair never moves an endpoint.
		await expect(
			apply(
				repair(expected, {
					durationMinutes: 540,
					startAt: parseInstant("2026-07-22T08:00:00Z"),
					attribution: { workCategoryId: ids.category },
				}),
			),
		).resolves.toEqual({ kind: "interval_invalid" });
		expect(await snapshot()).toEqual(before);
	});

	it("refuses a repair of work that already agrees with the resolution as unchanged", async () => {
		const source = await recordWork();
		const before = await snapshot();
		await expect(apply(repair(await expectedOf(source.id), {}))).resolves.toEqual({
			kind: "unchanged",
		});
		expect(await snapshot()).toEqual(before);
	});

	it("refuses to repair work without a canonical work record: that is attach", async () => {
		const source = await recordWork();
		await loseCanonicalRecord(source);
		await expect(apply(repair(await expectedOf(source.id), {}))).resolves.toEqual({
			kind: "canonical_record_missing",
		});
	});
}
