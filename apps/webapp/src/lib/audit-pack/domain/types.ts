import type { AppendHashStatus, AppendLinkResolution } from "@/lib/time-tracking/append-lineage";

export interface CorrectionLinkNode {
	id: string;
	previousEntryId: string | null;
	replacesEntryId: string | null;
	supersededById: string | null;
}

/**
 * A lineage node for closure expansion. `previousEntryId` stays the stored field;
 * `appendPredecessorId` is the predecessor resolved under the shared append
 * compatibility rules (stored or derived), or null when none resolves.
 */
export interface LineageLinkNode extends CorrectionLinkNode {
	appendPredecessorId: string | null;
}

export interface CorrectionClosureResult {
	nodeIds: string[];
	expandedOutsideRange: string[];
}

export interface EntryHashEvidence {
	/** Stored hash bytes, never recomputed or normalized. */
	stored: string;
	previousHash: string | null;
	status: AppendHashStatus;
}

export interface EntryAppendLinkEvidence {
	/** `derived`: resolved read-only from a unique hash match; nothing was written. */
	resolution: AppendLinkResolution["kind"];
	predecessorId: string | null;
}

export interface EntryChainEvidenceInput {
	id: string;
	organizationId: string;
	employeeId: string;
	type: string;
	occurredAt: string;
	previousEntryId: string | null;
	replacesEntryId: string | null;
	supersededById: string | null;
	hash: EntryHashEvidence;
	appendLink: EntryAppendLinkEvidence;
}

export interface EntryChainEvidence {
	id: string;
	organizationId: string;
	employeeId: string;
	type: string;
	occurredAt: string;
	/** Original stored link fields. */
	lineage: {
		previousEntryId: string | null;
		replacesEntryId: string | null;
		supersededById: string | null;
	};
	hash: EntryHashEvidence;
	appendLink: EntryAppendLinkEvidence;
}

export interface ApprovalEvidenceInput {
	id: string;
	organizationId: string;
	entryId: string;
	approvedAt: string;
	status: "submitted" | "approved" | "rejected";
	approvedById: string;
}

export interface ApprovalEvidence {
	id: string;
	organizationId: string;
	entryId: string;
	approvedAt: string;
	status: "submitted" | "approved" | "rejected";
	approvedById: string;
}

export type AuditTimelineSource = "entry" | "approval" | "audit_log";

export interface AuditTimelineInputEvent {
	id: string;
	source: AuditTimelineSource;
	occurredAt: string;
	organizationId?: string;
}

export interface AuditTimelineEvent {
	id: string;
	source: AuditTimelineSource;
	occurredAt: string;
}
