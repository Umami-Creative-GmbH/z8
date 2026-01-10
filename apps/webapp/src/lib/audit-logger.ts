/**
 * Audit Logger
 *
 * Centralized audit logging for tracking important actions in the system.
 * Logs are structured, persisted to database, and can be sent to external logging services.
 */

import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { createLogger } from "@/lib/logger";

const logger = createLogger("AuditLog");

export enum AuditAction {
	// Manager Operations
	MANAGER_ASSIGNED = "manager.assigned",
	MANAGER_REMOVED = "manager.removed",
	MANAGER_PRIMARY_CHANGED = "manager.primary_changed",

	// Permission Operations
	PERMISSION_GRANTED = "permission.granted",
	PERMISSION_REVOKED = "permission.revoked",

	// Work Schedule Operations
	SCHEDULE_CREATED = "schedule.created",
	SCHEDULE_UPDATED = "schedule.updated",

	// Team Operations
	TEAM_CREATED = "team.created",
	TEAM_UPDATED = "team.updated",
	TEAM_DELETED = "team.deleted",
	TEAM_MEMBER_ADDED = "team.member_added",
	TEAM_MEMBER_REMOVED = "team.member_removed",

	// Employee Operations
	EMPLOYEE_CREATED = "employee.created",
	EMPLOYEE_UPDATED = "employee.updated",
	EMPLOYEE_DEACTIVATED = "employee.deactivated",
	EMPLOYEE_REACTIVATED = "employee.reactivated",

	// Organization Operations
	ORGANIZATION_CREATED = "organization.created",
	INVITATION_SENT = "invitation.sent",
	INVITATION_ACCEPTED = "invitation.accepted",

	// Time Entry Operations
	TIME_ENTRY_CREATED = "time_entry.created",
	TIME_ENTRY_CORRECTED = "time_entry.corrected",
	TIME_ENTRY_CHAIN_VERIFIED = "time_entry.chain_verified",

	// Absence Operations
	ABSENCE_REQUESTED = "absence.requested",
	ABSENCE_APPROVED = "absence.approved",
	ABSENCE_REJECTED = "absence.rejected",
	ABSENCE_CANCELLED = "absence.cancelled",

	// Approval Operations
	APPROVAL_SUBMITTED = "approval.submitted",
	APPROVAL_APPROVED = "approval.approved",
	APPROVAL_REJECTED = "approval.rejected",

	// Vacation Operations
	VACATION_CARRYOVER_APPLIED = "vacation.carryover_applied",
	VACATION_CARRYOVER_EXPIRED = "vacation.carryover_expired",
	VACATION_ALLOWANCE_UPDATED = "vacation.allowance_updated",

	// Authentication Operations
	LOGIN_SUCCESS = "auth.login_success",
	LOGIN_FAILED = "auth.login_failed",
	LOGOUT = "auth.logout",
	PASSWORD_CHANGED = "auth.password_changed",
	TWO_FACTOR_ENABLED = "auth.two_factor_enabled",
	TWO_FACTOR_DISABLED = "auth.two_factor_disabled",
}

export interface AuditLogEntry {
	action: AuditAction;
	actorId: string; // User ID of who performed the action
	actorEmail?: string;
	employeeId?: string; // Employee ID if action is on behalf of an employee
	targetId?: string; // Entity ID being affected
	targetType?:
		| "employee"
		| "team"
		| "organization"
		| "permission"
		| "schedule"
		| "time_entry"
		| "absence"
		| "approval"
		| "vacation";
	organizationId: string;
	metadata?: Record<string, unknown>;
	changes?: Record<string, unknown>; // Before/after changes for updates
	timestamp: Date;
	ipAddress?: string;
	userAgent?: string;
}

/**
 * Configuration for external audit services
 */
export interface ExternalAuditConfig {
	service: "datadog" | "splunk" | "webhook" | "none";
	endpoint?: string;
	apiKey?: string;
}

/**
 * Get external audit service configuration from environment
 */
