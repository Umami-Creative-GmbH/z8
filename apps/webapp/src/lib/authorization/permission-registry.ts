/**
 * Permission Registry
 *
 * Centralized definition of all available {action, subject} permission pairs
 * organized by category. Used by the custom roles feature to present
 * a permission matrix in the UI and validate permission assignments.
 */

import type { Action, Subject } from "./types";

// ============================================
// TYPES
// ============================================

export type PermissionCategory =
	| "workforce"
	| "time_tracking"
	| "approvals"
	| "reporting"
	| "organization"
	| "projects"
	| "scheduling"
	| "works_council";

export interface PermissionDefinition {
	action: Action;
	subject: Subject;
	category: PermissionCategory;
	labelKey: string;
	descriptionKey: string;
	label: string;
	description: string;
}

type PermissionDefinitionInput = Omit<PermissionDefinition, "labelKey" | "descriptionKey"> &
	Partial<Pick<PermissionDefinition, "labelKey" | "descriptionKey">>;

function permissionCopy(
	action: Action,
	subject: Subject,
	label: string,
	description: string,
): Pick<PermissionDefinition, "labelKey" | "descriptionKey" | "label" | "description"> {
	return {
		labelKey: `settings.roles.permissions.${action}.${subject}.label`,
		descriptionKey: `settings.roles.permissions.${action}.${subject}.description`,
		label,
		description,
	};
}

// ============================================
// PERMISSION REGISTRY
// ============================================

/**
 * All available permission pairs keyed by "action:subject".
 * These are the permissions that can be granted via custom roles.
 */
