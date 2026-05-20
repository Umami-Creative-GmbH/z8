import { and, desc, eq, gte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import type { ComplianceCriticalEvent, ComplianceSectionResult, ComplianceText } from "../types";

const ACCESS_CONTROL_LOOKBACK_HOURS = 24;

function text(key: string, params?: Record<string, string | number>): ComplianceText {
	return params ? { key, params } : { key };
}

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
	description: ComplianceText;
}

export function deriveAccessControlsSection(input: {
	recentSensitiveEvents: AccessControlEventSnapshot[];
}): ComplianceSectionResult {
	const recentCriticalEvents: ComplianceCriticalEvent[] = input.recentSensitiveEvents.map(
		(event) => ({
			id: event.id,
			sectionKey: "accessControls" as const,
			severity:
				event.action === "permission.revoked" || event.action === "app_access.denied"
					? "critical"
					: "warning",
			title: text("compliance.commandCenter.events.sensitiveAction.title", {
				action: event.action,
			}),
			description: event.description,
			occurredAt: event.timestamp,
			primaryLink: {
				label: text("compliance.commandCenter.links.inspectInAuditLog"),
				href: "/settings/enterprise/audit-log",
			},
		}),
	);
	const hasCriticalSignals = input.recentSensitiveEvents.some(
		(event) => event.action === "permission.revoked" || event.action === "app_access.denied",
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
					? text("compliance.commandCenter.sections.accessControls.headline.critical")
					: status === "warning"
						? text("compliance.commandCenter.sections.accessControls.headline.warning")
						: text("compliance.commandCenter.sections.accessControls.headline.healthy"),
			facts: [
				input.recentSensitiveEvents.length > 0
					? text("compliance.commandCenter.facts.access.recentSensitiveEvents", {
							count: input.recentSensitiveEvents.length,
						})
					: text("compliance.commandCenter.facts.access.noSensitiveEvents"),
				input.recentSensitiveEvents[0]
					? text("compliance.commandCenter.facts.access.latestSensitiveAction", {
							action: input.recentSensitiveEvents[0].action,
						})
					: text("compliance.commandCenter.facts.access.latestSensitiveActionNone"),
			],
			updatedAt: DateTime.utc().toISO(),
			primaryLink: {
				label: text("compliance.commandCenter.links.openAuditLog"),
				href: "/settings/enterprise/audit-log",
			},
		},
		recentCriticalEvents: recentCriticalEvents
			.toSorted(
				(left, right) =>
					Number(right.severity === "critical") - Number(left.severity === "critical"),
			)
			.slice(0, 3),
	};
}

export async function getAccessControlsSection(
	organizationId: string,
): Promise<ComplianceSectionResult> {
	const lookbackStart = DateTime.utc().minus({ hours: ACCESS_CONTROL_LOOKBACK_HOURS }).toJSDate();
	const logs = await db.query.auditLog.findMany({
		where: and(eq(auditLog.organizationId, organizationId), gte(auditLog.timestamp, lookbackStart)),
		orderBy: [desc(auditLog.timestamp)],
	});
	const recentSensitiveEvents = logs
		.filter((log) => SENSITIVE_ACTIONS.has(log.action))
		.slice(0, 10)
		.map((log) => ({
			id: log.id,
			action: log.action,
			timestamp: log.timestamp.toISOString(),
			description: text("compliance.commandCenter.events.sensitiveAction.description", {
				action: log.action,
				entityType: log.entityType,
			}),
		}));

	return deriveAccessControlsSection({ recentSensitiveEvents });
}
