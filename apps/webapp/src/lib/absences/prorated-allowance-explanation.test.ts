import { beforeAll, describe, expect, it } from "vitest";
import { createTestTolgee } from "@/test/render-with-translations";
import type { ProratedAllowance, ProratedEmployment } from "./prorated-allowance";
import {
	explainOverdrawnVacation,
	explainVacationAllowance,
} from "./prorated-allowance-explanation";

type Translate = Parameters<typeof explainVacationAllowance>[0]["t"];
let t: Translate;

beforeAll(async () => {
	const tolgee = createTestTolgee("en");
	await tolgee.run();
	t = (key, fallback, params) => tolgee.t(key, fallback, params);
});

function employment(overrides: Partial<ProratedEmployment>): ProratedEmployment {
	return {
		kind: "start",
		startDate: null,
		lastWorkingDay: null,
		employmentMonths: 0,
		days: 0,
		floorApplied: false,
		...overrides,
	};
}

function prorated(
	days: number,
	employments: ProratedEmployment[],
	cappedAtFullAllowance = false,
): ProratedAllowance {
	return {
		fullAllowance: 30,
		days,
		reason: { kind: "prorated", employments, cappedAtFullAllowance },
	};
}

const explain = (allowance: ProratedAllowance) =>
	explainVacationAllowance({ allowance, year: 2026, locale: "en-GB", t });

describe("explainVacationAllowance with a working-week conversion", () => {
	it("explains the reference allowance of a full-year part-time allowance", () => {
		expect(
			explain({
				fullAllowance: 24,
				days: 24,
				reason: { kind: "none", cause: "full_year" },
				workingWeek: {
					referenceAllowance: 30,
					periods: [{ startDate: "2026-01-01", endDate: "2026-12-31", workingDaysPerWeek: 4 }],
				},
			}),
		).toBe("24 days: 30 reference days converted to 4 working days per week");
	});

	it("names each working week with its dates when it changes in the year", () => {
		expect(
			explain({
				fullAllowance: 27,
				days: 27,
				reason: { kind: "none", cause: "full_year" },
				workingWeek: {
					referenceAllowance: 30,
					periods: [
						{ startDate: "2026-01-01", endDate: "2026-06-30", workingDaysPerWeek: 5 },
						{ startDate: "2026-07-01", endDate: "2026-12-31", workingDaysPerWeek: 4 },
					],
				},
			}),
		).toBe(
			"27 days: 30 reference days converted to 5 working days per week from 1 Jan 2026 to 30 Jun 2026, 4 working days per week from 1 Jul 2026 to 31 Dec 2026",
		);
	});

	it("adds the conversion to a prorated allowance", () => {
		expect(
			explain({
				...prorated(6, [employment({ startDate: "2026-10-01", employmentMonths: 3, days: 6 })]),
				fullAllowance: 24,
				workingWeek: {
					referenceAllowance: 30,
					periods: [{ startDate: "2026-10-01", endDate: "2026-12-31", workingDaysPerWeek: 4 }],
				},
			}),
		).toBe(
			"6 of 24 days, prorated: started 1 Oct 2026, 3 full employment months; 30 reference days converted to 4 working days per week",
		);
	});
});

describe("explainVacationAllowance", () => {
	it("explains a joiner's prorated allowance with the start date and employment months", () => {
		expect(
			explain(prorated(8, [employment({ startDate: "2026-10-01", employmentMonths: 3, days: 8 })])),
		).toBe("8 of 30 days, prorated: started 1 Oct 2026, 3 full employment months");
	});

	it("says when the statutory minimum applies", () => {
		expect(
			explain(
				prorated(25, [
					employment({
						startDate: "2026-03-01",
						employmentMonths: 10,
						days: 25,
						floorApplied: false,
					}),
				]),
			),
		).toBe("25 of 30 days, prorated: started 1 Mar 2026, 10 full employment months");
		expect(
			explain(
				prorated(20, [
					employment({
						kind: "exit",
						lastWorkingDay: "2026-08-31",
						employmentMonths: 8,
						days: 20,
						floorApplied: true,
					}),
				]),
			),
		).toBe(
			"20 of 30 days, prorated: last working day 31 Aug 2026, 8 full employment months, statutory minimum applies",
		);
	});

	it("explains each employment of a rehire and the cap at the full allowance", () => {
		expect(
			explain(
				prorated(
					30,
					[
						employment({
							kind: "start_and_exit",
							startDate: "2026-01-15",
							lastWorkingDay: "2026-02-14",
							employmentMonths: 1,
							days: 2.5,
						}),
						employment({ startDate: "2026-02-20", employmentMonths: 10, days: 28 }),
					],
					true,
				),
			),
		).toBe(
			"30 of 30 days, prorated: started 15 Jan 2026, last working day 14 Feb 2026, 1 full employment month; started 20 Feb 2026, 10 full employment months; capped at the full allowance",
		);
	});

	it("explains an allowance of 0 for an employee not employed in the year", () => {
		expect(explain({ fullAllowance: 30, days: 0, reason: { kind: "not_employed" } })).toBe(
			"0 of 30 days: not employed in 2026",
		);
	});

	it("has nothing to explain for a full allowance", () => {
		expect(
			explain({ fullAllowance: 30, days: 30, reason: { kind: "none", cause: "full_year" } }),
		).toBeNull();
		expect(
			explain({
				fullAllowance: 12,
				days: 12,
				reason: { kind: "none", cause: "custom_allowance" },
			}),
		).toBeNull();
	});
});

describe("explainOverdrawnVacation", () => {
	it("names the days taken beyond the allowance", () => {
		expect(explainOverdrawnVacation({ overdrawnDays: 2, t })).toBe("2 days overdrawn");
		expect(explainOverdrawnVacation({ overdrawnDays: 1, t })).toBe("1 day overdrawn");
		expect(explainOverdrawnVacation({ overdrawnDays: 0.5, t })).toBe("0.5 days overdrawn");
	});

	it("is null when nothing is overdrawn", () => {
		expect(explainOverdrawnVacation({ overdrawnDays: 0, t })).toBeNull();
	});
});
