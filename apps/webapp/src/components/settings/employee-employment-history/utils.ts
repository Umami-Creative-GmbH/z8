import { DateTime } from "luxon";
import type { UpsertEmploymentHistory } from "@/lib/validations/employment-history";
import type { EmploymentHistoryEntry, FormValues } from "./types";

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
