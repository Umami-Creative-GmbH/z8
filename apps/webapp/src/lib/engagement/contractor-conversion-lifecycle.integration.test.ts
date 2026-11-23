/**
 * #2001 (spec #1935): one person's whole conversion, across every module that tells an External
 * Contractor period from an employee period, on PostgreSQL.
 *
 * Kim works as an External Contractor from 1 January 2026 on a daily rate (600.00 EUR, any work
 * is a full day), is offboarded on 31 March, and is hired back as an employee on 1 April under a
 * work policy with an 8-hour day and ArbZG limits. Before the rehire the same work policy is the
 * organization's default, so a contractor day that fell back to the default would show at once.
 *
 * The contractor period (2 and 3 March) feeds only the Contractor Time & Fee Statement and the
 * Billable Time margin at the contractor's daily rate; payroll exports, work balance, ArbZG
 * compliance, vacation and the statutory profile never see it. The employee period (13 and 14
 * April) reaches payroll, work balance, compliance and vacation, costs at the explicit cost rate,
 * and never reaches a statement. The billable seat count follows the lifecycle: counted while
 * engaged, dropped by the departure, counted again after the rehire.
 */
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";

const session = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/queue", async (original) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(original),
);
vi.mock("@/lib/billing/seat-sync-trigger", () => ({
	reconcileBillingSeatsForOrganization: async () => undefined,
	syncBillingSeatsAfterMemberChange: async () => undefined,
}));
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/lib/organization-mfa/organization-access", async (original) => ({
	...(await original<typeof import("@/lib/organization-mfa/organization-access")>()),
	canAccessOrganization: async () => true,
}));
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				session.userId && session.organizationId
					? {
							user: { id: session.userId, role: "user", email: `${session.userId}@example.test` },
							session: {
								id: `session-${session.userId}`,
								userId: session.userId,
								activeOrganizationId: session.organizationId,
							},
						}
					: null,
		},
	},
}));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const { db } = await import("@/db");
const { createLifecycleDatabaseFixture } =
	await import("@/lib/employee-lifecycle/testing/database.test.fixture");
const { createDepartureCommands } = await import("@/lib/employee-lifecycle/commands");
const { countBillableSeats } = await import("@/lib/effect/services/billing/billable-seat-count");
const { changeContractorTerms } = await import("@/lib/contractor-compensation/store");
const { saveContractorProfile } = await import("@/lib/engagement/contractor-profile");
const { loadContractorStatement } = await import("@/lib/contractor-statements/loader");
const { fetchWorkPeriodsForExport } = await import("@/lib/payroll-export/data-fetcher");
const { getProjectDetailedReport } = await import("@/app/[locale]/(app)/reports/projects/actions");
const { computeEmployeePeriodBalance } = await import("@/lib/work-balance/period-aggregation");
const { loadVacationBalances } = await import("@/lib/absences/vacation-balance-store");
const { resolveEffectiveContractOnDay } = await import("@/lib/contracts/resolve-contract");
const { createVersionedWorkPolicy } = await import("@/lib/work-policy/versioned-policy-writer");
const { WorkPolicyService, WorkPolicyServiceLive } =
	await import("@/lib/effect/services/work-policy.service");
const { DatabaseService, makeDatabaseService } =
	await import("@/lib/effect/services/database.service");
type LifecycleDatabaseFixture =
	import("@/lib/employee-lifecycle/testing/database.test.fixture").LifecycleDatabaseFixture;
type SeededEmployee =
	import("@/lib/employee-lifecycle/testing/database.test.fixture").SeededEmployee;

const CONTRACTOR_DAYS = { from: "2026-03-01", to: "2026-03-31" } as const;
const EMPLOYEE_DAYS = { from: "2026-04-01", to: "2026-04-30" } as const;

