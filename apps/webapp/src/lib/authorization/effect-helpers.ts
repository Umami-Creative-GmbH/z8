/**
 * Effect Authorization Helpers
 *
 * Common Effect-based authorization utilities that wrap CASL checks
 * for use in server actions and Effect-based services.
 *
 * These helpers provide a consistent way to enforce authorization
 * in Effect pipelines without repeating boilerplate.
 */

import { Effect } from "effect";
import { AuthorizationError } from "@/lib/effect/errors";
import { defineAbilityFor, type AppAbility } from "./ability";
import type { Action, Subject, PrincipalContext } from "./types";

// ============================================
// CORE EFFECT HELPERS
// ============================================

/**
 * Check if ability allows an action, returning Effect<boolean>
 */
export function checkAbility(
	ability: AppAbility,
	action: Action,
	subject: Subject,
): Effect.Effect<boolean, never> {
	return Effect.succeed(ability.can(action, subject));
}

/**
 * Require that ability allows an action, or fail with AuthorizationError
 */
export function requireAbility(
	ability: AppAbility,
	action: Action,
	subject: Subject,
	context?: { userId?: string; resourceId?: string },
): Effect.Effect<void, AuthorizationError> {
	if (ability.can(action, subject)) {
		return Effect.succeed(undefined);
	}
	return Effect.fail(
		new AuthorizationError({
			message: `Cannot ${action} ${subject}`,
			userId: context?.userId,
			resource: subject,
			action,
		}),
	);
}

/**
 * Build ability from principal and check action in one step
 */
export function requirePrincipalCan(
	principal: PrincipalContext,
	action: Action,
	subject: Subject,
): Effect.Effect<AppAbility, AuthorizationError> {
	const ability = defineAbilityFor(principal);
	if (ability.can(action, subject)) {
		return Effect.succeed(ability);
	}
	return Effect.fail(
		new AuthorizationError({
			message: `Cannot ${action} ${subject}`,
			userId: principal.userId,
			resource: subject,
			action,
		}),
	);
}

// ============================================
// ROLE-BASED HELPERS
// ============================================

/**
 * Require organization admin or owner role
 * Used in settings pages that need org-level admin access
 */
export function requireOrgAdmin(
	ability: AppAbility,
	userId?: string,
): Effect.Effect<void, AuthorizationError> {
	// Check if user can manage OrgSettings (admin or owner)
	if (ability.can("manage", "OrgSettings")) {
		return Effect.succeed(undefined);
	}
	return Effect.fail(
		new AuthorizationError({
			message: "Organization admin access required",
			userId,
			resource: "OrgSettings",
			action: "manage",
		}),
	);
}

/**
 * Require organization owner role (for billing, etc.)
 */
export function requireOrgOwner(
	ability: AppAbility,
	userId?: string,
): Effect.Effect<void, AuthorizationError> {
	// Only owners can manage billing
	if (ability.can("manage", "OrgBilling")) {
		return Effect.succeed(undefined);
	}
	return Effect.fail(
		new AuthorizationError({
			message: "Organization owner access required",
			userId,
			resource: "OrgBilling",
			action: "manage",
		}),
	);
}

/**
 * Require employee admin role (workforce management)
 */
export function requireEmployeeAdmin(
	ability: AppAbility,
	userId?: string,
): Effect.Effect<void, AuthorizationError> {
	// Employee admins can manage all workforce resources
	if (ability.can("manage", "Employee")) {
		return Effect.succeed(undefined);
	}
	return Effect.fail(
		new AuthorizationError({
			message: "Employee admin access required",
			userId,
			resource: "Employee",
			action: "manage",
		}),
	);
}

/**
 * Require manager or admin role
 */
export function requireManagerOrAbove(
	ability: AppAbility,
	userId?: string,
): Effect.Effect<void, AuthorizationError> {
	// Managers can read reports
	if (ability.can("read", "Report")) {
		return Effect.succeed(undefined);
	}
	return Effect.fail(
		new AuthorizationError({
			message: "Manager or admin access required",
			userId,
			resource: "Report",
			action: "read",
		}),
	);
}

// ============================================
// SUBJECT-SPECIFIC HELPERS
// ============================================

/**
 * Require ability to manage locations
 */
export function requireLocationAdmin(
	ability: AppAbility,
	userId?: string,
): Effect.Effect<void, AuthorizationError> {
	if (ability.can("manage", "Location")) {
		return Effect.succeed(undefined);
	}
	return Effect.fail(
		new AuthorizationError({
			message: "Only admins can manage locations",
			userId,
			resource: "Location",
			action: "manage",
		}),
	);
}

/**
 * Require ability to manage projects
 */
export function requireProjectAdmin(
	ability: AppAbility,
	userId?: string,
): Effect.Effect<void, AuthorizationError> {
	if (ability.can("manage", "Project")) {
		return Effect.succeed(undefined);
	}
	return Effect.fail(
		new AuthorizationError({
			message: "Only admins can manage projects",
			userId,
			resource: "Project",
			action: "manage",
		}),
	);
}

/**
 * Require ability to manage work policies
 */
