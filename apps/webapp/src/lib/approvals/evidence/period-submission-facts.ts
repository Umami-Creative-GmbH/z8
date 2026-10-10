import { createHash } from "node:crypto";
import { canonicalJson } from "./absence-facts";

/**
 * Submitted facts of a period submission (#1059, #1061): what the employee confirmed, captured in
 * the submission's transaction. The card, the inbox and every delivery channel show these facts,
 * never a later read of the period.
 */
export const PERIOD_SUBMISSION_EVIDENCE_SCHEMA_VERSION = 1;

export type PeriodSubmissionDayPart = "full_day" | "am" | "pm";

/** An approved absence in the period, clipped to the submitted range. */
export interface PeriodSubmissionAbsenceFact {
	categoryName: string;
	/** Inclusive local dates; a clipped end is a full day. */
	startDate: string;
	startPeriod: PeriodSubmissionDayPart;
	endDate: string;
	endPeriod: PeriodSubmissionDayPart;
}

/** A public holiday assigned to the employee in the period, clipped to the submitted range. */
export interface PeriodSubmissionHolidayFact {
	name: string;
	startDate: string;
	endDate: string;
}

/** A compliance violation recorded in the range, on its local date in the period's zone. */
export interface PeriodSubmissionViolationFact {
	date: string;
	type: string;
}

export interface PeriodSubmissionSubmittedFacts {
	schemaVersion: typeof PERIOD_SUBMISSION_EVIDENCE_SCHEMA_VERSION;
	kind: "period_submission";
	organizationId: string;
	periodSubmissionId: string;
	subjectEmployeeId: string;
	requesterEmployeeId: string;
	period: {
		cadence: "weekly" | "monthly";
		timezone: string;
		/** Inclusive local dates of the submitted range. */
		startDate: string;
		endDate: string;
		/** The range as instants, `[rangeStart, rangeEnd)`. */
		rangeStart: string;
		rangeEnd: string;
	};
	work: {
		/** Completed work in the range, split at local midnight in the period's zone. */
		totalMinutes: number;
		/** Minutes per local date (`YYYY-MM-DD`); days without work are absent. */
		dayTotals: Record<string, number>;
	};
	/** Approved absences in the range (#1061), in date order. */
	absences: PeriodSubmissionAbsenceFact[];
	/** Public holidays in the range (#1061), in date order. */
	holidays: PeriodSubmissionHolidayFact[];
	/**
	 * The work policy's target for the range after absences and holidays (#1061); null when no
	 * work policy gives the employee a target in the range.
	 */
	target: {
		totalMinutes: number;
		/** Target minutes per local date; days without a target are absent. */
		dayTargets: Record<string, number>;
	} | null;
	/** Compliance violations recorded in the range (#1061), in date order. Read-only. */
	violations: PeriodSubmissionViolationFact[];
}

export interface PeriodSubmissionSubmittedLabels {
	subjectName: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMinutesRecord(value: unknown): value is Record<string, number> {
	return isRecord(value) && Object.values(value).every((minutes) => Number.isInteger(minutes));
}

const DAY_PARTS = new Set<unknown>(["full_day", "am", "pm"]);

function isAbsenceFact(value: unknown): value is PeriodSubmissionAbsenceFact {
	return (
		isRecord(value) &&
		typeof value.categoryName === "string" &&
		typeof value.startDate === "string" &&
		typeof value.endDate === "string" &&
		DAY_PARTS.has(value.startPeriod) &&
		DAY_PARTS.has(value.endPeriod)
	);
}

function isHolidayFact(value: unknown): value is PeriodSubmissionHolidayFact {
	return (
		isRecord(value) &&
		typeof value.name === "string" &&
		typeof value.startDate === "string" &&
		typeof value.endDate === "string"
	);
}

function isViolationFact(value: unknown): value is PeriodSubmissionViolationFact {
	return isRecord(value) && typeof value.date === "string" && typeof value.type === "string";
}

/** Whether stored facts have the shape the card reads (identity is checked by the store). */
export function isPeriodSubmissionSubmittedFacts(
	value: unknown,
): value is PeriodSubmissionSubmittedFacts {
	if (!isRecord(value) || value.kind !== "period_submission") return false;
	const { period, work, target } = value;
	return (
		value.schemaVersion === PERIOD_SUBMISSION_EVIDENCE_SCHEMA_VERSION &&
		typeof value.subjectEmployeeId === "string" &&
		isRecord(period) &&
		(period.cadence === "weekly" || period.cadence === "monthly") &&
		typeof period.timezone === "string" &&
		typeof period.startDate === "string" &&
		typeof period.endDate === "string" &&
		typeof period.rangeStart === "string" &&
		typeof period.rangeEnd === "string" &&
		isRecord(work) &&
		Number.isInteger(work.totalMinutes) &&
		isMinutesRecord(work.dayTotals) &&
		Array.isArray(value.absences) &&
		value.absences.every(isAbsenceFact) &&
		Array.isArray(value.holidays) &&
		value.holidays.every(isHolidayFact) &&
		(target === null ||
			(isRecord(target) &&
				Number.isInteger(target.totalMinutes) &&
				isMinutesRecord(target.dayTargets))) &&
		Array.isArray(value.violations) &&
		value.violations.every(isViolationFact)
	);
}

export function fingerprintPeriodSubmissionFacts(facts: PeriodSubmissionSubmittedFacts): string {
	return `period_submission:v${PERIOD_SUBMISSION_EVIDENCE_SCHEMA_VERSION}:${createHash("sha256")
		.update(canonicalJson(facts))
		.digest("hex")}`;
}
