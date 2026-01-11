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

	// Surcharge Operations
	SURCHARGE_MODEL_CREATED = "surcharge.model_created",
	SURCHARGE_MODEL_UPDATED = "surcharge.model_updated",
	SURCHARGE_MODEL_DELETED = "surcharge.model_deleted",
	SURCHARGE_RULE_CREATED = "surcharge.rule_created",
	SURCHARGE_RULE_UPDATED = "surcharge.rule_updated",
	SURCHARGE_RULE_DELETED = "surcharge.rule_deleted",
	SURCHARGE_ASSIGNMENT_CREATED = "surcharge.assignment_created",
	SURCHARGE_ASSIGNMENT_DELETED = "surcharge.assignment_deleted",
	SURCHARGE_CALCULATION_CREATED = "surcharge.calculation_created",
	SURCHARGE_CALCULATION_RECALCULATED = "surcharge.calculation_recalculated",

	// Project Operations
	PROJECT_CREATED = "project.created",
	PROJECT_UPDATED = "project.updated",
	PROJECT_STATUS_CHANGED = "project.status_changed",
	PROJECT_ARCHIVED = "project.archived",
	PROJECT_MANAGER_ASSIGNED = "project.manager_assigned",
	PROJECT_MANAGER_REMOVED = "project.manager_removed",
	PROJECT_ASSIGNMENT_ADDED = "project.assignment_added",
	PROJECT_ASSIGNMENT_REMOVED = "project.assignment_removed",
	WORK_PERIOD_PROJECT_ASSIGNED = "work_period.project_assigned",
	WORK_PERIOD_PROJECT_UNASSIGNED = "work_period.project_unassigned",
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
		| "vacation"
		| "surcharge_model"
		| "surcharge_rule"
		| "surcharge_assignment"
		| "surcharge_calculation"
		| "project"
		| "project_assignment"
		| "work_period";
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
			headers.Authorization = `Splunk ${config.apiKey}`;
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

// ============================================
// SURCHARGE AUDIT HELPERS
// ============================================

/**
 * Log surcharge model creation
 */
