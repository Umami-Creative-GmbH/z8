import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { organization } from "@/db/auth-schema";
import {
	contractDefault,
	contractTemplateVersion,
	contractTemplateVersionDay,
	employee,
	employeeEmploymentHistory,
	employeeEmploymentHistoryDay,
	employeeEmploymentPeriod,
	employeeTeamHistory,
	team,
	userSettings,
	workPolicy,
	workPolicyAssignment,
	workPolicyBreakOption,
	workPolicyBreakRule,
	workPolicyPresence,
	workPolicyRegulation,
	workPolicySchedule,
	workPolicyScheduleDay,
	workPolicyVersion,
} from "@/db/schema";
import type {
	ArbzgScope,
	BalanceMode,
	EmploymentProfile,
	OnCallHoursKind,
	PresenceOverride,
	ScheduleMode,
	ScheduleSource,
} from "@/db/schema/contract-types";
import {
	compareInstants,
	comparePlainDates,
	type Instant,
	instantFromDate,
	type PlainDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { termsCalendarDate } from "@/lib/employment-history/terms-in-force";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import type { ContractType } from "@/lib/validations/employee";
import {
	DAY_OF_WEEK_ORDER,
	distributeMinutesLargestRemainder,
	ISO_WEEKDAY_TO_DAY_OF_WEEK,
	normalizeHoursToMinutes,
	PRESET_WORK_DAYS,
	WEEKDAY_NAMES,
} from "./custom-days";
import type {
	ContractFieldSource,
	CustomWorkDay,
	DayOfWeek,
	EffectiveContractOnDay,
	EffectivePresenceStatus,
	ResolvedOnCallTerms,
	ResolvedScheduleDay,
	ResolvedWorkPolicyPresence,
	ResolvedWorkPolicyRegulation,
	ResolvedWorkPolicySchedule,
	ResolvedWorkPolicyVersion,
	WeeklyHoursMismatchWarning,
	WorkModel,
} from "./types";
import { resolveOperationalField, unwrapInherit } from "./unwrap-inherit";

/** Strictly read-only database handle: zero write methods permitted. */
export type ReadOnlyContractDb = Pick<typeof appDb, "select">;

const STATUTORY_ON_CALL_WEEKLY_MINUTES = 1200; // § 12 Abs. 1 Satz 3 TzBfG: 20h/week
const STATUTORY_ON_CALL_MIN_DAILY_MINUTES = 180; // § 12 Abs. 1 Satz 4 TzBfG: 3 consecutive hours

export interface EmploymentPeriodSnapshot {
	readonly id: string;
	readonly employeeId: string;
	readonly status: string;
	readonly startedAt: Instant | null;
	readonly startProvenance: string;
	readonly endedAt: Instant | null;
	readonly createdAt: Instant;
}

export interface TeamHistoryInterval {
	readonly id: string;
	readonly employeeId: string;
	readonly teamId: string;
	readonly effectiveFrom: Instant;
	readonly effectiveTo: Instant | null;
}

export interface EmploymentHistorySnapshot {
	readonly id: string;
	readonly employeeId: string;
	readonly employmentPeriodId: string | null;
	readonly validFrom: Date;
	readonly validUntil: Date | null;
	readonly validFromDate: string | null;
	readonly validUntilDate: string | null;
	readonly contractType: ContractType;
	readonly weeklyContractMinutes: number | null;
	readonly workModel: WorkModel | null;
	readonly workPolicyId: string | null;
	readonly scheduleMode: ScheduleMode | null;
	readonly presenceOverride: PresenceOverride | null;
	readonly balanceMode: BalanceMode | null;
	readonly scheduleSource: ScheduleSource | null;
	readonly employmentProfile: EmploymentProfile;
	readonly arbzgScope: ArbzgScope;
	readonly onCallHoursKind: OnCallHoursKind | null;
	readonly onCallWeeklyMinutes: number | null;
	readonly onCallDailyMinutes: number | null;
	readonly migratedLegacyTerms: boolean;
	readonly hourlyRate: number | null;
	readonly currency: string;
	readonly createdAt: Date;
	readonly customDays: readonly CustomWorkDay[];
}

export interface ContractDefaultSnapshot {
	readonly id: string;
	readonly scope: "organization" | "team";
	readonly teamId: string | null;
	readonly templateVersionId: string;
	readonly effectiveFromDate: string;
	readonly effectiveUntilDate: string | null;
	readonly createdAt: Date;
	readonly workPolicyId: string | null;
	readonly weeklyContractMinutes: number | null;
	readonly scheduleMode: Exclude<ScheduleMode, "inherit">;
	readonly workModel: WorkModel | null;
	readonly presenceOverride: PresenceOverride;
	readonly balanceMode: BalanceMode;
	readonly scheduleSource: ScheduleSource;
	readonly customDays: readonly CustomWorkDay[];
}

export interface PolicyAssignmentSnapshot {
	readonly id: string;
	readonly policyId: string;
	readonly assignmentType: "organization" | "team" | "employee";
	readonly teamId: string | null;
	readonly employeeId: string | null;
	readonly priority: number;
	readonly effectiveFrom: Date | null;
	readonly effectiveUntil: Date | null;
	readonly effectiveFromDate: string | null;
	readonly effectiveUntilDate: string | null;
	readonly createdAt: Date;
}

export interface WorkPolicyVersionSnapshot {
	readonly id: string;
	readonly policyId: string;
	readonly versionNumber: number;
	readonly effectiveFromDate: string;
	readonly scheduleEnabled: boolean;
	readonly regulationEnabled: boolean;
	readonly presenceEnabled: boolean;
	readonly schedule: ResolvedWorkPolicySchedule | null;
	readonly regulation: ResolvedWorkPolicyRegulation | null;
	readonly presence: ResolvedWorkPolicyPresence | null;
}

export interface WorkPolicySnapshot {
	readonly id: string;
	readonly name: string;
	readonly isActive: boolean;
	readonly scheduleEnabled: boolean;
	readonly regulationEnabled: boolean;
	readonly presenceEnabled: boolean;
	readonly versions: readonly WorkPolicyVersionSnapshot[];
}

export interface PureResolveContractInput {
	readonly date: PlainDate;
	/** Optional exact instant for legacy timestamp-bounded policy assignments. */
	readonly at?: Instant;
	readonly employeeId: string;
	readonly employeeContractType: ContractType;
	readonly employeeCalendarTimezone: string;
	readonly organizationTimezone: string;
	readonly employmentPeriods: readonly EmploymentPeriodSnapshot[];
	readonly teamHistory: readonly TeamHistoryInterval[];
	readonly validOrgTeamIds: ReadonlySet<string>;
	readonly foreignTeamIds: ReadonlySet<string>;
	readonly teamNames: ReadonlyMap<string, string>;
	readonly confirmedTerms: readonly EmploymentHistorySnapshot[];
	readonly contractDefaults: readonly ContractDefaultSnapshot[];
	readonly policyAssignments: readonly PolicyAssignmentSnapshot[];
	readonly policiesById: ReadonlyMap<string, WorkPolicySnapshot>;
}

function toPlainDate(date: PlainDate | string): PlainDate {
	return typeof date === "string" ? parsePlainDate(date) : date;
}

function parseFixedDays(raw: string | null): readonly DayOfWeek[] | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return null;
		const validSet = new Set<string>(DAY_OF_WEEK_ORDER);
		const days = parsed.filter(
			(value): value is DayOfWeek => typeof value === "string" && validSet.has(value),
		);
		return days;
	} catch {
		return null;
	}
}

/**
 * Resolves the active employment period for a calendar day in `employeeCalendarTimezone`.
 * Half-open `[startedAt, endedAt)`. On a same-day departure + rehire, deduplicates the
 * shared calendar date once by selecting the rehire stint active at end-of-day.
 */