describe("an External Contractor hired as an employee, across every module (#2001)", () => {
	let fixture: LifecycleDatabaseFixture;
	let kim: SeededEmployee;
	let employeePeriodId: string;
	let websiteId: string;
	let now: Instant = parseInstant("2026-03-01T08:00:00Z");
	const clock = { nowInstant: () => now };
	/** The billable seat count at each step of the lifecycle. */
	const seats: Record<string, number> = {};
	/** Work balance of the contractor days, read while Kim was still a contractor. */
	let contractorDaysBalance: Awaited<ReturnType<typeof computeEmployeePeriodBalance>>;

	const commands = () =>
		createDepartureCommands({
			db: fixture.db,
			clock,
			clockOut: { close: async () => ({ kind: "not_running" }) },
		});
	const owner = () => ({ userId: fixture.ownerUserId, organizationId: fixture.organizationId });
	const seatCount = () => countBillableSeats(fixture.db, fixture.organizationId, { now });

	async function completedWork(start: string, end: string) {
		const clockIn = randomUUID();
		const clockOut = randomUUID();
		const minutes = Temporal.Instant.from(end).since(Temporal.Instant.from(start)).total("minutes");
		await withCanonicalRecords(fixture.pool, async (client) => {
			for (const [id, type, timestamp] of [
				[clockIn, "clock_in", start],
				[clockOut, "clock_out", end],
			]) {
				await client.query(
					`insert into time_entry (id, employee_id, organization_id, type, timestamp,
					 utc_offset_minutes, timezone, timezone_source, hash, created_by)
					 values ($1::uuid, $2, $3, $4, $5, 0, 'UTC', 'user_setting', $1::uuid::text, $6)`,
					[id, kim.employeeId, fixture.organizationId, type, timestamp, fixture.ownerUserId],
				);
			}
			await client.query(
				`insert into work_period (employee_id, organization_id, clock_in_id, clock_out_id,
				 start_time, end_time, duration_minutes, is_active, project_id, is_billable,
				 approval_status, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7, false, $8, true, 'approved', now())`,
				[kim.employeeId, fixture.organizationId, clockIn, clockOut, start, end, minutes, websiteId],
			);
		});
	}

	function workBalance(periodStart: string, periodEnd: string) {
		return computeEmployeePeriodBalance({
			employeeId: kim.employeeId,
			organizationId: fixture.organizationId,
			periodType: "month",
			periodStart,
			periodEnd,
			calculationStartDate: "2026-01-01",
			timezone: "UTC",
			isClosed: false,
			now: new Date(now.epochMilliseconds),
		});
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		const organizationId = fixture.organizationId;
		await fixture.pool.query(
			`update organization set timezone = 'UTC', projects_enabled = true, billable_time_enabled = true
			 where id = $1`,
			[organizationId],
		);
		await fixture.pool.query(
			`insert into billable_time_settings (organization_id, billable_currency) values ($1, 'EUR')`,
			[organizationId],
		);
		const customerId = randomUUID();
		websiteId = randomUUID();
		await fixture.pool.query(
			`insert into customer (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Acme', $3, now())`,
			[customerId, organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into project (id, organization_id, name, status, customer_id, billable_default, created_by, updated_at)
			 values ($1, $2, 'Website', 'active', $3, true, $4, now())`,
			[websiteId, organizationId, customerId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into billable_rate (organization_id, level, project_id, hourly_rate, effective_from)
			 values ($1, 'project', $2, 100.00, '2026-01-01')`,
			[organizationId, websiteId],
		);
		await fixture.pool.query(
			`insert into vacation_allowance
			 (organization_id, name, start_date, is_company_default, default_annual_days,
			  statutory_minimum_days, accrual_type, allow_carryover, prorate_in_start_and_exit_year,
			  created_by, updated_at)
			 values ($1, 'Company', '2026-01-01', true, '24', '0', 'annual', false, true, $2, now())`,
			[organizationId, fixture.ownerUserId],
		);
		const workDay = { hoursPerDay: "8.00", isWorkDay: true };
		const freeDay = { hoursPerDay: "0.00", isWorkDay: false };
		const policy = await createVersionedWorkPolicy(db, {
			organizationId,
			actorUserId: fixture.ownerUserId,
			data: {
				name: "Office",
				effectiveFromDate: "2026-01-01",
				scheduleEnabled: true,
				regulationEnabled: true,
				presenceEnabled: false,
				schedule: {
					scheduleCycle: "weekly",
					scheduleType: "detailed",
					workingDaysPreset: "custom",
					days: [
						{ dayOfWeek: "monday", ...workDay },
						{ dayOfWeek: "tuesday", ...workDay },
						{ dayOfWeek: "wednesday", ...workDay },
						{ dayOfWeek: "thursday", ...workDay },
						{ dayOfWeek: "friday", ...workDay },
						{ dayOfWeek: "saturday", ...freeDay },
						{ dayOfWeek: "sunday", ...freeDay },
					],
				},
				regulation: {
					maxDailyMinutes: 480,
					maxWeeklyMinutes: 2400,
					breakRules: [],
				},
			},
		});
		// The organization's default work policy: a contractor day must never fall back to it.
		await fixture.pool.query(
			`insert into work_policy_assignment
			 (policy_id, organization_id, assignment_type, priority, is_active, created_by, updated_at)
			 values ($1, $2, 'organization', 0, true, $3, now())`,
			[policy.policy.id, organizationId, fixture.ownerUserId],
		);

		// Period 1: Kim, an External Contractor since 1 January, on a daily rate from 1 March.
		kim = await fixture.seedEmployee({ engagementKind: "contractor" });
		await saveContractorProfile(db, {
			organizationId,
			employeeId: kim.employeeId,
			details: { companyName: "Kim Consulting", vatId: "DE123456789", referenceCode: "PO-7" },
			updatedBy: fixture.ownerUserId,
		});
		const terms = await changeContractorTerms(db, {
			organizationId,
			actorUserId: fixture.ownerUserId,
			employeeId: kim.employeeId,
			change: {
				kind: "set",
				effectiveFrom: "2026-03-01",
				compensation: {
					basis: "daily",
					rateAmount: "600",
					currency: "EUR",
					dayUnitRule: "any_work_full_day",
				},
			},
		});
		if (!terms.ok) throw new Error(terms.reason);
		await completedWork("2026-03-02T09:00:00Z", "2026-03-02T13:00:00Z");
		await completedWork("2026-03-03T08:00:00Z", "2026-03-03T18:00:00Z");

		now = parseInstant("2026-03-10T10:00:00Z");
		seats.engaged = await seatCount();
		contractorDaysBalance = await workBalance("2026-03-02", "2026-03-03");

		// The engagement ends cleanly: an immediate departure on the evening of 31 March.
		now = parseInstant("2026-03-31T20:00:00Z");
		const departed = await commands().offboardNow(owner(), {
			employeeId: kim.employeeId,
			requestId: randomUUID(),
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
		if (departed.status !== "effective") throw new Error(`departure ${departed.status}`);
		seats.departed = await seatCount();

		// Period 2: hired as an employee the next morning, under the Office policy, cost 40.00 an
		// hour. (No calendar day between the stints: a whole day without employment would, for
		// employees too, make the year's vacation configuration a zero-working-days conflict.)
		now = parseInstant("2026-04-01T06:00:00Z");
		const rehired = await commands().rehireEmployee(owner(), {
			employeeId: kim.employeeId,
			requestId: randomUUID(),
			previousEmploymentPeriodId: kim.employmentPeriodId,
			engagementKind: "employee",
			workPolicyId: policy.policy.id,
			role: "employee",
			teamId: null,
			primaryManagerId: null,
			weeklyContractMinutes: 2400,
			contractType: "fixed",
			workModel: "onsite",
			hourlyRate: null,
			currency: "EUR",
			probationStartsOn: null,
			probationEndsOn: null,
			changeReason: null,
		});
		employeePeriodId = rehired.employmentPeriodId;
		seats.rehired = await seatCount();
		await fixture.pool.query(
			`insert into cost_rate (organization_id, employee_id, hourly_rate, effective_from)
			 values ($1, $2, 40.00, '2026-04-01')`,
			[organizationId, kim.employeeId],
		);
		await completedWork("2026-04-13T08:00:00Z", "2026-04-13T18:00:00Z");
		await completedWork("2026-04-14T08:00:00Z", "2026-04-14T16:00:00Z");

		now = parseInstant("2026-04-30T20:00:00Z");
		session.userId = fixture.ownerUserId;
		session.organizationId = organizationId;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("keeps both stints, a closed contractor period and an open employee one", async () => {
		const { rows } = await fixture.pool.query(
			`select id, status, engagement_kind from employee_employment_period
			 where employee_id = $1 order by started_at`,
			[kim.employeeId],
		);
		expect(rows).toEqual([
			{ id: kim.employmentPeriodId, status: "closed", engagement_kind: "contractor" },
			{ id: employeePeriodId, status: "open", engagement_kind: "employee" },
		]);
	});

	it("counts the seat while engaged, drops it with the departure and counts it again after the rehire", () => {
		// The owner and the fixture's employee hold the other two seats throughout.
		expect(seats).toEqual({ engaged: 3, departed: 2, rehired: 3 });
	});

	describe("the contractor period", () => {
		it("is in the Contractor Time & Fee Statement, at the daily rate", async () => {
			const result = await loadContractorStatement(db, fixture.organizationId, {
				employeeId: kim.employeeId,
				fromDay: CONTRACTOR_DAYS.from,
				toDay: EMPLOYEE_DAYS.to,
				generatedAt: now,
			});

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.statement.days.map((day) => [day.date, day.workedMinutes])).toEqual([
				["2026-03-02", 240],
				["2026-03-03", 600],
			]);
			expect(result.statement.totals).toEqual([
				{ currency: "EUR", amount: "1200.00", hours: "0.0000", days: "2.0000", workedMinutes: 840 },
			]);
			expect(result.statement.unpriced).toEqual({ workedMinutes: 0, days: 0 });
		});

		it("costs Billable Time margin at the contractor's daily rate", async () => {
			const report = await getProjectDetailedReport(
				websiteId,
				CONTRACTOR_DAYS.from,
				CONTRACTOR_DAYS.to,
			);

			expect(report.success).toBe(true);
			if (!report.success) return;
			const row = report.data.employeeBreakdown.find(
				(entry) => entry.employeeId === kim.employeeId,
			);
			// Revenue 14 h × 100.00; cost two days × 600.00.
			expect(row?.billable).toMatchObject({
				access: "full",
				revenue: "1400.00",
				cost: "1200.00",
				margin: "200.00",
			});
		});

		it("never reaches payroll exports", async () => {
			const rows = await fetchWorkPeriodsForExport(fixture.organizationId, {
				dateRange: {
					start: parsePlainDate(CONTRACTOR_DAYS.from),
					end: parsePlainDate(CONTRACTOR_DAYS.to),
				},
			});

			expect(rows).toEqual([]);
		});

		it("has no required time and no work balance, though the organization has a default policy", () => {
			expect(contractorDaysBalance).toMatchObject({ requiredMinutes: 0, balanceMinutes: 0 });
		});

		it("is not checked against ArbZG limits, and carries no statutory profile", async () => {
			const compliance = await checkCompliance("2026-03-03T18:00:00Z", 600);
			const day = await resolveEffectiveContractOnDay(db, {
				organizationId: fixture.organizationId,
				employeeId: kim.employeeId,
				date: "2026-03-03",
			});

			expect(compliance).toMatchObject({ isCompliant: true, warnings: [], policyId: null });
			expect(day).toMatchObject({
				engagementKind: "contractor",
				workPolicy: null,
				balanceMode: "excluded",
				requiredMinutes: 0,
				employmentProfile: null,
			});
		});
	});

	describe("the employee period", () => {
		it("is in payroll exports", async () => {
			const rows = await fetchWorkPeriodsForExport(fixture.organizationId, {
				dateRange: {
					start: parsePlainDate(CONTRACTOR_DAYS.from),
					end: parsePlainDate(EMPLOYEE_DAYS.to),
				},
			});

			expect(
				rows.map((row) => [
					row.employeeId,
					row.startTime.toInstant().toString(),
					row.durationMinutes,
				]),
			).toEqual([
				[kim.employeeId, "2026-04-13T08:00:00Z", 600],
				[kim.employeeId, "2026-04-14T08:00:00Z", 480],
			]);
		});

		it("is never in a Contractor Time & Fee Statement", async () => {
			const result = await loadContractorStatement(db, fixture.organizationId, {
				employeeId: kim.employeeId,
				fromDay: EMPLOYEE_DAYS.from,
				toDay: EMPLOYEE_DAYS.to,
				generatedAt: now,
			});

			// 1 April may still be a contractor-local day of an engagement that ended the evening
			// before, so the statement is not refused, but it holds none of the employee work.
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.statement.days).toEqual([]);
			expect(result.statement.totals).toEqual([]);
			expect(result.statement.unpriced).toEqual({ workedMinutes: 0, days: 0 });
		});

		it("is refused as a statement once no contractor day can fall in the period", async () => {
			const result = await loadContractorStatement(db, fixture.organizationId, {
				employeeId: kim.employeeId,
				fromDay: "2026-04-13",
				toDay: "2026-04-14",
				generatedAt: now,
			});

			expect(result).toEqual({ ok: false, reason: "not_contractor" });
		});

		it("costs Billable Time margin at the explicit cost rate", async () => {
			const report = await getProjectDetailedReport(
				websiteId,
				EMPLOYEE_DAYS.from,
				EMPLOYEE_DAYS.to,
			);

			expect(report.success).toBe(true);
			if (!report.success) return;
			const row = report.data.employeeBreakdown.find(
				(entry) => entry.employeeId === kim.employeeId,
			);
			// Revenue 18 h × 100.00; cost 18 h × 40.00.
			expect(row?.billable).toMatchObject({
				access: "full",
				revenue: "1800.00",
				cost: "720.00",
				margin: "1080.00",
			});
		});

		it("accrues work balance against the policy's required time", async () => {
			const balance = await workBalance("2026-04-13", "2026-04-14");

			// 10 h + 8 h worked against two 8-hour days.
			expect(balance).toMatchObject({
				actualMinutes: 1080,
				requiredMinutes: 960,
				balanceMinutes: 120,
			});
		});

		it("is checked against ArbZG limits", async () => {
			const compliance = await checkCompliance("2026-04-13T18:00:00Z", 600);

			expect(compliance.isCompliant).toBe(false);
			expect(compliance.warnings).toEqual(
				expect.arrayContaining([expect.objectContaining({ type: "max_daily", limitValue: 480 })]),
			);
		});

		it("earns vacation for the employee months alone", async () => {
			const { balances, externalContractors } = await loadVacationBalances(db, {
				organizationId: fixture.organizationId,
				employeeIds: [kim.employeeId],
				year: 2026,
				timezone: "UTC",
			});

			expect(externalContractors.has(kim.employeeId)).toBe(false);
			// April to December, nine months of a 24-day year.
			expect(balances.get(kim.employeeId)?.allowanceDays).toBe(18);
		});
	});

	function checkCompliance(policyAt: string, minutes: number) {
		return Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* WorkPolicyService;
				return yield* service.checkCompliance({
					employeeId: kim.employeeId,
					organizationId: fixture.organizationId,
					policyAt: parseInstant(policyAt),
					currentSessionMinutes: minutes,
					totalDailyMinutes: minutes,
					totalWeeklyMinutes: minutes,
					breaksTakenMinutes: 0,
				});
			}).pipe(
				Effect.provide(WorkPolicyServiceLive),
				Effect.provideService(DatabaseService, makeDatabaseService(db)),
			),
		);
	}
});
