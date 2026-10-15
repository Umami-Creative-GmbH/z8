/**
 * The refusal of a personnel number another employee of the organization holds
 * (#881): its machine-readable code (`ValidationError.refusal`, so a form puts
 * the message on the personnel number field) and its message. Client-safe.
 */

import type { MessageTranslate } from "@/lib/i18n/message-translate";

/** `refusal` of a save whose personnel number is taken. */
export const PERSONNEL_NUMBER_TAKEN = "personnel_number_taken";

/**
 * Why the number can't be saved, naming the employee who holds it (`null` when
 * the holder can no longer be found, e.g. after a concurrent change).
 */
export function personnelNumberTakenMessage(
	t: MessageTranslate,
	holderName: string | null,
): string {
	if (holderName === null) {
		return t(
			"settings.employees.personnelNumber.takenByAnother",
			"Another employee already has this personnel number. Every employee, current or former, needs their own number.",
		);
	}
	return t(
		"settings.employees.personnelNumber.taken",
		"This personnel number belongs to {name}. Every employee, current or former, needs their own number.",
		{ name: holderName },
	);
}
