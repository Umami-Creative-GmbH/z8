import { equipmentRefusalMessage } from "@/components/settings/equipment/equipment-feedback";
import type {
	EquipmentCondition,
	EquipmentRefusal,
} from "@/lib/organization/equipment/contracts";
export type EquipmentTranslate = (key: string, fallback: string) => string;
export function conditionLabel(
	condition: EquipmentCondition,
	t: EquipmentTranslate,
) {
	switch (condition) {
		case "good":
			return t("settings.equipment.condition.good", "Good");
		case "worn":
			return t("settings.equipment.condition.worn", "Worn");
		case "damaged":
			return t("settings.equipment.condition.damaged", "Damaged");
		case "unknown":
			return t("settings.equipment.condition.unknown", "Unknown");
	}
}
export function handoverRefusalMessage(
	reason: EquipmentRefusal,
	t: EquipmentTranslate,
) {
	switch (reason) {
		case "forbidden":
			return t(
				"settings.equipment.handover.forbidden",
				"You are not authorized to record equipment handovers.",
			);
		case "employee_not_current":
			return t(
				"settings.equipment.handover.former",
				"Only a current employee can receive a new issuance. Reload the employee list.",
			);
		case "item_unavailable":
			return t(
				"settings.equipment.handover.unavailable",
				"This item is held, archived or unavailable. Reload and select an available item.",
			);
		case "self_receipt":
			return t(
				"settings.equipment.handover.selfReceipt",
				"Another authorized person must confirm receipt of your equipment.",
			);
		case "already_received":
			return t(
				"settings.equipment.handover.alreadyReceived",
				"This assignment has already been received. Reload its history.",
			);
		case "future_date":
			return t(
				"settings.equipment.handover.futureDate",
				"The actual handover date cannot be in the future in the organization’s timezone.",
			);
		case "conflicting_history":
			return t(
				"settings.equipment.handover.chronology",
				"The dates conflict with the item’s handover history. Check the actual dates.",
			);
		case "stale_revision":
			return t(
				"settings.equipment.handover.stale",
				"This record changed. Reload equipment and review it before submitting again.",
			);
		case "request_conflict":
			return t(
				"settings.equipment.handover.requestConflict",
				"This submission was already saved with different values. Reload equipment before recording another handover.",
			);
		default:
			return equipmentRefusalMessage(reason, t);
	}
}
