import { describe, expect, it } from "vitest";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	distributeMinutesLargestRemainder,
	normalizeHoursToMinutes,
	parseCustomWorkDays,
	resolveEffectiveContractPure,
	resolveEmploymentPeriodForDay,
	resolvePrimaryTeamAtDayStart,
	unwrapInherit,
	type PureResolveContractInput,
	type WorkPolicySnapshot,
} from "./index";

function baseInput(overrides: Partial<PureResolveContractInput> = {}): PureResolveContractInput {
	return {
		date: parsePlainDate("2026-06-15"), // Monday
		employeeId: "emp-1",
		employeeContractType: "fixed",
		employeeCalendarTimezone: "Europe/Berlin",
		organizationTimezone: "Europe/Berlin",
		employmentPeriods: [],
		teamHistory: [],
		validOrgTeamIds: new Set(["team-a", "team-b"]),
		foreignTeamIds: new Set(),
		teamNames: new Map([
			["team-a", "Team A"],
			["team-b", "Team B"],
		]),
		confirmedTerms: [],
		contractDefaults: [],
		policyAssignments: [],
		policiesById: new Map(),
		...overrides,
	};
}

function detailedPolicy(overrides: Partial<WorkPolicySnapshot> = {}): WorkPolicySnapshot {
	return {
		id: "policy-detailed",
		name: "Detailed 40h",
		isActive: true,
		scheduleEnabled: true,
		regulationEnabled: true,
		presenceEnabled: true,
		versions: [
			{
				id: "ver-1",
				policyId: "policy-detailed",
				versionNumber: 1,
				effectiveFromDate: "2026-01-01",
				scheduleEnabled: true,
				regulationEnabled: true,
				presenceEnabled: true,
				schedule: {
					id: "sched-1",
					scheduleCycle: "weekly",
					scheduleType: "detailed",
					workingDaysPreset: "custom",
					hoursPerCycle: null,
					normalizedCycleMinutes: null,
					homeOfficeDaysPerCycle: 1,
					days: [
						{
							dayOfWeek: "monday",
							hoursPerDay: "9.00",
							minutesPerDay: 540,
							isWorkDay: true,
							cycleWeek: 1,
							latestClockIn: "09:00",
						},
						{
							dayOfWeek: "tuesday",
							hoursPerDay: "9.00",
							minutesPerDay: 540,
							isWorkDay: true,
							cycleWeek: 1,
							latestClockIn: "09:00",
						},
						{
							dayOfWeek: "wednesday",
							hoursPerDay: "9.00",
							minutesPerDay: 540,
							isWorkDay: true,
							cycleWeek: 1,
							latestClockIn: "09:00",
						},
						{
							dayOfWeek: "thursday",
							hoursPerDay: "9.00",
							minutesPerDay: 540,
							isWorkDay: true,
							cycleWeek: 1,
							latestClockIn: "09:00",
						},
						{
							dayOfWeek: "friday",
							hoursPerDay: "4.00",
							minutesPerDay: 240,
							isWorkDay: true,
							cycleWeek: 1,
							latestClockIn: "09:30",
						},
					],
				},
				regulation: {
					id: "reg-1",
					maxDailyMinutes: 600,
					maxWeeklyMinutes: 2880,
					maxUninterruptedMinutes: 360,
					minRestPeriodMinutes: 660,
					restPeriodEnforcement: "block",
					overtimeDailyThresholdMinutes: 480,
					overtimeWeeklyThresholdMinutes: 2400,
					overtimeMonthlyThresholdMinutes: 10800,
					alertBeforeLimitMinutes: 30,
					alertThresholdPercent: 80,
					breakRules: [],
				},
				presence: {
					id: "pres-1",
					presenceMode: "minimum_count",
					requiredOnsiteDays: 3,
					requiredOnsiteFixedDays: null,
					locationId: "loc-1",
					evaluationPeriod: "weekly",
					enforcement: "warn",
				},
			},
		],
		...overrides,
	};
}

