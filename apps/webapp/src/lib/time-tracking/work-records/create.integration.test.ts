/**
 * #1222 contract of work records on PostgreSQL: creating completed work from
 * live work (`create { completing }`) in both admissions, through
 * `applyWorkRecordChange` inside the real work transaction.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * Live work is started through the real web clock-in. Only the request/session,
 * billing provisioning, the Next cache and e-mail, notification and delivery
 * side channels are replaced.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1222-org",
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
	getOrganizationBaseUrl: async () => "https://t1222.example.test",
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
const { clockIn } = await import("@/app/[locale]/(app)/time-tracking/actions/clocking");
const { withCompletedWorkTransaction } = await import("../completed-work-transaction");
const { submitPeriodSubmission } = await import("../period-submissions/submission-service");
const { applyWorkRecordChange, readWorkRecord } = await import(".");
const { expectRecordAgreement } = await import("./__tests__/expect-record-agreement");
type CreateWorkRecord = import(".").CreateWorkRecord;
type WorkRecord = import(".").WorkRecord;

const ORG = "t1222-org";
const ids = {
	owner: "e1222000-0000-4000-8000-000000000001",
	manager: "e1222000-0000-4000-8000-000000000002",
	requester: "e1222000-0000-4000-8000-000000000003",
	project: "e1222000-0000-4000-8000-000000000021",
	customer: "e1222000-0000-4000-8000-000000000022",
	category: "e1222000-0000-4000-8000-000000000031",
} as const;
type Person = "owner" | "manager" | "requester";
const userOf = (person: Person) => `t1222-${person}`;
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
	await admin.query('delete from "user" where id like $1', ["t1222-%"]);
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
			[`t1222-member-${person}`, ORG, userOf(person), memberRole, SEEDED_AT],
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
	// The requester's manager decides their period submissions.
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

/** The requester's live work, started through the real web clock-in. */
async function startWork(start: Instant = WORK_START, zone = "Europe/Berlin") {
	harness.userId = userOf("requester");
	await expect(clockIn("office", { instant: start, browserTimezone: zone })).resolves.toMatchObject(
		{ success: true },
	);
	const { rows } = await admin.query<{ id: string; clock_in_id: string; graph_revision: number }>(
		`select id, clock_in_id, graph_revision from work_period
		 where organization_id = $1 and end_time is null and deleted_at is null`,
		[ORG],
	);
	return only(rows);
}

function create(
	completing: WorkRecord,
	at: Instant,
	overrides: Partial<CreateWorkRecord> = {},
): CreateWorkRecord {
	return {
		kind: "create",
		organizationId: ORG,
		employeeId: ids.requester,
		expected: completing.expected,
		completing,
		at,
		recordedBy: userOf("requester"),
		actorUserId: userOf("requester"),
		entries: {
			createdBy: userOf("requester"),
			ipAddress: "203.0.113.7",
			deviceInfo: "t1222",
			capture: BERLIN_SUMMER,
		},
		appendOperation: "live_clock_out",
		...overrides,
	};
}

