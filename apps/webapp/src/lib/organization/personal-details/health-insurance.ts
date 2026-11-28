/**
 * Health insurance input (spec #2068, #2070). Pure and client-safe: the form
 * checks as the user types with the same rules the personal details module
 * enforces before anything is stored.
 *
 * A statutory insurer is picked from the bundled list by its Betriebsnummer, its
 * name and Betriebsnummer then copied onto the record, or typed by name when it is
 * missing from the list; a private insurer is typed by name.
 */
import { STATUTORY_HEALTH_INSURERS } from "./statutory-health-insurers";

export const HEALTH_INSURANCE_KINDS = ["statutory", "private"] as const;
export type HealthInsuranceKind = (typeof HEALTH_INSURANCE_KINDS)[number];

/** One insurer of the bundled list. */
export type StatutoryInsurer = {
	name: string;
	/** Eight digits: the insurer's Betriebsnummer as an Einzugsstelle. */
	betriebsnummer: string;
	/** The day the insurer left the list (merged or closed): no longer offered for new picks. */
	removedOn?: string;
	/** The Betriebsnummer of the insurer it merged into, when the source names one. */
	successor?: string;
};

export type StatutoryInsurerList = {
	/** Where the list was taken from. */
	source: string;
	/** The day of the source file, YYYY-MM-DD. */
	asOf: string;
	insurers: StatutoryInsurer[];
};

/** A typed insurer name is at most this long. */
export const INSURER_NAME_MAX_LENGTH = 120;

/** Health insurance as it is stored: a picked statutory insurer carries its Betriebsnummer. */
export type HealthInsuranceValue = {
	kind: HealthInsuranceKind;
	insurerName: string;
	/** Only for a statutory insurer picked from the list, copied at pick time. */
	betriebsnummer: string | null;
};

export type HealthInsuranceInput = {
	kind: HealthInsuranceKind;
	/** A statutory insurer picked from the list; blank or absent when the name is typed. */
	betriebsnummer?: string | null;
	/** The typed name; ignored for a picked insurer, whose name comes from the list. */
	insurerName?: string | null;
};

export type HealthInsuranceErrors = {
	kind?: "kind_invalid";
	betriebsnummer?: "insurer_unknown" | "insurer_removed";
	insurerName?: "insurer_name_required" | "insurer_name_too_long";
};

export type HealthInsuranceRefusal = NonNullable<
	HealthInsuranceErrors[keyof HealthInsuranceErrors]
>;

/** The insurers a new pick may choose: those still on the list. */
export function pickableStatutoryInsurers(
	list: StatutoryInsurerList = STATUTORY_HEALTH_INSURERS,
): { name: string; betriebsnummer: string }[] {
	return list.insurers
		.filter((insurer) => insurer.removedOn === undefined)
		.map(({ name, betriebsnummer }) => ({ name, betriebsnummer }));
}

function isHealthInsuranceKind(value: unknown): value is HealthInsuranceKind {
	return (HEALTH_INSURANCE_KINDS as readonly unknown[]).includes(value);
}

export function parseHealthInsurance(
	input: HealthInsuranceInput,
	list: StatutoryInsurerList = STATUTORY_HEALTH_INSURERS,
): { ok: true; value: HealthInsuranceValue } | { ok: false; errors: HealthInsuranceErrors } {
	if (!isHealthInsuranceKind(input.kind)) return { ok: false, errors: { kind: "kind_invalid" } };
	const betriebsnummer = (input.betriebsnummer ?? "").trim();
	if (input.kind === "statutory" && betriebsnummer !== "") {
		const insurer = list.insurers.find((candidate) => candidate.betriebsnummer === betriebsnummer);
		if (!insurer) return { ok: false, errors: { betriebsnummer: "insurer_unknown" } };
		if (insurer.removedOn !== undefined) {
			return { ok: false, errors: { betriebsnummer: "insurer_removed" } };
		}
		return {
			ok: true,
			value: {
				kind: "statutory",
				insurerName: insurer.name,
				betriebsnummer: insurer.betriebsnummer,
			},
		};
	}
	const insurerName = (input.insurerName ?? "").trim();
	if (insurerName === "") return { ok: false, errors: { insurerName: "insurer_name_required" } };
	if (insurerName.length > INSURER_NAME_MAX_LENGTH) {
		return { ok: false, errors: { insurerName: "insurer_name_too_long" } };
	}
	return { ok: true, value: { kind: input.kind, insurerName, betriebsnummer: null } };
}
