/**
 * #1218 contract of work records on PostgreSQL: dividing completed work in append
 * admission through `applyWorkRecordChange`, inside the real work transaction.
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
	organizationId: "t1218-org",
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
	getOrganizationBaseUrl: async () => "https://t1218.example.test",
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
const { monthClosedRefusalOf } = await import("../closed-months/refusal");
const { applyWorkRecordChange, readWorkRecord } = await import(".");
const { expectRecordAgreement } = await import("./__tests__/expect-record-agreement");
type DivideWorkRecord = import(".").DivideWorkRecord;
type WorkRecordExpected = import(".").WorkRecordExpected;

const ORG = "t1218-org";
const ids = {
	owner: "e1218000-0000-4000-8000-000000000001",
	manager: "e1218000-0000-4000-8000-000000000002",
	requester: "e1218000-0000-4000-8000-000000000003",
	project: "e1218000-0000-4000-8000-000000000021",
	customer: "e1218000-0000-4000-8000-000000000022",
	costCenter: "e1218000-0000-4000-8000-000000000031",
	van: "e1218000-0000-4000-8000-000000000041",
} as const;
type Person = "owner" | "manager" | "requester";
const userOf = (person: Person) => `t1218-${person}`;
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
	await admin.query("drop function if exists t1218_refuse() cascade");
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query('delete from "user" where id like $1', ["t1218-%"]);
}

async function seed() {
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
			[`t1218-member-${person}`, ORG, userOf(person), memberRole, SEEDED_AT],
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
		`insert into time_entry_append_control (organization_id, mode) values ($1, 'active')`,
		[ORG],
	);
}

/** Real adopted clock-in and clock-out of the requester, in the given zone. */
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

/** The requester's current expected state, as a caller reads it. */
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

function divide(
	expected: WorkRecordExpected,
	at: Instant,
	overrides: Partial<DivideWorkRecord> = {},
): DivideWorkRecord {
	return {
		kind: "divide",
		organizationId: ORG,
		employeeId: ids.requester,
		expected,
		at,
		notes: { before: null, after: null },
		actorUserId: userOf("requester"),
		entries: {
			createdBy: userOf("requester"),
			ipAddress: "203.0.113.7",
			deviceInfo: "t1218",
			capture: BERLIN_SUMMER,
		},
		appendOperation: "completed_work_split",
		...overrides,
	};
}

