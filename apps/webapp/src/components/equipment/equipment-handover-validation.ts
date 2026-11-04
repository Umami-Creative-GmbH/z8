import {
	comparePlainDates,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import { equipmentQuantitySchema } from "@/lib/organization/equipment/contracts";
import type { EquipmentTranslate } from "./equipment-copy";

export function actualDateError(
	value: string,
	today: string,
	t: EquipmentTranslate,
) {
	if (!value)
		return t(
			"settings.equipment.handover.dateRequired",
			"Enter the actual handover date.",
		);
	try {
		const date = parsePlainDate(value);
		if (comparePlainDates(date, parsePlainDate(today)) > 0)
			return t(
				"settings.equipment.handover.futureDate",
				"The actual handover date cannot be in the future in the organization’s timezone.",
			);
	} catch {
		return t(
			"settings.equipment.handover.dateInvalid",
			"Enter a valid calendar date.",
		);
	}
	return undefined;
}
export function quantityError(
	value: string,
	t: EquipmentTranslate,
	maximum?: number,
) {
	const quantity = Number(value);
	if (!equipmentQuantitySchema.safeParse(quantity).success)
		return t(
			"settings.equipment.handover.quantityInvalid",
			"Enter a positive whole quantity.",
		);
	if (maximum !== undefined && quantity > maximum)
		return t(
			"settings.equipment.handover.quantityExcess",
			"Quantity exceeds the remaining physical balance.",
		);
	return undefined;
}
