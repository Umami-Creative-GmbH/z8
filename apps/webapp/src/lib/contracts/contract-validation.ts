import { ZodError } from "zod";
import { contractMigrationConflict } from "@/db/schema";
import type {
	ArbzgScope,
	BalanceMode,
	EmploymentProfile,
	OnCallHoursKind,
	PresenceOverride,
	ScheduleMode,
	ScheduleSource,
} from "@/db/schema/contract-types";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { parseCustomWorkDays } from "./custom-days";
import type { CustomWorkDay, WeeklyHoursMismatchWarning, WorkModel } from "./types";

export type ContractWriteTx = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
export type ContractDbOrTx = DatabaseClient | ContractWriteTx;

export const STATUTORY_ON_CALL_WEEKLY_FALLBACK_MINUTES = 1200; // 20h/week (§ 12 Abs. 1 Satz 3 TzBfG)
export const STATUTORY_ON_CALL_MIN_DAILY_MINUTES = 180; // 3 consecutive hours (§ 12 Abs. 1 Satz 4 TzBfG)
export const STATUTORY_ON_CALL_DAILY_PREVIEW_NOTE =
	"At least three consecutive hours per call-in (§ 12 Abs. 1 Satz 4 TzBfG)";

export const VALID_SCHEDULE_MODES: readonly ScheduleMode[] = [
	"inherit",
	"policy",
	"hours_only",
	"custom_days",
];
export const VALID_TEMPLATE_SCHEDULE_MODES = ["policy", "hours_only", "custom_days"] as const;
export const VALID_PRESENCE_OVERRIDES: readonly PresenceOverride[] = [
	"inherit",
	"exempt",
	"require_onsite",
];
export const VALID_BALANCE_MODES: readonly BalanceMode[] = ["tracked", "trust_based"];
export const VALID_SCHEDULE_SOURCES: readonly ScheduleSource[] = [
	"policy",
	"published_shifts",
	"on_call",
];
export const VALID_EMPLOYMENT_PROFILES: readonly EmploymentProfile[] = [
	"regular",
	"minijob",
	"short_term",
	"working_student",
	"apprentice",
];
export const VALID_ARBZG_SCOPES: readonly ArbzgScope[] = ["standard", "executive_exempt"];
export const VALID_ON_CALL_HOURS_KINDS: readonly OnCallHoursKind[] = [
	"exact",
	"minimum",
	"maximum",
	"unspecified",
];

/**
 * Validates and normalizes an ISO calendar date string (`YYYY-MM-DD`) using Temporal.
 */
export function parseIsoCalendarDate(value: string, field = "effectiveFromDate"): string {
	const trimmed = value.trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		throw new ValidationError({
			message: `Invalid date "${value}". Expected YYYY-MM-DD.`,
			field,
			refusal: "invalid_calendar_date",
		});
	}
	try {
		return parsePlainDate(trimmed).toString();
	} catch {
		throw new ValidationError({
			message: `Invalid calendar date "${value}".`,
			field,
			refusal: "invalid_calendar_date",
		});
	}
}

/**
 * Validates weekly contract minutes (`0..10080` integer or `null`).
 */
export function validateWeeklyContractMinutes(
	minutes: number | null | undefined,
	field = "weeklyContractMinutes",
): number | null {
	if (minutes === null || minutes === undefined) return null;
	if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10080) {
		throw new ValidationError({
			message: "Weekly contract minutes must be an integer between 0 and 10080.",
			field,
			refusal: "invalid_weekly_minutes",
		});
	}
	return minutes;
}

/**
 * Validates custom working days through the single shared parser (`parseCustomWorkDays`).
 */
export function validateAndNormalizeCustomDays(
	scheduleMode: ScheduleMode | null | undefined,
	customDays: readonly CustomWorkDay[] | null | undefined,
	field = "customDays",
): readonly CustomWorkDay[] {
	if (customDays === null || customDays === undefined) {
		if (scheduleMode === "custom_days") {
			throw new ValidationError({
				message: "Custom working days are required when schedule mode is custom_days.",
				field,
				refusal: "custom_days_required",
			});
		}
		return [];
	}

	let normalized: readonly CustomWorkDay[];
	try {
		normalized = parseCustomWorkDays(customDays);
	} catch (error) {
		const message =
			error instanceof ZodError
				? (error.issues[0]?.message ?? "Invalid custom working days")
				: "Invalid custom working days";
		throw new ValidationError({
			message,
			field,
			refusal: "invalid_custom_days",
		});
	}

	if (scheduleMode === "custom_days" && normalized.length === 0) {
		throw new ValidationError({
			message: "At least one day configuration is required when schedule mode is custom_days.",
			field,
			refusal: "custom_days_required",
		});
	}

	return normalized;
}

