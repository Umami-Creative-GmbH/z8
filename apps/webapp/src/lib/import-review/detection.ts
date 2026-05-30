import { DateTime } from "luxon";
import type { ImportEntityType, ImportIssueDraft } from "./types";

const DETECTION_RULE_VERSION = "import-review-v1";

export function createDuplicateIssue(input: {
	entityType: ImportEntityType;
	employeeId: string;
	sourceId: string;
	startsAt: string;
}): ImportIssueDraft {
	const clusterKey = `duplicate:${input.entityType}:${input.employeeId}:${input.startsAt}`;
	return {
		issueType: "duplicate",
		severity: "warning",
		clusterKey,
		message: `Possible duplicate ${input.entityType} row for employee ${input.employeeId}.`,
		details: input,
		detectionRuleVersion: DETECTION_RULE_VERSION,
	};
}

export function detectMissingMapping(input: {
	entityType: ImportEntityType;
	providerSourceId: string;
	employeeId: string | null;
}): ImportIssueDraft | null {
	if (input.employeeId) return null;
	return {
		issueType: "unmatched_employee",
		severity: "blocking",
		clusterKey: `unmatched_employee:${input.entityType}:${input.providerSourceId}`,
		message: `No Z8 employee is mapped for ${input.entityType} row ${input.providerSourceId}.`,
		details: input,
		detectionRuleVersion: DETECTION_RULE_VERSION,
	};
}

export function classifyTimeWindow(input: { startsAt: string; endsAt: string | null }): string[] {
	const flags: string[] = [];
	const start = DateTime.fromISO(input.startsAt, { zone: "utc" });
	const end = input.endsAt ? DateTime.fromISO(input.endsAt, { zone: "utc" }) : null;
	if (!start.isValid) flags.push("invalid_start");
	if (!end) flags.push("missing_clock_out");
	if (end && !end.isValid) flags.push("invalid_end");
	if (start.isValid && end?.isValid) {
		const minutes = end.diff(start, "minutes").minutes;
		if (minutes <= 0) flags.push("non_positive_duration");
		if (minutes > 16 * 60) flags.push("long_shift");
		if (start.toISODate() !== end.toISODate()) flags.push("crosses_day_boundary");
	}
	return flags;
}
