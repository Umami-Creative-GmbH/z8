import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	allocateLeaveCharges,
	type EarningYearLeave,
	leaveProtection,
	planYearEndCarryover,
} from "./earning-year-leave";

const berlin = "Europe/Berlin";
const instant = (value: string) => Temporal.Instant.from(value);

function leave(input: Partial<EarningYearLeave> & Pick<EarningYearLeave, "key">): EarningYearLeave {
	return {
		earningYear: 2027,
		earningPolicyId: "policy",
		portion: "all",
		protection: "unclassified",
		capacity: 0,
		configuredExpiry: null,
		...input,
	};
}

describe("leave protection follows the earning policy designation", () => {
	it("keeps unclassified leave outstanding", () => {
		expect(leaveProtection("all", undefined)).toBe("unclassified");
	});
	it("protects statutory and extra days alike under German rules", () => {
		const german = { expiryRules: "german" as const, extraDaysSeparateTerms: false };
		expect(leaveProtection("all", german)).toBe("german_protection");
		expect(leaveProtection("extra", german)).toBe("german_protection");
	});
	it("lets only explicitly separate extra days follow the policy terms", () => {
		const separate = { expiryRules: "german" as const, extraDaysSeparateTerms: true };
		expect(leaveProtection("extra", separate)).toBe("separate_terms");
		expect(leaveProtection("statutory", separate)).toBe("german_protection");
	});
	it("applies the policy's own terms when HR chose them", () => {
		expect(
			leaveProtection("all", { expiryRules: "policy_terms", extraDaysSeparateTerms: false }),
		).toBe("policy_terms");
	});
});

describe("vacation is charged to the earliest established expiry, then the older leave year", () => {
	it("uses dated leave first, then undated leave of the older year", () => {
		const allocation = allocateLeaveCharges(
			[
				leave({ key: "own-2028", earningYear: 2028, capacity: 30 }),
				leave({ key: "protected-2026", earningYear: 2026, capacity: 2 }),
				leave({
					key: "dated-2027",
					earningYear: 2027,
					protection: "policy_terms",
					capacity: 3,
					configuredExpiry: instant("2028-03-31T21:59:59.999Z"),
				}),
			],
			[{ date: "2028-02-01", days: 6 }],
			berlin,
		);
		expect(Object.fromEntries(allocation.used)).toEqual({
			"dated-2027": 3,
			"protected-2026": 2,
			"own-2028": 1,
		});
		expect(allocation.unallocated).toBe(0);
	});

	it("never charges a day after the established deadline to that leave", () => {
		const allocation = allocateLeaveCharges(
			[
				leave({
					key: "dated-2027",
					protection: "policy_terms",
					capacity: 7,
					configuredExpiry: instant("2028-06-30T21:59:59.999Z"),
				}),
				leave({ key: "own-2028", earningYear: 2028, capacity: 30 }),
			],
			[
				{ date: "2028-06-30", days: 1 },
				{ date: "2028-07-01", days: 2 },
			],
			berlin,
		);
		expect(Object.fromEntries(allocation.used)).toEqual({ "dated-2027": 1, "own-2028": 2 });
	});

	it("does not establish a deadline for German-protected or unclassified leave", () => {
		const allocation = allocateLeaveCharges(
			[
				leave({
					key: "german-2027",
					protection: "german_protection",
					capacity: 7,
					configuredExpiry: instant("2028-06-30T21:59:59.999Z"),
				}),
			],
			[{ date: "2028-09-01", days: 2 }],
			berlin,
		);
		expect(Object.fromEntries(allocation.used)).toEqual({ "german-2027": 2 });
	});

	it("uses separately termed extra days before statutory days of the same year", () => {
		const allocation = allocateLeaveCharges(
			[
				leave({ key: "statutory", earningYear: 2028, portion: "statutory", capacity: 20 }),
				leave({ key: "extra", earningYear: 2028, portion: "extra", capacity: 4 }),
			],
			[{ date: "2028-05-02", days: 5 }],
			berlin,
		);
		expect(Object.fromEntries(allocation.used)).toEqual({ extra: 4, statutory: 1 });
	});
});

describe("year-end keeps each earning year and its earning policy", () => {
	const yearEnd = instant("2027-12-31T22:59:59.999Z");
	const expiry2028 = instant("2028-06-30T21:59:59.999Z");

	it("carries all 24 unused days of an unclassified policy even with carryover disabled", () => {
		const plan = planYearEndCarryover({
			leave: [leave({ key: "own", capacity: 24, protection: "unclassified" })],
			used: new Map(),
			sourceYear: 2027,
			yearEnd,
			allowCarryover: false,
			maxCarryoverDays: null,
			receivingExpiry: expiry2028,
		});
		expect(plan).toMatchObject({ remaining: 24, applied: 24, capped: false });
		expect(plan.carried).toEqual([
			expect.objectContaining({ key: "own", days: 24, forfeitedDays: 0, configuredExpiry: expiry2028 }),
		]);
	});

	it("applies the cap and permission only to leave governed by the policy terms", () => {
		const plan = planYearEndCarryover({
			leave: [
				leave({ key: "older", earningYear: 2026, capacity: 5, protection: "german_protection" }),
				leave({ key: "extra", portion: "extra", capacity: 6, protection: "separate_terms" }),
				leave({ key: "statutory", portion: "statutory", capacity: 20, protection: "german_protection" }),
			],
			used: new Map([["extra", 2]]),
			sourceYear: 2027,
			yearEnd,
			allowCarryover: true,
			maxCarryoverDays: 1,
			receivingExpiry: expiry2028,
		});
		expect(plan).toMatchObject({ remaining: 29, applied: 26, capped: true });
		expect(
			plan.carried.map(({ key, days, forfeitedDays }) => ({ key, days, forfeitedDays })),
		).toEqual([
			{ key: "older", days: 5, forfeitedDays: 0 },
			{ key: "extra", days: 1, forfeitedDays: 3 },
			{ key: "statutory", days: 20, forfeitedDays: 0 },
		]);
	});

	it("forfeits policy-terms leave when carryover is disallowed and drops leave past its deadline", () => {
		const plan = planYearEndCarryover({
			leave: [
				leave({
					key: "lapsed",
					earningYear: 2026,
					capacity: 3,
					protection: "policy_terms",
					configuredExpiry: instant("2027-03-31T21:59:59.999Z"),
				}),
				leave({ key: "own", capacity: 24, protection: "policy_terms" }),
			],
			used: new Map(),
			sourceYear: 2027,
			yearEnd,
			allowCarryover: false,
			maxCarryoverDays: null,
			receivingExpiry: expiry2028,
		});
		expect(plan).toMatchObject({ remaining: 24, applied: 0, capped: false });
		expect(plan.carried).toEqual([
			expect.objectContaining({ key: "own", days: 0, forfeitedDays: 24 }),
		]);
	});

	it("keeps an older dated year's own deadline when it is carried again", () => {
		const older = instant("2029-06-30T21:59:59.999Z");
		const plan = planYearEndCarryover({
			leave: [
				leave({
					key: "older",
					earningYear: 2026,
					capacity: 4,
					protection: "policy_terms",
					configuredExpiry: older,
				}),
			],
			used: new Map(),
			sourceYear: 2027,
			yearEnd,
			allowCarryover: true,
			maxCarryoverDays: null,
			receivingExpiry: expiry2028,
		});
		expect(plan.carried).toEqual([
			expect.objectContaining({ key: "older", days: 4, configuredExpiry: older }),
		]);
	});
});
