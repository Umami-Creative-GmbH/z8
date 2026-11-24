import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
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
import type { EngagementKind } from "@/lib/engagement/engagement-kind";
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
	/** The stint's engagement kind, fixed when the period was written (#1995). */
	readonly engagementKind: EngagementKind;
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
	/** Full PostgreSQL microsecond UTC timestamp (`YYYY-MM-DD"T"HH24:MI:SS.US"Z"`) for tie-breaking parity (Astra #6). */
	readonly createdAtIso?: string;
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
	readonly sourceKind?: string | null;
	readonly sourceEmploymentHistoryId?: string | null;
	readonly sourceEmploymentPeriodId?: string | null;
	readonly isActive?: boolean;
	readonly priority: number;
	readonly effectiveFrom: Date | null;
	readonly effectiveUntil: Date | null;
	readonly effectiveFromDate: string | null;
	readonly effectiveUntilDate: string | null;
	readonly createdAt: Date;
	/** Set when DB verified `effective_until` matched a durable `work_policy.retired` `retiredAtLocalStart` (Astra #7). */
	readonly matchedDurableRetirementPriorEvening?: boolean;
}

export interface WorkPolicyVersionSnapshot {
	readonly id: string;
	readonly policyId: string;
	readonly versionNumber: number;
	readonly effectiveFromDate: string;
	readonly scheduleAnchorDate?: string;
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
	/** Organization-local date (`YYYY-MM-DD`) on which an inactive policy was retired (A2-8/P7-1). */
	readonly retiredOnDate?: string | null;
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
	/**
	 * `employee.engagement_kind`: the kind in force today. Read only for an employee
	 * without any recorded employment period; otherwise the day's stint decides.
	 */
	readonly employeeEngagementKind?: EngagementKind;
	readonly employeeCalendarTimezone: string;
	readonly organizationTimezone: string;
	/** Fallback current team from `employee.team_id` when no `employee_team_history` rows exist. */
	readonly currentTeamId?: string | null;
	/** Explicit caller-supplied primary team override (e.g. `loadEffectiveWorkPolicies`). */
	readonly teamIdOverride?: string | null;
	readonly hasTeamIdOverride?: boolean;
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
 * The engagement kind of an employee-local calendar day (#1996), as the contract resolver
 * decides it: the kind of the stint in force that day; outside every stint, the kind of the
 * nearest one; with no recorded stint at all, `employee.engagement_kind`.
 */
export function engagementKindOnDay(input: {
	periods: readonly EmploymentPeriodSnapshot[];
	day: PlainDate;
	employeeCalendarTimezone: string;
	employeeEngagementKind?: EngagementKind;
}): EngagementKind {
	if (input.periods.length === 0) return input.employeeEngagementKind ?? "employee";
	const { period } = resolveEmploymentPeriodForDay(
		input.periods,
		input.day,
		input.employeeCalendarTimezone,
	);
	return (
		period?.engagementKind ??
		engagementKindOutsideEmployment(input.periods, input.day, input.employeeCalendarTimezone)
	);
}

/**
 * The engagement kind of a day no employment period covers (#1996): the kind of the stint
 * that ended last before the day, or, before the first stint, of the stint that starts
 * first after it. Only callers that found no period on the day use this.
 */
function engagementKindOutsideEmployment(
	periods: readonly EmploymentPeriodSnapshot[],
	day: PlainDate,
	employeeCalendarTimezone: string,
): EngagementKind {
	const dayStart = day.toZonedDateTime(employeeCalendarTimezone).toInstant();
	let preceding: EmploymentPeriodSnapshot | null = null;
	let following: EmploymentPeriodSnapshot | null = null;
	for (const period of periods) {
		if (period.endedAt !== null && compareInstants(period.endedAt, dayStart) <= 0) {
			if (preceding?.endedAt == null || compareInstants(period.endedAt, preceding.endedAt) > 0) {
				preceding = period;
			}
			continue;
		}
		const start =
			period.startProvenance === "recorded" && period.startedAt ? period.startedAt : null;
		if (start === null) continue;
		if (
			following === null ||
			following.startedAt === null ||
			compareInstants(start, following.startedAt) < 0
		) {
			following = period;
		}
	}
	return (preceding ?? following)?.engagementKind ?? "employee";
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
	at?: Instant;
	currentTeamId?: string | null;
	teamIdOverride?: string | null;
	hasTeamIdOverride?: boolean;
}): string | null {
	if (input.hasTeamIdOverride) {
		if (input.teamIdOverride && !input.foreignTeamIds.has(input.teamIdOverride)) {
			return input.teamIdOverride;
		}
		return null;
	}

	// A1-11: Strictly honor migration 0120's non-inference invariant — never extrapolate
	// primary team membership backward from `employee.teamId` when `employee_team_history` is empty.
	if (input.teamHistory.length === 0) {
		return null;
	}

	const referenceInstant =
		input.at &&
		comparePlainDates(plainDateAt(input.at, input.employeeCalendarTimezone), input.day) === 0
			? input.at
			: input.day.toZonedDateTime(input.employeeCalendarTimezone).toInstant();

	const matching = input.teamHistory.filter((interval) => {
		if (input.foreignTeamIds.has(interval.teamId)) return false;
		if (compareInstants(interval.effectiveFrom, referenceInstant) > 0) return false;
		if (
			interval.effectiveTo !== null &&
			compareInstants(interval.effectiveTo, referenceInstant) <= 0
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
	row: Pick<
		EmploymentHistorySnapshot,
		"validFrom" | "validUntil" | "validFromDate" | "validUntilDate"
	>,
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
			// Astra #6 (Pass 8): Compare full microsecond PostgreSQL `created_at` when available
			// so tie-breaking matches retirement supersession with zero JS Date truncation drift.
			if (left.row.createdAtIso && right.row.createdAtIso) {
				const isoCmp = left.row.createdAtIso.localeCompare(right.row.createdAtIso);
				if (isoCmp !== 0) return isoCmp;
			} else {
				const createdCmp = left.row.createdAt.getTime() - right.row.createdAt.getTime();
				if (createdCmp !== 0) return createdCmp;
			}
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
}): {
	terms: EmploymentHistorySnapshot | null;
	inEndedTermsGap: boolean;
	effectivePolicyEvaluationDate: string | null;
} {
	const { confirmedTerms, period, day, employeeCalendarTimezone, organizationTimezone } = input;
	if (confirmedTerms.length === 0) {
		return { terms: null, inEndedTermsGap: false, effectivePolicyEvaluationDate: null };
	}

	const nonEmptyTerms = confirmedTerms.filter((row) => {
		const bounds = termsDateBounds(row, organizationTimezone);
		return bounds.until === null || comparePlainDates(bounds.from, bounds.until) < 0;
	});
	if (nonEmptyTerms.length === 0) {
		return { terms: null, inEndedTermsGap: false, effectivePolicyEvaluationDate: null };
	}

	const periodScoped = period
		? nonEmptyTerms.filter((row) => row.employmentPeriodId === period.id)
		: nonEmptyTerms;
	const candidateRows =
		periodScoped.length > 0
			? periodScoped
			: period
				? nonEmptyTerms.filter((row) => row.employmentPeriodId === null)
				: nonEmptyTerms;

	const direct = selectConfirmedTermsOnDate(candidateRows, day, organizationTimezone);
	if (direct) {
		return { terms: direct, inEndedTermsGap: false, effectivePolicyEvaluationDate: null };
	}

	// Cross-timezone rehire opening day: when employeeTz lags behind orgTz, the stint's
	// recorded start instant falls on `day` in employeeTz and `day + 1` in orgTz.
	// Return `startInOrgTz` so work policy version selection matches clock-out (A3-10).
	if (period && period.startProvenance === "recorded" && period.startedAt) {
		const startInEmpTz = plainDateAt(period.startedAt, employeeCalendarTimezone);
		const startInOrgTz = plainDateAt(period.startedAt, organizationTimezone);
		if (comparePlainDates(startInEmpTz, day) === 0 && comparePlainDates(startInOrgTz, day) > 0) {
			const crossTz = selectConfirmedTermsOnDate(candidateRows, startInOrgTz, organizationTimezone);
			if (crossTz) {
				return {
					terms: crossTz,
					inEndedTermsGap: false,
					effectivePolicyEvaluationDate: startInOrgTz.toString(),
				};
			}
		}
	}

	// If an earlier confirmed term in this stint already ended on or before `day`,
	// `day` sits in a calendar gap after confirmed terms took effect: never revive
	// superseded terms or legacy policy-assignment fallbacks across that gap.
	const inEndedTermsGap = candidateRows.some((row) => {
		const bounds = termsDateBounds(row, organizationTimezone);
		return bounds.until !== null && comparePlainDates(bounds.until, day) <= 0;
	});

	return { terms: null, inEndedTermsGap, effectivePolicyEvaluationDate: null };
}

/**
 * The employment profile `resolveEffectiveContractPure` resolves on `day`, or null when the
 * employee is not employed that day. Depends only on employment periods and confirmed terms.
 */
export function resolveEmploymentProfileOnDay(input: {
	readonly day: PlainDate;
	readonly employmentPeriods: readonly EmploymentPeriodSnapshot[];
	readonly confirmedTerms: readonly EmploymentHistorySnapshot[];
	readonly employeeCalendarTimezone: string;
	readonly organizationTimezone: string;
}): EffectiveContractOnDay["employmentProfile"] | null {
	const { period, isEmployed } = resolveEmploymentPeriodForDay(
		input.employmentPeriods,
		input.day,
		input.employeeCalendarTimezone,
	);
	// An External Contractor stint has no employee statutory profile (#1996).
	if (!isEmployed || period?.engagementKind === "contractor") return null;
	const { terms } = selectConfirmedTermsForPeriodOnDay({
		confirmedTerms: input.confirmedTerms,
		period,
		day: input.day,
		employeeCalendarTimezone: input.employeeCalendarTimezone,
		organizationTimezone: input.organizationTimezone,
	});
	return terms?.employmentProfile ?? "regular";
}

/**
 * Every day on which `resolveEmploymentProfileOnDay` can change: terms boundaries, and the local
 * days an employment period starts or ends on (and the day after, since a period touching a day
 * covers it). Between two consecutive change days the profile is constant, and so are the terms
 * row in force and its wage. Unsorted, with repeats.
 */
export function employmentProfileChangeDays(input: {
	readonly employmentPeriods: readonly Pick<EmploymentPeriodSnapshot, "startedAt" | "endedAt">[];
	readonly confirmedTerms: readonly Pick<
		EmploymentHistorySnapshot,
		"validFrom" | "validUntil" | "validFromDate" | "validUntilDate"
	>[];
	readonly employeeCalendarTimezone: string;
	readonly organizationTimezone: string;
}): PlainDate[] {
	const days: PlainDate[] = [];
	for (const row of input.confirmedTerms) {
		const bounds = termsDateBounds(row, input.organizationTimezone);
		days.push(bounds.from);
		if (bounds.until) days.push(bounds.until);
	}
	for (const period of input.employmentPeriods) {
		for (const instant of [period.startedAt, period.endedAt]) {
			if (!instant) continue;
			for (const zone of [input.employeeCalendarTimezone, input.organizationTimezone]) {
				const day = plainDateAt(instant, zone);
				days.push(day, day.add({ days: 1 }));
			}
		}
	}
	return days;
}

export function employmentPeriodSnapshotOf(row: {
	readonly id: string;
	readonly employeeId: string;
	readonly status: EmploymentPeriodSnapshot["status"];
	readonly startedAt: Date | null;
	readonly startProvenance: EmploymentPeriodSnapshot["startProvenance"];
	readonly endedAt: Date | null;
	readonly createdAt: Date;
	readonly engagementKind: EngagementKind;
}): EmploymentPeriodSnapshot {
	return {
		id: row.id,
		employeeId: row.employeeId,
		status: row.status,
		startedAt: row.startedAt ? instantFromDate(row.startedAt) : null,
		startProvenance: row.startProvenance,
		endedAt: row.endedAt ? instantFromDate(row.endedAt) : null,
		createdAt: instantFromDate(row.createdAt),
		engagementKind: row.engagementKind,
	};
}

export function employmentHistorySnapshotOf(
	row: typeof employeeEmploymentHistory.$inferSelect,
	createdAtIso: string,
	customDays: EmploymentHistorySnapshot["customDays"],
): EmploymentHistorySnapshot {
	return {
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
		createdAtIso,
		customDays,
	};
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

function isPolicyEligibleOnDay(
	policy: WorkPolicySnapshot,
	dayStr: string,
	intervalEndDate: string | null,
): boolean {
	if (policy.isActive) return true;
	// A1-12 / A2-8 / P7-1: A retired policy remains eligible ONLY on historical dates
	// strictly before BOTH the referencing interval's end date AND the recorded retirement date.
	if (intervalEndDate === null || dayStr >= intervalEndDate) return false;
	if (
		policy.retiredOnDate &&
		(dayStr >= policy.retiredOnDate || intervalEndDate > policy.retiredOnDate)
	) {
		return false;
	}
	return true;
}

function assignmentCoversDay(
	assignment: PolicyAssignmentSnapshot,
	day: PlainDate,
	dayStr: string,
	organizationTimezone: string,
	at?: Instant,
): boolean {
	// A2-12: Only use instant bounds when `at` is supplied for legacy timestamp-bounded rows
	// (or rows lacking canonical `effectiveFromDate`). Dated non-legacy rows always match
	// on calendar dates so instant reads agree with clock-out around local midnight.
	const isLegacyInstantBound =
		assignment.sourceKind === "legacy" || assignment.effectiveFromDate === null;
	if (
		at !== undefined &&
		isLegacyInstantBound &&
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
		if (assignment.sourceKind === "legacy" && assignment.effectiveUntil !== null) {
			// F11-1 / Astra #8: Preserve UTC-midnight calendar-date semantics via `termsCalendarDate`
			// so legacy assignments ending at 00:00Z never lose their final local day west of UTC.
			const legacyEndDate = termsCalendarDate(
				assignment.effectiveUntil,
				organizationTimezone,
			).toString();
			if (legacyEndDate <= dayStr) return false;
		}
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

function isPreservedLegacyPriorEveningWindow(
	row: PolicyAssignmentSnapshot,
	organizationTimezone: string,
	at: Instant | undefined,
): boolean {
	if (
		at === undefined ||
		row.sourceKind !== "legacy" ||
		row.effectiveFrom === null ||
		row.effectiveUntil === null ||
		row.effectiveFromDate === null ||
		row.effectiveUntilDate === null
	) {
		return false;
	}
	if (row.effectiveFrom.getTime() >= row.effectiveUntil.getTime()) return false;
	const expectedNextDay = parsePlainDate(row.effectiveFromDate).add({ days: 1 }).toString();
	if (row.effectiveUntilDate !== expectedNextDay) return false;
	if (row.matchedDurableRetirementPriorEvening) {
		return true;
	}
	const localFromDate = plainDateAt(
		instantFromDate(row.effectiveFrom),
		organizationTimezone,
	).toString();
	if (localFromDate >= row.effectiveFromDate) return false;
	// Astra #9 / Opus #2 / Astra #7 (Pass 8): Require `effective_until` to equal exact org-local midnight of
	// `effective_from_date` (or a verified durable `work_policy.retired` `retiredAtLocalStart` boundary),
	// so manually canceled 1-day legacy assignments ending at UTC midnight of D+1 are never revived.
	const expectedLocalMidnight = parsePlainDate(row.effectiveFromDate)
		.toZonedDateTime(organizationTimezone)
		.toInstant();
	return compareInstants(instantFromDate(row.effectiveUntil), expectedLocalMidnight) === 0;
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
		if (
			row.isActive === false &&
			!isPreservedLegacyPriorEveningWindow(row, input.organizationTimezone, input.at)
		) {
			return false;
		}
		if (row.assignmentType !== input.level) return false;
		if (input.level === "employee" && row.employeeId !== input.employeeId) return false;
		if (input.level === "team" && (input.teamId === null || row.teamId !== input.teamId)) {
			return false;
		}
		if (!assignmentCoversDay(row, input.day, input.dayStr, input.organizationTimezone, input.at)) {
			return false;
		}
		const policy = input.policiesById.get(row.policyId);
		if (!policy) return false;
		const intervalEndDate =
			row.sourceKind === "legacy" && row.effectiveUntil !== null
				? termsCalendarDate(row.effectiveUntil, input.organizationTimezone).toString()
				: row.effectiveUntilDate;
		return isPolicyEligibleOnDay(policy, input.dayStr, intervalEndDate);
	});

	if (matching.length === 0) return null;

	matching.sort((left, right) => {
		// Opus #2(b): Prefer active assignments over deactivated preserved 1a-fallback prior-evening
		// rows so a replacement scheduled from D-1 overrides a deactivated retired policy on D-1 evening.
		const activeCmp = (right.isActive !== false ? 1 : 0) - (left.isActive !== false ? 1 : 0);
		if (activeCmp !== 0) return activeCmp;
		const leftFrom = left.effectiveFromDate ?? "";
		const rightFrom = right.effectiveFromDate ?? "";
		if (rightFrom !== leftFrom) return rightFrom.localeCompare(leftFrom);
		const createdCmp = right.createdAt.getTime() - left.createdAt.getTime();
		if (createdCmp !== 0) return createdCmp;
		return right.id.localeCompare(left.id);
	});

	return matching[0] ?? null;
}

function scheduleFingerprintForAnchor(schedule: ResolvedWorkPolicySchedule | null): string {
	if (!schedule) return "none";
	const daysKey = [...schedule.days]
		.sort(
			(a, b) =>
				(a.cycleWeek ?? 1) - (b.cycleWeek ?? 1) ||
				DAY_OF_WEEK_ORDER.indexOf(a.dayOfWeek) - DAY_OF_WEEK_ORDER.indexOf(b.dayOfWeek),
		)
		.map(
			(d) =>
				`${d.cycleWeek ?? 1}:${d.dayOfWeek}:${d.isWorkDay ? 1 : 0}:${d.minutesPerDay}:${d.latestClockIn ?? ""}`,
		)
		.join("|");
	return `${schedule.scheduleCycle}|${schedule.scheduleType}|${schedule.workingDaysPreset}|${schedule.normalizedCycleMinutes ?? ""}|${daysKey}`;
}

/**
 * Walks backward through effective versions with identical schedule definitions so
 * non-schedule revisions (e.g. toggling presence or updating break regulations) never
 * restart a multi-week schedule cycle phase (A2-15 / P7-2).
 */
function computeScheduleAnchorDate(
	versions: readonly WorkPolicyVersionSnapshot[],
	activeVersion: WorkPolicyVersionSnapshot,
): string {
	const activeFp = scheduleFingerprintForAnchor(activeVersion.schedule);
	// Deduplicate by effectiveFromDate (latest versionNumber wins per day), ascending chronologically
	const winningByDate = new Map<string, WorkPolicyVersionSnapshot>();
	for (const v of versions) {
		if (v.effectiveFromDate > activeVersion.effectiveFromDate) continue;
		if (
			v.effectiveFromDate === activeVersion.effectiveFromDate &&
			v.versionNumber > activeVersion.versionNumber
		) {
			continue;
		}
		const prev = winningByDate.get(v.effectiveFromDate);
		if (!prev || v.versionNumber > prev.versionNumber) {
			winningByDate.set(v.effectiveFromDate, v);
		}
	}
	const chronological = [...winningByDate.values()].sort((a, b) =>
		a.effectiveFromDate.localeCompare(b.effectiveFromDate),
	);
	let anchorDate = activeVersion.effectiveFromDate;
	for (let i = chronological.length - 1; i >= 0; i--) {
		const candidate = chronological[i]!;
		if (scheduleFingerprintForAnchor(candidate.schedule) === activeFp) {
			anchorDate = candidate.effectiveFromDate;
		} else {
			break;
		}
	}
	return anchorDate;
}

/**
 * Precomputes `scheduleAnchorDate` once per policy version so bulk resolution across
 * thousands of employees/dates never repeats the history fingerprint walk (A3-19).
 */
export function attachPrecomputedScheduleAnchors(
	versions: readonly WorkPolicyVersionSnapshot[],
): WorkPolicyVersionSnapshot[] {
	if (versions.length === 0) return [];
	// Compute winning version per effectiveFromDate in chronological order once.
	const sortedAsc = [...versions].sort(
		(a, b) =>
			a.effectiveFromDate.localeCompare(b.effectiveFromDate) || a.versionNumber - b.versionNumber,
	);
	const anchorById = new Map<string, string>();
	const winningTimeline: { effectiveFromDate: string; fp: string }[] = [];
	const fpById = new Map<string, string>();
	for (const v of sortedAsc) {
		fpById.set(v.id, scheduleFingerprintForAnchor(v.schedule));
	}
	const winningByDate = new Map<string, WorkPolicyVersionSnapshot>();
	for (const v of sortedAsc) {
		const prev = winningByDate.get(v.effectiveFromDate);
		if (!prev || v.versionNumber > prev.versionNumber) {
			winningByDate.set(v.effectiveFromDate, v);
		}
	}
	const chronologicalWinning = [...winningByDate.values()].sort((a, b) =>
		a.effectiveFromDate.localeCompare(b.effectiveFromDate),
	);
	let runAnchor = chronologicalWinning[0]?.effectiveFromDate ?? "";
	let runFp = chronologicalWinning[0] ? (fpById.get(chronologicalWinning[0].id) ?? "") : "";
	for (const v of chronologicalWinning) {
		const fp = fpById.get(v.id) ?? "";
		if (fp !== runFp) {
			runAnchor = v.effectiveFromDate;
			runFp = fp;
		}
		winningTimeline.push({ effectiveFromDate: v.effectiveFromDate, fp });
		anchorById.set(v.id, runAnchor);
	}
	return versions.map((v) => ({
		...v,
		scheduleAnchorDate: anchorById.get(v.id) ?? computeScheduleAnchorDate(versions, v),
	}));
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
		scheduleAnchorDate:
			activeVersion.scheduleAnchorDate ?? computeScheduleAnchorDate(policy.versions, activeVersion),
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

function getWorkDaysFromPolicySchedule(
	schedule: ResolvedWorkPolicySchedule,
	activeCycleWeek = 1,
): DayOfWeek[] {
	if (schedule.scheduleType === "detailed" || schedule.workingDaysPreset === "custom") {
		// A3-18: Check whether ANY rows exist for `activeCycleWeek` BEFORE filtering by `isWorkDay`
		// so an explicitly work-free cycle week returns [] instead of falling back to week 1.
		const cycleWeekRows = schedule.days.filter((d) => (d.cycleWeek ?? 1) === activeCycleWeek);
		const effectiveRows =
			cycleWeekRows.length > 0
				? cycleWeekRows
				: schedule.days.filter((d) => (d.cycleWeek ?? 1) === 1);
		const workDays = effectiveRows.filter((d) => d.isWorkDay);
		const order = new Map(DAY_OF_WEEK_ORDER.map((day, idx) => [day, idx]));
		return workDays
			.map((d) => d.dayOfWeek)
			.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
	}
	return [...(PRESET_WORK_DAYS[schedule.workingDaysPreset] ?? WEEKDAY_NAMES)];
}

function resolveCycleWeekForDate(
	day: PlainDate,
	anchorDateStr: string | null,
	maxCycleWeek: number,
): number {
	if (maxCycleWeek <= 1) return 1;
	const anchor = anchorDateStr ? parsePlainDate(anchorDateStr) : parsePlainDate("1970-01-05");
	const anchorMonday = anchor.subtract({ days: anchor.dayOfWeek - 1 });
	const dayMonday = day.subtract({ days: day.dayOfWeek - 1 });
	const diffDays = dayMonday.since(anchorMonday, { largestUnit: "days" }).days;
	const diffWeeks = Math.floor(diffDays / 7);
	return (((diffWeeks % maxCycleWeek) + maxCycleWeek) % maxCycleWeek) + 1;
}

function normalizeSimpleCycleToWeeklyMinutes(
	scheduleCycle: ResolvedWorkPolicySchedule["scheduleCycle"],
	cycleMinutes: number,
	workDayCount = 5,
): number {
	switch (scheduleCycle) {
		case "weekly":
			return cycleMinutes;
		case "biweekly":
			return Math.round(cycleMinutes / 2);
		case "monthly":
			return Math.round((cycleMinutes * 12) / 52);
		case "yearly":
			return Math.round(cycleMinutes / 52);
		case "daily":
			return cycleMinutes * workDayCount;
	}
}

function buildSevenDayMap(
	workDays: readonly DayOfWeek[],
	minutesForWorkDays: readonly number[],
	latestClockIns?: ReadonlyMap<DayOfWeek, string | null>,
	cycleWeek = 1,
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
			cycleWeek,
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
	day: PlainDate;
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

	const scheduleAnchorDate =
		input.workPolicy?.scheduleAnchorDate ?? input.workPolicy?.effectiveFromDate ?? null;
	const activePolicyMaxCycleWeek = activePolicySchedule
		? activePolicySchedule.days.reduce((max, d) => Math.max(max, d.cycleWeek ?? 1), 1)
		: 1;
	const activePolicyCycleWeek = resolveCycleWeekForDate(
		input.day,
		scheduleAnchorDate,
		activePolicyMaxCycleWeek,
	);

	// 2. hours_only mode: distribute weeklyContractMinutes across the active cycle week's working days (A2-14)
	if (input.scheduleMode === "hours_only") {
		const workDays = activePolicySchedule
			? getWorkDaysFromPolicySchedule(activePolicySchedule, activePolicyCycleWeek)
			: [...WEEKDAY_NAMES];
		const fallbackWeekly =
			activePolicySchedule?.normalizedCycleMinutes != null
				? normalizeSimpleCycleToWeeklyMinutes(
						activePolicySchedule.scheduleCycle,
						activePolicySchedule.normalizedCycleMinutes,
						workDays.length,
					)
				: 0;
		const targetMinutes = input.weeklyContractMinutes ?? fallbackWeekly;
		const distributed = distributeMinutesLargestRemainder(
			targetMinutes,
			workDays.map(() => 1),
		);
		return {
			weeklyScheduleDays: buildSevenDayMap(workDays, distributed, undefined, activePolicyCycleWeek),
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
			// A1-13 / A2-15 / P7-2: Resolve the active cycleWeek using the stable scheduleAnchorDate
			// so non-schedule versions never shift an alternating schedule phase.
			const activeCycleWeek = activePolicyCycleWeek;
			const matchedCycleDays = activePolicySchedule.days.filter(
				(d) => (d.cycleWeek ?? 1) === activeCycleWeek,
			);
			const effectiveCycleDays =
				matchedCycleDays.length > 0
					? matchedCycleDays
					: activePolicySchedule.days.filter((d) => (d.cycleWeek ?? 1) === 1);
			const order = new Map(DAY_OF_WEEK_ORDER.map((day, idx) => [day, idx]));
			const sortedWorkDays = effectiveCycleDays
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
					weeklyScheduleDays: buildSevenDayMap(
						workDayNames,
						scaled,
						latestClockIns,
						activeCycleWeek,
					),
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
				weeklyScheduleDays: buildSevenDayMap(
					workDayNames,
					rawWeights,
					latestClockIns,
					activeCycleWeek,
				),
				mismatchWarning: null,
			};
		}

		// Simple policy schedule (daily, weekly, biweekly, monthly, yearly — A1-13)
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

		const workDays = getWorkDaysFromPolicySchedule(activePolicySchedule);
		const weeklyFromCycle =
			activePolicySchedule.normalizedCycleMinutes !== null
				? normalizeSimpleCycleToWeeklyMinutes(
						activePolicySchedule.scheduleCycle,
						activePolicySchedule.normalizedCycleMinutes,
					)
				: 0;
		const targetMinutes = input.weeklyContractMinutes ?? weeklyFromCycle;
		const distributed = distributeMinutesLargestRemainder(
			targetMinutes,
			workDays.map(() => 1),
		);
		return {
			weeklyScheduleDays: buildSevenDayMap(workDays, distributed),
			mismatchWarning: null,
		};
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
 * A day inside an External Contractor period (#1996): the person keeps their
 * employment period and primary team (projects, approvals and period submissions
 * still route through them) but inherits no default contract, work policy
 * schedule, regulation or presence rule, accrues no required time and keeps no
 * work balance, and has no employee statutory profile.
 */
function contractorEngagementOnDay(args: {
	input: PureResolveContractInput;
	dayStr: string;
	dayOfWeek: DayOfWeek;
	employmentPeriodId: string | null;
	isEmployed: boolean;
	primaryTeamId: string | null;
}): EffectiveContractOnDay {
	const { input } = args;
	return {
		date: args.dayStr,
		dayOfWeek: args.dayOfWeek,
		calendarTimezone: input.employeeCalendarTimezone,
		employeeId: input.employeeId,
		employmentPeriodId: args.employmentPeriodId,
		isEmployedOnDay: args.isEmployed,
		engagementKind: "contractor",
		primaryTeamId: args.primaryTeamId,
		employmentHistoryId: null,
		contractDefaultId: null,
		contractDefaultScope: null,

		workPolicy: null,
		workPolicySource: "default",
		weeklyContractMinutes: null,
		weeklyContractMinutesSource: "default",
		scheduleMode: "policy",
		scheduleModeSource: "default",
		workModel: null,
		workModelSource: "default",
		presenceOverride: "inherit",
		presenceOverrideSource: "default",
		presenceStatus: "not_configured",
		effectivePresence: null,
		balanceMode: "excluded",
		balanceModeSource: "default",
		scheduleSource: "policy",
		scheduleSourceSource: "default",

		isWorkDay: false,
		requiredMinutes: 0,
		contributesZeroBalanceDelta: true,
		latestClockIn: null,
		weeklyScheduleDays: emptyWeekSchedule(),
		mismatchWarning: null,

		contractType: input.employeeContractType,
		hourlyRate: null,
		currency: "EUR",
		employmentProfile: null,
		arbzgScope: "standard",
		onCallTerms: null,
		migratedLegacyTerms: false,
	};
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
		at: input.at,
		currentTeamId: input.currentTeamId,
		teamIdOverride: input.teamIdOverride,
		hasTeamIdOverride: input.hasTeamIdOverride,
	});

	// 2b. An External Contractor stint is exempt from every employee labor rule (#1996):
	// no Org/Primary-Team default contract, no work policy, no work balance.
	// A day outside every stint (before the first, after the last, or in a gap) takes the
	// kind of the nearest stint, so a contractor's non-employed days never inherit defaults.
	const engagementKind: EngagementKind =
		period?.engagementKind ??
		engagementKindOnDay({
			periods: input.employmentPeriods,
			day,
			employeeCalendarTimezone: input.employeeCalendarTimezone,
			employeeEngagementKind: input.employeeEngagementKind,
		});
	if (engagementKind === "contractor") {
		return contractorEngagementOnDay({
			input,
			dayStr,
			dayOfWeek,
			employmentPeriodId,
			isEmployed,
			primaryTeamId,
		});
	}

	// 3. Confirmed employee terms for the active stint (never leak across closed employment periods)
	const {
		terms: employeeTerms,
		inEndedTermsGap,
		effectivePolicyEvaluationDate,
	} = isEmployed
		? selectConfirmedTermsForPeriodOnDay({
				confirmedTerms: input.confirmedTerms,
				period,
				day,
				employeeCalendarTimezone: input.employeeCalendarTimezone,
				organizationTimezone: input.organizationTimezone,
			})
		: { terms: null, inEndedTermsGap: false, effectivePolicyEvaluationDate: null };

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
	// If confirmed terms explicitly reference a policy outside this organization (absent from `policiesById`),
	// or if `day` sits in a calendar gap after ended confirmed terms with no org/team contract defaults,
	// do not silently fall back to another assignment or synthesize minutes.
	let workPolicyResolved: ResolvedWorkPolicyVersion | null = null;
	let workPolicySource: ContractFieldSource = "default";
	const hasUnresolvedTermsPolicy = Boolean(
		employeeTerms?.workPolicyId && !input.policiesById.has(employeeTerms.workPolicyId),
	);
	const suppressAssignmentFallback =
		hasUnresolvedTermsPolicy || (inEndedTermsGap && !teamDefault && !orgDefault);

	if (employeeTerms?.workPolicyId) {
		const policy = input.policiesById.get(employeeTerms.workPolicyId);
		if (policy) {
			const policyEvalDateStr = effectivePolicyEvaluationDate ?? dayStr;
			const policyEvalDay = effectivePolicyEvaluationDate
				? parsePlainDate(effectivePolicyEvaluationDate)
				: day;
			const termsEndDate =
				termsDateBounds(employeeTerms, input.organizationTimezone).until?.toString() ?? null;
			// A2-8 / P7-1 / A3-6: When confirmed terms have linked `employment_terms` assignment(s),
			// those immutable capped/deactivated windows govern pin eligibility so renaming or later
			// reactivating a retired policy can never revive the retired pin.
			const linkedTermsAssignments = input.policyAssignments.filter(
				(row) =>
					row.assignmentType === "employee" &&
					row.employeeId === input.employeeId &&
					row.policyId === policy.id &&
					row.sourceEmploymentHistoryId === employeeTerms.id,
			);
			let pinEligible: boolean;
			if (linkedTermsAssignments.length > 0) {
				pinEligible = linkedTermsAssignments.some(
					(row) =>
						row.isActive !== false &&
						assignmentCoversDay(
							row,
							policyEvalDay,
							policyEvalDateStr,
							input.organizationTimezone,
							input.at,
						) &&
						(policy.isActive ||
							isPolicyEligibleOnDay(policy, policyEvalDateStr, row.effectiveUntilDate)),
				);
			} else {
				pinEligible = isPolicyEligibleOnDay(policy, policyEvalDateStr, termsEndDate);
				if (!pinEligible && !policy.isActive) {
					const matchingCappedAssignment = input.policyAssignments.find(
						(row) =>
							row.isActive !== false &&
							row.assignmentType === "employee" &&
							row.employeeId === input.employeeId &&
							row.policyId === policy.id &&
							assignmentCoversDay(
								row,
								policyEvalDay,
								policyEvalDateStr,
								input.organizationTimezone,
								input.at,
							) &&
							isPolicyEligibleOnDay(policy, policyEvalDateStr, row.effectiveUntilDate),
					);
					pinEligible = Boolean(matchingCappedAssignment);
				}
			}
			if (pinEligible) {
				workPolicyResolved = selectActivePolicyVersionOnDay(policy, policyEvalDateStr, {
					assignmentType: "employee",
					assignmentId: null,
					assignedVia: "Contract override",
				});
				if (workPolicyResolved) workPolicySource = "employee_override";
			}
		}
	}

	if (!workPolicyResolved && isEmployed && !suppressAssignmentFallback) {
		const termsStartDate =
			employeeTerms && employeeTerms.workPolicyId === null
				? termsDateBounds(employeeTerms, input.organizationTimezone).from.toString()
				: null;
		// H4 / A3-4: Mirror clock-out stint & cross-timezone rehire opening-day exclusions so a
		// rehire on opening day never inherits a prior stint's capped employee/manager assignment.
		const periodStartInEmpTz =
			period?.startProvenance === "recorded" && period.startedAt
				? plainDateAt(period.startedAt, input.employeeCalendarTimezone)
				: null;
		const periodStartInOrgTz =
			period?.startProvenance === "recorded" && period.startedAt
				? plainDateAt(period.startedAt, input.organizationTimezone)
				: null;
		const isOpeningDayCrossTz = Boolean(
			periodStartInEmpTz &&
			periodStartInOrgTz &&
			comparePlainDates(periodStartInEmpTz, day) === 0 &&
			comparePlainDates(periodStartInOrgTz, day) > 0,
		);
		const periodStartInOrgTzStr = periodStartInOrgTz?.toString() ?? null;
		const foreignPeriodHistoryIds =
			employmentPeriodId !== null
				? new Set(
						input.confirmedTerms
							.filter(
								(t) => t.employmentPeriodId !== null && t.employmentPeriodId !== employmentPeriodId,
							)
							.map((t) => t.id),
					)
				: null;
		const stintEligibleAssignments =
			employmentPeriodId !== null
				? input.policyAssignments.filter((row) => {
						if (row.assignmentType !== "employee") return true;
						if (
							row.sourceKind === "employment_terms" &&
							((row.sourceEmploymentPeriodId !== null &&
								row.sourceEmploymentPeriodId !== undefined &&
								row.sourceEmploymentPeriodId !== employmentPeriodId) ||
								(typeof row.sourceEmploymentHistoryId === "string" &&
									foreignPeriodHistoryIds?.has(row.sourceEmploymentHistoryId)))
						) {
							return false;
						}
						if (
							isOpeningDayCrossTz &&
							periodStartInOrgTzStr !== null &&
							row.effectiveUntilDate !== null &&
							row.effectiveUntilDate <= periodStartInOrgTzStr
						) {
							return false;
						}
						return true;
					})
				: input.policyAssignments;
		const empAssignment = selectPolicyAssignmentAtLevel({
			assignments: stintEligibleAssignments,
			policiesById: input.policiesById,
			level: "employee",
			employeeId: input.employeeId,
			teamId: primaryTeamId,
			day,
			dayStr,
			organizationTimezone: input.organizationTimezone,
			at: input.at,
		});
		const assignmentStartDate = empAssignment
			? (empAssignment.effectiveFromDate ??
				(empAssignment.effectiveFrom
					? termsCalendarDate(empAssignment.effectiveFrom, input.organizationTimezone).toString()
					: "1970-01-01"))
			: null;
		// Confirmed terms with `workPolicyId = null` release older pre-existing employment-terms
		// overrides; active scoped-manager assignments (`sourceKind === 'manager_assignment'`) stay
		// in force across pay-only edits and are explicitly closed by `endPolicyAssignmentWindowInTx`
		// whenever an admin resets or clears personal pins (A2-13).
		const releasedByUnlinkedTerms =
			termsStartDate !== null &&
			assignmentStartDate !== null &&
			assignmentStartDate < termsStartDate &&
			empAssignment?.sourceKind !== "manager_assignment";
		if (empAssignment && !releasedByUnlinkedTerms) {
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

	if (!workPolicyResolved && !hasUnresolvedTermsPolicy && teamDefault?.workPolicyId) {
		const policy = input.policiesById.get(teamDefault.workPolicyId);
		if (policy && isPolicyEligibleOnDay(policy, dayStr, teamDefault.effectiveUntilDate)) {
			workPolicyResolved = selectActivePolicyVersionOnDay(policy, dayStr, {
				assignmentType: "team",
				assignmentId: null,
				assignedVia: (primaryTeamId ? input.teamNames.get(primaryTeamId) : null) ?? "Team",
			});
			if (workPolicyResolved) workPolicySource = "team_default";
		}
	}

	if (!workPolicyResolved && !suppressAssignmentFallback && primaryTeamId !== null) {
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

	if (!workPolicyResolved && !hasUnresolvedTermsPolicy && orgDefault?.workPolicyId) {
		const policy = input.policiesById.get(orgDefault.workPolicyId);
		if (policy && isPolicyEligibleOnDay(policy, dayStr, orgDefault.effectiveUntilDate)) {
			workPolicyResolved = selectActivePolicyVersionOnDay(policy, dayStr, {
				assignmentType: "organization",
				assignmentId: null,
				assignedVia: "Organization Default",
			});
			if (workPolicyResolved) workPolicySource = "org_default";
		}
	}

	if (!workPolicyResolved && !suppressAssignmentFallback) {
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
	const { weeklyScheduleDays, mismatchWarning } = hasUnresolvedTermsPolicy
		? { weeklyScheduleDays: emptyWeekSchedule(), mismatchWarning: null }
		: resolveScheduleForWeek({
				day,
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
		engagementKind,
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
		/**
		 * Resolve each listed employee only on its own dates (`YYYY-MM-DD`) instead of every date
		 * in `dates`; employees missing from the map get every date.
		 */
		datesByEmployee?: ReadonlyMap<string, readonly string[]>;
		timezoneOverride?: string;
		employmentStartDateOverride?: string;
		organizationTimezone?: string;
		preloadedEmployees?: readonly {
			id: string;
			contractType: ContractType;
			engagementKind: EngagementKind;
			teamId: string | null;
			userTimezone: string | null;
		}[];
		preloadedPeriods?: readonly EmploymentPeriodSnapshot[];
		teamIdOverrides?: ReadonlyMap<string, string | null>;
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

	// 1. Organization timezone + employees + user timezone settings.
	// Queries execute serially so a single-connection pool never queues a burst behind analytics reads.
	const orgTimezone =
		input.organizationTimezone ??
		(
			await db
				.select({ timezone: organization.timezone })
				.from(organization)
				.where(eq(organization.id, input.organizationId))
				.limit(1)
		)[0]?.timezone ??
		"UTC";

	const employeeRows = input.preloadedEmployees
		? input.preloadedEmployees.filter((row) => uniqueEmployeeIds.includes(row.id))
		: await db
				.select({
					id: employee.id,
					contractType: employee.contractType,
					engagementKind: employee.engagementKind,
					teamId: employee.teamId,
					userTimezone: userSettings.timezone,
				})
				.from(employee)
				.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
				.where(
					and(
						eq(employee.organizationId, input.organizationId),
						inArray(employee.id, uniqueEmployeeIds),
					),
				);

	const periodRows = input.preloadedPeriods
		? null
		: await db
				.select({
					id: employeeEmploymentPeriod.id,
					employeeId: employeeEmploymentPeriod.employeeId,
					status: employeeEmploymentPeriod.status,
					startedAt: employeeEmploymentPeriod.startedAt,
					startProvenance: employeeEmploymentPeriod.startProvenance,
					endedAt: employeeEmploymentPeriod.endedAt,
					createdAt: employeeEmploymentPeriod.createdAt,
					engagementKind: employeeEmploymentPeriod.engagementKind,
				})
				.from(employeeEmploymentPeriod)
				.where(
					and(
						eq(employeeEmploymentPeriod.organizationId, input.organizationId),
						inArray(employeeEmploymentPeriod.employeeId, uniqueEmployeeIds),
					),
				);

	const teamHistoryRows = await db
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
		);

	const termsRows = await db
		.select({
			row: employeeEmploymentHistory,
			createdAtIso: sql<string>`to_char(${employeeEmploymentHistory.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
		})
		.from(employeeEmploymentHistory)
		.where(
			and(
				eq(employeeEmploymentHistory.organizationId, input.organizationId),
				inArray(employeeEmploymentHistory.employeeId, uniqueEmployeeIds),
				eq(employeeEmploymentHistory.reviewState, "confirmed"),
			),
		)
		.orderBy(asc(employeeEmploymentHistory.validFrom), asc(employeeEmploymentHistory.createdAt));

	const defaultRows = await db
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
		);

	const assignmentRows = await db
		.select({
			id: workPolicyAssignment.id,
			policyId: workPolicyAssignment.policyId,
			assignmentType: workPolicyAssignment.assignmentType,
			teamId: workPolicyAssignment.teamId,
			employeeId: workPolicyAssignment.employeeId,
			priority: workPolicyAssignment.priority,
			sourceKind: workPolicyAssignment.sourceKind,
			sourceEmploymentHistoryId: workPolicyAssignment.sourceEmploymentHistoryId,
			sourceEmploymentPeriodId: employeeEmploymentHistory.employmentPeriodId,
			isActive: workPolicyAssignment.isActive,
			effectiveFrom: workPolicyAssignment.effectiveFrom,
			effectiveUntil: workPolicyAssignment.effectiveUntil,
			effectiveFromDate: workPolicyAssignment.effectiveFromDate,
			effectiveUntilDate: workPolicyAssignment.effectiveUntilDate,
			createdAt: workPolicyAssignment.createdAt,
			matchedDurableRetirementPriorEvening: sql<boolean>`EXISTS (
				SELECT 1
				FROM audit_log al
				WHERE al.organization_id = ${workPolicyAssignment.organizationId}
					AND al.entity_type = 'work_policy'
					AND al.entity_id = ${workPolicyAssignment.policyId}::text
					AND al.action = 'work_policy.retired'
					AND (al.metadata::jsonb->>'retiredOnDate') = to_char(${workPolicyAssignment.effectiveFromDate}, 'YYYY-MM-DD')
					AND ((al.metadata::jsonb->>'retiredAtLocalStart')::timestamptz AT TIME ZONE 'UTC') = ${workPolicyAssignment.effectiveUntil}
			)`,
		})
		.from(workPolicyAssignment)
		.leftJoin(
			employeeEmploymentHistory,
			and(
				eq(employeeEmploymentHistory.id, workPolicyAssignment.sourceEmploymentHistoryId),
				eq(employeeEmploymentHistory.organizationId, workPolicyAssignment.organizationId),
			),
		)
		.where(
			and(
				eq(workPolicyAssignment.organizationId, input.organizationId),
				or(
					and(
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
					// Include deactivated `employment_terms` assignments for these employees so direct
					// terms pins observe retirement/deactivation even if the policy is later renamed or reactivated (A3-6).
					and(
						eq(workPolicyAssignment.assignmentType, "employee"),
						eq(workPolicyAssignment.sourceKind, "employment_terms"),
						inArray(workPolicyAssignment.employeeId, uniqueEmployeeIds),
					),
					// Astra #9 / Opus #2 / Astra #7 (Pass 8): Include deactivated retired legacy prior-evening
					// instant windows matching either current org-local midnight OR a durable `work_policy.retired`
					// `retiredAtLocalStart` boundary so org timezone changes never erase preserved evening hours.
					and(
						eq(workPolicyAssignment.sourceKind, "legacy"),
						sql`${workPolicyAssignment.effectiveFrom} IS NOT NULL`,
						sql`${workPolicyAssignment.effectiveUntil} IS NOT NULL`,
						sql`${workPolicyAssignment.effectiveUntilDate} = ${workPolicyAssignment.effectiveFromDate} + 1`,
						sql`(
							${workPolicyAssignment.effectiveUntil} = ((${workPolicyAssignment.effectiveFromDate}::timestamp AT TIME ZONE ${orgTimezone}) AT TIME ZONE 'UTC')
							OR EXISTS (
								SELECT 1
								FROM audit_log al
								WHERE al.organization_id = ${workPolicyAssignment.organizationId}
									AND al.entity_type = 'work_policy'
									AND al.entity_id = ${workPolicyAssignment.policyId}::text
									AND al.action = 'work_policy.retired'
									AND (al.metadata::jsonb->>'retiredOnDate') = to_char(${workPolicyAssignment.effectiveFromDate}, 'YYYY-MM-DD')
									AND ((al.metadata::jsonb->>'retiredAtLocalStart')::timestamptz AT TIME ZONE 'UTC') = ${workPolicyAssignment.effectiveUntil}
							)
						)`,
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
			),
		);

	// 2. Load custom working days, referenced team ownership (guarding 0120-0132 foreign teams), and work policy versions
	const customDayHistoryIds = termsRows
		.filter(({ row }) => row.scheduleMode === "custom_days")
		.map(({ row }) => row.id);
	const customDayTemplateVersionIds = [
		...new Set(
			defaultRows
				.filter((row) => row.scheduleMode === "custom_days")
				.map((row) => row.templateVersionId),
		),
	];
	const allReferencedTeamIds = [
		...new Set([
			...employeeRows.flatMap((row) => (row.teamId ? [row.teamId] : [])),
			...(input.teamIdOverrides
				? [...input.teamIdOverrides.values()].filter((id): id is string => Boolean(id))
				: []),
			...teamHistoryRows.map((row) => row.teamId),
			...defaultRows.flatMap((row) => (row.teamId ? [row.teamId] : [])),
			...assignmentRows.flatMap((row) => (row.teamId ? [row.teamId] : [])),
		]),
	];
	const allReferencedPolicyIds = [
		...new Set([
			...termsRows.flatMap(({ row }) => (row.workPolicyId ? [row.workPolicyId] : [])),
			...defaultRows.flatMap((row) => (row.workPolicyId ? [row.workPolicyId] : [])),
			...assignmentRows.map((row) => row.policyId),
		]),
	];

	const historyDayRows =
		customDayHistoryIds.length > 0
			? await db
					.select()
					.from(employeeEmploymentHistoryDay)
					.where(
						and(
							eq(employeeEmploymentHistoryDay.organizationId, input.organizationId),
							inArray(employeeEmploymentHistoryDay.employmentHistoryId, customDayHistoryIds),
						),
					)
			: [];

	const templateDayRows =
		customDayTemplateVersionIds.length > 0
			? await db
					.select()
					.from(contractTemplateVersionDay)
					.where(
						and(
							eq(contractTemplateVersionDay.organizationId, input.organizationId),
							inArray(contractTemplateVersionDay.templateVersionId, customDayTemplateVersionIds),
						),
					)
			: [];

	const referencedTeams =
		allReferencedTeamIds.length > 0
			? await db
					.select({ id: team.id, organizationId: team.organizationId, name: team.name })
					.from(team)
					.where(inArray(team.id, allReferencedTeamIds))
			: [];

	const policyWithVersionRows =
		allReferencedPolicyIds.length > 0
			? await db
					.select({
						policy: workPolicy,
						version: workPolicyVersion,
						schedule: workPolicySchedule,
						scheduleDay: workPolicyScheduleDay,
					})
					.from(workPolicy)
					.leftJoin(
						workPolicyVersion,
						and(
							eq(workPolicyVersion.policyId, workPolicy.id),
							eq(workPolicyVersion.organizationId, workPolicy.organizationId),
						),
					)
					.leftJoin(
						workPolicySchedule,
						eq(workPolicySchedule.policyVersionId, workPolicyVersion.id),
					)
					.leftJoin(
						workPolicyScheduleDay,
						eq(workPolicyScheduleDay.scheduleId, workPolicySchedule.id),
					)
					.where(
						and(
							eq(workPolicy.organizationId, input.organizationId),
							inArray(workPolicy.id, allReferencedPolicyIds),
						),
					)
			: [];

	const policyMap = new Map<string, typeof workPolicy.$inferSelect>();
	const versionMap = new Map<string, typeof workPolicyVersion.$inferSelect>();
	const scheduleMap = new Map<string, typeof workPolicySchedule.$inferSelect>();
	const scheduleDayMap = new Map<string, typeof workPolicyScheduleDay.$inferSelect>();
	for (const joined of policyWithVersionRows) {
		policyMap.set(joined.policy.id, joined.policy);
		if (joined.version) {
			versionMap.set(joined.version.id, joined.version);
		}
		if (joined.schedule) {
			scheduleMap.set(joined.schedule.id, joined.schedule);
		}
		if (joined.scheduleDay) {
			scheduleDayMap.set(joined.scheduleDay.id, joined.scheduleDay);
		}
	}
	const policyRows = [...policyMap.values()];
	const versionRows = [...versionMap.values()];
	const scheduleRows = [...scheduleMap.values()];
	const scheduleDayRows = [...scheduleDayMap.values()];

	const regulationVersionIds = versionRows.filter((v) => v.regulationEnabled).map((v) => v.id);
	const presenceVersionIds = versionRows.filter((v) => v.presenceEnabled).map((v) => v.id);

	const regulationRows =
		regulationVersionIds.length > 0
			? await db
					.select()
					.from(workPolicyRegulation)
					.where(inArray(workPolicyRegulation.policyVersionId, regulationVersionIds))
			: [];

	const presenceRows =
		presenceVersionIds.length > 0
			? await db
					.select()
					.from(workPolicyPresence)
					.where(inArray(workPolicyPresence.policyVersionId, presenceVersionIds))
			: [];

	// 3. Load grandchildren (break rules, break options) only when enabled
	const regulationIds = regulationRows.map((row) => row.id);

	const breakRuleRows =
		regulationIds.length > 0
			? await db
					.select()
					.from(workPolicyBreakRule)
					.where(inArray(workPolicyBreakRule.regulationId, regulationIds))
			: [];

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
			retiredOnDate:
				!p.isActive && p.updatedAt
					? plainDateAt(instantFromDate(p.updatedAt), orgTimezone).toString()
					: null,
			scheduleEnabled: p.scheduleEnabled,
			regulationEnabled: p.regulationEnabled,
			presenceEnabled: p.presenceEnabled,
			versions: attachPrecomputedScheduleAnchors(versionsByPolicyId.get(p.id) ?? []),
		});
	}

	const defaultsSnapshots: ContractDefaultSnapshot[] = defaultRows.map((row) => ({
		...row,
		customDays: templateDaysByVersionId.get(row.templateVersionId) ?? [],
	}));

	const periodsByEmployee = new Map<string, EmploymentPeriodSnapshot[]>();
	if (input.preloadedPeriods) {
		for (const p of input.preloadedPeriods) {
			const list = periodsByEmployee.get(p.employeeId) ?? [];
			list.push(p);
			periodsByEmployee.set(p.employeeId, list);
		}
	} else {
		for (const p of periodRows ?? []) {
			const list = periodsByEmployee.get(p.employeeId) ?? [];
			list.push(employmentPeriodSnapshotOf(p));
			periodsByEmployee.set(p.employeeId, list);
		}
	}
	if (input.employmentStartDateOverride) {
		const overrideInstant = parsePlainDate(input.employmentStartDateOverride)
			.toZonedDateTime(orgTimezone)
			.toInstant();
		for (const [empId, list] of periodsByEmployee) {
			const first = [...list].sort(
				(a, b) =>
					(a.startedAt ? Number(a.startedAt.epochMilliseconds) : Number.NEGATIVE_INFINITY) -
						(b.startedAt ? Number(b.startedAt.epochMilliseconds) : Number.NEGATIVE_INFINITY) ||
					a.id.localeCompare(b.id),
			)[0];
			if (first?.startProvenance === "recorded") {
				periodsByEmployee.set(
					empId,
					list.map((period) =>
						period.id === first.id ? { ...period, startedAt: overrideInstant } : period,
					),
				);
			}
		}
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
	for (const { row, createdAtIso } of termsRows) {
		const list = termsByEmployee.get(row.employeeId) ?? [];
		list.push(
			employmentHistorySnapshotOf(row, createdAtIso, historyDaysByHistoryId.get(row.id) ?? []),
		);
		termsByEmployee.set(row.employeeId, list);
	}

	// M7 / A3-6 / A3-19: Pre-partition policy assignments AND contract defaults by org, team, and
	// employee once per batch so resolving each employee only inspects org rows, their relevant
	// teams' rows, and their own employee rows (true O(1) per employee even with N distinct teams).
	const orgPolicyAssignments: PolicyAssignmentSnapshot[] = [];
	const teamPolicyAssignmentsByTeam = new Map<string, PolicyAssignmentSnapshot[]>();
	const employeePolicyAssignmentsByEmployee = new Map<string, PolicyAssignmentSnapshot[]>();
	for (const row of assignmentRows) {
		if (row.assignmentType === "employee" && row.employeeId) {
			const list = employeePolicyAssignmentsByEmployee.get(row.employeeId) ?? [];
			list.push(row);
			employeePolicyAssignmentsByEmployee.set(row.employeeId, list);
		} else if (row.assignmentType === "team" && row.teamId) {
			const list = teamPolicyAssignmentsByTeam.get(row.teamId) ?? [];
			list.push(row);
			teamPolicyAssignmentsByTeam.set(row.teamId, list);
		} else if (row.assignmentType === "organization") {
			orgPolicyAssignments.push(row);
		}
	}

	const orgContractDefaults: ContractDefaultSnapshot[] = [];
	const teamContractDefaultsByTeam = new Map<string, ContractDefaultSnapshot[]>();
	for (const def of defaultsSnapshots) {
		if (def.scope === "team" && def.teamId) {
			const list = teamContractDefaultsByTeam.get(def.teamId) ?? [];
			list.push(def);
			teamContractDefaultsByTeam.set(def.teamId, list);
		} else if (def.scope === "organization") {
			orgContractDefaults.push(def);
		}
	}

	// 5. Resolve per employee x date
	for (const emp of employeeRows) {
		const empCalendarTz =
			input.timezoneOverride ?? resolveEffectiveTimezone(emp.userTimezone, orgTimezone);
		const perDate = new Map<string, EffectiveContractOnDay>();
		const empPeriods = periodsByEmployee.get(emp.id) ?? [];
		const empTeamHistory = teamHistoryByEmployee.get(emp.id) ?? [];
		const empTerms = termsByEmployee.get(emp.id) ?? [];

		const hasTeamIdOverride = Boolean(input.teamIdOverrides?.has(emp.id));
		const teamIdOverride = hasTeamIdOverride ? (input.teamIdOverrides?.get(emp.id) ?? null) : null;

		const relevantTeamIds = new Set<string>();
		if (emp.teamId) relevantTeamIds.add(emp.teamId);
		if (teamIdOverride) relevantTeamIds.add(teamIdOverride);
		for (const th of empTeamHistory) {
			if (th.teamId) relevantTeamIds.add(th.teamId);
		}

		const empOwnAssignments = employeePolicyAssignmentsByEmployee.get(emp.id) ?? [];
		const empScopedAssignments: PolicyAssignmentSnapshot[] = [
			...empOwnAssignments,
			...orgPolicyAssignments,
		];
		const empScopedDefaults: ContractDefaultSnapshot[] = [...orgContractDefaults];
		for (const tid of relevantTeamIds) {
			const teamAsgns = teamPolicyAssignmentsByTeam.get(tid);
			if (teamAsgns) empScopedAssignments.push(...teamAsgns);
			const teamDefs = teamContractDefaultsByTeam.get(tid);
			if (teamDefs) empScopedDefaults.push(...teamDefs);
		}

		const ownDates = input.datesByEmployee?.get(emp.id);
		const days = ownDates ? [...new Set(ownDates)].map((date) => toPlainDate(date)) : uniqueDates;
		for (const day of days) {
			const resolved = resolveEffectiveContractPure({
				date: day,
				at: input.at,
				employeeId: emp.id,
				employeeContractType: emp.contractType,
				employeeEngagementKind: emp.engagementKind,
				employeeCalendarTimezone: empCalendarTz,
				organizationTimezone: orgTimezone,
				currentTeamId: emp.teamId,
				teamIdOverride,
				hasTeamIdOverride,
				employmentPeriods: empPeriods,
				teamHistory: empTeamHistory,
				validOrgTeamIds,
				foreignTeamIds,
				teamNames,
				confirmedTerms: empTerms,
				contractDefaults: empScopedDefaults,
				policyAssignments: empScopedAssignments,
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