/**
 * Applies the remote presence default: selecting `workModel = 'remote'` defaults
 * `presenceOverride` to `'exempt'` when not explicitly specified, while still allowing
 * explicit `'require_onsite'` or `'inherit'` overrides.
 */
export function resolveRemotePresenceDefault<T extends PresenceOverride | null>(input: {
	workModel: WorkModel | null | undefined;
	presenceOverride: T | undefined;
	fallback: T;
}): { presenceOverride: PresenceOverride | T; remoteExemptDefaultApplied: boolean } {
	if (input.presenceOverride !== undefined) {
		return {
			presenceOverride: input.presenceOverride,
			remoteExemptDefaultApplied: false,
		};
	}
	if (input.workModel === "remote") {
		return {
			presenceOverride: "exempt",
			remoteExemptDefaultApplied: true,
		};
	}
	return {
		presenceOverride: input.fallback,
		remoteExemptDefaultApplied: false,
	};
}

/**
 * Validates employee-owned or template § 12 TzBfG on-call terms matching the
 * PostgreSQL 3VL-safe `IS TRUE` check constraints on `employee_employment_history`
 * and `contract_template_version`.
 */
export function validateOnCallTerms(input: {
	scheduleSource: ScheduleSource | null | undefined;
	onCallHoursKind: OnCallHoursKind | null | undefined;
	onCallWeeklyMinutes: number | null | undefined;
	onCallDailyMinutes: number | null | undefined;
	/** Employee confirmed terms require an explicit hours kind; templates may leave it null. */
	requireKindWhenOnCall: boolean;
}): {
	onCallHoursKind: OnCallHoursKind | null;
	onCallWeeklyMinutes: number | null;
	onCallDailyMinutes: number | null;
} {
	const kind = input.onCallHoursKind ?? null;
	const weekly = input.onCallWeeklyMinutes ?? null;
	const daily = input.onCallDailyMinutes ?? null;

	if (input.scheduleSource !== "on_call") {
		if (kind !== null || weekly !== null || daily !== null) {
			throw new ValidationError({
				message: "On-call hours fields may only be set when schedule source is on_call.",
				field: "onCallHoursKind",
				refusal: "on_call_fields_require_on_call_source",
			});
		}
		return { onCallHoursKind: null, onCallWeeklyMinutes: null, onCallDailyMinutes: null };
	}

	if (kind === null) {
		if (input.requireKindWhenOnCall) {
			throw new ValidationError({
				message:
					"On-call agreements must specify an hours kind (exact, minimum, maximum, or unspecified).",
				field: "onCallHoursKind",
				refusal: "on_call_hours_kind_required",
			});
		}
		if (weekly !== null) {
			throw new ValidationError({
				message: "On-call weekly minutes require an on-call hours kind.",
				field: "onCallWeeklyMinutes",
				refusal: "on_call_hours_kind_required",
			});
		}
	} else if (kind === "unspecified") {
		if (weekly !== null) {
			throw new ValidationError({
				message:
					"Unspecified on-call agreements cannot set weekly minutes (statutory 20h/week applies).",
				field: "onCallWeeklyMinutes",
				refusal: "on_call_unspecified_forbids_weekly_minutes",
			});
		}
	} else {
		if (weekly === null || !Number.isInteger(weekly) || weekly < 1 || weekly > 10080) {
			throw new ValidationError({
				message:
					"On-call weekly minutes must be an integer between 1 and 10080 for exact, minimum, or maximum agreements.",
				field: "onCallWeeklyMinutes",
				refusal: "invalid_on_call_weekly_minutes",
			});
		}
	}

	if (daily !== null && (!Number.isInteger(daily) || daily < 1 || daily > 1440)) {
		throw new ValidationError({
			message: "On-call per-call daily duration must be an integer between 1 and 1440 minutes.",
			field: "onCallDailyMinutes",
			refusal: "invalid_on_call_daily_minutes",
		});
	}

	return {
		onCallHoursKind: kind,
		onCallWeeklyMinutes: weekly,
		onCallDailyMinutes: daily,
	};
}

