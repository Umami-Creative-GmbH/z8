import type {
	EquipmentRefusal,
	EquipmentSetupRefusal,
} from "@/lib/organization/equipment/contracts";
import type { RefusalMessages } from "@/lib/organization-action/action-error-message";

/** Why equipment setup refused a change (`actionErrorMessage` with `{ refusal: reason }`). */
export const EQUIPMENT_SETUP_REFUSALS = {
	invalid_input: ["settings.equipment.errors.invalid", "Check the entered values and try again."],
	not_found: [
		"settings.equipment.errors.notFound",
		"This equipment record is no longer available.",
	],
	policy_required: [
		"settings.equipment.errors.policy",
		"Configure closed-record retention before registering or issuing equipment.",
	],
	archived: [
		"settings.equipment.errors.archived",
		"Archived equipment cannot be selected for new work.",
	],
	tracking_mode_fixed: [
		"settings.equipment.errors.modeFixed",
		"This type has been used. Create a new type to change its tracking mode.",
	],
	individual_required: [
		"settings.equipment.errors.individual",
		"Only individually tracked types can have item identities.",
	],
	identifier_taken: [
		"settings.equipment.errors.identifier",
		"This equipment identifier is already reserved, including archived and retired items.",
	],
	stale_revision: [
		"settings.equipment.errors.stale",
		"This record changed. Reload the setup before saving again.",
	],
	request_conflict: [
		"settings.equipment.errors.request",
		"This submission changed after it was saved. Reload the setup and try again.",
	],
} satisfies RefusalMessages<EquipmentSetupRefusal>;

/**
 * Why a handover, correction, readiness or retention change was refused. Its
 * own `stale_revision` and `request_conflict` texts replace the setup ones.
 */
export const EQUIPMENT_REFUSALS = {
	...EQUIPMENT_SETUP_REFUSALS,
	transfer_conflict: [
		"settings.equipment.correction.transferConflict",
		"This amendment conflicts with the linked transfer. Correct both handovers together when changing the transferred quantity.",
	],
	recovery_conflict: [
		"settings.equipment.correction.recoveryConflict",
		"This amendment would reduce or reclassify quantities already physically received under this decision. Review the linked recovery history first.",
	],
	readiness_conflict: [
		"settings.equipment.correction.readinessConflict",
		"This condition amendment conflicts with a later clearance or issuance. Review readiness and the later history first.",
	],
	self_exception: [
		"settings.equipment.correction.independentDecision",
		"Another owner or admin must confirm changes that reduce or amend your own return obligation.",
	],
	return_not_required: [
		"settings.equipment.exception.notRequired",
		"Only outstanding required returns can be closed as lost or waived.",
	],
	waiver_required: [
		"settings.equipment.correction.waiverRequired",
		"Use the owner/admin waiver action to permit keeping required equipment. Amendments cannot replace that decision.",
	],
	item_in_custody: [
		"settings.equipment.readiness.inCustody",
		"Receive this item physically before clearing it. Clearance cannot release employee custody.",
	],
	item_retired: [
		"settings.equipment.readiness.isRetired",
		"This item is retired. Its identifier stays reserved and it cannot be cleared for issue.",
	],
	readiness_unchanged: [
		"settings.equipment.readiness.unchanged",
		"This availability state is already recorded. Reload equipment to review its history.",
	],
	quantity_required: [
		"settings.equipment.handover.quantityRequired",
		"Select a quantity-tracked type for this handover.",
	],
	excess_quantity: [
		"settings.equipment.exception.quantityExcess",
		"Quantity exceeds the remaining balance for this action.",
	],
	forbidden: [
		"settings.equipment.handover.forbidden",
		"You are not authorized to record equipment handovers.",
	],
	employee_not_current: [
		"settings.equipment.handover.former",
		"Only a current employee can receive a new issuance. Reload the employee list.",
	],
	item_unavailable: [
		"settings.equipment.handover.unavailable",
		"This item is held, archived or unavailable. Reload and select an available item.",
	],
	self_receipt: [
		"settings.equipment.handover.selfReceipt",
		"Another authorized person must confirm receipt of your equipment.",
	],
	already_received: [
		"settings.equipment.handover.alreadyReceived",
		"This assignment has already been received. Reload its history.",
	],
	future_date: [
		"settings.equipment.handover.futureDate",
		"The actual handover date cannot be in the future in the organization’s timezone.",
	],
	conflicting_history: [
		"settings.equipment.handover.chronology",
		"The dates conflict with the item’s handover history. Check the actual dates.",
	],
	stale_revision: [
		"settings.equipment.handover.stale",
		"This record changed. Reload equipment and review it before submitting again.",
	],
	request_conflict: [
		"settings.equipment.handover.requestConflict",
		"This submission was already saved with different values. Reload equipment before recording another handover.",
	],
	history_removed: [
		"settings.equipment.retention.removedRetry",
		"This request belongs to personal history already removed under retention. Reload equipment.",
	],
	hold_unchanged: [
		"settings.equipment.retention.unchanged",
		"This hold state is already recorded. Reload equipment before making another change.",
	],
} satisfies RefusalMessages<EquipmentRefusal>;
