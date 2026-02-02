/**
 * CASL Authorization Types
 *
 * Defines the action and subject types for the RBAC layer.
 *
 * Three distinct role systems:
 * - Platform: user.role ("admin" | "user") - System-wide operations
 * - Organization: member.role ("owner" | "admin" | "member") - Better Auth membership
 * - Employee: employee.role ("admin" | "manager" | "employee") - Workforce permissions
 */

import type { PermissionFlags } from "@/lib/effect/services/permissions.service";

// ============================================
// ACTIONS
// ============================================

/**
 * CASL actions - what can be done
 */
export type Action =
	// CRUD operations
	| "create"
	| "read"
	| "update"
	| "delete"
	// Special operations
	| "manage" // All CRUD + special operations
	| "approve"
	| "reject"
	| "impersonate"
	| "export"
	| "invite"
	| "generate" // For reports
	| "configure"; // For policies/settings

// ============================================
// SUBJECTS
// ============================================

/**
 * Platform-level subjects (require user.role = "admin")
 */
export type PlatformSubject =
	| "Platform" // System-wide operations
	| "User" // All users in the system
	| "Organization"; // All organizations

/**
 * Organization-level subjects (require member.role = "owner" | "admin")
 */
export type OrganizationSubject =
	| "OrgSettings" // Organization settings
	| "OrgBilling" // Billing (owner only)
	| "OrgWebhooks" // Webhooks
	| "OrgMembers" // Member management
	| "OrgIntegrations" // SSO, SCIM, etc.
	| "WorkPolicy" // Work time policies
	| "VacationPolicy" // Vacation/leave policies
	| "Compliance" // Compliance settings
	| "AuditLog" // Audit log access
	| "Export" // Data exports
	| "PayrollExport" // Payroll exports
	| "ScheduledExport" // Scheduled exports
	| "DemoData"; // Demo data management

/**
 * Workforce subjects (use employee.role + permissions)
 */
export type WorkforceSubject =
	| "Team"
	| "Employee"
	| "TimeEntry"
	| "Shift"
	| "Project"
	| "LeaveRequest"
	| "Approval"
	| "Report"
	| "Location"
	| "Absence" // Absence requests
	| "AbsenceAllowance" // Absence allowance management
	| "Schedule" // Scheduling
	| "Calendar" // Calendar access
	| "Surcharge" // Surcharge rules
	| "Holiday"; // Holiday management

/**
 * All subjects combined
 */
export type Subject = PlatformSubject | OrganizationSubject | WorkforceSubject | "all";

// ============================================
// PRINCIPAL CONTEXT
// ============================================

/**
 * Organization membership info from Better Auth
 */
export interface OrgMembership {
	organizationId: string;
	role: "owner" | "admin" | "member";
	status: string;
}

/**
 * Employee info for workforce operations
 */
export interface EmployeeInfo {
	id: string;
	organizationId: string;
	role: "admin" | "manager" | "employee";
	teamId: string | null;
}

/**
 * Team-scoped permission flags
 */
export interface TeamPermissions {
	orgWide: PermissionFlags | null;
	byTeamId: Map<string, PermissionFlags>;
}

/**
 * The principal context used to build CASL abilities.
 * Built from session, membership, employee, and permissions data.
 */
export interface PrincipalContext {
	/** User ID from Better Auth */
	userId: string;

	/** Platform admin flag - user.role === "admin" */
	isPlatformAdmin: boolean;

	/** Active organization from session */
	activeOrganizationId: string | null;

	/** Better Auth organization membership */
	orgMembership: OrgMembership | null;

	/** Employee record for workforce operations */
	employee: EmployeeInfo | null;

	/** Team permissions from teamPermissions table */
	permissions: TeamPermissions;

	/** Manager relationships - employee IDs this user manages */
	managedEmployeeIds: string[];
}

// ============================================
// SUBJECT CONTEXT (for ABAC rules)
// ============================================

/**
 * Subject instances with organization context for ABAC rules.
 * These are used when checking permissions on specific resources.
 */
export interface OrgScopedSubject {
	organizationId: string;
}

export interface TeamScopedSubject extends OrgScopedSubject {
	teamId: string | null;
}

export interface EmployeeScopedSubject extends OrgScopedSubject {
	employeeId: string;
}

/**
 * Approval subject with requester info
 */
export interface ApprovalSubject extends OrgScopedSubject {
	requesterId: string;
	approverId: string;
}

// ============================================
// ABILITY APP TYPES
// ============================================

/**
 * Type mapping for CASL subjects
 */
export type SubjectTypeMap = {
	// Platform subjects
	Platform: "Platform";
	User: { id: string };
	Organization: OrgScopedSubject;

	// Organization subjects
	OrgSettings: OrgScopedSubject;
	OrgBilling: OrgScopedSubject;
	OrgWebhooks: OrgScopedSubject;
	OrgMembers: OrgScopedSubject;
	OrgIntegrations: OrgScopedSubject;
	WorkPolicy: OrgScopedSubject;
	VacationPolicy: OrgScopedSubject;
	Compliance: OrgScopedSubject;
	AuditLog: OrgScopedSubject;
	Export: OrgScopedSubject;
	PayrollExport: OrgScopedSubject;
	ScheduledExport: OrgScopedSubject;
	DemoData: OrgScopedSubject;

	// Workforce subjects
	Team: TeamScopedSubject;
	Employee: EmployeeScopedSubject;
	TimeEntry: EmployeeScopedSubject;
	Shift: TeamScopedSubject;
	Project: OrgScopedSubject;
	LeaveRequest: EmployeeScopedSubject;
	Approval: ApprovalSubject;
	Report: OrgScopedSubject;
	Location: OrgScopedSubject;
	Absence: EmployeeScopedSubject;
	AbsenceAllowance: EmployeeScopedSubject;
	Schedule: TeamScopedSubject;
	Calendar: TeamScopedSubject;
	Surcharge: OrgScopedSubject;
	Holiday: OrgScopedSubject;

	// Wildcard
	all: "all";
};
