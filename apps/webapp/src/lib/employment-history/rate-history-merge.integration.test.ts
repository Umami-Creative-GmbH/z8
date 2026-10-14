/**
 * PostgreSQL contract for the one-time merge of `employee_rate_history` into confirmed
 * employment terms (#1176, Organization ADR 0002): migration 0223's function
 * `employee_rate_history_merge_into_terms`, called per organization and re-run to prove it
 * changes nothing the second time.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

type ContractType = "fixed" | "hourly";

type Scenario = {
	organizationId: string;
	employeeId: string;
	userId: string;
	employmentPeriodId: string;
};

const MIGRATED_REASON = "Migrated from rate history";

describe("rate history merge into employment terms", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	/**
	 * A fresh organization with one employee. By default the employee is hourly and has an open
	 * recorded period from 2026-01-01 UTC; `period: null` seeds none.
	 */
	async function scenario(
		input: {
			timezone?: string;
			contractType?: ContractType;
			period?: { startedAt: string; endedAt?: string } | null;
			/** The legacy employee start date; defaults to 2026-01-01 UTC. */
			startDate?: Date | null;
		} = {},
	): Promise<Scenario> {
		const organizationId = await fixture.createOrganization();
		if (input.timezone) {
			await fixture.pool.query(`update organization set timezone = $2 where id = $1`, [
				organizationId,
				input.timezone,
			]);
		}
		const seeded = await fixture.seedEmployee({
			organizationId,
			withPeriod: input.period === undefined,
			startDate: input.startDate,
		});
		await fixture.pool.query(`update employee set contract_type = $2 where id = $1`, [
			seeded.employeeId,
			input.contractType ?? "hourly",
		]);
		if (input.period) {
			await fixture.pool.query(
				`insert into employee_employment_period
				 (id, organization_id, employee_id, status, started_at, ended_at, start_provenance)
				 values ($1, $2, $3, $4, $5, $6, 'recorded')`,
				[
					seeded.employmentPeriodId,
					organizationId,
					seeded.employeeId,
					input.period.endedAt ? "closed" : "open",
					input.period.startedAt,
					input.period.endedAt ?? null,
				],
			);
		}
		return {
			organizationId,
			employeeId: seeded.employeeId,
			userId: seeded.userId,
			employmentPeriodId: seeded.employmentPeriodId,
		};
	}

	/** A further open recorded employment period, e.g. after a rehire. */
	async function seedPeriod(at: Scenario, input: { startedAt: string }): Promise<string> {
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into employee_employment_period
			 (organization_id, employee_id, status, started_at, start_provenance)
			 values ($1, $2, 'open', $3, 'recorded')
			 returning id`,
			[at.organizationId, at.employeeId, input.startedAt],
		);
		return rows[0]?.id ?? "";
	}

	/** A rate history row; timestamps are UTC wall time like the column. */
	async function seedRate(
		at: Scenario,
		input: {
			rate: string;
			from: string;
			to?: string | null;
			createdAt: string;
			currency?: string;
		},
	): Promise<string> {
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into employee_rate_history
			 (employee_id, organization_id, hourly_rate, currency, effective_from, effective_to,
			  created_by, created_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8)
			 returning id`,
			[
				at.employeeId,
				at.organizationId,
				input.rate,
				input.currency ?? "EUR",
				input.from,
				input.to ?? null,
				at.userId,
				input.createdAt,
			],
		);
		return rows[0]?.id ?? "";
	}

	async function seedTerms(
		at: Scenario,
		input: {
			contractType: ContractType;
			from: string;
			until?: string | null;
			rate?: string | null;
			updatedAt: string;
			weeklyMinutes?: number;
			workModel?: "onsite" | "remote";
			changeReason?: string | null;
			currency?: string;
		},
	): Promise<string> {
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into employee_employment_history
			 (employee_id, organization_id, employment_period_id, valid_from, valid_until,
			  contract_type, weekly_contract_minutes, work_model, hourly_rate, currency,
			  change_reason, review_state, created_by, created_at, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'confirmed', $12, $13, $13)
			 returning id`,
			[
				at.employeeId,
				at.organizationId,
				at.employmentPeriodId,
				input.from,
				input.until ?? null,
				input.contractType,
				input.weeklyMinutes ?? 2400,
				input.workModel ?? "onsite",
				input.rate ?? null,
				input.currency ?? "EUR",
				input.changeReason ?? null,
				at.userId,
				input.updatedAt,
			],
		);
		return rows[0]?.id ?? "";
	}

	async function merge(organizationId: string): Promise<number> {
		const { rows } = await fixture.pool.query<{ changed: number }>(
			`select employee_rate_history_merge_into_terms($1) as changed`,
			[organizationId],
		);
		return rows[0]?.changed ?? -1;
	}

	/** Everything the merge may write for one organization, in a stable order. */
	async function organizationState(organizationId: string) {
		const tables = [
			"employee_employment_history",
			"employee_rate_history_merge_report",
			"employee_wage_history_merge_note",
			"employee_work_balance",
		];
		const state: Record<string, unknown[]> = {};
		for (const table of tables) {
			const { rows } = await fixture.pool.query<{ row: unknown }>(
				`select row_to_json(t) as row from "${table}" t where organization_id = $1
				 order by row_to_json(t)::text`,
				[organizationId],
			);
			state[table] = rows.map((row) => row.row);
		}
		return state;
	}

	/** Runs the merge, then runs it again and proves the second run changes nothing. */
	async function mergeTwice(organizationId: string) {
		const changed = await merge(organizationId);
		const afterFirst = await organizationState(organizationId);
		expect(await merge(organizationId)).toBe(0);
		expect(await organizationState(organizationId)).toEqual(afterFirst);
		return changed;
	}

	async function termsOf(employeeId: string) {
		const { rows } = await fixture.pool.query<{
			from: string;
			until: string | null;
			contractType: ContractType;
			rate: number | null;
			currency: string;
			weeklyMinutes: number;
			workModel: string;
			workPolicyId: string | null;
			changeReason: string | null;
			reviewState: string;
			status: string;
			periodId: string | null;
		}>(
			`select to_char(valid_from, 'YYYY-MM-DD HH24:MI:SS') as "from",
			        to_char(valid_until, 'YYYY-MM-DD HH24:MI:SS') as "until",
			        contract_type as "contractType", hourly_rate::float8 as rate, currency,
			        weekly_contract_minutes as "weeklyMinutes", work_model as "workModel",
			        work_policy_id as "workPolicyId", change_reason as "changeReason",
			        review_state as "reviewState", status, employment_period_id as "periodId"
			 from employee_employment_history where employee_id = $1
			 order by valid_from, valid_until nulls last`,
			[employeeId],
		);
		return rows;
	}

	async function reportOf(organizationId: string) {
		const { rows } = await fixture.pool.query<{
			employeeId: string;
			rateHistoryId: string | null;
			reason: string;
			winningValue: number | null;
		}>(
			`select employee_id as "employeeId", rate_history_id as "rateHistoryId", reason,
			        winning_value::float8 as "winningValue"
			 from employee_rate_history_merge_report where organization_id = $1
			 order by reason, rate_history_id`,
			[organizationId],
		);
		return rows;
	}

	/** Each report row with the first day of the terms it names, if any. */
	async function reportTermsOf(organizationId: string) {
		const { rows } = await fixture.pool.query<{
			rateHistoryId: string | null;
			reason: string;
			termsFrom: string | null;
		}>(
			`select r.rate_history_id as "rateHistoryId", r.reason,
			        to_char(h.valid_from, 'YYYY-MM-DD HH24:MI:SS') as "termsFrom"
			 from employee_rate_history_merge_report r
			 left join employee_employment_history h
			   on h.id = r.terms_id and h.organization_id = r.organization_id
			 where r.organization_id = $1
			 order by r.reason, h.valid_from`,
			[organizationId],
		);
		return rows;
	}

	async function noteCountOf(at: Scenario): Promise<number | undefined> {
		const { rows } = await fixture.pool.query<{ adjustedCount: number }>(
			`select adjusted_count as "adjustedCount" from employee_wage_history_merge_note
			 where organization_id = $1 and employee_id = $2`,
			[at.organizationId, at.employeeId],
		);
		return rows[0]?.adjustedCount;
	}

	async function dirtyFrom(at: Scenario): Promise<string | null | undefined> {
		const { rows } = await fixture.pool.query<{ isDirty: boolean; dirtyFromDate: string | null }>(
			`select is_dirty as "isDirty", to_char(dirty_from_date, 'YYYY-MM-DD') as "dirtyFromDate"
			 from employee_work_balance where organization_id = $1 and employee_id = $2`,
			[at.organizationId, at.employeeId],
		);
		const row = rows[0];
		if (!row) return undefined;
		expect(row.isDirty).toBe(true);
		return row.dirtyFromDate;
	}

	it("creates confirmed hourly terms for rate rows with no terms, linked to the covering period", async () => {
		const at = await scenario();
		await seedRate(at, {
			rate: "20.00",
			from: "2026-02-01 00:00:00",
			to: "2026-03-01 00:00:00",
			createdAt: "2026-02-01 08:00:00",
		});
		await seedRate(at, {
			rate: "25.50",
			from: "2026-03-01 00:00:00",
			createdAt: "2026-02-20 08:00:00",
			currency: "CHF",
		});

		expect(await mergeTwice(at.organizationId)).toBe(2);

		const migrated = {
			contractType: "hourly",
			weeklyMinutes: 2400,
			workModel: "onsite",
			workPolicyId: null,
			changeReason: MIGRATED_REASON,
			reviewState: "confirmed",
			status: "active",
			periodId: at.employmentPeriodId,
		};
		expect(await termsOf(at.employeeId)).toEqual([
			{
				...migrated,
				from: "2026-02-01 00:00:00",
				until: "2026-03-01 00:00:00",
				rate: 20,
				currency: "EUR",
			},
			{ ...migrated, from: "2026-03-01 00:00:00", until: null, rate: 25.5, currency: "CHF" },
		]);
		expect(await reportOf(at.organizationId)).toEqual([]);
		expect(await dirtyFrom(at)).toBe("2026-02-01");
	});

	it("keeps the terms' wage where the terms were written after the rate row, and reports it", async () => {
		const at = await scenario();
		await seedTerms(at, {
			contractType: "hourly",
			from: "2026-01-01 00:00:00",
			rate: "30.00",
			updatedAt: "2026-05-01 09:00:00",
		});
		const rateId = await seedRate(at, {
			rate: "35.00",
			from: "2026-03-01 00:00:00",
			createdAt: "2026-02-15 09:00:00",
		});
		const before = await termsOf(at.employeeId);

		expect(await mergeTwice(at.organizationId)).toBe(0);

		expect(await termsOf(at.employeeId)).toEqual(before);
		expect(await reportOf(at.organizationId)).toEqual([
			{
				employeeId: at.employeeId,
				rateHistoryId: rateId,
				reason: "terms_wage_kept",
				winningValue: 30,
			},
		]);
		expect(await dirtyFrom(at)).toBeUndefined();
	});

	it("splits hourly terms at each wage change where the rate row was written later, copying every other field", async () => {
		const at = await scenario();
		await seedTerms(at, {
			contractType: "hourly",
			from: "2026-01-01 00:00:00",
			rate: "30.00",
			updatedAt: "2026-01-01 09:00:00",
			weeklyMinutes: 1200,
			workModel: "remote",
			changeReason: "Part-time start",
			currency: "CHF",
		});
		const rateId = await seedRate(at, {
			rate: "35.00",
			from: "2026-03-01 00:00:00",
			to: "2026-04-01 00:00:00",
			createdAt: "2026-02-28 09:00:00",
		});

		expect(await mergeTwice(at.organizationId)).toBe(3);

		const copied = {
			contractType: "hourly",
			currency: "CHF",
			weeklyMinutes: 1200,
			workModel: "remote",
			workPolicyId: null,
			changeReason: "Part-time start",
			reviewState: "confirmed",
			status: "active",
			periodId: at.employmentPeriodId,
		};
		expect(await termsOf(at.employeeId)).toEqual([
			{ ...copied, from: "2026-01-01 00:00:00", until: "2026-03-01 00:00:00", rate: 30 },
			{ ...copied, from: "2026-03-01 00:00:00", until: "2026-04-01 00:00:00", rate: 35 },
			{ ...copied, from: "2026-04-01 00:00:00", until: null, rate: 30 },
		]);
		expect(await reportOf(at.organizationId)).toEqual([
			{
				employeeId: at.employeeId,
				rateHistoryId: rateId,
				reason: "rate_wage_applied",
				winningValue: 35,
			},
		]);
		expect(await dirtyFrom(at)).toBe("2026-03-01");
	});

	it("ignores rate rows under confirmed fixed terms and reports them", async () => {
		const at = await scenario();
		const fixedId = await seedTerms(at, {
			contractType: "fixed",
			from: "2026-01-01 00:00:00",
			updatedAt: "2026-01-01 09:00:00",
		});
		const rateId = await seedRate(at, {
			rate: "22.00",
			from: "2026-02-01 00:00:00",
			createdAt: "2026-03-01 09:00:00",
		});
		const before = await termsOf(at.employeeId);

		expect(await mergeTwice(at.organizationId)).toBe(0);

		expect(await termsOf(at.employeeId)).toEqual(before);
		expect(await reportOf(at.organizationId)).toEqual([
			{
				employeeId: at.employeeId,
				rateHistoryId: rateId,
				reason: "covered_by_fixed_terms",
				winningValue: null,
			},
		]);
		const { rows } = await fixture.pool.query<{ termsId: string }>(
			`select terms_id as "termsId" from employee_rate_history_merge_report where rate_history_id = $1`,
			[rateId],
		);
		expect(rows).toEqual([{ termsId: fixedId }]);
	});

	it("skips the open rate row of an employee who is fixed today with no terms, for good", async () => {
		const at = await scenario({ contractType: "fixed" });
		await seedRate(at, {
			rate: "18.00",
			from: "2026-01-10 00:00:00",
			to: "2026-02-01 00:00:00",
			createdAt: "2026-01-10 09:00:00",
		});
		const openId = await seedRate(at, {
			rate: "19.00",
			from: "2026-02-01 00:00:00",
			createdAt: "2026-02-01 09:00:00",
		});

		// The second run sees the terms the first one created and still skips the open row.
		expect(await mergeTwice(at.organizationId)).toBe(1);

		expect(
			(await termsOf(at.employeeId)).map((terms) => [terms.from, terms.until, terms.rate]),
		).toEqual([["2026-01-10 00:00:00", "2026-02-01 00:00:00", 18]]);
		expect(await reportOf(at.organizationId)).toEqual([
			{
				employeeId: at.employeeId,
				rateHistoryId: openId,
				reason: "fixed_without_terms_open_row",
				winningValue: null,
			},
		]);
	});

	it("skips the days no employment period covers and reports them", async () => {
		const at = await scenario({ period: { startedAt: "2026-03-01T00:00:00Z" } });
		const rateId = await seedRate(at, {
			rate: "22.00",
			from: "2026-01-15 00:00:00",
			createdAt: "2026-01-15 09:00:00",
		});

		expect(await mergeTwice(at.organizationId)).toBe(1);

		expect(
			(await termsOf(at.employeeId)).map((terms) => [
				terms.from,
				terms.until,
				terms.rate,
				terms.periodId,
			]),
		).toEqual([["2026-03-01 00:00:00", null, 22, at.employmentPeriodId]]);
		expect(await reportOf(at.organizationId)).toEqual([
			{
				employeeId: at.employeeId,
				rateHistoryId: rateId,
				reason: "no_employment_period",
				winningValue: null,
			},
		]);
	});

	it("gives an employee without any period their legacy period first, like every period reader", async () => {
		const at = await scenario({ period: null });
		await seedRate(at, {
			rate: "23.00",
			from: "2026-02-01 00:00:00",
			createdAt: "2026-02-01 09:00:00",
		});

		expect(await mergeTwice(at.organizationId)).toBe(1);

		const { rows: periods } = await fixture.pool.query<{ id: string; provenance: string }>(
			`select id, start_provenance as provenance from employee_employment_period
			 where organization_id = $1 and employee_id = $2`,
			[at.organizationId, at.employeeId],
		);
		expect(periods.map((period) => period.provenance)).toEqual(["legacy"]);
		expect(
			(await termsOf(at.employeeId)).map((terms) => [terms.from, terms.rate, terms.periodId]),
		).toEqual([["2026-02-01 00:00:00", 23, periods[0]?.id]]);
		expect(await reportOf(at.organizationId)).toEqual([]);
	});

	it("ends new terms with the employment period that covers them", async () => {
		const at = await scenario({
			period: { startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-04-01T00:00:00Z" },
		});
		const rateId = await seedRate(at, {
			rate: "21.00",
			from: "2026-02-01 00:00:00",
			createdAt: "2026-02-01 09:00:00",
		});

		expect(await mergeTwice(at.organizationId)).toBe(1);

		expect(
			(await termsOf(at.employeeId)).map((terms) => [terms.from, terms.until, terms.periodId]),
		).toEqual([["2026-02-01 00:00:00", "2026-04-01 00:00:00", at.employmentPeriodId]]);
		expect(await reportOf(at.organizationId)).toEqual([
			{
				employeeId: at.employeeId,
				rateHistoryId: rateId,
				reason: "no_employment_period",
				winningValue: null,
			},
		]);
	});

	it("dates rows in a non-UTC organization: now() rows by their local date, rate-card rows by their date", async () => {
		const at = await scenario({ timezone: "America/New_York" });
		// The rate card stored UTC midnight of 2026-02-01: that calendar date, even in New York.
		await seedRate(at, {
			rate: "20.00",
			from: "2026-02-01 00:00:00",
			to: "2026-03-10 02:30:00",
			createdAt: "2026-01-20 09:00:00",
		});
		// The edit form stored now(): 02:30 UTC on 03-10 is 22:30 on 03-09 in New York.
		await seedRate(at, {
			rate: "24.00",
			from: "2026-03-10 02:30:00",
			createdAt: "2026-03-10 02:30:00",
		});

		expect(await mergeTwice(at.organizationId)).toBe(2);

		expect(
			(await termsOf(at.employeeId)).map((terms) => [terms.from, terms.until, terms.rate]),
		).toEqual([
			["2026-02-01 00:00:00", "2026-03-09 00:00:00", 20],
			["2026-03-09 00:00:00", null, 24],
		]);
		expect(await dirtyFrom(at)).toBe("2026-02-01");
	});

	it("rounds a now() row to its date in an organization east of UTC", async () => {
		const at = await scenario({ timezone: "Europe/Berlin" });
		// 23:30 UTC on 03-09 is 00:30 on 03-10 in Berlin.
		await seedRate(at, {
			rate: "24.00",
			from: "2026-03-09 23:30:00",
			createdAt: "2026-03-09 23:30:00",
		});

		expect(await mergeTwice(at.organizationId)).toBe(1);

		expect(
			(await termsOf(at.employeeId)).map((terms) => [terms.from, terms.until, terms.rate]),
		).toEqual([["2026-03-10 00:00:00", null, 24]]);
	});

	it("lets the latest-written of two same-day rate rows win and reports the other", async () => {
		const at = await scenario();
		const earlier = await seedRate(at, {
			rate: "20.00",
			from: "2026-03-01 08:00:00",
			to: "2026-03-01 15:00:00",
			createdAt: "2026-03-01 08:00:00",
		});
		await seedRate(at, {
			rate: "21.00",
			from: "2026-03-01 15:00:00",
			createdAt: "2026-03-01 15:00:00",
		});

		expect(await mergeTwice(at.organizationId)).toBe(1);

		expect(
			(await termsOf(at.employeeId)).map((terms) => [terms.from, terms.until, terms.rate]),
		).toEqual([["2026-03-01 00:00:00", null, 21]]);
		expect(await reportOf(at.organizationId)).toEqual([
			{
				employeeId: at.employeeId,
				rateHistoryId: earlier,
				reason: "superseded",
				winningValue: 21,
			},
		]);
	});

	it("keeps confirmed terms non-overlapping within each employment period of a rehired employee", async () => {
		const at = await scenario({
			period: { startedAt: "2025-06-01T00:00:00Z", endedAt: "2026-01-01T00:00:00Z" },
		});
		const secondPeriodId = await seedPeriod(at, { startedAt: "2026-02-01T00:00:00Z" });
		await seedTerms(at, {
			contractType: "hourly",
			from: "2025-06-01 00:00:00",
			until: "2025-09-01 00:00:00",
			rate: "15.00",
			updatedAt: "2025-06-01 09:00:00",
		});
		await seedTerms(
			{ ...at, employmentPeriodId: secondPeriodId },
			{
				contractType: "hourly",
				from: "2026-02-01 00:00:00",
				rate: "18.00",
				updatedAt: "2026-02-01 09:00:00",
			},
		);
		await seedRate(at, {
			rate: "16.00",
			from: "2025-07-01 00:00:00",
			to: "2025-11-01 00:00:00",
			createdAt: "2025-07-01 09:00:00",
		});
		await seedRate(at, {
			rate: "17.00",
			from: "2025-11-01 00:00:00",
			to: "2026-03-01 00:00:00",
			createdAt: "2025-10-20 09:00:00",
		});
		await seedRate(at, {
			rate: "19.00",
			from: "2026-03-01 00:00:00",
			createdAt: "2026-02-20 09:00:00",
		});

		await mergeTwice(at.organizationId);

		expect(
			(await termsOf(at.employeeId)).map((terms) => [
				terms.from,
				terms.until,
				terms.rate,
				terms.periodId === secondPeriodId ? "second" : "first",
			]),
		).toEqual([
			["2025-06-01 00:00:00", "2025-07-01 00:00:00", 15, "first"],
			["2025-07-01 00:00:00", "2025-09-01 00:00:00", 16, "first"],
			["2025-09-01 00:00:00", "2025-11-01 00:00:00", 16, "first"],
			["2025-11-01 00:00:00", "2026-01-01 00:00:00", 17, "first"],
			// The rehire terms were written after the 17.00 row: they keep their wage.
			["2026-02-01 00:00:00", "2026-03-01 00:00:00", 18, "second"],
			["2026-03-01 00:00:00", null, 19, "second"],
		]);
		const { rows } = await fixture.pool.query<{ overlaps: number }>(
			`select count(*)::int as overlaps
			 from employee_employment_history a
			 join employee_employment_history b
			   on b.organization_id = a.organization_id and b.employee_id = a.employee_id
			  and b.employment_period_id = a.employment_period_id and b.id <> a.id
			  and b.review_state = 'confirmed'
			 where a.employee_id = $1 and a.review_state = 'confirmed'
			   and tsrange(a.valid_from, a.valid_until) && tsrange(b.valid_from, b.valid_until)`,
			[at.employeeId],
		);
		expect(rows).toEqual([{ overlaps: 0 }]);
		expect(await dirtyFrom(at)).toBe("2025-07-01");
	});

	it("touches only the given organization's rows", async () => {
		const own = await scenario();
		const other = await scenario();
		await seedRate(own, { rate: "20.00", from: "2026-02-01 00:00:00", createdAt: "2026-02-01" });
		await seedRate(other, {
			rate: "30.00",
			from: "2026-02-01 00:00:00",
			createdAt: "2026-02-01",
		});
		// A row filed under the other organization for this organization's employee.
		await seedRate(
			{ ...own, organizationId: other.organizationId },
			{ rate: "99.00", from: "2026-01-01 00:00:00", createdAt: "2026-01-01" },
		);
		const otherBefore = await organizationState(other.organizationId);

		expect(await mergeTwice(own.organizationId)).toBe(1);

		expect(await organizationState(other.organizationId)).toEqual(otherBefore);
		expect((await termsOf(own.employeeId)).map((terms) => terms.rate)).toEqual([20]);

		expect(await mergeTwice(other.organizationId)).toBe(1);

		expect((await termsOf(other.employeeId)).map((terms) => terms.rate)).toEqual([30]);
		expect((await termsOf(own.employeeId)).map((terms) => terms.rate)).toEqual([20]);
	});

	it("reports a rate row once against each hourly terms it conflicts with", async () => {
		const at = await scenario();
		const first = await seedTerms(at, {
			contractType: "hourly",
			from: "2026-01-01 00:00:00",
			until: "2026-03-01 00:00:00",
			rate: "30.00",
			updatedAt: "2026-05-01 09:00:00",
		});
		const second = await seedTerms(at, {
			contractType: "hourly",
			from: "2026-03-01 00:00:00",
			rate: "32.00",
			updatedAt: "2026-05-01 09:00:00",
		});
		const rateId = await seedRate(at, {
			rate: "35.00",
			from: "2026-02-01 00:00:00",
			createdAt: "2026-02-15 09:00:00",
		});

		expect(await mergeTwice(at.organizationId)).toBe(0);

		const { rows } = await fixture.pool.query<{ termsId: string; winningValue: number }>(
			`select terms_id as "termsId", winning_value::float8 as "winningValue"
			 from employee_rate_history_merge_report
			 where organization_id = $1 and rate_history_id = $2 and reason = 'terms_wage_kept'
			 order by winning_value`,
			[at.organizationId, rateId],
		);
		expect(rows).toEqual([
			{ termsId: first, winningValue: 30 },
			{ termsId: second, winningValue: 32 },
		]);
		expect(await noteCountOf(at)).toBe(1);
	});

	it("names the terms that carry each conflict after a split, and a re-run adds no report rows", async () => {
		const at = await scenario();
		await seedTerms(at, {
			contractType: "hourly",
			from: "2026-01-01 00:00:00",
			rate: "30.00",
			updatedAt: "2026-03-15 09:00:00",
		});
		// Written after the terms: its wage applies.
		const applied = await seedRate(at, {
			rate: "40.00",
			from: "2026-02-01 00:00:00",
			to: "2026-03-01 00:00:00",
			createdAt: "2026-03-20 09:00:00",
		});
		// Written before the terms: the terms keep their wage, on a piece the split creates.
		const kept = await seedRate(at, {
			rate: "35.00",
			from: "2026-04-01 00:00:00",
			createdAt: "2026-01-20 09:00:00",
		});

		expect(await mergeTwice(at.organizationId)).toBe(3);

		expect(
			(await termsOf(at.employeeId)).map((terms) => [terms.from, terms.until, terms.rate]),
		).toEqual([
			["2026-01-01 00:00:00", "2026-02-01 00:00:00", 30],
			["2026-02-01 00:00:00", "2026-03-01 00:00:00", 40],
			["2026-03-01 00:00:00", null, 30],
		]);
		expect(await reportTermsOf(at.organizationId)).toEqual([
			{ rateHistoryId: applied, reason: "rate_wage_applied", termsFrom: "2026-02-01 00:00:00" },
			{ rateHistoryId: kept, reason: "terms_wage_kept", termsFrom: "2026-03-01 00:00:00" },
		]);
		expect(await noteCountOf(at)).toBe(2);
	});

	it("counts every rate row the merge acted on in the note, including terms it split without a conflict", async () => {
		const at = await scenario();
		// Hourly terms without a wage: the rate rows fill it in without a conflict to report.
		await seedTerms(at, {
			contractType: "hourly",
			from: "2026-01-01 00:00:00",
			rate: null,
			updatedAt: "2026-01-01 09:00:00",
		});
		await seedRate(at, {
			rate: "20.00",
			from: "2026-01-01 00:00:00",
			to: "2026-02-01 00:00:00",
			createdAt: "2026-01-01 09:00:00",
		});
		await seedRate(at, {
			rate: "22.00",
			from: "2026-02-01 00:00:00",
			createdAt: "2026-02-01 09:00:00",
		});

		expect(await mergeTwice(at.organizationId)).toBe(2);

		expect(await reportOf(at.organizationId)).toEqual([]);
		expect(await noteCountOf(at)).toBe(2);
	});

	it("leaves one note per affected employee counting every rate row the merge acted on", async () => {
		const at = await scenario({ timezone: "Pacific/Kiritimati" });
		const unaffected = await fixture.seedEmployee({ organizationId: at.organizationId });
		const untouched = await fixture.seedEmployee({ organizationId: at.organizationId });
		await seedTerms(at, {
			contractType: "fixed",
			from: "2026-01-01 00:00:00",
			until: "2026-02-01 00:00:00",
			updatedAt: "2026-01-01 09:00:00",
		});
		await seedRate(at, {
			rate: "20.00",
			from: "2026-01-15 00:00:00",
			to: "2026-03-01 00:00:00",
			createdAt: "2026-01-15 09:00:00",
		});
		await seedRate(at, {
			rate: "22.00",
			from: "2026-03-01 00:00:00",
			createdAt: "2026-03-01 09:00:00",
		});
		// Rate rows that already match the terms change nothing and leave no note.
		await seedTerms(
			{
				...at,
				employeeId: unaffected.employeeId,
				employmentPeriodId: unaffected.employmentPeriodId,
			},
			{
				contractType: "hourly",
				from: "2026-01-01 00:00:00",
				rate: "25.00",
				updatedAt: "2026-01-01 09:00:00",
			},
		);
		await seedRate(
			{ ...at, employeeId: unaffected.employeeId, userId: unaffected.userId },
			{ rate: "25.00", from: "2026-01-01 00:00:00", createdAt: "2026-01-01 09:00:00" },
		);

		await mergeTwice(at.organizationId);

		const { rows } = await fixture.pool.query<{
			employeeId: string;
			mergedOn: string;
			adjustedCount: number;
			dismissedAt: string | null;
		}>(
			`select employee_id as "employeeId", to_char(merged_on, 'YYYY-MM-DD') as "mergedOn",
			        adjusted_count as "adjustedCount", dismissed_at as "dismissedAt"
			 from employee_wage_history_merge_note where organization_id = $1`,
			[at.organizationId],
		);
		const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Kiritimati" }).format(
			new Date(),
		);
		// Both rate rows created terms; the first was also partly ignored under the fixed terms.
		expect(rows).toEqual([
			{ employeeId: at.employeeId, mergedOn: today, adjustedCount: 2, dismissedAt: null },
		]);
		expect(rows.map((row) => row.employeeId)).not.toContain(untouched.employeeId);
	});

	/**
	 * D9: an hourly employee whose wage lived only on `employee.current_hourly_rate` (no confirmed
	 * terms, no rate rows) gets confirmed hourly terms carrying it. 0223 runs while the column still
	 * exists; 0224 drops it, so these cases bring it back for their duration.
	 */
	describe("employee wage backfill", () => {
		const BACKFILL_REASON = "Migrated from employee wage";

		beforeAll(async () => {
			await fixture.pool.query(
				`alter table employee add column if not exists current_hourly_rate numeric(10, 2)`,
			);
		});

		afterAll(async () => {
			await fixture.pool.query(`alter table employee drop column if exists current_hourly_rate`);
		});

		async function setWage(at: Pick<Scenario, "employeeId">, wage: string) {
			await fixture.pool.query(`update employee set current_hourly_rate = $2 where id = $1`, [
				at.employeeId,
				wage,
			]);
		}

		it("gives an hourly employee with only a stored wage confirmed hourly terms from their period start", async () => {
			const at = await scenario();
			await setWage(at, "27.50");
			const other = await scenario();
			await setWage(other, "40.00");
			const otherBefore = await organizationState(other.organizationId);

			expect(await mergeTwice(at.organizationId)).toBe(1);

			const { rows: termsIds } = await fixture.pool.query<{ id: string }>(
				`select id from employee_employment_history where employee_id = $1`,
				[at.employeeId],
			);
			expect(await termsOf(at.employeeId)).toEqual([
				{
					from: "2026-01-01 00:00:00",
					until: null,
					contractType: "hourly",
					rate: 27.5,
					currency: "EUR",
					weeklyMinutes: 2400,
					workModel: "onsite",
					workPolicyId: null,
					changeReason: BACKFILL_REASON,
					reviewState: "confirmed",
					status: "active",
					periodId: at.employmentPeriodId,
				},
			]);
			expect(await reportOf(at.organizationId)).toEqual([
				{
					employeeId: at.employeeId,
					rateHistoryId: null,
					reason: "employee_wage_migrated",
					winningValue: 27.5,
				},
			]);
			const { rows: reported } = await fixture.pool.query<{ termsId: string }>(
				`select terms_id as "termsId" from employee_rate_history_merge_report
				 where organization_id = $1`,
				[at.organizationId],
			);
			expect(reported).toEqual([{ termsId: termsIds[0]?.id }]);
			expect(await noteCountOf(at)).toBe(1);
			expect(await dirtyFrom(at)).toBe("2026-01-01");

			// Organization-scoped: the other organization waits for its own run.
			expect(await organizationState(other.organizationId)).toEqual(otherBefore);
			expect(await mergeTwice(other.organizationId)).toBe(1);
			expect((await termsOf(other.employeeId)).map((terms) => terms.rate)).toEqual([40]);
		});

		it("starts the terms on the employee's start date through their legacy period", async () => {
			const at = await scenario({ period: null, startDate: new Date("2025-09-01T00:00:00Z") });
			await setWage(at, "19.00");

			expect(await mergeTwice(at.organizationId)).toBe(1);

			const { rows: periods } = await fixture.pool.query<{ id: string }>(
				`select id from employee_employment_period where organization_id = $1 and employee_id = $2`,
				[at.organizationId, at.employeeId],
			);
			expect(
				(await termsOf(at.employeeId)).map((terms) => [
					terms.from,
					terms.until,
					terms.rate,
					terms.changeReason,
					terms.periodId,
				]),
			).toEqual([["2025-09-01 00:00:00", null, 19, BACKFILL_REASON, periods[0]?.id]]);
		});

		it("reports an employee whose employment start is unknown and writes no terms", async () => {
			const at = await scenario({ period: null, startDate: null });
			await setWage(at, "21.00");

			expect(await mergeTwice(at.organizationId)).toBe(0);

			expect(await termsOf(at.employeeId)).toEqual([]);
			expect(await reportOf(at.organizationId)).toEqual([
				{
					employeeId: at.employeeId,
					rateHistoryId: null,
					reason: "no_employment_period",
					winningValue: null,
				},
			]);
			expect(await noteCountOf(at)).toBe(1);
		});

		it("leaves fixed employees, employees with confirmed terms and employees with rate rows alone", async () => {
			const fixed = await scenario({ contractType: "fixed" });
			await setWage(fixed, "25.00");

			const withTerms = await scenario();
			await setWage(withTerms, "25.00");
			await seedTerms(withTerms, {
				contractType: "hourly",
				from: "2026-01-01 00:00:00",
				rate: "30.00",
				updatedAt: "2026-01-01 09:00:00",
			});
			const termsBefore = await termsOf(withTerms.employeeId);

			const withRates = await scenario();
			await setWage(withRates, "25.00");
			await seedRate(withRates, {
				rate: "26.00",
				from: "2026-02-01 00:00:00",
				createdAt: "2026-02-01 09:00:00",
			});

			for (const at of [fixed, withTerms]) {
				expect(await mergeTwice(at.organizationId)).toBe(0);
				expect(await reportOf(at.organizationId)).toEqual([]);
				expect(await noteCountOf(at)).toBeUndefined();
			}
			expect(await termsOf(fixed.employeeId)).toEqual([]);
			expect(await termsOf(withTerms.employeeId)).toEqual(termsBefore);

			expect(await mergeTwice(withRates.organizationId)).toBe(1);
			expect(
				(await termsOf(withRates.employeeId)).map((terms) => [
					terms.from,
					terms.rate,
					terms.changeReason,
				]),
			).toEqual([["2026-02-01 00:00:00", 26, MIGRATED_REASON]]);
		});
	});
});
