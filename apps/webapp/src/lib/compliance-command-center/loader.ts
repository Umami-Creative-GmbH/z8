import { DateTime } from "luxon";
import { getAccessControlsSection } from "./sections/access-controls";
import { getAuditEvidenceSection } from "./sections/audit-evidence";
import { getWorkforceComplianceSection } from "./sections/workforce-compliance";
import type { ComplianceCommandCenterData, ComplianceSectionResult, ComplianceText } from "./types";
import { buildComplianceCommandCenterData } from "./view-model";

function text(key: string, params?: Record<string, string | number>): ComplianceText {
	return params ? { key, params } : { key };
}

function unavailableSection(
	key: ComplianceSectionResult["card"]["key"],
	primaryLink: ComplianceSectionResult["card"]["primaryLink"],
	errorMessage: ComplianceText,
): ComplianceSectionResult {
	return {
		card: {
			key,
			status: "unavailable",
			headline: text("compliance.commandCenter.sections.unavailable.headline"),
			facts: [errorMessage],
			updatedAt: DateTime.utc().toISO(),
			primaryLink,
		},
		recentCriticalEvents: [],
	};
}

export async function getComplianceCommandCenterData(
	organizationId: string,
): Promise<ComplianceCommandCenterData> {
	const [auditEvidence, workforceCompliance, accessControls] = await Promise.all([
		getAuditEvidenceSection(organizationId).catch(() =>
			unavailableSection(
				"auditEvidence",
				{
					label: text("compliance.commandCenter.links.openAuditExport"),
					href: "/settings/audit-export",
				},
				text("compliance.commandCenter.facts.unavailable.auditEvidence"),
			),
		),
		getWorkforceComplianceSection(organizationId).catch(() =>
			unavailableSection(
				"workforceCompliance",
				{
					label: text("compliance.commandCenter.links.openComplianceSettings"),
					href: "/settings/compliance",
				},
				text("compliance.commandCenter.facts.unavailable.workforceCompliance"),
			),
		),
		getAccessControlsSection(organizationId).catch(() =>
			unavailableSection(
				"accessControls",
				{
					label: text("compliance.commandCenter.links.openAuditLog"),
					href: "/settings/enterprise/audit-log",
				},
				text("compliance.commandCenter.facts.unavailable.accessControls"),
			),
		),
	]);

	return buildComplianceCommandCenterData({
		sections: [auditEvidence.card, workforceCompliance.card, accessControls.card],
		recentCriticalEvents: [
			...auditEvidence.recentCriticalEvents,
			...workforceCompliance.recentCriticalEvents,
			...accessControls.recentCriticalEvents,
		],
		coverageNotes: [
			text("compliance.commandCenter.coverage.auditEvidence"),
			text("compliance.commandCenter.coverage.workforceCompliance"),
			text("compliance.commandCenter.coverage.accessControls"),
		],
		refreshedAt: DateTime.utc().toISO()!,
	});
}
