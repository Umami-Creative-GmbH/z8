/**
 * #1220 contract of work records on PostgreSQL: dividing completed work by an
 * owed break, in both admissions, through `applyWorkRecordChange` inside the
 * real work transaction.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * Completed work is recorded through the real web clock-in and clock-out
 * without a work policy, so no automatic break runs at clock-out; the change
 * names the regulation itself. Only the request/session, billing provisioning,
 * the Next cache and e-mail, notification and delivery side channels are
 * replaced.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1220-org",
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
	getOrganizationBaseUrl: async () => "https://t1220.example.test",
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
type DivideByOwedBreak = import(".").DivideByOwedBreak;
type WorkRecordExpected = import(".").WorkRecordExpected;

const ORG = "t1220-org";
const ids = {
	owner: "e1220000-0000-4000-8000-000000000001",
	manager: "e1220000-0000-4000-8000-000000000002",
	requester: "e1220000-0000-4000-8000-000000000003",
	project: "e1220000-0000-4000-8000-000000000021",
	customer: "e1220000-0000-4000-8000-000000000022",
	costCenter: "e1220000-0000-4000-8000-000000000031",
	van: "e1220000-0000-4000-8000-000000000041",
	regulation: "e1220000-0000-4000-8000-000000000051",
} as const;
type Person = "owner" | "manager" | "requester";
const userOf = (person: Person) => `t1220-${person}`;
const SEEDED_AT = new Date("2026-06-01T00:00:00Z");
// 6h 59m 51s without a break (420 stored minutes): 30 minutes are owed after 6h.
const WORK_START = parseInstant("2026-07-22T08:00:40Z");
const WORK_END = parseInstant("2026-07-22T15:00:31Z");
const BREAK_START = new Date("2026-07-22T14:00:40Z");
const BREAK_END = new Date("2026-07-22T14:30:40Z");
const REGULATION = {
	id: ids.regulation,
	name: "T1220 break",
	maxUninterruptedMinutes: 360,
	breakRules: [{ workingMinutesThreshold: 360, requiredBreakMinutes: 30 }],
};

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
	await admin.query('delete from "user" where id like $1', ["t1220-%"]);
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
			[`t1220-member-${person}`, ORG, userOf(person), memberRole, SEEDED_AT],
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
	await admin.query(
		`insert into project (id, organization_id, name, status, is_active, customer_id, created_by, updated_at)
		 values ($1, $2, 'Project', 'active', true, $3, $4, $5)`,
		[ids.project, ORG, ids.customer, userOf("owner"), SEEDED_AT],
	);
	await admin.query(
		`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
		 values ($1, $2, $3, 'employee', $4, $5)`,
		[randomUUID(), ids.project, ORG, ids.requester, userOf("owner")],
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

/** Real clock-in and clock-out of the requester on the project, in Berlin. */
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

