import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import type { BillableRatePeriod } from "./applicable-rate";
import type { CostRatePeriod } from "./cost-rate";
import {
	type BillableFigures,
	billableFigures,
	type ReportedWork,
	sumBillableFigures,
	tallyReportedWork,
} from "./report-figures";

const EMPLOYEE = "11111111-1111-4111-8111-111111111111";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const CUSTOMER = "55555555-5555-4555-8555-555555555555";

const day = (value: string) => Temporal.PlainDate.from(value);

function projectRate(cents: number, from: string, to: string | null = null): BillableRatePeriod {
	return {
		id: `rate-${from}-${cents}`,
		level: "project",
		employeeId: null,
		projectId: PROJECT,
		customerId: null,
		from: day(from),
		to: to ? day(to) : null,
		rate: BigInt(cents),
	};
}

function costRate(cents: number, from: string, to: string | null = null): CostRatePeriod {
	return {
		id: `cost-${from}-${cents}`,
		employeeId: EMPLOYEE,
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
		employeeId: EMPLOYEE,
		projectId: PROJECT,
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

function figures(
	items: ReportedWork[],
	rates: { billable?: BillableRatePeriod[]; cost?: CostRatePeriod[] },
	access: "revenue" | "full" = "full",
): BillableFigures {
	return billableFigures(
		tallyReportedWork(items, { billable: rates.billable ?? [], cost: rates.cost ?? [] }),
		{ access, currency: "EUR" },
	);
}

describe("billable report figures", () => {
	it("splits a period that spans a rate change by elapsed time across the rates", () => {
		// 22:00 to 02:00 across midnight: 2h at 100.00, 2h at 120.00.
		const result = figures([work("2026-03-31T22:00:00Z", "2026-04-01T02:00:00Z")], {
			billable: [projectRate(10_000, "2026-01-01", "2026-04-01"), projectRate(12_000, "2026-04-01")],
		});

		expect(result.revenue).toBe("440.00");
		expect(result.billableHours).toBe(4);
		expect(result.unpricedWorkCount).toBe(0);
	});

	it("counts unpriced work as billable hours without revenue and flags it", () => {
		const result = figures(
			[
				work("2026-03-02T08:00:00Z", "2026-03-02T10:00:00Z"),
				work("2026-03-03T08:00:00Z", "2026-03-03T09:30:00Z"),
			],
			{ billable: [projectRate(10_000, "2026-03-03")] },
		);

		expect(result).toMatchObject({
			billableHours: 3.5,
			revenue: "150.00",
			unpricedWorkCount: 1,
			unpricedHours: 2,
		});
	});

	it("shows margin as unknown when any of the work has no cost rate, never as 100%", () => {
		const result = figures(
			[
				work("2026-03-02T08:00:00Z", "2026-03-02T10:00:00Z"),
				work("2026-03-03T08:00:00Z", "2026-03-03T10:00:00Z"),
			],
			{ billable: [projectRate(10_000, "2026-01-01")], cost: [costRate(4_000, "2026-03-03")] },
		);

		expect(result).toMatchObject({
			access: "full",
			revenue: "400.00",
			cost: null,
			margin: null,
			marginPercent: null,
			costUnknownWorkCount: 1,
		});
	});

	it("computes cost and margin of the billable work at the employee's cost rates", () => {
		const result = figures(
			[
				work("2026-03-31T22:00:00Z", "2026-04-01T02:00:00Z"),
				// Non-billable work adds hours only: no revenue, and no cost in the margin.
				work("2026-03-05T08:00:00Z", "2026-03-05T09:00:00Z", { isBillable: false }),
			],
			{
				billable: [projectRate(10_000, "2026-01-01", "2026-04-01"), projectRate(12_000, "2026-04-01")],
				cost: [costRate(5_000, "2026-01-01", "2026-04-01"), costRate(6_000, "2026-04-01")],
			},
		);

		expect(result).toMatchObject({
			billableHours: 4,
			nonBillableHours: 1,
			revenue: "440.00",
			cost: "220.00",
			margin: "220.00",
			marginPercent: "50.0",
		});
	});

	it("never carries cost or margin for revenue-only access", () => {
		const result = figures([work("2026-03-02T08:00:00Z", "2026-03-02T10:00:00Z")], {
			billable: [projectRate(10_000, "2026-01-01")],
			cost: [costRate(4_000, "2026-01-01")],
		}, "revenue");

		expect(result.access).toBe("revenue");
		expect(result.revenue).toBe("200.00");
		expect(Object.keys(result)).not.toEqual(
			expect.arrayContaining(["cost"]),
		);
		expect(JSON.stringify(result)).not.toMatch(/cost|margin/i);
	});

	it("treats work marked billable on a project without a customer as non-billable", () => {
		const result = figures(
			[work("2026-03-02T08:00:00Z", "2026-03-02T10:00:00Z", { customerId: null })],
			{ billable: [projectRate(10_000, "2026-01-01")] },
		);

		expect(result).toMatchObject({ billableHours: 0, nonBillableHours: 2, revenue: "0.00" });
	});

	it("counts work with a pending correction or submission", () => {
		const result = figures(
			[
				work("2026-03-02T08:00:00Z", "2026-03-02T10:00:00Z", { pendingReview: true }),
				work("2026-03-03T08:00:00Z", "2026-03-03T10:00:00Z", {
					isBillable: false,
					pendingReview: true,
				}),
				work("2026-03-04T08:00:00Z", "2026-03-04T10:00:00Z"),
			],
			{ billable: [projectRate(10_000, "2026-01-01")] },
		);

		expect(result.pendingReviewCount).toBe(2);
	});

	it("accrues exactly and rounds once per displayed aggregate, half up", () => {
		// Each half hour at 0.01/h is half a cent: rounding per line would give 0.03.
		const result = figures(
			[
				work("2026-03-02T08:00:00Z", "2026-03-02T08:30:00Z"),
				work("2026-03-03T08:00:00Z", "2026-03-03T08:30:00Z"),
				work("2026-03-04T08:00:00Z", "2026-03-04T08:30:00Z"),
			],
			{ billable: [projectRate(1, "2026-01-01")] },
		);

		expect(result.revenue).toBe("0.02");
	});

	it("rolls figures up so a total equals the sum of its parts", () => {
		const first = figures([work("2026-03-02T08:00:00Z", "2026-03-02T08:20:00Z")], {
			billable: [projectRate(1_001, "2026-01-01")],
			cost: [costRate(500, "2026-01-01")],
		});
		const second = figures([work("2026-03-03T08:00:00Z", "2026-03-03T08:20:00Z")], {
			billable: [projectRate(1_001, "2026-01-01")],
			cost: [costRate(500, "2026-01-01")],
		});
		const total = sumBillableFigures([first, second], { access: "full", currency: "EUR" });

		// 3.336.. rounds to 3.34 per project; the total is 6.68, not round(6.6733) = 6.67.
		expect(first.revenue).toBe("3.34");
		expect(total).toMatchObject({
			revenue: "6.68",
			cost: "3.34",
			margin: "3.34",
			billableHours: 2 / 3,
		});
	});

	it("rolls an unknown cost up as unknown", () => {
		const known = figures([work("2026-03-02T08:00:00Z", "2026-03-02T10:00:00Z")], {
			billable: [projectRate(10_000, "2026-01-01")],
			cost: [costRate(4_000, "2026-01-01")],
		});
		const unknown = figures([work("2026-03-02T08:00:00Z", "2026-03-02T10:00:00Z")], {
			billable: [projectRate(10_000, "2026-01-01")],
		});

		expect(sumBillableFigures([known, unknown], { access: "full", currency: "EUR" })).toMatchObject(
			{ revenue: "400.00", cost: null, margin: null, costUnknownWorkCount: 1 },
		);
		expect(
			JSON.stringify(sumBillableFigures([known, unknown], { access: "revenue", currency: "EUR" })),
		).not.toMatch(/cost|margin/i);
	});
});
