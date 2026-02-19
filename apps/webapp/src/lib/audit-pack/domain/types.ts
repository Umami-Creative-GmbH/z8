export interface CorrectionLinkNode {
	id: string;
	previousEntryId: string | null;
	replacesEntryId: string | null;
	supersededById: string | null;
}

export interface CorrectionClosureResult {
	nodeIds: string[];
	expandedOutsideRange: string[];
}

export interface EntryChainEvidenceInput {
	id: string;
	organizationId: string;
	occurredAt: string;
	previousEntryId: string | null;
	replacesEntryId: string | null;
	supersededById: string | null;
}

export interface EntryChainEvidence {
	id: string;
	organizationId: string;
	occurredAt: string;
	lineage: {
		previousEntryId: string | null;
		replacesEntryId: string | null;
		supersededById: string | null;
	};
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
