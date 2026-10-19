import {
	instantToCanonicalString,
	parsePlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	type AbsenceSubmittedFacts,
	compareLiveAbsenceWithRevision,
	type LiveAbsenceFacts,
} from "../evidence/absence-facts";
import type { ApprovalDatabase } from "../server/types";
import type {
	ApprovalTriageContext,
	ApprovalTriageEvidence,
} from "../triage-assessment";
import {
	type CoverageAbsence,
	type CoverageRule,
	type CoverageShift,
	evaluateAbsenceCoverage,
} from "./absence-coverage";
import type {
	ApprovalInboxTriageEvidenceResult,
	ApprovalInboxTriageTarget,
} from "./triage-evidence";
export interface AbsenceCoverageSnapshot {
	organizationId: string;
	requestId: string;
	authority: "compatibility_request" | "canonical_assignment";
	currentAuthority: "legacy" | "canonical";
	status: string;
	timezone: string | null;
	live: LiveAbsenceFacts;
	requiresWorkTime: boolean;
	revision: {
		id: string;
		materialFingerprint: string;
		requestId: string;
		facts: AbsenceSubmittedFacts;
	} | null;
	shifts: CoverageShift[];
	rules: CoverageRule[];
	absences: CoverageAbsence[];
}
export interface AbsenceCoverageOptions {
	database?: ApprovalDatabase;
	/** Database boundary: returns a freshly read, organization-scoped snapshot, never a client assessment. */
	readSnapshot?: (
		target: ApprovalInboxTriageTarget,
	) => Promise<AbsenceCoverageSnapshot | null>;
}
const unknown = (
	context: ApprovalTriageContext,
	validity: "stale" | "unverifiable" = "unverifiable",
	limitation = "source_unavailable",
): ApprovalInboxTriageEvidenceResult => ({
	context,
	evidence: [
		{
			check: "coverage",
			state: "unknown",
			validity,
			context,
			facts: { limitation },
		},
	],
});
export async function loadAbsenceCoverageTriageEvidence(
	target: ApprovalInboxTriageTarget,
	options: AbsenceCoverageOptions = {},
): Promise<ApprovalInboxTriageEvidenceResult> {
	if (target.requestKind !== "absence") return unknown(target.context);
	let snapshot: AbsenceCoverageSnapshot | null;
	try {
		snapshot = options.readSnapshot
			? await options.readSnapshot(target)
			: await (
					await import("./absence-coverage-source")
				).readAbsenceCoverageSnapshot(target, options.database);
	} catch {
		return unknown(target.context);
	}
	if (
		!snapshot ||
		snapshot.organizationId !== target.context.organizationId ||
		snapshot.live.organizationId !== target.context.organizationId ||
		snapshot.requestId !== target.context.requestId ||
		snapshot.live.absenceId !== target.context.entityId ||
		snapshot.authority !== target.authority ||
		snapshot.status !== "pending" ||
		!snapshot.revision
	)
		return unknown(target.context);
	const revision = snapshot.revision;
	const context = {
		...target.context,
		revision: `${revision.id}:${revision.materialFingerprint}`,
	};
	if (
		revision.requestId !== target.context.requestId ||
		(target.context.revision && target.context.revision !== context.revision) ||
		snapshot.currentAuthority !==
			(target.authority === "canonical_assignment" ? "canonical" : "legacy") ||
		compareLiveAbsenceWithRevision(
			revision.facts,
			{
				subjectName: null,
				requesterName: null,
				submitterName: null,
				categoryName: snapshot.live.categoryName,
			},
			snapshot.live,
		).kind !== "current"
	)
		return unknown(context, "stale", "submitted_facts_changed");
	if (!snapshot.timezone || snapshot.requiresWorkTime)
		return unknown(context, "unverifiable", "staffing_context_unavailable");
	try {
		parsePlainDate(revision.facts.coverage.startDate).toZonedDateTime(
			snapshot.timezone,
		);
	} catch {
		return unknown(context, "unverifiable", "staffing_context_unavailable");
	}
	const assessedAt = instantToCanonicalString(systemClock.nowInstant());
	const scopeFacts = {
		startDate: revision.facts.coverage.startDate,
		endDate: revision.facts.coverage.endDate,
		timezone: snapshot.timezone,
	};
	const result = evaluateAbsenceCoverage({
		organizationId: snapshot.organizationId,
		employeeId: snapshot.live.employeeId,
		coverage: revision.facts.coverage,
		shifts: snapshot.shifts,
		rules: snapshot.rules,
		absences: snapshot.absences,
	});
	const evidence: ApprovalTriageEvidence[] = result.shortfalls.map(
		(shortfall) => ({
			check: "coverage",
			state: "finding",
			validity: "current",
			context,
			assessedAt,
			reason: "staffing_shortfall",
			riskLevel: "high",
			facts: { ...scopeFacts, ...shortfall },
			text: {
				key: "approvals:triage.reasons.staffing_shortfall_details",
				fallback:
					"On {date}, staffing in {subareaName} from {startTime} to {endTime} is {staffCount}; {minimumStaffCount} required.",
				params: { ...shortfall },
			},
		}),
	);
	if (!result.complete)
		evidence.push({
			check: "coverage",
			state: "unknown",
			validity: "current",
			context,
			assessedAt,
			facts: { ...scopeFacts, limitation: result.limitations.join(", ") },
		});
	else if (!evidence.length)
		evidence.push({
			check: "coverage",
			state: "clear",
			validity: "current",
			context,
			assessedAt,
			facts: scopeFacts,
		});
	return { context, evidence };
}
