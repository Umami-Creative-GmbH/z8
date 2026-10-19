import type {
	AbsenceChangeKind,
	AbsenceChangeOriginal,
	AbsenceChangeProposal,
} from "@/lib/absences/change-request-types";
import {
	instantToCanonicalString,
	parsePlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { canonicalJson } from "../evidence/absence-facts";
import type { ApprovalDatabase } from "../server/types";
import type {
	ApprovalTriageContext,
	ApprovalTriageEvidence,
} from "../triage-assessment";
import { evaluateAbsenceChangeCoverage } from "./absence-change-coverage";
import type {
	CoverageAbsence,
	CoverageRule,
	CoverageShift,
} from "./absence-coverage";
import type {
	ApprovalInboxTriageEvidenceResult,
	ApprovalInboxTriageTarget,
} from "./triage-evidence";
export interface AbsenceChangeCoverageSnapshot {
	organizationId: string;
	requestId: string;
	changeId: string;
	absenceId: string;
	employeeId: string;
	kind: AbsenceChangeKind;
	status: string;
	currentAuthority: "legacy" | "canonical";
	original: AbsenceChangeOriginal;
	proposed: AbsenceChangeProposal | null;
	submittedRevision: string | null;
	submittedMatchesCurrent: boolean;
	liveOriginal: AbsenceChangeOriginal | null;
	timezone: string | null;
	requiresWorkTime: boolean;
	shifts: CoverageShift[];
	rules: CoverageRule[];
	absences: CoverageAbsence[];
}
export interface AbsenceChangeCoverageOptions {
	database?: ApprovalDatabase;
	readSnapshot?: (
		target: ApprovalInboxTriageTarget,
	) => Promise<AbsenceChangeCoverageSnapshot | null>;
}
const unknown = (
	context: ApprovalTriageContext,
	limitation: string,
	stale = false,
): ApprovalInboxTriageEvidenceResult => ({
	context,
	evidence: [
		{
			check: "coverage",
			state: "unknown",
			validity: stale ? "stale" : "unverifiable",
			limitation: stale ? "stale" : "unavailable",
			context,
			facts: { limitation },
			text: {
				key: "approvals:triage.reasons.absence_change_coverage_unverified",
				fallback:
					"Coverage of the original-to-proposed absence change is not verified.",
			},
		},
	],
});
/** Current source identity and captured proposal; this assessment never changes the effective absence. */
export async function loadAbsenceChangeCoverageTriageEvidence(
	target: ApprovalInboxTriageTarget,
	options: AbsenceChangeCoverageOptions = {},
): Promise<ApprovalInboxTriageEvidenceResult> {
	if (
		target.requestKind !== "absence_change" ||
		target.authority !== "canonical_assignment" ||
		target.status !== "pending"
	)
		return unknown(target.context, "unsupported_request_identity");
	let snapshot: AbsenceChangeCoverageSnapshot | null;
	try {
		snapshot = options.readSnapshot
			? await options.readSnapshot(target)
			: await (
					await import("./absence-change-coverage-source")
				).readAbsenceChangeCoverageSnapshot(target, options.database);
	} catch {
		return unknown(target.context, "source_unavailable");
	}
	if (
		!snapshot ||
		snapshot.organizationId !== target.context.organizationId ||
		snapshot.requestId !== target.context.requestId ||
		snapshot.changeId !== target.context.entityId ||
		(target.subjectEmployeeId &&
			target.subjectEmployeeId !== snapshot.employeeId) ||
		snapshot.status !== "pending" ||
		snapshot.currentAuthority !== "canonical" ||
		!snapshot.submittedRevision
	)
		return unknown(target.context, "request_or_submission_unverified");
	const context = { ...target.context, revision: snapshot.submittedRevision };
	if (
		!snapshot.submittedMatchesCurrent ||
		!snapshot.liveOriginal ||
		canonicalJson(snapshot.liveOriginal) !== canonicalJson(snapshot.original) ||
		(target.context.revision && target.context.revision !== context.revision)
	)
		return unknown(context, "submitted_or_effective_absence_changed", true);
	if (!snapshot.timezone || snapshot.requiresWorkTime)
		return unknown(context, "staffing_context_unavailable");
	try {
		parsePlainDate(snapshot.original.startDate).toZonedDateTime(
			snapshot.timezone,
		);
	} catch {
		return unknown(context, "staffing_context_unavailable");
	}
	const result = evaluateAbsenceChangeCoverage(snapshot);
	const assessedAt = instantToCanonicalString(systemClock.nowInstant());
	const facts = {
		kind: snapshot.kind,
		originalStartDate: snapshot.original.startDate,
		originalEndDate: snapshot.original.endDate,
		proposedStartDate: snapshot.proposed?.startDate ?? null,
		proposedEndDate: snapshot.proposed?.endDate ?? null,
		timezone: snapshot.timezone,
	};
	const evidence: ApprovalTriageEvidence[] = result.shortfalls.map(
		(shortfall) => ({
			check: "coverage",
			state: "finding",
			validity: "current",
			context,
			assessedAt,
			reason: "staffing_shortfall",
			riskLevel: "high",
			facts: { ...facts, ...shortfall },
			text: {
				key: "approvals:triage.reasons.absence_change_shortfall_details",
				fallback:
					"After the proposed change, staffing on {date} in {subareaName} from {startTime} to {endTime} is {staffCount}; {minimumStaffCount} required.",
				params: { ...shortfall },
			},
		}),
	);
	if (!result.complete)
		evidence.push({
			check: "coverage",
			state: "unknown",
			validity: "current",
			limitation: "unsupported",
			context,
			assessedAt,
			facts: { ...facts, limitation: result.limitations.join(", ") },
			text: {
				key: "approvals:triage.reasons.absence_change_coverage_incomplete",
				fallback:
					"Staffing is not fully verified for every part of this absence change.",
			},
		});
	else if (!evidence.length)
		evidence.push({
			check: "coverage",
			state: "clear",
			validity: "current",
			context,
			assessedAt,
			facts,
		});
	return { context, evidence };
}
