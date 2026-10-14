/**
 * #1223 contract of work records on PostgreSQL: creating new completed work that
 * never was live work (`create_new`: a manual entry, imported work, demo data) in
 * both admissions, through `applyWorkRecordChange` inside a real work transaction.
 *
 * Local contract: pnpm --filter webapp test:integration
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("@/lib/notifications/notification-service", () => ({
	createNotification: async () => null,
}));

const { db } = await import("@/db");
const { withCompletedWorkTransaction } = await import("../completed-work-transaction");
const { submitPeriodSubmission } = await import("../period-submissions/submission-service");
const { applyWorkRecordChange, readWorkRecord } = await import(".");
const { expectRecordAgreement } = await import("./__tests__/expect-record-agreement");
type CreateNewWork = import(".").CreateNewWork;

const ORG = "t1223-org";
const ids = {
	owner: "e1223000-0000-4000-8000-000000000001",
	manager: "e1223000-0000-4000-8000-000000000002",
	requester: "e1223000-0000-4000-8000-000000000003",
	project: "e1223000-0000-4000-8000-000000000021",
	customer: "e1223000-0000-4000-8000-000000000022",
	category: "e1223000-0000-4000-8000-000000000031",
} as const;
type Person = "owner" | "manager" | "requester";
const userOf = (person: Person) => `t1223-${person}`;
const SEEDED_AT = new Date("2026-06-01T00:00:00Z");
const WORK_START = parseInstant("2026-07-22T08:00:40Z");
const WORK_END = parseInstant("2026-07-22T17:00:31Z");
const BERLIN_SUMMER = {
	utcOffsetMinutes: 120,
	timezone: "Europe/Berlin",
	timezoneSource: "user_setting",
} as const;
const UTC_IMPORT = { utcOffsetMinutes: 0, timezone: "UTC", timezoneSource: "backfill" } as const;

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
	await admin.query('delete from "user" where id like $1', ["t1223-%"]);
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
			[`t1223-member-${person}`, ORG, userOf(person), memberRole, SEEDED_AT],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values ($1, $2, $3, $4, $5)`,
			[ids[person], userOf(person), ORG, employeeRole, SEEDED_AT],
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
	await admin.query(
		`insert into project (id, organization_id, name, status, is_active, customer_id, created_by, updated_at)
		 values ($1, $2, 'Project', 'active', true, $3, $4, $5)`,
		[ids.project, ORG, ids.customer, userOf("owner"), SEEDED_AT],
	);
	await admin.query(
		`insert into work_category (id, organization_id, name, factor, created_by, updated_at)
		 values ($1, $2, 'Travel', 1, $3, $4)`,
		[ids.category, ORG, userOf("owner"), SEEDED_AT],
	);
	await admin.query(
		`insert into time_entry_append_control (organization_id, mode) values ($1, $2)`,
		[ORG, appendControl],
	);
}

/** A manual entry's change: Berlin capture, a project, pending its approval. */
function manual(overrides: Partial<CreateNewWork> = {}): CreateNewWork {
	return {
		kind: "create_new",
		organizationId: ORG,
		employeeId: ids.requester,
		start: { at: WORK_START, notes: "Manual entry: forgot", capture: BERLIN_SUMMER },
		end: { at: WORK_END, notes: "forgot", capture: BERLIN_SUMMER },
		attribution: {
			project: { projectId: ids.project, billableDefault: true },
			workCategoryId: ids.category,
			workLocationType: "office",
		},
		approval: {
			state: "pending",
			pendingChanges: {
				originalStartTime: "2026-07-22T08:00:40.000Z",
				originalEndTime: "2026-07-22T17:00:31.000Z",
				originalDurationMinutes: 540,
				requestedAt: "2026-07-23T08:00:00.000Z",
				requestedBy: userOf("requester"),
				reason: "forgot",
				isManualEntry: true,
			},
		},
		origin: "manual",
		computationMetadata: '{"evidence":"manual"}',
		recordedBy: userOf("requester"),
		actorUserId: userOf("requester"),
		entries: { createdBy: userOf("requester"), ipAddress: "203.0.113.7", deviceInfo: "t1223" },
		appendOperation: "manual_entry",
		...overrides,
	};
}

/** Imported work's change: UTC capture, approved, no notes. */
function imported(start: Instant, end: Instant): CreateNewWork {
	return {
		kind: "create_new",
		organizationId: ORG,
		employeeId: ids.requester,
		start: { at: start, notes: null, capture: UTC_IMPORT },
		end: { at: end, notes: null, capture: UTC_IMPORT },
		approval: { state: "approved" },
		origin: "import",
		recordedBy: userOf("owner"),
		actorUserId: userOf("owner"),
		entries: { createdBy: userOf("owner"), ipAddress: null, deviceInfo: null },
		appendOperation: "reviewed_import",
	};
}

