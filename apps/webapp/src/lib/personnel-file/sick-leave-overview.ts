import type { SickDetail } from "@/lib/absences/types";
import { comparePlainDates, type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";

/**
 * The officer "Sick leave" overview (#985): the sick-leave absences of the
 * employees whose sick notes the viewer manages, with how many sick notes
 * each has. Strictly passive: it only lists. The query is in
 * sick-leave-overview-store.ts; this module is client and server safe.
 */

export type SickLeaveNotesFilter = "all" | "missing" | "present";

/** Rejected sick leave is not listed: only pending and approved absences. */
export type SickLeaveStatus = "pending" | "approved";

export interface SickLeaveOverviewFilters {
	/** First day of the range, YYYY-MM-DD, in the organization's calendar. */
	from: string;
	/** Last day of the range (inclusive), YYYY-MM-DD. */
	to: string;
	employeeId: string | null;
	teamId: string | null;
	sickDetail: SickDetail | null;
	/** "missing": with certificate but no linked sick note; "present": at least one linked note. */
	notes: SickLeaveNotesFilter;
	status: SickLeaveStatus | null;
	page: number;
	pageSize: number;
}

/** A linked sick note as the overview names it: enough to open it, no contents. */
export interface SickLeaveOverviewNote {
	id: string;
	title: string;
}

/** One sick-leave absence of the overview. */
export interface SickLeaveOverviewRow {
	absenceId: string;
	employeeId: string;
	employeeName: string;
	employeeNumber: string | null;
	/** A former employee: their absences inside the range stay listed. */
	isFormer: boolean;
	/** YYYY-MM-DD */
	startDate: string;
	startPeriod: "full_day" | "am" | "pm";
	/** YYYY-MM-DD */
	endDate: string;
	endPeriod: "full_day" | "am" | "pm";
	status: SickLeaveStatus;
	sickDetail: SickDetail | null;
	/** Absence days on the employee's working days (Absences ADR 0001). */
	absenceDays: number;
	/** Every sick note linked to the absence. */
	sickNoteCount: number;
	/** The linked sick notes the viewer may open, oldest first. */
	sickNotes: SickLeaveOverviewNote[];
}

export const SICK_LEAVE_DEFAULT_RANGE_MONTHS = 3;
export const SICK_LEAVE_PAGE_SIZES = [10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 25;

const SICK_DETAILS: readonly SickDetail[] = [
	"child_sick",
	"with_certificate",
	"without_certificate",
	"other",
];
const NOTES_FILTERS: readonly SickLeaveNotesFilter[] = ["all", "missing", "present"];
const STATUSES: readonly SickLeaveStatus[] = ["pending", "approved"];

type RawParams = Record<string, string | string[] | undefined>;

function single(raw: RawParams, key: string): string | undefined {
	const value = raw[key];
	return typeof value === "string" ? value : undefined;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | null {
	return value !== undefined && (allowed as readonly string[]).includes(value)
		? (value as T)
		: null;
}

function plainDateParam(value: string | undefined): PlainDate | null {
	if (value === undefined) return null;
	try {
		return parsePlainDate(value);
	} catch {
		return null;
	}
}

function positiveInteger(value: string | undefined): number | null {
	if (value === undefined || !/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The overview's filters from URL search params. The range is a range of
 * plain days in the organization's calendar: `today` is the organization's
 * today, and the default range is the last 3 months up to it. Values it does
 * not know fall back to the defaults; a range given backwards is swapped.
 */
export function parseSickLeaveOverviewParams(
	raw: RawParams,
	today: PlainDate,
): SickLeaveOverviewFilters {
	let from =
		plainDateParam(single(raw, "from")) ??
		today.subtract({ months: SICK_LEAVE_DEFAULT_RANGE_MONTHS });
	let to = plainDateParam(single(raw, "to")) ?? today;
	if (comparePlainDates(from, to) > 0) [from, to] = [to, from];
	const employeeId = single(raw, "employeeId");
	const teamId = single(raw, "teamId");
	const pageSize = positiveInteger(single(raw, "pageSize"));
	return {
		from: from.toString(),
		to: to.toString(),
		employeeId: isCanonicalUuid(employeeId) ? employeeId : null,
		teamId: isCanonicalUuid(teamId) ? teamId : null,
		sickDetail: oneOf(single(raw, "sickDetail"), SICK_DETAILS),
		notes: oneOf(single(raw, "notes"), NOTES_FILTERS) ?? "all",
		status: oneOf(single(raw, "status"), STATUSES),
		page: positiveInteger(single(raw, "page")) ?? 1,
		pageSize:
			pageSize !== null && (SICK_LEAVE_PAGE_SIZES as readonly number[]).includes(pageSize)
				? pageSize
				: DEFAULT_PAGE_SIZE,
	};
}