function getExternalAuditConfig(): ExternalAuditConfig {
	const service = (process.env.AUDIT_SERVICE as ExternalAuditConfig["service"]) || "none";
	return {
		service,
		endpoint: process.env.AUDIT_ENDPOINT,
		apiKey: process.env.AUDIT_API_KEY,
	};
}

/**
 * Send audit log to external service (DataDog, Splunk, or custom webhook)
 */
async function sendToExternalService(entry: AuditLogEntry): Promise<void> {
	const config = getExternalAuditConfig();

	if (config.service === "none" || !config.endpoint) {
		return;
	}

	try {
		const payload = {
			timestamp: entry.timestamp.toISOString(),
			action: entry.action,
			actor: {
				userId: entry.actorId,
				email: entry.actorEmail,
			},
			target: {
				type: entry.targetType,
				id: entry.targetId,
			},
			organizationId: entry.organizationId,
			metadata: entry.metadata,
			changes: entry.changes,
			context: {
				ipAddress: entry.ipAddress,
				userAgent: entry.userAgent,
			},
		};

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};

		// Add service-specific headers
		if (config.service === "datadog" && config.apiKey) {
			headers["DD-API-KEY"] = config.apiKey;
		} else if (config.service === "splunk" && config.apiKey) {
			headers["Authorization"] = `Splunk ${config.apiKey}`;
		}

		await fetch(config.endpoint, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
		});
	} catch (error) {
		// Log error but don't fail the operation
		logger.error({ error, action: entry.action }, "Failed to send audit log to external service");
	}
}

/**
 * Log an audit event
 *
 * Persists to database and optionally sends to external audit service.
 * Never throws - audit logging should not break the application.
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
	const logEntry = {
		...entry,
		timestamp: entry.timestamp.toISOString(),
	};

	// Always log to console/structured logger
	logger.info(logEntry, `Audit: ${entry.action}`);

	// Persist to database
	try {
		await db.insert(auditLog).values({
			entityType: entry.targetType || "unknown",
			entityId: entry.targetId || "00000000-0000-0000-0000-000000000000", // Fallback UUID for non-entity actions
			action: entry.action,
			performedBy: entry.actorId,
			employeeId: entry.employeeId,
			changes: entry.changes ? JSON.stringify(entry.changes) : null,
			metadata: JSON.stringify({
				actorEmail: entry.actorEmail,
				organizationId: entry.organizationId,
				...entry.metadata,
			}),
			ipAddress: entry.ipAddress,
			userAgent: entry.userAgent,
			timestamp: entry.timestamp,
		});
	} catch (error) {
		// Log error but don't fail the operation - audit logging should not break the app
		logger.error({ error, action: entry.action }, "Failed to persist audit log to database");
	}

	// Send to external service (async, fire-and-forget)
	sendToExternalService(entry).catch(() => {
		// Already logged in sendToExternalService
	});
}

/**
 * Synchronous version of logAudit for backwards compatibility
 * Deprecated: Use logAudit (async) instead
 */
export function logAuditSync(entry: AuditLogEntry): void {
	// Fire and forget - don't await
	logAudit(entry).catch((error) => {
		logger.error({ error }, "Failed to log audit entry");
	});
}

/**
 * Common parameters for audit context (IP, User-Agent)
 */
export interface AuditContext {
	ipAddress?: string;
	userAgent?: string;
}

/**
 * Log manager assignment
 */