describe("contracts pure helpers & resolver", () => {
	it("unwrapInherit treats 'inherit', null, and undefined as null while preserving concrete values", () => {
		expect(unwrapInherit("inherit")).toBeNull();
		expect(unwrapInherit(null)).toBeNull();
		expect(unwrapInherit(undefined)).toBeNull();
		expect(unwrapInherit("custom_days")).toBe("custom_days");
		expect(unwrapInherit("require_onsite")).toBe("require_onsite");
	});

	it("parses and validates custom working days with integer minutes and HH:mm latestClockIn", () => {
		const parsed = parseCustomWorkDays([
			{ dayOfWeek: "friday", minutesPerDay: 240, isWorkDay: true, latestClockIn: "09:30" },
			{ dayOfWeek: "monday", minutesPerDay: 480, isWorkDay: true, latestClockIn: "08:45" },
			{ dayOfWeek: "saturday", minutesPerDay: 0, isWorkDay: false, latestClockIn: "09:00" },
		]);
		expect(parsed).toEqual([
			{ dayOfWeek: "monday", minutesPerDay: 480, isWorkDay: true, latestClockIn: "08:45" },
			{ dayOfWeek: "friday", minutesPerDay: 240, isWorkDay: true, latestClockIn: "09:30" },
			{ dayOfWeek: "saturday", minutesPerDay: 0, isWorkDay: false, latestClockIn: null },
		]);

		expect(() =>
			parseCustomWorkDays([
				{ dayOfWeek: "monday", minutesPerDay: 480, isWorkDay: false, latestClockIn: null },
			]),
		).toThrow();
		expect(() =>
			parseCustomWorkDays([
				{ dayOfWeek: "monday", minutesPerDay: 480, isWorkDay: true, latestClockIn: "25:00" },
			]),
		).toThrow();
		expect(() =>
			parseCustomWorkDays([
				{ dayOfWeek: "monday", minutesPerDay: 480, isWorkDay: true, latestClockIn: null },
				{ dayOfWeek: "monday", minutesPerDay: 240, isWorkDay: true, latestClockIn: null },
			]),
		).toThrow();
	});

	it("normalizes hoursPerCycle to exact integer minutes and distributes via largest-remainder", () => {
		expect(normalizeHoursToMinutes("38.50")).toBe(2310);
		expect(normalizeHoursToMinutes("37.33")).toBe(2240);
		expect(distributeMinutesLargestRemainder(100, [1, 1, 1])).toEqual([34, 33, 33]);
		expect(distributeMinutesLargestRemainder(1900, [540, 540, 540, 540, 240])).toEqual([
			428, 428, 427, 427, 190,
		]);
	});

	it("scales detailed policy work days proportionally with read-only mismatchWarning when explicit employee weekly minutes disagree", () => {
		const policy = detailedPolicy();
		const result = resolveEffectiveContractPure(
			baseInput({
				policiesById: new Map([[policy.id, policy]]),
				confirmedTerms: [
					{
						id: "terms-1",
						employeeId: "emp-1",
						employmentPeriodId: null,
						validFrom: new Date("2026-01-01T00:00:00.000Z"),
						validUntil: null,
						validFromDate: "2026-01-01",
						validUntilDate: null,
						contractType: "fixed",
						weeklyContractMinutes: 1900,
						workModel: "hybrid",
						workPolicyId: policy.id,
						scheduleMode: "inherit",
						presenceOverride: "inherit",
						balanceMode: "tracked",
						scheduleSource: "policy",
						employmentProfile: "regular",
						arbzgScope: "standard",
						onCallHoursKind: null,
						onCallWeeklyMinutes: null,
						onCallDailyMinutes: null,
						migratedLegacyTerms: false,
						hourlyRate: null,
						currency: "EUR",
						createdAt: new Date("2026-01-01T00:00:00.000Z"),
						customDays: [],
					},
				],
			}),
		);

		expect(result.requiredMinutes).toBe(428); // Monday scaled from 540
		expect(result.weeklyScheduleDays.reduce((s, d) => s + d.minutesPerDay, 0)).toBe(1900);
		expect(result.mismatchWarning).toEqual({
			kind: "weekly_hours_policy_day_sum_mismatch",
			employeeWeeklyMinutes: 1900,
			policyDetailedDaySumMinutes: 2400,
			policyId: policy.id,
			policyVersionId: "ver-1",
		});
	});

	it("unwraps 'inherit' sentinels and defaults remote presence to exempt unless require_onsite", () => {
		const policy = detailedPolicy();
		const orgDefault = {
			id: "def-org",
			scope: "organization" as const,
			teamId: null,
			templateVersionId: "tv-org",
			effectiveFromDate: "2026-01-01",
			effectiveUntilDate: null,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			workPolicyId: policy.id,
			weeklyContractMinutes: 2400,
			scheduleMode: "policy" as const,
			workModel: "remote" as const,
			presenceOverride: "inherit" as const,
			balanceMode: "trust_based" as const,
			scheduleSource: "policy" as const,
			customDays: [],
		};

		const remoteExempt = resolveEffectiveContractPure(
			baseInput({
				policiesById: new Map([[policy.id, policy]]),
				contractDefaults: [orgDefault],
			}),
		);
		expect(remoteExempt.workModel).toBe("remote");
		expect(remoteExempt.presenceStatus).toBe("exempt");
		expect(remoteExempt.effectivePresence).toBeNull();
		expect(remoteExempt.balanceMode).toBe("trust_based");
		expect(remoteExempt.contributesZeroBalanceDelta).toBe(true);
		expect(remoteExempt.requiredMinutes).toBe(540); // Schedule preserved for absences!

		const forcedOnsite = resolveEffectiveContractPure(
			baseInput({
				policiesById: new Map([[policy.id, policy]]),
				contractDefaults: [{ ...orgDefault, presenceOverride: "require_onsite" }],
			}),
		);
		expect(forcedOnsite.presenceStatus).toBe("required");
		expect(forcedOnsite.effectivePresence?.locationId).toBe("loc-1");
	});

	it("honors 0120 team-history non-inference (no backward extrapolation, ignores foreign-org teams and zero-length intervals)", () => {
		const teamHistory = [
			{
				id: "h-zero",
				employeeId: "emp-1",
				teamId: "team-a",
				effectiveFrom: parseInstant("2026-06-15T00:00:00Z"),
				effectiveTo: parseInstant("2026-06-15T00:00:00Z"), // zero-length same-tx move
			},
			{
				id: "h-real",
				employeeId: "emp-1",
				teamId: "team-b",
				effectiveFrom: parseInstant("2026-06-15T00:00:00Z"),
				effectiveTo: null,
			},
		];

		// Day before effectiveFrom: zero backward extrapolation -> null
		expect(
			resolvePrimaryTeamAtDayStart({
				teamHistory,
				day: parsePlainDate("2026-06-14"),
				employeeCalendarTimezone: "UTC",
				foreignTeamIds: new Set(),
			}),
		).toBeNull();

		// Exact 00:00 UTC -> ignores zero-length h-zero, resolves team-b
		expect(
			resolvePrimaryTeamAtDayStart({
				teamHistory,
				day: parsePlainDate("2026-06-15"),
				employeeCalendarTimezone: "UTC",
				foreignTeamIds: new Set(),
			}),
		).toBe("team-b");

		// Foreign-org team recorded between 0120 and 0132 is ignored
		expect(
			resolvePrimaryTeamAtDayStart({
				teamHistory,
				day: parsePlainDate("2026-06-15"),
				employeeCalendarTimezone: "UTC",
				foreignTeamIds: new Set(["team-b"]),
			}),
		).toBeNull();
	});

	it("deduplicates same-day departure + rehire to the rehire stint active at end-of-day", () => {
		const periods = [
			{
				id: "period-1",
				employeeId: "emp-1",
				status: "closed",
				startedAt: parseInstant("2025-01-01T00:00:00Z"),
				startProvenance: "recorded",
				endedAt: parseInstant("2026-06-15T10:00:00Z"),
				createdAt: parseInstant("2025-01-01T00:00:00Z"),
			},
			{
				id: "period-2",
				employeeId: "emp-1",
				status: "open",
				startedAt: parseInstant("2026-06-15T14:00:00Z"),
				startProvenance: "recorded",
				endedAt: null,
				createdAt: parseInstant("2026-06-15T14:00:00Z"),
			},
		];

		expect(
			resolveEmploymentPeriodForDay(periods, parsePlainDate("2026-06-15"), "UTC")
				.employmentPeriodId,
		).toBe("period-2");
		expect(
			resolveEmploymentPeriodForDay(periods, parsePlainDate("2026-06-14"), "UTC")
				.employmentPeriodId,
		).toBe("period-1");
	});
});