export function logSurchargeModelCreation(
	params: {
		modelId: string;
		modelName: string;
		rulesCount: number;
		createdBy: string;
		createdByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.SURCHARGE_MODEL_CREATED,
		actorId: params.createdBy,
		actorEmail: params.createdByEmail,
		targetId: params.modelId,
		targetType: "surcharge_model",
		organizationId: params.organizationId,
		metadata: {
			modelName: params.modelName,
			rulesCount: params.rulesCount,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log surcharge model update
 */
export function logSurchargeModelUpdate(
	params: {
		modelId: string;
		modelName: string;
		changes: Record<string, unknown>;
		updatedBy: string;
		updatedByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.SURCHARGE_MODEL_UPDATED,
		actorId: params.updatedBy,
		actorEmail: params.updatedByEmail,
		targetId: params.modelId,
		targetType: "surcharge_model",
		organizationId: params.organizationId,
		changes: params.changes,
		metadata: {
			modelName: params.modelName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log surcharge model deletion (soft delete)
 */
export function logSurchargeModelDeletion(
	params: {
		modelId: string;
		modelName: string;
		deletedBy: string;
		deletedByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.SURCHARGE_MODEL_DELETED,
		actorId: params.deletedBy,
		actorEmail: params.deletedByEmail,
		targetId: params.modelId,
		targetType: "surcharge_model",
		organizationId: params.organizationId,
		metadata: {
			modelName: params.modelName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log surcharge rule creation
 */
export function logSurchargeRuleCreation(
	params: {
		ruleId: string;
		ruleName: string;
		ruleType: "day_of_week" | "time_window" | "date_based";
		percentage: number;
		modelId: string;
		modelName: string;
		createdBy: string;
		createdByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.SURCHARGE_RULE_CREATED,
		actorId: params.createdBy,
		actorEmail: params.createdByEmail,
		targetId: params.ruleId,
		targetType: "surcharge_rule",
		organizationId: params.organizationId,
		metadata: {
			ruleName: params.ruleName,
			ruleType: params.ruleType,
			percentage: params.percentage,
			modelId: params.modelId,
			modelName: params.modelName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log surcharge rule deletion
 */
export function logSurchargeRuleDeletion(
	params: {
		ruleId: string;
		ruleName: string;
		modelId: string;
		modelName: string;
		deletedBy: string;
		deletedByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.SURCHARGE_RULE_DELETED,
		actorId: params.deletedBy,
		actorEmail: params.deletedByEmail,
		targetId: params.ruleId,
		targetType: "surcharge_rule",
		organizationId: params.organizationId,
		metadata: {
			ruleName: params.ruleName,
			modelId: params.modelId,
			modelName: params.modelName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log surcharge assignment creation
 */
export function logSurchargeAssignmentCreation(
	params: {
		assignmentId: string;
		assignmentType: "organization" | "team" | "employee";
		modelId: string;
		modelName: string;
		targetName?: string; // Team or employee name (if applicable)
		createdBy: string;
		createdByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.SURCHARGE_ASSIGNMENT_CREATED,
		actorId: params.createdBy,
		actorEmail: params.createdByEmail,
		targetId: params.assignmentId,
		targetType: "surcharge_assignment",
		organizationId: params.organizationId,
		metadata: {
			assignmentType: params.assignmentType,
			modelId: params.modelId,
			modelName: params.modelName,
			targetName: params.targetName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log surcharge assignment deletion
 */
export function logSurchargeAssignmentDeletion(
	params: {
		assignmentId: string;
		assignmentType: "organization" | "team" | "employee";
		modelName: string;
		targetName?: string;
		deletedBy: string;
		deletedByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.SURCHARGE_ASSIGNMENT_DELETED,
		actorId: params.deletedBy,
		actorEmail: params.deletedByEmail,
		targetId: params.assignmentId,
		targetType: "surcharge_assignment",
		organizationId: params.organizationId,
		metadata: {
			assignmentType: params.assignmentType,
			modelName: params.modelName,
			targetName: params.targetName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log surcharge calculation (called on clock-out)
 */
export function logSurchargeCalculation(params: {
	calculationId: string;
	workPeriodId: string;
	employeeId: string;
	employeeName: string;
	modelId: string;
	modelName: string;
	baseMinutes: number;
	qualifyingMinutes: number;
	surchargeMinutes: number;
	rulesApplied: Array<{
		ruleName: string;
		ruleType: string;
		percentage: number;
		minutes: number;
	}>;
	organizationId: string;
}): Promise<void> {
	return logAudit({
		action: AuditAction.SURCHARGE_CALCULATION_CREATED,
		actorId: params.employeeId, // System action on behalf of employee
		targetId: params.calculationId,
		targetType: "surcharge_calculation",
		employeeId: params.employeeId,
		organizationId: params.organizationId,
		metadata: {
			workPeriodId: params.workPeriodId,
			employeeName: params.employeeName,
			modelId: params.modelId,
			modelName: params.modelName,
			baseMinutes: params.baseMinutes,
			qualifyingMinutes: params.qualifyingMinutes,
			surchargeMinutes: params.surchargeMinutes,
			rulesApplied: params.rulesApplied,
		},
		timestamp: new Date(),
	});
}

/**
 * Log surcharge recalculation (manual recalculation by admin)
 */
export function logSurchargeRecalculation(
	params: {
		calculationId: string;
		workPeriodId: string;
		employeeId: string;
		employeeName: string;
		previousSurchargeMinutes: number;
		newSurchargeMinutes: number;
		reason?: string;
		recalculatedBy: string;
		recalculatedByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.SURCHARGE_CALCULATION_RECALCULATED,
		actorId: params.recalculatedBy,
		actorEmail: params.recalculatedByEmail,
		targetId: params.calculationId,
		targetType: "surcharge_calculation",
		employeeId: params.employeeId,
		organizationId: params.organizationId,
		changes: {
			previous: { surchargeMinutes: params.previousSurchargeMinutes },
			current: { surchargeMinutes: params.newSurchargeMinutes },
		},
		metadata: {
			workPeriodId: params.workPeriodId,
			employeeName: params.employeeName,
			reason: params.reason,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

// ============================================
// PROJECT AUDIT HELPERS
// ============================================

/**
 * Log project creation
 */
export function logProjectCreation(
	params: {
		projectId: string;
		projectName: string;
		status: string;
		budgetHours?: number | null;
		deadline?: Date | null;
		createdBy: string;
		createdByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.PROJECT_CREATED,
		actorId: params.createdBy,
		actorEmail: params.createdByEmail,
		targetId: params.projectId,
		targetType: "project",
		organizationId: params.organizationId,
		metadata: {
			projectName: params.projectName,
			status: params.status,
			budgetHours: params.budgetHours,
			deadline: params.deadline?.toISOString(),
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log project update
 */
export function logProjectUpdate(
	params: {
		projectId: string;
		projectName: string;
		changes: Record<string, { from: unknown; to: unknown }>;
		updatedBy: string;
		updatedByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.PROJECT_UPDATED,
		actorId: params.updatedBy,
		actorEmail: params.updatedByEmail,
		targetId: params.projectId,
		targetType: "project",
		organizationId: params.organizationId,
		changes: params.changes,
		metadata: {
			projectName: params.projectName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log project status change
 */
export function logProjectStatusChange(
	params: {
		projectId: string;
		projectName: string;
		previousStatus: string;
		newStatus: string;
		changedBy: string;
		changedByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.PROJECT_STATUS_CHANGED,
		actorId: params.changedBy,
		actorEmail: params.changedByEmail,
		targetId: params.projectId,
		targetType: "project",
		organizationId: params.organizationId,
		changes: {
			status: { from: params.previousStatus, to: params.newStatus },
		},
		metadata: {
			projectName: params.projectName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log project archive
 */
export function logProjectArchive(
	params: {
		projectId: string;
		projectName: string;
		archivedBy: string;
		archivedByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.PROJECT_ARCHIVED,
		actorId: params.archivedBy,
		actorEmail: params.archivedByEmail,
		targetId: params.projectId,
		targetType: "project",
		organizationId: params.organizationId,
		metadata: {
			projectName: params.projectName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log project manager assignment
 */
export function logProjectManagerAssignment(
	params: {
		projectId: string;
		projectName: string;
		managerId: string;
		managerName: string;
		assignedBy: string;
		assignedByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.PROJECT_MANAGER_ASSIGNED,
		actorId: params.assignedBy,
		actorEmail: params.assignedByEmail,
		targetId: params.projectId,
		targetType: "project",
		organizationId: params.organizationId,
		metadata: {
			projectName: params.projectName,
			managerId: params.managerId,
			managerName: params.managerName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log project manager removal
 */
export function logProjectManagerRemoval(
	params: {
		projectId: string;
		projectName: string;
		managerId: string;
		managerName: string;
		removedBy: string;
		removedByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.PROJECT_MANAGER_REMOVED,
		actorId: params.removedBy,
		actorEmail: params.removedByEmail,
		targetId: params.projectId,
		targetType: "project",
		organizationId: params.organizationId,
		metadata: {
			projectName: params.projectName,
			managerId: params.managerId,
			managerName: params.managerName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log project assignment addition (team or employee)
 */
export function logProjectAssignmentAdded(
	params: {
		projectId: string;
		projectName: string;
		assignmentType: "team" | "employee";
		assignmentTargetId: string;
		assignmentTargetName: string;
		addedBy: string;
		addedByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.PROJECT_ASSIGNMENT_ADDED,
		actorId: params.addedBy,
		actorEmail: params.addedByEmail,
		targetId: params.projectId,
		targetType: "project_assignment",
		organizationId: params.organizationId,
		metadata: {
			projectName: params.projectName,
			assignmentType: params.assignmentType,
			assignmentTargetId: params.assignmentTargetId,
			assignmentTargetName: params.assignmentTargetName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log project assignment removal
 */
export function logProjectAssignmentRemoved(
	params: {
		projectId: string;
		projectName: string;
		assignmentType: "team" | "employee";
		assignmentTargetId: string;
		assignmentTargetName: string;
		removedBy: string;
		removedByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.PROJECT_ASSIGNMENT_REMOVED,
		actorId: params.removedBy,
		actorEmail: params.removedByEmail,
		targetId: params.projectId,
		targetType: "project_assignment",
		organizationId: params.organizationId,
		metadata: {
			projectName: params.projectName,
			assignmentType: params.assignmentType,
			assignmentTargetId: params.assignmentTargetId,
			assignmentTargetName: params.assignmentTargetName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log work period project assignment
 */
export function logWorkPeriodProjectAssigned(
	params: {
		workPeriodId: string;
		employeeId: string;
		employeeName: string;
		projectId: string;
		projectName: string;
		previousProjectId?: string | null;
		previousProjectName?: string | null;
		assignedBy: string;
		assignedByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.WORK_PERIOD_PROJECT_ASSIGNED,
		actorId: params.assignedBy,
		actorEmail: params.assignedByEmail,
		targetId: params.workPeriodId,
		targetType: "work_period",
		employeeId: params.employeeId,
		organizationId: params.organizationId,
		changes: {
			projectId: {
				from: params.previousProjectId,
				to: params.projectId,
			},
			projectName: {
				from: params.previousProjectName,
				to: params.projectName,
			},
		},
		metadata: {
			employeeName: params.employeeName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}

/**
 * Log work period project unassignment
 */
export function logWorkPeriodProjectUnassigned(
	params: {
		workPeriodId: string;
		employeeId: string;
		employeeName: string;
		previousProjectId: string;
		previousProjectName: string;
		unassignedBy: string;
		unassignedByEmail: string;
		organizationId: string;
	} & AuditContext,
): Promise<void> {
	return logAudit({
		action: AuditAction.WORK_PERIOD_PROJECT_UNASSIGNED,
		actorId: params.unassignedBy,
		actorEmail: params.unassignedByEmail,
		targetId: params.workPeriodId,
		targetType: "work_period",
		employeeId: params.employeeId,
		organizationId: params.organizationId,
		changes: {
			projectId: {
				from: params.previousProjectId,
				to: null,
			},
			projectName: {
				from: params.previousProjectName,
				to: null,
			},
		},
		metadata: {
			employeeName: params.employeeName,
		},
		timestamp: new Date(),
		ipAddress: params.ipAddress,
		userAgent: params.userAgent,
	});
}
