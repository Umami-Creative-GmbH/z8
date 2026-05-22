/**
 * CASL Ability Builder
 *
 * Builds CASL abilities from a PrincipalContext.
 * Maps the three role systems to CASL rules:
 *
 * 1. Platform admin (user.role = "admin") → can("manage", "Platform")
 * 2. Org owner/admin (member.role) → org-level subjects
 * 3. Employee role + permissions → workforce subjects
 *
 * Note: This uses simple string subjects without conditions.
 * Organization scoping is handled at the call site by checking
 * that the resource's organizationId matches the principal's activeOrganizationId.
 */

import {
	AbilityBuilder,
	createMongoAbility,
	type ForcedSubject,
	type MongoAbility,
} from "@casl/ability";
import type {
	Action,
	Subject,
	PrincipalContext,
	OrgScopedSubject,
	EmployeeAuthorizationSubject,
	TimeEntryAuthorizationSubject,
	AbsenceAuthorizationSubject,
	ApprovalAuthorizationSubject,
} from "./types";

// ============================================
// ABILITY TYPE
// ============================================

/**
 * Application ability type using string subjects and CASL object subjects
 */
type AppObjectSubject =
	| (EmployeeAuthorizationSubject & ForcedSubject<"Employee">)
	| (TimeEntryAuthorizationSubject & ForcedSubject<"TimeEntry">)
	| (AbsenceAuthorizationSubject & ForcedSubject<"Absence">)
	| (ApprovalAuthorizationSubject & ForcedSubject<"Approval">);

export type AppAbility = MongoAbility<[
	Action,
	Subject | AppObjectSubject,
]>;

// ============================================
// ABILITY BUILDER
// ============================================

/**
 * Build CASL ability from principal context.
 * This is the core function that maps roles and permissions to abilities.
 *
 * IMPORTANT: All abilities are scoped to the principal's activeOrganizationId.
 * Callers must verify that resources belong to the same organization.
 */
