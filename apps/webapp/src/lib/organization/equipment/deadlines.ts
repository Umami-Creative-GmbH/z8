import { Temporal } from "temporal-polyfill";
import type { Instant } from "@/lib/datetime/temporal-core";

/** Use the frozen departure zone, including across DST and later organization-zone changes. */
export function equipmentDepartureDeadline(
	cutoff: Instant,
	timezone: string,
	mode: "scheduled" | "immediate",
) {
	const day = cutoff.toZonedDateTimeISO(timezone).toPlainDate();
	return (mode === "scheduled" ? day.subtract({ days: 1 }) : day).toString();
}
export function effectiveEquipmentDeadline(
	explicit: string | null,
	derived: string | null,
) {
	if (!explicit) return derived;
	if (!derived) return explicit;
	return Temporal.PlainDate.compare(explicit, derived) <= 0
		? explicit
		: derived;
}

/** Corrected assignment projections already include effective receipts and exception overlap. */
export function outstandingEquipmentQuantity(assignment: {
	returnRequired: boolean;
	quantity: number;
	receivedQuantity: number;
	lostQuantity: number;
	waivedQuantity: number;
	exceptionReceivedQuantity: number;
}) {
	return assignment.returnRequired
		? assignment.quantity -
				assignment.receivedQuantity -
				assignment.lostQuantity -
				assignment.waivedQuantity +
				assignment.exceptionReceivedQuantity
		: 0;
}