/** Reads the live work locked, as Clocking does, and creates its completed work. */
function complete(
	workPeriodId: string,
	at: Instant,
	overrides: (live: WorkRecord) => Partial<CreateWorkRecord> = () => ({}),
) {
	return withCompletedWorkTransaction(
		{ organizationId: ORG, employeeId: ids.requester, actorUserId: userOf("requester") },
		async (scope) => {
			const live = await readWorkRecord(
				scope,
				{ organizationId: ORG, employeeId: ids.requester, workPeriodId },
				{ lock: true },
			);
			if (!live) throw new Error("live work not found");
			return applyWorkRecordChange(scope, create(live, at, overrides(live)));
		},
	);
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
	"work records: create from live work in $admission admission on PostgreSQL (#1222)",
	({ admission, appendControl }) => {
		vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

		beforeEach(async () => {
			await seed(appendControl);
		});

		afterAll(async () => {
			await cleanup();
		});

		it("closes the live work and creates its canonical work record, in agreement", async () => {
			const live = await startWork();
			const clockOutId = randomUUID();

			const result = await complete(live.id, WORK_END, () => ({
				clockOutEntryId: clockOutId,
				attribution: {
					project: { projectId: ids.project, billableDefault: true },
					workCategoryId: ids.category,
				},
			}));

			await expectRecordAgreement({ organizationId: ORG });
			if (result.kind !== "created") throw new Error(`refused: ${result.kind}`);
			const { rows } = await admin.query(
				`select wp.is_active, wp.clock_out_id, wp.end_time, wp.duration_minutes, wp.graph_revision,
				        wp.approval_status, wp.project_id, wp.is_billable, wp.work_category_id,
				        tr.origin, tr.approval_state, tr.created_by, tr.duration_minutes as record_duration,
				        (select json_agg(json_build_object('project', a.project_id, 'billable', a.is_billable,
				           'weight', a.weight_percent)) from time_record_allocation a where a.record_id = tr.id)
				          as allocations,
				        clock_out.previous_entry_id, clock_out.created_by as clock_out_created_by,
				        clock_out.ip_address, clock_out.device_info, clock_out.utc_offset_minutes,
				        clock_out.timezone
				 from work_period wp
				 join time_record tr on tr.id = wp.canonical_record_id
				 join time_entry clock_out on clock_out.id = wp.clock_out_id
				 where wp.id = $1`,
				[live.id],
			);
			// 08:00:40 to 17:00:31 is 8h59m51s: half up in both admissions, as live work always closed.
			expect(only(rows)).toEqual({
				is_active: false,
				clock_out_id: clockOutId,
				end_time: new Date("2026-07-22T17:00:31Z"),
				duration_minutes: 540,
				graph_revision: live.graph_revision + 1,
				approval_status: "approved",
				project_id: ids.project,
				is_billable: true,
				work_category_id: ids.category,
				origin: "clock",
				approval_state: "approved",
				created_by: userOf("requester"),
				record_duration: 540,
				allocations: [{ project: ids.project, billable: true, weight: 100 }],
				// The clock-out follows the live work's clock-in in either admission's chain.
				previous_entry_id: live.clock_in_id,
				clock_out_created_by: userOf("requester"),
				ip_address: "203.0.113.7",
				device_info: "t1222",
				utc_offset_minutes: 120,
				timezone: "Europe/Berlin",
			});
			expect(result).toMatchObject({
				kind: "created",
				source: { revision: live.graph_revision },
				segment: {
					workPeriodId: live.id,
					clockInEntryId: live.clock_in_id,
					clockOutEntryId: clockOutId,
					startAt: "2026-07-22T08:00:40Z",
					endAt: "2026-07-22T17:00:31Z",
					durationMinutes: 540,
					startUtcOffsetMinutes: 120,
					endUtcOffsetMinutes: 120,
					attribution: { projectId: ids.project, isBillable: true, workCategoryId: ids.category },
				},
				after: { workPeriodId: live.id, revision: live.graph_revision + 1 },
				appended: {
					admission,
					clockOut: { entryId: clockOutId, previousEntryId: live.clock_in_id },
				},
			});
		});

		it("refuses a stale revision without writing", async () => {
			const live = await startWork();
			const before = await snapshot();

			await expect(
				complete(live.id, WORK_END, (current) => ({
					expected: { ...current.expected, revision: current.expected.revision + 1 },
				})),
			).resolves.toEqual({ kind: "stale", current: { revision: live.graph_revision } });
			expect(await snapshot()).toEqual(before);
		});

		it("refuses work that is no longer live without writing", async () => {
			const live = await startWork();
			await expect(complete(live.id, WORK_END)).resolves.toMatchObject({ kind: "created" });
			const before = await snapshot();

			await expect(complete(live.id, WORK_END.add({ hours: 1 }))).resolves.toEqual({
				kind: "work_not_live",
			});
			expect(await snapshot()).toEqual(before);
		});

		it("refuses an end before the start without writing", async () => {
			const live = await startWork();
			const before = await snapshot();

			await expect(complete(live.id, WORK_START.subtract({ seconds: 1 }))).resolves.toEqual({
				kind: "instant_outside_work",
			});
			expect(await snapshot()).toEqual(before);
		});

		// Legacy admission keeps its zero-minute closure at equal endpoints until it retires.
		it(
			admission === "append"
				? "refuses an end at the start without writing"
				: "completes work ending at its start with zero minutes",
			async () => {
				const live = await startWork();
				const before = await snapshot();

				const result = await complete(live.id, WORK_START);

				if (admission === "append") {
					expect(result).toEqual({ kind: "instant_outside_work" });
					expect(await snapshot()).toEqual(before);
				} else {
					expect(result).toMatchObject({ kind: "created", segment: { durationMinutes: 0 } });
					await expectRecordAgreement({ organizationId: ORG });
				}
			},
		);

		it("marks the work balance dirty from the clock-in's own offset", async () => {
			// New York 2026-07-10 22:00 to 2026-07-11 00:30 (UTC 07-11 02:00 to 04:30).
			const live = await startWork(parseInstant("2026-07-11T02:00:00Z"), "America/New_York");
			await admin.query(
				"update employee_work_balance set is_dirty = false, dirty_from_date = null where employee_id = $1",
				[ids.requester],
			);

			const result = await complete(live.id, parseInstant("2026-07-11T04:30:00Z"));

			expect(result).toMatchObject({ effects: { workBalanceDirtyFromDate: "2026-07-10" } });
			const { rows } = await admin.query(
				"select is_dirty, dirty_from_date::text from employee_work_balance where employee_id = $1",
				[ids.requester],
			);
			expect(only(rows)).toEqual({ is_dirty: true, dirty_from_date: "2026-07-10" });
		});

		it("sends a submitted period the completed work touches back to the employee", async () => {
			await admin.query(
				`insert into period_submission_cadence_change
				 (id, organization_id, cadence, week_start_day, changed_at, changed_by)
				 values ($1, $2, 'weekly', 'monday', '2026-06-01T00:00:00Z', $3)`,
				[randomUUID(), ORG, userOf("owner")],
			);
			// Running work blocks submitting the period it started in, so it starts the week before.
			const live = await startWork(parseInstant("2026-07-19T20:00:00Z"));
			const submitted = await submitPeriodSubmission(
				{ organizationId: ORG, userId: userOf("requester"), periodStartDate: "2026-07-20" },
				{ database: db, clock: { nowInstant: () => parseInstant("2026-07-26T12:00:00Z") } },
			);
			if (submitted.kind !== "submitted") throw new Error(`not submitted: ${submitted.reason}`);

			await expect(complete(live.id, parseInstant("2026-07-20T02:00:00Z"))).resolves.toMatchObject({
				kind: "created",
			});

			const { rows } = await admin.query(
				"select status, closed_cause from period_submission where organization_id = $1 and id = $2",
				[ORG, submitted.submissionId],
			);
			expect(only(rows)).toEqual({ status: "withdrawn", closed_cause: "change" });
		});

		it("returns month_closed from the pre-check without writing", async () => {
			const live = await startWork();
			// Closing the month refuses running work, so its range is recorded as a close left it.
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

			await expect(complete(live.id, WORK_END)).resolves.toEqual({
				kind: "month_closed",
				month: "2026-07",
			});
			expect(await snapshot()).toEqual(before);
		});
	},
);
