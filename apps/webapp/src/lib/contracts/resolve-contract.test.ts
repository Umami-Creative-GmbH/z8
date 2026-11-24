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
import { engagementPeriodDecidingDay } from "./resolve-contract";

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

	it("resolves a day inside an external contractor period with no employee rules, while the earlier employee stint keeps them", () => {
		const policy = detailedPolicy();
		const orgDefault = {
			id: "org-default",
			scope: "organization" as const,
			teamId: null,
			templateVersionId: "tpl-org",
			effectiveFromDate: "2026-01-01",
			effectiveUntilDate: null,
			createdAt: new Date("2026-01-01T00:00:00Z"),
			workPolicyId: policy.id,
			weeklyContractMinutes: 2400,
			scheduleMode: "policy" as const,
			workModel: "onsite" as const,
			presenceOverride: "require_onsite" as const,
			balanceMode: "tracked" as const,
			scheduleSource: "policy" as const,
			customDays: [],
		};
		const input = baseInput({
			employeeEngagementKind: "contractor",
			teamHistory: [
				{
					id: "th-1",
					employeeId: "emp-1",
					teamId: "team-a",
					effectiveFrom: parseInstant("2025-01-01T00:00:00Z"),
					effectiveTo: null,
				},
			],
			employmentPeriods: [
				{
					id: "employee-stint",
					employeeId: "emp-1",
					status: "closed",
					startedAt: parseInstant("2025-01-01T00:00:00Z"),
					startProvenance: "recorded",
					endedAt: parseInstant("2026-06-01T00:00:00Z"),
					createdAt: parseInstant("2025-01-01T00:00:00Z"),
					engagementKind: "employee",
				},
				{
					id: "contractor-stint",
					employeeId: "emp-1",
					status: "open",
					startedAt: parseInstant("2026-06-01T00:00:00Z"),
					startProvenance: "recorded",
					endedAt: null,
					createdAt: parseInstant("2026-06-01T00:00:00Z"),
					engagementKind: "contractor",
				},
			],
			contractDefaults: [
				orgDefault,
				{ ...orgDefault, id: "team-default", scope: "team", teamId: "team-a" },
			],
			policyAssignments: [
				{
					id: "org-assignment",
					policyId: policy.id,
					assignmentType: "organization",
					teamId: null,
					employeeId: null,
					priority: 0,
					effectiveFrom: null,
					effectiveUntil: null,
					effectiveFromDate: "2025-01-01",
					effectiveUntilDate: null,
					createdAt: new Date("2025-01-01T00:00:00Z"),
				},
			],
			policiesById: new Map([[policy.id, policy]]),
		});

		const contractorDay = resolveEffectiveContractPure(input);
		expect(contractorDay).toMatchObject({
			engagementKind: "contractor",
			employmentPeriodId: "contractor-stint",
			isEmployedOnDay: true,
			primaryTeamId: "team-a",
			contractDefaultId: null,
			contractDefaultScope: null,
			workPolicy: null,
			weeklyContractMinutes: null,
			presenceStatus: "not_configured",
			effectivePresence: null,
			balanceMode: "excluded",
			isWorkDay: false,
			requiredMinutes: 0,
			contributesZeroBalanceDelta: true,
			latestClockIn: null,
			mismatchWarning: null,
			employmentProfile: null,
			onCallTerms: null,
		});
		expect(contractorDay.weeklyScheduleDays.every((day) => day.minutesPerDay === 0)).toBe(true);

		const employeeDay = resolveEffectiveContractPure({
			...input,
			date: parsePlainDate("2026-05-25"),
		});
		expect(employeeDay).toMatchObject({
			engagementKind: "employee",
			employmentPeriodId: "employee-stint",
			contractDefaultId: "team-default",
			balanceMode: "tracked",
			requiredMinutes: 540,
			employmentProfile: "regular",
		});
		expect(employeeDay.workPolicy?.policyId).toBe(policy.id);
	});

	it("keeps a contractor outside the employee rules on days before and after their engagement", () => {
		const policy = detailedPolicy();
		const orgDefault = {
			id: "org-default",
			scope: "organization" as const,
			teamId: null,
			templateVersionId: "tpl-org",
			effectiveFromDate: "2026-01-01",
			effectiveUntilDate: null,
			createdAt: new Date("2026-01-01T00:00:00Z"),
			workPolicyId: policy.id,
			weeklyContractMinutes: 2400,
			scheduleMode: "policy" as const,
			workModel: "onsite" as const,
			presenceOverride: "require_onsite" as const,
			balanceMode: "tracked" as const,
			scheduleSource: "policy" as const,
			customDays: [],
		};
		const stint = (engagementKind: "employee" | "contractor") =>
			baseInput({
				employeeEngagementKind: engagementKind,
				employmentPeriods: [
					{
						id: "stint",
						employeeId: "emp-1",
						status: "closed",
						startedAt: parseInstant("2026-06-01T00:00:00Z"),
						startProvenance: "recorded",
						endedAt: parseInstant("2026-09-01T00:00:00Z"),
						createdAt: parseInstant("2026-05-20T00:00:00Z"),
						engagementKind,
					},
				],
				contractDefaults: [orgDefault],
			});

		for (const date of ["2026-05-25", "2026-09-07"]) {
			const contractorDay = resolveEffectiveContractPure({
				...stint("contractor"),
				date: parsePlainDate(date),
			});
			expect(contractorDay).toMatchObject({
				engagementKind: "contractor",
				isEmployedOnDay: false,
				employmentPeriodId: null,
				contractDefaultId: null,
				balanceMode: "excluded",
				employmentProfile: null,
				requiredMinutes: 0,
			});

			// An employee's day outside their employment is resolved as before.
			const employeeDay = resolveEffectiveContractPure({
				...stint("employee"),
				date: parsePlainDate(date),
			});
			expect(employeeDay).toMatchObject({
				engagementKind: "employee",
				isEmployedOnDay: false,
				contractDefaultId: "org-default",
				balanceMode: "tracked",
			});
		}
	});

	it("takes the kind of the stint before a gap, or of the first stint before any", () => {
		const period = (
			id: string,
			engagementKind: "employee" | "contractor",
			startedAt: string,
			endedAt: string | null,
		) => ({
			id,
			employeeId: "emp-1",
			status: endedAt ? ("closed" as const) : ("open" as const),
			startedAt: parseInstant(startedAt),
			startProvenance: "recorded" as const,
			endedAt: endedAt ? parseInstant(endedAt) : null,
			createdAt: parseInstant(startedAt),
			engagementKind,
		});
		const kindOn = (date: string, periods: ReturnType<typeof period>[]) =>
			resolveEffectiveContractPure({
				...baseInput({ employmentPeriods: periods }),
				date: parsePlainDate(date),
			}).engagementKind;
		const contractorThenEmployee = [
			period("c", "contractor", "2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z"),
			period("e", "employee", "2026-04-01T00:00:00Z", null),
		];
		expect(kindOn("2025-12-15", contractorThenEmployee)).toBe("contractor");
		expect(kindOn("2026-03-15", contractorThenEmployee)).toBe("contractor");
		const employeeThenContractor = [
			period("e", "employee", "2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z"),
			period("c", "contractor", "2026-04-01T00:00:00Z", null),
		];
		expect(kindOn("2025-12-15", employeeThenContractor)).toBe("employee");
		expect(kindOn("2026-03-15", employeeThenContractor)).toBe("employee");
	});

	it("continues the stint that decides the last or first day in force past a tie, whatever the row order", () => {
		const period = (
			id: string,
			engagementKind: "employee" | "contractor",
			startedAt: string,
			endedAt: string | null,
			createdAt: string,
		) => ({
			id,
			employeeId: "emp-1",
			status: endedAt ? ("closed" as const) : ("open" as const),
			startedAt: parseInstant(startedAt),
			startProvenance: "recorded" as const,
			endedAt: endedAt ? parseInstant(endedAt) : null,
			createdAt: parseInstant(createdAt),
			engagementKind,
		});
		const decide = (date: string, periods: ReturnType<typeof period>[]) => {
			const decided = engagementPeriodDecidingDay(periods, parsePlainDate(date), "UTC");
			return decided && `${decided.position}:${decided.period.id}`;
		};
		const sameEnd = [
			period(
				"contractor",
				"contractor",
				"2026-01-01T00:00:00Z",
				"2026-03-01T00:00:00Z",
				"2026-02-01T00:00:00Z",
			),
			period(
				"employee",
				"employee",
				"2026-02-01T00:00:00Z",
				"2026-03-01T00:00:00Z",
				"2026-01-01T00:00:00Z",
			),
		];
		// Both end together: the later start decides the last day in force and every day after,
		// although the contractor stint was recorded later.
		for (const rows of [sameEnd, [...sameEnd].reverse()]) {
			expect(decide("2026-02-28", rows)).toBe("in_force:employee");
			expect(decide("2026-03-01", rows)).toBe("after_end:employee");
			expect(decide("2026-03-15", rows)).toBe("after_end:employee");
		}

		// Both start together: the stint still in force at the end of the start day decides that
		// day and every day before, although the short contractor stint was recorded later.
		const sameStart = [
			period(
				"contractor",
				"contractor",
				"2026-04-01T10:00:00Z",
				"2026-04-01T12:00:00Z",
				"2026-01-02T00:00:00Z",
			),
			period("employee", "employee", "2026-04-01T10:00:00Z", null, "2026-01-01T00:00:00Z"),
		];
		for (const rows of [sameStart, [...sameStart].reverse()]) {
			expect(decide("2026-03-15", rows)).toBe("before_start:employee");
			expect(decide("2026-03-31", rows)).toBe("before_start:employee");
			expect(decide("2026-04-01", rows)).toBe("in_force:employee");
		}

		// Both open from the same instant: the later record decides, as for a day in force.
		const sameStartOpen = [
			period("employee", "employee", "2026-04-01T00:00:00Z", null, "2026-01-01T00:00:00Z"),
			period("contractor", "contractor", "2026-04-01T00:00:00Z", null, "2026-01-02T00:00:00Z"),
		];
		for (const rows of [sameStartOpen, [...sameStartOpen].reverse()]) {
			expect(decide("2026-03-31", rows)).toBe("before_start:contractor");
			expect(decide("2026-04-01", rows)).toBe("in_force:contractor");
		}

		// Same record time too: the id decides, as for a day in force.
		const sameRecord = [
			period("a", "employee", "2026-04-01T00:00:00Z", null, "2026-01-01T00:00:00Z"),
			period("b", "contractor", "2026-04-01T00:00:00Z", null, "2026-01-01T00:00:00Z"),
		];
		expect(decide("2026-03-15", sameRecord)).toBe("before_start:b");
		expect(decide("2026-03-15", [...sameRecord].reverse())).toBe("before_start:b");
		expect(decide("2026-04-15", sameRecord)).toBe("in_force:b");
	});

	it("falls back to the employee's engagement kind for a contractor without recorded periods", () => {
		const resolved = resolveEffectiveContractPure(
			baseInput({ employeeEngagementKind: "contractor" }),
		);
		expect(resolved).toMatchObject({
			engagementKind: "contractor",
			isEmployedOnDay: true,
			balanceMode: "excluded",
			requiredMinutes: 0,
		});
		expect(resolveEffectiveContractPure(baseInput()).engagementKind).toBe("employee");
	});

	it("does not fall back to currentTeamId when teamHistory is empty (A1-11)", () => {
		expect(
			resolvePrimaryTeamAtDayStart({
				teamHistory: [],
				day: parsePlainDate("2026-06-15"),
				employeeCalendarTimezone: "Europe/Berlin",
				foreignTeamIds: new Set(),
				currentTeamId: "team-b",
			}),
		).toBeNull();
		// Explicit synthetic/preview override still applies
		expect(
			resolvePrimaryTeamAtDayStart({
				teamHistory: [],
				day: parsePlainDate("2026-06-15"),
				employeeCalendarTimezone: "Europe/Berlin",
				foreignTeamIds: new Set(),
				teamIdOverride: "team-b",
				hasTeamIdOverride: true,
			}),
		).toBe("team-b");
	});

	it("preserves historical eligibility of a retired policy on dates before its dated assignment end (A1-12)", () => {
		const retiredPolicy = detailedPolicy({ id: "policy-retired", isActive: false });
		const assignment = {
			id: "asgn-retired",
			policyId: retiredPolicy.id,
			assignmentType: "employee" as const,
			teamId: null,
			employeeId: "emp-1",
			sourceKind: "employment_terms",
			effectiveFrom: new Date("2026-01-01T00:00:00Z"),
			effectiveUntil: new Date("2026-06-01T00:00:00Z"),
			effectiveFromDate: "2026-01-01",
			effectiveUntilDate: "2026-06-01",
			priority: 0,
			isActive: true,
			createdAt: new Date("2026-01-01T00:00:00Z"),
		};

		const historicalDay = resolveEffectiveContractPure(
			baseInput({
				date: parsePlainDate("2026-05-11"), // Monday before retirement end
				policiesById: new Map([[retiredPolicy.id, retiredPolicy]]),
				policyAssignments: [assignment],
			}),
		);
		expect(historicalDay.workPolicy?.policyId).toBe(retiredPolicy.id);
		expect(historicalDay.requiredMinutes).toBe(540);

		const afterEnd = resolveEffectiveContractPure(
			baseInput({
				date: parsePlainDate("2026-06-01"),
				policiesById: new Map([[retiredPolicy.id, retiredPolicy]]),
				policyAssignments: [assignment],
			}),
		);
		expect(afterEnd.workPolicy).toBeNull();
	});

	it("resolves alternating biweekly cycleWeek days and monthly/biweekly/yearly simple cycles (A1-13)", () => {
		const biweeklyPolicy: WorkPolicySnapshot = {
			...detailedPolicy(),
			id: "policy-biweekly",
			versions: [
				{
					...detailedPolicy().versions[0]!,
					effectiveFromDate: "2026-06-01", // Monday (week 1)
					schedule: {
						id: "sched-bi",
						scheduleCycle: "biweekly",
						scheduleType: "detailed",
						workingDaysPreset: "custom",
						hoursPerCycle: null,
						normalizedCycleMinutes: null,
						homeOfficeDaysPerCycle: 0,
						days: [
							{
								dayOfWeek: "monday",
								hoursPerDay: "8.00",
								minutesPerDay: 480,
								isWorkDay: true,
								cycleWeek: 1,
								latestClockIn: null,
							},
							{
								dayOfWeek: "tuesday",
								hoursPerDay: "6.00",
								minutesPerDay: 360,
								isWorkDay: true,
								cycleWeek: 2,
								latestClockIn: null,
							},
						],
					},
				},
			],
		};

		const asgn = {
			id: "asgn-bi",
			policyId: biweeklyPolicy.id,
			assignmentType: "employee" as const,
			teamId: null,
			employeeId: "emp-1",
			sourceKind: "employment_terms",
			effectiveFrom: new Date("2026-06-01T00:00:00Z"),
			effectiveUntil: null,
			effectiveFromDate: "2026-06-01",
			effectiveUntilDate: null,
			priority: 0,
			isActive: true,
			createdAt: new Date("2026-06-01T00:00:00Z"),
		};

		// Week 1 (2026-06-01 Mon -> 480m, 2026-06-02 Tue -> 0m)
		const w1Mon = resolveEffectiveContractPure(
			baseInput({
				date: parsePlainDate("2026-06-01"),
				policiesById: new Map([[biweeklyPolicy.id, biweeklyPolicy]]),
				policyAssignments: [asgn],
			}),
		);
		expect(w1Mon.requiredMinutes).toBe(480);
		expect(w1Mon.weeklyScheduleDays.find((d) => d.dayOfWeek === "tuesday")?.isWorkDay).toBe(false);

		// Week 2 (2026-06-08 Mon -> 0m, 2026-06-09 Tue -> 360m)
		const w2Tue = resolveEffectiveContractPure(
			baseInput({
				date: parsePlainDate("2026-06-09"),
				policiesById: new Map([[biweeklyPolicy.id, biweeklyPolicy]]),
				policyAssignments: [asgn],
			}),
		);
		expect(w2Tue.requiredMinutes).toBe(360);
		expect(w2Tue.weeklyScheduleDays.find((d) => d.dayOfWeek === "monday")?.isWorkDay).toBe(false);

		// Simple biweekly (80h / 2 = 40h = 2400m -> 480m per weekday)
		const simpleBiweekly: WorkPolicySnapshot = {
			...detailedPolicy(),
			id: "policy-simple-bi",
			versions: [
				{
					...detailedPolicy().versions[0]!,
					schedule: {
						id: "sched-sbi",
						scheduleCycle: "biweekly",
						scheduleType: "simple",
						workingDaysPreset: "weekdays",
						hoursPerCycle: "80.00",
						normalizedCycleMinutes: 4800,
						homeOfficeDaysPerCycle: 0,
						days: [],
					},
				},
			],
		};
		const simpleBiRes = resolveEffectiveContractPure(
			baseInput({
				date: parsePlainDate("2026-06-01"),
				policiesById: new Map([[simpleBiweekly.id, simpleBiweekly]]),
				policyAssignments: [{ ...asgn, id: "asgn-sbi", policyId: simpleBiweekly.id }],
			}),
		);
		expect(simpleBiRes.requiredMinutes).toBe(480);
	});

	it("enforces dated retirement boundaries on defaults & direct pins (A2-8 / P7-1), local-midnight dated assignments (A2-12), manager-assignment pay-only preservation (A2-13), hours_only week-2 & daily workdays (A2-14), and stable cycle anchor across non-schedule versions (A2-15 / P7-2)", () => {
		// A2-8 / P7-1: A retired policy (retiredOnDate = 2026-06-10) on a dated default ending 2026-07-01
		// must NOT apply on/after 2026-06-10, and a direct employee terms pin also respects retiredOnDate.
		const retiredPol: WorkPolicySnapshot = {
			...detailedPolicy(),
			id: "policy-retired",
			isActive: false,
			retiredOnDate: "2026-06-10",
		};
		const longDatedDefault = {
			id: "def-long",
			scope: "organization" as const,
			teamId: null,
			templateVersionId: "tv-long",
			effectiveFromDate: "2026-01-01",
			effectiveUntilDate: "2026-07-01",
			workPolicyId: retiredPol.id,
			weeklyContractMinutes: 2400,
			scheduleMode: "policy" as const,
			workModel: "onsite" as const,
			presenceOverride: "inherit" as const,
			balanceMode: "tracked" as const,
			scheduleSource: "policy" as const,
			customDays: [],
			createdAt: new Date("2026-01-01T00:00:00Z"),
		};
		const afterRetire = resolveEffectiveContractPure(
			baseInput({
				date: parsePlainDate("2026-06-11"),
				policiesById: new Map([[retiredPol.id, retiredPol]]),
				contractDefaults: [longDatedDefault],
			}),
		);
		expect(afterRetire.workPolicy).toBeNull();

		// Properly capped default ending AT retiredOnDate keeps retired policy on 2026-06-09
		const cappedDefault = { ...longDatedDefault, effectiveUntilDate: "2026-06-10" };
		const beforeRetire = resolveEffectiveContractPure(
			baseInput({
				date: parsePlainDate("2026-06-09"),
				policiesById: new Map([[retiredPol.id, retiredPol]]),
				contractDefaults: [cappedDefault],
			}),
		);
		expect(beforeRetire.workPolicy?.policyId).toBe(retiredPol.id);

		// Direct employee terms pin to retired policy does NOT apply on/after retiredOnDate
		const pinAfterRetire = resolveEffectiveContractPure(
			baseInput({
				date: parsePlainDate("2026-06-11"),
				policiesById: new Map([[retiredPol.id, retiredPol]]),
				confirmedTerms: [
					{
						id: "terms-pin-retired",
						employmentPeriodId: "period-1",
						validFrom: new Date("2026-01-01T00:00:00Z"),
						validUntil: null,
						validFromDate: "2026-01-01",
						validUntilDate: null,
						status: "active",
						contractType: "fixed",
						hourlyRate: null,
						currency: "EUR",
						weeklyContractMinutes: 2400,
						workModel: "onsite",
						workPolicyId: retiredPol.id,
						scheduleMode: "policy",
						presenceOverride: "inherit",
						balanceMode: "tracked",
						scheduleSource: "policy",
						employmentProfile: "regular",
						migratedLegacyTerms: false,
						probationStartsOn: null,
						probationEndsOn: null,
						createdAt: new Date("2026-01-01T00:00:00Z"),
						customDays: [],
						onCallTerms: null,
					},
				],
			}),
		);
		expect(pinAfterRetire.workPolicy).toBeNull();

		// A2-12: Dated non-legacy assignment starting 2026-01-02 applies at 00:30 Berlin time
		// (2026-01-01T23:30:00Z) even though effectiveFrom stores UTC midnight 2026-01-02T00:00:00Z
		const activePol = detailedPolicy();
		const berlinMidnightRes = resolveEffectiveContractPure(
			baseInput({
				date: parsePlainDate("2026-01-02"),
				at: parseInstant("2026-01-01T23:30:00Z"),
				employeeCalendarTimezone: "Europe/Berlin",
				organizationTimezone: "Europe/Berlin",
				policiesById: new Map([[activePol.id, activePol]]),
				policyAssignments: [
					{
						id: "asgn-mgr-berlin",
						policyId: activePol.id,
						assignmentType: "employee",
						teamId: null,
						employeeId: "emp-1",
						sourceKind: "manager_assignment",
						effectiveFrom: new Date("2026-01-02T00:00:00Z"),
						effectiveUntil: null,
						effectiveFromDate: "2026-01-02",
						effectiveUntilDate: null,
						priority: 2,
						isActive: true,
						createdAt: new Date("2026-01-01T12:00:00Z"),
					},
				],
			}),
		);
		expect(berlinMidnightRes.workPolicy?.policyId).toBe(activePol.id);

		// A2-13: Pay-only terms change (workPolicyId = null) after a manager_assignment preserves it
		const payEditRes = resolveEffectiveContractPure(
			baseInput({
				date: parsePlainDate("2026-03-01"),
				policiesById: new Map([[activePol.id, activePol]]),
				policyAssignments: [
					{
						id: "asgn-mgr-keep",
						policyId: activePol.id,
						assignmentType: "employee",
						teamId: null,
						employeeId: "emp-1",
						sourceKind: "manager_assignment",
						effectiveFrom: new Date("2026-02-01T00:00:00Z"),
						effectiveUntil: null,
						effectiveFromDate: "2026-02-01",
						effectiveUntilDate: null,
						priority: 2,
						isActive: true,
						createdAt: new Date("2026-02-01T00:00:00Z"),
					},
				],
				confirmedTerms: [
					{
						id: "terms-wage-only",
						employmentPeriodId: "period-1",
						validFrom: new Date("2026-02-15T00:00:00Z"),
						validUntil: null,
						validFromDate: "2026-02-15",
						validUntilDate: null,
						status: "active",
						contractType: "hourly",
						hourlyRate: 25,
						currency: "EUR",
						weeklyContractMinutes: null,
						workModel: null,
						workPolicyId: null,
						scheduleMode: null,
						presenceOverride: "inherit",
						balanceMode: null,
						scheduleSource: null,
						employmentProfile: "regular",
						migratedLegacyTerms: false,
						probationStartsOn: null,
						probationEndsOn: null,
						createdAt: new Date("2026-02-15T00:00:00Z"),
						customDays: [],
						onCallTerms: null,
					},
				],
			}),
		);
		expect(payEditRes.workPolicy?.policyId).toBe(activePol.id);

		// A2-14 & A2-15 / P7-2: Non-schedule v2 published in week 2 keeps v1's anchor date, AND
		// hours_only uses week 2's active workdays (Tuesday) rather than week 1's Monday.
		const biweeklySchedule = {
			id: "sched-bi-anchor",
			scheduleCycle: "biweekly" as const,
			scheduleType: "detailed" as const,
			workingDaysPreset: "custom" as const,
			hoursPerCycle: null,
			normalizedCycleMinutes: null,
			homeOfficeDaysPerCycle: 0,
			days: [
				{
					dayOfWeek: "monday" as const,
					hoursPerDay: "8.00",
					minutesPerDay: 480,
					isWorkDay: true,
					cycleWeek: 1,
					latestClockIn: null,
				},
				{
					dayOfWeek: "tuesday" as const,
					hoursPerDay: "6.00",
					minutesPerDay: 360,
					isWorkDay: true,
					cycleWeek: 2,
					latestClockIn: null,
				},
			],
		};
		const multiVerBiweekly: WorkPolicySnapshot = {
			...detailedPolicy(),
			id: "policy-bi-anchor",
			versions: [
				{
					...detailedPolicy().versions[0]!,
					id: "pv-1",
					versionNumber: 1,
					effectiveFromDate: "2026-06-01", // Monday (week 1)
					regulationEnabled: false,
					schedule: biweeklySchedule,
				},
				{
					...detailedPolicy().versions[0]!,
					id: "pv-2",
					versionNumber: 2,
					effectiveFromDate: "2026-06-08", // Monday (week 2) — non-schedule regulation change only!
					regulationEnabled: true,
					schedule: { ...biweeklySchedule, id: "sched-bi-anchor-v2" },
				},
			],
		};
		const biAsgn = {
			id: "asgn-bi-anchor",
			policyId: multiVerBiweekly.id,
			assignmentType: "employee" as const,
			teamId: null,
			employeeId: "emp-1",
			sourceKind: "employment_terms",
			effectiveFrom: new Date("2026-06-01T00:00:00Z"),
			effectiveUntil: null,
			effectiveFromDate: "2026-06-01",
			effectiveUntilDate: null,
			priority: 2,
			isActive: true,
			createdAt: new Date("2026-06-01T00:00:00Z"),
		};
		// On 2026-06-09 (Tuesday of week 2), v2 is active, scheduleAnchorDate MUST stay 2026-06-01 -> Tuesday = 360m!
		const w2WithV2 = resolveEffectiveContractPure(
			baseInput({
				date: parsePlainDate("2026-06-09"),
				policiesById: new Map([[multiVerBiweekly.id, multiVerBiweekly]]),
				policyAssignments: [biAsgn],
			}),
		);
		expect(w2WithV2.workPolicy?.policyVersionId).toBe("pv-2");
		expect(w2WithV2.workPolicy?.scheduleAnchorDate).toBe("2026-06-01");
		expect(w2WithV2.requiredMinutes).toBe(360);
		expect(w2WithV2.weeklyScheduleDays.find((d) => d.dayOfWeek === "monday")?.isWorkDay).toBe(
			false,
		);

		// hours_only on week 2 (2026-06-09) distributes weeklyContractMinutes (420m) onto Tuesday (week 2), NOT Monday!
		const hoursOnlyW2 = resolveEffectiveContractPure(
			baseInput({
				date: parsePlainDate("2026-06-09"),
				policiesById: new Map([[multiVerBiweekly.id, multiVerBiweekly]]),
				policyAssignments: [biAsgn],
				confirmedTerms: [
					{
						id: "terms-ho-w2",
						employmentPeriodId: "period-1",
						validFrom: new Date("2026-06-01T00:00:00Z"),
						validUntil: null,
						validFromDate: "2026-06-01",
						validUntilDate: null,
						status: "active",
						contractType: "fixed",
						hourlyRate: null,
						currency: "EUR",
						weeklyContractMinutes: 420,
						workModel: "onsite",
						workPolicyId: multiVerBiweekly.id,
						scheduleMode: "hours_only",
						presenceOverride: "inherit",
						balanceMode: "tracked",
						scheduleSource: "policy",
						employmentProfile: "regular",
						migratedLegacyTerms: false,
						probationStartsOn: null,
						probationEndsOn: null,
						createdAt: new Date("2026-06-01T00:00:00Z"),
						customDays: [],
						onCallTerms: null,
					},
				],
			}),
		);
		expect(hoursOnlyW2.requiredMinutes).toBe(420);
		expect(hoursOnlyW2.weeklyScheduleDays.find((d) => d.dayOfWeek === "monday")?.isWorkDay).toBe(
			false,
		);

		// A2-14: hours_only fallback on a weekend-only daily policy (8h/day * 2 days = 16h/wk, NOT 40h/wk)
		const weekendDailyPolicy: WorkPolicySnapshot = {
			...detailedPolicy(),
			id: "policy-weekend-daily",
			versions: [
				{
					...detailedPolicy().versions[0]!,
					id: "pv-wd",
					schedule: {
						id: "sched-wd",
						scheduleCycle: "daily",
						scheduleType: "simple",
						workingDaysPreset: "weekends",
						hoursPerCycle: "8.00",
						normalizedCycleMinutes: 480,
						homeOfficeDaysPerCycle: 0,
						days: [],
					},
				},
			],
		};
		const weekendHoursOnly = resolveEffectiveContractPure(
			baseInput({
				date: parsePlainDate("2026-06-06"), // Saturday
				policiesById: new Map([[weekendDailyPolicy.id, weekendDailyPolicy]]),
				contractDefaults: [
					{
						...longDatedDefault,
						id: "def-wd",
						workPolicyId: weekendDailyPolicy.id,
						weeklyContractMinutes: null,
						scheduleMode: "hours_only",
						effectiveUntilDate: null,
					},
				],
			}),
		);
		expect(weekendHoursOnly.requiredMinutes).toBe(480); // 960 / 2 = 480m on Sat, NOT 2400 / 2 = 1200m!

		// A3-18: An explicitly work-free week 2 (Monday isWorkDay=false) must NOT fall back to week 1!
		const workFreeW2Policy: WorkPolicySnapshot = {
			...detailedPolicy(),
			id: "policy-work-free-w2",
			versions: [
				{
					...detailedPolicy().versions[0]!,
					id: "pv-wf2",
					effectiveFromDate: "2026-06-01",
					schedule: {
						id: "sched-wf2",
						scheduleCycle: "biweekly",
						scheduleType: "detailed",
						workingDaysPreset: "custom",
						hoursPerCycle: null,
						normalizedCycleMinutes: null,
						homeOfficeDaysPerCycle: 0,
						days: [
							{
								dayOfWeek: "monday",
								hoursPerDay: "8.00",
								minutesPerDay: 480,
								isWorkDay: true,
								cycleWeek: 1,
								latestClockIn: null,
							},
							{
								dayOfWeek: "monday",
								hoursPerDay: "0.00",
								minutesPerDay: 0,
								isWorkDay: false,
								cycleWeek: 2,
								latestClockIn: null,
							},
						],
					},
				},
			],
		};
		const workFreeW2Res = resolveEffectiveContractPure(
			baseInput({
				date: parsePlainDate("2026-06-08"), // Monday of week 2 (explicitly off!)
				policiesById: new Map([[workFreeW2Policy.id, workFreeW2Policy]]),
				contractDefaults: [
					{
						...longDatedDefault,
						id: "def-wf2",
						workPolicyId: workFreeW2Policy.id,
						weeklyContractMinutes: 480,
						scheduleMode: "hours_only",
						effectiveUntilDate: null,
					},
				],
			}),
		);
		expect(workFreeW2Res.requiredMinutes).toBe(0);

		// A3-6: Renaming or reactivating a previously retired policy does NOT revive a direct terms
		// pin whose linked `employment_terms` assignment was capped at the original retirement date!
		const renamedOrReactivatedPolicy: WorkPolicySnapshot = {
			...detailedPolicy(),
			id: "policy-reactivated-later",
			isActive: true,
			retiredOnDate: null,
		};
		const pinReactivatedRes = resolveEffectiveContractPure(
			baseInput({
				date: parsePlainDate("2026-06-15"),
				policiesById: new Map([[renamedOrReactivatedPolicy.id, renamedOrReactivatedPolicy]]),
				policyAssignments: [
					{
						id: "asgn-linked-capped",
						policyId: renamedOrReactivatedPolicy.id,
						assignmentType: "employee",
						teamId: null,
						employeeId: "emp-1",
						sourceKind: "employment_terms",
						sourceEmploymentHistoryId: "terms-linked-1",
						isActive: true,
						effectiveFrom: new Date("2026-01-01T00:00:00Z"),
						effectiveUntil: new Date("2026-06-10T00:00:00Z"),
						effectiveFromDate: "2026-01-01",
						effectiveUntilDate: "2026-06-10",
						priority: 2,
						createdAt: new Date("2026-01-01T00:00:00Z"),
					},
				],
				confirmedTerms: [
					{
						id: "terms-linked-1",
						employmentPeriodId: "period-1",
						validFrom: new Date("2026-01-01T00:00:00Z"),
						validUntil: new Date("2026-07-01T00:00:00Z"),
						validFromDate: "2026-01-01",
						validUntilDate: "2026-07-01",
						status: "active",
						contractType: "fixed",
						hourlyRate: null,
						currency: "EUR",
						weeklyContractMinutes: 2400,
						workModel: "onsite",
						workPolicyId: renamedOrReactivatedPolicy.id,
						scheduleMode: "policy",
						presenceOverride: "inherit",
						balanceMode: "tracked",
						scheduleSource: "policy",
						employmentProfile: "regular",
						migratedLegacyTerms: false,
						probationStartsOn: null,
						probationEndsOn: null,
						createdAt: new Date("2026-01-01T00:00:00Z"),
						customDays: [],
						onCallTerms: null,
					},
				],
			}),
		);
		expect(pinReactivatedRes.workPolicy).toBeNull();

		// H4 / A3-4: On an opening-day cross-timezone rehire (Berlin rehire on June 16 while
		// employee's New York date is still June 15), with no new policy pin, the pure resolver
		// MUST exclude the prior stint's manager assignment capped at June 16 (matching clock-out).
		const priorStintPolicy: WorkPolicySnapshot = {
			...detailedPolicy(),
			id: "policy-prior-stint-mgr",
			name: "Prior Stint Manager Policy",
		};
		const crossTzRehireRes = resolveEffectiveContractPure(
			baseInput({
				date: parsePlainDate("2026-06-15"),
				employeeCalendarTimezone: "America/New_York",
				organizationTimezone: "Europe/Berlin",
				employmentPeriods: [
					{
						id: "period-1",
						employeeId: "emp-1",
						status: "closed",
						startedAt: parseInstant("2025-01-01T00:00:00Z"),
						startProvenance: "recorded",
						endedAt: parseInstant("2026-06-15T22:00:00Z"), // 2026-06-16 00:00 Berlin
						createdAt: parseInstant("2025-01-01T00:00:00Z"),
					},
					{
						id: "period-2",
						employeeId: "emp-1",
						status: "open",
						startedAt: parseInstant("2026-06-15T22:30:00Z"), // 2026-06-16 00:30 Berlin, 2026-06-15 18:30 NY
						startProvenance: "recorded",
						endedAt: null,
						createdAt: parseInstant("2026-06-15T22:30:00Z"),
					},
				],
				policiesById: new Map([[priorStintPolicy.id, priorStintPolicy]]),
				contractDefaults: [],
				confirmedTerms: [],
				policyAssignments: [
					{
						id: "asgn-prior-mgr",
						policyId: priorStintPolicy.id,
						assignmentType: "employee",
						teamId: null,
						employeeId: "emp-1",
						sourceKind: "manager_assignment",
						sourceEmploymentHistoryId: null,
						isActive: true,
						effectiveFrom: new Date("2025-01-01T00:00:00Z"),
						effectiveUntil: new Date("2026-06-15T22:00:00Z"),
						effectiveFromDate: "2025-01-01",
						effectiveUntilDate: "2026-06-16",
						priority: 2,
						createdAt: new Date("2025-01-01T00:00:00Z"),
					},
				],
			}),
		);
		expect(crossTzRehireRes.employmentPeriodId).toBe("period-2");
		expect(crossTzRehireRes.workPolicy).toBeNull();

		// F11-1 / Astra #8: Legacy assignment ending at exact UTC midnight (2026-06-10T00:00:00Z)
		// in a west-of-UTC org (America/New_York) MUST still cover June 9 in date-only resolution!
		const nyLegacyPol: WorkPolicySnapshot = {
			...detailedPolicy(),
			id: "policy-ny-utc-midnight-end",
			name: "NY Legacy UTC Midnight Policy",
		};
		const nyDateOnlyRes = resolveEffectiveContractPure(
			baseInput({
				date: parsePlainDate("2026-06-09"),
				employeeCalendarTimezone: "America/New_York",
				organizationTimezone: "America/New_York",
				policiesById: new Map([[nyLegacyPol.id, nyLegacyPol]]),
				contractDefaults: [],
				confirmedTerms: [],
				policyAssignments: [
					{
						id: "asgn-ny-legacy-utc-midnight",
						policyId: nyLegacyPol.id,
						assignmentType: "employee",
						teamId: null,
						employeeId: "emp-1",
						sourceKind: "legacy",
						sourceEmploymentHistoryId: null,
						isActive: true,
						effectiveFrom: new Date("2026-01-01T00:00:00Z"),
						effectiveUntil: new Date("2026-06-10T00:00:00Z"),
						effectiveFromDate: "2026-01-01",
						effectiveUntilDate: "2026-06-10",
						priority: 2,
						createdAt: new Date("2026-01-01T00:00:00Z"),
					},
				],
			}),
		);
		expect(nyDateOnlyRes.workPolicy?.policyId).toBe(nyLegacyPol.id);

		// Astra #10: Zero-width [D, D) unscoped confirmed terms row MUST NOT trigger inEndedTermsGap
		// and suppress a valid active employee policy assignment!
		const emptyUnscopedRes = resolveEffectiveContractPure(
			baseInput({
				date: parsePlainDate("2026-06-15"),
				policiesById: new Map([[nyLegacyPol.id, nyLegacyPol]]),
				contractDefaults: [],
				confirmedTerms: [
					{
						id: "terms-empty-unscoped",
						employeeId: "emp-1",
						employmentPeriodId: null,
						validFrom: new Date("2026-03-01T00:00:00Z"),
						validUntil: new Date("2026-03-01T00:00:00Z"),
						validFromDate: "2026-03-01",
						validUntilDate: "2026-03-01",
						contractType: "fixed",
						hourlyRate: null,
						currency: "EUR",
						weeklyContractMinutes: 2400,
						workModel: "onsite",
						workPolicyId: null,
						scheduleMode: "policy",
						presenceOverride: "inherit",
						balanceMode: "tracked",
						scheduleSource: "policy",
						employmentProfile: "regular",
						arbzgScope: "standard",
						onCallHoursKind: null,
						onCallWeeklyMinutes: null,
						onCallDailyMinutes: null,
						migratedLegacyTerms: false,
						createdAt: new Date("2026-03-01T00:00:00Z"),
						customDays: [],
					},
				],
				policyAssignments: [
					{
						id: "asgn-after-empty-unscoped",
						policyId: nyLegacyPol.id,
						assignmentType: "employee",
						teamId: null,
						employeeId: "emp-1",
						sourceKind: "manager_assignment",
						sourceEmploymentHistoryId: null,
						isActive: true,
						effectiveFrom: new Date("2026-01-01T00:00:00Z"),
						effectiveUntil: null,
						effectiveFromDate: "2026-01-01",
						effectiveUntilDate: null,
						priority: 2,
						createdAt: new Date("2026-01-01T00:00:00Z"),
					},
				],
			}),
		);
		expect(emptyUnscopedRes.workPolicy?.policyId).toBe(nyLegacyPol.id);

		// Astra #9 / Opus #2(a): A manually canceled 1-day NY legacy assignment [June 10 00:00Z, June 11 00:00Z)
		// (effective_until != June 10 local midnight 04:00Z) MUST NOT govern lookups after cancellation!
		const canceledOneDayRes = resolveEffectiveContractPure(
			baseInput({
				date: parsePlainDate("2026-06-10"),
				at: parseInstant("2026-06-10T12:00:00Z"),
				employeeCalendarTimezone: "America/New_York",
				organizationTimezone: "America/New_York",
				policiesById: new Map([[nyLegacyPol.id, nyLegacyPol]]),
				contractDefaults: [],
				confirmedTerms: [],
				policyAssignments: [
					{
						id: "asgn-canceled-one-day",
						policyId: nyLegacyPol.id,
						assignmentType: "employee",
						teamId: null,
						employeeId: "emp-1",
						sourceKind: "legacy",
						sourceEmploymentHistoryId: null,
						isActive: false,
						effectiveFrom: new Date("2026-06-10T00:00:00Z"),
						effectiveUntil: new Date("2026-06-11T00:00:00Z"),
						effectiveFromDate: "2026-06-10",
						effectiveUntilDate: "2026-06-11",
						priority: 2,
						createdAt: new Date("2026-06-01T00:00:00Z"),
					},
				],
			}),
		);
		expect(canceledOneDayRes.workPolicy).toBeNull();

		// Opus #2(b): When an admin schedules an active replacement starting on D-1 (June 9),
		// it MUST beat a deactivated retired 1a-fallback prior-evening row (June 10..11, 00:00Z..04:00Z)
		// on the evening of June 9 (2026-06-10T01:00:00Z = June 9 21:00 NY)!
		const replacementPol: WorkPolicySnapshot = {
			...detailedPolicy(),
			id: "policy-d-minus-1-replacement",
			name: "D-1 Replacement Policy",
		};
		const dMinus1ReplacementRes = resolveEffectiveContractPure(
			baseInput({
				date: parsePlainDate("2026-06-09"),
				at: parseInstant("2026-06-10T01:00:00Z"), // June 9 21:00 EDT
				employeeCalendarTimezone: "America/New_York",
				organizationTimezone: "America/New_York",
				policiesById: new Map([
					[retiredPol.id, retiredPol],
					[replacementPol.id, replacementPol],
				]),
				contractDefaults: [],
				confirmedTerms: [],
				policyAssignments: [
					{
						id: "asgn-1a-fallback-retired",
						policyId: retiredPol.id,
						assignmentType: "employee",
						teamId: null,
						employeeId: "emp-1",
						sourceKind: "legacy",
						sourceEmploymentHistoryId: null,
						isActive: false,
						effectiveFrom: new Date("2026-06-10T00:00:00Z"),
						effectiveUntil: new Date("2026-06-10T04:00:00Z"), // exact June 10 NY midnight
						effectiveFromDate: "2026-06-10",
						effectiveUntilDate: "2026-06-11",
						priority: 2,
						createdAt: new Date("2026-06-01T00:00:00Z"),
					},
					{
						id: "asgn-active-d-minus-1",
						policyId: replacementPol.id,
						assignmentType: "employee",
						teamId: null,
						employeeId: "emp-1",
						sourceKind: "manager_assignment",
						sourceEmploymentHistoryId: null,
						isActive: true,
						effectiveFrom: new Date("2026-06-09T00:00:00Z"),
						effectiveUntil: null,
						effectiveFromDate: "2026-06-09",
						effectiveUntilDate: null,
						priority: 2,
						createdAt: new Date("2026-06-10T10:00:00Z"),
					},
				],
			}),
		);
		expect(dMinus1ReplacementRes.workPolicy?.policyId).toBe(replacementPol.id);
	});
});
