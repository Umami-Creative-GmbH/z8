import type { EquipmentCondition } from "@/lib/organization/equipment/contracts";
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
