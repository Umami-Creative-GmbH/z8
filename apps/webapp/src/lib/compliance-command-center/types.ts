export type ComplianceSectionKey =
	| "auditEvidence"
	| "workforceCompliance"
	| "accessControls";

export type ComplianceSectionStatus =
	| "healthy"
	| "warning"
	| "critical"
	| "unavailable";

export interface CompliancePrimaryLink {
	label: string;
	href: string;
}

export interface ComplianceSectionCard {
	key: ComplianceSectionKey;
	status: ComplianceSectionStatus;
	headline: string;
	facts: string[];
	updatedAt: string | null;
	primaryLink: CompliancePrimaryLink;
}

export interface ComplianceCriticalEvent {
	id: string;
	sectionKey: ComplianceSectionKey;
	severity: Extract<ComplianceSectionStatus, "warning" | "critical">;
	title: string;
	description: string;
	occurredAt: string;
	primaryLink: CompliancePrimaryLink;
}

export interface ComplianceRiskSummary {
	status: ComplianceSectionStatus;
	headline: string;
	topRiskKeys: ComplianceSectionKey[];
	refreshedAt: string;
}

export interface ComplianceCommandCenterData {
	refreshedAt: string;
	summary: ComplianceRiskSummary;
	sections: ComplianceSectionCard[];
	recentCriticalEvents: ComplianceCriticalEvent[];
	coverageNotes: string[];
}

export interface ComplianceSectionResult {
	card: ComplianceSectionCard;
	recentCriticalEvents: ComplianceCriticalEvent[];
}
