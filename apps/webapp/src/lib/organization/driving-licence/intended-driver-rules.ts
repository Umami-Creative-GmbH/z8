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

/**
 * One employee who stops being an intended driver through a change, with the class
 * authorizations that change ends (#1425, Organization ADR 0005).
 */
export type DrivingLicenceEnding = {
	employeeId: string;
	name: string;
	/** The current class authorizations that end, by class code. */
	classCodes: string[];
};

/**
 * What an assignment save would end, read under the organization lock. Pass `previewToken`
 * back with the save (also when nobody is affected): when the ending changed in between, or
 * the token is missing, the save is refused with `stale_preview`.
 */
export type DrivingLicenceEndingPreview = {
	employees: DrivingLicenceEnding[];
	previewToken: string;
};

/**
 * The warning before a team change (#1425): owners, admins and, while the feature is on,
 * holders of the planning permission see who loses which classes (`full`); any other team
 * manager only learns that some driving authorizations end (`generic`: no names, classes or
 * count). Pass `previewToken` back with the save; a save whose outcome no longer matches what
 * was shown is refused with `stale_preview`.
 */
export type DrivingLicenceTeamChangeImpact =
	| { detail: "full"; employees: DrivingLicenceEnding[]; previewToken: string }
	| { detail: "generic"; affected: boolean; previewToken: string };

/** The refusal of a save whose confirmed preview no longer matches its outcome. */
export const DRIVING_LICENCE_STALE_PREVIEW = "stale_preview";

/** Refusals the intended-driver actions return by code; anything else is generic. */
export const INTENDED_DRIVER_REFUSALS = [
	"forbidden",
	"not_enabled",
	"team_not_found",
	"employee_not_found",
	"assignment_not_found",
	"invalid_assignment",
	"stale_preview",
] as const;
export type IntendedDriverRefusal = (typeof INTENDED_DRIVER_REFUSALS)[number];