/**
 * Formats human-readable § 12 TzBfG on-call statutory preview guidance.
 */
export function buildOnCallStatutoryPreview(input: {
	scheduleSource: ScheduleSource;
	onCallHoursKind: OnCallHoursKind | null;
	onCallWeeklyMinutes: number | null;
	onCallDailyMinutes: number | null;
}): {
	isOnCall: boolean;
	hoursKind: OnCallHoursKind | null;
	effectiveWeeklyMinutes: number | null;
	callInMinBandMinutes: number | null;
	callInMaxBandMinutes: number | null;
	dailyMinutes: number | null;
	dailyDurationPreview: string | null;
} {
	if (input.scheduleSource !== "on_call" || !input.onCallHoursKind) {
		return {
			isOnCall: false,
			hoursKind: null,
			effectiveWeeklyMinutes: null,
			callInMinBandMinutes: null,
			callInMaxBandMinutes: null,
			dailyMinutes: null,
			dailyDurationPreview: null,
		};
	}

	const kind = input.onCallHoursKind;
	const weekly = input.onCallWeeklyMinutes;
	let effectiveWeeklyMinutes: number | null = weekly;
	let callInMinBandMinutes: number | null = null;
	let callInMaxBandMinutes: number | null = null;

	if (kind === "unspecified") {
		effectiveWeeklyMinutes = STATUTORY_ON_CALL_WEEKLY_FALLBACK_MINUTES;
		callInMinBandMinutes = STATUTORY_ON_CALL_WEEKLY_FALLBACK_MINUTES;
		callInMaxBandMinutes = STATUTORY_ON_CALL_WEEKLY_FALLBACK_MINUTES;
	} else if (weekly !== null) {
		if (kind === "exact") {
			callInMinBandMinutes = weekly;
			callInMaxBandMinutes = weekly;
		} else if (kind === "minimum") {
			callInMinBandMinutes = weekly;
			callInMaxBandMinutes = Math.round(weekly * 1.25);
		} else if (kind === "maximum") {
			callInMinBandMinutes = Math.round(weekly * 0.8);
			callInMaxBandMinutes = weekly;
		}
	}

	const dailyDurationPreview =
		input.onCallDailyMinutes === null
			? STATUTORY_ON_CALL_DAILY_PREVIEW_NOTE
			: `${input.onCallDailyMinutes} minutes per call-in`;

	return {
		isOnCall: true,
		hoursKind: kind,
		effectiveWeeklyMinutes,
		callInMinBandMinutes,
		callInMaxBandMinutes,
		dailyMinutes: input.onCallDailyMinutes,
		dailyDurationPreview,
	};
}

/**
 * Records a weekly-hours vs. detailed-policy day-sum mismatch conflict idempotently
 * ONLY on mutating write paths (never during read/preview).
 */
export async function recordWeeklyHoursMismatchConflictInTx(
	tx: ContractWriteTx,
	input: {
		organizationId: string;
		employeeId: string;
		employmentHistoryId: string | null;
		warning: WeeklyHoursMismatchWarning;
		triggerSource: "contract_default" | "contract_change";
		effectiveFromDate: string;
		contractDefaultId?: string | null;
	},
): Promise<boolean> {
	const dedupeKey = [
		"weekly_hours_mismatch",
		input.employeeId,
		input.warning.policyId,
		input.warning.employeeWeeklyMinutes,
		input.warning.policyDetailedDaySumMinutes,
		input.effectiveFromDate,
	].join(":");

	const inserted = await tx
		.insert(contractMigrationConflict)
		.values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			employmentHistoryId: input.employmentHistoryId,
			workPolicyId: input.warning.policyId,
			conflictKind: "weekly_hours_policy_day_sum_mismatch",
			dedupeKey,
			status: "open",
			details: {
				triggerSource: input.triggerSource,
				effectiveFromDate: input.effectiveFromDate,
				contractDefaultId: input.contractDefaultId ?? null,
				employeeWeeklyMinutes: input.warning.employeeWeeklyMinutes,
				policyDetailedDaySumMinutes: input.warning.policyDetailedDaySumMinutes,
				policyId: input.warning.policyId,
				policyVersionId: input.warning.policyVersionId,
			},
		})
		.onConflictDoNothing()
		.returning({ id: contractMigrationConflict.id });

	return inserted.length > 0;
}
