import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	type ContractorTermsPeriod,
	type ContractorWork,
	priceContractorWork,
} from "@/lib/contractor-compensation/pricing";
import type { ContractorCompensation } from "@/lib/contractor-compensation/terms";
import { buildContractorStatement, type StatementWorkDetails } from "./statement";

const day = (value: string) => Temporal.PlainDate.from(value);
const CONTRACTOR = "contractor-1";
const ENGAGEMENT = "period-1";

function work(id: string, start: string, end: string, offset = 60): ContractorWork {
	const startedAt = Temporal.Instant.from(start);
	const endedAt = Temporal.Instant.from(end);
	return {
		id,
		employeeId: CONTRACTOR,
		startedAt,
		endedAt,
		startOffsetMinutes: offset,
		durationMinutes: startedAt.until(endedAt).total("minutes"),
	};
}

function terms(
	id: string,
	from: string,
	to: string | null,
	compensation: ContractorCompensation,
): ContractorTermsPeriod {
	return {
		id,
		employeeId: CONTRACTOR,
		employmentPeriodId: ENGAGEMENT,
		from: day(from),
		to: to ? day(to) : null,
		compensation,
	};
}

const header = {
	organizationName: "Acme GmbH",
	contractor: {
		id: CONTRACTOR,
		name: "Jo Freelance",
		employeeNumber: "C-7",
		companyName: "Jo Consulting UG",
		vatId: "DE123456789",
		referenceCode: "PO-4711",
	},
	generatedAt: Temporal.Instant.from("2026-04-01T08:00:00Z"),
};

function details(entries: Record<string, Partial<StatementWorkDetails>>) {
	return new Map(
		Object.entries(entries).map(([id, value]) => [
			id,
			{
				projectName: null,
				taskName: null,
				awaitingApproval: false,
				startOffsetMinutes: 60,
				...value,
			},
		]),
	);
}