function createAll(changes: readonly CreateNewWork[]) {
	return withCompletedWorkTransaction(
		{ organizationId: ORG, employeeId: ids.requester, actorUserId: userOf("requester") },
		async (scope) => {
			const results = [];
			for (const change of changes) results.push(await applyWorkRecordChange(scope, change));
			return results;
		},
	);
}

async function createOne(change: CreateNewWork) {
	return only(await createAll([change]));
}

/** Every row a creation can write, to prove "nothing written" by equality. */
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

const ADMISSIONS = [
	{ admission: "append", appendControl: "active" },
	{ admission: "legacy", appendControl: "inactive" },
] as const;

describe.each(ADMISSIONS)(
	"work records: create new completed work in $admission admission on PostgreSQL (#1223)",
	({ admission, appendControl }) => {
		vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

		beforeEach(async () => {
			await seed(appendControl);
		});

		afterAll(async () => {
			await cleanup();
		});

		it("creates a manual entry's work period, both entries and its canonical work record, in agreement", async () => {
			const workPeriodId = randomUUID();

			const result = await createOne(manual({ workPeriodId }));

			await expectRecordAgreement({ organizationId: ORG, workPeriodIds: [workPeriodId] });
			if (result.kind !== "created") throw new Error(`refused: ${result.kind}`);
			const { rows } = await admin.query(
				`select wp.is_active, wp.start_time, wp.end_time, wp.duration_minutes, wp.graph_revision,
				        wp.approval_status, wp.pending_changes::jsonb ->> 'reason' as pending_reason,
				        wp.project_id, wp.is_billable, wp.work_category_id, wp.work_location_type,
				        tr.origin, tr.approval_state, tr.created_by, tr.duration_minutes as record_duration,
				        trw.computation_metadata,
				        clock_in.type as clock_in_type, clock_in.notes as clock_in_notes,
				        clock_in.utc_offset_minutes as clock_in_offset, clock_in.ip_address,
				        clock_out.notes as clock_out_notes, clock_out.previous_entry_id as clock_out_previous,
				        clock_in.id as clock_in_id
				 from work_period wp
				 join time_record tr on tr.id = wp.canonical_record_id
				 join time_record_work trw on trw.record_id = tr.id
				 join time_entry clock_in on clock_in.id = wp.clock_in_id
				 join time_entry clock_out on clock_out.id = wp.clock_out_id
				 where wp.id = $1`,
				[workPeriodId],
			);
			const row = only(rows);
			// 08:00:40 to 17:00:31 is 8h59m51s: half up in append admission, floored in legacy.
			const minutes = admission === "append" ? 540 : 539;
			expect(row).toEqual({
				is_active: false,
				start_time: new Date("2026-07-22T08:00:40Z"),
				end_time: new Date("2026-07-22T17:00:31Z"),
				duration_minutes: minutes,
				graph_revision: 1,
				approval_status: "pending",
				pending_reason: "forgot",
				project_id: ids.project,
				is_billable: true,
				work_category_id: ids.category,
				work_location_type: "office",
				origin: "manual",
				approval_state: "pending",
				created_by: userOf("requester"),
				record_duration: minutes,
				computation_metadata: '{"evidence":"manual"}',
				clock_in_type: "clock_in",
				clock_in_notes: "Manual entry: forgot",
				clock_in_offset: 120,
				ip_address: "203.0.113.7",
				clock_out_notes: "forgot",
				clock_out_previous: row.clock_in_id,
				clock_in_id: row.clock_in_id,
			});
			expect(result).toMatchObject({
				kind: "created",
				segment: {
					workPeriodId,
					clockInEntryId: row.clock_in_id,
					startAt: "2026-07-22T08:00:40Z",
					endAt: "2026-07-22T17:00:31Z",
					durationMinutes: minutes,
					startUtcOffsetMinutes: 120,
					endUtcOffsetMinutes: 120,
					attribution: { projectId: ids.project, isBillable: true, workCategoryId: ids.category },
				},
				after: { workPeriodId, revision: 1 },
				appended: {
					admission,
					clockIn: { entryId: row.clock_in_id },
					clockOut: { previousEntryId: row.clock_in_id },
				},
			});
		});

		it("creates imported work approved, with origin import and no project", async () => {
			const result = await createOne(imported(WORK_START, WORK_END));

			if (result.kind !== "created") throw new Error(`refused: ${result.kind}`);
			await expectRecordAgreement({ organizationId: ORG });
			const { rows } = await admin.query(
				`select wp.approval_status, wp.project_id, tr.origin, tr.approval_state,
				        (select count(*)::int from time_record_allocation a where a.record_id = tr.id) as allocations
				 from work_period wp join time_record tr on tr.id = wp.canonical_record_id
				 where wp.id = $1`,
				[result.segment.workPeriodId],
			);
			expect(only(rows)).toEqual({
				approval_status: "approved",
				project_id: null,
				origin: "import",
				approval_state: "approved",
				allocations: 0,
			});
		});

		it("chains two creations in one transaction, each after the one before", async () => {
			const [first, second] = await createAll([
				imported(parseInstant("2026-07-20T08:00:00Z"), parseInstant("2026-07-20T12:00:00Z")),
				imported(parseInstant("2026-07-20T13:00:00Z"), parseInstant("2026-07-20T17:00:00Z")),
			]);
			if (first?.kind !== "created" || second?.kind !== "created") throw new Error("refused");

			expect(second.appended.clockIn.previousEntryId).toBe(first.appended.clockOut.entryId);
			await expectRecordAgreement({ organizationId: ORG });
			// A later change chains after the latest entry, not one of the earlier ones.
			const [third] = await createAll([
				imported(parseInstant("2026-07-21T08:00:00Z"), parseInstant("2026-07-21T12:00:00Z")),
			]);
			if (third?.kind !== "created") throw new Error("refused");
			expect(third.appended.clockIn.previousEntryId).toBe(second.appended.clockOut.entryId);
		});

		it("returns the new work's expected state, as a read names it, for chaining", async () => {
			const created = await createOne(imported(WORK_START, WORK_END));
			if (created.kind !== "created") throw new Error(`refused: ${created.kind}`);

			const read = await withCompletedWorkTransaction(
				{ organizationId: ORG, employeeId: ids.requester, actorUserId: userOf("requester") },
				(scope) =>
					readWorkRecord(scope, {
						organizationId: ORG,
						employeeId: ids.requester,
						workPeriodId: created.segment.workPeriodId,
					}),
			);
			expect(read?.expected).toEqual(created.after);
		});

		it("refuses work that overlaps recorded work without writing", async () => {
			await createOne(imported(WORK_START, WORK_END));
			const before = await snapshot();

			const result = await createOne(
				manual({
					start: { at: WORK_END.subtract({ hours: 1 }), notes: null, capture: BERLIN_SUMMER },
					end: { at: WORK_END.add({ hours: 1 }), notes: null, capture: BERLIN_SUMMER },
				}),
			);

			expect(result).toMatchObject({ kind: "work_occupied", occupants: [{ kind: "work_period" }] });
			expect(await snapshot()).toEqual(before);
		});

		it("refuses an end that is not after the start without writing", async () => {
			const before = await snapshot();

			await expect(createOne(imported(WORK_END, WORK_START))).resolves.toEqual({
				kind: "interval_invalid",
			});
			await expect(createOne(imported(WORK_START, WORK_START))).resolves.toEqual({
				kind: "interval_invalid",
			});
			expect(await snapshot()).toEqual(before);
		});

		it("refuses billable work without a project without writing", async () => {
			const before = await snapshot();

			await expect(createOne(manual({ attribution: { billable: true } }))).resolves.toEqual({
				kind: "attribution_unrepresentable",
				reason: "billable_without_project",
			});
			expect(await snapshot()).toEqual(before);
		});

		it("marks the work balance dirty from the clock-in's own offset", async () => {
			// New York 2026-07-10 22:00 to 2026-07-11 00:30 (UTC 07-11 02:00 to 04:30).
			const newYork = {
				utcOffsetMinutes: -240,
				timezone: "America/New_York",
				timezoneSource: "user_setting",
			} as const;
			const result = await createOne(
				manual({
					start: { at: parseInstant("2026-07-11T02:00:00Z"), notes: null, capture: newYork },
					end: { at: parseInstant("2026-07-11T04:30:00Z"), notes: null, capture: newYork },
				}),
			);

			expect(result).toMatchObject({ effects: { workBalanceDirtyFromDate: "2026-07-10" } });
			const { rows } = await admin.query(
				"select is_dirty, dirty_from_date::text from employee_work_balance where employee_id = $1",
				[ids.requester],
			);
			expect(only(rows)).toEqual({ is_dirty: true, dirty_from_date: "2026-07-10" });
		});

		it("sends a submitted period the new work touches back to the employee", async () => {
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

			await expect(createOne(imported(WORK_START, WORK_END))).resolves.toMatchObject({
				kind: "created",
			});

			const { rows } = await admin.query(
				"select status, closed_cause from period_submission where organization_id = $1 and id = $2",
				[ORG, submitted.submissionId],
			);
			expect(only(rows)).toEqual({ status: "withdrawn", closed_cause: "change" });
		});

		it("returns month_closed from the pre-check without writing", async () => {
			await admin.query(
				`with closed as (
				   insert into closed_month (organization_id, month, scope, actor_kind, closed_by)
				   values ($1, '2026-07-01', 'organization', 'user', $3) returning id
				 )
				 insert into closed_month_employee
				   (organization_id, closed_month_id, employee_id, month, range_start, range_end, timezone)
				 select $1, closed.id, $2, '2026-07-01', '2026-06-30T22:00:00', '2026-07-31T22:00:00',
				        'Europe/Berlin'
				   from closed`,
				[ORG, ids.requester, userOf("owner")],
			);
			const before = await snapshot();

			await expect(createOne(imported(WORK_START, WORK_END))).resolves.toEqual({
				kind: "month_closed",
				month: "2026-07",
			});
			expect(await snapshot()).toEqual(before);
		});
	},
);
