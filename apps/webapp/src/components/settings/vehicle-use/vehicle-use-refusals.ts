import type { RefusalMessages } from "@/lib/organization-action/action-error-message";
import type { VehicleUseErrorCode } from "@/lib/time-tracking/vehicle-use/errors";

/** Vehicle use enablement's own texts for `actionErrorMessage`. */
export const VEHICLE_USE_REFUSALS = {
	admin_only: [
		"settings.vehicleUse.error.adminOnly",
		"Only organization owners and admins can manage vehicle use.",
	],
	team_not_found: ["settings.vehicleUse.error.teamNotFound", "That team no longer exists."],
	employee_not_found: [
		"settings.vehicleUse.error.employeeNotFound",
		"That employee no longer exists.",
	],
	former_employee: [
		"settings.vehicleUse.error.formerEmployee",
		"Former employees can't get a new assignment. Choose someone on the current roster.",
	],
	assignment_not_found: [
		"settings.vehicleUse.error.assignmentNotFound",
		"That assignment no longer exists. Reload the page.",
	],
	invalid_target: [
		"settings.vehicleUse.error.invalidTarget",
		"Choose who the assignment applies to.",
	],
	invalid_selection: [
		"settings.vehicleUse.error.invalidTarget",
		"Choose who the assignment applies to.",
	],
	invalid_mode: ["settings.vehicleUse.error.invalidMode", "Choose a mode for the assignment."],
	failed: ["settings.vehicleUse.error.failed", "Something went wrong. Try again."],
} satisfies RefusalMessages<VehicleUseErrorCode>;
