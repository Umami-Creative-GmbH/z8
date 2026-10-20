/**
 * Intended-driver assignment values (#1423), shared by the server and the settings UI,
 * so this file has no server-only imports.
 */
export const INTENDED_DRIVER_REQUIREMENTS = ["required", "not_required"] as const;
/** Required makes the target intended drivers; Not required excludes it from a broader assignment. */
export type IntendedDriverRequirement = (typeof INTENDED_DRIVER_REQUIREMENTS)[number];

export type IntendedDriverAssignmentTarget =
	| { type: "organization" }
	| { type: "team"; teamId: string }
	| { type: "employee"; employeeId: string };

export type IntendedDriverAssignment = {
	id: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	value: IntendedDriverRequirement;
	createdAt: string;
	createdBy: string;
	updatedAt: string;
	updatedBy: string;
};

export type IntendedDriverAdminData = {
	/** Broadest first: organization, teams, employees. */
	assignments: IntendedDriverAssignment[];
	teams: { id: string; name: string }[];
	/** Employees an employee-level assignment can target: approved members with access. */
	employees: { id: string; name: string }[];
};

/** Refusals the intended-driver actions return by code; anything else is generic. */
export const INTENDED_DRIVER_REFUSALS = [
	"forbidden",
	"not_enabled",
	"team_not_found",
	"employee_not_found",
	"assignment_not_found",
	"invalid_assignment",
] as const;
export type IntendedDriverRefusal = (typeof INTENDED_DRIVER_REFUSALS)[number];
