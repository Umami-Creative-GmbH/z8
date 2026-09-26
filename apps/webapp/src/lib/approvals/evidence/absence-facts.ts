import { createHash } from "node:crypto";
import {
	type Instant,
	instantFromDate,
	instantToCanonicalString,
	parsePlainDate,
	parsePlainTimeMinute,
} from "@/lib/datetime/temporal-core";
import { ApprovalEvidenceError } from "./errors";

export const ABSENCE_EVIDENCE_SCHEMA_VERSION = 1;

type DayPeriod = "full_day" | "am" | "pm";
type DurationKind = "full_day" | "partial_day";

/**
 * Logical coverage exactly as requested. Dates are logical calendar dates that
 * never shift with a viewer or server zone. Explicit partial-day times are
 * wall-clock values entered without a captured zone; they are not instants.
 */
export type AbsenceSubmittedCoverage =
	| {
			kind: "full_day";
			startDate: string;
			endDate: string;
	  }
	| {
			kind: "half_day_periods";
			startDate: string;
			startPeriod: DayPeriod;
			endDate: string;
			endPeriod: DayPeriod;
	  }
	| {
			kind: "explicit_partial";
			startDate: string;
			startTime: string;
			endDate: string;
			endTime: string;
			overnight: boolean;
			wallClockZone: "not_captured";
	  };

export type AbsenceInputEncoding =
	| "duration_kind_full_day"
	| "period_defaults_full_day"
	| "legacy_period_only"
	| "duration_kind_explicit_times";

export interface AbsenceCompatibilityEncoding {
	/** The absence_entry shape written at submission (lossy for explicit times). */
	entry: {
		startDate: string;
		startPeriod: DayPeriod;
		endDate: string;
		endPeriod: DayPeriod;
	};
	/** Synthetic UTC bounds of the canonical time_record; not requested clock times. */
	canonicalRecord: {
		id: string;
		startAt: string;
		endAt: string;
		encoding: "utc_synthetic_bounds";
	};
}

export interface AbsenceMaterialFacts {
	schemaVersion: typeof ABSENCE_EVIDENCE_SCHEMA_VERSION;
	kind: "absence";
	organizationId: string;
	absenceId: string;
	subjectEmployeeId: string;
	requesterEmployeeId: string;
	categoryId: string;
	coverage: AbsenceSubmittedCoverage;
}

export interface AbsenceSubmittedFacts extends AbsenceMaterialFacts {
	inputEncoding: AbsenceInputEncoding;
	compatibility: AbsenceCompatibilityEncoding;
}

export interface AbsenceSubmittedLabels {
	subjectName: string | null;
	requesterName: string | null;
	submitterName: string | null;
	categoryName: string | null;
}

export interface AbsenceRawCoverageInput {
	startDate?: string;
	endDate?: string;
	durationKind?: DurationKind;
	startPeriod?: DayPeriod;
	endPeriod?: DayPeriod;
	startTime?: string;
	endTime?: string;
}

export interface AbsenceNormalizedCoverageInput {
	startDate: string;
	endDate: string;
	durationKind: DurationKind;
	startPeriod: DayPeriod;
	endPeriod: DayPeriod;
	startTime?: string;
	endTime?: string;
}

function hasText(value: string | undefined): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function requireLogicalDate(value: string, field: string): string {
	try {
		return parsePlainDate(value).toString();
	} catch {
		throw new ApprovalEvidenceError("evidence_incomplete", { field });
	}
}

function requireWallClockTime(
	value: string | undefined,
	field: string,
): string {
	if (!hasText(value)) {
		throw new ApprovalEvidenceError("evidence_incomplete", { field });
	}
	try {
		return parsePlainTimeMinute(value.trim()).toString({
			smallestUnit: "minute",
		});
	} catch {
		throw new ApprovalEvidenceError("evidence_incomplete", { field });
	}
}

/**
 * Derives requested coverage from the raw submitted input, before the lossy
 * absence_entry (AM/AM) and canonical synthetic-timestamp encodings. Anything
 * that cannot be classified is essential missing evidence, never a guess.
 */
export function deriveAbsenceSubmittedCoverage(
	raw: AbsenceRawCoverageInput,
	normalized: AbsenceNormalizedCoverageInput,
): { coverage: AbsenceSubmittedCoverage; inputEncoding: AbsenceInputEncoding } {
	const startDate = requireLogicalDate(normalized.startDate, "startDate");
	const endDate = requireLogicalDate(normalized.endDate, "endDate");
	if (startDate > endDate) {
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "dateRange",
		});
	}

	if (normalized.durationKind === "full_day") {
		return {
			coverage: { kind: "full_day", startDate, endDate },
			inputEncoding:
				raw.durationKind === "full_day"
					? "duration_kind_full_day"
					: "period_defaults_full_day",
		};
	}

	const rawHasTimes = hasText(raw.startTime) || hasText(raw.endTime);
	if (raw.durationKind === "partial_day" && rawHasTimes) {
		const startTime = requireWallClockTime(normalized.startTime, "startTime");
		const endTime = requireWallClockTime(normalized.endTime, "endTime");
		return {
			coverage: {
				kind: "explicit_partial",
				startDate,
				startTime,
				endDate,
				endTime,
				overnight: endDate !== startDate,
				wallClockZone: "not_captured",
			},
			inputEncoding: "duration_kind_explicit_times",
		};
	}

	const legacyPeriodOnly =
		raw.durationKind === undefined &&
		!rawHasTimes &&
		[raw.startPeriod, raw.endPeriod].some(
			(period) => period === "am" || period === "pm",
		);
	if (legacyPeriodOnly) {
		return {
			coverage: {
				kind: "half_day_periods",
				startDate,
				startPeriod: normalized.startPeriod,
				endDate,
				endPeriod: normalized.endPeriod,
			},
			inputEncoding: "legacy_period_only",
		};
	}

	throw new ApprovalEvidenceError("evidence_incomplete", { field: "coverage" });
}

