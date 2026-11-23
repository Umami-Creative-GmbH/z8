import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	type ContractorEngagement,
	type ContractorTermsPeriod,
	priceContractorWork,
} from "@/lib/contractor-compensation/pricing";
import type { ContractorCompensation } from "@/lib/contractor-compensation/terms";
import type { CostRatePeriod } from "./cost-rate";
import { contractorCostsFrom } from "./contractor-cost";
import { billableFigures, type ReportedWork, tallyReportedWork } from "./report-figures";

/**
 * Contractor cost in Billable Time margin (#1999): an explicit cost rate wins,
 * otherwise the contractor's terms priced by the engine (#1998) supply the
 * cost, and work neither prices keeps its margin unknown.
 */

const CONTRACTOR = "11111111-1111-4111-8111-111111111111";
const ENGAGEMENT = "22222222-2222-4222-8222-222222222222";
const WEBSITE = "33333333-3333-4333-8333-333333333333";
const SUPPORT = "44444444-4444-4444-8444-444444444444";
const CUSTOMER = "55555555-5555-4555-8555-555555555555";

const day = (value: string) => Temporal.PlainDate.from(value);
const engagement: ContractorEngagement = {
	id: ENGAGEMENT,
	employeeId: CONTRACTOR,
	startedAt: null,
	endedAt: null,
};

function terms(
	compensation: ContractorCompensation,
	from = "2026-01-01",
	to: string | null = null,
): ContractorTermsPeriod {
	return {
		id: `terms-${from}`,
		employeeId: CONTRACTOR,
		employmentPeriodId: ENGAGEMENT,
		from: day(from),
		to: to ? day(to) : null,
		compensation,
	};
}

const hourly = (cents: number, currency = "EUR"): ContractorCompensation => ({
	basis: "hourly",
	currency,
	rateMinor: BigInt(cents),
});

const fullDay = (cents: number): ContractorCompensation => ({
	basis: "daily",
	currency: "EUR",
	rateMinor: BigInt(cents),
	dayUnitRule: { kind: "any_work_full_day" },
});

function costRate(cents: number, from: string, to: string | null = null): CostRatePeriod {
	return {
		id: `cost-${from}`,
		employeeId: CONTRACTOR,
		from: day(from),
		to: to ? day(to) : null,
		rate: BigInt(cents),
	};
}

let sequence = 0;
function work(
	start: string,
	end: string,
	options: Partial<Omit<ReportedWork, "startedAt" | "endedAt">> = {},
): ReportedWork {
	const startedAt = Temporal.Instant.from(start);
	const endedAt = Temporal.Instant.from(end);
	sequence += 1;
	return {
		id: `work-${sequence}`,
		employeeId: CONTRACTOR,
		projectId: WEBSITE,
		customerId: CUSTOMER,
		startOffsetMinutes: 0,
		durationMinutes: Number(startedAt.until(endedAt).total("minutes")),
		isBillable: true,
		pendingReview: false,
		...options,
		startedAt,
		endedAt,
	};
}

/** Margin figures of `reported`, with contractor cost priced from all of `worked`. */
function figures(input: {
	reported: ReportedWork[];
	worked?: ReportedWork[];
	terms?: ContractorTermsPeriod[];
	cost?: CostRatePeriod[];
	currency?: string;
}) {
	const currency = input.currency ?? "EUR";
	const pricing = priceContractorWork({
		work: input.worked ?? input.reported,
		engagements: [engagement],
		terms: input.terms ?? [],
	});
	const tally = tallyReportedWork(input.reported, {
		billable: [],
		cost: input.cost ?? [],
		contractor: contractorCostsFrom(pricing, currency),
	});
	const result = billableFigures(tally, { access: "full", currency });
	if (result.access !== "full") throw new Error("expected full figures");
	return result;
}