export function requireWorkPolicyAdmin(
	ability: AppAbility,
	userId?: string,
): Effect.Effect<void, AuthorizationError> {
	if (ability.can("manage", "WorkPolicy")) {
		return Effect.succeed(undefined);
	}
	return Effect.fail(
		new AuthorizationError({
			message: "Only organization admins can manage work policies",
			userId,
			resource: "WorkPolicy",
			action: "manage",
		}),
	);
}

/**
 * Require ability to manage vacation policies
 */
export function requireVacationPolicyAdmin(
	ability: AppAbility,
	userId?: string,
): Effect.Effect<void, AuthorizationError> {
	if (ability.can("manage", "VacationPolicy")) {
		return Effect.succeed(undefined);
	}
	return Effect.fail(
		new AuthorizationError({
			message: "Only organization admins can manage vacation policies",
			userId,
			resource: "VacationPolicy",
			action: "manage",
		}),
	);
}

/**
 * Require ability to manage exports
 */
export function requireExportAdmin(
	ability: AppAbility,
	userId?: string,
): Effect.Effect<void, AuthorizationError> {
	if (ability.can("manage", "Export")) {
		return Effect.succeed(undefined);
	}
	return Effect.fail(
		new AuthorizationError({
			message: "Only organization admins can manage exports",
			userId,
			resource: "Export",
			action: "manage",
		}),
	);
}

/**
 * Require ability to manage schedules
 */
export function requireScheduleAdmin(
	ability: AppAbility,
	userId?: string,
): Effect.Effect<void, AuthorizationError> {
	if (ability.can("manage", "Schedule")) {
		return Effect.succeed(undefined);
	}
	return Effect.fail(
		new AuthorizationError({
			message: "Only admins can manage schedules",
			userId,
			resource: "Schedule",
			action: "manage",
		}),
	);
}

/**
 * Require ability to approve absences
 */
export function requireAbsenceApprover(
	ability: AppAbility,
	userId?: string,
): Effect.Effect<void, AuthorizationError> {
	if (ability.can("approve", "Absence")) {
		return Effect.succeed(undefined);
	}
	return Effect.fail(
		new AuthorizationError({
			message: "Only managers and admins can approve absences",
			userId,
			resource: "Absence",
			action: "approve",
		}),
	);
}

/**
 * Require ability to generate reports
 */
export function requireReportGenerator(
	ability: AppAbility,
	userId?: string,
): Effect.Effect<void, AuthorizationError> {
	if (ability.can("generate", "Report")) {
		return Effect.succeed(undefined);
	}
	return Effect.fail(
		new AuthorizationError({
			message: "Only managers and admins can generate reports",
			userId,
			resource: "Report",
			action: "generate",
		}),
	);
}

// ============================================
// EFFECT PIPELINE HELPERS
// ============================================

/**
 * Create an Effect.flatMap guard that checks authorization
 * Use this in Effect pipelines to enforce authorization
 *
 * @example
 * ```typescript
 * const program = pipe(
 *   getEmployee(employeeId),
 *   Effect.flatMap(withAuthorization(ability, "manage", "Location")),
 *   Effect.flatMap(emp => doSomething(emp))
 * );
 * ```
 */
export function withAuthorization<T>(
	ability: AppAbility,
	action: Action,
	subject: Subject,
	userId?: string,
): (value: T) => Effect.Effect<T, AuthorizationError> {
	return (value: T) => {
		if (ability.can(action, subject)) {
			return Effect.succeed(value);
		}
		return Effect.fail(
			new AuthorizationError({
				message: `Cannot ${action} ${subject}`,
				userId,
				resource: subject,
				action,
			}),
		);
	};
}

/**
 * Wrap an Effect with authorization check
 *
 * @example
 * ```typescript
 * const program = guardWith(
 *   ability,
 *   "manage",
 *   "Location",
 *   doSomethingEffect()
 * );
 * ```
 */
export function guardWith<T, E>(
	ability: AppAbility,
	action: Action,
	subject: Subject,
	effect: Effect.Effect<T, E>,
	userId?: string,
): Effect.Effect<T, E | AuthorizationError> {
	if (ability.can(action, subject)) {
		return effect;
	}
	return Effect.fail(
		new AuthorizationError({
			message: `Cannot ${action} ${subject}`,
			userId,
			resource: subject,
			action,
		}),
	);
}

// ============================================
// BATCH PERMISSION CHECKS
// ============================================

/**
 * Check multiple permissions and return a flags object
 * Useful for building permission flags to send to client
 *
 * @example
 * ```typescript
 * const flags = buildPermissionFlags(ability, {
 *   canManageTeams: ["manage", "Team"],
 *   canManageLocations: ["manage", "Location"],
 *   canApprove: ["approve", "Approval"],
 * });
 * // { canManageTeams: true, canManageLocations: true, canApprove: false }
 * ```
 */
export function buildPermissionFlags<T extends Record<string, [Action, Subject]>>(
	ability: AppAbility,
	checks: T,
): { [K in keyof T]: boolean } {
	const result = {} as { [K in keyof T]: boolean };
	for (const [key, [action, subject]] of Object.entries(checks)) {
		result[key as keyof T] = ability.can(action, subject);
	}
	return result;
}
