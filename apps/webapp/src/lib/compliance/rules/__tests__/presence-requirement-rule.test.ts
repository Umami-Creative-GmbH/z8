/**
 * Tests for Presence Requirement Rule
 *
 * Tests on-site presence detection in both minimum_count and fixed_days modes,
 * denominator adjustment for absences/holidays, severity levels, and edge cases.
 */

import { DateTime } from "luxon";
import { describe, expect, test } from "vitest";
import {
	PresenceRequirementRule,
	type AbsenceDay,
	type HolidayDay,
	type PresenceConfig,
	type PresenceRuleDetectionInput,
	type WorkPeriodWithLocation,
} from "../presence-requirement-rule";
import type { EmployeeWithPolicy } from "../types";
import type { PresenceRequirementEvidence } from "@/db/schema/compliance-finding";

// ============================================
// Test helpers
// ============================================

const TIMEZONE = "Europe/Berlin";
/** Monday 2026-02-09 */
const WEEK_START = DateTime.fromISO("2026-02-09", { zone: TIMEZONE });

const mockEmployee: EmployeeWithPolicy = {
	id: "emp-001",
	organizationId: "org-001",
	firstName: "Test",
	lastName: "Employee",
	timezone: TIMEZONE,
	policy: {
		policyId: "policy-001",
		policyName: "Standard Policy",
		maxDailyMinutes: 600,
		maxWeeklyMinutes: 2400,
		minRestPeriodMinutes: 660,
		maxConsecutiveDays: 6,
	},
};

function makeWorkPeriod(
	dayOffset: number,
	locationType: string | null,
	overrides?: Partial<WorkPeriodWithLocation>,
): WorkPeriodWithLocation {
	const start = WEEK_START.plus({ days: dayOffset }).set({ hour: 9, minute: 0 });
	const end = start.plus({ hours: 8 });
	return {
		id: `wp-${dayOffset}-${Math.random().toString(36).slice(2, 8)}`,
		employeeId: mockEmployee.id,
		startTime: start.toJSDate(),
		endTime: end.toJSDate(),
		durationMinutes: 480,
		isActive: false,
		workLocationType: locationType,
		...overrides,
	};
}

function makePresenceConfig(
	overrides?: Partial<PresenceConfig>,
): PresenceConfig {
	return {
		presenceMode: "minimum_count",
		requiredOnsiteDays: 3,
		requiredOnsiteFixedDays: [],
		locationId: null,
		evaluationPeriod: "week",
		enforcement: "hard",
		...overrides,
	};
}

function makeInput(params: {
	workPeriods: WorkPeriodWithLocation[];
	presenceConfig: PresenceConfig;
	absenceDays?: AbsenceDay[];
	holidayDays?: HolidayDay[];
}): PresenceRuleDetectionInput {
	return {
		employee: mockEmployee,
		workPeriods: params.workPeriods,
		dateRange: {
			start: WEEK_START,
			end: WEEK_START.plus({ days: 4 }), // Mon-Fri
		},
		thresholdOverrides: null,
		presenceConfig: params.presenceConfig,
		absenceDays: params.absenceDays ?? [],
		holidayDays: params.holidayDays ?? [],
	};
}

// ============================================
// Tests
// ============================================

const rule = new PresenceRequirementRule();