export function defineAbilityFor(principal: PrincipalContext): AppAbility {
	const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

	// ----------------------------------------
	// 1. Platform Admin Rules
	// ----------------------------------------
	if (principal.isPlatformAdmin) {
		// Platform admins can do everything
		can("manage", "all");
		return build();
	}

	// ----------------------------------------
	// 2. Organization-Level Rules
	// ----------------------------------------
	if (principal.orgMembership && principal.activeOrganizationId) {
		const { role } = principal.orgMembership;

		// Owner has full org control
		if (role === "owner") {
			can("manage", "Organization");
			can("manage", "OrgSettings");
			can("manage", "OrgBilling");
			can("manage", "OrgWebhooks");
			can("manage", "OrgMembers");
			can("manage", "OrgIntegrations");
			// Policy management
			can("manage", "WorkPolicy");
			can("manage", "VacationPolicy");
			can("manage", "Compliance");
			// Data management
			can("manage", "AuditLog");
			can("manage", "Export");
			can("manage", "PayrollExport");
			can("manage", "ScheduledExport");
			can("manage", "DemoData");
		}

		// Admin has most org control, including billing
		if (role === "admin") {
			can("read", "Organization");
			can("update", "Organization");
			can("manage", "OrgSettings");
			can("manage", "OrgBilling"); // Admins can manage billing too
			can("manage", "OrgWebhooks");
			can("manage", "OrgMembers");
			can("manage", "OrgIntegrations");
			// Policy management
			can("manage", "WorkPolicy");
			can("manage", "VacationPolicy");
			can("manage", "Compliance");
			// Data management
			can("manage", "AuditLog");
			can("manage", "Export");
			can("manage", "PayrollExport");
			can("manage", "ScheduledExport");
			can("manage", "DemoData");
		}

		// Regular members can read basic org info
		if (role === "member") {
			can("read", "Organization");
		}
	}

	// ----------------------------------------
	// 3. Employee/Workforce Rules
	// ----------------------------------------
	if (principal.employee && principal.activeOrganizationId) {
		const empRole = principal.employee.role;
		const teamId = principal.employee.teamId;
		const orgCondition = { organizationId: principal.activeOrganizationId };
		const selfCondition = {
			organizationId: principal.activeOrganizationId,
			employeeId: principal.employee.id,
		};
		const directReportCondition = {
			organizationId: principal.activeOrganizationId,
			employeeId: { $in: principal.managedEmployeeIds },
		};
		const visibleEmployeeIds = [principal.employee.id, ...principal.managedEmployeeIds];
		const outsideOrgCondition = {
			organizationId: { $ne: principal.activeOrganizationId },
		};
		const employeeActions: Action[] = ["create", "read", "update", "delete", "manage"];
		const timeEntryActions: Action[] = ["create", "read", "update", "delete", "manage"];
		const absenceActions: Action[] = [
			"create",
			"read",
			"update",
			"delete",
			"manage",
			"approve",
			"reject",
		];
		const approvalActions: Action[] = ["read", "approve", "reject", "manage"];

		// Employee admin - full workforce access within org
		if (empRole === "admin") {
			can("manage", "Team");
			can("manage", "Shift");
			can("manage", "Project");
			can("manage", "LeaveRequest");
			can("manage", "Report");
			can("generate", "Report");
			can("manage", "Location");
			// Additional workforce subjects
			can("manage", "AbsenceAllowance");
			can("manage", "Schedule");
			can("manage", "Calendar");
			can("manage", "Surcharge");
			can("manage", "Holiday");
		}

		// Manager - can manage direct reports + approvals
		if (empRole === "manager") {
			// Self-service for own data
			can("manage", "TimeEntry");
			can("manage", "LeaveRequest");
			can("manage", "Absence");

			// Can view team info
			if (teamId) {
				can("read", "Team");
				can("read", "Shift");
				can("read", "Schedule");
				can("read", "Calendar");
			}

			// Can approve/reject if has direct reports
			// Object-subject approval grants are applied after additive rules below.

			// Reports access (limited)
			can("read", "Report");
			can("generate", "Report");
		}

		// Regular employee - self-service only
		if (empRole === "employee") {
			can("manage", "TimeEntry");
			can("create", "LeaveRequest");
			can("read", "LeaveRequest");
			can("create", "Absence");
			can("read", "Absence");

			// Can view own team info
			if (teamId) {
				can("read", "Team");
				can("read", "Shift");
				can("read", "Schedule");
				can("read", "Calendar");
			}
		}

		// ----------------------------------------
		// 4. Permission Flag Grants (Team-specific)
		// ----------------------------------------
		const { permissions } = principal;

		// Org-wide permission flags
		if (permissions.orgWide) {
			applyPermissionFlags(can, permissions.orgWide);
		}

		// Team-specific permission flags
		for (const [_, flags] of permissions.byTeamId) {
			applyPermissionFlags(can, flags);
		}

		// ----------------------------------------
		// 5. Custom Role Grants (additive)
		// ----------------------------------------
		for (const customRole of principal.customRoles) {
			for (const perm of customRole.permissions) {
				can(perm.action, perm.subject);
			}
		}

		// Object-subject guardrails must run after additive grants because CASL
		// string-subject grants also match `subject(name, object)` checks.
		if (empRole === "admin") {
			cannot("manage", "Employee", outsideOrgCondition);
			cannot(timeEntryActions, "TimeEntry", outsideOrgCondition);
			cannot(absenceActions, "Absence", outsideOrgCondition);
			cannot(approvalActions, "Approval", outsideOrgCondition);
			can("manage", "Employee", orgCondition);
			can("manage", "TimeEntry", orgCondition);
			can("manage", "Absence", orgCondition);
			can("manage", "Approval", orgCondition);
		}

		if (empRole === "manager") {
			cannot(employeeActions, "Employee", outsideOrgCondition);
			cannot(employeeActions, "Employee", {
				employeeId: { $nin: visibleEmployeeIds },
			});
			cannot(timeEntryActions, "TimeEntry", outsideOrgCondition);
			cannot(timeEntryActions, "TimeEntry", {
				employeeId: { $nin: visibleEmployeeIds },
			});
			cannot(absenceActions, "Absence", outsideOrgCondition);
			cannot(absenceActions, "Absence", {
				employeeId: { $nin: visibleEmployeeIds },
			});
			cannot(["update", "delete", "manage", "approve", "reject"], "Absence", orgCondition);
			cannot(approvalActions, "Approval", outsideOrgCondition);
			cannot(approvalActions, "Approval", orgCondition);
			can(["read", "update"], "Employee", selfCondition);
			can("read", "Employee", directReportCondition);
			can("read", "TimeEntry", selfCondition);
			can("read", "TimeEntry", directReportCondition);
			can(["read", "create"], "Absence", selfCondition);
			can(["read", "approve", "reject"], "Absence", directReportCondition);

			if (principal.managedEmployeeIds.length > 0) {
				can(["read", "approve", "reject"], "Approval", {
					organizationId: principal.activeOrganizationId,
					requestedBy: { $in: principal.managedEmployeeIds },
				});
			}
		}

		if (empRole === "employee") {
			cannot(employeeActions, "Employee", outsideOrgCondition);
			cannot(employeeActions, "Employee", {
				employeeId: { $ne: principal.employee.id },
			});
			cannot(timeEntryActions, "TimeEntry", outsideOrgCondition);
			cannot(timeEntryActions, "TimeEntry", {
				employeeId: { $ne: principal.employee.id },
			});
			cannot(absenceActions, "Absence", outsideOrgCondition);
			cannot(absenceActions, "Absence", {
				employeeId: { $ne: principal.employee.id },
			});
			cannot(approvalActions, "Approval", outsideOrgCondition);
			cannot(approvalActions, "Approval", orgCondition);
			can(["read", "update"], "Employee", selfCondition);
			can("read", "TimeEntry", selfCondition);
			can(["read", "create"], "Absence", selfCondition);
		}
	}

	return build();
}

/**
 * Apply granular permission flags to abilities
 */
function applyPermissionFlags(
	can: AbilityBuilder<AppAbility>["can"],
	flags: {
		canCreateTeams?: boolean;
		canManageTeamMembers?: boolean;
		canManageTeamSettings?: boolean;
		canApproveTeamRequests?: boolean;
	},
): void {
	if (flags.canCreateTeams) {
		can("create", "Team");
	}

	if (flags.canManageTeamMembers) {
		can("update", "Team");
		can("invite", "Team");
	}

	if (flags.canManageTeamSettings) {
		can("update", "Team");
	}

	if (flags.canApproveTeamRequests) {
		can("approve", "Approval");
		can("reject", "Approval");
	}
}

// ============================================
// CONVENIENCE HELPERS
// ============================================

/**
 * Create an empty ability (for unauthenticated users)
 */
export function createEmptyAbility(): AppAbility {
	return createMongoAbility<[Action, Subject]>([]);
}

/**
 * Check if ability allows an action on a subject
 */
export function can(
	ability: AppAbility,
	action: Action,
	subject: Subject,
): boolean {
	return ability.can(action, subject);
}

/**
 * Check if ability denies an action on a subject
 */
export function cannot(
	ability: AppAbility,
	action: Action,
	subject: Subject,
): boolean {
	return ability.cannot(action, subject);
}
