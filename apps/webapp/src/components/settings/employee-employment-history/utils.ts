import { DateTime } from "luxon";
import type { UpsertEmploymentHistory } from "@/lib/validations/employment-history";
import type { EmploymentHistoryEntry, EmploymentHistoryPeriod, FormValues } from "./types";

export const defaultFormValues: FormValues = {
	validFrom: "",
	reviewState: "draft",
	weeklyHours: "40",
	workModel: "onsite",
	contractType: "fixed",
	workPolicyId: "__inherit__",
	hourlyRate: "",
	probationStartsOn: "",
	probationEndsOn: "",
	changeReason: "",
};

export function toDateTime(value: Date | string | null | undefined) {
	if (!value) return null;
	return value instanceof Date
		? DateTime.fromJSDate(value, { zone: "utc" })
		: DateTime.fromISO(value, { zone: "utc" });
}

function dateInputToDate(value: string) {
	return DateTime.fromISO(value, { zone: "utc" }).toJSDate();
}

export function toEmploymentHistoryPayload(value: FormValues): UpsertEmploymentHistory {
	const weeklyHours = Number(value.weeklyHours);
	return {
		validFrom: dateInputToDate(value.validFrom),
		status: "active",
		contractType: value.contractType,
		weeklyContractMinutes: Number.isFinite(weeklyHours) ? Math.round(weeklyHours * 60) : 0,
		probationStartsOn: value.probationStartsOn ? dateInputToDate(value.probationStartsOn) : null,
		probationEndsOn: value.probationEndsOn ? dateInputToDate(value.probationEndsOn) : null,
		workModel: value.workModel,
		workPolicyId: value.workPolicyId === "__inherit__" ? null : value.workPolicyId,
		hourlyRate: value.contractType === "hourly" ? value.hourlyRate : null,
		currency: "EUR",
		changeReason: value.changeReason.trim() || null,
		reviewState: value.reviewState,
	};
}

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function getCurrencyFormatter(currency: string) {
	const cachedFormatter = currencyFormatters.get(currency);
	if (cachedFormatter) return cachedFormatter;
	const formatter = Intl.NumberFormat(undefined, { style: "currency", currency });
	currencyFormatters.set(currency, formatter);
	return formatter;
}

export function formatDate(value: Date | string | null | undefined) {
	const date = toDateTime(value);
	return date?.isValid ? date.toLocaleString(DateTime.DATE_MED) : null;
}

export function formatCurrency(amount: string | null, currency: string) {
	return amount ? getCurrencyFormatter(currency).format(Number(amount)) : null;
}

export function formatWeeklyHours(minutes: number) {
	const hours = minutes / 60;
	return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

export function isCurrentConfirmed(entry: EmploymentHistoryEntry, now: DateTime) {
	if (entry.reviewState !== "confirmed") return false;
	const validFrom = toDateTime(entry.validFrom);
	const validUntil = toDateTime(entry.validUntil);
	return !!validFrom?.isValid && validFrom <= now && (!validUntil?.isValid || validUntil > now);
}

export function isFutureConfirmed(entry: EmploymentHistoryEntry, now: DateTime) {
	const validFrom = toDateTime(entry.validFrom);
	return entry.reviewState === "confirmed" && !!validFrom?.isValid && validFrom > now;
}

export function canConfirm(entry: EmploymentHistoryEntry) {
	return entry.reviewState === "draft" || entry.reviewState === "pending";
}

export function canCancel(entry: EmploymentHistoryEntry, now: DateTime) {
	const validFrom = toDateTime(entry.validFrom);
	return canConfirm(entry) || (!!validFrom?.isValid && validFrom > now);
}

export type EmploymentHistoryStint = {
	period: EmploymentHistoryPeriod | null;
	entries: EmploymentHistoryEntry[];
	/** The gap before this stint, back to the previous stint's end, if both are known. */
	gapBefore: { from: Date | string; to: Date | string } | null;
};

/**
 * Groups terms by employment period, newest stint first, keeping the
 * incoming order inside each stint. A gap is shown only between recorded
 * dates; an unknown legacy start never invents one.
 */
export function groupHistoryByEmployment(
	history: readonly EmploymentHistoryEntry[],
): EmploymentHistoryStint[] {
	const stints = new Map<string, EmploymentHistoryStint>();
	for (const entry of history) {
		const key = entry.employmentPeriodId ?? entry.employmentPeriod?.id ?? "__unknown__";
		const stint = stints.get(key) ?? {
			period: entry.employmentPeriod ?? null,
			entries: [],
			gapBefore: null,
		};
		stint.entries.push(entry);
		stints.set(key, stint);
	}
	const ordered = [...stints.values()].sort((left, right) => {
		const leftStart = toDateTime(left.period?.startedAt)?.toMillis() ?? Number.NEGATIVE_INFINITY;
		const rightStart = toDateTime(right.period?.startedAt)?.toMillis() ?? Number.NEGATIVE_INFINITY;
		return rightStart - leftStart;
	});
	for (const [index, stint] of ordered.entries()) {
		const previous = ordered[index + 1];
		const start = stint.period?.startedAt;
		const previousEnd = previous?.period?.endedAt;
		if (start && previousEnd) stint.gapBefore = { from: previousEnd, to: start };
	}
	return ordered;
}