export function buildAbsenceSubmittedFacts(input: {
	organizationId: string;
	absenceId: string;
	subjectEmployeeId: string;
	requesterEmployeeId: string;
	categoryId: string;
	raw: AbsenceRawCoverageInput;
	normalized: AbsenceNormalizedCoverageInput;
	entry: AbsenceCompatibilityEncoding["entry"];
	canonicalRecord: { id: string; startAt: Date; endAt: Date };
}): AbsenceSubmittedFacts {
	const { coverage, inputEncoding } = deriveAbsenceSubmittedCoverage(
		input.raw,
		input.normalized,
	);
	return {
		schemaVersion: ABSENCE_EVIDENCE_SCHEMA_VERSION,
		kind: "absence",
		organizationId: input.organizationId,
		absenceId: input.absenceId,
		subjectEmployeeId: input.subjectEmployeeId,
		requesterEmployeeId: input.requesterEmployeeId,
		categoryId: input.categoryId,
		coverage,
		inputEncoding,
		compatibility: {
			entry: { ...input.entry },
			canonicalRecord: {
				id: input.canonicalRecord.id,
				startAt: instantToCanonicalString(
					instantFromDate(input.canonicalRecord.startAt),
				),
				endAt: instantToCanonicalString(
					instantFromDate(input.canonicalRecord.endAt),
				),
				encoding: "utc_synthetic_bounds",
			},
		},
	};
}

export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value === "object" && value !== null) {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export function materialAbsenceFacts(
	facts: AbsenceMaterialFacts,
): AbsenceMaterialFacts {
	return {
		schemaVersion: facts.schemaVersion,
		kind: facts.kind,
		organizationId: facts.organizationId,
		absenceId: facts.absenceId,
		subjectEmployeeId: facts.subjectEmployeeId,
		requesterEmployeeId: facts.requesterEmployeeId,
		categoryId: facts.categoryId,
		coverage: facts.coverage,
	};
}

/** Versioned identity of the material proposal. Labels never participate. */
export function fingerprintAbsenceMaterialFacts(
	facts: AbsenceMaterialFacts,
): string {
	return `absence:v${ABSENCE_EVIDENCE_SCHEMA_VERSION}:${createHash("sha256")
		.update(canonicalJson(materialAbsenceFacts(facts)))
		.digest("hex")}`;
}

export interface LiveAbsenceFacts {
	organizationId: string;
	absenceId: string;
	employeeId: string;
	categoryId: string;
	startDate: string;
	startPeriod: DayPeriod;
	endDate: string;
	endPeriod: DayPeriod;
	categoryName: string | null;
}

export type AbsenceRevisionComparison =
	| { kind: "current"; labelChanges: AbsenceLabelChange[] }
	| { kind: "material_change"; changedFields: string[] };

export interface AbsenceLabelChange {
	field: "categoryName";
	submitted: string | null;
	current: string | null;
}

/**
 * Compares the live compatibility source with the immutable submitted
 * revision. Changed identity, category or stored coverage is a material change
 * that needs a supported cancellation/resubmission; a changed category label
 * alone is descriptive and leaves the reviewed revision current.
 */
export function compareLiveAbsenceWithRevision(
	facts: AbsenceSubmittedFacts,
	labels: AbsenceSubmittedLabels,
	live: LiveAbsenceFacts,
): AbsenceRevisionComparison {
	const entry = facts.compatibility.entry;
	const changedFields = [
		live.organizationId !== facts.organizationId ? "organizationId" : null,
		live.absenceId !== facts.absenceId ? "absenceId" : null,
		live.employeeId !== facts.subjectEmployeeId ? "employeeId" : null,
		live.categoryId !== facts.categoryId ? "categoryId" : null,
		live.startDate !== entry.startDate ? "startDate" : null,
		live.startPeriod !== entry.startPeriod ? "startPeriod" : null,
		live.endDate !== entry.endDate ? "endDate" : null,
		live.endPeriod !== entry.endPeriod ? "endPeriod" : null,
	].filter((field): field is string => field !== null);
	if (changedFields.length > 0)
		return { kind: "material_change", changedFields };
	return {
		kind: "current",
		labelChanges:
			live.categoryName !== labels.categoryName
				? [
						{
							field: "categoryName",
							submitted: labels.categoryName,
							current: live.categoryName,
						},
					]
				: [],
	};
}

export function isoInstant(value: Instant): string {
	return instantToCanonicalString(value);
}