const PERMISSION_DEFINITIONS: Record<string, PermissionDefinitionInput> = {
	// ---- Workforce ----
	"manage:Employee": {
		action: "manage",
		subject: "Employee",
		category: "workforce",
		...permissionCopy(
			"manage",
			"Employee",
			"Manage Employees",
			"Full access to employee profiles and settings",
		),
	},
	"read:Employee": {
		action: "read",
		subject: "Employee",
		category: "workforce",
		label: "View Employees",
		description: "View employee profiles",
	},
	"update:Employee": {
		action: "update",
		subject: "Employee",
		category: "workforce",
		label: "Edit Employees",
		description: "Edit employee profiles and information",
	},
	"manage:Team": {
		action: "manage",
		subject: "Team",
		category: "workforce",
		label: "Manage Teams",
		description: "Full access to team management",
	},
	"create:Team": {
		action: "create",
		subject: "Team",
		category: "workforce",
		label: "Create Teams",
		description: "Create new teams in the organization",
	},
	"read:Team": {
		action: "read",
		subject: "Team",
		category: "workforce",
		label: "View Teams",
		description: "View team information and members",
	},
	"manage:Location": {
		action: "manage",
		subject: "Location",
		category: "workforce",
		label: "Manage Locations",
		description: "Full access to location management",
	},

	// ---- Time Tracking ----
	"manage:TimeEntry": {
		action: "manage",
		subject: "TimeEntry",
		category: "time_tracking",
		label: "Manage Time Entries",
		description: "Full access to time entries for all employees",
	},
	"read:TimeEntry": {
		action: "read",
		subject: "TimeEntry",
		category: "time_tracking",
		label: "View Time Entries",
		description: "View time entries for other employees",
	},
	"manage:Absence": {
		action: "manage",
		subject: "Absence",
		category: "time_tracking",
		label: "Manage Absences",
		description: "Full access to absence management",
	},
	"manage:AbsenceAllowance": {
		action: "manage",
		subject: "AbsenceAllowance",
		category: "time_tracking",
		label: "Manage Absence Allowances",
		description: "Configure vacation and absence allowances",
	},
	"manage:Holiday": {
		action: "manage",
		subject: "Holiday",
		category: "time_tracking",
		label: "Manage Holidays",
		description: "Configure organization holidays",
	},
	"manage:Surcharge": {
		action: "manage",
		subject: "Surcharge",
		category: "time_tracking",
		label: "Manage Surcharges",
		description: "Configure time surcharge rules",
	},

	// ---- Approvals ----
	"approve:Approval": {
		action: "approve",
		subject: "Approval",
		category: "approvals",
		label: "Approve Requests",
		description: "Approve time correction and leave requests",
	},
	"reject:Approval": {
		action: "reject",
		subject: "Approval",
		category: "approvals",
		label: "Reject Requests",
		description: "Reject time correction and leave requests",
	},
	"approve:Absence": {
		action: "approve",
		subject: "Absence",
		category: "approvals",
		label: "Approve Absences",
		description: "Approve absence requests",
	},
	"reject:Absence": {
		action: "reject",
		subject: "Absence",
		category: "approvals",
		label: "Reject Absences",
		description: "Reject absence requests",
	},
	"manage:LeaveRequest": {
		action: "manage",
		subject: "LeaveRequest",
		category: "approvals",
		label: "Manage Leave Requests",
		description: "Full access to leave request management",
	},

	// ---- Reporting ----
	"read:Report": {
		action: "read",
		subject: "Report",
		category: "reporting",
		label: "View Reports",
		description: "Access reporting and analytics",
	},
	"generate:Report": {
		action: "generate",
		subject: "Report",
		category: "reporting",
		label: "Generate Reports",
		description: "Generate reports and analytics exports",
	},
	"read:AuditLog": {
		action: "read",
		subject: "AuditLog",
		category: "reporting",
		label: "View Audit Log",
		description: "Access the organization audit log",
	},
	"manage:Export": {
		action: "manage",
		subject: "Export",
		category: "reporting",
		label: "Manage Data Exports",
		description: "Create and manage data exports",
	},
	"manage:PayrollExport": {
		action: "manage",
		subject: "PayrollExport",
		category: "reporting",
		label: "Manage Payroll Exports",
		description: "Create and manage payroll exports",
	},

	// ---- Works Council ----
	"read:WorksCouncil": {
		action: "read",
		subject: "WorksCouncil",
		category: "works_council",
		label: "View Works Council Portal",
		description: "Read privacy-filtered works council dashboards and review logs",
	},
	"export:WorksCouncil": {
		action: "export",
		subject: "WorksCouncil",
		category: "works_council",
		label: "Export Works Council Review Packs",
		description: "Generate privacy-filtered works council review exports",
	},
	"configure:WorksCouncil": {
		action: "configure",
		subject: "WorksCouncil",
		category: "works_council",
		label: "Configure Works Council Mode",
		description: "Enable Works Council Mode and configure privacy settings",
	},

	// ---- Organization ----
	"read:Organization": {
		action: "read",
		subject: "Organization",
		category: "organization",
		label: "View Organization",
		description: "View organization information",
	},
	"manage:OrgSettings": {
		action: "manage",
		subject: "OrgSettings",
		category: "organization",
		label: "Manage Settings",
		description: "Full access to organization settings",
	},
	"manage:OrgMembers": {
		action: "manage",
		subject: "OrgMembers",
		category: "organization",
		label: "Manage Members",
		description: "Invite and manage organization members",
	},
	"manage:WorkPolicy": {
		action: "manage",
		subject: "WorkPolicy",
		category: "organization",
		label: "Manage Work Policies",
		description: "Configure work schedules and time policies",
	},
	"manage:VacationPolicy": {
		action: "manage",
		subject: "VacationPolicy",
		category: "organization",
		label: "Manage Vacation Policies",
		description: "Configure vacation and leave policies",
	},
	"manage:Compliance": {
		action: "manage",
		subject: "Compliance",
		category: "organization",
		label: "Manage Compliance",
		description: "Configure compliance settings and rules",
	},

	// ---- Projects ----
	"manage:Project": {
		action: "manage",
		subject: "Project",
		category: "projects",
		label: "Manage Projects",
		description: "Full access to project management",
	},
	"read:Project": {
		action: "read",
		subject: "Project",
		category: "projects",
		label: "View Projects",
		description: "View project details and assignments",
	},

	// ---- Scheduling ----
	"manage:Shift": {
		action: "manage",
		subject: "Shift",
		category: "scheduling",
		label: "Manage Shifts",
		description: "Full access to shift scheduling",
	},
	"read:Shift": {
		action: "read",
		subject: "Shift",
		category: "scheduling",
		label: "View Shifts",
		description: "View shift schedules",
	},
	"manage:Schedule": {
		action: "manage",
		subject: "Schedule",
		category: "scheduling",
		label: "Manage Schedules",
		description: "Full access to schedule management",
	},
	"read:Schedule": {
		action: "read",
		subject: "Schedule",
		category: "scheduling",
		label: "View Schedules",
		description: "View work schedules",
	},
	"manage:Calendar": {
		action: "manage",
		subject: "Calendar",
		category: "scheduling",
		label: "Manage Calendar",
		description: "Full access to calendar management",
	},
	"read:Calendar": {
		action: "read",
		subject: "Calendar",
		category: "scheduling",
		label: "View Calendar",
		description: "View calendar entries",
	},
};

