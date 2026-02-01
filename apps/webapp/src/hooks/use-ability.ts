"use client";

import { useCallback, useMemo } from "react";
import { useOrganization } from "./use-organization";
import type { Action, Subject } from "@/lib/authorization/types";

/**
 * Permission flags that can be sent from the server.
 * These are simple booleans computed server-side based on CASL rules.
 */
export interface PermissionFlags {
	// Organization-level permissions
	canManageOrganization?: boolean;
	canManageTeams?: boolean;
	canManageEmployees?: boolean;
	canManagePermissions?: boolean;
	canManageLocations?: boolean;
	canManageProjects?: boolean;
	canManageCategories?: boolean;
	canManageWorkPolicies?: boolean;
	canManageVacationPolicies?: boolean;
	canManageCompliance?: boolean;
	canManageExports?: boolean;
	canManageAudit?: boolean;
	canManageBilling?: boolean;
	canManageWebhooks?: boolean;
	canManageApiKeys?: boolean;
	canManageIntegrations?: boolean;

	// Workforce permissions
	canApproveAbsences?: boolean;
	canApproveTimeEntries?: boolean;
	canViewReports?: boolean;
	canManageSchedules?: boolean;
	canManageCalendars?: boolean;

	// Self-service permissions (always true for authenticated users)
	canManageOwnTimeEntries?: boolean;
	canViewOwnData?: boolean;
}

export interface AbilityContext {
	/**
	 * Check if the current user can perform an action.
	 * This is a simplified check based on role, not full CASL conditions.
	 */
	can: (action: Action, subject: Subject) => boolean;

	/**
	 * Check if the current user cannot perform an action.
	 */
	cannot: (action: Action, subject: Subject) => boolean;

	/**
	 * The current user's employee role
	 */
	role: "admin" | "manager" | "employee" | null;

	/**
	 * Whether the user is an organization admin (employee.role === "admin")
	 */
	isAdmin: boolean;

	/**
	 * Whether the user is a manager (employee.role === "manager")
	 */
	isManager: boolean;

	/**
	 * Whether the user is at least a manager
	 */
	isManagerOrAbove: boolean;

	/**
	 * Permission flags loaded from the server (if available)
	 */
	permissions: PermissionFlags;

	/**
	 * Whether the ability context is still loading
	 */
	isLoading: boolean;
}

// Mapping of subjects to required role level
const ADMIN_SUBJECTS: Subject[] = [
	"Organization",
	"Team",
	"Location",
	"Project",
	"OrgSettings",
	"OrgMembers",
	"WorkPolicy",
	"VacationPolicy",
	"Compliance",
	"Export",
	"PayrollExport",
	"ScheduledExport",
	"AuditLog",
	"OrgWebhooks",
	"OrgBilling",
	"OrgIntegrations",
	"DemoData",
];

const MANAGER_SUBJECTS: Subject[] = [
	"Absence",
	"AbsenceAllowance",
	"TimeEntry",
	"Report",
	"Schedule",
	"Calendar",
];

const SELF_SERVICE_SUBJECTS: Subject[] = [
	"TimeEntry", // own entries
	"Absence", // own absences
	"Employee", // own profile
];

// Hoisted empty object to prevent new reference on each render
const EMPTY_PERMISSIONS: PermissionFlags = {};

// Hoisted flag map for permission lookups
const PERMISSION_FLAG_MAP: Partial<Record<Subject, keyof PermissionFlags>> = {
	Team: "canManageTeams",
	Employee: "canManageEmployees",
	OrgMembers: "canManageEmployees",
	OrgSettings: "canManageOrganization",
	Location: "canManageLocations",
	Project: "canManageProjects",
	WorkPolicy: "canManageWorkPolicies",
	VacationPolicy: "canManageVacationPolicies",
	Compliance: "canManageCompliance",
	Export: "canManageExports",
	AuditLog: "canManageAudit",
	OrgBilling: "canManageBilling",
	OrgWebhooks: "canManageWebhooks",
	OrgIntegrations: "canManageIntegrations",
	Absence: "canApproveAbsences",
	TimeEntry: "canApproveTimeEntries",
	Report: "canViewReports",
	Schedule: "canManageSchedules",
	Calendar: "canManageCalendars",
};

/**
 * Hook to check user abilities/permissions on the client side.
 *
 * This hook provides a simplified permission checking interface based on
 * the user's role. For fine-grained authorization with conditions (e.g.,
 * team-specific permissions), use server-side CASL checks.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { can, isAdmin } = useAbility();
 *
 *   if (!can("manage", "Team")) {
 *     return <NoAccess />;
 *   }
 *
 *   return <TeamManager />;
 * }
 * ```
 */
export function useAbility(permissions: PermissionFlags = EMPTY_PERMISSIONS): AbilityContext {
	const { role, isAdmin, isManager, isManagerOrAbove, isLoading } = useOrganization();

	// Build a simple can() function based on role
	const can = useCallback(
		(action: Action, subject: Subject): boolean => {
			// If no role, user has no permissions
			if (!role) return false;

			// Admins can do everything at org level
			if (isAdmin) {
				// Special case: platform-level subjects require platform admin
				if (subject === "Platform" || subject === "User") {
					return false; // Can't check platform admin from client
				}
				return true;
			}

			// Managers can manage their teams and workforce
			if (isManager || isManagerOrAbove) {
				// Check manager subjects
				if (MANAGER_SUBJECTS.includes(subject)) {
					return ["read", "create", "update", "approve"].includes(action);
				}

				// Managers can read most things
				if (action === "read") {
					return !["OrgBilling", "OrgWebhooks", "Platform", "User"].includes(subject);
				}
			}

			// All authenticated employees can manage their own stuff
			if (SELF_SERVICE_SUBJECTS.includes(subject)) {
				// For self-service, we only allow certain actions
				if (["read", "create", "update"].includes(action)) {
					return true;
				}
			}

			// Check specific permission flags if provided
			const flag = PERMISSION_FLAG_MAP[subject];
			if (flag && permissions[flag] === true) {
				return true;
			}

			return false;
		},
		[role, isAdmin, isManager, isManagerOrAbove, permissions],
	);

	const cannot = useCallback(
		(action: Action, subject: Subject): boolean => {
			return !can(action, subject);
		},
		[can],
	);

	return useMemo(
		() => ({
			can,
			cannot,
			role,
			isAdmin,
			isManager,
			isManagerOrAbove,
			permissions,
			isLoading,
		}),
		[can, cannot, role, isAdmin, isManager, isManagerOrAbove, permissions, isLoading],
	);
}

/**
 * Check if the user can access admin settings.
 * Convenience wrapper for common check.
 */
export function useCanAccessSettings(): { canAccess: boolean; isLoading: boolean } {
	const { isAdmin, isLoading } = useAbility();
	return { canAccess: isAdmin, isLoading };
}

/**
 * Check if the user can manage a specific subject.
 * Convenience wrapper for common check.
 */
export function useCanManage(subject: Subject): { canManage: boolean; isLoading: boolean } {
	const { can, isLoading } = useAbility();
	return { canManage: can("manage", subject), isLoading };
}

/**
 * Check if the user can approve requests.
 * Convenience wrapper for manager+ check.
 */
export function useCanApprove(): { canApprove: boolean; isLoading: boolean } {
	const { isManagerOrAbove, isLoading } = useAbility();
	return { canApprove: isManagerOrAbove, isLoading };
}
