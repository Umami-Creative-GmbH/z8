export type ComplianceText =
	| string
	| {
			key: string;
			params?: Record<string, string | number>;
	  };

export type ComplianceSectionKey = "auditEvidence" | "workforceCompliance" | "accessControls";

export type ComplianceSectionStatus = "healthy" | "warning" | "critical" | "unavailable";

export interface CompliancePrimaryLink {
	label: ComplianceText;
	href: string;
}

export interface ComplianceSectionCard {
	key: ComplianceSectionKey;
	status: ComplianceSectionStatus;
	headline: ComplianceText;
	facts: ComplianceText[];
	updatedAt: string | null;
	primaryLink: CompliancePrimaryLink;
}

export interface ComplianceCriticalEvent {
	id: string;
	sectionKey: ComplianceSectionKey;
	severity: Extract<ComplianceSectionStatus, "warning" | "critical">;
	title: ComplianceText;
	description: ComplianceText;
	occurredAt: string;
	primaryLink: CompliancePrimaryLink;
}

export interface ComplianceRiskSummary {
	status: ComplianceSectionStatus;
	headline: ComplianceText;
	topRiskKeys: ComplianceSectionKey[];
	refreshedAt: string;
}

export interface ComplianceCommandCenterData {
	refreshedAt: string;
	summary: ComplianceRiskSummary;
	sections: ComplianceSectionCard[];
	recentCriticalEvents: ComplianceCriticalEvent[];
	coverageNotes: ComplianceText[];
}

export interface ComplianceSectionResult {
	card: ComplianceSectionCard;
	recentCriticalEvents: ComplianceCriticalEvent[];
}