export const PERMISSION_REGISTRY: Record<string, PermissionDefinition> = Object.fromEntries(
	Object.entries(PERMISSION_DEFINITIONS).map(([key, permission]) => [
		key,
		{
			...permission,
			labelKey:
				permission.labelKey ??
				`settings.roles.permissions.${permission.action}.${permission.subject}.label`,
			descriptionKey:
				permission.descriptionKey ??
				`settings.roles.permissions.${permission.action}.${permission.subject}.description`,
		},
	]),
);

// ============================================
// HELPERS
// ============================================

const CATEGORY_LABELS: Record<PermissionCategory, string> = {
	workforce: "Workforce",
	time_tracking: "Time Tracking",
	approvals: "Approvals",
	reporting: "Reporting & Exports",
	organization: "Organization",
	projects: "Projects",
	scheduling: "Scheduling",
	works_council: "Works Council",
};

const CATEGORY_LABEL_KEYS: Record<PermissionCategory, string> = {
	workforce: "settings.roles.permissionCategories.workforce",
	time_tracking: "settings.roles.permissionCategories.time_tracking",
	approvals: "settings.roles.permissionCategories.approvals",
	reporting: "settings.roles.permissionCategories.reporting",
	organization: "settings.roles.permissionCategories.organization",
	projects: "settings.roles.permissionCategories.projects",
	scheduling: "settings.roles.permissionCategories.scheduling",
	works_council: "settings.roles.permissionCategories.works_council",
};

/**
 * Get all permissions organized by category
 */
export function getPermissionsByCategory(): Record<PermissionCategory, PermissionDefinition[]> {
	const result = {} as Record<PermissionCategory, PermissionDefinition[]>;

	for (const perm of Object.values(PERMISSION_REGISTRY)) {
		if (!result[perm.category]) {
			result[perm.category] = [];
		}
		result[perm.category].push(perm);
	}

	return result;
}

/**
 * Get all permission categories with labels
 */
export function getPermissionCategories(): Array<{
	id: PermissionCategory;
	labelKey: string;
	label: string;
}> {
	return Object.entries(CATEGORY_LABELS).map(([id, label]) => ({
		id: id as PermissionCategory,
		labelKey: CATEGORY_LABEL_KEYS[id as PermissionCategory],
		label,
	}));
}

/**
 * Check if a given action:subject pair is a valid permission
 */
export function isValidPermission(action: string, subject: string): boolean {
	return `${action}:${subject}` in PERMISSION_REGISTRY;
}

/**
 * Get the permission key string for an action/subject pair
 */
export function getPermissionKey(action: string, subject: string): string {
	return `${action}:${subject}`;
}