export function resolveEmploymentPeriodForDay(
	periods: readonly EmploymentPeriodSnapshot[],
	day: PlainDate,
	employeeCalendarTimezone: string,
): {
	employmentPeriodId: string | null;
	period: EmploymentPeriodSnapshot | null;
	isEmployed: boolean;
} {
	if (periods.length === 0) {
		return { employmentPeriodId: null, period: null, isEmployed: true };
	}

	const dayStart = day.toZonedDateTime(employeeCalendarTimezone).toInstant();
	const nextDayStart = day.add({ days: 1 }).toZonedDateTime(employeeCalendarTimezone).toInstant();

	const intersecting = periods.filter((period) => {
		const effectiveStart =
			period.startProvenance === "recorded" && period.startedAt ? period.startedAt : null;
		const startsBeforeDayEnds =
			effectiveStart === null || compareInstants(effectiveStart, nextDayStart) < 0;
		const endsAfterDayStarts =
			period.endedAt === null || compareInstants(period.endedAt, dayStart) > 0;
		return startsBeforeDayEnds && endsAfterDayStarts;
	});

	if (intersecting.length === 0) {
		return { employmentPeriodId: null, period: null, isEmployed: false };
	}

	const sorted = [...intersecting].sort((left, right) => {
		const leftActiveAtEod =
			left.endedAt === null || compareInstants(left.endedAt, nextDayStart) >= 0 ? 1 : 0;
		const rightActiveAtEod =
			right.endedAt === null || compareInstants(right.endedAt, nextDayStart) >= 0 ? 1 : 0;
		if (rightActiveAtEod !== leftActiveAtEod) return rightActiveAtEod - leftActiveAtEod;

		const leftStart = left.startedAt?.epochNanoseconds ?? BigInt(-1);
		const rightStart = right.startedAt?.epochNanoseconds ?? BigInt(-1);
		if (rightStart > leftStart) return 1;
		if (rightStart < leftStart) return -1;

		const createdCmp = compareInstants(right.createdAt, left.createdAt);
		if (createdCmp !== 0) return createdCmp;
		return right.id.localeCompare(left.id);
	});

	const winner = sorted[0] ?? null;
	return {
		employmentPeriodId: winner?.id ?? null,
		period: winner,
		isEmployed: winner !== null,
	};
}

/**
 * Resolves the employee's primary team at 00:00 of `day` in `employeeCalendarTimezone`,
 * strictly honoring migration 0120's non-inference invariant (zero backward extrapolation
 * before `employee_team_history.effective_from`, half-open `[effective_from, effective_to)`,
 * and ignoring foreign-organization teams recorded between migrations 0120 and 0132).
 */
export function resolvePrimaryTeamAtDayStart(input: {
	teamHistory: readonly TeamHistoryInterval[];
	day: PlainDate;
	employeeCalendarTimezone: string;
	foreignTeamIds: ReadonlySet<string>;
}): string | null {
	const midnightInstant = input.day.toZonedDateTime(input.employeeCalendarTimezone).toInstant();

	const matching = input.teamHistory.filter((interval) => {
		if (input.foreignTeamIds.has(interval.teamId)) return false;
		if (compareInstants(interval.effectiveFrom, midnightInstant) > 0) return false;
		if (
			interval.effectiveTo !== null &&
			compareInstants(interval.effectiveTo, midnightInstant) <= 0
		) {
			return false;
		}
		return true;
	});

	if (matching.length === 0) return null;

	matching.sort((left, right) => {
		const cmp = compareInstants(right.effectiveFrom, left.effectiveFrom);
		if (cmp !== 0) return cmp;
		return right.id.localeCompare(left.id);
	});

	return matching[0]?.teamId ?? null;
}

function termsDateBounds(
	row: EmploymentHistorySnapshot,
	organizationTimezone: string,
): { from: PlainDate; until: PlainDate | null } {
	const from = row.validFromDate
		? parsePlainDate(row.validFromDate)
		: termsCalendarDate(row.validFrom, organizationTimezone);
	const until = row.validUntilDate
		? parsePlainDate(row.validUntilDate)
		: row.validUntil
			? termsCalendarDate(row.validUntil, organizationTimezone)
			: null;
	return { from, until };
}

function selectConfirmedTermsOnDate(
	rows: readonly EmploymentHistorySnapshot[],
	targetDate: PlainDate,
	organizationTimezone: string,
): EmploymentHistorySnapshot | null {
	const ordered = [...rows]
		.map((row) => ({ row, bounds: termsDateBounds(row, organizationTimezone) }))
		.filter(
			(entry) =>
				entry.bounds.until === null || comparePlainDates(entry.bounds.from, entry.bounds.until) < 0,
		)
		.sort((left, right) => {
			const fromCmp = comparePlainDates(left.bounds.from, right.bounds.from);
			if (fromCmp !== 0) return fromCmp;
			const createdCmp = left.row.createdAt.getTime() - right.row.createdAt.getTime();
			if (createdCmp !== 0) return createdCmp;
			return left.row.id.localeCompare(right.row.id);
		});

	const nonOverlapping = ordered.flatMap((entry, idx) => {
		const next = ordered[idx + 1];
		let until = entry.bounds.until;
		if (next) {
			if (until === null || comparePlainDates(next.bounds.from, until) < 0) {
				until = next.bounds.from;
			}
		}
		if (until !== null && comparePlainDates(entry.bounds.from, until) >= 0) {
			return [];
		}
		return [{ row: entry.row, from: entry.bounds.from, until }];
	});

	const found = nonOverlapping.find(
		(span) =>
			comparePlainDates(span.from, targetDate) <= 0 &&
			(span.until === null || comparePlainDates(targetDate, span.until) < 0),
	);
	return found?.row ?? null;
}

function selectConfirmedTermsForPeriodOnDay(input: {
	confirmedTerms: readonly EmploymentHistorySnapshot[];
	period: EmploymentPeriodSnapshot | null;
	day: PlainDate;
	employeeCalendarTimezone: string;
	organizationTimezone: string;
}): EmploymentHistorySnapshot | null {
	const { confirmedTerms, period, day, employeeCalendarTimezone, organizationTimezone } = input;
	if (confirmedTerms.length === 0) return null;

	const periodScoped = period
		? confirmedTerms.filter((row) => row.employmentPeriodId === period.id)
		: confirmedTerms;
	const candidateRows =
		periodScoped.length > 0
			? periodScoped
			: period
				? confirmedTerms.filter((row) => row.employmentPeriodId === null)
				: confirmedTerms;

	const direct = selectConfirmedTermsOnDate(candidateRows, day, organizationTimezone);
	if (direct) return direct;

	// Cross-timezone rehire opening day: when employeeTz lags behind orgTz, the stint's
	// recorded start instant falls on `day` in employeeTz and `day + 1` in orgTz.
	if (period && period.startProvenance === "recorded" && period.startedAt) {
		const startInEmpTz = plainDateAt(period.startedAt, employeeCalendarTimezone);
		const startInOrgTz = plainDateAt(period.startedAt, organizationTimezone);
		if (comparePlainDates(startInEmpTz, day) === 0 && comparePlainDates(startInOrgTz, day) > 0) {
			return selectConfirmedTermsOnDate(candidateRows, startInOrgTz, organizationTimezone);
		}
	}

	return null;
}

function selectContractDefaultOnDay(
	defaults: readonly ContractDefaultSnapshot[],
	scope: "organization" | "team",
	teamId: string | null,
	dayStr: string,
): ContractDefaultSnapshot | null {
	const matching = defaults.filter((row) => {
		if (row.scope !== scope) return false;
		if (scope === "team" && row.teamId !== teamId) return false;
		if (row.effectiveFromDate > dayStr) return false;
		if (row.effectiveUntilDate !== null && row.effectiveUntilDate <= dayStr) return false;
		return true;
	});

	if (matching.length === 0) return null;

	matching.sort((left, right) => {
		if (right.effectiveFromDate !== left.effectiveFromDate) {
			return right.effectiveFromDate.localeCompare(left.effectiveFromDate);
		}
		const createdCmp = right.createdAt.getTime() - left.createdAt.getTime();
		if (createdCmp !== 0) return createdCmp;
		return right.id.localeCompare(left.id);
	});

	return matching[0] ?? null;
}

