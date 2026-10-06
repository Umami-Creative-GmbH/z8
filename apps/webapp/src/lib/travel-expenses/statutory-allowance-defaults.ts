import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { MileageVehicle } from "./mileage";

/**
 * Verified statutory default rates an organization can adopt as a policy
 * version (#606). Nothing here applies on its own: a default only takes
 * effect when an administrator adopts it, and only from a date the cited
 * source was verified for. Every entry records its official source, edition
 * and the day it was checked; never add a rate that was not verified against
 * the official text.
 */

export interface StatutoryMileageDefault {
	key: string;
	kind: "mileage";
	/** Country whose rules these are. */
	country: "DE";
	currency: string;
	ratesPerKm: Record<MileageVehicle, string>;
	/**
	 * Earliest day the default may be adopted from: the start of the verified
	 * edition. Earlier days need an organization version with its own source.
	 */
	validFrom: string;
	/** Official citation, stored as the version's source reference. */
	reference: string;
	/** Verified edition, stored as the version's source version. */
	version: string;
	/** Official pages the rates were checked against. */
	sourceUrls: readonly string[];
	/** When the rates were checked against `sourceUrls`. */
	verifiedOn: string;
}

/**
 * German flat mileage rates for business travel in the employee's own vehicle
 * ("pauschale Kilometersätze"), the maximum an employer can reimburse tax-free:
 * § 9 Abs. 1 Satz 3 Nr. 4a Satz 2 EStG allows the highest
 * "Wegstreckenentschädigung" of the Bundesreisekostengesetz per vehicle used,
 * i.e. § 5 Abs. 2 BRKG 30 cent per km for a car ("Kraftwagen") and § 5 Abs. 1
 * BRKG 20 cent per km for any other motorized vehicle. The BMF letter of
 * 25 November 2020 (BStBl I S. 1228), Rz. 37, states both amounts: "Benutzung
 * eines Kraftwagens, z. B. PKW 0,30 €, für jedes andere motorbetriebene
 * Fahrzeug 0,20 €". Verified on 2026-10-06 in the official LStH 2026 (Anhang
 * 25 III, which reproduces that letter; H 9.5 "Pauschale Kilometersätze"
 * refers to it) and in the BRKG text. Not covered: a vehicle the employer
 * provides (no tax-free flat rate, R 9.5 Abs. 2 Satz 3 LStR) and regular public
 * transport, which are reimbursed as receipts.
 */
export const GERMAN_MILEAGE_DEFAULT: StatutoryMileageDefault = {
	key: "de-mileage-estg-9-1-4a",
	kind: "mileage",
	country: "DE",
	currency: "EUR",
	ratesPerKm: { car: "0.3000", other_motor_vehicle: "0.2000" },
	validFrom: "2026-01-01",
	reference:
		"§ 9 Abs. 1 Satz 3 Nr. 4a Satz 2 EStG with § 5 Abs. 1 and 2 BRKG; BMF letter of 25.11.2020 (BStBl I S. 1228), Rz. 37",
	version: "LStH 2026, Anhang 25 III",
	sourceUrls: [
		"https://lsth.bundesfinanzministerium.de/lsth/2026/B-Anhaenge/Anhang-25/III/inhalt.html",
		"https://lsth.bundesfinanzministerium.de/lsth/2026/A-Einkommensteuergesetz/II-Einkommen-2-24b/4-Ueberschuss-d-Einnahmen-ueber-die-Werbungsk-8-9a/Paragraf-9/h-9-5.html",
		"https://www.gesetze-im-internet.de/estg/__9.html",
		"https://www.gesetze-im-internet.de/brkg_2005/__5.html",
	],
	verifiedOn: "2026-10-06",
};

export const STATUTORY_MILEAGE_DEFAULTS: readonly StatutoryMileageDefault[] = [
	GERMAN_MILEAGE_DEFAULT,
];

export function findStatutoryMileageDefault(key: string): StatutoryMileageDefault | null {
	return STATUTORY_MILEAGE_DEFAULTS.find((entry) => entry.key === key) ?? null;
}

/** Whether the default may be adopted from `effectiveFrom` (never before its verified edition). */
export function canAdoptStatutoryDefaultFrom(
	entry: StatutoryMileageDefault,
	effectiveFrom: string,
): boolean {
	return comparePlainDates(parsePlainDate(effectiveFrom), parsePlainDate(entry.validFrom)) >= 0;
}
