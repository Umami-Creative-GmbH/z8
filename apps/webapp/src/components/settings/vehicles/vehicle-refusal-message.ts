import type { VehicleRefusal } from "@/lib/organization/vehicles/vehicle-rules";

type Translate = (key: string, fallback: string) => string;

/** Why the server refused a vehicle change, for the org admin. */
export function vehicleRefusalMessage(t: Translate, reason: VehicleRefusal): string {
	switch (reason) {
		case "invalid_name":
			return t("settings.vehicles.refusals.invalidName", "Enter a name of up to 100 characters.");
		case "invalid_licence_plate":
			return t(
				"settings.vehicles.refusals.invalidLicencePlate",
				"Enter a licence plate of up to 20 characters.",
			);
		case "invalid_drivers":
			return t(
				"settings.vehicles.refusals.invalidDrivers",
				"Choose at most 500 assigned employees and teams.",
			);
		case "vehicle_not_found":
			return t(
				"settings.vehicles.refusals.vehicleNotFound",
				"This vehicle no longer exists. Reload the page.",
			);
		case "vehicle_archived":
			return t(
				"settings.vehicles.refusals.vehicleArchived",
				"Restore this vehicle before you edit it.",
			);
		case "licence_plate_taken":
			return t(
				"settings.vehicles.refusals.licencePlateTaken",
				"Another vehicle of your organization already has this licence plate.",
			);
		case "driver_not_found":
			return t(
				"settings.vehicles.refusals.driverNotFound",
				"An assigned employee or team no longer exists. Reload the page.",
			);
		case "former_driver":
			return t(
				"settings.vehicles.refusals.formerDriver",
				"Former employees can't be assigned as drivers. Choose employees on the current roster.",
			);
		case "vehicle_used":
			return t(
				"settings.vehicles.refusals.vehicleUsed",
				"This vehicle was recorded on work, so it can only be archived.",
			);
		case "invalid_change":
			return t(
				"settings.vehicles.refusals.invalidChange",
				"The change could not be saved. Reload the page and try again.",
			);
	}
}
