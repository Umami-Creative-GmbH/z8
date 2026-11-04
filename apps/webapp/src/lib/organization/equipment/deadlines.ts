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
export function effectiveEquipmentDeadline(explicit: string | null, derived: string | null) {
	if (!explicit) return derived;
	if (!derived) return explicit;
	return Temporal.PlainDate.compare(explicit, derived) <= 0 ? explicit : derived;
}