describe("contractor cost in Billable Time margin", () => {
	it("costs a contractor without a cost rate at their hourly terms, across a rate change", () => {
		const result = figures({
			reported: [
				work("2026-03-13T09:00:00Z", "2026-03-13T17:00:00Z"),
				work("2026-03-16T09:00:00Z", "2026-03-16T11:30:00Z"),
			],
			terms: [
				terms(hourly(9_000), "2026-03-01", "2026-03-16"),
				terms(hourly(10_000), "2026-03-16"),
			],
		});

		// 8 h × 90.00 + 2.5 h × 100.00
		expect(result).toMatchObject({ cost: "970.00", costUnknownWorkCount: 0 });
	});

	it("lets an explicit cost rate win over hourly and daily terms on the days it is in effect", () => {
		const reported = [
			work("2026-03-02T09:00:00Z", "2026-03-02T13:00:00Z"),
			work("2026-03-03T09:00:00Z", "2026-03-03T13:00:00Z"),
		];
		const cost = [costRate(5_000, "2026-03-02", "2026-03-03")];

		// 4 h × 50.00 explicitly, then 4 h × 90.00 from the terms.
		expect(figures({ reported, cost, terms: [terms(hourly(9_000))] }).cost).toBe("560.00");
		// 4 h × 50.00 explicitly, then a full day of 600.00.
		expect(figures({ reported, cost, terms: [terms(fullDay(60_000))] }).cost).toBe("800.00");
	});

	it("splits one daily fee across the day's projects by duration, adding up to exactly one fee", () => {
		const reported = [
			work("2026-03-02T08:00:00Z", "2026-03-02T09:00:00Z", { projectId: WEBSITE }),
			work("2026-03-02T09:00:00Z", "2026-03-02T10:00:00Z", { projectId: SUPPORT }),
			work("2026-03-02T10:00:00Z", "2026-03-02T11:00:00Z", { projectId: WEBSITE }),
		];
		const dayTerms = [terms(fullDay(10_000))];
		const onProject = (projectId: string) =>
			figures({
				reported: reported.filter((item) => item.projectId === projectId),
				worked: reported,
				terms: dayTerms,
			}).cost;

		// 100.00 over three equal hours: 33.34 + 33.33 + 33.33, never 100.00 per project.
		expect(onProject(WEBSITE)).toBe("66.67");
		expect(onProject(SUPPORT)).toBe("33.33");
		expect(figures({ reported, terms: dayTerms }).cost).toBe("100.00");
	});

	it("leaves the non-billable work of a mixed day its share of the daily fee", () => {
		const billable = work("2026-03-02T08:00:00Z", "2026-03-02T11:00:00Z");
		const internal = work("2026-03-02T11:00:00Z", "2026-03-02T12:00:00Z", { isBillable: false });

		// Billable work carries 3 of the 4 worked hours of a 400.00 day.
		expect(
			figures({
				reported: [billable, internal],
				terms: [terms(fullDay(40_000))],
			}).cost,
		).toBe("300.00");
	});

	it("keeps margin unknown, never zero, for contractor work without terms or cost rate", () => {
		const result = figures({
			reported: [
				work("2026-03-02T09:00:00Z", "2026-03-02T10:00:00Z"),
				work("2026-03-20T09:00:00Z", "2026-03-20T10:00:00Z"),
			],
			terms: [terms(hourly(9_000), "2026-03-10")],
		});

		expect(result).toMatchObject({ cost: null, margin: null, costUnknownWorkCount: 1 });
	});

	it("treats terms in another currency than the billable currency as unknown cost", () => {
		const result = figures({
			reported: [work("2026-03-02T09:00:00Z", "2026-03-02T10:00:00Z")],
			terms: [terms(hourly(9_000, "CHF"))],
		});

		expect(result).toMatchObject({ cost: null, margin: null, costUnknownWorkCount: 1 });
	});

	it("costs each local day of work across midnight from that day's fee", () => {
		// 22:00 to 02:00: 2 h on each day, each the only work of a 300.00 day.
		const result = figures({
			reported: [work("2026-03-02T22:00:00Z", "2026-03-03T02:00:00Z")],
			terms: [terms(fullDay(30_000))],
		});

		expect(result).toMatchObject({ cost: "600.00", costUnknownWorkCount: 0 });
	});

	it("never costs the part of a work period outside the contractor engagement from the terms", () => {
		// The contractor engagement ends at 12:00; the hour after it was worked as an employee.
		const pricing = priceContractorWork({
			work: [work("2026-03-02T11:00:00Z", "2026-03-02T13:00:00Z", { id: "edge" })],
			engagements: [{ ...engagement, endedAt: Temporal.Instant.from("2026-03-02T12:00:00Z") }],
			terms: [terms(hourly(9_000))],
		});
		const tally = tallyReportedWork(
			[work("2026-03-02T11:00:00Z", "2026-03-02T13:00:00Z", { id: "edge" })],
			{ billable: [], cost: [], contractor: contractorCostsFrom(pricing, "EUR") },
		);

		expect(billableFigures(tally, { access: "full", currency: "EUR" })).toMatchObject({
			cost: null,
			costUnknownWorkCount: 1,
		});
	});
});