function assignmentCoversDay(
	assignment: PolicyAssignmentSnapshot,
	day: PlainDate,
	dayStr: string,
	organizationTimezone: string,
	at?: Instant,
): boolean {
	if (
		at !== undefined &&
		(assignment.effectiveFrom !== null || assignment.effectiveUntil !== null)
	) {
		if (
			assignment.effectiveFrom !== null &&
			compareInstants(instantFromDate(assignment.effectiveFrom), at) > 0
		) {
			return false;
		}
		if (
			assignment.effectiveUntil !== null &&
			compareInstants(at, instantFromDate(assignment.effectiveUntil)) >= 0
		) {
			return false;
		}
		return true;
	}
	if (assignment.effectiveFromDate !== null) {
		if (assignment.effectiveFromDate > dayStr) return false;
		if (assignment.effectiveUntilDate !== null && assignment.effectiveUntilDate <= dayStr) {
			return false;
		}
		return true;
	}
	if (assignment.effectiveFrom !== null) {
		const fromDate = termsCalendarDate(assignment.effectiveFrom, organizationTimezone);
		if (comparePlainDates(fromDate, day) > 0) return false;
	}
	if (assignment.effectiveUntil !== null) {
		const untilDate = termsCalendarDate(assignment.effectiveUntil, organizationTimezone);
		if (comparePlainDates(day, untilDate) >= 0) return false;
	}
	return true;
}

function selectPolicyAssignmentAtLevel(input: {
	assignments: readonly PolicyAssignmentSnapshot[];
	policiesById: ReadonlyMap<string, WorkPolicySnapshot>;
	level: "employee" | "team" | "organization";
	employeeId: string;
	teamId: string | null;
	day: PlainDate;
	dayStr: string;
	organizationTimezone: string;
	at?: Instant;
}): PolicyAssignmentSnapshot | null {
	const matching = input.assignments.filter((row) => {
		if (row.assignmentType !== input.level) return false;
		if (input.level === "employee" && row.employeeId !== input.employeeId) return false;
		if (input.level === "team" && (input.teamId === null || row.teamId !== input.teamId)) {
			return false;
		}
		if (!assignmentCoversDay(row, input.day, input.dayStr, input.organizationTimezone, input.at)) {
			return false;
		}
		const policy = input.policiesById.get(row.policyId);
		return Boolean(policy?.isActive);
	});

	if (matching.length === 0) return null;

	matching.sort((left, right) => {
		const leftFrom = left.effectiveFromDate ?? "";
		const rightFrom = right.effectiveFromDate ?? "";
		if (rightFrom !== leftFrom) return rightFrom.localeCompare(leftFrom);
		const createdCmp = right.createdAt.getTime() - left.createdAt.getTime();
		if (createdCmp !== 0) return createdCmp;
		return right.id.localeCompare(left.id);
	});

	return matching[0] ?? null;
}

/**
 * Selects the active `work_policy_version` for `policy` on `dayStr` (`YYYY-MM-DD`),
 * ordered deterministically by `(effective_from_date DESC, version_number DESC)`.
 * Consumes `schedule_enabled`, `regulation_enabled`, and `presence_enabled` strictly
 * from that resolved version.
 */
export function selectActivePolicyVersionOnDay(
	policy: WorkPolicySnapshot,
	dayStr: string,
	assignmentMeta: {
		assignmentType: "organization" | "team" | "employee";
		assignmentId: string | null;
		assignedVia: string;
	},
): ResolvedWorkPolicyVersion | null {
	const eligibleVersions = policy.versions.filter((v) => v.effectiveFromDate <= dayStr);
	eligibleVersions.sort((left, right) => {
		if (right.effectiveFromDate !== left.effectiveFromDate) {
			return right.effectiveFromDate.localeCompare(left.effectiveFromDate);
		}
		return right.versionNumber - left.versionNumber;
	});

	const activeVersion = eligibleVersions[0];
	if (!activeVersion) return null;

	return {
		policyId: policy.id,
		policyName: policy.name,
		policyVersionId: activeVersion.id,
		versionNumber: activeVersion.versionNumber,
		effectiveFromDate: activeVersion.effectiveFromDate,
		scheduleEnabled: activeVersion.scheduleEnabled,
		regulationEnabled: activeVersion.regulationEnabled,
		presenceEnabled: activeVersion.presenceEnabled,
		schedule: activeVersion.scheduleEnabled ? activeVersion.schedule : null,
		regulation: activeVersion.regulationEnabled ? activeVersion.regulation : null,
		presence: activeVersion.presenceEnabled ? activeVersion.presence : null,
		assignmentType: assignmentMeta.assignmentType,
		assignmentId: assignmentMeta.assignmentId,
		assignedVia: assignmentMeta.assignedVia,
	};
}

function buildOnCallTerms(terms: EmploymentHistorySnapshot | null): ResolvedOnCallTerms | null {
	if (!terms || !terms.onCallHoursKind) return null;
	const hoursKind = terms.onCallHoursKind;
	const weeklyMinutes = terms.onCallWeeklyMinutes;
	const statutoryFallbackWeeklyMinutes =
		hoursKind === "unspecified" ? STATUTORY_ON_CALL_WEEKLY_MINUTES : null;

	let callInMinBandMinutes: number | null = null;
	let callInMaxBandMinutes: number | null = null;

	if (hoursKind === "unspecified") {
		callInMinBandMinutes = STATUTORY_ON_CALL_WEEKLY_MINUTES;
		callInMaxBandMinutes = STATUTORY_ON_CALL_WEEKLY_MINUTES;
	} else if (weeklyMinutes !== null) {
		if (hoursKind === "exact") {
			callInMinBandMinutes = weeklyMinutes;
			callInMaxBandMinutes = weeklyMinutes;
		} else if (hoursKind === "minimum") {
			callInMinBandMinutes = weeklyMinutes;
			callInMaxBandMinutes = Math.round(weeklyMinutes * 1.25);
		} else if (hoursKind === "maximum") {
			callInMinBandMinutes = Math.round(weeklyMinutes * 0.8);
			callInMaxBandMinutes = weeklyMinutes;
		}
	}

	return {
		hoursKind,
		weeklyMinutes,
		statutoryFallbackWeeklyMinutes,
		callInMinBandMinutes,
		callInMaxBandMinutes,
		dailyMinutes: terms.onCallDailyMinutes,
		statutoryMinDailyMinutes: STATUTORY_ON_CALL_MIN_DAILY_MINUTES,
	};
}

function getWorkDaysFromPolicySchedule(schedule: ResolvedWorkPolicySchedule): DayOfWeek[] {
	if (schedule.scheduleType === "detailed" || schedule.workingDaysPreset === "custom") {
		const workDays = schedule.days.filter((d) => d.isWorkDay && (d.cycleWeek ?? 1) === 1);
		const order = new Map(DAY_OF_WEEK_ORDER.map((day, idx) => [day, idx]));
		return workDays
			.map((d) => d.dayOfWeek)
			.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
	}
	return [...(PRESET_WORK_DAYS[schedule.workingDaysPreset] ?? WEEKDAY_NAMES)];
}

function buildSevenDayMap(
	workDays: readonly DayOfWeek[],
	minutesForWorkDays: readonly number[],
	latestClockIns?: ReadonlyMap<DayOfWeek, string | null>,
): ResolvedScheduleDay[] {
	const workDayIndex = new Map(workDays.map((day, index) => [day, index]));
	return DAY_OF_WEEK_ORDER.map((dayOfWeek) => {
		const idx = workDayIndex.get(dayOfWeek);
		const isWorkDay = idx !== undefined;
		const minutesPerDay = isWorkDay ? (minutesForWorkDays[idx] ?? 0) : 0;
		return {
			dayOfWeek,
			minutesPerDay,
			isWorkDay,
			latestClockIn: isWorkDay ? (latestClockIns?.get(dayOfWeek) ?? null) : null,
			cycleWeek: 1,
		};
	});
}

function emptyWeekSchedule(): ResolvedScheduleDay[] {
	return DAY_OF_WEEK_ORDER.map((dayOfWeek) => ({
		dayOfWeek,
		minutesPerDay: 0,
		isWorkDay: false,
		latestClockIn: null,
		cycleWeek: 1,
	}));
}

