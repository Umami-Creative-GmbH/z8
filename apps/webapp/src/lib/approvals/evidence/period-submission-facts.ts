import { createHash } from "node:crypto";
import { canonicalJson } from "./absence-facts";

/**
 * Submitted facts of a period submission (#1059): what the employee confirmed, captured in the
 * submission's transaction. The card, the inbox and every delivery channel show these facts,
 * never a later read of the period. #1061 adds absences, holidays, targets and violations.
 */
export const PERIOD_SUBMISSION_EVIDENCE_SCHEMA_VERSION = 1;

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
}

export interface PeriodSubmissionSubmittedLabels {
	subjectName: string | null;
}

export function fingerprintPeriodSubmissionFacts(facts: PeriodSubmissionSubmittedFacts): string {
	return `period_submission:v${PERIOD_SUBMISSION_EVIDENCE_SCHEMA_VERSION}:${createHash("sha256")
		.update(canonicalJson(facts))
		.digest("hex")}`;
}
