/**
 * Audit Logger
 *
 * Centralized audit logging for tracking important actions in the system.
 * Logs are structured and can be sent to external logging services.
 */

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
}

export interface AuditLogEntry {
	action: AuditAction;
	actorId: string;
	actorEmail?: string;
	targetId?: string;
	targetType?: "employee" | "team" | "organization" | "permission" | "schedule";
	organizationId: string;
	metadata?: Record<string, any>;
	timestamp: Date;
	ipAddress?: string;
	userAgent?: string;
}

/**
 * Log an audit event
 */
export function logAudit(entry: AuditLogEntry): void {
	const logEntry = {
		...entry,
		timestamp: entry.timestamp.toISOString(),
	};

	logger.info(logEntry, `Audit: ${entry.action}`);

	// TODO: Send to external audit logging service (e.g., DataDog, Splunk)
	// await sendToAuditService(logEntry);
}

/**
 * Log manager assignment
 */
export function logManagerAssignment(params: {
	employeeId: string;
	employeeName: string;
	managerId: string;
	managerName: string;
	isPrimary: boolean;
	assignedBy: string;
	assignedByEmail: string;
	organizationId: string;
}): void {
	logAudit({
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
	});
}

/**
 * Log manager removal
 */
export function logManagerRemoval(params: {
	employeeId: string;
	employeeName: string;
	managerId: string;
	managerName: string;
	removedBy: string;
	removedByEmail: string;
	organizationId: string;
}): void {
	logAudit({
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
	});
}

/**
 * Log permission grant
 */
export function logPermissionGrant(params: {
	employeeId: string;
	employeeName: string;
	permissions: string[];
	scope: "organization" | "team";
	teamId?: string;
	teamName?: string;
	grantedBy: string;
	grantedByEmail: string;
	organizationId: string;
}): void {
	logAudit({
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
	});
}

/**
 * Log permission revocation
 */
export function logPermissionRevocation(params: {
	employeeId: string;
	employeeName: string;
	scope: "organization" | "team";
	teamId?: string;
	teamName?: string;
	revokedBy: string;
	revokedByEmail: string;
	organizationId: string;
}): void {
	logAudit({
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
	});
}

/**
 * Log work schedule change
 */
export function logScheduleChange(params: {
	employeeId: string;
	employeeName: string;
	scheduleType: "simple" | "detailed";
	hoursPerWeek?: number;
	workClassification: string;
	effectiveFrom: Date;
	createdBy: string;
	createdByEmail: string;
	organizationId: string;
}): void {
	logAudit({
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
	});
}

/**
 * Log team creation
 */
export function logTeamCreation(params: {
	teamId: string;
	teamName: string;
	createdBy: string;
	createdByEmail: string;
	organizationId: string;
}): void {
	logAudit({
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
	});
}

/**
 * Log team member addition
 */
export function logTeamMemberAddition(params: {
	teamId: string;
	teamName: string;
	employeeId: string;
	employeeName: string;
	addedBy: string;
	addedByEmail: string;
	organizationId: string;
}): void {
	logAudit({
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
	});
}

/**
 * Log employee creation
 */
export function logEmployeeCreation(params: {
	employeeId: string;
	employeeName: string;
	employeeEmail: string;
	role: string;
	teamId?: string;
	teamName?: string;
	createdBy: string;
	createdByEmail: string;
	organizationId: string;
}): void {
	logAudit({
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
	});
}
