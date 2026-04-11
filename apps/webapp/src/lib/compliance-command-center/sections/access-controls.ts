import { DateTime } from "luxon";
import { AuditAction } from "@/lib/audit-logger";
import { getRecentAuditLogs } from "@/lib/query/audit.queries";
import type { ComplianceSectionResult } from "../types";

const SENSITIVE_ACTIONS = new Set<string>([
	AuditAction.PERMISSION_GRANTED,
	AuditAction.PERMISSION_REVOKED,
	AuditAction.MANAGER_ASSIGNED,
	AuditAction.MANAGER_REMOVED,
	AuditAction.MANAGER_PRIMARY_CHANGED,
	AuditAction.APP_ACCESS_GRANTED,
	AuditAction.APP_ACCESS_REVOKED,
	AuditAction.APP_ACCESS_DENIED,
	AuditAction.EMPLOYEE_DEACTIVATED,
]);

export interface AccessControlEventSnapshot {
	id: string;
	action: string;
	timestamp: string;
	description: string;
}

export function deriveAccessControlsSection(input: {
	recentSensitiveEvents: AccessControlEventSnapshot[];
}): ComplianceSectionResult {
	const hasCriticalSignals = input.recentSensitiveEvents.some(
		(event) =>
			event.action === "permission.revoked" ||
			event.action === "app_access.denied",
	);
	const status = hasCriticalSignals
		? "critical"
		: input.recentSensitiveEvents.length > 0
			? "warning"
			: "healthy";

	return {
		card: {
			key: "accessControls",
			status,
			headline:
				status === "critical"
					? "Sensitive control changes need review"
					: status === "warning"
						? "Recent control changes were detected"
						: "No sensitive control changes were logged recently",
			facts: [
				input.recentSensitiveEvents.length > 0
					? `Recent sensitive events: ${input.recentSensitiveEvents.length}`
					: "No sensitive control changes were logged in the last 24 hours.",
				input.recentSensitiveEvents[0]
					? `Latest sensitive action: ${input.recentSensitiveEvents[0].action}`
					: "Latest sensitive action: none",
			],
			updatedAt: DateTime.utc().toISO(),
			primaryLink: {
				label: "Open Audit Log",
				href: "/settings/enterprise/audit-log",
			},
		},
		recentCriticalEvents: input.recentSensitiveEvents.slice(0, 3).map((event) => ({
			id: event.id,
			sectionKey: "accessControls",
			severity:
				event.action === "permission.revoked" || event.action === "app_access.denied"
					? "critical"
					: "warning",
			title: `Sensitive action: ${event.action}`,
			description: event.description,
			occurredAt: event.timestamp,
			primaryLink: {
				label: "Inspect in Audit Log",
				href: "/settings/enterprise/audit-log",
			},
		})),
	};
}

export async function getAccessControlsSection(
	organizationId: string,
): Promise<ComplianceSectionResult> {
	const logs = await getRecentAuditLogs(organizationId, 50);
	const recentSensitiveEvents = logs
		.filter((log) => SENSITIVE_ACTIONS.has(log.action))
		.slice(0, 10)
		.map((log) => ({
			id: log.id,
			action: log.action,
			timestamp: log.timestamp.toISOString(),
			description: `${log.action} on ${log.entityType}`,
		}));

	return deriveAccessControlsSection({ recentSensitiveEvents });
}