export function logManagerAssignment(
	params: {
		employeeId: string;
		employeeName: string;
		managerId: string;
		managerName: string;
		isPrimary: boolean;
		assignedBy: string;
		assignedByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.MANAGER_ASSIGNED,
		actorId: params.assignedBy,
		actorEmail: params.assignedByEmail,
		targetId: params.employeeId,
		targetType: "employee",
		organizationId: params.organizationId,
		metadata: {
			employeeName: params.employeeName,
			managerId: params.managerId,
			managerName: params.managerName,
			isPrimary: params.isPrimary,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log manager removal
 */
export function logManagerRemoval(
	params: {
		employeeId: string;
		employeeName: string;
		managerId: string;
		managerName: string;
		removedBy: string;
		removedByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.MANAGER_REMOVED,
		actorId: params.removedBy,
		actorEmail: params.removedByEmail,
		targetId: params.employeeId,
		targetType: "employee",
		organizationId: params.organizationId,
		metadata: {
			employeeName: params.employeeName,
			managerId: params.managerId,
			managerName: params.managerName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log permission grant
 */
export function logPermissionGrant(
	params: {
		employeeId: string;
		employeeName: string;
		permissions: string[];
		scope: "organization" | "team";
		teamId?: string;
		teamName?: string;
		grantedBy: string;
		grantedByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.PERMISSION_GRANTED,
		actorId: params.grantedBy,
		actorEmail: params.grantedByEmail,
		targetId: params.employeeId,
		targetType: "permission",
		organizationId: params.organizationId,
		metadata: {
			employeeName: params.employeeName,
			permissions: params.permissions,
			scope: params.scope,
			teamId: params.teamId,
			teamName: params.teamName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log permission revocation
 */
export function logPermissionRevocation(
	params: {
		employeeId: string;
		employeeName: string;
		scope: "organization" | "team";
		teamId?: string;
		teamName?: string;
		revokedBy: string;
		revokedByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.PERMISSION_REVOKED,
		actorId: params.revokedBy,
		actorEmail: params.revokedByEmail,
		targetId: params.employeeId,
		targetType: "permission",
		organizationId: params.organizationId,
		metadata: {
			employeeName: params.employeeName,
			scope: params.scope,
			teamId: params.teamId,
			teamName: params.teamName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log work schedule change
 */
export function logScheduleChange(
	params: {
		employeeId: string;
		employeeName: string;
		scheduleType: "simple" | "detailed";
		hoursPerWeek?: number;
		workClassification: string;
		effectiveFrom: Date;
		createdBy: string;
		createdByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.SCHEDULE_CREATED,
		actorId: params.createdBy,
		actorEmail: params.createdByEmail,
		targetId: params.employeeId,
		targetType: "schedule",
		organizationId: params.organizationId,
		metadata: {
			employeeName: params.employeeName,
			scheduleType: params.scheduleType,
			hoursPerWeek: params.hoursPerWeek,
			workClassification: params.workClassification,
			effectiveFrom: params.effectiveFrom.toISOString(),
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log team creation
 */
export function logTeamCreation(
	params: {
		teamId: string;
		teamName: string;
		createdBy: string;
		createdByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.TEAM_CREATED,
		actorId: params.createdBy,
		actorEmail: params.createdByEmail,
		targetId: params.teamId,
		targetType: "team",
		organizationId: params.organizationId,
		metadata: {
			teamName: params.teamName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log team member addition
 */
export function logTeamMemberAddition(
	params: {
		teamId: string;
		teamName: string;
		employeeId: string;
		employeeName: string;
		addedBy: string;
		addedByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.TEAM_MEMBER_ADDED,
		actorId: params.addedBy,
		actorEmail: params.addedByEmail,
		targetId: params.teamId,
		targetType: "team",
		organizationId: params.organizationId,
		metadata: {
			teamName: params.teamName,
			employeeId: params.employeeId,
			employeeName: params.employeeName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log employee creation
 */
export function logEmployeeCreation(
	params: {
		employeeId: string;
		employeeName: string;
		employeeEmail: string;
		role: string;
		teamId?: string;
		teamName?: string;
		createdBy: string;
		createdByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.EMPLOYEE_CREATED,
		actorId: params.createdBy,
		actorEmail: params.createdByEmail,
		targetId: params.employeeId,
		targetType: "employee",
		organizationId: params.organizationId,
		metadata: {
			employeeName: params.employeeName,
			employeeEmail: params.employeeEmail,
			role: params.role,
			teamId: params.teamId,
			teamName: params.teamName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}
