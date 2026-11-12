import type { VehicleRefusal } from "@/lib/organization/vehicles/vehicle-rules";
import type { RefusalMessages } from "@/lib/organization-action/action-error-message";

/** Why the server refused a vehicle change, for the org admin (`actionErrorMessage`). */
export const VEHICLE_REFUSALS = {
	invalid_name: ["settings.vehicles.refusals.invalidName", "Enter a name of up to 100 characters."],
	invalid_licence_plate: [
		"settings.vehicles.refusals.invalidLicencePlate",
		"Enter a licence plate of up to 20 characters.",
	],
	invalid_drivers: [
		"settings.vehicles.refusals.invalidDrivers",
		"Choose at most 500 assigned employees and teams.",
	],
	vehicle_not_found: [
		"settings.vehicles.refusals.vehicleNotFound",
		"This vehicle no longer exists. Reload the page.",
	],
	vehicle_archived: [
		"settings.vehicles.refusals.vehicleArchived",
		"Restore this vehicle before you edit it.",
	],
	licence_plate_taken: [
		"settings.vehicles.refusals.licencePlateTaken",
		"Another vehicle of your organization already has this licence plate.",
	],
	driver_not_found: [
		"settings.vehicles.refusals.driverNotFound",
		"An assigned employee or team no longer exists. Reload the page.",
	],
	former_driver: [
		"settings.vehicles.refusals.formerDriver",
		"Former employees can't be assigned as drivers. Choose employees on the current roster.",
	],
	vehicle_used: [
		"settings.vehicles.refusals.vehicleUsed",
		"This vehicle was recorded on work, so it can only be archived.",
	],
	invalid_change: [
		"settings.vehicles.refusals.invalidChange",
		"The change could not be saved. Reload the page and try again.",
	],
} satisfies RefusalMessages<VehicleRefusal>;