function resolveScheduleForWeek(input: {
	scheduleSource: ScheduleSource;
	scheduleMode: Exclude<ScheduleMode, "inherit">;
	scheduleModeSource: ContractFieldSource;
	customDays: readonly CustomWorkDay[];
	weeklyContractMinutes: number | null;
	weeklyContractMinutesSource: ContractFieldSource;
	workPolicy: ResolvedWorkPolicyVersion | null;
}): {
	weeklyScheduleDays: readonly ResolvedScheduleDay[];
	mismatchWarning: WeeklyHoursMismatchWarning | null;
} {
	if (input.scheduleSource !== "policy") {
		return { weeklyScheduleDays: emptyWeekSchedule(), mismatchWarning: null };
	}

	// 1. Explicit custom_days schedule mode (employee, team default, or org default)
	if (input.scheduleMode === "custom_days" && input.customDays.length > 0) {
		const byDay = new Map(input.customDays.map((d) => [d.dayOfWeek, d]));
		const weeklyScheduleDays = DAY_OF_WEEK_ORDER.map((dayOfWeek): ResolvedScheduleDay => {
			const row = byDay.get(dayOfWeek);
			if (!row || !row.isWorkDay) {
				return {
					dayOfWeek,
					minutesPerDay: 0,
					isWorkDay: false,
					latestClockIn: null,
					cycleWeek: 1,
				};
			}
			return {
				dayOfWeek,
				minutesPerDay: row.minutesPerDay,
				isWorkDay: true,
				latestClockIn: row.latestClockIn,
				cycleWeek: 1,
			};
		});
		return { weeklyScheduleDays, mismatchWarning: null };
	}

	const activePolicySchedule =
		input.workPolicy?.scheduleEnabled && input.workPolicy.schedule
			? input.workPolicy.schedule
			: null;

	// 2. hours_only mode: distribute weeklyContractMinutes across working days
	if (input.scheduleMode === "hours_only") {
		const targetMinutes =
			input.weeklyContractMinutes ?? activePolicySchedule?.normalizedCycleMinutes ?? 0;
		const workDays = activePolicySchedule
			? getWorkDaysFromPolicySchedule(activePolicySchedule)
			: [...WEEKDAY_NAMES];
		const distributed = distributeMinutesLargestRemainder(
			targetMinutes,
			workDays.map(() => 1),
		);
		return {
			weeklyScheduleDays: buildSevenDayMap(workDays, distributed),
			mismatchWarning: null,
		};
	}

	// 3. policy mode
	if (input.workPolicy) {
		// Active policy version explicitly controls scheduleEnabled
		if (!activePolicySchedule) {
			return { weeklyScheduleDays: emptyWeekSchedule(), mismatchWarning: null };
		}

		if (activePolicySchedule.scheduleType === "detailed") {
			const week1Days = activePolicySchedule.days.filter((d) => (d.cycleWeek ?? 1) === 1);
			const order = new Map(DAY_OF_WEEK_ORDER.map((day, idx) => [day, idx]));
			const sortedWorkDays = week1Days
				.filter((d) => d.isWorkDay)
				.sort((a, b) => (order.get(a.dayOfWeek) ?? 0) - (order.get(b.dayOfWeek) ?? 0));

			const workDayNames = sortedWorkDays.map((d) => d.dayOfWeek);
			const rawWeights = sortedWorkDays.map((d) => d.minutesPerDay);
			const policyDaySum = rawWeights.reduce((acc, m) => acc + m, 0);
			const latestClockIns = new Map(
				sortedWorkDays.map((d) => [d.dayOfWeek, d.latestClockIn] as const),
			);

			if (
				input.weeklyContractMinutesSource === "employee_override" &&
				input.weeklyContractMinutes !== null &&
				policyDaySum > 0 &&
				input.weeklyContractMinutes !== policyDaySum
			) {
				const scaled = distributeMinutesLargestRemainder(input.weeklyContractMinutes, rawWeights);
				return {
					weeklyScheduleDays: buildSevenDayMap(workDayNames, scaled, latestClockIns),
					mismatchWarning: {
						kind: "weekly_hours_policy_day_sum_mismatch",
						employeeWeeklyMinutes: input.weeklyContractMinutes,
						policyDetailedDaySumMinutes: policyDaySum,
						policyId: input.workPolicy.policyId,
						policyVersionId: input.workPolicy.policyVersionId,
					},
				};
			}

			return {
				weeklyScheduleDays: buildSevenDayMap(workDayNames, rawWeights, latestClockIns),
				mismatchWarning: null,
			};
		}

		// Simple policy schedule
		if (activePolicySchedule.scheduleCycle === "weekly") {
			const workDays = getWorkDaysFromPolicySchedule(activePolicySchedule);
			const targetMinutes =
				input.weeklyContractMinutes ?? activePolicySchedule.normalizedCycleMinutes ?? 0;
			const distributed = distributeMinutesLargestRemainder(
				targetMinutes,
				workDays.map(() => 1),
			);
			return {
				weeklyScheduleDays: buildSevenDayMap(workDays, distributed),
				mismatchWarning: null,
			};
		}

		// Daily simple schedule
		if (activePolicySchedule.scheduleCycle === "daily") {
			const workDays = getWorkDaysFromPolicySchedule(activePolicySchedule);
			const dailyMinutes = activePolicySchedule.normalizedCycleMinutes ?? 0;
			return {
				weeklyScheduleDays: buildSevenDayMap(
					workDays,
					workDays.map(() => dailyMinutes),
				),
				mismatchWarning: null,
			};
		}

		return { weeklyScheduleDays: emptyWeekSchedule(), mismatchWarning: null };
	}

	// 4. No work policy at all: fall back to weeklyContractMinutes (0 only after checking employee terms & defaults)
	if (input.weeklyContractMinutes !== null && input.weeklyContractMinutes > 0) {
		const distributed = distributeMinutesLargestRemainder(
			input.weeklyContractMinutes,
			WEEKDAY_NAMES.map(() => 1),
		);
		return {
			weeklyScheduleDays: buildSevenDayMap(WEEKDAY_NAMES, distributed),
			mismatchWarning: null,
		};
	}

	return { weeklyScheduleDays: emptyWeekSchedule(), mismatchWarning: null };
}

/**
 * Pure, strictly read-only contract resolution for one employee on one calendar day.
 */
