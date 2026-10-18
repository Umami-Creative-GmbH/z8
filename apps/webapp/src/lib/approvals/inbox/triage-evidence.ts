import type { ApprovalTriageMetadata } from "../domain/types";
import { type ApprovalTriageContext, type ApprovalTriageEvidence, type ApprovalTriageRequestKind } from "../triage-assessment";
import { getEffectiveApprovalTriagePolicy, type ApprovalTriagePolicy } from "../triage-policy";
import { buildInboxTriage } from "./triage";
import type { ApprovalInboxPriority, ApprovalInboxStatus, ApprovalInboxTriage, ApprovalInboxType } from "./types";

export interface ApprovalInboxTriageTarget {
 context: ApprovalTriageContext;
 requestKind: ApprovalTriageRequestKind;
 type: ApprovalInboxType;
 status: ApprovalInboxStatus;
 createdAt: Date | string;
 priority: ApprovalInboxPriority;
 requesterEmployeeId?: string;
 /** If omitted, adapters derive the affected employee from organization-scoped source rows. */
 subjectEmployeeId?: string;
 authority?: "compatibility_request" | "canonical_assignment";
 sourceTriage?: ApprovalTriageMetadata;
}
export interface ApprovalInboxTriageEvidenceResult {
 /** Loaded from the authoritative submitted request by the server adapter. */
 context: ApprovalTriageContext;
 evidence: readonly ApprovalTriageEvidence[];
}
export type ApprovalInboxTriageEvidenceLoader = (target: ApprovalInboxTriageTarget) => Promise<ApprovalInboxTriageEvidenceResult>;

/**
 * Current server evaluation. Adapters must re-read the request/revision within its
 * organization; caller-supplied assessment snapshots never enter this boundary.
 * No adapters means explicit unknown until the evidence slices are connected.
 */
export async function resolveApprovalInboxTriage(input: {
 target: ApprovalInboxTriageTarget;
 now?: Date;
 policy?: ApprovalTriagePolicy;
 loadEvidence?: ApprovalInboxTriageEvidenceLoader;
}): Promise<ApprovalInboxTriage> {
 const { target } = input;
 const policy = input.policy ?? await getEffectiveApprovalTriagePolicy({ organizationId: target.context.organizationId });
 const resolved = input.loadEvidence ? await input.loadEvidence(target) : null;
 const subjectMatches = resolved && target.context.organizationId === resolved.context.organizationId && target.context.requestId === resolved.context.requestId && target.context.entityId === resolved.context.entityId && target.context.scope === resolved.context.scope && (!target.context.revision || target.context.revision === resolved.context.revision);
 const context = subjectMatches ? resolved.context : target.context;
 const metadata = target.sourceTriage;
 return { ...buildInboxTriage({ type: target.type, requestKind: target.requestKind, context, priority: target.priority, status: target.status, createdAt: target.createdAt, now: input.now, policy, evidence: subjectMatches ? resolved.evidence : resolved ? [] : metadata?.evidence, riskLevel: metadata?.riskLevel, riskReasons: metadata?.riskReasons, isPayrollRelevant: metadata?.isPayrollRelevant }), context };
}

