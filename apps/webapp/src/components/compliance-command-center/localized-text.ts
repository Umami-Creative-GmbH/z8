import type { ComplianceText } from "@/lib/compliance-command-center/types";

type Translate = (
	key: string,
	fallback: string,
	params?: Record<string, string | number>,
) => string;

export const COMPLIANCE_COMMAND_CENTER_I18N = {
	coverageAccessControls: {
		key: "compliance.commandCenter.coverage.accessControls",
		default:
			"Access controls only summarize sensitive audit-log events that are already captured today.",
	},
	coverageAuditEvidence: {
		key: "compliance.commandCenter.coverage.auditEvidence",
		default:
			"Audit evidence uses live audit-export configuration, audit-pack requests, and recent verification results.",
	},
	coverageWorkforceCompliance: {
		key: "compliance.commandCenter.coverage.workforceCompliance",
		default:
			"Workforce compliance uses the last 7 days of work-policy violations and pending exception requests.",
	},
	eventAuditEvidenceFailuresDescription: {
		key: "compliance.commandCenter.events.auditEvidenceFailures.description",
		default:
			"Recent failed jobs: {failedRequests}; recent invalid verifications: {invalidVerifications}",
	},
	eventAuditEvidenceFailuresTitle: {
		key: "compliance.commandCenter.events.auditEvidenceFailures.title",
		default: "Audit evidence failures detected",
	},
	eventAuditPackFailureDescription: {
		key: "compliance.commandCenter.events.auditPackFailure.description",
		default: "Recent failed jobs: {failedRequests}",
	},
	eventAuditPackFailureTitle: {
		key: "compliance.commandCenter.events.auditPackFailure.title",
		default: "Audit pack generation failed",
	},
	eventAuditVerificationFailureDescription: {
		key: "compliance.commandCenter.events.auditVerificationFailure.description",
		default: "Recent invalid verifications: {invalidVerifications}",
	},
	eventAuditVerificationFailureTitle: {
		key: "compliance.commandCenter.events.auditVerificationFailure.title",
		default: "Audit verification failed",
	},
	eventSensitiveActionDescription: {
		key: "compliance.commandCenter.events.sensitiveAction.description",
		default: "{action} on {entityType}",
	},
	eventSensitiveActionTitle: {
		key: "compliance.commandCenter.events.sensitiveAction.title",
		default: "Sensitive action: {action}",
	},
	eventWorkforceFindingsDescription: {
		key: "compliance.commandCenter.events.workforceFindings.description",
		default:
			"Rest: {restPeriodViolations}, Other policy: {generalPolicyViolations}, Overtime: {overtimeViolations}",
	},
	eventWorkforceFindingsTitle: {
		key: "compliance.commandCenter.events.workforceFindings.title",
		default: "Recent workforce policy findings",
	},
	factAccessLatestSensitiveAction: {
		key: "compliance.commandCenter.facts.access.latestSensitiveAction",
		default: "Latest sensitive action: {action}",
	},
	factAccessLatestSensitiveActionNone: {
		key: "compliance.commandCenter.facts.access.latestSensitiveActionNone",
		default: "Latest sensitive action: none",
	},
	factAccessNoSensitiveEvents: {
		key: "compliance.commandCenter.facts.access.noSensitiveEvents",
		default: "No sensitive control changes were logged in the last 24 hours.",
	},
	factAccessRecentSensitiveEvents: {
		key: "compliance.commandCenter.facts.access.recentSensitiveEvents",
		default: "Recent sensitive events: {count}",
	},
	factAuditActiveSigningKey: {
		key: "compliance.commandCenter.facts.audit.activeSigningKey",
		default: "Active signing key: {fingerprint}",
	},
	factAuditLastSuccessfulAuditPack: {
		key: "compliance.commandCenter.facts.audit.lastSuccessfulAuditPack",
		default: "Last successful audit pack: {timestamp}",
	},
	factAuditMissingSigningKey: {
		key: "compliance.commandCenter.facts.audit.missingSigningKey",
		default: "Signing keys are not configured yet.",
	},
	factAuditNoSuccessfulAuditPack: {
		key: "compliance.commandCenter.facts.audit.noSuccessfulAuditPack",
		default: "No successful audit pack has been recorded yet.",
	},
	factAuditRecentFailedJobs: {
		key: "compliance.commandCenter.facts.audit.recentFailedJobs",
		default: "Recent failed audit-pack jobs: {count}",
	},
	factAuditRecentInvalidVerifications: {
		key: "compliance.commandCenter.facts.audit.recentInvalidVerifications",
		default: "Recent invalid verification attempts: {count}",
	},
	factUnavailableAccessControls: {
		key: "compliance.commandCenter.facts.unavailable.accessControls",
		default: "Access-control events could not be loaded.",
	},
	factUnavailableAuditEvidence: {
		key: "compliance.commandCenter.facts.unavailable.auditEvidence",
		default: "Audit evidence data could not be loaded.",
	},
	factUnavailableWorkforceCompliance: {
		key: "compliance.commandCenter.facts.unavailable.workforceCompliance",
		default: "Workforce compliance data could not be loaded.",
	},
	factWorkforceGeneralPolicyViolations: {
		key: "compliance.commandCenter.facts.workforce.generalPolicyViolations",
		default: "Other policy violations: {count}",
	},
	factWorkforceOvertimeViolations: {
		key: "compliance.commandCenter.facts.workforce.overtimeViolations",
		default: "Overtime violations: {count}",
	},
	factWorkforcePendingExceptions: {
		key: "compliance.commandCenter.facts.workforce.pendingExceptions",
		default: "Pending exceptions: {count}",
	},
	factWorkforceRestPeriodViolations: {
		key: "compliance.commandCenter.facts.workforce.restPeriodViolations",
		default: "Rest-period violations: {count}",
	},
	linkInspectCompliance: {
		key: "compliance.commandCenter.links.inspectCompliance",
		default: "Inspect compliance",
	},
	linkInspectInAuditLog: {
		key: "compliance.commandCenter.links.inspectInAuditLog",
		default: "Inspect in Audit Log",
	},
	linkOpenAuditExport: {
		key: "compliance.commandCenter.links.openAuditExport",
		default: "Open Audit Export",
	},
	linkOpenAuditLog: {
		key: "compliance.commandCenter.links.openAuditLog",
		default: "Open Audit Log",
	},
	linkOpenComplianceSettings: {
		key: "compliance.commandCenter.links.openComplianceSettings",
		default: "Open Compliance Settings",
	},
	linkReviewAuditExport: {
		key: "compliance.commandCenter.links.reviewAuditExport",
		default: "Review audit export",
	},
	sectionAccessControlsCritical: {
		key: "compliance.commandCenter.sections.accessControls.headline.critical",
		default: "Sensitive control changes need review",
	},
	sectionAccessControlsHealthy: {
		key: "compliance.commandCenter.sections.accessControls.headline.healthy",
		default: "No sensitive control changes were logged recently",
	},
	sectionAccessControlsWarning: {
		key: "compliance.commandCenter.sections.accessControls.headline.warning",
		default: "Recent control changes were detected",
	},
	sectionAuditEvidenceCritical: {
		key: "compliance.commandCenter.sections.auditEvidence.headline.critical",
		default: "Audit evidence needs attention",
	},
	sectionAuditEvidenceHealthy: {
		key: "compliance.commandCenter.sections.auditEvidence.headline.healthy",
		default: "Audit evidence signals look healthy",
	},
	sectionAuditEvidenceWarning: {
		key: "compliance.commandCenter.sections.auditEvidence.headline.warning",
		default: "Audit evidence is only partially ready",
	},
	sectionUnavailable: {
		key: "compliance.commandCenter.sections.unavailable.headline",
		default: "Signal temporarily unavailable",
	},
	sectionWorkforceComplianceCritical: {
		key: "compliance.commandCenter.sections.workforceCompliance.headline.critical",
		default: "Workforce policy violations need review",
	},
	sectionWorkforceComplianceHealthy: {
		key: "compliance.commandCenter.sections.workforceCompliance.headline.healthy",
		default: "No recent workforce policy issues were detected",
	},
	sectionWorkforceComplianceWarning: {
		key: "compliance.commandCenter.sections.workforceCompliance.headline.warning",
		default: "Workforce compliance is drifting",
	},
	statusCritical: { key: "compliance.commandCenter.status.critical", default: "critical" },
	statusHealthy: { key: "compliance.commandCenter.status.healthy", default: "healthy" },
	statusUnavailable: { key: "compliance.commandCenter.status.unavailable", default: "unavailable" },
	statusWarning: { key: "compliance.commandCenter.status.warning", default: "warning" },
	summaryCritical: {
		key: "compliance.commandCenter.summary.critical",
		default: "Critical compliance risks need attention",
	},
	summaryHealthy: {
		key: "compliance.commandCenter.summary.healthy",
		default: "No active issues detected in monitored signals",
	},
	summaryUnavailable: {
		key: "compliance.commandCenter.summary.unavailable",
		default: "Some compliance signals are unavailable",
	},
	summaryWarning: {
		key: "compliance.commandCenter.summary.warning",
		default: "Compliance signals need review",
	},
};

const FALLBACKS = Object.fromEntries(
	Object.values(COMPLIANCE_COMMAND_CENTER_I18N).map((entry) => [entry.key, entry.default]),
);

export const COMPLIANCE_STATUS_I18N = {
	critical: COMPLIANCE_COMMAND_CENTER_I18N.statusCritical,
	healthy: COMPLIANCE_COMMAND_CENTER_I18N.statusHealthy,
	unavailable: COMPLIANCE_COMMAND_CENTER_I18N.statusUnavailable,
	warning: COMPLIANCE_COMMAND_CENTER_I18N.statusWarning,
};

export function renderComplianceText(t: Translate, text: ComplianceText) {
	if (typeof text === "string") return text;

	return t(text.key, FALLBACKS[text.key] ?? text.key, text.params);
}
