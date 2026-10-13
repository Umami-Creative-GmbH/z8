/**
 * Vehicle use enablement rules without I/O (#1119, spec #807; Time Tracking
 * glossary "Driving", ADR 0009): whether an employee is asked for vehicle use,
 * expected to record it, or neither. Shared by the server and the settings UI,
 * so this file has no server-only imports.
 */

/** What an assignment, or the resolution for one employee, says about vehicle use. */
export const VEHICLE_USE_MODES = ["off", "asked", "expected"] as const;
export type VehicleUseMode = (typeof VEHICLE_USE_MODES)[number];

export function isVehicleUseMode(value: unknown): value is VehicleUseMode {
	return typeof value === "string" && (VEHICLE_USE_MODES as readonly string[]).includes(value);
}

export type VehicleUseAssignmentRule =
	| { assignmentType: "organization"; mode: VehicleUseMode }
	| { assignmentType: "team"; teamId: string; mode: VehicleUseMode }
	| { assignmentType: "employee"; employeeId: string; mode: VehicleUseMode };

/**
 * The vehicle use mode for an employee. With the organization switch off it is
 * off for everyone. Otherwise the most specific assignment decides, like the
 * other assignment-based settings: the employee's own over their primary team's
 * over the organization's. Mode "off" excludes a team or employee from a broader
 * assignment. Without any matching assignment it is off.
 */
export function vehicleUseModeFor(
	subject: { employeeId: string; teamId: string | null },
	configuration: { enabled: boolean; assignments: readonly VehicleUseAssignmentRule[] },
): VehicleUseMode {
	if (!configuration.enabled) return "off";
	const { assignments } = configuration;
	const own = assignments.find(
		(rule) => rule.assignmentType === "employee" && rule.employeeId === subject.employeeId,
	);
	if (own) return own.mode;
	const team = subject.teamId
		? assignments.find((rule) => rule.assignmentType === "team" && rule.teamId === subject.teamId)
		: undefined;
	if (team) return team.mode;
	return assignments.find((rule) => rule.assignmentType === "organization")?.mode ?? "off";
}
