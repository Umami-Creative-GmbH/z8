/**
 * Ticket #1929 (Spec #1921): retrospective leaving dates (Has Left), strictly
 * date-only past-date correction, historical legacy leaving-date backfill, and
 * scalable cursor/search-bounded replacement picker queries against PostgreSQL.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/queue", async (original) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(original),
);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const { createDepartureCommands, DepartureCommandError } = await import("./commands");
const { previewPastDeparture } = await import("./queries");
const { getReplacementEmployeeById, searchReplacementEmployees } =
	await import("./replacement-search");
const { createLifecycleDatabaseFixture } = await import("./testing/database.test.fixture");
type LifecycleDatabaseFixture = import("./testing/database.test.fixture").LifecycleDatabaseFixture;
type SeededEmployee = import("./testing/database.test.fixture").SeededEmployee;
type DepartureClockOutPort = import("./types").DepartureClockOutPort;
const { savePayrollAccessGrant } = await import("@/lib/payroll-access/grant-store");
const { seedPersonnelFileOfficerGrant } =
	await import("@/lib/personnel-file/testing/officer-grant.test.fixture");
const { issueKioskBadge } = await import("@/lib/time-tracking/kiosk/badge-store");
const { registerKioskFob } = await import("@/lib/time-tracking/kiosk/fob-store");
const { saveExpenseOfficerGrant } =
	await import("@/lib/travel-expenses/expense-officer-grant-store");

const clockOut: DepartureClockOutPort = {
	async close() {
		return { kind: "not_running" };
	},
};

// "Today" during the tests is 2026-10-10T12:00:00Z (organization timezone is UTC).
const TODAY = parseInstant("2026-10-10T12:00:00Z");
// Items granted/issued AFTER the retroactive cutoff (2026-08-16T00:00:00Z for 2026-08-15).
const AFTER_CUTOFF = parseInstant("2026-09-05T10:00:00Z");

describe("retrospective leaving dates, date-only corrections, historical backfill, and replacement search (#1929)", () => {
	let fixture: LifecycleDatabaseFixture;
	let now: Instant = TODAY;
	const clock = { nowInstant: () => now };

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function commands() {
		return createDepartureCommands({ db: fixture.db, clock, clockOut });
	}

	function ownerActor() {
		return { userId: fixture.ownerUserId, organizationId: fixture.organizationId };
	}

	async function seedKiosk() {
		const location = randomUUID();
		const kiosk = randomUUID();
		await fixture.pool.query(
			`insert into location (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, $4, $3, now())`,
			[location, fixture.organizationId, fixture.ownerUserId, `Store ${location}`],
		);
		await fixture.pool.query(
			`insert into kiosk (id, organization_id, location_id, name, timezone, updated_at)
			 values ($1, $2, $3, 'Front door', 'UTC', now())`,
			[kiosk, fixture.organizationId, location],
		);
		return kiosk;
	}

	async function seedPostCutoffWork(person: SeededEmployee, startIso: string, endIso: string) {
		const clockInId = randomUUID();
		const clockOutId = randomUUID();
		const canonicalRecordId = randomUUID();
		const workPeriodId = randomUUID();
		await fixture.pool.query(
			`insert into time_entry
			 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone, timezone_source, hash, created_by)
			 values
			 ($1, $3, $4, 'clock_in', $5, 0, 'UTC', 'organization', $7, $8),
			 ($2, $3, $4, 'clock_out', $6, 0, 'UTC', 'organization', $9, $8)`,
			[
				clockInId,
				clockOutId,
				person.employeeId,
				fixture.organizationId,
				new Date(startIso),
				new Date(endIso),
				createHash("sha256").update(clockInId).digest("hex"),
				fixture.ownerUserId,
				createHash("sha256").update(clockOutId).digest("hex"),
			],
		);
		await fixture.pool.query(
			`insert into time_record
			 (id, organization_id, employee_id, record_kind, start_at, end_at, duration_minutes, approval_state, origin, created_by, updated_at)
			 values ($1, $2, $3, 'work', $4, $5, 480, 'approved', 'manual', $6, now())`,
			[
				canonicalRecordId,
				fixture.organizationId,
				person.employeeId,
				new Date(startIso),
				new Date(endIso),
				fixture.ownerUserId,
			],
		);
		await fixture.pool.query(
			`insert into work_period
			 (id, employee_id, organization_id, clock_in_id, clock_out_id, canonical_record_id, start_time, end_time, duration_minutes, is_active, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, 480, false, now())`,
			[
				workPeriodId,
				person.employeeId,
				fixture.organizationId,
				clockInId,
				clockOutId,
				canonicalRecordId,
				new Date(startIso),
				new Date(endIso),
			],
		);
		return { workPeriodId, clockInId, clockOutId };
	}

	async function seedClosedMonth(
		person: SeededEmployee,
		month: string,
		rangeStartIso: string,
		rangeEndIso: string,
	) {
		const closedMonthId = randomUUID();
		const closedMonthEmployeeId = randomUUID();
		await fixture.pool.query(
			`insert into closed_month
			 (id, organization_id, month, scope, covers_new_employees, actor_kind, closed_by, closed_at)
			 values ($1, $2, $3, 'organization', false, 'user', $4, '2026-09-02T00:00:00Z')`,
			[closedMonthId, fixture.organizationId, month, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into closed_month_employee
			 (id, organization_id, closed_month_id, employee_id, month, range_start, range_end, timezone)
			 values ($1, $2, $3, $4, $5, $6, $7, 'UTC')`,
			[
				closedMonthEmployeeId,
				fixture.organizationId,
				closedMonthId,
				person.employeeId,
				month,
				new Date(rangeStartIso),
				new Date(rangeEndIso),
			],
		);
		return { closedMonthId, closedMonthEmployeeId };
	}

	async function seedSettledDay(person: SeededEmployee, date: string, creditedMinutes = 480) {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into payroll_settled_day
			 (id, organization_id, employee_id, date, timezone, credited_minutes, absences, method, settled_by, settled_at)
			 values ($1, $2, $3, $4, 'UTC', $5, '[]'::jsonb, 'manual', $6, '2026-09-03T00:00:00Z')`,
			[id, fixture.organizationId, person.employeeId, date, creditedMinutes, fixture.ownerUserId],
		);
		return id;
	}

	async function seedConfirmedTerms(
		person: SeededEmployee,
		validFromDate: string,
		validUntilDate: string | null = null,
	) {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into employee_employment_history
			 (id, employee_id, organization_id, employment_period_id, valid_from, valid_until,
			  valid_from_date, valid_until_date, status, contract_type, weekly_contract_minutes,
			  review_state, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, 'active', 'fixed', 2400, 'confirmed', $9, now())`,
			[
				id,
				person.employeeId,
				fixture.organizationId,
				person.employmentPeriodId,
				new Date(`${validFromDate}T00:00:00Z`),
				validUntilDate ? new Date(`${validUntilDate}T00:00:00Z`) : null,
				validFromDate,
				validUntilDate,
				fixture.ownerUserId,
			],
		);
		return id;
	}

	/**
	 * Seeds all 8 employment-ending participant holdings with timestamps AFTER the
	 * retroactive cutoff (2026-08-16T00:00:00Z) to prove GREATEST-clamping avoids
	 * every check constraint failure.
	 */
	async function seedAllEightParticipantsAfterCutoff(
		person: SeededEmployee,
		absent: SeededEmployee,
	) {
		const afterClock = { nowInstant: () => AFTER_CUTOFF };
		// 1. Officer grants (expense, payroll, personnel file)
		await fixture.db.transaction((tx) =>
			saveExpenseOfficerGrant(tx, {
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				grant: {
					officerEmployeeId: person.employeeId,
					scope: "all",
					teamIds: [],
					employeeIds: [],
					canExport: true,
					canRecordReimbursements: true,
				},
			}),
		);
		await fixture.db.transaction((tx) =>
			savePayrollAccessGrant(tx, {
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				grant: {
					payrollEmployeeId: person.employeeId,
					scope: "all",
					teamIds: [],
					employeeIds: [],
				},
			}),
		);
		await seedPersonnelFileOfficerGrant(fixture.pool, {
			organizationId: fixture.organizationId,
			officerEmployeeId: person.employeeId,
			createdBy: fixture.ownerUserId,
		});
		// 2. Equipment officer grant (updated_at after cutoff)
		await fixture.pool.query(
			`insert into equipment_officer_grant (organization_id, employee_id, scope, updated_at)
			 values ($1, $2, 'all', $3)`,
			[fixture.organizationId, person.employeeId, new Date(AFTER_CUTOFF.epochMilliseconds)],
		);
		// 3. Driving licence authorization (last_successful_at after cutoff) & verifier grant (granted_at after cutoff)
		const drivingCheckId = randomUUID();
		await fixture.pool.query(
			`insert into driving_licence_check
			 (id, organization_id, employee_id, employment_period_id, verifier_employee_id, verifier_user_id,
			  employee_name, verifier_name, controlled_at, command_id, policy_version, interval_months,
			  deadline_timezone, document_issued_on, document_expires_on, original_inspected, identity_confirmed,
			  employee_declaration, declaration_text, verifier_confirmed, classes, failure_scope)
			 values ($1, $2, $3, $4, $5, $6, 'Lifecycle', 'Owner', $7, $8, 1, 6, 'UTC', '2020-01-01', '2030-01-01',
			  true, true, true, 'Declared', true, '[{"classCode":"B","outcome":"pass","restrictions":""}]'::jsonb, 'classes')`,
			[
				drivingCheckId,
				fixture.organizationId,
				person.employeeId,
				person.employmentPeriodId,
				fixture.ownerEmployeeId,
				fixture.ownerUserId,
				new Date(AFTER_CUTOFF.epochMilliseconds),
				randomUUID(),
			],
		);
		await fixture.pool.query(
			`insert into driving_authorization
			 (organization_id, employee_id, employment_period_id, class_code, supporting_check_id, last_successful_at,
			  routine_valid_through, document_valid_through, valid_through, deadline_timezone,
			  expires_at, restrictions, state)
			 values ($1, $2, $3, 'B', $4, $5, '2027-03-01', '2028-01-01', '2027-03-01', 'UTC',
			  '2027-03-02T00:00:00Z', '', 'active')`,
			[
				fixture.organizationId,
				person.employeeId,
				person.employmentPeriodId,
				drivingCheckId,
				new Date(AFTER_CUTOFF.epochMilliseconds),
			],
		);
		await fixture.pool.query(
			`insert into driving_licence_verifier_grant
			 (organization_id, verifier_employee_id, employment_period_id, scope, granted_at, granted_by)
			 values ($1, $2, $3, 'all', $4, $5)`,
			[
				fixture.organizationId,
				person.employeeId,
				person.employmentPeriodId,
				new Date(AFTER_CUTOFF.epochMilliseconds),
				fixture.ownerUserId,
			],
		);
		// 4. Document request (created_at after cutoff)
		const requestId = randomUUID();
		await fixture.pool.query(
			`insert into employee_document_request
			 (id, organization_id, employee_id, category, title, deadline, status, created_by, created_at, updated_at)
			 values ($1, $2, $3, 'certificate', 'Certificate', '2026-11-01', 'open', $4, $5, $5)`,
			[
				requestId,
				fixture.organizationId,
				person.employeeId,
				fixture.ownerUserId,
				new Date(AFTER_CUTOFF.epochMilliseconds),
			],
		);
		await fixture.pool.query(
			`insert into employee_document_request_event (organization_id, request_id, kind, occurred_at)
			 values ($1, $2, 'created', $3)`,
			[fixture.organizationId, requestId, new Date(AFTER_CUTOFF.epochMilliseconds)],
		);
		// 5. Kiosk badge (issued_at after cutoff)
		await issueKioskBadge(
			fixture.db,
			{
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				employeeId: person.employeeId,
			},
			async () => null,
			afterClock,
		);
		// 6. Kiosk fob (registered_at after cutoff)
		await registerKioskFob(
			fixture.db,
			{
				organizationId: fixture.organizationId,
				kioskId: await seedKiosk(),
				employeeId: person.employeeId,
				serial: randomUUID().replaceAll("-", "").slice(0, 14).toUpperCase(),
			},
			afterClock,
		);
		// 7. Report share link (created_at after cutoff)
		await fixture.pool.query(
			`insert into report_share_link
			 (organization_id, created_by, creator_employee_id, kind, project_ids, from_day, to_day, figures,
			  creator_locale, token_digest, token_hash_version, snapshot, created_at, expires_at)
			 values ($1, $2, $3, 'project', array[$4::uuid], '2026-08-01', '2026-08-31', 'hours', 'en', $5, 'v1',
			  '{}'::jsonb, $6, '2026-12-01T00:00:00Z')`,
			[
				fixture.organizationId,
				person.userId,
				person.employeeId,
				randomUUID(),
				createHash("sha256").update(randomUUID()).digest("hex"),
				new Date(AFTER_CUTOFF.epochMilliseconds),
			],
		);
		// 8. Deputy assignment
		const category = await fixture.pool.query<{ id: string }>(
			`insert into absence_category
			 (organization_id, type, name, requires_approval, counts_against_vacation, deputy_required,
			  is_active, updated_at)
			 values ($1, 'vacation', $2, true, false, true, true, now()) returning id`,
			[fixture.organizationId, `Retro Category ${randomUUID()}`],
		);
		await fixture.pool.query(
			`insert into absence_entry
			 (employee_id, category_id, start_date, end_date, status, organization_id, deputy_employee_id, updated_at)
			 values ($1, $2, '2026-09-28', '2026-10-09', 'approved', $3, $4, now())`,
			[absent.employeeId, category.rows[0]?.id, fixture.organizationId, person.employeeId],
		);
	}

	it("previews retrospective departure read-only and rejects today/future or before-start dates", async () => {
		now = TODAY;
		const person = await fixture.seedEmployee({ startDate: new Date("2026-03-01T00:00:00Z") });
		await fixture.pool.query(
			`update employee_employment_period set started_at = '2026-03-01T00:00:00Z' where id = $1`,
			[person.employmentPeriodId],
		);
		const work = await seedPostCutoffWork(person, "2026-08-20T08:00:00Z", "2026-08-20T16:00:00Z");
		await seedClosedMonth(person, "2026-08-01", "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z");
		await seedSettledDay(person, "2026-08-20");

		// Rejects today and future
		expect(
			await previewPastDeparture(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: person.employeeId,
				actorUserId: fixture.ownerUserId,
				lastWorkingDay: "2026-10-10",
				now,
			}),
		).toEqual({ kind: "invalid", code: "departure_date_not_in_past" });
		expect(
			await previewPastDeparture(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: person.employeeId,
				actorUserId: fixture.ownerUserId,
				lastWorkingDay: "2026-10-15",
				now,
			}),
		).toEqual({ kind: "invalid", code: "departure_date_not_in_past" });

		// Rejects before employment start
		expect(
			await previewPastDeparture(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: person.employeeId,
				actorUserId: fixture.ownerUserId,
				lastWorkingDay: "2026-02-28",
				now,
			}),
		).toEqual({ kind: "invalid", code: "departure_before_employment_start" });

		// Valid past preview: read-only, accurately reports work & closed/settled payroll impact
		const preview = await previewPastDeparture(fixture.db, {
			organizationId: fixture.organizationId,
			employeeId: person.employeeId,
			actorUserId: fixture.ownerUserId,
			lastWorkingDay: "2026-08-15",
			now,
		});
		expect(preview.kind).toBe("ok");
		if (preview.kind !== "ok") throw new Error("expected ok preview");
		expect(preview.preview.lastWorkingDay).toBe("2026-08-15");
		expect(preview.preview.cutoff).toBe("2026-08-16T00:00:00Z");
		expect(preview.preview.impact.requiresWorkAfterCutoffReview).toBe(true);
		expect(preview.preview.impact.workAfterCutoff.workPeriodCount).toBe(1);
		expect(preview.preview.impact.workAfterCutoff.workPeriodIds).toEqual([work.workPeriodId]);
		expect(preview.preview.impact.workAfterCutoff.timeEntryCount).toBe(2);
		expect(preview.preview.impact.requiresPayrollReconciliationReview).toBe(true);
		expect(preview.preview.impact.payrollReconciliation.closedMonths).toEqual(["2026-08"]);
		expect(preview.preview.impact.payrollReconciliation.settledDayCount).toBe(1);
		expect(preview.preview.impact.payrollReconciliation.settledDates).toEqual(["2026-08-20"]);
		expect(preview.preview.exceptions).toEqual(
			expect.arrayContaining(["work_after_cutoff", "payroll_reconciliation"]),
		);

		// Strictly read-only: zero departure rows, reviews, or events written
		const counts = await fixture.pool.query<{
			departures: number;
			reviews: number;
			events: number;
		}>(
			`select
			  (select count(*)::int from employee_departure where employee_id = $1) as departures,
			  (select count(*)::int from employee_departure_review where employee_id = $1) as reviews,
			  (select count(*)::int from employee_departure_event where employee_id = $1) as events`,
			[person.employeeId],
		);
		expect(counts.rows[0]).toEqual({ departures: 0, reviews: 0, events: 0 });
	});

	it("records a retrospective departure executing all 8 clamped participants, opening durable reviews, superseding pending scheduled departure, and leaving closed/settled payroll 100% untouched", async () => {
		now = TODAY;
		const person = await fixture.seedEmployee();
		const absent = await fixture.seedEmployee();
		await seedConfirmedTerms(person, "2026-01-01", null);
		await seedAllEightParticipantsAfterCutoff(person, absent);
		await seedPostCutoffWork(person, "2026-08-22T08:00:00Z", "2026-08-22T16:00:00Z");
		await seedClosedMonth(person, "2026-08-01", "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z");
		const settledId = await seedSettledDay(person, "2026-08-22", 480);

		// Also create a pending scheduled departure (e.g. from fixed-term sync #1927) to verify superseding
		const scheduled = await commands().scheduleDeparture(ownerActor(), {
			employeeId: person.employeeId,
			requestId: randomUUID(),
			expectedRevision: null,
			lastWorkingDay: "2026-12-31",
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});

		// Snapshot closed/settled payroll rows BEFORE retrospective departure
		const closedBefore = await fixture.pool.query(
			`select * from closed_month_employee where employee_id = $1 order by id`,
			[person.employeeId],
		);
		const settledBefore = await fixture.pool.query(
			`select * from payroll_settled_day where employee_id = $1 order by id`,
			[person.employeeId],
		);

		const requestId = randomUUID();
		const result = await commands().recordPastDeparture(ownerActor(), {
			employeeId: person.employeeId,
			requestId,
			lastWorkingDay: "2026-08-15",
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});

		expect(result).toMatchObject({
			employmentPeriodId: person.employmentPeriodId,
			lastWorkingDay: "2026-08-15",
			cutoff: "2026-08-16T00:00:00Z",
			workAfterCutoffReviewOpened: true,
			payrollReconciliationReviewOpened: true,
		});

		// Replay with the same requestId is idempotent
		const replayed = await commands().recordPastDeparture(ownerActor(), {
			employeeId: person.employeeId,
			requestId,
			lastWorkingDay: "2026-08-15",
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
		expect(replayed.departureId).toBe(result.departureId);

		// Pending scheduled departure was superseded (status canceled + departure_superseded event)
		const supersededRow = await fixture.pool.query<{ status: string }>(
			`select status from employee_departure where id = $1`,
			[scheduled.departureId],
		);
		expect(supersededRow.rows[0]?.status).toBe("canceled");
		const supersededEvents = await fixture.pool.query<{ kind: string }>(
			`select kind from employee_departure_event where departure_id = $1 and kind = 'departure_superseded'`,
			[scheduled.departureId],
		);
		expect(supersededEvents.rows).toHaveLength(1);

		// All 8 employment-ending participants ended with timestamps clamped >= issued/granted/registered/created_at
		const held = await fixture.pool.query<Record<string, number>>(
			`select
			  (select count(*)::int from expense_officer_grant where organization_id = $1 and officer_employee_id = $2 and is_active) as "expenseOfficer",
			  (select count(*)::int from payroll_access_grant where organization_id = $1 and payroll_employee_id = $2 and is_active) as "payrollAccess",
			  (select count(*)::int from personnel_file_officer_grant where organization_id = $1 and officer_employee_id = $2 and is_active) as "personnelFileOfficer",
			  (select count(*)::int from equipment_officer_grant where organization_id = $1 and employee_id = $2 and revoked_at is null) as "equipmentOfficer",
			  (select count(*)::int from driving_authorization where organization_id = $1 and employee_id = $2 and state <> 'ended') as "drivingAuth",
			  (select count(*)::int from driving_licence_verifier_grant where organization_id = $1 and verifier_employee_id = $2 and revoked_at is null) as "drivingVerifier",
			  (select count(*)::int from employee_document_request where organization_id = $1 and employee_id = $2 and status in ('open', 'submitted')) as "documentRequests",
			  (select count(*)::int from employee_kiosk_badge where organization_id = $1 and employee_id = $2 and revoked_at is null) as "kioskBadges",
			  (select count(*)::int from employee_kiosk_fob where organization_id = $1 and employee_id = $2 and ended_at is null) as "kioskFobs",
			  (select count(*)::int from report_share_link where organization_id = $1 and creator_employee_id = $2 and revoked_at is null) as "reportShareLinks",
			  (select count(*)::int from absence_entry where organization_id = $1 and deputy_employee_id = $2) as "deputyAssignments"`,
			[fixture.organizationId, person.employeeId],
		);
		expect(held.rows[0]).toEqual({
			expenseOfficer: 0,
			payrollAccess: 0,
			personnelFileOfficer: 0,
			equipmentOfficer: 0,
			drivingAuth: 0,
			drivingVerifier: 0,
			documentRequests: 0,
			kioskBadges: 0,
			kioskFobs: 0,
			reportShareLinks: 0,
			deputyAssignments: 0,
		});

		// Verify timestamps were clamped to AFTER_CUTOFF (never before issued/granted/registered_at)
		const afterMs = AFTER_CUTOFF.epochMilliseconds;
		const badgeRow = await fixture.pool.query<{ revoked_at: Date }>(
			`select revoked_at from employee_kiosk_badge where employee_id = $1`,
			[person.employeeId],
		);
		expect(badgeRow.rows[0]?.revoked_at.getTime()).toBeGreaterThanOrEqual(afterMs);
		const fobRow = await fixture.pool.query<{ ended_at: Date }>(
			`select ended_at from employee_kiosk_fob where employee_id = $1`,
			[person.employeeId],
		);
		expect(fobRow.rows[0]?.ended_at.getTime()).toBeGreaterThanOrEqual(afterMs);
		const verifierRow = await fixture.pool.query<{ revoked_at: Date }>(
			`select revoked_at from driving_licence_verifier_grant where verifier_employee_id = $1`,
			[person.employeeId],
		);
		expect(verifierRow.rows[0]?.revoked_at.getTime()).toBeGreaterThanOrEqual(afterMs);
		const shareRow = await fixture.pool.query<{ revoked_at: Date }>(
			`select revoked_at from report_share_link where creator_employee_id = $1`,
			[person.employeeId],
		);
		expect(shareRow.rows[0]?.revoked_at.getTime()).toBeGreaterThanOrEqual(afterMs);

		// Closed months & settled payroll rows are 100% UNTOUCHED
		const closedAfter = await fixture.pool.query(
			`select * from closed_month_employee where employee_id = $1 order by id`,
			[person.employeeId],
		);
		const settledAfter = await fixture.pool.query(
			`select * from payroll_settled_day where employee_id = $1 order by id`,
			[person.employeeId],
		);
		expect(closedAfter.rows).toEqual(closedBefore.rows);
		expect(settledAfter.rows).toEqual(settledBefore.rows);
		expect(settledAfter.rows[0]?.id).toBe(settledId);
		expect(settledAfter.rows[0]?.unsettled_at).toBeNull();

		// Durable reviews created & departure_recorded_retrospectively event recorded
		const reviews = await fixture.pool.query<{ kind: string; status: string }>(
			`select kind, status from employee_departure_review where departure_id = $1 order by kind`,
			[result.departureId],
		);
		expect(reviews.rows).toEqual([
			{ kind: "payroll_reconciliation", status: "open" },
			{ kind: "work_after_cutoff", status: "open" },
		]);
		const events = await fixture.pool.query<{ kind: string }>(
			`select kind from employee_departure_event where departure_id = $1 order by id`,
			[result.departureId],
		);
		expect(events.rows.map((row) => row.kind)).toContain("departure_recorded_retrospectively");

		// Confirmed employment history row closed cleanly with valid_until_date = 2026-08-16
		const terms = await fixture.pool.query<{ valid_until_date: string }>(
			`select valid_until_date::text from employee_employment_history where employee_id = $1`,
			[person.employeeId],
		);
		expect(terms.rows[0]?.valid_until_date).toBe("2026-08-16");
	});

	it("corrects an effective past departure date strictly as a date-only adjustment, reconciles reviews, and refuses reopen attempts", async () => {
		now = TODAY;
		const person = await fixture.seedEmployee();
		const termsId = await seedConfirmedTerms(person, "2026-01-01", null);
		await seedPostCutoffWork(person, "2026-08-22T08:00:00Z", "2026-08-22T16:00:00Z");
		await seedClosedMonth(person, "2026-08-01", "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z");
		await seedSettledDay(person, "2026-08-22", 480);

		const recorded = await commands().recordPastDeparture(ownerActor(), {
			employeeId: person.employeeId,
			requestId: randomUUID(),
			lastWorkingDay: "2026-08-15",
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
		if (recorded.status !== "effective") throw new Error("expected effective departure");
		expect(recorded.workAfterCutoffReviewOpened).toBe(true);
		expect(recorded.payrollReconciliationReviewOpened).toBe(true);

		const settledBefore = await fixture.pool.query(
			`select * from payroll_settled_day where employee_id = $1`,
			[person.employeeId],
		);

		// REFUSES reopening attempts: today, future, blank
		await expect(
			commands().correctPastDepartureDate(ownerActor(), {
				employeeId: person.employeeId,
				departureId: recorded.departureId,
				expectedRevision: recorded.revision,
				requestId: randomUUID(),
				lastWorkingDay: "2026-10-10",
			}),
		).rejects.toMatchObject({ code: "departure_reopen_forbidden" });

		await expect(
			commands().correctPastDepartureDate(ownerActor(), {
				employeeId: person.employeeId,
				departureId: recorded.departureId,
				expectedRevision: recorded.revision,
				requestId: randomUUID(),
				lastWorkingDay: "2026-11-01",
			}),
		).rejects.toMatchObject({ code: "departure_reopen_forbidden" });

		await expect(
			commands().correctPastDepartureDate(ownerActor(), {
				employeeId: person.employeeId,
				departureId: recorded.departureId,
				expectedRevision: recorded.revision,
				requestId: randomUUID(),
				lastWorkingDay: "",
			}),
		).rejects.toThrow(DepartureCommandError);

		// REFUSES date before employment start
		await expect(
			commands().correctPastDepartureDate(ownerActor(), {
				employeeId: person.employeeId,
				departureId: recorded.departureId,
				expectedRevision: recorded.revision,
				requestId: randomUUID(),
				lastWorkingDay: "2025-12-31",
			}),
		).rejects.toMatchObject({ code: "departure_before_employment_start" });

		// Valid date-only correction moving lastWorkingDay to 2026-09-10 (past all Aug work & closed/settled payroll)
		const corrected = await commands().correctPastDepartureDate(ownerActor(), {
			employeeId: person.employeeId,
			departureId: recorded.departureId,
			expectedRevision: recorded.revision,
			requestId: randomUUID(),
			lastWorkingDay: "2026-09-10",
		});

		expect(corrected).toMatchObject({
			departureId: recorded.departureId,
			revision: recorded.revision + 1,
			previousLastWorkingDay: "2026-08-15",
			lastWorkingDay: "2026-09-10",
			cutoff: "2026-09-11T00:00:00Z",
			workAfterCutoffReviewOpened: false,
			payrollReconciliationReviewOpened: false,
		});

		// Employment period, confirmed terms, and employee.deactivated_at moved cleanly
		const stateRow = await fixture.pool.query<{
			ended_at: Date;
			deactivated_at: Date;
			valid_until_date: string;
		}>(
			`select p.ended_at, e.deactivated_at, h.valid_until_date::text
			 from employee_employment_period p
			 join employee e on e.id = p.employee_id
			 join employee_employment_history h on h.id = $2
			 where p.id = $1`,
			[person.employmentPeriodId, termsId],
		);
		expect(stateRow.rows[0]?.ended_at.toISOString()).toBe("2026-09-11T00:00:00.000Z");
		expect(stateRow.rows[0]?.deactivated_at.toISOString()).toBe("2026-09-11T00:00:00.000Z");
		expect(stateRow.rows[0]?.valid_until_date).toBe("2026-09-11");

		// Both previously open reviews were resolved since no discrepancy remains
		const resolvedReviews = await fixture.pool.query<{ kind: string; status: string }>(
			`select kind, status from employee_departure_review where departure_id = $1 order by kind`,
			[recorded.departureId],
		);
		expect(resolvedReviews.rows).toEqual([
			{ kind: "payroll_reconciliation", status: "resolved" },
			{ kind: "work_after_cutoff", status: "resolved" },
		]);

		// departure_date_corrected event recorded with old & new date metadata
		const correctedEvents = await fixture.pool.query<{
			kind: string;
			metadata: Record<string, unknown>;
		}>(
			`select kind, metadata from employee_departure_event
			 where departure_id = $1 and kind = 'departure_date_corrected'`,
			[recorded.departureId],
		);
		expect(correctedEvents.rows).toHaveLength(1);
		expect(correctedEvents.rows[0]?.metadata).toMatchObject({
			previousLastWorkingDay: "2026-08-15",
			newLastWorkingDay: "2026-09-10",
		});

		// Settled payroll still 100% untouched
		const settledAfter = await fixture.pool.query(
			`select * from payroll_settled_day where employee_id = $1`,
			[person.employeeId],
		);
		expect(settledAfter.rows).toEqual(settledBefore.rows);

		// Moving date back earlier reopens both reviews
		const movedBack = await commands().correctPastDepartureDate(ownerActor(), {
			employeeId: person.employeeId,
			departureId: recorded.departureId,
			expectedRevision: corrected.revision,
			requestId: randomUUID(),
			lastWorkingDay: "2026-08-18",
		});
		expect(movedBack.workAfterCutoffReviewOpened).toBe(true);
		expect(movedBack.payrollReconciliationReviewOpened).toBe(true);

		// Refuses overlapping a subsequent rehire period
		const rehirePeriodId = randomUUID();
		await fixture.pool.query(
			`insert into employee_employment_period
			 (id, organization_id, employee_id, status, started_at, start_provenance)
			 values ($1, $2, $3, 'open', '2026-09-01T00:00:00Z', 'recorded')`,
			[rehirePeriodId, fixture.organizationId, person.employeeId],
		);
		await expect(
			commands().correctPastDepartureDate(ownerActor(), {
				employeeId: person.employeeId,
				departureId: recorded.departureId,
				expectedRevision: movedBack.revision,
				requestId: randomUUID(),
				lastWorkingDay: "2026-09-05",
			}),
		).rejects.toMatchObject({ code: "departure_overlaps_rehire" });
	});

	it("backfills a historical leaving date for a legacy former employee without triggering active offboarding side effects", async () => {
		now = TODAY;
		const legacy = await fixture.seedEmployee({
			isActive: false,
			withPeriod: false,
			startDate: new Date("2024-01-15T00:00:00Z"),
			endDate: null,
		});
		// Seed a pre-existing officer grant & session to prove historical backfill NEVER triggers active teardown
		await fixture.pool.query(
			`insert into equipment_officer_grant (organization_id, employee_id, scope)
			 values ($1, $2, 'all')`,
			[fixture.organizationId, legacy.employeeId],
		);

		const result = await commands().recordHistoricalDepartureDate(ownerActor(), {
			employeeId: legacy.employeeId,
			requestId: randomUUID(),
			lastWorkingDay: "2025-06-30",
		});

		expect(result).toMatchObject({
			employeeId: legacy.employeeId,
			lastWorkingDay: "2025-06-30",
			cutoff: "2025-07-01T00:00:00Z",
		});

		// Employment period closed at 2025-07-01T00:00:00Z and employee dates populated
		const periodRow = await fixture.pool.query<{ status: string; ended_at: Date }>(
			`select status, ended_at from employee_employment_period where id = $1`,
			[result.employmentPeriodId],
		);
		expect(periodRow.rows[0]?.status).toBe("closed");
		expect(periodRow.rows[0]?.ended_at.toISOString()).toBe("2025-07-01T00:00:00.000Z");

		const empRow = await fixture.pool.query<{ deactivated_at: Date; end_date: Date }>(
			`select deactivated_at, end_date from employee where id = $1`,
			[legacy.employeeId],
		);
		expect(empRow.rows[0]?.deactivated_at.toISOString()).toBe("2025-07-01T00:00:00.000Z");
		expect(empRow.rows[0]?.end_date.toISOString()).toBe("2025-06-30T00:00:00.000Z");

		// ZERO active offboarding side effects: no employee_departure, no follow-up tasks, holdings untouched
		const sideEffects = await fixture.pool.query<{
			departures: number;
			tasks: number;
			equipmentOfficer: number;
			events: number;
		}>(
			`select
			  (select count(*)::int from employee_departure where employee_id = $1) as departures,
			  (select count(*)::int from employee_departure_task where employee_id = $1) as tasks,
			  (select count(*)::int from equipment_officer_grant where employee_id = $1 and revoked_at is null) as "equipmentOfficer",
			  (select count(*)::int from employee_departure_event where employee_id = $1 and kind = 'departure_date_corrected') as events`,
			[legacy.employeeId],
		);
		expect(sideEffects.rows[0]).toEqual({
			departures: 0,
			tasks: 0,
			equipmentOfficer: 1,
			events: 1,
		});

		// Rejects active employees
		const activeEmp = await fixture.seedEmployee();
		await expect(
			commands().recordHistoricalDepartureDate(ownerActor(), {
				employeeId: activeEmp.employeeId,
				requestId: randomUUID(),
				lastWorkingDay: "2025-06-30",
			}),
		).rejects.toMatchObject({ code: "employee_already_employed" });
	});

	it("searches eligible replacements with tenant isolation, target exclusion, filtering, and keyset pagination", async () => {
		now = TODAY;
		const orgA = await fixture.createOrganization();
		const orgB = await fixture.createOrganization();

		async function seedNamed(
			orgId: string,
			opts: {
				name: string;
				email: string;
				role: "admin" | "manager" | "employee";
				memberStatus?: "approved" | "pending";
				isActive?: boolean;
				position?: string;
			},
		) {
			const seeded = await fixture.seedEmployee({
				organizationId: orgId,
				role: opts.role === "admin" ? "admin" : "member",
				isActive: opts.isActive ?? true,
				withPeriod: opts.isActive !== false,
			});
			await fixture.pool.query(`update "user" set name = $2, email = $3 where id = $1`, [
				seeded.userId,
				opts.name,
				opts.email,
			]);
			await fixture.pool.query(`update employee set role = $2, position = $3 where id = $1`, [
				seeded.employeeId,
				opts.role,
				opts.position ?? null,
			]);
			if (opts.memberStatus && opts.memberStatus !== "approved") {
				await fixture.pool.query(`update member set status = $2 where id = $1`, [
					seeded.memberId,
					opts.memberStatus,
				]);
			}
			return seeded;
		}

		const alpha = await seedNamed(orgA, {
			name: "Alpha Manager",
			email: "alpha@orga.test",
			role: "manager",
			position: "Engineering Lead",
		});
		const beta = await seedNamed(orgA, {
			name: "Beta Admin",
			email: "beta@orga.test",
			role: "admin",
			position: "HR Director",
		});
		const gamma = await seedNamed(orgA, {
			name: "Gamma Manager",
			email: "gamma@orga.test",
			role: "manager",
			position: "Operations",
		});
		const delta = await seedNamed(orgA, {
			name: "Delta Admin",
			email: "delta@orga.test",
			role: "admin",
		});
		const target = await seedNamed(orgA, {
			name: "Target Manager",
			email: "target@orga.test",
			role: "manager",
		});
		// Ineligible rows in orgA: plain employee, inactive manager, pending member, and other-org admin
		await seedNamed(orgA, {
			name: "Plain Employee",
			email: "plain@orga.test",
			role: "employee",
		});
		await seedNamed(orgA, {
			name: "Inactive Admin",
			email: "inactive@orga.test",
			role: "admin",
			isActive: false,
		});
		await seedNamed(orgA, {
			name: "Pending Manager",
			email: "pending@orga.test",
			role: "manager",
			memberStatus: "pending",
		});
		const foreignAdmin = await seedNamed(orgB, {
			name: "Foreign Admin",
			email: "foreign@orgb.test",
			role: "admin",
		});

		// Walk all pages with limit 2 excluding target
		const seenIds: string[] = [];
		let cursor: string | null = null;
		let pages = 0;
		do {
			const page = await searchReplacementEmployees(fixture.db, {
				organizationId: orgA,
				excludeEmployeeId: target.employeeId,
				cursor,
				limit: 2,
				now,
			});
			pages += 1;
			seenIds.push(...page.items.map((item) => item.employeeId));
			cursor = page.nextCursor;
			if (!page.hasMore) break;
		} while (cursor && pages < 10);

		expect(pages).toBe(2);
		expect(seenIds).toEqual([
			alpha.employeeId,
			beta.employeeId,
			delta.employeeId,
			gamma.employeeId,
		]);
		expect(seenIds).not.toContain(target.employeeId);
		expect(seenIds).not.toContain(foreignAdmin.employeeId);

		// Search filtering by position and name
		const byPosition = await searchReplacementEmployees(fixture.db, {
			organizationId: orgA,
			excludeEmployeeId: target.employeeId,
			search: "HR Director",
			limit: 10,
			now,
		});
		expect(byPosition.items.map((item) => item.employeeId)).toEqual([beta.employeeId]);

		// Point lookup enforces tenant isolation
		expect(
			await getReplacementEmployeeById(fixture.db, {
				organizationId: orgA,
				employeeId: beta.employeeId,
				now,
			}),
		).toMatchObject({ employeeId: beta.employeeId, name: "Beta Admin" });
		expect(
			await getReplacementEmployeeById(fixture.db, {
				organizationId: orgA,
				employeeId: foreignAdmin.employeeId,
				now,
			}),
		).toBeNull();
	});

	it("caps/deactivates work_policy_assignment by canonical effective_from_date without 23514 on Offboard Now and west-of-UTC departures (F2)", async () => {
		// 1) Offboard Now when an assignment starts TODAY (effective_from_date === cutoffLocalDate)
		now = parseInstant("2026-10-10T14:00:00Z");
		const person = await fixture.seedEmployee();
		const policyRes = await fixture.pool.query<{ id: string }>(
			`INSERT INTO work_policy (organization_id, name, schedule_enabled, regulation_enabled, presence_enabled, is_active, created_by, updated_at)
			 VALUES ($1, 'Same-Day Policy', true, false, false, true, $2, now())
			 RETURNING id`,
			[fixture.organizationId, fixture.ownerUserId],
		);
		const policyId = policyRes.rows[0]!.id;

		// Seed an employee policy assignment effective TODAY (2026-10-10), effective_from = 2026-10-10T00:00:00Z < now (14:00Z)
		await fixture.pool.query(
			`INSERT INTO work_policy_assignment (
				policy_id, organization_id, assignment_type, employee_id, priority,
				effective_from, effective_from_date, source_kind, is_active, created_by, updated_at
			) VALUES (
				$1, $2, 'employee', $3, 2,
				'2026-10-10T00:00:00Z', '2026-10-10', 'manager_assignment', true, $4, now()
			)`,
			[policyId, fixture.organizationId, person.employeeId, fixture.ownerUserId],
		);

		const offboarded = await commands().offboardImmediately(ownerActor(), {
			employeeId: person.employeeId,
			requestId: randomUUID(),
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
		expect(offboarded.status).toBe("effective");

		const todayAssignment = await fixture.pool.query<{ is_active: boolean }>(
			`SELECT is_active FROM work_policy_assignment WHERE employee_id = $1 AND effective_from_date = '2026-10-10'`,
			[person.employeeId],
		);
		expect(todayAssignment.rows[0]?.is_active).toBe(false);

		// 2) West-of-UTC org (America/New_York): retrospective departure lastWorkingDay = 2026-08-15
		//    -> cutoffLocalDate = 2026-08-16, cutoff = 2026-08-16T04:00:00Z (after 2026-08-16T00:00:00Z!)
		await fixture.pool.query(
			`UPDATE organization SET timezone = 'America/New_York' WHERE id = $1`,
			[fixture.organizationId],
		);
		try {
			const nyPerson = await fixture.seedEmployee();
			// Assignment 1: earlier range [2026-01-01, 2026-08-16) -> should stay capped at 2026-08-16
			// Assignment 2: starts ON cutoffLocalDate (2026-08-16, effective_from = 2026-08-16T00:00:00Z < 04:00:00Z) -> must deactivate, NOT hit 23514!
			await fixture.pool.query(
				`INSERT INTO work_policy_assignment (
					policy_id, organization_id, assignment_type, employee_id, priority,
					effective_from, effective_until, effective_from_date, effective_until_date,
					source_kind, is_active, created_by, updated_at
				) VALUES
					($1, $2, 'employee', $3, 2, '2026-01-01T00:00:00Z', '2026-08-16T00:00:00Z', '2026-01-01', '2026-08-16', 'manager_assignment', true, $4, now()),
					($1, $2, 'employee', $3, 2, '2026-08-16T00:00:00Z', NULL, '2026-08-16', NULL, 'manager_assignment', true, $4, now())`,
				[policyId, fixture.organizationId, nyPerson.employeeId, fixture.ownerUserId],
			);

			const nyPast = await commands().recordPastDeparture(ownerActor(), {
				employeeId: nyPerson.employeeId,
				requestId: randomUUID(),
				lastWorkingDay: "2026-08-15",
				replacementEmployeeId: null,
				acknowledgeUnassignedDuties: true,
			});
			expect(nyPast.status).toBe("effective");

			const nyRows = await fixture.pool.query<{
				effective_from_date: string;
				effective_until_date: string | null;
				is_active: boolean;
			}>(
				`SELECT effective_from_date::text, effective_until_date::text, is_active
				 FROM work_policy_assignment
				 WHERE employee_id = $1
				 ORDER BY effective_from_date`,
				[nyPerson.employeeId],
			);
			expect(nyRows.rows).toEqual([
				{ effective_from_date: "2026-01-01", effective_until_date: "2026-08-16", is_active: true },
				{ effective_from_date: "2026-08-16", effective_until_date: null, is_active: false },
			]);

			// Also test correctPastDepartureDate moving cutoff to 2026-08-10 with a non-overlapping assignment starting on 2026-08-11
			await fixture.pool.query(
				`UPDATE work_policy_assignment
				 SET effective_until_date = '2026-08-11', effective_until = '2026-08-11T00:00:00Z'
				 WHERE employee_id = $1 AND effective_from_date = '2026-01-01'`,
				[nyPerson.employeeId],
			);
			await fixture.pool.query(
				`INSERT INTO work_policy_assignment (
					policy_id, organization_id, assignment_type, employee_id, priority,
					effective_from, effective_from_date, source_kind, is_active, created_by, updated_at
				) VALUES (
					$1, $2, 'employee', $3, 2,
					'2026-08-11T00:00:00Z', '2026-08-11', 'manager_assignment', true, $4, now()
				)`,
				[policyId, fixture.organizationId, nyPerson.employeeId, fixture.ownerUserId],
			);
			if (nyPast.status !== "effective") throw new Error("expected effective departure");
			const nyCorrected = await commands().correctPastDepartureDate(ownerActor(), {
				employeeId: nyPerson.employeeId,
				departureId: nyPast.departureId,
				expectedRevision: nyPast.revision,
				requestId: randomUUID(),
				lastWorkingDay: "2026-08-10",
			});
			expect(nyCorrected.lastWorkingDay).toBe("2026-08-10");
			const correctedAssign = await fixture.pool.query<{ is_active: boolean }>(
				`SELECT is_active FROM work_policy_assignment WHERE employee_id = $1 AND effective_from_date = '2026-08-11'`,
				[nyPerson.employeeId],
			);
			expect(correctedAssign.rows[0]?.is_active).toBe(false);
		} finally {
			await fixture.pool.query(`UPDATE organization SET timezone = 'UTC' WHERE id = $1`, [
				fixture.organizationId,
			]);
		}
	});

	it("writes work_policy_assignment on rehire (A1-8) and keeps second-stint policy & work/payroll untouched when correcting the first departure (A1-3, A1-25)", async () => {
		now = TODAY;
		const person = await fixture.seedEmployee();
		const {
			rows: [pol1],
		} = await fixture.pool.query<{ id: string }>(
			`INSERT INTO work_policy (organization_id, name, schedule_enabled, regulation_enabled, presence_enabled, is_active, created_by, updated_at)
			 VALUES ($1, 'Stint1 Policy', true, false, false, true, $2, now())
			 RETURNING id`,
			[fixture.organizationId, fixture.ownerUserId],
		);
		const {
			rows: [pol2],
		} = await fixture.pool.query<{ id: string }>(
			`INSERT INTO work_policy (organization_id, name, schedule_enabled, regulation_enabled, presence_enabled, is_active, created_by, updated_at)
			 VALUES ($1, 'Stint2 Policy', true, false, false, true, $2, now())
			 RETURNING id`,
			[fixture.organizationId, fixture.ownerUserId],
		);
		await seedConfirmedTerms(person, "2026-01-01", null);
		await fixture.pool.query(
			`INSERT INTO work_policy_assignment (
				policy_id, organization_id, assignment_type, employee_id, priority,
				effective_from, effective_from_date, source_kind, is_active, created_by, updated_at
			) VALUES ($1, $2, 'employee', $3, 2, '2026-01-01T00:00:00Z', '2026-01-01', 'employment_terms', true, $4, now())`,
			[pol1!.id, fixture.organizationId, person.employeeId, fixture.ownerUserId],
		);

		// 1. Record past departure for stint 1 on 2026-06-15
		const firstDep = await commands().recordPastDeparture(ownerActor(), {
			employeeId: person.employeeId,
			requestId: randomUUID(),
			lastWorkingDay: "2026-06-15",
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
		if (firstDep.status !== "effective") throw new Error("expected effective departure");

		// 2. Rehire employee on 2026-09-01 selecting pol2 (A1-8)
		now = parseInstant("2026-09-01T09:00:00Z");
		await commands().rehireEmployee(ownerActor(), {
			employeeId: person.employeeId,
			requestId: randomUUID(),
			previousEmploymentPeriodId: person.employmentPeriodId,
			role: "employee",
			teamId: null,
			primaryManagerId: null,
			workPolicyId: pol2!.id,
			weeklyContractMinutes: 2400,
			contractType: "fixed",
			workModel: "onsite",
			hourlyRate: null,
			currency: "EUR",
			probationStartsOn: null,
			probationEndsOn: null,
			changeReason: "Rehire for stint 2",
		});

		// Verify A1-8: active work_policy_assignment was projected for pol2 starting 2026-09-01
		const rehireAssign = await fixture.pool.query<{
			policy_id: string;
			effective_from_date: string;
			is_active: boolean;
		}>(
			`SELECT policy_id, effective_from_date::text, is_active
			 FROM work_policy_assignment
			 WHERE employee_id = $1 AND policy_id = $2`,
			[person.employeeId, pol2!.id],
		);
		expect(rehireAssign.rows).toEqual([
			{ policy_id: pol2!.id, effective_from_date: "2026-09-01", is_active: true },
		]);

		// Seed legitimate work & settled payroll during stint 2 (September 2026)
		await seedPostCutoffWork(person, "2026-09-10T08:00:00Z", "2026-09-10T16:00:00Z");
		await seedSettledDay(person, "2026-09-10", 480);

		// 3. Correct stint 1's departure date from 2026-06-15 to 2026-06-10
		now = TODAY;
		const corrected = await commands().correctPastDepartureDate(ownerActor(), {
			employeeId: person.employeeId,
			departureId: firstDep.departureId,
			expectedRevision: firstDep.revision,
			requestId: randomUUID(),
			lastWorkingDay: "2026-06-10",
		});

		// Verify A1-25: legitimate stint-2 work & settled payroll do NOT open reviews on stint 1's departure!
		expect(corrected.workAfterCutoffReviewOpened).toBe(false);
		expect(corrected.payrollReconciliationReviewOpened).toBe(false);

		// Verify A1-3: stint-2's pol2 work_policy_assignment remains ACTIVE!
		const stint2AssignAfter = await fixture.pool.query<{ is_active: boolean }>(
			`SELECT is_active FROM work_policy_assignment WHERE employee_id = $1 AND policy_id = $2`,
			[person.employeeId, pol2!.id],
		);
		expect(stint2AssignAfter.rows[0]?.is_active).toBe(true);
	});

	it("restores capped stint-scoped policy assignments on forward past-departure correction (A2-16) and clips work periods spanning a rehire boundary (A2-20)", async () => {
		now = TODAY;
		const person = await fixture.seedEmployee({
			startDate: new Date("2026-01-01T00:00:00Z"),
		});
		const {
			rows: [polMgr],
		} = await fixture.pool.query<{ id: string }>(
			`INSERT INTO work_policy (organization_id, name, schedule_enabled, regulation_enabled, presence_enabled, is_active, created_by, updated_at)
			 VALUES ($1, 'Manager Stint Policy', true, false, false, true, $2, now())
			 RETURNING id`,
			[fixture.organizationId, fixture.ownerUserId],
		);
		await seedConfirmedTerms(person, "2026-01-01", null);
		await fixture.pool.query(
			`INSERT INTO work_policy_assignment (
				policy_id, organization_id, assignment_type, employee_id, priority,
				effective_from, effective_from_date, source_kind, is_active, created_by, updated_at
			) VALUES ($1, $2, 'employee', $3, 2, '2026-02-01T00:00:00Z', '2026-02-01', 'manager_assignment', true, $4, now())`,
			[polMgr!.id, fixture.organizationId, person.employeeId, fixture.ownerUserId],
		);

		// A3-20: Seed a second employee whose assignment was deliberately scheduled to end on
		// 2026-06-16 (the exact initial cutoff) — forward correction must NOT extend it!
		const personEnded = await fixture.seedEmployee({
			startDate: new Date("2026-01-01T00:00:00Z"),
		});
		await seedConfirmedTerms(personEnded, "2026-01-01", null);
		const {
			rows: [deliberatelyEnded],
		} = await fixture.pool.query<{ id: string }>(
			`INSERT INTO work_policy_assignment (
				policy_id, organization_id, assignment_type, employee_id, priority,
				effective_from, effective_until, effective_from_date, effective_until_date,
				source_kind, is_active, created_by, updated_at
			) VALUES ($1, $2, 'employee', $3, 2, '2026-01-01T00:00:00Z', '2026-06-16T00:00:00Z', '2026-01-01', '2026-06-16', 'manager_assignment', true, $4, now())
			RETURNING id`,
			[polMgr!.id, fixture.organizationId, personEnded.employeeId, fixture.ownerUserId],
		);

		// 1. Record past departure on 2026-06-15 for both employees
		const dep = await commands().recordPastDeparture(ownerActor(), {
			employeeId: person.employeeId,
			requestId: randomUUID(),
			lastWorkingDay: "2026-06-15",
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
		if (dep.status !== "effective") throw new Error("expected effective departure");
		const depEnded = await commands().recordPastDeparture(ownerActor(), {
			employeeId: personEnded.employeeId,
			requestId: randomUUID(),
			lastWorkingDay: "2026-06-15",
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
		if (depEnded.status !== "effective") throw new Error("expected effective departure");

		const afterCap = await fixture.pool.query<{ id: string; effective_until_date: string | null }>(
			`SELECT id, effective_until_date::text FROM work_policy_assignment
			 WHERE employee_id = $1 AND policy_id = $2`,
			[person.employeeId, polMgr!.id],
		);
		expect(afterCap.rows[0]?.effective_until_date).toBe("2026-06-16");

		// 2. Move past departure FORWARD to 2026-06-25 -> departure-capped assignment MUST extend to
		// 2026-06-26 (A2-16) while the deliberately ended assignment MUST stay at 2026-06-16 (A3-20)!
		const movedForward = await commands().correctPastDepartureDate(ownerActor(), {
			employeeId: person.employeeId,
			departureId: dep.departureId,
			expectedRevision: dep.revision,
			requestId: randomUUID(),
			lastWorkingDay: "2026-06-25",
		});
		await commands().correctPastDepartureDate(ownerActor(), {
			employeeId: personEnded.employeeId,
			departureId: depEnded.departureId,
			expectedRevision: depEnded.revision,
			requestId: randomUUID(),
			lastWorkingDay: "2026-06-25",
		});
		const afterForward = await fixture.pool.query<{
			id: string;
			effective_until_date: string | null;
		}>(
			`SELECT id, effective_until_date::text FROM work_policy_assignment
			 WHERE id IN ($1, $2)`,
			[afterCap.rows[0]!.id, deliberatelyEnded!.id],
		);
		const byId = new Map(afterForward.rows.map((r) => [r.id, r.effective_until_date]));
		expect(byId.get(afterCap.rows[0]!.id)).toBe("2026-06-26");
		expect(byId.get(deliberatelyEnded!.id)).toBe("2026-06-16");

		// 3. Rehire on 2026-08-01T00:00:00Z and seed a work period spanning the rehire boundary
		// (starts 2026-07-31T22:00:00Z, ends 2026-08-01T06:00:00Z).
		// Move stint 1 departure earlier to 2026-06-20 -> review MUST clip affected_end_at & latestWorkAt to 2026-08-01T00:00:00Z (A2-20)!
		now = parseInstant("2026-08-01T00:00:00Z");
		await commands().rehireEmployee(ownerActor(), {
			employeeId: person.employeeId,
			requestId: randomUUID(),
			previousEmploymentPeriodId: person.employmentPeriodId,
			role: "employee",
			teamId: null,
			primaryManagerId: null,
			workPolicyId: polMgr!.id,
			weeklyContractMinutes: 2400,
			contractType: "fixed",
			workModel: "onsite",
			hourlyRate: null,
			currency: "EUR",
			probationStartsOn: null,
			probationEndsOn: null,
			changeReason: "Rehire for clipping test",
		});
		await seedPostCutoffWork(person, "2026-07-31T22:00:00Z", "2026-08-01T06:00:00Z");

		now = TODAY;
		const movedEarlier = await commands().correctPastDepartureDate(ownerActor(), {
			employeeId: person.employeeId,
			departureId: dep.departureId,
			expectedRevision: movedForward.revision,
			requestId: randomUUID(),
			lastWorkingDay: "2026-06-20",
		});
		expect(movedEarlier.workAfterCutoffReviewOpened).toBe(true);

		const reviewRow = await fixture.pool.query<{
			affected_end_at: Date | null;
			metadata: { latestWorkAt?: string | null };
		}>(
			`SELECT affected_end_at, metadata FROM employee_departure_review
			 WHERE departure_id = $1 AND kind = 'work_after_cutoff'`,
			[dep.departureId],
		);
		expect(reviewRow.rows[0]?.affected_end_at?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
		expect(reviewRow.rows[0]?.metadata.latestWorkAt).toBe("2026-08-01T00:00:00.000Z");

		// M9: Forward past-departure correction MUST clamp assignment extension to an intervening
		// policy retirement date so historical dates stay eligible!
		now = TODAY;
		const personRetired = await fixture.seedEmployee();
		const {
			rows: [polRetiring],
		} = await fixture.pool.query<{ id: string }>(
			`INSERT INTO work_policy (organization_id, name, schedule_enabled, regulation_enabled, presence_enabled, is_active, created_by, updated_at)
			 VALUES ($1, 'M9 Intervening Retirement Policy', true, false, false, true, $2, '2026-01-01T00:00:00Z')
			 RETURNING id`,
			[fixture.organizationId, fixture.ownerUserId],
		);
		await seedConfirmedTerms(personRetired, "2026-01-01", null);
		const {
			rows: [asgnRetiring],
		} = await fixture.pool.query<{ id: string }>(
			`INSERT INTO work_policy_assignment (
				policy_id, organization_id, assignment_type, employee_id, priority,
				effective_from, effective_from_date, source_kind, is_active, created_by, updated_at
			) VALUES ($1, $2, 'employee', $3, 2, '2026-01-01T00:00:00Z', '2026-01-01', 'manager_assignment', true, $4, now())
			RETURNING id`,
			[polRetiring!.id, fixture.organizationId, personRetired.employeeId, fixture.ownerUserId],
		);
		const depRet = await commands().recordPastDeparture(ownerActor(), {
			employeeId: personRetired.employeeId,
			requestId: randomUUID(),
			lastWorkingDay: "2026-06-09", // cutoff = 2026-06-10
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
		if (depRet.status !== "effective") throw new Error("expected effective departure");
		// Policy retires on 2026-06-15 (between initial cutoff 2026-06-10 and corrected cutoff 2026-06-20)
		await fixture.pool.query(
			`UPDATE work_policy SET is_active = false, updated_at = '2026-06-15T12:00:00Z' WHERE id = $1`,
			[polRetiring!.id],
		);
		await commands().correctPastDepartureDate(ownerActor(), {
			employeeId: personRetired.employeeId,
			departureId: depRet.departureId,
			expectedRevision: depRet.revision,
			requestId: randomUUID(),
			lastWorkingDay: "2026-06-19", // cutoff = 2026-06-20
		});
		const {
			rows: [afterM9],
		} = await fixture.pool.query<{ effective_until_date: string | null }>(
			`SELECT to_char(effective_until_date, 'YYYY-MM-DD') AS effective_until_date
			 FROM work_policy_assignment WHERE id = $1`,
			[asgnRetiring!.id],
		);
		expect(afterM9?.effective_until_date).toBe("2026-06-15");
	});
});
