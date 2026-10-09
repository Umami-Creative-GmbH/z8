import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { type CostRatePeriod, costWorkPeriod, resolveCostRate } from "./cost-rate";

const EMPLOYEE = "11111111-1111-4111-8111-111111111111";
const OTHER_EMPLOYEE = "22222222-2222-4222-8222-222222222222";

const at = (value: string) => Temporal.Instant.from(value);
const day = (value: string) => Temporal.PlainDate.from(value);

let sequence = 0;
function costRate(
	cents: number,
	options: { from?: string; to?: string | null; employeeId?: string } = {},
): CostRatePeriod {
	sequence += 1;
	return {
		id: `cost-${sequence}`,
		employeeId: options.employeeId ?? EMPLOYEE,
		from: day(options.from ?? "2026-01-01"),
		to: options.to ? day(options.to) : null,
		rate: BigInt(cents),
	};
}

describe("resolveCostRate", () => {
	it("returns the employee's cost rate in effect on the local day", () => {
		const rate = costRate(4500);

		expect(
			resolveCostRate({ employeeId: EMPLOYEE, at: at("2026-03-02T08:00:00Z"), offsetMinutes: 60 }, [
				rate,
			]),
		).toEqual({ kind: "known", rate: BigInt(4500), costRatePeriodId: rate.id });
	});

	it("is unknown without a cost rate for the employee", () => {
		expect(
			resolveCostRate({ employeeId: EMPLOYEE, at: at("2026-03-02T08:00:00Z"), offsetMinutes: 0 }, [
				costRate(4500, { employeeId: OTHER_EMPLOYEE }),
			]),
		).toEqual({ kind: "unknown" });
	});

	it("is unknown before the first period and from the exclusive end on", () => {
		const rates = [costRate(4500, { from: "2026-03-01", to: "2026-04-01" })];
		const resolve = (instant: string) =>
			resolveCostRate({ employeeId: EMPLOYEE, at: at(instant), offsetMinutes: 0 }, rates).kind;

		expect(resolve("2026-02-28T23:59:59Z")).toBe("unknown");
		expect(resolve("2026-03-31T23:59:59Z")).toBe("known");
		expect(resolve("2026-04-01T00:00:00Z")).toBe("unknown");
	});

	it("uses the employee-local day at the given offset, not UTC", () => {
		const rates = [
			costRate(4000, { from: "2026-01-01", to: "2026-03-02" }),
			costRate(5000, { from: "2026-03-02" }),
		];
		// 23:30 UTC on March 1 is already March 2 at UTC+01:00.
		const instant = at("2026-03-01T23:30:00Z");

		expect(
			resolveCostRate({ employeeId: EMPLOYEE, at: instant, offsetMinutes: 60 }, rates),
		).toMatchObject({ rate: BigInt(5000) });
		expect(
			resolveCostRate({ employeeId: EMPLOYEE, at: instant, offsetMinutes: 0 }, rates),
		).toMatchObject({ rate: BigInt(4000) });
	});
});

describe("costWorkPeriod", () => {
	it("splits a period that spans a cost rate change by elapsed time", () => {
		const rates = [
			costRate(3600, { from: "2026-01-01", to: "2026-03-03" }),
			costRate(7200, { from: "2026-03-03" }),
		];

		// 22:00 to 02:00 local (UTC), 4 h elapsed, 4 h recorded: 2 h at each rate.
		const cost = costWorkPeriod(
			{
				employeeId: EMPLOYEE,
				startedAt: at("2026-03-02T22:00:00Z"),
				endedAt: at("2026-03-03T02:00:00Z"),
				startOffsetMinutes: 0,
				durationMinutes: 240,
			},
			rates,
		);

		expect(cost.knownMs).toBe(4 * 3_600_000);
		expect(cost.unknownMs).toBe(0);
		// 2 h × 36.00 + 2 h × 72.00 = 216.00
		expect(cost.amountCents).toBe(BigInt(21600));
		expect(cost.shares.map((share) => share.cost.kind)).toEqual(["known", "known"]);
	});

	it("reports the share without a cost rate as unknown and adds no cost for it", () => {
		const rates = [costRate(6000, { from: "2026-03-03" })];

		const cost = costWorkPeriod(
			{
				employeeId: EMPLOYEE,
				startedAt: at("2026-03-02T23:00:00Z"),
				endedAt: at("2026-03-03T01:00:00Z"),
				startOffsetMinutes: 0,
				durationMinutes: 90,
			},
			rates,
		);

		// 90 recorded minutes over 2 elapsed hours: 45 min unknown, 45 min at 60.00.
		expect(cost.unknownMs).toBe(45 * 60_000);
		expect(cost.knownMs).toBe(45 * 60_000);
		expect(cost.amountCents).toBe(BigInt(4500));
	});
});
