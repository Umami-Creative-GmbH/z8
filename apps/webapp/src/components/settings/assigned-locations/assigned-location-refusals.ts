import type { RefusalMessages } from "@/lib/organization-action/action-error-message";
import type { AssignedLocationErrorCode } from "@/lib/time-tracking/assigned-locations/errors";

/** Assigned locations' own texts for `actionErrorMessage`. */
export const ASSIGNED_LOCATION_REFUSALS = {
	admin_only: [
		"settings.assignedLocations.errors.adminOnly",
		"Only organization owners and admins can manage assigned locations.",
	],
	employee_not_found: ["settings.assignedLocations.errors.employeeNotFound", "Employee not found."],
	former_employee: [
		"settings.assignedLocations.errors.formerEmployee",
		"Former employees can't be assigned a location.",
	],
	location_not_found: ["settings.assignedLocations.errors.locationNotFound", "Location not found."],
	invalid_selection: [
		"settings.assignedLocations.errors.invalidSelection",
		"Choose from the list.",
	],
	failed: [
		"settings.assignedLocations.errors.failed",
		"Assigned locations could not be updated. Try again.",
	],
} satisfies RefusalMessages<AssignedLocationErrorCode>;