function expectedOf(workPeriodId: string): Promise<WorkRecordExpected> {
	return withCompletedWorkTransaction(
		{ organizationId: ORG, employeeId: ids.requester, actorUserId: null },
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

function owedBreak(
	expected: WorkRecordExpected,
	overrides: Partial<DivideByOwedBreak> = {},
): DivideByOwedBreak {
	return {
		kind: "divide_owed_break",
		organizationId: ORG,
		employeeId: ids.requester,
		expected,
		regulation: REGULATION,
		takenBefore: "earlier_breaks",
		notes: "Auto-adjusted: break enforcement",
		actorUserId: null,
		entries: {
			createdBy: userOf("requester"),
			ipAddress: "system",
			deviceInfo: "break-enforcement",
			timezone: "Europe/Berlin",
			timezoneSource: "historical_inference",
		},
		appendOperation: "automatic_break_adjustment",
		...overrides,
	};
}

function apply(change: DivideByOwedBreak) {
	return withCompletedWorkTransaction(
		{ organizationId: ORG, employeeId: ids.requester, actorUserId: change.actorUserId },
		(scope) => applyWorkRecordChange(scope, change),
	);
}

/** Every row a division can write, to prove "nothing written" by equality. */
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

async function segments() {
	const { rows } = await admin.query<{
		id: string;
		clock_in_id: string;
		clock_out_id: string;
		start_time: Date;
		end_time: Date;
		duration_minutes: number;
		graph_revision: number;
		canonical_record_id: string;
		was_auto_adjusted: boolean;
		original_end_time: Date | null;
		original_duration_minutes: number | null;
		auto_adjustment_reason: Record<string, unknown> | null;
		allocations: string[];
	}>(
		`select wp.id, wp.clock_in_id, wp.clock_out_id, wp.start_time, wp.end_time, wp.duration_minutes,
		        wp.graph_revision, wp.canonical_record_id, wp.was_auto_adjusted, wp.original_end_time,
		        wp.original_duration_minutes, wp.auto_adjustment_reason::jsonb as auto_adjustment_reason,
		        (select array_agg(a.allocation_kind || ':' || coalesce(a.project_id::text, a.cost_center_id::text)
		           order by a.allocation_kind::text) from time_record_allocation a where a.record_id = wp.canonical_record_id) as allocations
		 from work_period wp
		 where wp.organization_id = $1 and wp.deleted_at is null
		 order by wp.start_time`,
		[ORG],
	);
	return rows;
}

/**
 * The one contract in both admissions. Only the admission's writer differs:
 * append admission rounds each half half up and advances the append position;
 * legacy admission floors each half and chains after the latest entry.
 */
const ADMISSIONS = [
	// 08:00:40-14:00:40 is 360 minutes; 14:30:40-15:00:31 is 29m51s.
	{ admission: "append", appendControl: "active", divided: [360, 30] },
	{ admission: "legacy", appendControl: "inactive", divided: [360, 29] },
] as const;

describe.each(ADMISSIONS)(
	"work records: divide by an owed break in $admission admission on PostgreSQL (#1220)",
	owedBreakContract,
);

function owedBreakContract({ admission, appendControl, divided }: (typeof ADMISSIONS)[number]) {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

	beforeEach(async () => {
		await seed(appendControl);
	});

	afterAll(async () => {
		await cleanup();
	});

	it("inserts the owed break in both records, marks the work auto-adjusted and keeps them in agreement", async () => {
		const source = await recordWork();
		await admin.query(
			`insert into time_record_allocation (organization_id, record_id, allocation_kind, cost_center_id, weight_percent)
			 values ($1, $2, 'cost_center', $3, 100)`,
			[ORG, source.canonical_record_id, ids.costCenter],
		);

		const result = await apply(owedBreak(await expectedOf(source.id)));

		await expectRecordAgreement({ organizationId: ORG });
		if (result.kind !== "owed_break_divided") throw new Error(`not divided: ${result.kind}`);
		const [retained, generated] = await segments();
		const reason = {
			type: "break_enforcement",
			regulationId: ids.regulation,
			regulationName: "T1220 break",
			breakInsertedMinutes: 30,
			breakInsertedAt: "2026-07-22T14:00:40Z",
			originalDurationMinutes: 420,
			adjustedDurationMinutes: divided[0] + divided[1],
			ruleApplied: { workingMinutesThreshold: 360, requiredBreakMinutes: 30 },
		};
		expect(retained).toMatchObject({
			id: source.id,
			clock_in_id: source.clock_in_id,
			end_time: BREAK_START,
			duration_minutes: divided[0],
			graph_revision: source.graph_revision + 1,
			canonical_record_id: source.canonical_record_id,
			was_auto_adjusted: true,
			original_end_time: new Date(WORK_END.epochMilliseconds),
			original_duration_minutes: 420,
			auto_adjustment_reason: reason,
			allocations: [`cost_center:${ids.costCenter}`, `project:${ids.project}`],
		});
		expect(generated).toMatchObject({
			clock_out_id: source.clock_out_id,
			start_time: BREAK_END,
			end_time: new Date(WORK_END.epochMilliseconds),
			duration_minutes: divided[1],
			graph_revision: 1,
			was_auto_adjusted: true,
			original_end_time: null,
			auto_adjustment_reason: reason,
			allocations: [`cost_center:${ids.costCenter}`, `project:${ids.project}`],
		});
		expect(result).toMatchObject({
			owedBreak: {
				breakMinutes: 30,
				alreadyTakenBreakMinutes: 0,
				rule: { workingMinutesThreshold: 360, requiredBreakMinutes: 30 },
				regulation: { id: ids.regulation, name: "T1220 break" },
			},
			source: { segment: { workPeriodId: source.id, durationMinutes: 420 } },
			retained: {
				segment: { workPeriodId: source.id, endAt: "2026-07-22T14:00:40Z" },
				after: { workPeriodId: source.id, revision: source.graph_revision + 1 },
			},
			generated: {
				segment: { workPeriodId: generated?.id, startAt: "2026-07-22T14:30:40Z" },
				after: { workPeriodId: generated?.id, revision: 1 },
			},
			appended: {
				admission,
				clockOut: { entryId: retained?.clock_out_id, previousEntryId: source.clock_out_id },
				clockIn: { entryId: generated?.clock_in_id, previousEntryId: retained?.clock_out_id },
			},
		});
		// The break entries are captured in the named zone, and the source clock-out stands.
		const { rows: entries } = await admin.query(
			`select type, timestamp, notes, utc_offset_minutes, timezone, timezone_source, ip_address,
			        device_info, created_by
			 from time_entry where id = any($1::uuid[]) order by timestamp`,
			[[retained?.clock_out_id, generated?.clock_in_id]],
		);
		expect(entries).toEqual(
			[
				["clock_out", BREAK_START],
				["clock_in", BREAK_END],
			].map(([type, timestamp]) => ({
				type,
				timestamp,
				notes: "Auto-adjusted: break enforcement",
				utc_offset_minutes: 120,
				timezone: "Europe/Berlin",
				timezone_source: "historical_inference",
				ip_address: "system",
				device_info: "break-enforcement",
				created_by: userOf("requester"),
			})),
		);
		const { rows: sourceClockOut } = await admin.query(
			"select is_superseded from time_entry where id = $1",
			[source.clock_out_id],
		);
		expect(only(sourceClockOut)).toEqual({ is_superseded: false });
	});

	it("returns not_required and writes nothing when no break is owed", async () => {
		const source = await recordWork();
		const expected = await expectedOf(source.id);
		const before = await snapshot();

		await expect(apply(owedBreak(expected, { regulation: null }))).resolves.toEqual({
			kind: "not_required",
		});
		await expect(
			apply(
				owedBreak(expected, {
					regulation: {
						...REGULATION,
						breakRules: [{ workingMinutesThreshold: 480, requiredBreakMinutes: 30 }],
					},
				}),
			),
		).resolves.toEqual({ kind: "not_required" });
		expect(await snapshot()).toEqual(before);
	});

	it("counts breaks taken between earlier work of the local day", async () => {
		// 05:00-05:30 UTC is 07:00-07:30 in Berlin: 150 minutes before the source, a break taken.
		await recordWork(parseInstant("2026-07-22T05:00:00Z"), parseInstant("2026-07-22T05:30:00Z"));
		const source = await recordWork();
		const before = await snapshot();

		await expect(apply(owedBreak(await expectedOf(source.id)))).resolves.toEqual({
			kind: "not_required",
		});
		expect(await snapshot()).toEqual(before);
	});

	it("refuses a divergent pair as canonical_divergence without writing", async () => {
		const source = await recordWork();
		await admin.query(
			"update time_record_work set work_location_type = 'home' where record_id = $1",
			[source.canonical_record_id],
		);
		const expected = await expectedOf(source.id);
		const before = await snapshot();

		await expect(apply(owedBreak(expected))).resolves.toEqual({
			kind: "canonical_divergence",
			found: "locked_pair",
			disagreements: ["work_location"],
		});
		expect(await snapshot()).toEqual(before);
	});

	it("refuses a stale expected state without writing", async () => {
		const source = await recordWork();
		const expected = await expectedOf(source.id);
		const before = await snapshot();

		await expect(
			apply(owedBreak({ ...expected, revision: expected.revision + 1 })),
		).resolves.toEqual({ kind: "stale", current: { revision: expected.revision } });
		expect(await snapshot()).toEqual(before);
	});

	it("refuses occupied work without writing", async () => {
		const source = await recordWork();
		// Canonical work without a period link occupies its own interval.
		await admin.query(
			`insert into time_record
			 (id, organization_id, employee_id, record_kind, start_at, end_at, duration_minutes,
			  approval_state, origin, created_by, updated_at)
			 values ($1, $2, $3, 'work', '2026-07-22T10:00:00Z', '2026-07-22T11:00:00Z', 60,
			         'approved', 'manual', $4, now())`,
			[randomUUID(), ORG, ids.requester, userOf("requester")],
		);
		const expected = await expectedOf(source.id);
		const before = await snapshot();

		await expect(apply(owedBreak(expected))).resolves.toMatchObject({ kind: "work_occupied" });
		expect(await snapshot()).toEqual(before);
	});

	it("returns month_closed from the pre-check without writing", async () => {
		const source = await recordWork();
		const expected = await expectedOf(source.id);
		await closeMonth(db, {
			organizationId: ORG,
			month: "2026-07",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: userOf("owner") },
			now: parseInstant("2026-08-03T09:00:00Z"),
		});
		const before = await snapshot();

		await expect(apply(owedBreak(expected))).resolves.toEqual({
			kind: "month_closed",
			month: "2026-07",
		});
		expect(await snapshot()).toEqual(before);
	});

	it("marks the work balance dirty from the work's own captured start date", async () => {
		const source = await recordWork();
		await admin.query(
			"update employee_work_balance set is_dirty = false, dirty_from_date = null where employee_id = $1",
			[ids.requester],
		);

		await expect(apply(owedBreak(await expectedOf(source.id)))).resolves.toMatchObject({
			effects: { workBalanceDirtyFromDate: "2026-07-22" },
		});

		const { rows } = await admin.query(
			"select is_dirty, dirty_from_date::text from employee_work_balance where employee_id = $1",
			[ids.requester],
		);
		expect(only(rows)).toEqual({ is_dirty: true, dirty_from_date: "2026-07-22" });
	});

	it("sends a submitted period back as a system change", async () => {
		await admin.query(
			`insert into period_submission_cadence_change
			 (id, organization_id, cadence, week_start_day, changed_at, changed_by)
			 values ($1, $2, 'weekly', 'monday', '2026-06-01T00:00:00Z', $3)`,
			[randomUUID(), ORG, userOf("owner")],
		);
		const source = await recordWork();
		const submitted = await submitPeriodSubmission(
			{ organizationId: ORG, userId: userOf("requester"), periodStartDate: "2026-07-20" },
			{ database: db, clock: { nowInstant: () => parseInstant("2026-07-26T12:00:00Z") } },
		);
		if (submitted.kind !== "submitted") throw new Error(`not submitted: ${submitted.reason}`);

		await expect(apply(owedBreak(await expectedOf(source.id)))).resolves.toMatchObject({
			kind: "owed_break_divided",
		});

		const { rows } = await admin.query(
			"select status, closed_cause from period_submission where organization_id = $1 and id = $2",
			[ORG, submitted.submissionId],
		);
		expect(only(rows)).toEqual({ status: "withdrawn", closed_cause: "change" });
	});

	describe("vehicle use across the break", () => {
		async function driveVan(
			period: { id: string; canonical_record_id: string },
			km: { start: number | null; end: number | null; distance: number | null },
		) {
			await admin.query(
				`insert into organization_vehicle (id, organization_id, name, licence_plate)
				 values ($1, $2, 'Van', 'B-VN 1220')`,
				[ids.van, ORG],
			);
			for (const [table, key, id] of [
				["work_period", "id", period.id],
				["time_record_work", "record_id", period.canonical_record_id],
			] as const) {
				await admin.query(
					`update ${table} set vehicle_kind = 'organization', vehicle_id = $2,
					   odometer_start_km = $3, odometer_end_km = $4, driven_distance_km = $5
					 where ${key} = $1`,
					[id, ids.van, km.start, km.end, km.distance],
				);
			}
		}

		async function kilometres() {
			const { rows } = await admin.query(
				`select wp.odometer_start_km as start, wp.odometer_end_km as end, wp.driven_distance_km as distance,
				        w.vehicle_id = wp.vehicle_id as same_vehicle
				 from work_period wp join time_record_work w on w.record_id = wp.canonical_record_id
				 where wp.organization_id = $1 and wp.deleted_at is null order by wp.start_time`,
				[ORG],
			);
			return rows;
		}

		it("keeps complete readings on the retained work and gives the resumed work 0 km", async () => {
			const source = await recordWork();
			await driveVan(source, { start: 12_000, end: 12_085, distance: 85 });

			await expect(apply(owedBreak(await expectedOf(source.id)))).resolves.toMatchObject({
				kind: "owed_break_divided",
			});

			await expectRecordAgreement({ organizationId: ORG });
			expect(await kilometres()).toEqual([
				{ start: 12_000, end: 12_085, distance: 85, same_vehicle: true },
				{ start: null, end: null, distance: 0, same_vehicle: true },
			]);
		});

		it("leaves vehicle use awaiting its end reading on the work that ends at the clock-out", async () => {
			const source = await recordWork();
			await driveVan(source, { start: 12_000, end: null, distance: null });

			await expect(apply(owedBreak(await expectedOf(source.id)))).resolves.toMatchObject({
				kind: "owed_break_divided",
			});

			await expectRecordAgreement({ organizationId: ORG });
			expect(await kilometres()).toEqual([
				{ start: null, end: null, distance: 0, same_vehicle: true },
				{ start: 12_000, end: null, distance: null, same_vehicle: true },
			]);
		});
	});
}