export function resolveEffectiveContractPure(
	input: PureResolveContractInput,
): EffectiveContractOnDay {
	const day = input.date;
	const dayStr = day.toString();
	const dayOfWeek = ISO_WEEKDAY_TO_DAY_OF_WEEK[day.dayOfWeek] ?? "monday";

	// 1. Employment period & same-day rehire deduplication
	const { employmentPeriodId, period, isEmployed } = resolveEmploymentPeriodForDay(
		input.employmentPeriods,
		day,
		input.employeeCalendarTimezone,
	);

	// 2. Primary team at 00:00 in employee's calendar timezone (0120 non-inference invariant)
	const primaryTeamId = resolvePrimaryTeamAtDayStart({
		teamHistory: input.teamHistory,
		day,
		employeeCalendarTimezone: input.employeeCalendarTimezone,
		foreignTeamIds: input.foreignTeamIds,
	});

	// 3. Confirmed employee terms for the active stint (never leak across closed employment periods)
	const employeeTerms = isEmployed
		? selectConfirmedTermsForPeriodOnDay({
				confirmedTerms: input.confirmedTerms,
				period,
				day,
				employeeCalendarTimezone: input.employeeCalendarTimezone,
				organizationTimezone: input.organizationTimezone,
			})
		: null;

	// 4. Primary Team Default & Organization Default
	const teamDefault =
		primaryTeamId !== null
			? selectContractDefaultOnDay(input.contractDefaults, "team", primaryTeamId, dayStr)
			: null;
	const orgDefault = selectContractDefaultOnDay(
		input.contractDefaults,
		"organization",
		null,
		dayStr,
	);

	// 5. Work policy resolution:
	// Employee confirmed terms workPolicyId -> Employee work_policy_assignment -> Primary Team Default (or team assignment) -> Org Default (or org assignment) -> null
	let workPolicyResolved: ResolvedWorkPolicyVersion | null = null;
	let workPolicySource: ContractFieldSource = "default";

	if (employeeTerms?.workPolicyId) {
		const policy = input.policiesById.get(employeeTerms.workPolicyId);
		if (policy) {
			workPolicyResolved = selectActivePolicyVersionOnDay(policy, dayStr, {
				assignmentType: "employee",
				assignmentId: null,
				assignedVia: "Contract override",
			});
			if (workPolicyResolved) workPolicySource = "employee_override";
		}
	}

	if (!workPolicyResolved && isEmployed) {
		const empAssignment = selectPolicyAssignmentAtLevel({
			assignments: input.policyAssignments,
			policiesById: input.policiesById,
			level: "employee",
			employeeId: input.employeeId,
			teamId: primaryTeamId,
			day,
			dayStr,
			organizationTimezone: input.organizationTimezone,
			at: input.at,
		});
		if (empAssignment) {
			const policy = input.policiesById.get(empAssignment.policyId);
			if (policy) {
				workPolicyResolved = selectActivePolicyVersionOnDay(policy, dayStr, {
					assignmentType: "employee",
					assignmentId: empAssignment.id,
					assignedVia: "Individual",
				});
				if (workPolicyResolved) workPolicySource = "employee_override";
			}
		}
	}

	if (!workPolicyResolved && teamDefault?.workPolicyId) {
		const policy = input.policiesById.get(teamDefault.workPolicyId);
		if (policy?.isActive) {
			workPolicyResolved = selectActivePolicyVersionOnDay(policy, dayStr, {
				assignmentType: "team",
				assignmentId: null,
				assignedVia: (primaryTeamId ? input.teamNames.get(primaryTeamId) : null) ?? "Team",
			});
			if (workPolicyResolved) workPolicySource = "team_default";
		}
	}

	if (!workPolicyResolved && primaryTeamId !== null) {
		const teamAssignment = selectPolicyAssignmentAtLevel({
			assignments: input.policyAssignments,
			policiesById: input.policiesById,
			level: "team",
			employeeId: input.employeeId,
			teamId: primaryTeamId,
			day,
			dayStr,
			organizationTimezone: input.organizationTimezone,
			at: input.at,
		});
		if (teamAssignment) {
			const policy = input.policiesById.get(teamAssignment.policyId);
			if (policy) {
				workPolicyResolved = selectActivePolicyVersionOnDay(policy, dayStr, {
					assignmentType: "team",
					assignmentId: teamAssignment.id,
					assignedVia: input.teamNames.get(primaryTeamId) ?? "Team",
				});
				if (workPolicyResolved) workPolicySource = "team_default";
			}
		}
	}

	if (!workPolicyResolved && orgDefault?.workPolicyId) {
		const policy = input.policiesById.get(orgDefault.workPolicyId);
		if (policy?.isActive) {
			workPolicyResolved = selectActivePolicyVersionOnDay(policy, dayStr, {
				assignmentType: "organization",
				assignmentId: null,
				assignedVia: "Organization Default",
			});
			if (workPolicyResolved) workPolicySource = "org_default";
		}
	}

	if (!workPolicyResolved) {
		const orgAssignment = selectPolicyAssignmentAtLevel({
			assignments: input.policyAssignments,
			policiesById: input.policiesById,
			level: "organization",
			employeeId: input.employeeId,
			teamId: primaryTeamId,
			day,
			dayStr,
			organizationTimezone: input.organizationTimezone,
			at: input.at,
		});
		if (orgAssignment) {
			const policy = input.policiesById.get(orgAssignment.policyId);
			if (policy) {
				workPolicyResolved = selectActivePolicyVersionOnDay(policy, dayStr, {
					assignmentType: "organization",
					assignmentId: orgAssignment.id,
					assignedVia: "Organization Default",
				});
				if (workPolicyResolved) workPolicySource = "org_default";
			}
		}
	}

	// 6. Operational fields with explicit `'inherit'` sentinel unwrapping
	const weeklyMinutesRes = resolveOperationalField<number | null>({
		employee: employeeTerms?.weeklyContractMinutes ?? null,
		team: teamDefault?.weeklyContractMinutes ?? null,
		org: orgDefault?.weeklyContractMinutes ?? null,
		fallback: null,
	});

	const scheduleModeRes = resolveOperationalField<Exclude<ScheduleMode, "inherit">>({
		employee: unwrapInherit(employeeTerms?.scheduleMode),
		team: unwrapInherit(teamDefault?.scheduleMode),
		org: unwrapInherit(orgDefault?.scheduleMode),
		fallback: "policy",
	});

	const workModelRes = resolveOperationalField<WorkModel | null>({
		employee: employeeTerms?.workModel ?? null,
		team: teamDefault?.workModel ?? null,
		org: orgDefault?.workModel ?? null,
		fallback: null,
	});

	const presenceOverrideRes = resolveOperationalField<PresenceOverride>({
		employee: unwrapInherit(employeeTerms?.presenceOverride),
		team: unwrapInherit(teamDefault?.presenceOverride),
		org: unwrapInherit(orgDefault?.presenceOverride),
		fallback: "inherit",
	});

	const balanceModeRes = resolveOperationalField<BalanceMode>({
		employee: employeeTerms?.balanceMode ?? null,
		team: teamDefault?.balanceMode ?? null,
		org: orgDefault?.balanceMode ?? null,
		fallback: "tracked",
	});

	const scheduleSourceRes = resolveOperationalField<ScheduleSource>({
		employee: employeeTerms?.scheduleSource ?? null,
		team: teamDefault?.scheduleSource ?? null,
		org: orgDefault?.scheduleSource ?? null,
		fallback: "policy",
	});

	// 7. Presence requirement (remote defaults to exempt unless explicitly overridden)
	let presenceStatus: EffectivePresenceStatus;
	let effectivePresence: ResolvedWorkPolicyPresence | null;
	if (!workPolicyResolved?.presenceEnabled || !workPolicyResolved.presence) {
		presenceStatus = "not_configured";
		effectivePresence = null;
	} else if (presenceOverrideRes.value === "exempt") {
		presenceStatus = "exempt";
		effectivePresence = null;
	} else if (presenceOverrideRes.value === "require_onsite") {
		presenceStatus = "required";
		effectivePresence = workPolicyResolved.presence;
	} else if (workModelRes.value === "remote") {
		presenceStatus = "exempt";
		effectivePresence = null;
	} else {
		presenceStatus = "required";
		effectivePresence = workPolicyResolved.presence;
	}

	// 8. Select custom days matching the winning scheduleMode source
	const activeCustomDays =
		scheduleModeRes.source === "employee_override"
			? (employeeTerms?.customDays ?? [])
			: scheduleModeRes.source === "team_default"
				? (teamDefault?.customDays ?? [])
				: scheduleModeRes.source === "org_default"
					? (orgDefault?.customDays ?? [])
					: [];

	// 9. Resolve weekly schedule & daily required minutes
	const { weeklyScheduleDays, mismatchWarning } = resolveScheduleForWeek({
		scheduleSource: scheduleSourceRes.value,
		scheduleMode: scheduleModeRes.value,
		scheduleModeSource: scheduleModeRes.source,
		customDays: activeCustomDays,
		weeklyContractMinutes: weeklyMinutesRes.value,
		weeklyContractMinutesSource: weeklyMinutesRes.source,
		workPolicy: workPolicyResolved,
	});

	const resolvedDay = weeklyScheduleDays.find((d) => d.dayOfWeek === dayOfWeek);
	const isWorkDay = isEmployed && Boolean(resolvedDay?.isWorkDay);
	const requiredMinutes = isEmployed ? (resolvedDay?.minutesPerDay ?? 0) : 0;
	const latestClockIn = isWorkDay ? (resolvedDay?.latestClockIn ?? null) : null;

	// 10. Active contract default metadata
	const winningDefault = teamDefault ?? orgDefault;

	return {
		date: dayStr,
		dayOfWeek,
		calendarTimezone: input.employeeCalendarTimezone,
		employeeId: input.employeeId,
		employmentPeriodId,
		isEmployedOnDay: isEmployed,
		primaryTeamId,
		employmentHistoryId: employeeTerms?.id ?? null,
		contractDefaultId: winningDefault?.id ?? null,
		contractDefaultScope: winningDefault?.scope ?? null,

		workPolicy: workPolicyResolved,
		workPolicySource,
		weeklyContractMinutes: weeklyMinutesRes.value,
		weeklyContractMinutesSource: weeklyMinutesRes.source,
		scheduleMode: scheduleModeRes.value,
		scheduleModeSource: scheduleModeRes.source,
		workModel: workModelRes.value,
		workModelSource: workModelRes.source,
		presenceOverride: presenceOverrideRes.value,
		presenceOverrideSource: presenceOverrideRes.source,
		presenceStatus,
		effectivePresence,
		balanceMode: balanceModeRes.value,
		balanceModeSource: balanceModeRes.source,
		scheduleSource: scheduleSourceRes.value,
		scheduleSourceSource: scheduleSourceRes.source,

		isWorkDay,
		requiredMinutes,
		contributesZeroBalanceDelta: balanceModeRes.value === "trust_based",
		latestClockIn,
		weeklyScheduleDays,
		mismatchWarning,

		contractType: employeeTerms?.contractType ?? input.employeeContractType,
		hourlyRate: employeeTerms?.hourlyRate ?? null,
		currency: employeeTerms?.currency ?? "EUR",
		employmentProfile: employeeTerms?.employmentProfile ?? "regular",
		arbzgScope: employeeTerms?.arbzgScope ?? "standard",
		onCallTerms: scheduleSourceRes.value === "on_call" ? buildOnCallTerms(employeeTerms) : null,
		migratedLegacyTerms: employeeTerms?.migratedLegacyTerms ?? false,
	};
}

