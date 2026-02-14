/**
 * Compliance Radar Notification Triggers
 *
 * Functions to create notifications for compliance radar events.
 * These are fire-and-forget - they don't throw on failure.
 */

import { createLogger } from "@/lib/logger";
import { createNotification, createNotificationForManager } from "./notification-service";
import type { ComplianceFindingSeverity, ComplianceFindingType } from "@/db/schema/compliance-finding";

const logger = createLogger("ComplianceRadarTriggers");

// ============================================
// HELPER FUNCTIONS
// ============================================

const FINDING_TYPE_LABELS: Record<ComplianceFindingType, string> = {
	rest_period_insufficient: "Insufficient Rest Period",
	max_hours_daily_exceeded: "Daily Hours Exceeded",
	max_hours_weekly_exceeded: "Weekly Hours Exceeded",
	consecutive_days_exceeded: "Too Many Consecutive Days",
	presence_requirement: "Presence Requirement",
};

const SEVERITY_LABELS: Record<ComplianceFindingSeverity, string> = {
	info: "Info",
	warning: "Warning",
	critical: "Critical",
};

function formatFindingType(type: ComplianceFindingType): string {
	return FINDING_TYPE_LABELS[type] ?? type;
}

function formatSeverity(severity: ComplianceFindingSeverity): string {
	return SEVERITY_LABELS[severity] ?? severity;
}

// ============================================
// NOTIFICATION TRIGGERS
// ============================================

interface FindingDetectedParams {
	findingId: string;
	organizationId: string;
	employeeId: string;
	employeeName: string;
	type: ComplianceFindingType;
	severity: ComplianceFindingSeverity;
	managerUserId?: string;
}

/**
 * Notify manager about a new compliance finding for their direct report
 */
export async function onComplianceFindingDetected(
	params: FindingDetectedParams,
): Promise<void> {
	try {
		const { findingId, organizationId, employeeName, type, severity, managerUserId } = params;

		// Only notify for warning or critical severity
		if (severity === "info") {
			return;
		}

		const typeLabel = formatFindingType(type);
		const severityLabel = formatSeverity(severity);

		// Determine notification type based on severity
		const notificationType = severity === "critical"
			? "overtime_violation" as const
			: "overtime_warning" as const;

		if (managerUserId) {
			await createNotification({
				userId: managerUserId,
				organizationId,
				type: notificationType,
				title: `Compliance Finding: ${severityLabel}`,
				message: `${employeeName} has a ${typeLabel.toLowerCase()} finding that requires review.`,
				entityType: "compliance_finding",
				entityId: findingId,
				actionUrl: "/settings/compliance-radar",
				metadata: {
					findingType: type,
					severity,
					employeeName,
				},
			});

			logger.debug(
				{ findingId, managerUserId, type, severity },
				"Sent compliance finding notification to manager",
			);
		}
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to send compliance finding notification",
		);
	}
}

interface FindingAcknowledgedParams {
	findingId: string;
	organizationId: string;
	employeeUserId: string;
	employeeName: string;
	type: ComplianceFindingType;
	acknowledgerName: string;
}

/**
 * Notify employee that their compliance finding was acknowledged
 */
export async function onComplianceFindingAcknowledged(
	params: FindingAcknowledgedParams,
): Promise<void> {
	try {
		const { findingId, organizationId, employeeUserId, type, acknowledgerName } = params;

		const typeLabel = formatFindingType(type);

		await createNotification({
			userId: employeeUserId,
			organizationId,
			type: "compliance_exception_approved",
			title: "Compliance finding acknowledged",
			message: `Your ${typeLabel.toLowerCase()} finding has been acknowledged by ${acknowledgerName}.`,
			entityType: "compliance_finding",
			entityId: findingId,
			actionUrl: "/settings/compliance-radar",
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to send finding acknowledged notification",
		);
	}
}

interface FindingWaivedParams {
	findingId: string;
	organizationId: string;
	employeeUserId: string;
	employeeName: string;
	type: ComplianceFindingType;
	waiverName: string;
	waiverReason: string;
}

/**
 * Notify employee that their compliance finding was waived
 */
export async function onComplianceFindingWaived(
	params: FindingWaivedParams,
): Promise<void> {
	try {
		const { findingId, organizationId, employeeUserId, type, waiverName, waiverReason } = params;

		const typeLabel = formatFindingType(type);

		await createNotification({
			userId: employeeUserId,
			organizationId,
			type: "compliance_exception_approved",
			title: "Compliance finding waived",
			message: `Your ${typeLabel.toLowerCase()} finding has been waived by ${waiverName}. Reason: ${waiverReason}`,
			entityType: "compliance_finding",
			entityId: findingId,
			actionUrl: "/settings/compliance-radar",
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to send finding waived notification",
		);
	}
}

interface DigestParams {
	organizationId: string;
	managerUserId: string;
	managerName: string;
	findingsSummary: {
		total: number;
		critical: number;
		warning: number;
		info: number;
	};
}

/**
 * Send a daily digest of compliance findings to managers
 */
export async function sendComplianceDigest(params: DigestParams): Promise<void> {
	try {
		const { organizationId, managerUserId, findingsSummary } = params;

		if (findingsSummary.total === 0) {
			return;
		}

		let message = `You have ${findingsSummary.total} open compliance finding${findingsSummary.total > 1 ? "s" : ""} to review.`;

		if (findingsSummary.critical > 0) {
			message += ` ${findingsSummary.critical} critical.`;
		}
		if (findingsSummary.warning > 0) {
			message += ` ${findingsSummary.warning} warning${findingsSummary.warning > 1 ? "s" : ""}.`;
		}

		await createNotification({
			userId: managerUserId,
			organizationId,
			type: "overtime_warning",
			title: "Compliance Radar Digest",
			message,
			entityType: "compliance_digest",
			entityId: organizationId,
			actionUrl: "/settings/compliance-radar",
			metadata: {
				summary: findingsSummary,
			},
		});
	} catch (error) {
		logger.error(
			{ error, params },
			"Failed to send compliance digest notification",
		);
	}
}
