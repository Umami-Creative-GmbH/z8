import type { EquipmentSetupRefusal } from "@/lib/organization/equipment/contracts";

export function equipmentRefusalMessage(
	reason: EquipmentSetupRefusal,
	t: (key: string, fallback: string) => string,
) {
	switch (reason) {
		case "invalid_input":
			return t(
				"settings.equipment.errors.invalid",
				"Check the entered values and try again.",
			);
		case "not_found":
			return t(
				"settings.equipment.errors.notFound",
				"This equipment record is no longer available.",
			);
		case "policy_required":
			return t(
				"settings.equipment.errors.policy",
				"Configure closed-record retention before registering or issuing equipment.",
			);
		case "archived":
			return t(
				"settings.equipment.errors.archived",
				"Archived equipment cannot be selected for new work.",
			);
		case "tracking_mode_fixed":
			return t(
				"settings.equipment.errors.modeFixed",
				"This type has been used. Create a new type to change its tracking mode.",
			);
		case "individual_required":
			return t(
				"settings.equipment.errors.individual",
				"Only individually tracked types can have item identities.",
			);
		case "identifier_taken":
			return t(
				"settings.equipment.errors.identifier",
				"This equipment identifier is already reserved, including archived and retired items.",
			);
		case "stale_revision":
			return t(
				"settings.equipment.errors.stale",
				"This record changed. Reload the setup before saving again.",
			);
		case "request_conflict":
			return t(
				"settings.equipment.errors.request",
				"This submission changed after it was saved. Reload the setup and try again.",
			);
	}
}