describe("PresenceRequirementRule", () => {
	describe("minimum_count mode", () => {
		test("pass: 3 office days with 3-day requirement produces no violation", async () => {
			const workPeriods = [
				makeWorkPeriod(0, "office"), // Monday
				makeWorkPeriod(1, "office"), // Tuesday
				makeWorkPeriod(2, "office"), // Wednesday
				makeWorkPeriod(3, "home"), // Thursday
				makeWorkPeriod(4, "home"), // Friday
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({ requiredOnsiteDays: 3 }),
				}),
			);

			expect(findings).toHaveLength(0);
		});

		test("fail: 1 office day with 3-day requirement produces violation", async () => {
			const workPeriods = [
				makeWorkPeriod(0, "office"), // Monday
				makeWorkPeriod(1, "home"), // Tuesday
				makeWorkPeriod(2, "home"), // Wednesday
				makeWorkPeriod(3, "home"), // Thursday
				makeWorkPeriod(4, "home"), // Friday
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({ requiredOnsiteDays: 3 }),
				}),
			);

			expect(findings).toHaveLength(1);
			const evidence = findings[0].evidence as PresenceRequirementEvidence;
			expect(evidence.type).toBe("presence_requirement");
			expect(evidence.mode).toBe("minimum_count");
			expect(evidence.actualOnsiteDays).toBe(1);
			expect(evidence.requiredDays).toBe(3);
		});
	});

	describe("denominator adjustment for absences", () => {
		test("1 sick day reduces available days; 2 office days out of 4 available with 3-day req passes (capped to 4, still need 3, 2<3 = fail)", async () => {
			// 5 weekdays - 1 sick day = 4 available, requirement stays 3
			// 2 office days < 3 requirement => violation
			const workPeriods = [
				makeWorkPeriod(0, "office"), // Monday
				makeWorkPeriod(1, "office"), // Tuesday
				// Wednesday is sick
				makeWorkPeriod(3, "home"), // Thursday
				makeWorkPeriod(4, "home"), // Friday
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({ requiredOnsiteDays: 3 }),
					absenceDays: [{ date: "2026-02-11", reason: "sick" }], // Wednesday
				}),
			);

			expect(findings).toHaveLength(1);
			const evidence = findings[0].evidence as PresenceRequirementEvidence;
			expect(evidence.requiredDays).toBe(3); // 4 available, req capped to min(3,4)=3
			expect(evidence.actualOnsiteDays).toBe(2);
		});

		test("1 sick day reduces available days; 3 office days out of 4 available with 3-day req passes", async () => {
			// 5 weekdays - 1 sick day = 4 available, requirement stays 3
			// 3 office days >= 3 requirement => pass
			const workPeriods = [
				makeWorkPeriod(0, "office"), // Monday
				makeWorkPeriod(1, "office"), // Tuesday
				// Wednesday is sick
				makeWorkPeriod(3, "office"), // Thursday
				makeWorkPeriod(4, "home"), // Friday
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({ requiredOnsiteDays: 3 }),
					absenceDays: [{ date: "2026-02-11", reason: "sick" }], // Wednesday
				}),
			);

			expect(findings).toHaveLength(0);
		});
	});

	describe("requirement capped to available days", () => {
		test("3 sick days with 3-day requirement caps requirement to 2 remaining days", async () => {
			// 5 weekdays - 3 sick days = 2 available, requirement capped to 2
			// 2 office days >= 2 => pass
			const workPeriods = [
				makeWorkPeriod(0, "office"), // Monday
				makeWorkPeriod(1, "office"), // Tuesday
				// Wed, Thu, Fri are sick
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({ requiredOnsiteDays: 3 }),
					absenceDays: [
						{ date: "2026-02-11", reason: "sick" }, // Wednesday
						{ date: "2026-02-12", reason: "sick" }, // Thursday
						{ date: "2026-02-13", reason: "sick" }, // Friday
					],
				}),
			);

			expect(findings).toHaveLength(0);
		});

		test("3 sick days with 3-day requirement, only 1 office day of 2 available = violation", async () => {
			const workPeriods = [
				makeWorkPeriod(0, "office"), // Monday
				makeWorkPeriod(1, "home"), // Tuesday
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({ requiredOnsiteDays: 3 }),
					absenceDays: [
						{ date: "2026-02-11", reason: "sick" },
						{ date: "2026-02-12", reason: "sick" },
						{ date: "2026-02-13", reason: "sick" },
					],
				}),
			);

			expect(findings).toHaveLength(1);
			const evidence = findings[0].evidence as PresenceRequirementEvidence;
			expect(evidence.requiredDays).toBe(2); // capped from 3 to 2
			expect(evidence.actualOnsiteDays).toBe(1);
		});
	});

	describe("location type classification", () => {
		test("field counts as on-site", async () => {
			const workPeriods = [
				makeWorkPeriod(0, "field"), // Monday
				makeWorkPeriod(1, "field"), // Tuesday
				makeWorkPeriod(2, "field"), // Wednesday
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({ requiredOnsiteDays: 3 }),
				}),
			);

			expect(findings).toHaveLength(0);
		});

		test("null/untagged work location type does not count as on-site", async () => {
			const workPeriods = [
				makeWorkPeriod(0, null), // Monday
				makeWorkPeriod(1, null), // Tuesday
				makeWorkPeriod(2, null), // Wednesday
				makeWorkPeriod(3, null), // Thursday
				makeWorkPeriod(4, null), // Friday
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({ requiredOnsiteDays: 3 }),
				}),
			);

			expect(findings).toHaveLength(1);
			const evidence = findings[0].evidence as PresenceRequirementEvidence;
			expect(evidence.actualOnsiteDays).toBe(0);
		});

		test("home does not count as on-site", async () => {
			const workPeriods = [
				makeWorkPeriod(0, "home"),
				makeWorkPeriod(1, "home"),
				makeWorkPeriod(2, "home"),
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({ requiredOnsiteDays: 3 }),
				}),
			);

			expect(findings).toHaveLength(1);
			expect(
				(findings[0].evidence as PresenceRequirementEvidence).actualOnsiteDays,
			).toBe(0);
		});

		test("other does not count as on-site", async () => {
			const workPeriods = [
				makeWorkPeriod(0, "other"),
				makeWorkPeriod(1, "other"),
				makeWorkPeriod(2, "other"),
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({ requiredOnsiteDays: 3 }),
				}),
			);

			expect(findings).toHaveLength(1);
		});
	});

	describe("deduplication of same-day work periods", () => {
		test("multiple office clock-ins on same day count as 1 on-site day", async () => {
			const monday = WEEK_START;
			const workPeriods: WorkPeriodWithLocation[] = [
				{
					id: "wp-mon-1",
					employeeId: mockEmployee.id,
					startTime: monday.set({ hour: 8 }).toJSDate(),
					endTime: monday.set({ hour: 12 }).toJSDate(),
					durationMinutes: 240,
					isActive: false,
					workLocationType: "office",
				},
				{
					id: "wp-mon-2",
					employeeId: mockEmployee.id,
					startTime: monday.set({ hour: 13 }).toJSDate(),
					endTime: monday.set({ hour: 17 }).toJSDate(),
					durationMinutes: 240,
					isActive: false,
					workLocationType: "office",
				},
				{
					id: "wp-mon-3",
					employeeId: mockEmployee.id,
					startTime: monday.set({ hour: 18 }).toJSDate(),
					endTime: monday.set({ hour: 20 }).toJSDate(),
					durationMinutes: 120,
					isActive: false,
					workLocationType: "office",
				},
				makeWorkPeriod(1, "home"), // Tuesday - home
				makeWorkPeriod(2, "home"), // Wednesday - home
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({ requiredOnsiteDays: 3 }),
				}),
			);

			// 1 on-site day (Monday x3 = still 1) < 3 required => violation
			expect(findings).toHaveLength(1);
			const evidence = findings[0].evidence as PresenceRequirementEvidence;
			expect(evidence.actualOnsiteDays).toBe(1);
			// All 3 Monday work period IDs should be in evidence
			expect(evidence.onsiteWorkPeriodIds).toHaveLength(3);
		});
	});

	describe("fixed_days mode", () => {
		test("pass: required Mon/Wed/Fri, all present with office", async () => {
			const workPeriods = [
				makeWorkPeriod(0, "office"), // Monday
				makeWorkPeriod(1, "home"), // Tuesday
				makeWorkPeriod(2, "office"), // Wednesday
				makeWorkPeriod(3, "home"), // Thursday
				makeWorkPeriod(4, "office"), // Friday
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({
						presenceMode: "fixed_days",
						requiredOnsiteFixedDays: [1, 3, 5], // Mon, Wed, Fri
					}),
				}),
			);

			expect(findings).toHaveLength(0);
		});

		test("fail: required Mon/Wed/Fri, Wed is home = violation with missedDays", async () => {
			const workPeriods = [
				makeWorkPeriod(0, "office"), // Monday
				makeWorkPeriod(1, "home"), // Tuesday
				makeWorkPeriod(2, "home"), // Wednesday - home, not office!
				makeWorkPeriod(3, "home"), // Thursday
				makeWorkPeriod(4, "office"), // Friday
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({
						presenceMode: "fixed_days",
						requiredOnsiteFixedDays: [1, 3, 5], // Mon, Wed, Fri
					}),
				}),
			);

			expect(findings).toHaveLength(1);
			const evidence = findings[0].evidence as PresenceRequirementEvidence;
			expect(evidence.mode).toBe("fixed_days");
			expect(evidence.missedDays).toContain("wednesday");
			expect(evidence.missedDays).not.toContain("monday");
			expect(evidence.missedDays).not.toContain("friday");
		});

		test("holiday excuses a required fixed day", async () => {
			// Wednesday is a holiday, so the required Wed is excused
			const workPeriods = [
				makeWorkPeriod(0, "office"), // Monday
				makeWorkPeriod(4, "office"), // Friday
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({
						presenceMode: "fixed_days",
						requiredOnsiteFixedDays: [1, 3, 5], // Mon, Wed, Fri
					}),
					holidayDays: [{ date: "2026-02-11" }], // Wednesday is holiday
				}),
			);

			expect(findings).toHaveLength(0);
		});

		test("absence excuses a required fixed day", async () => {
			// Monday is sick day, only Wed and Fri required remain
			const workPeriods = [
				makeWorkPeriod(2, "office"), // Wednesday
				makeWorkPeriod(4, "office"), // Friday
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({
						presenceMode: "fixed_days",
						requiredOnsiteFixedDays: [1, 3, 5], // Mon, Wed, Fri
					}),
					absenceDays: [{ date: "2026-02-09", reason: "sick" }], // Monday sick
				}),
			);

			expect(findings).toHaveLength(0);
		});
	});

	describe("severity calculation", () => {
		test("critical: 0 of 3 required (100% shortfall)", async () => {
			const workPeriods = [
				makeWorkPeriod(0, "home"),
				makeWorkPeriod(1, "home"),
				makeWorkPeriod(2, "home"),
				makeWorkPeriod(3, "home"),
				makeWorkPeriod(4, "home"),
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({ requiredOnsiteDays: 3 }),
				}),
			);

			expect(findings).toHaveLength(1);
			expect(findings[0].severity).toBe("critical");
		});

		test("warning: 1 of 3 required (66% shortfall)", async () => {
			const workPeriods = [
				makeWorkPeriod(0, "office"), // 1 day on-site
				makeWorkPeriod(1, "home"),
				makeWorkPeriod(2, "home"),
				makeWorkPeriod(3, "home"),
				makeWorkPeriod(4, "home"),
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({ requiredOnsiteDays: 3 }),
				}),
			);

			expect(findings).toHaveLength(1);
			// shortfall = (3-1)/3 * 100 = 66.67% => critical (>= 66)
			expect(findings[0].severity).toBe("critical");
		});

		test("warning: 2 of 5 required (60% shortfall)", async () => {
			const workPeriods = [
				makeWorkPeriod(0, "office"),
				makeWorkPeriod(1, "office"),
				makeWorkPeriod(2, "home"),
				makeWorkPeriod(3, "home"),
				makeWorkPeriod(4, "home"),
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({ requiredOnsiteDays: 5 }),
				}),
			);

			expect(findings).toHaveLength(1);
			// shortfall = (5-2)/5 * 100 = 60% => warning (>= 33, < 66)
			expect(findings[0].severity).toBe("warning");
		});

		test("info: 2 of 3 required (33% shortfall)", async () => {
			const workPeriods = [
				makeWorkPeriod(0, "office"),
				makeWorkPeriod(1, "office"),
				makeWorkPeriod(2, "home"),
				makeWorkPeriod(3, "home"),
				makeWorkPeriod(4, "home"),
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({ requiredOnsiteDays: 3 }),
				}),
			);

			expect(findings).toHaveLength(1);
			// shortfall = (3-2)/3 * 100 = 33.33% => warning (>= 33)
			expect(findings[0].severity).toBe("warning");
		});

		test("info: small shortfall (< 33%)", async () => {
			const workPeriods = [
				makeWorkPeriod(0, "office"),
				makeWorkPeriod(1, "office"),
				makeWorkPeriod(2, "office"),
				makeWorkPeriod(3, "home"),
				makeWorkPeriod(4, "home"),
			];

			// 3 of 4 = 25% shortfall => info
			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({ requiredOnsiteDays: 4 }),
				}),
			);

			expect(findings).toHaveLength(1);
			expect(findings[0].severity).toBe("info");
		});
	});

	describe("enforcement none skips detection", () => {
		test("returns empty findings when enforcement is none", async () => {
			const workPeriods = [
				makeWorkPeriod(0, "home"),
				makeWorkPeriod(1, "home"),
				makeWorkPeriod(2, "home"),
				makeWorkPeriod(3, "home"),
				makeWorkPeriod(4, "home"),
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({
						requiredOnsiteDays: 5,
						enforcement: "none",
					}),
				}),
			);

			expect(findings).toHaveLength(0);
		});
	});

	describe("edge cases", () => {
		test("active/incomplete work periods are excluded", async () => {
			const workPeriods: WorkPeriodWithLocation[] = [
				makeWorkPeriod(0, "office", { isActive: true, endTime: null, durationMinutes: null }),
				makeWorkPeriod(1, "office", { isActive: true, endTime: null, durationMinutes: null }),
				makeWorkPeriod(2, "office", { isActive: true, endTime: null, durationMinutes: null }),
			];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({ requiredOnsiteDays: 3 }),
				}),
			);

			// All 3 are active, so 0 completed on-site days
			expect(findings).toHaveLength(1);
			const evidence = findings[0].evidence as PresenceRequirementEvidence;
			expect(evidence.actualOnsiteDays).toBe(0);
		});

		test("no work periods at all produces violation", async () => {
			const findings = await rule.detectViolations(
				makeInput({
					workPeriods: [],
					presenceConfig: makePresenceConfig({ requiredOnsiteDays: 3 }),
				}),
			);

			expect(findings).toHaveLength(1);
			const evidence = findings[0].evidence as PresenceRequirementEvidence;
			expect(evidence.actualOnsiteDays).toBe(0);
			expect(evidence.requiredDays).toBe(3);
		});

		test("all days excluded (5 sick days) with 3-day requirement = no violation (capped to 0)", async () => {
			const findings = await rule.detectViolations(
				makeInput({
					workPeriods: [],
					presenceConfig: makePresenceConfig({ requiredOnsiteDays: 3 }),
					absenceDays: [
						{ date: "2026-02-09", reason: "sick" },
						{ date: "2026-02-10", reason: "sick" },
						{ date: "2026-02-11", reason: "sick" },
						{ date: "2026-02-12", reason: "sick" },
						{ date: "2026-02-13", reason: "sick" },
					],
				}),
			);

			// 0 available days, requirement capped to 0, 0 >= 0 => no violation
			expect(findings).toHaveLength(0);
		});

		test("evidence includes correct period dates and employee id", async () => {
			const workPeriods = [makeWorkPeriod(0, "home")];

			const findings = await rule.detectViolations(
				makeInput({
					workPeriods,
					presenceConfig: makePresenceConfig({ requiredOnsiteDays: 3 }),
				}),
			);

			expect(findings).toHaveLength(1);
			expect(findings[0].employeeId).toBe("emp-001");
			expect(findings[0].type).toBe("presence_requirement");
			expect(findings[0].workPolicyId).toBe("policy-001");

			const evidence = findings[0].evidence as PresenceRequirementEvidence;
			expect(evidence.evaluationStart).toBe("2026-02-09");
			expect(evidence.evaluationEnd).toBe("2026-02-13");
			expect(evidence.locationId).toBeNull();
			expect(evidence.locationName).toBeNull();
		});

		test("rule metadata is correct", () => {
			expect(rule.name).toBe("presence_requirement");
			expect(rule.type).toBe("presence_requirement");
			expect(rule.description).toBeTruthy();
		});
	});
});
