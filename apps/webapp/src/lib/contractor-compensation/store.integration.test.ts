/**
 * PostgreSQL contract of contractor compensation terms (#1998): the table's
 * checks and non-overlap constraint, contractor periods only, effective-dated
 * changes, and tenant isolation.
 */
import { randomUUID } from "node:crypto";
import type { DatabaseError } from "pg";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import {
	changeContractorTerms,
	listContractorCompensationOverview,
	listContractorTermsForPricing,
	listContractorTermsHistory,
	loadContractorCompensation,
} from "./store";
import type { ContractorCompensationInput } from "./terms";

const hourlyInput = (rateAmount: string): ContractorCompensationInput => ({
	basis: "hourly",
	rateAmount,
	currency: "EUR",
});

describe("contractor compensation terms on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let contractor: SeededEmployee;
	let employee: SeededEmployee;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(`update organization set timezone = 'Europe/Berlin' where id = $1`, [
			fixture.organizationId,
		]);
		contractor = await fixture.seedEmployee({ engagementKind: "contractor" });
		employee = await fixture.seedEmployee();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function rawInsert(
		target: SeededEmployee,
		columns: Record<string, unknown>,
		organizationId = fixture.organizationId,
	) {
		const values = {
			organization_id: organizationId,
			employee_id: target.employeeId,
			employment_period_id: target.employmentPeriodId,
			compensation_basis: "hourly",
			rate_amount: "90.00",
			effective_from: "2030-01-01",
			...columns,
		};
		const keys = Object.keys(values);
		return fixture.pool.query(
			`insert into contractor_compensation_terms (${keys.map((key) => `"${key}"`).join(", ")})
			 values (${keys.map((_, index) => `$${index + 1}`).join(", ")}) returning id`,
			Object.values(values),
		);
	}

	async function refusal(promise: Promise<unknown>) {
		const error = (await promise.then(
			() => null,
			(caught: unknown) => caught,
		)) as DatabaseError | null;
		return error ? { code: error.code, constraint: error.constraint } : null;
	}

	describe("the table", () => {
		it("refuses terms on an employee period", async () => {
			expect(await refusal(rawInsert(employee, {}))).toEqual({
				code: "23514",
				constraint: "contractorCompensationTerms_contractor_period",
			});
		});

		it("refuses terms whose period belongs to another organization or employee", async () => {
			const otherOrganization = await fixture.createOrganization();
			const notTheirPeriod = {
				code: "23514",
				constraint: "contractorCompensationTerms_contractor_period",
			};
			expect(await refusal(rawInsert(contractor, {}, otherOrganization))).toEqual(notTheirPeriod);
			expect(
				await refusal(rawInsert({ ...contractor, employeeId: employee.employeeId }, {})),
			).toEqual(notTheirPeriod);
		});

		it("refuses overlapping terms of one employment period", async () => {
			const own = await fixture.seedEmployee({ engagementKind: "contractor" });
			await rawInsert(own, { effective_from: "2030-01-01", effective_to: "2030-02-01" });
			await rawInsert(own, { effective_from: "2030-02-01" });

			expect(
				await refusal(rawInsert(own, { effective_from: "2030-01-15", effective_to: "2030-01-20" })),
			).toEqual({ code: "23P01", constraint: "contractorCompensationTerms_no_overlap" });
		});

		it.each([
			["a daily basis without a rule", { compensation_basis: "daily" }],
			["an hourly basis with a rule", { day_unit_rule: "any_work_full_day" }],
			[
				"a half-day rule without its threshold",
				{ compensation_basis: "daily", day_unit_rule: "half_and_full_day" },
			],
			[
				"a threshold of 0 minutes",
				{
					compensation_basis: "daily",
					day_unit_rule: "half_and_full_day",
					half_day_threshold_minutes: 0,
				},
			],
			[
				"a standard day above 1440 minutes",
				{
					compensation_basis: "daily",
					day_unit_rule: "prorated_by_standard_day",
					standard_day_minutes: 1441,
					cap_at_one_day: true,
				},
			],
			[
				"a prorated rule without a cap setting",
				{
					compensation_basis: "daily",
					day_unit_rule: "prorated_by_standard_day",
					standard_day_minutes: 480,
				},
			],
			[
				"settings of another rule",
				{
					compensation_basis: "daily",
					day_unit_rule: "any_work_full_day",
					standard_day_minutes: 480,
				},
			],
		])("refuses %s", async (_name, columns) => {
			const own = await fixture.seedEmployee({ engagementKind: "contractor" });
			expect(await refusal(rawInsert(own, columns))).toEqual({
				code: "23514",
				constraint: "contractorCompensationTerms_day_unit_rule_check",
			});
		});

		it.each([
			["a zero rate", { rate_amount: "0" }, "contractorCompensationTerms_rate_positive_check"],
			["a lowercase currency", { currency: "eur" }, "contractorCompensationTerms_currency_check"],
			[
				"an end on its start",
				{ effective_from: "2030-01-01", effective_to: "2030-01-01" },
				"contractorCompensationTerms_period_check",
			],
		])("refuses %s", async (_name, columns, constraint) => {
			const own = await fixture.seedEmployee({ engagementKind: "contractor" });
			expect(await refusal(rawInsert(own, columns))).toEqual({ code: "23514", constraint });
		});

		it("accepts each valid rule and defaults the currency to EUR", async () => {
			const own = await fixture.seedEmployee({ engagementKind: "contractor" });
			await rawInsert(own, { effective_from: "2030-01-01", effective_to: "2030-02-01" });
			await rawInsert(own, {
				compensation_basis: "daily",
				day_unit_rule: "any_work_full_day",
				effective_from: "2030-02-01",
				effective_to: "2030-03-01",
			});
			await rawInsert(own, {
				compensation_basis: "daily",
				day_unit_rule: "half_and_full_day",
				half_day_threshold_minutes: 1440,
				effective_from: "2030-03-01",
				effective_to: "2030-04-01",
			});
			await rawInsert(own, {
				compensation_basis: "daily",
				day_unit_rule: "prorated_by_standard_day",
				standard_day_minutes: 1,
				cap_at_one_day: false,
				effective_from: "2030-04-01",
			});

			const { rows } = await fixture.pool.query<{ currency: string }>(
				`select distinct currency from contractor_compensation_terms where employee_id = $1`,
				[own.employeeId],
			);
			expect(rows).toEqual([{ currency: "EUR" }]);
		});
	});

	describe("changing terms", () => {
		it("sets terms from a date and renegotiates them without rewriting earlier periods", async () => {
			const own = await fixture.seedEmployee({ engagementKind: "contractor" });
			const first = await changeContractorTerms(db, {
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				employeeId: own.employeeId,
				change: { kind: "set", effectiveFrom: "2026-02-01", compensation: hourlyInput("90") },
			});
			expect(first).toMatchObject({ ok: true, changed: true });

			const renegotiated = await changeContractorTerms(db, {
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				employeeId: own.employeeId,
				change: {
					kind: "set",
					effectiveFrom: "2026-04-01",
					compensation: {
						basis: "daily",
						rateAmount: "650",
						currency: "EUR",
						dayUnitRule: "half_and_full_day",
					},
				},
			});

			expect(renegotiated.ok && renegotiated.history.map(viewSummary)).toEqual([
				{
					from: "2026-04-01",
					to: null,
					basis: "daily",
					rate: "650.00",
					rule: "half_and_full_day",
					threshold: 240,
				},
				{
					from: "2026-02-01",
					to: "2026-04-01",
					basis: "hourly",
					rate: "90.00",
					rule: null,
					threshold: null,
				},
			]);
		});

		it("reports an unchanged repeat and ends terms from a date", async () => {
			const own = await fixture.seedEmployee({ engagementKind: "contractor" });
			const input = {
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				employeeId: own.employeeId,
			};
			await changeContractorTerms(db, {
				...input,
				change: { kind: "set", effectiveFrom: "2026-02-01", compensation: hourlyInput("90") },
			});
			expect(
				await changeContractorTerms(db, {
					...input,
					change: { kind: "set", effectiveFrom: "2026-03-01", compensation: hourlyInput("90.00") },
				}),
			).toMatchObject({ ok: true, changed: false });

			const ended = await changeContractorTerms(db, {
				...input,
				change: { kind: "end", effectiveFrom: "2026-05-01" },
			});
			expect(ended.ok && ended.history.map(viewSummary)).toEqual([
				{
					from: "2026-02-01",
					to: "2026-05-01",
					basis: "hourly",
					rate: "90.00",
					rule: null,
					threshold: null,
				},
			]);

			const { rows } = await fixture.pool.query<{ action: string }>(
				`select action from audit_log where organization_id = $1 and employee_id = $2 order by timestamp`,
				[fixture.organizationId, own.employeeId],
			);
			expect(rows.map((row) => row.action)).toEqual([
				"employee.contractor_terms_set",
				"employee.contractor_terms_ended",
			]);
		});

		it("refuses an employee's period: employee contract terms are a separate thing", async () => {
			expect(
				await changeContractorTerms(db, {
					organizationId: fixture.organizationId,
					actorUserId: fixture.ownerUserId,
					employeeId: employee.employeeId,
					change: { kind: "set", effectiveFrom: "2026-02-01", compensation: hourlyInput("90") },
				}),
			).toEqual({ ok: false, reason: "not_contractor" });
		});

		it("refuses terms before the engagement started, in the organization's calendar", async () => {
			// The fixture's periods start at 2026-01-01T00:00Z, 01:00 on 1 January in Berlin.
			const own = await fixture.seedEmployee({ engagementKind: "contractor" });
			const change = (effectiveFrom: string) =>
				changeContractorTerms(db, {
					organizationId: fixture.organizationId,
					actorUserId: fixture.ownerUserId,
					employeeId: own.employeeId,
					change: { kind: "set", effectiveFrom, compensation: hourlyInput("90") },
				});

			expect(await change("2025-12-31")).toEqual({ ok: false, reason: "before_engagement" });
			expect(await change("2026-01-01")).toMatchObject({ ok: true, changed: true });
		});

		it("refuses invalid terms and dates without writing", async () => {
			const base = {
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				employeeId: contractor.employeeId,
			};
			expect(
				await changeContractorTerms(db, {
					...base,
					change: {
						kind: "set",
						effectiveFrom: "2026-02-01",
						compensation: { basis: "daily", rateAmount: "650", currency: "EUR" },
					},
				}),
			).toEqual({ ok: false, reason: "invalid_day_unit_rule" });
			expect(
				await changeContractorTerms(db, {
					...base,
					change: { kind: "set", effectiveFrom: "2026-02-30", compensation: hourlyInput("90") },
				}),
			).toEqual({ ok: false, reason: "invalid_date" });
		});
	});

	describe("engagement boundaries", () => {
		async function endPeriod(periodId: string, endedAt: string) {
			await fixture.pool.query(
				`update employee_employment_period set status = 'closed', ended_at = $2 where id = $1`,
				[periodId, endedAt],
			);
		}

		async function addPeriod(
			employeeId: string,
			engagementKind: "employee" | "contractor",
			startedAt: string,
		) {
			const id = randomUUID();
			await fixture.pool.query(
				`insert into employee_employment_period
				 (id, organization_id, employee_id, status, started_at, start_provenance, engagement_kind)
				 values ($1, $2, $3, 'open', $4, 'recorded', $5)`,
				[id, fixture.organizationId, employeeId, startedAt, engagementKind],
			);
			return id;
		}

		async function contractorWithOpenTerms() {
			const own = await fixture.seedEmployee({ engagementKind: "contractor" });
			const outcome = await changeContractorTerms(db, {
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				employeeId: own.employeeId,
				change: {
					kind: "set",
					effectiveFrom: "2026-02-01",
					compensation: {
						basis: "daily",
						rateAmount: "650",
						currency: "EUR",
						dayUnitRule: "any_work_full_day",
					},
				},
			});
			if (!outcome.ok) throw new Error(outcome.reason);
			return own;
		}

		const may = Temporal.Instant.from("2026-05-04T10:00:00Z");

		it.each([
			// Scheduled departure: the period ends at local midnight after the last working day.
			["at local midnight after its last day", "2026-03-15T23:00:00Z", "2026-03-16"],
			// Offboarded now: the period ends during its last day.
			["during its last day", "2026-03-16T10:00:00Z", "2026-03-17"],
		])(
			"prices open terms only through the last day of an engagement that ended %s",
			async (_name, endedAt, exclusiveEnd) => {
				const own = await contractorWithOpenTerms();
				await endPeriod(own.employmentPeriodId, endedAt);

				const terms = await listContractorTermsForPricing(db, fixture.organizationId, {
					employeeIds: [own.employeeId],
				});
				expect(terms.map((entry) => [entry.from.toString(), entry.to?.toString()])).toEqual([
					["2026-02-01", exclusiveEnd],
				]);
			},
		);

		it("shows the terms in force today of an active contractor", async () => {
			const own = await contractorWithOpenTerms();

			const [row] = (
				await listContractorCompensationOverview(db, fixture.organizationId, may)
			).filter((entry) => entry.employeeId === own.employeeId);
			const record = await loadContractorCompensation(
				db,
				fixture.organizationId,
				own.employeeId,
				may,
			);
			expect(row).toMatchObject({ engagementKind: "contractor" });
			expect(row?.termsToday?.compensation.rateAmount).toBe("650.00");
			expect(record?.termsInEffectId).toBe(row?.termsToday?.id);
		});

		it("shows no rate today for a new engagement without terms after one that left terms open", async () => {
			const own = await contractorWithOpenTerms();
			await endPeriod(own.employmentPeriodId, "2026-03-15T23:00:00Z");
			const next = await addPeriod(own.employeeId, "contractor", "2026-04-01T00:00:00Z");

			const [row] = (
				await listContractorCompensationOverview(db, fixture.organizationId, may)
			).filter((entry) => entry.employeeId === own.employeeId);
			const record = await loadContractorCompensation(
				db,
				fixture.organizationId,
				own.employeeId,
				may,
			);
			expect(row).toMatchObject({ engagementKind: "contractor", termsToday: null });
			// The earlier engagement's terms stay on record, but only the new one's can be ended.
			expect(record).toMatchObject({
				activeEngagementKind: "contractor",
				contractorEngagementId: next,
				termsInEffectId: null,
			});
			expect(record?.history.map((terms) => terms.employmentPeriodId)).toEqual([
				own.employmentPeriodId,
			]);
		});

		it("lists a former contractor rehired as an employee by today's kind, without a rate", async () => {
			const own = await contractorWithOpenTerms();
			await endPeriod(own.employmentPeriodId, "2026-03-15T23:00:00Z");
			await addPeriod(own.employeeId, "employee", "2026-04-01T00:00:00Z");
			await fixture.pool.query(`update employee set engagement_kind = 'employee' where id = $1`, [
				own.employeeId,
			]);

			const [row] = (
				await listContractorCompensationOverview(db, fixture.organizationId, may)
			).filter((entry) => entry.employeeId === own.employeeId);
			const record = await loadContractorCompensation(
				db,
				fixture.organizationId,
				own.employeeId,
				may,
			);
			expect(row).toMatchObject({ engagementKind: "employee", termsToday: null });
			expect(record).toMatchObject({
				activeEngagementKind: "employee",
				contractorEngagementId: null,
				termsInEffectId: null,
			});
		});

		it("reports the terms in force after a change", async () => {
			const own = await fixture.seedEmployee({ engagementKind: "contractor" });
			const outcome = await changeContractorTerms(db, {
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				employeeId: own.employeeId,
				change: { kind: "set", effectiveFrom: "2026-02-01", compensation: hourlyInput("90") },
				now: may,
			});
			expect(outcome.ok && outcome.termsInEffectId).toBe(outcome.ok && outcome.history[0]?.id);

			const ended = await changeContractorTerms(db, {
				organizationId: fixture.organizationId,
				actorUserId: fixture.ownerUserId,
				employeeId: own.employeeId,
				change: { kind: "end", effectiveFrom: "2026-05-01" },
				now: may,
			});
			expect(ended).toMatchObject({ ok: true, termsInEffectId: null });
		});
	});

	describe("tenant isolation", () => {
		it("never reaches another organization's contractor", async () => {
			const otherOrganization = await fixture.createOrganization();
			const foreign = await fixture.seedEmployee({
				organizationId: otherOrganization,
				engagementKind: "contractor",
			});
			await changeContractorTerms(db, {
				organizationId: otherOrganization,
				actorUserId: fixture.ownerUserId,
				employeeId: foreign.employeeId,
				change: { kind: "set", effectiveFrom: "2026-02-01", compensation: hourlyInput("120") },
			});

			expect(
				await changeContractorTerms(db, {
					organizationId: fixture.organizationId,
					actorUserId: fixture.ownerUserId,
					employeeId: foreign.employeeId,
					change: { kind: "set", effectiveFrom: "2026-03-01", compensation: hourlyInput("1") },
				}),
			).toEqual({ ok: false, reason: "employee_not_found" });
			expect(
				await listContractorTermsHistory(db, fixture.organizationId, foreign.employeeId),
			).toEqual([]);
			expect(
				(await listContractorTermsHistory(db, otherOrganization, foreign.employeeId)).map(
					viewSummary,
				),
			).toEqual([
				{
					from: "2026-02-01",
					to: null,
					basis: "hourly",
					rate: "120.00",
					rule: null,
					threshold: null,
				},
			]);
		});

		it("does not take a random id for an employee", async () => {
			expect(
				await changeContractorTerms(db, {
					organizationId: fixture.organizationId,
					actorUserId: fixture.ownerUserId,
					employeeId: randomUUID(),
					change: { kind: "end", effectiveFrom: "2026-02-01" },
				}),
			).toEqual({ ok: false, reason: "employee_not_found" });
		});
	});
});

function viewSummary(view: Awaited<ReturnType<typeof listContractorTermsHistory>>[number]) {
	return {
		from: view.effectiveFrom,
		to: view.effectiveTo,
		basis: view.compensation.compensationBasis,
		rate: view.compensation.rateAmount,
		rule: view.compensation.dayUnitRule,
		threshold: view.compensation.halfDayThresholdMinutes,
	};
}
