import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	type BillableRatePeriod,
	priceWorkPeriod,
	type RateLevel,
	resolveApplicableRate,
} from "./applicable-rate";

const EMPLOYEE = "11111111-1111-4111-8111-111111111111";
const OTHER_EMPLOYEE = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const OTHER_PROJECT = "44444444-4444-4444-8444-444444444444";
const CUSTOMER = "55555555-5555-4555-8555-555555555555";

const at = (value: string) => Temporal.Instant.from(value);
const day = (value: string) => Temporal.PlainDate.from(value);

let sequence = 0;
function rate(
	level: RateLevel,
	cents: number,
	options: {
		from?: string;
		to?: string | null;
		employeeId?: string;
		projectId?: string;
		customerId?: string;
	} = {},
): BillableRatePeriod {
	sequence += 1;
	const target = {
		employee_project: {
			employeeId: options.employeeId ?? EMPLOYEE,
			projectId: options.projectId ?? PROJECT,
			customerId: null,
		},
		project: { employeeId: null, projectId: options.projectId ?? PROJECT, customerId: null },
		customer: { employeeId: null, projectId: null, customerId: options.customerId ?? CUSTOMER },
		employee: { employeeId: options.employeeId ?? EMPLOYEE, projectId: null, customerId: null },
	}[level];
	return {
		id: `rate-${sequence}`,
		level,
		...target,
		from: day(options.from ?? "2026-01-01"),
		to: options.to ? day(options.to) : null,
		rate: BigInt(cents),
	};
}

const work = {
	employeeId: EMPLOYEE,
	projectId: PROJECT,
	customerId: CUSTOMER,
	startedAt: at("2026-03-02T08:00:00Z"),
	startOffsetMinutes: 60,
};

describe("rate level precedence", () => {
	it("prices with the employee's rate when no other level has one", () => {
		expect(resolveApplicableRate(work, [rate("employee", 8000)])).toMatchObject({
			kind: "priced",
			rate: BigInt(8000),
			level: "employee",
		});
	});

	it("lets a customer rate win over the employee's rate", () => {
		expect(
			resolveApplicableRate(work, [rate("employee", 8000), rate("customer", 9000)]),
		).toMatchObject({ kind: "priced", rate: BigInt(9000), level: "customer" });
	});

	it("lets a project rate win over the customer rate", () => {
		expect(
			resolveApplicableRate(work, [
				rate("employee", 8000),
				rate("customer", 9000),
				rate("project", 10000),
			]),
		).toMatchObject({ kind: "priced", rate: BigInt(10000), level: "project" });
	});

	it("lets the employee-on-project rate win over the project rate", () => {
		expect(
			resolveApplicableRate(work, [
				rate("employee", 8000),
				rate("customer", 9000),
				rate("project", 10000),
				rate("employee_project", 11000),
			]),
		).toMatchObject({ kind: "priced", rate: BigInt(11000), level: "employee_project" });
	});

	it("falls back to a less specific level outside the more specific rate's period", () => {
		const rates = [rate("project", 10000, { from: "2026-04-01" }), rate("employee", 8000)];

		expect(resolveApplicableRate(work, rates)).toMatchObject({ level: "employee" });
	});
});

describe("matching work to rates", () => {
	it("is unpriced when no level has a rate in effect", () => {
		expect(resolveApplicableRate(work, [])).toEqual({ kind: "unpriced" });
		expect(resolveApplicableRate(work, [rate("employee", 8000, { from: "2026-03-03" })])).toEqual({
			kind: "unpriced",
		});
	});

	it("never resolves a customer rate for work whose project has no customer", () => {
		const rates = [rate("customer", 9000), rate("employee", 8000)];

		expect(resolveApplicableRate({ ...work, customerId: null }, rates)).toMatchObject({
			level: "employee",
		});
		expect(resolveApplicableRate({ ...work, customerId: null }, [rate("customer", 9000)])).toEqual({
			kind: "unpriced",
		});
	});

	it("ignores rates for other employees and projects", () => {
		const rates = [
			rate("employee_project", 11000, { employeeId: OTHER_EMPLOYEE }),
			rate("employee_project", 11500, { projectId: OTHER_PROJECT }),
			rate("project", 10000, { projectId: OTHER_PROJECT }),
			rate("employee", 7000, { employeeId: OTHER_EMPLOYEE }),
		];

		expect(resolveApplicableRate(work, rates)).toEqual({ kind: "unpriced" });
	});

	it("uses the rate of the employee-local day the work started on", () => {
		// 23:30 UTC on 30 June is 1 July at UTC+02:00.
		const rates = [
			rate("employee", 8000, { from: "2026-01-01", to: "2026-07-01" }),
			rate("employee", 8500, { from: "2026-07-01" }),
		];

		expect(
			resolveApplicableRate(
				{ ...work, startedAt: at("2026-06-30T23:30:00Z"), startOffsetMinutes: 120 },
				rates,
			),
		).toMatchObject({ rate: BigInt(8500) });
		expect(
			resolveApplicableRate(
				{ ...work, startedAt: at("2026-06-30T23:30:00Z"), startOffsetMinutes: -60 },
				rates,
			),
		).toMatchObject({ rate: BigInt(8000) });
	});
});

describe("pricing a work period", () => {
	it("splits a period across a rate change by elapsed time", () => {
		// 22:00-02:00 local (UTC+01:00), 4 hours, rate changes at local midnight.
		const priced = priceWorkPeriod(
			{
				...work,
				startedAt: at("2026-03-31T21:00:00Z"),
				endedAt: at("2026-04-01T01:00:00Z"),
				durationMinutes: 240,
			},
			[
				rate("employee", 8000, { to: "2026-04-01" }),
				rate("project", 10000, { from: "2026-04-01" }),
			],
		);

		expect(
			priced.shares.map((share) => ({
				level: share.applicable.kind === "priced" ? share.applicable.level : null,
				durationMs: share.durationMs,
			})),
		).toEqual([
			{ level: "employee", durationMs: 2 * 3_600_000 },
			{ level: "project", durationMs: 2 * 3_600_000 },
		]);
		expect(priced.amountCents).toBe(BigInt(36000));
		expect(priced.unpricedMs).toBe(0);
	});

	it("keeps unpriced time apart and prices it at nothing", () => {
		const priced = priceWorkPeriod(
			{
				...work,
				startedAt: at("2026-03-31T21:00:00Z"),
				endedAt: at("2026-04-01T01:00:00Z"),
				durationMinutes: 240,
			},
			[rate("employee", 8000, { from: "2026-04-01" })],
		);

		expect(priced.unpricedMs).toBe(2 * 3_600_000);
		expect(priced.amountCents).toBe(BigInt(16000));
	});
});
