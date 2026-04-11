import { and, desc, eq, gte } from "drizzle-orm";
import { DateTime } from "luxon";
import { AuditAction } from "@/lib/audit-logger";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import type { ComplianceSectionResult } from "../types";

const ACCESS_CONTROL_LOOKBACK_HOURS = 24;
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
	const recentCriticalEvents = input.recentSensitiveEvents.map((event) => ({
		id: event.id,
		sectionKey: "accessControls" as const,
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
	}));
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
		recentCriticalEvents: recentCriticalEvents
			.toSorted((left, right) => Number(right.severity === "critical") - Number(left.severity === "critical"))
			.slice(0, 3),
	};
}

export async function getAccessControlsSection(
	organizationId: string,
): Promise<ComplianceSectionResult> {
	const lookbackStart = DateTime.utc()
		.minus({ hours: ACCESS_CONTROL_LOOKBACK_HOURS })
		.toJSDate();
	const logs = await db.query.auditLog.findMany({
		where: and(
			eq(auditLog.organizationId, organizationId),
			gte(auditLog.timestamp, lookbackStart),
		),
		orderBy: [desc(auditLog.timestamp)],
	});
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
