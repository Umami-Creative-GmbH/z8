/**
 * CASL Enforcement Helpers
 *
 * Provides boundary enforcement functions for use in API routes
 * and server actions.
 */

import type { AppAbility } from "./ability";
import type { Action, Subject } from "./types";

// ============================================
// ERROR CLASS
// ============================================

/**
 * Authorization error thrown when access is denied
 */
export class ForbiddenError extends Error {
	public readonly action: Action;
	public readonly subject: Subject;
	public readonly subjectId?: string;

	constructor(action: Action, subject: Subject, subjectId?: string) {
		super(`Cannot ${action} ${subject}${subjectId ? ` (${subjectId})` : ""}`);
		this.name = "ForbiddenError";
		this.action = action;
		this.subject = subject;
		this.subjectId = subjectId;
	}
}

// ============================================
// ENFORCEMENT FUNCTIONS
// ============================================

/**
 * Assert that the ability allows an action.
 * Throws ForbiddenError if not allowed.
 *
 * @example
 * ```typescript
 * assertCan(ability, "update", "Team");
 * // Continues execution if allowed, throws ForbiddenError if not
 * ```
 */
export function assertCan(
	ability: AppAbility,
	action: Action,
	subject: Subject,
	subjectId?: string,
): void {
	if (ability.cannot(action, subject)) {
		throw new ForbiddenError(action, subject, subjectId);
	}
}

/**
 * Alias for assertCan - throws if action is not allowed
 */
export const throwIfCannot = assertCan;

/**
 * Check if action is allowed and return boolean.
 * Does not throw.
 *
 * @example
 * ```typescript
 * if (checkCan(ability, "delete", "Team")) {
 *   // Show delete button
 * }
 * ```
 */
export function checkCan(
	ability: AppAbility,
	action: Action,
	subject: Subject,
): boolean {
	return ability.can(action, subject);
}

/**
 * Check if action is denied.
 */
export function checkCannot(
	ability: AppAbility,
	action: Action,
	subject: Subject,
): boolean {
	return ability.cannot(action, subject);
}

// ============================================
// BATCH ENFORCEMENT
// ============================================

/**
 * Check multiple permissions at once, return object of results.
 * Useful for building permission flags to send to client.
 *
 * @example
 * ```typescript
 * const flags = checkMany(ability, {
 *   canManageTeams: ["manage", "Team"],
 *   canViewReports: ["read", "Report"],
 *   canApprove: ["approve", "Approval"],
 * });
 * // Result: { canManageTeams: true, canViewReports: true, canApprove: false }
 * ```
 */
export function checkMany<T extends Record<string, [Action, Subject]>>(
	ability: AppAbility,
	checks: T,
): { [K in keyof T]: boolean } {
	const result = {} as { [K in keyof T]: boolean };

	for (const [key, [action, subject]] of Object.entries(checks)) {
		result[key as keyof T] = ability.can(action, subject);
	}

	return result;
}

// ============================================
// HTTP RESPONSE HELPERS
// ============================================

/**
 * Convert ForbiddenError to HTTP-friendly format
 */
export function toHttpError(error: ForbiddenError): {
	status: 403;
	body: { error: string; code: "FORBIDDEN"; action: string; subject: string };
} {
	return {
		status: 403,
		body: {
			error: error.message,
			code: "FORBIDDEN",
			action: error.action,
			subject: error.subject,
		},
	};
}

/**
 * Check if an error is a ForbiddenError
 */
export function isForbiddenError(error: unknown): error is ForbiddenError {
	return error instanceof ForbiddenError;
}
