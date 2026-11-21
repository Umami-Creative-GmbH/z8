import type { ContractFieldSource } from "./types";

/**
 * Unwraps the explicit `'inherit'` sentinel (as well as `null` / `undefined`)
 * so downstream fallback chains treat inherited values uniformly as absent.
 */
export function unwrapInherit<T extends string>(
	value: T | "inherit" | null | undefined,
): Exclude<T, "inherit"> | null {
	if (value === null || value === undefined || value === "inherit") {
		return null;
	}
	return value as Exclude<T, "inherit">;
}

/**
 * Resolves a single operational field across the strict precedence chain:
 * Employee confirmed terms -> Primary Team Default -> Organization Default -> fallback.
 */
export function resolveOperationalField<T>(input: {
	employee: T | null | undefined;
	team: T | null | undefined;
	org: T | null | undefined;
	fallback: T;
}): { value: T; source: ContractFieldSource } {
	if (input.employee !== null && input.employee !== undefined) {
		return { value: input.employee, source: "employee_override" };
	}
	if (input.team !== null && input.team !== undefined) {
		return { value: input.team, source: "team_default" };
	}
	if (input.org !== null && input.org !== undefined) {
		return { value: input.org, source: "org_default" };
	}
	return { value: input.fallback, source: "default" };
}