function apply(change: DivideWorkRecord) {
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
		   (select json_agg(row_to_json(t) order by t.id) from period_submission t where organization_id = $1) as submissions,
		   (select json_agg(row_to_json(t) order by t.id) from invoiced_work t where organization_id = $1) as invoiced`,
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
		record_created_by: string;
		record_updated_by: string | null;
		clock_out_notes: string | null;
		allocations: string[];
	}>(
		`select wp.id, wp.clock_in_id, wp.clock_out_id, wp.start_time, wp.end_time, wp.duration_minutes,
		        wp.graph_revision, wp.canonical_record_id, tr.created_by as record_created_by,
		        tr.updated_by as record_updated_by, clock_out.notes as clock_out_notes,
		        (select array_agg(a.allocation_kind || ':' || coalesce(a.project_id::text, a.cost_center_id::text)
		           order by a.allocation_kind::text) from time_record_allocation a where a.record_id = tr.id) as allocations
		 from work_period wp
		 join time_record tr on tr.id = wp.canonical_record_id
		 join time_entry clock_out on clock_out.id = wp.clock_out_id
		 where wp.organization_id = $1 and wp.deleted_at is null
		 order by wp.start_time`,
		[ORG],
	);
	return rows;
}

describe("work records: divide in append admission on PostgreSQL (#1218)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

	beforeEach(async () => {
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("divides the work period and its canonical work record together, in agreement", async () => {
		const source = await recordWork();
		await admin.query(
			`insert into time_record_allocation (organization_id, record_id, allocation_kind, cost_center_id, weight_percent)
			 values ($1, $2, 'cost_center', $3, 100)`,
			[ORG, source.canonical_record_id, ids.costCenter],
		);
		const { rows: tipBefore } = await admin.query<{ tip_entry_id: string }>(
			"select tip_entry_id from time_entry_append_position where employee_id = $1",
			[ids.requester],
		);
		const expected = await expectedOf(source.id);

		const result = await apply(
			divide(expected, parseInstant("2026-07-22T12:00:00Z"), {
				notes: { before: "Morning", after: "Afternoon" },
			}),
		);

		await expectRecordAgreement({ organizationId: ORG });
		if (result.kind !== "divided") throw new Error(`refused: ${result.kind}`);
		const [retained, generated] = await segments();
		// Each half rounds its own exact elapsed time.
		expect(retained).toMatchObject({
			id: source.id,
			clock_in_id: source.clock_in_id,
			end_time: new Date("2026-07-22T12:00:00Z"),
			duration_minutes: 239,
			graph_revision: source.graph_revision + 1,
			canonical_record_id: source.canonical_record_id,
			record_updated_by: userOf("requester"),
			allocations: [`cost_center:${ids.costCenter}`, `project:${ids.project}`],
			clock_out_notes: "Morning",
		});
		expect(generated).toMatchObject({
			clock_out_id: source.clock_out_id,
			start_time: new Date("2026-07-22T12:00:00Z"),
			end_time: new Date("2026-07-22T17:00:31Z"),
			duration_minutes: 301,
			graph_revision: 1,
			record_created_by: userOf("requester"),
			allocations: [`cost_center:${ids.costCenter}`, `project:${ids.project}`],
			clock_out_notes: "Afternoon",
		});
		expect(result).toMatchObject({
			source: {
				segment: { workPeriodId: source.id, durationMinutes: 540 },
				revision: source.graph_revision,
				clockOutNotes: null,
			},
			retained: {
				segment: { workPeriodId: source.id, durationMinutes: 239, endAt: "2026-07-22T12:00:00Z" },
				after: { workPeriodId: source.id, revision: source.graph_revision + 1 },
			},
			generated: {
				segment: {
					workPeriodId: generated?.id,
					clockOutEntryId: source.clock_out_id,
					durationMinutes: 301,
				},
				after: { workPeriodId: generated?.id, revision: 1 },
			},
			appended: {
				admission: "append",
				clockOut: {
					entryId: retained?.clock_out_id,
					previousEntryId: only(tipBefore).tip_entry_id,
				},
				clockIn: { entryId: generated?.clock_in_id, previousEntryId: retained?.clock_out_id },
			},
		});
		const { rows: entries } = await admin.query(
			`select type, utc_offset_minutes, timezone, timezone_source, ip_address, created_by
			 from time_entry where id = any($1::uuid[]) order by type desc`,
			[[retained?.clock_out_id, generated?.clock_in_id]],
		);
		expect(entries).toEqual(
			["clock_out", "clock_in"].map((type) => ({
				type,
				utc_offset_minutes: 120,
				timezone: "Europe/Berlin",
				timezone_source: "user_setting",
				ip_address: "203.0.113.7",
				created_by: userOf("requester"),
			})),
		);
	});

	it("chains a second change through the returned expected state; the earlier one is stale", async () => {
		const source = await recordWork();
		const expected = await expectedOf(source.id);
		const first = await apply(divide(expected, parseInstant("2026-07-22T12:00:00Z")));
		if (first.kind !== "divided") throw new Error(`refused: ${first.kind}`);

		const second = await apply(divide(first.generated.after, parseInstant("2026-07-22T15:00:00Z")));
		const third = await apply(divide(first.retained.after, parseInstant("2026-07-22T10:00:00Z")));

		expect([second.kind, third.kind]).toEqual(["divided", "divided"]);
		expect((await segments()).map(({ duration_minutes }) => duration_minutes)).toEqual([
			119, 120, 180, 121,
		]);
		await expectRecordAgreement({ organizationId: ORG });
		const before = await snapshot();
		await expect(apply(divide(expected, parseInstant("2026-07-22T09:00:00Z")))).resolves.toEqual({
			kind: "stale",
			current: { revision: source.graph_revision + 2 },
		});
		expect(await snapshot()).toEqual(before);
	});

	it.each([
		["another revision", (expected: WorkRecordExpected) => ({ revision: expected.revision + 1 })],
		["another end", () => ({ endAt: parseInstant("2026-07-22T17:00:00Z") })],
		["another clock-out", () => ({ clockOutId: randomUUID() })],
	])("refuses a stale expected state (%s) without writing", async (_label, change) => {
		const source = await recordWork();
		const expected = await expectedOf(source.id);
		const before = await snapshot();

		await expect(
			apply(divide({ ...expected, ...change(expected) }, parseInstant("2026-07-22T12:00:00Z"))),
		).resolves.toMatchObject({ kind: "stale" });
		expect(await snapshot()).toEqual(before);
	});

	it("refuses a pair that disagrees as canonical_divergence without writing", async () => {
		const source = await recordWork();
		await admin.query(
			"update time_record_work set work_location_type = 'home' where record_id = $1",
			[source.canonical_record_id],
		);
		const expected = await expectedOf(source.id);
		const before = await snapshot();

		await expect(apply(divide(expected, parseInstant("2026-07-22T12:00:00Z")))).resolves.toEqual({
			kind: "canonical_divergence",
			found: "locked_pair",
			disagreements: ["work_location"],
		});
		expect(await snapshot()).toEqual(before);
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
			divide(await expectedOf(source.id), parseInstant("2026-07-11T03:00:00Z"), {
				entries: {
					createdBy: userOf("requester"),
					ipAddress: null,
					deviceInfo: null,
					capture: {
						utcOffsetMinutes: -240,
						timezone: "America/New_York",
						timezoneSource: "browser",
					},
				},
			}),
		);

		expect(result).toMatchObject({ effects: { workBalanceDirtyFromDate: "2026-07-10" } });
		const { rows } = await admin.query(
			"select is_dirty, dirty_from_date::text from employee_work_balance where employee_id = $1",
			[ids.requester],
		);
		expect(only(rows)).toEqual({ is_dirty: true, dirty_from_date: "2026-07-10" });
	});

	it("sends a submitted period back to the employee", async () => {
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

		await expect(
			apply(divide(await expectedOf(source.id), parseInstant("2026-07-22T12:00:00Z"))),
		).resolves.toMatchObject({ kind: "divided" });

		const { rows } = await admin.query(
			"select status, closed_cause from period_submission where organization_id = $1 and id = $2",
			[ORG, submitted.submissionId],
		);
		expect(only(rows)).toEqual({ status: "withdrawn", closed_cause: "change" });
	});

	it("keeps invoiced work invoiced in the generated half", async () => {
		const source = await recordWork();
		const { rows: drafts } = await admin.query<{ id: string }>(
			`with connection as (
			   insert into accounting_connection
			     (organization_id, provider_kind, status, account_ref, default_tax_treatment, default_tax_rate)
			   values ($1, 'lexware_office', 'active', 't1218-account', 'domestic_standard', 19)
			   returning id
			 )
			 insert into invoice_draft
			   (organization_id, connection_id, provider_kind, customer_id, status, idempotency_key, contact_id,
			    contact_name, currency, tax_treatment, tax_rate, period_from, period_to, title, net_total,
			    external_id, confirmed_at)
			 select $1, connection.id, 'lexware_office', $2, 'created', gen_random_uuid()::text, 'c-1',
			        'Acme', 'EUR', 'domestic_standard', 19, '2026-07-01', '2026-07-31', 'Invoice', 100.00,
			        'draft-1', now()
			   from connection
			 returning id`,
			[ORG, ids.customer],
		);
		await admin.query(
			`insert into invoiced_work
			   (organization_id, invoice_draft_id, work_period_id, employee_id, project_id, started_at, ended_at,
			    start_offset_minutes, duration_minutes)
			 select organization_id, $3, id, employee_id, project_id, start_time, end_time, 120, duration_minutes
			   from work_period where organization_id = $1 and id = $2`,
			[ORG, source.id, only(drafts).id],
		);

		const result = await apply(
			divide(await expectedOf(source.id), parseInstant("2026-07-22T12:00:00Z")),
		);
		if (result.kind !== "divided") throw new Error(`refused: ${result.kind}`);

		const { rows } = await admin.query(
			`select work_period_id, carried_from_work_period_id from invoiced_work
			 where organization_id = $1 order by carried_from_work_period_id nulls first`,
			[ORG],
		);
		expect(rows).toEqual([
			{ work_period_id: source.id, carried_from_work_period_id: null },
			{
				work_period_id: result.generated.segment.workPeriodId,
				carried_from_work_period_id: source.id,
			},
		]);
	});

	describe("vehicle use across the instant", () => {
		async function driveVan(period: { id: string; canonical_record_id: string }) {
			await admin.query(
				`insert into vehicle_use_setting (organization_id, enabled) values ($1, true)
				 on conflict (organization_id) do update set enabled = excluded.enabled`,
				[ORG],
			);
			await admin.query(
				`insert into vehicle_use_assignment (organization_id, assignment_type, priority, mode, created_by)
				 values ($1, 'organization', 0, 'asked', $2)`,
				[ORG, userOf("owner")],
			);
			await admin.query(
				`insert into organization_vehicle (id, organization_id, name, licence_plate)
				 values ($1, $2, 'Van', 'B-VN 1218')`,
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

		it("divides the readings at the reading given for the instant", async () => {
			const source = await recordWork();
			await driveVan(source);

			await expect(
				apply(
					divide(await expectedOf(source.id), parseInstant("2026-07-22T12:00:00Z"), {
						odometerKm: 12_040,
					}),
				),
			).resolves.toMatchObject({ kind: "divided" });

			await expectRecordAgreement({ organizationId: ORG });
			expect(await kilometres()).toEqual([
				{ start: 12_000, end: 12_040, distance: 40, same_vehicle: true },
				{ start: 12_040, end: 12_085, distance: 45, same_vehicle: true },
			]);
		});

		it("leaves both cut readings missing without a reading", async () => {
			const source = await recordWork();
			await driveVan(source);

			await expect(
				apply(divide(await expectedOf(source.id), parseInstant("2026-07-22T12:00:00Z"))),
			).resolves.toMatchObject({ kind: "divided" });

			await expectRecordAgreement({ organizationId: ORG });
			expect(await kilometres()).toEqual([
				{ start: 12_000, end: null, distance: null, same_vehicle: true },
				{ start: null, end: 12_085, distance: null, same_vehicle: true },
			]);
		});
	});

	describe("closed months", () => {
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

			await expect(apply(divide(expected, parseInstant("2026-07-22T12:00:00Z")))).resolves.toEqual({
				kind: "month_closed",
				month: "2026-07",
			});
			expect(await snapshot()).toEqual(before);
		});

		it("throws the database's refusal instead of returning it", async () => {
			const source = await recordWork();
			const expected = await expectedOf(source.id);
			// The database refuses what the pre-check let through (ADR 0004).
			await admin.query(
				`create function t1218_refuse() returns trigger language plpgsql as $$
				 begin raise exception 'closed' using errcode = 'Z8M01', detail = '2026-07'; end $$`,
			);
			await admin.query(
				"create trigger t1218_refuse before insert on time_record for each row execute function t1218_refuse()",
			);
			const before = await snapshot();
			try {
				const refused = await apply(divide(expected, parseInstant("2026-07-22T12:00:00Z"))).then(
					() => null,
					(error: unknown) => error,
				);
				expect(monthClosedRefusalOf(refused)?.month).toBe("2026-07");
			} finally {
				await admin.query("drop function t1218_refuse() cascade");
			}
			expect(await snapshot()).toEqual(before);
		});
	});
});