describe("contractor statement", () => {
	it("rounds worked minutes so lines, days, projects and the total always add up", () => {
		// Crosses local midnight (+01:00) half a minute each side: two 30-second shares.
		const items = [work("w1", "2026-03-01T22:59:30Z", "2026-03-01T23:00:30Z")];
		const pricing = priceContractorWork({
			work: items,
			engagements: [{ id: ENGAGEMENT, employeeId: CONTRACTOR, startedAt: null, endedAt: null }],
			terms: [
				terms("t1", "2026-03-01", null, {
					basis: "hourly",
					currency: "EUR",
					rateMinor: BigInt(6_000),
				}),
			],
			range: { fromDay: day("2026-03-01"), toDay: day("2026-03-31") },
		});

		const statement = buildContractorStatement({
			...header,
			period: { fromDay: day("2026-03-01"), toDay: day("2026-03-31") },
			pricing,
			work: details({ w1: { projectName: "Website" } }),
		});

		const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
		expect(statement.days).toHaveLength(2);
		for (const entry of statement.days) {
			expect(sum(entry.lines.map((line) => line.workedMinutes))).toBe(entry.workedMinutes);
		}
		expect(statement.totals).toHaveLength(1);
		expect(statement.totals[0]?.workedMinutes).toBe(1);
		expect(sum(statement.days.map((entry) => entry.workedMinutes))).toBe(1);
		expect(statement.projects.map((project) => project.workedMinutes)).toEqual([1]);
	});

	it("itemizes an hourly contractor's work by local day and project across a rate change", () => {
		const items = [
			work("w1", "2026-03-02T08:00:00Z", "2026-03-02T11:00:00Z"),
			work("w2", "2026-03-02T12:00:00Z", "2026-03-02T13:30:00Z"),
			work("w3", "2026-03-16T08:00:00Z", "2026-03-16T10:00:00Z"),
		];
		const pricing = priceContractorWork({
			work: items,
			engagements: [{ id: ENGAGEMENT, employeeId: CONTRACTOR, startedAt: null, endedAt: null }],
			terms: [
				terms("t1", "2026-03-01", "2026-03-15", {
					basis: "hourly",
					currency: "EUR",
					rateMinor: BigInt(8_000),
				}),
				terms("t2", "2026-03-15", null, {
					basis: "hourly",
					currency: "EUR",
					rateMinor: BigInt(9_050),
				}),
			],
			range: { fromDay: day("2026-03-01"), toDay: day("2026-03-31") },
		});

		const statement = buildContractorStatement({
			...header,
			period: { fromDay: day("2026-03-01"), toDay: day("2026-03-31") },
			pricing,
			work: details({
				w1: { projectName: "Website", taskName: "Design" },
				w2: { projectName: "Shop", awaitingApproval: true },
				w3: { projectName: "Website", taskName: "Build" },
			}),
		});

		expect(statement.period).toEqual({ fromDay: "2026-03-01", toDay: "2026-03-31" });
		expect(statement.contractor).toEqual(header.contractor);
		expect(statement.days).toEqual([
			{
				date: "2026-03-02",
				workedMinutes: 270,
				pricing: {
					basis: "hourly",
					dayUnitRule: null,
					currency: "EUR",
					rate: "80.00",
					unit: "hour",
					units: "4.5000",
					amount: "360.00",
				},
				lines: [
					{
						workId: "w1",
						start: "2026-03-02T09:00+01:00",
						end: "2026-03-02T12:00+01:00",
						workedMinutes: 180,
						projectName: "Website",
						taskName: "Design",
						awaitingApproval: false,
						amount: "240.00",
					},
					{
						workId: "w2",
						start: "2026-03-02T13:00+01:00",
						end: "2026-03-02T14:30+01:00",
						workedMinutes: 90,
						projectName: "Shop",
						taskName: null,
						awaitingApproval: true,
						amount: "120.00",
					},
				],
			},
			{
				date: "2026-03-16",
				workedMinutes: 120,
				pricing: {
					basis: "hourly",
					dayUnitRule: null,
					currency: "EUR",
					rate: "90.50",
					unit: "hour",
					units: "2.0000",
					amount: "181.00",
				},
				lines: [
					expect.objectContaining({ workId: "w3", projectName: "Website", amount: "181.00" }),
				],
			},
		]);
		expect(statement.totals).toEqual([
			{ currency: "EUR", amount: "541.00", hours: "6.5000", days: "0.0000", workedMinutes: 390 },
		]);
		expect(statement.projects).toEqual([
			{ projectName: "Shop", currency: "EUR", workedMinutes: 90, amount: "120.00" },
			{ projectName: "Website", currency: "EUR", workedMinutes: 300, amount: "421.00" },
		]);
		expect(statement.unpriced).toEqual({ workedMinutes: 0, days: 0 });
		expect(statement.awaitingApprovalLines).toBe(1);
	});

	it("names the day-unit rule of daily terms and keeps unpriced days without an amount", () => {
		const pricing = priceContractorWork({
			work: [
				work("w1", "2026-03-02T08:00:00Z", "2026-03-02T11:00:00Z"),
				work("w2", "2026-03-20T08:00:00Z", "2026-03-20T09:00:00Z"),
			],
			engagements: [{ id: ENGAGEMENT, employeeId: CONTRACTOR, startedAt: null, endedAt: null }],
			terms: [
				terms("t1", "2026-03-01", "2026-03-10", {
					basis: "daily",
					currency: "EUR",
					rateMinor: BigInt(60_000),
					dayUnitRule: { kind: "half_and_full_day", halfDayThresholdMinutes: 240 },
				}),
			],
			range: { fromDay: day("2026-03-01"), toDay: day("2026-03-31") },
		});

		const statement = buildContractorStatement({
			...header,
			period: { fromDay: day("2026-03-01"), toDay: day("2026-03-31") },
			pricing,
			work: details({}),
		});

		expect(statement.days.map((entry) => entry.pricing)).toEqual([
			{
				basis: "daily",
				dayUnitRule: { kind: "half_and_full_day", halfDayThresholdMinutes: 240 },
				currency: "EUR",
				rate: "600.00",
				unit: "day",
				units: "0.5000",
				amount: "300.00",
			},
			null,
		]);
		expect(statement.days[1].lines).toEqual([
			expect.objectContaining({ workId: "w2", workedMinutes: 60, amount: null }),
		]);
		expect(statement.totals).toEqual([
			{ currency: "EUR", amount: "300.00", hours: "0.0000", days: "0.5000", workedMinutes: 180 },
		]);
		expect(statement.unpriced).toEqual({ workedMinutes: 60, days: 1 });
	});

	it("never carries Billable Time rates, cost rates or margins", () => {
		const statement = buildContractorStatement({
			...header,
			period: { fromDay: day("2026-03-01"), toDay: day("2026-03-31") },
			pricing: { days: [], totals: [], unpriced: [] },
			work: details({}),
		});
		const text = JSON.stringify(statement);
		for (const word of ["billable", "margin", "costRate", "revenue", "sellRate"]) {
			expect(text.toLowerCase()).not.toContain(word.toLowerCase());
		}
	});
});
