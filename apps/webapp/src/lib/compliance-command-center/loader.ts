import { DateTime } from "luxon";
import { getAccessControlsSection } from "./sections/access-controls";
import { getAuditEvidenceSection } from "./sections/audit-evidence";
import { getWorkforceComplianceSection } from "./sections/workforce-compliance";
import type { ComplianceCommandCenterData, ComplianceSectionResult } from "./types";
import { buildComplianceCommandCenterData } from "./view-model";

function unavailableSection(
	key: ComplianceSectionResult["card"]["key"],
	primaryLink: ComplianceSectionResult["card"]["primaryLink"],
	errorMessage: string,
): ComplianceSectionResult {
	return {
		card: {
			key,
			status: "unavailable",
			headline: "Signal temporarily unavailable",
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
				{ label: "Open Audit Export", href: "/settings/audit-export" },
				"Audit evidence data could not be loaded.",
			),
		),
		getWorkforceComplianceSection(organizationId).catch(() =>
			unavailableSection(
				"workforceCompliance",
				{ label: "Open Compliance Settings", href: "/settings/compliance" },
				"Workforce compliance data could not be loaded.",
			),
		),
		getAccessControlsSection(organizationId).catch(() =>
			unavailableSection(
				"accessControls",
				{ label: "Open Audit Log", href: "/settings/enterprise/audit-log" },
				"Access-control events could not be loaded.",
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
			"Audit evidence uses live audit-export configuration, audit-pack requests, and recent verification results.",
			"Workforce compliance uses the last 7 days of work-policy violations and pending exception requests.",
			"Access controls only summarize sensitive audit-log events that are already captured today.",
		],
		refreshedAt: DateTime.utc().toISO()!,
	});
}