/**
 * Strictly read-only batch contract resolver for many employees across many calendar dates.
 * Performs zero database writes and loads all policy versions, defaults, employment periods,
 * confirmed terms, custom working days, and team history in bulk.
 */
export async function loadEffectiveContractsBatch(
	db: ReadOnlyContractDb,
	input: {
		organizationId: string;
		employeeIds: readonly string[];
		dates: readonly (PlainDate | string)[];
		timezoneOverride?: string;
		at?: Instant;
	},
): Promise<Map<string, Map<string, EffectiveContractOnDay>>> {
	const result = new Map<string, Map<string, EffectiveContractOnDay>>();
	const uniqueEmployeeIds = [...new Set(input.employeeIds)];
	const uniqueDates = [
		...new Map(
			input.dates.map((d) => {
				const pd = toPlainDate(d);
				return [pd.toString(), pd] as const;
			}),
		).values(),
	];

	if (uniqueEmployeeIds.length === 0 || uniqueDates.length === 0) {
		return result;
	}

	// 1. Organization timezone + employees + user timezone settings
	const [
		[orgRow],
		employeeRows,
		periodRows,
		teamHistoryRows,
		termsRows,
		defaultRows,
		assignmentRows,
	] = await Promise.all([
		db
			.select({ timezone: organization.timezone })
			.from(organization)
			.where(eq(organization.id, input.organizationId))
			.limit(1),
		db
			.select({
				id: employee.id,
				userId: employee.userId,
				contractType: employee.contractType,
				userTimezone: userSettings.timezone,
			})
			.from(employee)
			.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
			.where(
				and(
					eq(employee.organizationId, input.organizationId),
					inArray(employee.id, uniqueEmployeeIds),
				),
			),
		db
			.select({
				id: employeeEmploymentPeriod.id,
				employeeId: employeeEmploymentPeriod.employeeId,
				status: employeeEmploymentPeriod.status,
				startedAt: employeeEmploymentPeriod.startedAt,
				startProvenance: employeeEmploymentPeriod.startProvenance,
				endedAt: employeeEmploymentPeriod.endedAt,
				createdAt: employeeEmploymentPeriod.createdAt,
			})
			.from(employeeEmploymentPeriod)
			.where(
				and(
					eq(employeeEmploymentPeriod.organizationId, input.organizationId),
					inArray(employeeEmploymentPeriod.employeeId, uniqueEmployeeIds),
				),
			),
		db
			.select({
				id: employeeTeamHistory.id,
				employeeId: employeeTeamHistory.employeeId,
				teamId: employeeTeamHistory.teamId,
				effectiveFrom: employeeTeamHistory.effectiveFrom,
				effectiveTo: employeeTeamHistory.effectiveTo,
			})
			.from(employeeTeamHistory)
			.where(
				and(
					eq(employeeTeamHistory.organizationId, input.organizationId),
					inArray(employeeTeamHistory.employeeId, uniqueEmployeeIds),
				),
			),
		db
			.select()
			.from(employeeEmploymentHistory)
			.where(
				and(
					eq(employeeEmploymentHistory.organizationId, input.organizationId),
					inArray(employeeEmploymentHistory.employeeId, uniqueEmployeeIds),
					eq(employeeEmploymentHistory.reviewState, "confirmed"),
				),
			)
			.orderBy(asc(employeeEmploymentHistory.validFrom), asc(employeeEmploymentHistory.createdAt)),
		db
			.select({
				id: contractDefault.id,
				scope: contractDefault.scope,
				teamId: contractDefault.teamId,
				templateVersionId: contractDefault.templateVersionId,
				effectiveFromDate: contractDefault.effectiveFromDate,
				effectiveUntilDate: contractDefault.effectiveUntilDate,
				createdAt: contractDefault.createdAt,
				workPolicyId: contractTemplateVersion.workPolicyId,
				weeklyContractMinutes: contractTemplateVersion.weeklyContractMinutes,
				scheduleMode: contractTemplateVersion.scheduleMode,
				workModel: contractTemplateVersion.workModel,
				presenceOverride: contractTemplateVersion.presenceOverride,
				balanceMode: contractTemplateVersion.balanceMode,
				scheduleSource: contractTemplateVersion.scheduleSource,
			})
			.from(contractDefault)
			.innerJoin(
				contractTemplateVersion,
				and(
					eq(contractTemplateVersion.id, contractDefault.templateVersionId),
					eq(contractTemplateVersion.organizationId, contractDefault.organizationId),
				),
			)
			.where(
				and(
					eq(contractDefault.organizationId, input.organizationId),
					eq(contractDefault.isActive, true),
				),
			),
		db
			.select({
				id: workPolicyAssignment.id,
				policyId: workPolicyAssignment.policyId,
				assignmentType: workPolicyAssignment.assignmentType,
				teamId: workPolicyAssignment.teamId,
				employeeId: workPolicyAssignment.employeeId,
				priority: workPolicyAssignment.priority,
				effectiveFrom: workPolicyAssignment.effectiveFrom,
				effectiveUntil: workPolicyAssignment.effectiveUntil,
				effectiveFromDate: workPolicyAssignment.effectiveFromDate,
				effectiveUntilDate: workPolicyAssignment.effectiveUntilDate,
				createdAt: workPolicyAssignment.createdAt,
			})
			.from(workPolicyAssignment)
			.where(
				and(
					eq(workPolicyAssignment.organizationId, input.organizationId),
					eq(workPolicyAssignment.isActive, true),
					or(
						eq(workPolicyAssignment.assignmentType, "organization"),
						eq(workPolicyAssignment.assignmentType, "team"),
						and(
							eq(workPolicyAssignment.assignmentType, "employee"),
							inArray(workPolicyAssignment.employeeId, uniqueEmployeeIds),
						),
					),
				),
			),
	]);

	const orgTimezone = orgRow?.timezone ?? "UTC";

	// 2. Load custom working days, referenced team ownership (guarding 0120-0132 foreign teams), and work policy versions
	const historyIds = termsRows.map((row) => row.id);
	const templateVersionIds = [...new Set(defaultRows.map((row) => row.templateVersionId))];
	const allReferencedTeamIds = [
		...new Set([
			...teamHistoryRows.map((row) => row.teamId),
			...defaultRows.flatMap((row) => (row.teamId ? [row.teamId] : [])),
			...assignmentRows.flatMap((row) => (row.teamId ? [row.teamId] : [])),
		]),
	];
	const allReferencedPolicyIds = [
		...new Set([
			...termsRows.flatMap((row) => (row.workPolicyId ? [row.workPolicyId] : [])),
			...defaultRows.flatMap((row) => (row.workPolicyId ? [row.workPolicyId] : [])),
			...assignmentRows.map((row) => row.policyId),
		]),
	];

	const [historyDayRows, templateDayRows, referencedTeams, policyRows, versionRows] =
		await Promise.all([
			historyIds.length > 0
				? db
						.select()
						.from(employeeEmploymentHistoryDay)
						.where(
							and(
								eq(employeeEmploymentHistoryDay.organizationId, input.organizationId),
								inArray(employeeEmploymentHistoryDay.employmentHistoryId, historyIds),
							),
						)
				: Promise.resolve([]),
			templateVersionIds.length > 0
				? db
						.select()
						.from(contractTemplateVersionDay)
						.where(
							and(
								eq(contractTemplateVersionDay.organizationId, input.organizationId),
								inArray(contractTemplateVersionDay.templateVersionId, templateVersionIds),
							),
						)
				: Promise.resolve([]),
			allReferencedTeamIds.length > 0
				? db
						.select({ id: team.id, organizationId: team.organizationId, name: team.name })
						.from(team)
						.where(inArray(team.id, allReferencedTeamIds))
				: Promise.resolve([]),
			allReferencedPolicyIds.length > 0
				? db
						.select()
						.from(workPolicy)
						.where(
							and(
								eq(workPolicy.organizationId, input.organizationId),
								inArray(workPolicy.id, allReferencedPolicyIds),
							),
						)
				: Promise.resolve([]),
			allReferencedPolicyIds.length > 0
				? db
						.select()
						.from(workPolicyVersion)
						.where(
							and(
								eq(workPolicyVersion.organizationId, input.organizationId),
								inArray(workPolicyVersion.policyId, allReferencedPolicyIds),
							),
						)
				: Promise.resolve([]),
		]);

	const versionIds = versionRows.map((row) => row.id);
	const [scheduleRows, regulationRows, presenceRows] = await Promise.all([
		versionIds.length > 0
			? db
					.select()
					.from(workPolicySchedule)
					.where(inArray(workPolicySchedule.policyVersionId, versionIds))
			: Promise.resolve([]),
		versionIds.length > 0
			? db
					.select()
					.from(workPolicyRegulation)
					.where(inArray(workPolicyRegulation.policyVersionId, versionIds))
			: Promise.resolve([]),
		versionIds.length > 0
			? db
					.select()
					.from(workPolicyPresence)
					.where(inArray(workPolicyPresence.policyVersionId, versionIds))
			: Promise.resolve([]),
	]);

	// 3. Load grandchildren (schedule days, break rules, break options)
	const scheduleIds = scheduleRows.map((row) => row.id);
	const regulationIds = regulationRows.map((row) => row.id);

	const [scheduleDayRows, breakRuleRows] = await Promise.all([
		scheduleIds.length > 0
			? db
					.select()
					.from(workPolicyScheduleDay)
					.where(inArray(workPolicyScheduleDay.scheduleId, scheduleIds))
			: Promise.resolve([]),
		regulationIds.length > 0
			? db
					.select()
					.from(workPolicyBreakRule)
					.where(inArray(workPolicyBreakRule.regulationId, regulationIds))
			: Promise.resolve([]),
	]);

	const breakRuleIds = breakRuleRows.map((row) => row.id);
	const breakOptionRows =
		breakRuleIds.length > 0
			? await db
					.select()
					.from(workPolicyBreakOption)
					.where(inArray(workPolicyBreakOption.breakRuleId, breakRuleIds))
			: [];

	// 4. Index loaded rows in memory
	const validOrgTeamIds = new Set<string>();
	const foreignTeamIds = new Set<string>();
	const teamNames = new Map<string, string>();
	for (const t of referencedTeams) {
		if (t.organizationId === input.organizationId) {
			validOrgTeamIds.add(t.id);
			teamNames.set(t.id, t.name);
		} else {
			foreignTeamIds.add(t.id);
		}
	}

	const historyDaysByHistoryId = new Map<string, CustomWorkDay[]>();
	for (const row of historyDayRows) {
		const list = historyDaysByHistoryId.get(row.employmentHistoryId) ?? [];
		list.push({
			dayOfWeek: row.dayOfWeek,
			minutesPerDay: row.minutesPerDay,
			isWorkDay: row.isWorkDay,
			latestClockIn: row.latestClockIn,
		});
		historyDaysByHistoryId.set(row.employmentHistoryId, list);
	}

	const templateDaysByVersionId = new Map<string, CustomWorkDay[]>();
	for (const row of templateDayRows) {
		const list = templateDaysByVersionId.get(row.templateVersionId) ?? [];
		list.push({
			dayOfWeek: row.dayOfWeek,
			minutesPerDay: row.minutesPerDay,
			isWorkDay: row.isWorkDay,
			latestClockIn: row.latestClockIn,
		});
		templateDaysByVersionId.set(row.templateVersionId, list);
	}

	const scheduleDaysByScheduleId = new Map<string, typeof scheduleDayRows>();
	for (const row of scheduleDayRows) {
		const list = scheduleDaysByScheduleId.get(row.scheduleId) ?? [];
		list.push(row);
		scheduleDaysByScheduleId.set(row.scheduleId, list);
	}

	const breakOptionsByRuleId = new Map<string, typeof breakOptionRows>();
	for (const row of breakOptionRows) {
		const list = breakOptionsByRuleId.get(row.breakRuleId) ?? [];
		list.push(row);
		breakOptionsByRuleId.set(row.breakRuleId, list);
	}

	const breakRulesByRegulationId = new Map<string, typeof breakRuleRows>();
	for (const row of breakRuleRows) {
		const list = breakRulesByRegulationId.get(row.regulationId) ?? [];
		list.push(row);
		breakRulesByRegulationId.set(row.regulationId, list);
	}

	const scheduleByVersionId = new Map<string, ResolvedWorkPolicySchedule>();
	const legacyScheduleByPolicyId = new Map<string, ResolvedWorkPolicySchedule>();
	for (const row of scheduleRows) {
		const days = (scheduleDaysByScheduleId.get(row.id) ?? []).map((day) => ({
			dayOfWeek: day.dayOfWeek,
			hoursPerDay: day.hoursPerDay,
			minutesPerDay: normalizeHoursToMinutes(day.hoursPerDay) ?? 0,
			isWorkDay: day.isWorkDay,
			cycleWeek: day.cycleWeek ?? 1,
			latestClockIn: day.latestClockIn ?? null,
		}));
		const resolved: ResolvedWorkPolicySchedule = {
			id: row.id,
			scheduleCycle: row.scheduleCycle,
			scheduleType: row.scheduleType,
			workingDaysPreset: row.workingDaysPreset,
			hoursPerCycle: row.hoursPerCycle,
			normalizedCycleMinutes: normalizeHoursToMinutes(row.hoursPerCycle),
			homeOfficeDaysPerCycle: row.homeOfficeDaysPerCycle ?? 0,
			days,
		};
		if (row.policyVersionId) {
			scheduleByVersionId.set(row.policyVersionId, resolved);
		} else {
			legacyScheduleByPolicyId.set(row.policyId, resolved);
		}
	}

	const regulationByVersionId = new Map<string, ResolvedWorkPolicyRegulation>();
	const legacyRegulationByPolicyId = new Map<string, ResolvedWorkPolicyRegulation>();
	for (const row of regulationRows) {
		const rules = (breakRulesByRegulationId.get(row.id) ?? [])
			.sort((a, b) => a.sortOrder - b.sortOrder)
			.map((rule) => ({
				id: rule.id,
				workingMinutesThreshold: rule.workingMinutesThreshold,
				requiredBreakMinutes: rule.requiredBreakMinutes,
				options: (breakOptionsByRuleId.get(rule.id) ?? [])
					.sort((a, b) => a.sortOrder - b.sortOrder)
					.map((opt) => ({
						splitCount: opt.splitCount,
						minimumSplitMinutes: opt.minimumSplitMinutes,
						minimumLongestSplitMinutes: opt.minimumLongestSplitMinutes,
					})),
			}));
		const resolved: ResolvedWorkPolicyRegulation = {
			id: row.id,
			maxDailyMinutes: row.maxDailyMinutes,
			maxWeeklyMinutes: row.maxWeeklyMinutes,
			maxUninterruptedMinutes: row.maxUninterruptedMinutes,
			minRestPeriodMinutes: row.minRestPeriodMinutes,
			restPeriodEnforcement: row.restPeriodEnforcement ?? "warn",
			overtimeDailyThresholdMinutes: row.overtimeDailyThresholdMinutes,
			overtimeWeeklyThresholdMinutes: row.overtimeWeeklyThresholdMinutes,
			overtimeMonthlyThresholdMinutes: row.overtimeMonthlyThresholdMinutes,
			alertBeforeLimitMinutes: row.alertBeforeLimitMinutes ?? 30,
			alertThresholdPercent: row.alertThresholdPercent ?? 80,
			breakRules: rules,
		};
		if (row.policyVersionId) {
			regulationByVersionId.set(row.policyVersionId, resolved);
		} else {
			legacyRegulationByPolicyId.set(row.policyId, resolved);
		}
	}

	const presenceByVersionId = new Map<string, ResolvedWorkPolicyPresence>();
	const legacyPresenceByPolicyId = new Map<string, ResolvedWorkPolicyPresence>();
	for (const row of presenceRows) {
		const resolved: ResolvedWorkPolicyPresence = {
			id: row.id,
			presenceMode: row.presenceMode,
			requiredOnsiteDays: row.requiredOnsiteDays,
			requiredOnsiteFixedDays: parseFixedDays(row.requiredOnsiteFixedDays),
			locationId: row.locationId,
			evaluationPeriod: row.evaluationPeriod,
			enforcement: row.enforcement,
		};
		if (row.policyVersionId) {
			presenceByVersionId.set(row.policyVersionId, resolved);
		} else {
			legacyPresenceByPolicyId.set(row.policyId, resolved);
		}
	}

	const versionsByPolicyId = new Map<string, WorkPolicyVersionSnapshot[]>();
	for (const v of versionRows) {
		const list = versionsByPolicyId.get(v.policyId) ?? [];
		list.push({
			id: v.id,
			policyId: v.policyId,
			versionNumber: v.versionNumber,
			effectiveFromDate: v.effectiveFromDate,
			scheduleEnabled: v.scheduleEnabled,
			regulationEnabled: v.regulationEnabled,
			presenceEnabled: v.presenceEnabled,
			schedule:
				scheduleByVersionId.get(v.id) ??
				(v.versionNumber === 1 ? (legacyScheduleByPolicyId.get(v.policyId) ?? null) : null),
			regulation:
				regulationByVersionId.get(v.id) ??
				(v.versionNumber === 1 ? (legacyRegulationByPolicyId.get(v.policyId) ?? null) : null),
			presence:
				presenceByVersionId.get(v.id) ??
				(v.versionNumber === 1 ? (legacyPresenceByPolicyId.get(v.policyId) ?? null) : null),
		});
		versionsByPolicyId.set(v.policyId, list);
	}

	const policiesById = new Map<string, WorkPolicySnapshot>();
	for (const p of policyRows) {
		policiesById.set(p.id, {
			id: p.id,
			name: p.name,
			isActive: p.isActive,
			scheduleEnabled: p.scheduleEnabled,
			regulationEnabled: p.regulationEnabled,
			presenceEnabled: p.presenceEnabled,
			versions: versionsByPolicyId.get(p.id) ?? [],
		});
	}

	const defaultsSnapshots: ContractDefaultSnapshot[] = defaultRows.map((row) => ({
		...row,
		customDays: templateDaysByVersionId.get(row.templateVersionId) ?? [],
	}));

	const periodsByEmployee = new Map<string, EmploymentPeriodSnapshot[]>();
	for (const p of periodRows) {
		const list = periodsByEmployee.get(p.employeeId) ?? [];
		list.push({
			id: p.id,
			employeeId: p.employeeId,
			status: p.status,
			startedAt: p.startedAt ? instantFromDate(p.startedAt) : null,
			startProvenance: p.startProvenance,
			endedAt: p.endedAt ? instantFromDate(p.endedAt) : null,
			createdAt: instantFromDate(p.createdAt),
		});
		periodsByEmployee.set(p.employeeId, list);
	}

	const teamHistoryByEmployee = new Map<string, TeamHistoryInterval[]>();
	for (const row of teamHistoryRows) {
		const list = teamHistoryByEmployee.get(row.employeeId) ?? [];
		list.push({
			id: row.id,
			employeeId: row.employeeId,
			teamId: row.teamId,
			effectiveFrom: instantFromDate(row.effectiveFrom),
			effectiveTo: row.effectiveTo ? instantFromDate(row.effectiveTo) : null,
		});
		teamHistoryByEmployee.set(row.employeeId, list);
	}

	const termsByEmployee = new Map<string, EmploymentHistorySnapshot[]>();
	for (const row of termsRows) {
		const list = termsByEmployee.get(row.employeeId) ?? [];
		list.push({
			id: row.id,
			employeeId: row.employeeId,
			employmentPeriodId: row.employmentPeriodId,
			validFrom: row.validFrom,
			validUntil: row.validUntil,
			validFromDate: row.validFromDate,
			validUntilDate: row.validUntilDate,
			contractType: row.contractType,
			weeklyContractMinutes: row.weeklyContractMinutes ?? null,
			workModel: row.workModel ?? null,
			workPolicyId: row.workPolicyId,
			scheduleMode: row.scheduleMode,
			presenceOverride: row.presenceOverride,
			balanceMode: row.balanceMode,
			scheduleSource: row.scheduleSource,
			employmentProfile: row.employmentProfile,
			arbzgScope: row.arbzgScope,
			onCallHoursKind: row.onCallHoursKind,
			onCallWeeklyMinutes: row.onCallWeeklyMinutes,
			onCallDailyMinutes: row.onCallDailyMinutes,
			migratedLegacyTerms: row.migratedLegacyTerms,
			hourlyRate: row.hourlyRate,
			currency: row.currency,
			createdAt: row.createdAt,
			customDays: historyDaysByHistoryId.get(row.id) ?? [],
		});
		termsByEmployee.set(row.employeeId, list);
	}

	// 5. Resolve per employee x date
	for (const emp of employeeRows) {
		const empCalendarTz =
			input.timezoneOverride ?? resolveEffectiveTimezone(emp.userTimezone, orgTimezone);
		const perDate = new Map<string, EffectiveContractOnDay>();
		const empPeriods = periodsByEmployee.get(emp.id) ?? [];
		const empTeamHistory = teamHistoryByEmployee.get(emp.id) ?? [];
		const empTerms = termsByEmployee.get(emp.id) ?? [];

		for (const day of uniqueDates) {
			const resolved = resolveEffectiveContractPure({
				date: day,
				at: input.at,
				employeeId: emp.id,
				employeeContractType: emp.contractType,
				employeeCalendarTimezone: empCalendarTz,
				organizationTimezone: orgTimezone,
				employmentPeriods: empPeriods,
				teamHistory: empTeamHistory,
				validOrgTeamIds,
				foreignTeamIds,
				teamNames,
				confirmedTerms: empTerms,
				contractDefaults: defaultsSnapshots,
				policyAssignments: assignmentRows,
				policiesById,
			});
			perDate.set(day.toString(), resolved);
		}
		result.set(emp.id, perDate);
	}

	return result;
}

/**
 * Strictly read-only contract resolver for a single employee on a single calendar date.
 * Delegates to `loadEffectiveContractsBatch` so single and batched reads cannot diverge.
 */
export async function resolveEffectiveContractOnDay(
	db: ReadOnlyContractDb,
	input: {
		organizationId: string;
		employeeId: string;
		date: PlainDate | string;
		timezoneOverride?: string;
		at?: Instant;
	},
): Promise<EffectiveContractOnDay | null> {
	const day = toPlainDate(input.date);
	const batch = await loadEffectiveContractsBatch(db, {
		organizationId: input.organizationId,
		employeeIds: [input.employeeId],
		dates: [day],
		timezoneOverride: input.timezoneOverride,
		at: input.at,
	});
	return batch.get(input.employeeId)?.get(day.toString()) ?? null;
}
