import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
	parseInstant,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import {
	hourlyWageFromForm,
	type UpsertEmploymentHistory,
} from "@/lib/validations/employment-history";
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

export function toInstant(value: Date | string | null | undefined): Instant | null {
	if (!value) return null;
	try {
		if (value instanceof Date) {
			if (Number.isNaN(value.getTime())) return null;
			return instantFromDate(value);
		}
		const trimmed = value.trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
			return parsePlainDate(trimmed).toZonedDateTime("UTC").toInstant();
		}
		return parseInstant(trimmed);
	} catch {
		return null;
	}
}

function dateInputToDate(value: string) {
	const instant = toInstant(value);
	if (!instant) {
		throw new RangeError(`Invalid employment history date: ${value}`);
	}
	return dateFromInstant(instant);
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
		hourlyRate: hourlyWageFromForm(value.contractType, value.hourlyRate),
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

export function formatDate(value: Date | string | null | undefined, locale = "en") {
	const instant = toInstant(value);
	return instant ? formatPlainDate(plainDateAt(instant, "UTC"), locale, "dateMedium") : null;
}

export function formatCurrency(amount: number | null, currency: string) {
	return amount === null ? null : getCurrencyFormatter(currency).format(amount);
}

export function formatWeeklyHours(minutes: number) {
	const hours = minutes / 60;
	return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

export function isCurrentConfirmed(entry: EmploymentHistoryEntry, now: Instant) {
	if (entry.reviewState !== "confirmed") return false;
	const validFrom = toInstant(entry.validFrom);
	const validUntil = toInstant(entry.validUntil);
	return (
		validFrom !== null &&
		compareInstants(validFrom, now) <= 0 &&
		(validUntil === null || compareInstants(validUntil, now) > 0)
	);
}

export function isFutureConfirmed(entry: EmploymentHistoryEntry, now: Instant) {
	const validFrom = toInstant(entry.validFrom);
	return (
		entry.reviewState === "confirmed" && validFrom !== null && compareInstants(validFrom, now) > 0
	);
}

export function canConfirm(entry: EmploymentHistoryEntry) {
	return entry.reviewState === "draft" || entry.reviewState === "pending";
}

export function canCancel(entry: EmploymentHistoryEntry, now: Instant) {
	const validFrom = toInstant(entry.validFrom);
	return canConfirm(entry) || (validFrom !== null && compareInstants(validFrom, now) > 0);
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
		const leftStart =
			toInstant(left.period?.startedAt)?.epochMilliseconds ?? Number.NEGATIVE_INFINITY;
		const rightStart =
			toInstant(right.period?.startedAt)?.epochMilliseconds ?? Number.NEGATIVE_INFINITY;
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
