/**
 * #1996 (spec #1935): an External Contractor period stays outside the employee domains while the
 * person keeps working inside Z8's workflow. Against PostgreSQL, through the domains' own
 * interfaces: vacation accrual, prorated allowances, vacation balances and carry-over, period
 * submissions, and the optional calendar unavailability an External Contractor records instead
 * of vacation or leave. An employee of the same organization is the control throughout.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";

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
vi.mock("@/lib/notifications/triggers", async (original) =>
	(await import("@/test/integration-harness")).notificationTriggers(original),
);
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
const session = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
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
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const { db } = await import("@/db");
const { createClosedMonthDatabaseFixture } =
	await import("@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture");
const { accrueVacationPeriods } = await import("@/lib/absences/vacation-accrual");
const { loadVacationBalances } = await import("@/lib/absences/vacation-balance-store");
const { calculateAnnualCarryover, getEnhancedVacationBalanceResult } =
	await import("@/lib/absences/vacation.service");
const { commitAnnualVacationCarryover } = await import("@/lib/absences/vacation-carryover");
const { decidePeriodSubmission, submitPeriodSubmission } =
	await import("@/lib/time-tracking/period-submissions/submission-service");
const { requestAbsenceForEmployeeEffect } =
	await import("@/app/[locale]/(app)/absences/request-absence-effect");
const { getAbsenceCategories, getVacationBalanceResult } =
	await import("@/app/[locale]/(app)/absences/queries");
const { recordAbsenceForEmployee } = await import("@/app/[locale]/(app)/team/absences/actions");
const { decideAbsenceChange, requestAbsenceChange } =
	await import("@/lib/absences/change-request-service");
const { approveAbsenceEffect } = await import("@/lib/approvals/server/absence-approvals");
const { getAbsencesForMonth } = await import("@/lib/calendar/absence-service");
const { fetchAbsencesForExport } = await import("@/lib/payroll-export/data-fetcher");
const { getDailyWorkRequirementsForEmployee } =
	await import("@/lib/calendar/work-policy-requirements");
type ClosedMonthDatabaseFixture =
	import("@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture").ClosedMonthDatabaseFixture;

describe("an External Contractor outside the employee domains (#1996)", () => {
	let fixture: ClosedMonthDatabaseFixture;

	beforeAll(async () => {
		fixture = await createClosedMonthDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	/** An organization with an owner, an employee and a current External Contractor. */
	async function organizationWithContractor(timezone = "UTC") {
		const { organizationId, ownerUserId } = await fixture.organization(timezone);
		const employee = await fixture.seedEmployee({ organizationId });
		const contractor = await fixture.seedEmployee({ organizationId, engagementKind: "contractor" });
		return { organizationId, ownerUserId, employee, contractor };
	}

	async function vacationPolicy(input: {
		organizationId: string;
		createdBy: string;
		accrualType: "annual" | "monthly";
		allowCarryover?: boolean;
		prorate?: boolean;
		startDate?: string;
	}) {
		await fixture.pool.query(
			`insert into vacation_allowance
			 (organization_id, name, start_date, is_company_default, default_annual_days,
			  statutory_minimum_days, accrual_type, allow_carryover, prorate_in_start_and_exit_year,
			  created_by, updated_at)
			 values ($1, 'Company', $5, true, '24', '0', $2, $3, $6, $4, now())`,
			[
				input.organizationId,
				input.accrualType,
				input.allowCarryover ?? false,
				input.createdBy,
				input.startDate ?? "2026-01-01",
				input.prorate ?? true,
			],
		);
	}

	/**
	 * A person converted between employment and contract work on `convertedAt`: an employee before
	 * and a contractor after, or the other way round.
	 */
	async function convertedPerson(
		organizationId: string,
		input: { before: "employee" | "contractor"; since: string; convertedAt: string },
	) {
		const after = input.before === "employee" ? "contractor" : "employee";
		const person = await fixture.seedEmployee({
			organizationId,
			engagementKind: input.before,
			withPeriod: false,
		});
		await fixture.pool.query(
			`insert into employee_employment_period
			 (organization_id, employee_id, status, started_at, start_provenance, ended_at, engagement_kind)
			 values ($1, $2, 'closed', $3, 'recorded', $4, $5),
			        ($1, $2, 'open', $4, 'recorded', null, $6)`,
			[organizationId, person.employeeId, input.since, input.convertedAt, input.before, after],
		);
		await fixture.pool.query("update employee set engagement_kind = $2 where id = $1", [
			person.employeeId,
			after,
		]);
		return person;
	}

	async function carryoverInto(employeeId: string, year: number) {
		const { rows } = await fixture.pool.query<{ days: string | null }>(
			`select custom_carryover_days::text as days from employee_vacation_allowance
			 where employee_id = $1 and year = $2`,
			[employeeId, year],
		);
		return rows;
	}

	describe("vacation", () => {
		it("accrues no vacation for a contractor and gives them no balance or coverage gap", async () => {
			const org = await organizationWithContractor();
			await vacationPolicy({
				organizationId: org.organizationId,
				createdBy: org.ownerUserId,
				accrualType: "monthly",
			});

			await accrueVacationPeriods(org.organizationId, { year: 2026, months: [1, 2, 3] });

			const { rows } = await fixture.pool.query<{ employee_id: string; count: number }>(
				`select employee_id, count(*)::int as count from vacation_adjustment
				 where employee_id = any($1::uuid[]) and kind = 'accrual' group by employee_id`,
				[[org.employee.employeeId, org.contractor.employeeId]],
			);
			expect(rows).toEqual([{ employee_id: org.employee.employeeId, count: 3 }]);

			const balances = await loadVacationBalances(db, {
				organizationId: org.organizationId,
				employeeIds: [org.employee.employeeId, org.contractor.employeeId],
				year: 2026,
				timezone: "UTC",
			});
			expect(balances.balances.has(org.employee.employeeId)).toBe(true);
			expect(balances.balances.has(org.contractor.employeeId)).toBe(false);
			expect(balances.configurations.has(org.contractor.employeeId)).toBe(false);
			expect([...balances.externalContractors]).toEqual([org.contractor.employeeId]);
			await fixture.pool.query(
				"delete from vacation_adjustment where employee_id = any($1::uuid[])",
				[[org.employee.employeeId, org.contractor.employeeId]],
			);
		});

		it("tells a contractor's own balance reads that vacation does not apply, not that a policy is missing", async () => {
			const org = await organizationWithContractor();
			await vacationPolicy({
				organizationId: org.organizationId,
				createdBy: org.ownerUserId,
				accrualType: "annual",
			});

			const contractor = await getVacationBalanceResult(org.contractor.employeeId, 2026, "UTC");
			const employee = await getVacationBalanceResult(org.employee.employeeId, 2026, "UTC");
			expect(contractor).toEqual({ balance: null, configuration: null, externalContractor: true });
			expect(employee).toMatchObject({ externalContractor: false });
			expect(employee.balance).not.toBeNull();

			const widget = await getEnhancedVacationBalanceResult({
				employeeId: org.contractor.employeeId,
				organizationId: org.organizationId,
				year: 2026,
			});
			expect(widget).toEqual({ balance: null, configuration: null, externalContractor: true });
		});

		it("prorates a former contractor's allowance by their employee stint alone", async () => {
			const { organizationId, ownerUserId } = await fixture.organization("UTC");
			await vacationPolicy({ organizationId, createdBy: ownerUserId, accrualType: "annual" });
			// A contractor from January, hired as an employee on 1 July.
			const person = await fixture.seedEmployee({
				organizationId,
				engagementKind: "contractor",
				withPeriod: false,
			});
			await fixture.pool.query(
				`insert into employee_employment_period
				 (organization_id, employee_id, status, started_at, start_provenance, ended_at, engagement_kind)
				 values ($1, $2, 'closed', '2026-01-01T00:00:00Z', 'recorded', '2026-07-01T00:00:00Z', 'contractor'),
				        ($1, $2, 'open', '2026-07-01T00:00:00Z', 'recorded', null, 'employee')`,
				[organizationId, person.employeeId],
			);
			await fixture.pool.query("update employee set engagement_kind = 'employee' where id = $1", [
				person.employeeId,
			]);

			const { balances, externalContractors } = await loadVacationBalances(db, {
				organizationId,
				employeeIds: [person.employeeId],
				year: 2026,
				timezone: "UTC",
			});

			expect(externalContractors.size).toBe(0);
			// Six employed months of 24 days; the contractor half of the year accrues nothing.
			expect(balances.get(person.employeeId)?.allowanceDays).toBe(12);
		});

		it("carries no vacation over for a contractor", async () => {
			const org = await organizationWithContractor();
			await vacationPolicy({
				organizationId: org.organizationId,
				createdBy: org.ownerUserId,
				accrualType: "annual",
				allowCarryover: true,
			});

			const summary = await calculateAnnualCarryover(
				org.organizationId,
				2026,
				org.ownerUserId,
				"UTC",
			);

			const processed = summary.results.map((result) => result.employeeId);
			expect(processed).toContain(org.employee.employeeId);
			expect(processed).not.toContain(org.contractor.employeeId);
			expect(summary.errors.map((error) => error.employeeId)).not.toContain(
				org.contractor.employeeId,
			);
			const { rows } = await fixture.pool.query(
				"select 1 from employee_vacation_allowance where employee_id = $1",
				[org.contractor.employeeId],
			);
			expect(rows).toEqual([]);
		});

		describe("by year for someone converted between employment and contract work", () => {
			it("gives a year spent entirely as a contractor no allowance to carry into employment", async () => {
				const org = await organizationWithContractor();
				// A policy that does not prorate: the full allowance for any year with employment.
				await vacationPolicy({
					organizationId: org.organizationId,
					createdBy: org.ownerUserId,
					accrualType: "annual",
					allowCarryover: true,
					prorate: false,
				});
				// A contractor all of 2026, an employee from 1 January 2027.
				const person = await convertedPerson(org.organizationId, {
					before: "contractor",
					since: "2026-01-01T00:00:00Z",
					convertedAt: "2027-01-01T00:00:00Z",
				});
				const balances = (year: number) =>
					loadVacationBalances(db, {
						organizationId: org.organizationId,
						employeeIds: [person.employeeId, org.employee.employeeId],
						year,
						timezone: "UTC",
					});

				const contractYear = await balances(2026);
				expect([...contractYear.externalContractors]).toEqual(
					expect.arrayContaining([person.employeeId]),
				);
				expect(contractYear.balances.has(person.employeeId)).toBe(false);
				expect(contractYear.balances.get(org.employee.employeeId)?.allowanceDays).toBe(24);
				const employedYear = await balances(2027);
				expect(employedYear.externalContractors.has(person.employeeId)).toBe(false);
				expect(employedYear.balances.get(person.employeeId)?.allowanceDays).toBe(24);

				const legacy = await calculateAnnualCarryover(org.organizationId, 2026, org.ownerUserId);
				expect(legacy.results.map((row) => row.employeeId)).toContain(org.employee.employeeId);
				expect(legacy.results.map((row) => row.employeeId)).not.toContain(person.employeeId);
				const committed = await commitAnnualVacationCarryover(
					org.organizationId,
					2026,
					org.ownerUserId,
					"UTC",
				);
				expect(
					[...committed.results, ...committed.errors].map((row) => row.employeeId),
				).not.toContain(person.employeeId);
				expect(await carryoverInto(person.employeeId, 2027)).toEqual([]);
				expect((await balances(2027)).balances.get(person.employeeId)?.carryoverDays ?? 0).toBe(0);
			});

			it("gives a year spent entirely as a contractor after employment no vacation anywhere", async () => {
				const org = await organizationWithContractor();
				await vacationPolicy({
					organizationId: org.organizationId,
					createdBy: org.ownerUserId,
					accrualType: "annual",
					allowCarryover: true,
					prorate: false,
					startDate: "2025-01-01",
				});
				// An employee all of 2025, a contractor from 1 January 2026.
				const person = await convertedPerson(org.organizationId, {
					before: "employee",
					since: "2025-01-01T00:00:00Z",
					convertedAt: "2026-01-01T00:00:00Z",
				});

				const contractYear = await loadVacationBalances(db, {
					organizationId: org.organizationId,
					employeeIds: [person.employeeId],
					year: 2026,
					timezone: "UTC",
				});
				expect([...contractYear.externalContractors]).toEqual([person.employeeId]);
				expect(contractYear.balances.size).toBe(0);
				expect(contractYear.configurations.size).toBe(0);
				// The Absences page and the dashboard say vacation does not apply.
				const absencesPage = await getVacationBalanceResult(person.employeeId, 2026, "UTC");
				expect(absencesPage).toEqual({
					balance: null,
					configuration: null,
					externalContractor: true,
				});
				const dashboard = await getEnhancedVacationBalanceResult({
					employeeId: person.employeeId,
					organizationId: org.organizationId,
					year: 2026,
				});
				expect(dashboard).toEqual({ balance: null, configuration: null, externalContractor: true });
				// The employed year keeps its vacation.
				const employedYear = await loadVacationBalances(db, {
					organizationId: org.organizationId,
					employeeIds: [person.employeeId],
					year: 2025,
					timezone: "UTC",
				});
				expect(employedYear.externalContractors.size).toBe(0);
				expect(employedYear.balances.get(person.employeeId)?.allowanceDays).toBe(24);

				// Nothing carries from the employed year into the contract year.
				const legacy = await calculateAnnualCarryover(org.organizationId, 2025, org.ownerUserId);
				expect(legacy.results.map((row) => row.employeeId)).toContain(org.employee.employeeId);
				expect(legacy.results.map((row) => row.employeeId)).not.toContain(person.employeeId);
				const committed = await commitAnnualVacationCarryover(
					org.organizationId,
					2025,
					org.ownerUserId,
					"UTC",
				);
				expect(
					[...committed.results, ...committed.errors].map((row) => row.employeeId),
				).not.toContain(person.employeeId);
				expect(await carryoverInto(person.employeeId, 2026)).toEqual([]);
			});
		});
	});

	describe("period submissions", () => {
		it("lets a contractor submit a period a manager approves, with no required-time target", async () => {
			const org = await organizationWithContractor("Europe/Berlin");
			const manager = await fixture.employee({ organizationId: org.organizationId });
			await fixture.pool.query("update employee set role = 'manager' where id = $1", [
				manager.employeeId,
			]);
			for (const report of [org.contractor, org.employee]) {
				await fixture.pool.query(
					`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
					 values ($1, $2, $3, true, $4)`,
					[randomUUID(), report.employeeId, manager.employeeId, org.ownerUserId],
				);
			}
			await fixture.submissionCadence({
				organizationId: org.organizationId,
				cadence: "weekly",
				changedAt: "2026-01-01T00:00:00Z",
				changedBy: org.ownerUserId,
			});
			await organizationWorkPolicy(org.organizationId, org.ownerUserId);
			for (const person of [org.contractor, org.employee]) {
				await fixture.work({
					organizationId: org.organizationId,
					employeeId: person.employeeId,
					userId: person.userId,
					start: "2026-03-02T07:00:00Z",
					end: "2026-03-02T15:30:00Z",
				});
			}
			const clock = { nowInstant: () => parseInstant("2026-03-08T12:00:00Z") };
			const submit = (userId: string) =>
				submitPeriodSubmission(
					{ organizationId: org.organizationId, userId, periodStartDate: "2026-03-02" },
					{ database: db, clock },
				);

			const control = await submit(org.employee.userId);
			if (control.kind !== "submitted") throw new Error(`control refused: ${control.reason}`);
			const submitted = await submit(org.contractor.userId);
			expect(submitted).toMatchObject({
				kind: "submitted",
				approverEmployeeIds: [manager.employeeId],
			});
			if (submitted.kind !== "submitted") throw new Error(`refused: ${submitted.reason}`);

			const facts = async (workflowId: string) => {
				const { rows } = await fixture.pool.query<{
					facts: { work: { totalMinutes: number }; target: unknown; violations: unknown[] };
				}>(
					"select facts from approval_submitted_revision where organization_id = $1 and workflow_id = $2",
					[org.organizationId, workflowId],
				);
				return rows[0]?.facts;
			};
			expect(await facts(submitted.workflowId)).toMatchObject({
				work: { totalMinutes: 510 },
				target: null,
				violations: [],
			});
			expect((await facts(control.workflowId))?.target).not.toBeNull();

			const { rows: assignments } = await fixture.pool.query<{ id: string }>(
				`select id from approval_stage_assignment
				 where organization_id = $1 and workflow_id = $2 and status = 'pending'`,
				[org.organizationId, submitted.workflowId],
			);
			await expect(
				decidePeriodSubmission(
					{
						organizationId: org.organizationId,
						actorEmployeeId: manager.employeeId,
						assignmentId: assignments[0]?.id ?? "",
						action: "approve",
						reason: null,
					},
					{ database: db, clock: { nowInstant: () => parseInstant("2026-03-09T09:00:00Z") } },
				),
			).resolves.toMatchObject({ status: "approved" });
		});
	});

	describe("unavailability", () => {
		async function categories(organizationId: string) {
			const unavailability = randomUUID();
			const vacation = randomUUID();
			await fixture.pool.query(
				`insert into absence_category
				 (id, organization_id, type, name, requires_approval, counts_against_vacation, is_active, updated_at)
				 values ($1, $3, 'contractor_unavailability', 'Unavailable', false, false, true, now()),
				        ($2, $3, 'vacation', 'Vacation', false, true, true, now())`,
				[unavailability, vacation, organizationId],
			);
			return { unavailability, vacation };
		}

		async function request(
			org: { organizationId: string },
			person: { employeeId: string; userId: string },
			categoryId: string,
		) {
			return requestAbsenceForEmployeeEffect(
				{
					categoryId,
					startDate: "2026-11-02",
					startPeriod: "full_day",
					endDate: "2026-11-04",
					endPeriod: "full_day",
				},
				{ id: person.employeeId, organizationId: org.organizationId },
				person.userId,
			);
		}

		it("records a contractor's unavailability without vacation, and refuses them vacation", async () => {
			const org = await organizationWithContractor();
			await vacationPolicy({
				organizationId: org.organizationId,
				createdBy: org.ownerUserId,
				accrualType: "annual",
			});
			const category = await categories(org.organizationId);
			const before = await loadVacationBalances(db, {
				organizationId: org.organizationId,
				employeeIds: [org.employee.employeeId],
				year: 2026,
				timezone: "UTC",
			});

			await expect(request(org, org.contractor, category.vacation)).resolves.toMatchObject({
				success: false,
			});
			await expect(request(org, org.employee, category.unavailability)).resolves.toMatchObject({
				success: false,
			});
			await expect(request(org, org.contractor, category.unavailability)).resolves.toMatchObject({
				success: true,
			});

			const { rows } = await fixture.pool.query<{ employee_id: string; status: string }>(
				"select employee_id, status from absence_entry where organization_id = $1",
				[org.organizationId],
			);
			expect(rows).toEqual([{ employee_id: org.contractor.employeeId, status: "approved" }]);
			const after = await loadVacationBalances(db, {
				organizationId: org.organizationId,
				employeeIds: [org.employee.employeeId, org.contractor.employeeId],
				year: 2026,
				timezone: "UTC",
			});
			expect(after.balances.get(org.employee.employeeId)).toEqual(
				before.balances.get(org.employee.employeeId),
			);
			expect(after.balances.has(org.contractor.employeeId)).toBe(false);
		});

		it("lets a manager record only unavailability for a contractor, and never for an employee", async () => {
			const org = await organizationWithContractor();
			const category = await categories(org.organizationId);
			session.userId = org.ownerUserId;
			session.organizationId = org.organizationId;
			const record = (employeeId: string, categoryId: string) =>
				recordAbsenceForEmployee({
					employeeId,
					categoryId,
					startDate: "2026-11-09",
					startPeriod: "full_day",
					endDate: "2026-11-10",
					endPeriod: "full_day",
				});

			await expect(record(org.contractor.employeeId, category.vacation)).resolves.toMatchObject({
				success: false,
				refusal: "contractor_records_unavailability_only",
			});
			await expect(record(org.employee.employeeId, category.unavailability)).resolves.toMatchObject(
				{
					success: false,
					refusal: "unavailability_is_for_contractors",
				},
			);
			await expect(
				record(org.contractor.employeeId, category.unavailability),
			).resolves.toMatchObject({ success: true });

			const { rows } = await fixture.pool.query<{ employee_id: string; category_id: string }>(
				"select employee_id, category_id from absence_entry where organization_id = $1",
				[org.organizationId],
			);
			expect(rows).toEqual([
				{ employee_id: org.contractor.employeeId, category_id: category.unavailability },
			]);
		});

		it("imports only unavailability for a contractor, and never for an employee", async () => {
			const org = await organizationWithContractor();
			await categories(org.organizationId);
			const { importBatch, importBatchJob, importStagedRow } = await import("@/db/schema");
			const { processImportReviewJob } = await import("@/lib/import-review/worker");
			const batchId = randomUUID();
			const jobId = randomUUID();
			await db.insert(importBatch).values({
				id: batchId,
				organizationId: org.organizationId,
				provider: "clockin",
				status: "committing",
				selectedScope: {},
				dateRange: { startDate: "2026-11-01", endDate: "2026-11-30" },
				startedBy: org.ownerUserId,
			});
			await db.insert(importBatchJob).values({
				id: jobId,
				batchId,
				organizationId: org.organizationId,
				kind: "commit",
				entityType: "absence",
				partitionKey: "absence",
			});
			const rows = [
				{
					source: "contractor-vacation",
					employeeId: org.contractor.employeeId,
					category: "Vacation",
				},
				{
					source: "contractor-unmapped",
					employeeId: org.contractor.employeeId,
					category: undefined,
				},
				{
					source: "employee-unavailable",
					employeeId: org.employee.employeeId,
					category: "Unavailable",
				},
				{
					source: "contractor-unavailable",
					employeeId: org.contractor.employeeId,
					category: "Unavailable",
				},
			];
			await db.insert(importStagedRow).values(
				rows.map((row, index) => ({
					batchId,
					organizationId: org.organizationId,
					entityType: "absence" as const,
					providerSourceId: `absence:${row.source}`,
					sourcePayloadHash: `hash-${row.source}`,
					sourcePayload: { id: row.source },
					normalizedPayload: {
						employeeId: row.employeeId,
						startsAt: `2026-11-${String(2 + index * 2).padStart(2, "0")}T00:00:00Z`,
						endsAt: `2026-11-${String(2 + index * 2).padStart(2, "0")}T23:59:00Z`,
						...(row.category ? { categoryName: row.category } : {}),
					},
					rowStatus: "accepted" as const,
					issueSeverity: "none" as const,
				})),
			);

			await processImportReviewJob({
				data: {
					type: "import-review-commit" as const,
					batchId,
					jobId,
					organizationId: org.organizationId,
					entityType: "absence" as const,
					committedBy: org.ownerUserId,
				},
				attemptsMade: 0,
				opts: { attempts: 1 },
			} as Parameters<typeof processImportReviewJob>[0]).catch(() => undefined);

			const { rows: staged } = await fixture.pool.query<{
				provider_source_id: string;
				row_status: string;
			}>(
				"select provider_source_id, row_status from import_staged_row where batch_id = $1 order by provider_source_id",
				[batchId],
			);
			expect(staged).toEqual([
				{ provider_source_id: "absence:contractor-unavailable", row_status: "committed" },
				{ provider_source_id: "absence:contractor-unmapped", row_status: "blocked" },
				{ provider_source_id: "absence:contractor-vacation", row_status: "blocked" },
				{ provider_source_id: "absence:employee-unavailable", row_status: "blocked" },
			]);
			const { rows: written } = await fixture.pool.query<{ employee_id: string }>(
				"select employee_id from absence_entry where organization_id = $1",
				[org.organizationId],
			);
			expect(written).toEqual([{ employee_id: org.contractor.employeeId }]);
		});

		it("offers a contractor only unavailability, and an employee everything else", async () => {
			const org = await organizationWithContractor();
			await categories(org.organizationId);

			const forContractor = await getAbsenceCategories(org.organizationId, {
				engagementKinds: ["contractor"],
			});
			const forEmployee = await getAbsenceCategories(org.organizationId, {
				engagementKinds: ["employee"],
			});
			expect(forContractor.map((category) => category.type)).toEqual(["contractor_unavailability"]);
			expect(forEmployee.map((category) => category.type)).toEqual(["vacation"]);
		});

		it("shows a contractor's unavailability on the team calendar, distinct from vacation", async () => {
			const org = await organizationWithContractor();
			const category = await categories(org.organizationId);
			await fixture.pool.query("update absence_category set color = '#10b981' where id = $1", [
				category.unavailability,
			]);
			await expect(request(org, org.contractor, category.unavailability)).resolves.toMatchObject({
				success: true,
			});

			const events = await getAbsencesForMonth(10, 2026, { organizationId: org.organizationId });

			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				color: "#94a3b8",
				metadata: { isContractorUnavailability: true, status: "approved" },
			});
		});

		it("keeps a contractor's unavailability from releasing any required time or payroll absence", async () => {
			const org = await organizationWithContractor();
			const category = await categories(org.organizationId);
			await expect(request(org, org.contractor, category.unavailability)).resolves.toMatchObject({
				success: true,
			});

			expect(
				await getDailyWorkRequirementsForEmployee({
					organizationId: org.organizationId,
					employeeId: org.contractor.employeeId,
					startDate: new Date("2026-11-02T00:00:00Z"),
					endDate: new Date("2026-11-04T23:59:59Z"),
				}),
			).toEqual({});
			const absencesForPayroll = await fetchAbsencesForExport(
				org.organizationId,
				{
					dateRange: {
						start: parsePlainDate("2026-11-01"),
						end: parsePlainDate("2026-11-30"),
					},
				},
				{ canonicalReadiness: "absences" },
			);
			expect(absencesForPayroll).toEqual([]);
		});

		describe("by the stint each absence day falls in", () => {
			/**
			 * Employed until 30 June 2026, an External Contractor from 1 July: their kind today is
			 * contractor, but June's days belong to the employee stint.
			 */
			async function convertedOnFirstOfJuly() {
				const { organizationId, ownerUserId } = await fixture.organization("UTC");
				const person = await fixture.seedEmployee({ organizationId });
				await fixture.pool.query(
					`update employee_employment_period set status = 'closed', ended_at = '2026-07-01T00:00:00Z'
					 where employee_id = $1`,
					[person.employeeId],
				);
				await fixture.pool.query(
					`insert into employee_employment_period
					 (organization_id, employee_id, status, started_at, start_provenance, engagement_kind)
					 values ($1, $2, 'open', '2026-07-01T00:00:00Z', 'recorded', 'contractor')`,
					[organizationId, person.employeeId],
				);
				await fixture.pool.query(
					"update employee set engagement_kind = 'contractor' where id = $1",
					[person.employeeId],
				);
				const category = await categories(organizationId);
				const personal = randomUUID();
				await fixture.pool.query(
					`insert into absence_category
					 (id, organization_id, type, name, requires_approval, counts_against_vacation, is_active, updated_at)
					 values ($1, $2, 'personal', 'Personal', false, false, true, now())`,
					[personal, organizationId],
				);
				return { organizationId, ownerUserId, person, category: { ...category, personal } };
			}

			const range = (startDate: string, endDate: string) => ({
				startDate,
				startPeriod: "full_day" as const,
				endDate,
				endPeriod: "full_day" as const,
			});

			/** Moves the conversion from employee to contractor to the start of `day` (UTC). */
			async function convertOn(personId: string, day: string) {
				const at = `${day}T00:00:00Z`;
				// Keep the stints from overlapping at every step.
				const earlier = day < "2026-07-01";
				for (const step of earlier ? ["closed", "open"] : ["open", "closed"])
					await fixture.pool.query(
						step === "closed"
							? "update employee_employment_period set ended_at = $2 where employee_id = $1 and status = 'closed'"
							: "update employee_employment_period set started_at = $2 where employee_id = $1 and status = 'open'",
						[personId, at],
					);
			}

			it("takes a late employee absence for June and unavailability for July in self-service", async () => {
				const org = await convertedOnFirstOfJuly();
				const request = (categoryId: string, startDate: string, endDate: string) =>
					requestAbsenceForEmployeeEffect(
						{ categoryId, ...range(startDate, endDate) },
						{ id: org.person.employeeId, organizationId: org.organizationId },
						org.person.userId,
					);

				await expect(
					request(org.category.personal, "2026-06-29", "2026-06-29"),
				).resolves.toMatchObject({ success: true });
				await expect(
					request(org.category.unavailability, "2026-06-26", "2026-06-26"),
				).resolves.toMatchObject({ success: false, refusal: "unavailability_is_for_contractors" });
				await expect(
					request(org.category.personal, "2026-07-06", "2026-07-06"),
				).resolves.toMatchObject({
					success: false,
					refusal: "contractor_records_unavailability_only",
				});
				await expect(
					request(org.category.unavailability, "2026-07-02", "2026-07-02"),
				).resolves.toMatchObject({ success: true });
				// Across the conversion no category fits every day: each part is recorded on its own.
				await expect(
					request(org.category.unavailability, "2026-06-30", "2026-07-01"),
				).resolves.toMatchObject({ success: false, refusal: "absence_spans_engagement_change" });
			});

			it("lets a manager record a June absence and July unavailability", async () => {
				const org = await convertedOnFirstOfJuly();
				session.userId = org.ownerUserId;
				session.organizationId = org.organizationId;
				const record = (categoryId: string, startDate: string, endDate: string) =>
					recordAbsenceForEmployee({
						employeeId: org.person.employeeId,
						categoryId,
						...range(startDate, endDate),
					});

				await expect(
					record(org.category.personal, "2026-06-22", "2026-06-23"),
				).resolves.toMatchObject({ success: true });
				await expect(
					record(org.category.unavailability, "2026-06-24", "2026-06-24"),
				).resolves.toMatchObject({ success: false, refusal: "unavailability_is_for_contractors" });
				await expect(
					record(org.category.unavailability, "2026-07-13", "2026-07-14"),
				).resolves.toMatchObject({ success: true });
				await expect(
					record(org.category.personal, "2026-06-30", "2026-07-01"),
				).resolves.toMatchObject({ success: false, refusal: "absence_spans_engagement_change" });
			});

			it("imports June's absences of the employee stint and July's unavailability", async () => {
				const org = await convertedOnFirstOfJuly();
				const { importBatch, importBatchJob, importStagedRow } = await import("@/db/schema");
				const { processImportReviewJob } = await import("@/lib/import-review/worker");
				const batchId = randomUUID();
				const jobId = randomUUID();
				await db.insert(importBatch).values({
					id: batchId,
					organizationId: org.organizationId,
					provider: "clockin",
					status: "committing",
					selectedScope: {},
					dateRange: { startDate: "2026-06-01", endDate: "2026-07-31" },
					startedBy: org.ownerUserId,
				});
				await db.insert(importBatchJob).values({
					id: jobId,
					batchId,
					organizationId: org.organizationId,
					kind: "commit",
					entityType: "absence",
					partitionKey: "absence",
				});
				const rows = [
					{ source: "june-personal", category: "Personal", from: "2026-06-08", to: "2026-06-10" },
					{
						source: "june-unavailable",
						category: "Unavailable",
						from: "2026-06-15",
						to: "2026-06-15",
					},
					{
						source: "july-unavailable",
						category: "Unavailable",
						from: "2026-07-06",
						to: "2026-07-07",
					},
					{ source: "july-personal", category: "Personal", from: "2026-07-13", to: "2026-07-13" },
					{ source: "across-personal", category: "Personal", from: "2026-06-29", to: "2026-07-02" },
				];
				await db.insert(importStagedRow).values(
					rows.map((row) => ({
						batchId,
						organizationId: org.organizationId,
						entityType: "absence" as const,
						providerSourceId: `absence:${row.source}`,
						sourcePayloadHash: `hash-${row.source}`,
						sourcePayload: { id: row.source },
						normalizedPayload: {
							employeeId: org.person.employeeId,
							startsAt: `${row.from}T00:00:00Z`,
							endsAt: `${row.to}T23:59:00Z`,
							categoryName: row.category,
						},
						rowStatus: "accepted" as const,
						issueSeverity: "none" as const,
					})),
				);

				await processImportReviewJob({
					data: {
						type: "import-review-commit" as const,
						batchId,
						jobId,
						organizationId: org.organizationId,
						entityType: "absence" as const,
						committedBy: org.ownerUserId,
					},
					attemptsMade: 0,
					opts: { attempts: 1 },
				} as Parameters<typeof processImportReviewJob>[0]).catch(() => undefined);

				const { rows: staged } = await fixture.pool.query<{
					provider_source_id: string;
					row_status: string;
				}>(
					"select provider_source_id, row_status from import_staged_row where batch_id = $1 order by provider_source_id",
					[batchId],
				);
				expect(staged).toEqual([
					{ provider_source_id: "absence:across-personal", row_status: "blocked" },
					{ provider_source_id: "absence:july-personal", row_status: "blocked" },
					{ provider_source_id: "absence:july-unavailable", row_status: "committed" },
					{ provider_source_id: "absence:june-personal", row_status: "committed" },
					{ provider_source_id: "absence:june-unavailable", row_status: "blocked" },
				]);
			});

			describe("in absence change requests", () => {
				/** The converted person, a manager deciding their requests, and one recorded absence. */
				async function recordedAbsence(
					category: "personal" | "unavailability",
					startDate: string,
					endDate: string,
				) {
					const org = await convertedOnFirstOfJuly();
					const manager = await fixture.seedEmployee({ organizationId: org.organizationId });
					await fixture.pool.query("update employee set role = 'manager' where id = $1", [
						manager.employeeId,
					]);
					await fixture.pool.query(
						`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
						 values ($1, $2, $3, true, $4)`,
						[randomUUID(), org.person.employeeId, manager.employeeId, org.ownerUserId],
					);
					await expect(
						requestAbsenceForEmployeeEffect(
							{ categoryId: org.category[category], ...range(startDate, endDate) },
							{ id: org.person.employeeId, organizationId: org.organizationId },
							org.person.userId,
						),
					).resolves.toMatchObject({ success: true });
					const { rows } = await fixture.pool.query<{ id: string }>(
						"select id from absence_entry where organization_id = $1 and employee_id = $2",
						[org.organizationId, org.person.employeeId],
					);
					const absenceId = rows[0]?.id;
					if (!absenceId) throw new Error("Recorded absence missing");
					const change = (startDate: string, endDate: string) =>
						requestAbsenceChange({
							organizationId: org.organizationId,
							userId: org.person.userId,
							absenceId,
							kind: "change",
							proposed: range(startDate, endDate),
							coverage: "choose",
							reason: "Moved",
						});
					const approve = async (workflowId: string) => {
						const assignments = await fixture.pool.query<{ id: string }>(
							"select id from approval_stage_assignment where workflow_id = $1 and status = 'pending'",
							[workflowId],
						);
						const assignmentId = assignments.rows[0]?.id;
						if (!assignmentId) throw new Error("Pending assignment missing");
						return decideAbsenceChange({
							organizationId: org.organizationId,
							actorEmployeeId: manager.employeeId,
							assignmentId,
							action: "approve",
						});
					};
					const recorded = async () =>
						(
							await fixture.pool.query<{ start_date: string; end_date: string }>(
								"select start_date::text, end_date::text from absence_entry where id = $1",
								[absenceId],
							)
						).rows[0];
					return { ...org, absenceId, change, approve, recorded };
				}

				it("refuses moving an employee absence onto contractor days or across the conversion", async () => {
					const org = await recordedAbsence("personal", "2026-06-22", "2026-06-23");

					await expect(org.change("2026-07-06", "2026-07-07")).rejects.toMatchObject({
						refusal: "contractor_records_unavailability_only",
					});
					await expect(org.change("2026-06-30", "2026-07-01")).rejects.toMatchObject({
						refusal: "absence_spans_engagement_change",
					});
					await expect(org.change("2026-06-25", "2026-06-26")).resolves.toMatchObject({
						workflowId: expect.any(String),
					});
				});

				it("refuses moving contractor unavailability onto employee days", async () => {
					const org = await recordedAbsence("unavailability", "2026-07-13", "2026-07-13");

					await expect(org.change("2026-06-29", "2026-06-29")).rejects.toMatchObject({
						refusal: "unavailability_is_for_contractors",
					});
					await expect(org.change("2026-07-08", "2026-07-08")).resolves.toMatchObject({
						workflowId: expect.any(String),
					});
				});

				it("re-checks the stints on approval: an employee absence now on contractor days", async () => {
					const org = await recordedAbsence("personal", "2026-06-22", "2026-06-23");
					const submitted = await org.change("2026-06-25", "2026-06-26");
					await convertOn(org.person.employeeId, "2026-06-24");

					await expect(org.approve(submitted.workflowId)).rejects.toMatchObject({
						code: "obsolete",
					});
					expect(await org.recorded()).toEqual({
						start_date: "2026-06-22",
						end_date: "2026-06-23",
					});
				});

				it("re-checks the stints on approval: unavailability now on employee days", async () => {
					const org = await recordedAbsence("unavailability", "2026-07-13", "2026-07-13");
					const submitted = await org.change("2026-07-08", "2026-07-08");
					await convertOn(org.person.employeeId, "2026-07-10");

					await expect(org.approve(submitted.workflowId)).rejects.toMatchObject({
						code: "obsolete",
					});
					expect(await org.recorded()).toEqual({
						start_date: "2026-07-13",
						end_date: "2026-07-13",
					});
				});

				it("approves a move within the stint", async () => {
					const org = await recordedAbsence("unavailability", "2026-07-13", "2026-07-13");
					const submitted = await org.change("2026-07-08", "2026-07-08");

					await org.approve(submitted.workflowId);
					expect(await org.recorded()).toEqual({
						start_date: "2026-07-08",
						end_date: "2026-07-08",
					});
				});
			});

			describe.each(["legacy", "canonical"] as const)(
				"in pending absence requests (%s approvals)",
				(mode) => {
					/**
					 * The converted person with a pending request a manager decides. The stints may change
					 * while it waits: a departure does not withdraw pending requests.
					 */
					async function pendingRequest(
						category: "personal" | "unavailability",
						startDate: string,
						endDate: string,
					) {
						const org = await convertedOnFirstOfJuly();
						await fixture.pool.query(
							`insert into approval_workflow_rollout
							 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
							 values ($1, 'absence', $2, $3, now(), now())`,
							[org.organizationId, mode, mode],
						);
						await fixture.pool.query(
							"update absence_category set requires_approval = true where organization_id = $1",
							[org.organizationId],
						);
						const manager = await fixture.seedEmployee({ organizationId: org.organizationId });
						await fixture.pool.query("update employee set role = 'manager' where id = $1", [
							manager.employeeId,
						]);
						await fixture.pool.query(
							`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
							 values ($1, $2, $3, true, $4)`,
							[randomUUID(), org.person.employeeId, manager.employeeId, org.ownerUserId],
						);
						await expect(
							requestAbsenceForEmployeeEffect(
								{ categoryId: org.category[category], ...range(startDate, endDate) },
								{ id: org.person.employeeId, organizationId: org.organizationId },
								org.person.userId,
							),
						).resolves.toMatchObject({ success: true });
						const { rows } = await fixture.pool.query<{ id: string }>(
							"select id from absence_entry where organization_id = $1 and employee_id = $2",
							[org.organizationId, org.person.employeeId],
						);
						const absenceId = rows[0]?.id;
						if (!absenceId) throw new Error("Requested absence missing");
						const approve = async () => {
							const requests = await fixture.pool.query<{ id: string }>(
								"select id from approval_request where organization_id = $1 and entity_id = $2 and status = 'pending'",
								[org.organizationId, absenceId],
							);
							session.userId = manager.userId;
							session.organizationId = org.organizationId;
							try {
								return await approveAbsenceEffect(absenceId, {
									approvalRequestId: requests.rows[0]?.id,
								});
							} finally {
								session.userId = null;
								session.organizationId = null;
							}
						};
						const status = async () =>
							(
								await fixture.pool.query<{ status: string }>(
									"select status from absence_entry where id = $1",
									[absenceId],
								)
							).rows[0]?.status;
						return { ...org, absenceId, approve, status };
					}

					it("refuses approving an employee absence whose days became contractor days", async () => {
						const org = await pendingRequest("personal", "2026-06-25", "2026-06-26");
						await convertOn(org.person.employeeId, "2026-06-24");

						await expect(org.approve()).resolves.toMatchObject({
							success: false,
							refusal: "contractor_records_unavailability_only",
						});
						expect(await org.status()).toBe("pending");
					});

					it("refuses approving unavailability whose days became employee days", async () => {
						const org = await pendingRequest("unavailability", "2026-07-08", "2026-07-08");
						await convertOn(org.person.employeeId, "2026-07-10");

						await expect(org.approve()).resolves.toMatchObject({
							success: false,
							refusal: "unavailability_is_for_contractors",
						});
						expect(await org.status()).toBe("pending");
					});

					it("refuses approving an absence the conversion now splits", async () => {
						const org = await pendingRequest("personal", "2026-06-25", "2026-06-26");
						await convertOn(org.person.employeeId, "2026-06-26");

						await expect(org.approve()).resolves.toMatchObject({
							success: false,
							refusal: "absence_spans_engagement_change",
						});
						expect(await org.status()).toBe("pending");
					});

					it("approves an absence still within its stint", async () => {
						const org = await pendingRequest("unavailability", "2026-07-08", "2026-07-08");

						await expect(org.approve()).resolves.toMatchObject({ success: true });
						expect(await org.status()).toBe("approved");
					});
				},
			);

			it("offers the categories of every stint, the server deciding each request by its dates", async () => {
				const org = await convertedOnFirstOfJuly();
				const { loadEngagementKindsOfStints } = await import("@/lib/absences/absence-engagement");

				const kinds = await loadEngagementKindsOfStints(db, {
					organizationId: org.organizationId,
					employeeIds: [org.person.employeeId],
				});
				const offered = await getAbsenceCategories(org.organizationId, {
					engagementKinds: kinds.get(org.person.employeeId),
				});
				expect(kinds.get(org.person.employeeId)?.toSorted()).toEqual(["contractor", "employee"]);
				expect(offered.map((category) => category.type).toSorted()).toEqual([
					"contractor_unavailability",
					"personal",
					"vacation",
				]);
			});
		});

		it("refuses an unavailability category that would deduct vacation or work time", async () => {
			const { organizationId } = await fixture.organization("UTC");
			await expect(
				fixture.pool.query(
					`insert into absence_category
					 (organization_id, type, name, counts_against_vacation, updated_at)
					 values ($1, 'contractor_unavailability', 'Unavailable', true, now())`,
					[organizationId],
				),
			).rejects.toMatchObject({
				code: "23514",
				constraint: "absence_category_contractor_unavailability_check",
			});
		});
	});

	/** An organization-wide work policy expecting 8 hours every weekday. */
	async function organizationWorkPolicy(organizationId: string, createdBy: string) {
		const policyId = randomUUID();
		await fixture.pool.query(
			`insert into work_policy
			 (id, organization_id, name, schedule_enabled, regulation_enabled, is_active, created_by, updated_at)
			 values ($1, $2, 'Weekdays', true, false, true, $3, now())`,
			[policyId, organizationId, createdBy],
		);
		const {
			rows: [version],
		} = await fixture.pool.query<{ id: string }>(
			`insert into work_policy_version
			 (policy_id, organization_id, version_number, effective_from_date, schedule_enabled, regulation_enabled, presence_enabled, is_legacy_baseline, created_by)
			 values ($1, $2, 1, '1970-01-01', true, false, false, true, $3)
			 returning id`,
			[policyId, organizationId, createdBy],
		);
		await fixture.pool.query(
			`insert into work_policy_schedule
			 (policy_id, policy_version_id, schedule_cycle, schedule_type, working_days_preset, hours_per_cycle, updated_at)
			 values ($1, $2, 'weekly', 'simple', 'weekdays', '40', now())`,
			[policyId, version?.id],
		);
		await fixture.pool.query(
			`insert into work_policy_assignment
			 (policy_id, organization_id, assignment_type, priority, is_active, created_by, updated_at)
			 values ($1, $2, 'organization', 0, true, $3, now())`,
			[policyId, organizationId, createdBy],
		);
	}
});
