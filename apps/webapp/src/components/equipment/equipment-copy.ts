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
		case "transfer_conflict":
			return t(
				"settings.equipment.correction.transferConflict",
				"This amendment conflicts with the linked transfer. Correct both handovers together when changing the transferred quantity.",
			);
		case "recovery_conflict":
			return t(
				"settings.equipment.correction.recoveryConflict",
				"This amendment would reduce or reclassify quantities already physically received under this decision. Review the linked recovery history first.",
			);
		case "readiness_conflict":
			return t(
				"settings.equipment.correction.readinessConflict",
				"This condition amendment conflicts with a later clearance or issuance. Review readiness and the later history first.",
			);
		case "self_exception":
			return t(
				"settings.equipment.correction.independentDecision",
				"Another owner or admin must confirm changes that reduce or amend your own return obligation.",
			);
		case "return_not_required":
			return t(
				"settings.equipment.exception.notRequired",
				"Only outstanding required returns can be closed as lost or waived.",
			);
		case "waiver_required":
			return t(
				"settings.equipment.correction.waiverRequired",
				"Use the owner/admin waiver action to permit keeping required equipment. Amendments cannot replace that decision.",
			);
		case "item_in_custody":
			return t(
				"settings.equipment.readiness.inCustody",
				"Receive this item physically before clearing it. Clearance cannot release employee custody.",
			);
		case "item_retired":
			return t(
				"settings.equipment.readiness.isRetired",
				"This item is retired. Its identifier stays reserved and it cannot be cleared for issue.",
			);
		case "readiness_unchanged":
			return t(
				"settings.equipment.readiness.unchanged",
				"This availability state is already recorded. Reload equipment to review its history.",
			);
		case "quantity_required":
			return t(
				"settings.equipment.handover.quantityRequired",
				"Select a quantity-tracked type for this handover.",
			);
		case "excess_quantity":
			return t(
				"settings.equipment.exception.quantityExcess",
				"Quantity exceeds the remaining balance for this action.",
			);
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
		case "history_removed":
			return t(
				"settings.equipment.retention.removedRetry",
				"This request belongs to personal history already removed under retention. Reload equipment.",
			);
		case "hold_unchanged":
			return t(
				"settings.equipment.retention.unchanged",
				"This hold state is already recorded. Reload equipment before making another change.",
			);
		default:
			return equipmentRefusalMessage(reason, t);
	}
}
