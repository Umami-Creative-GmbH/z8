/**
 * Parsing of personal details input (spec #2068). Pure and client-safe: the
 * form checks as the user types with the same rules the personal details module
 * enforces before anything is stored.
 */
import { Temporal } from "temporal-polyfill";

export type Parsed<T, Code extends string> = { ok: true; value: T } | { ok: false; code: Code };

/**
 * The IBAN length of every country in the SEPA payment schemes' geographical
 * scope (EPC register of participating countries): the EU and EEA, Switzerland,
 * the United Kingdom (Jersey, Guernsey and the Isle of Man use GB), Andorra,
 * Gibraltar, Monaco, San Marino, Vatican City, and Albania, Moldova, Montenegro
 * and North Macedonia, admitted from 2025. A bank account must be able to
 * receive a SEPA transfer, so no other country is accepted.
 */
export const SEPA_IBAN_LENGTHS: Readonly<Record<string, number>> = {
	AD: 24,
	AL: 28,
	AT: 20,
	BE: 16,
	BG: 22,
	CH: 21,
	CY: 28,
	CZ: 24,
	DE: 22,
	DK: 18,
	EE: 20,
	ES: 24,
	FI: 18,
	FR: 27,
	GB: 22,
	GI: 23,
	GR: 27,
	HR: 21,
	HU: 28,
	IE: 22,
	IS: 26,
	IT: 27,
	LI: 21,
	LT: 20,
	LU: 20,
	LV: 21,
	MC: 27,
	MD: 24,
	ME: 22,
	MK: 19,
	MT: 31,
	NL: 18,
	NO: 15,
	PL: 28,
	PT: 25,
	RO: 24,
	SE: 24,
	SI: 19,
	SK: 24,
	SM: 27,
	VA: 22,
};

export type IbanRefusal =
	| "iban_required"
	| "iban_format"
	| "iban_not_sepa"
	| "iban_length"
	| "iban_checksum";

/** Upper case without any whitespace: how an IBAN is stored and compared. */
export function normalizeIban(input: string): string {
	return input.replace(/\s+/g, "").toUpperCase();
}

/** ISO 13616 check: the rearranged IBAN, letters as 10–35, is 1 modulo 97. */
function hasValidChecksum(iban: string): boolean {
	const rearranged = iban.slice(4) + iban.slice(0, 4);
	let remainder = 0;
	for (const character of rearranged) {
		const digits = /[0-9]/.test(character)
			? character
			: String(character.charCodeAt(0) - "A".charCodeAt(0) + 10);
		for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
	}
	return remainder === 1;
}

export function parseIban(input: string): Parsed<string, IbanRefusal> {
	const iban = normalizeIban(input);
	if (iban === "") return { ok: false, code: "iban_required" };
	if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) return { ok: false, code: "iban_format" };
	const length = SEPA_IBAN_LENGTHS[iban.slice(0, 2)];
	if (length === undefined) return { ok: false, code: "iban_not_sepa" };
	if (iban.length !== length) return { ok: false, code: "iban_length" };
	if (!hasValidChecksum(iban)) return { ok: false, code: "iban_checksum" };
	return { ok: true, value: iban };
}

/** The last four characters of a normalized IBAN: all a notice or masked view shows. */
export function ibanLastFour(iban: string): string {
	return iban.slice(-4);
}

export type BicRefusal = "bic_format";

/** ISO 9362: bank code (4 letters), country (2 letters), location (2), optional branch (3). */
const BIC_PATTERN = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

/** A BIC is optional: blank is none. SEPA no longer needs it, so only its format is checked. */
export function parseBic(input: string | null | undefined): Parsed<string | null, BicRefusal> {
	const bic = (input ?? "").replace(/\s+/g, "").toUpperCase();
	if (bic === "") return { ok: true, value: null };
	if (!BIC_PATTERN.test(bic)) return { ok: false, code: "bic_format" };
	return { ok: true, value: bic };
}

/** A SEPA transfer carries at most 70 characters of the creditor's name. */
export const ACCOUNT_HOLDER_MAX_LENGTH = 70;

export type AccountHolderRefusal = "account_holder_required" | "account_holder_too_long";

export function parseAccountHolder(input: string): Parsed<string, AccountHolderRefusal> {
	const holder = input.trim();
	if (holder === "") return { ok: false, code: "account_holder_required" };
	if (holder.length > ACCOUNT_HOLDER_MAX_LENGTH) {
		return { ok: false, code: "account_holder_too_long" };
	}
	return { ok: true, value: holder };
}

/** A bank account as it is stored: normalized IBAN and BIC, trimmed account holder. */
export type BankAccountValue = {
	accountHolder: string;
	iban: string;
	bic: string | null;
};

export type BankAccountInput = {
	accountHolder: string;
	iban: string;
	bic?: string | null;
};

export type BankAccountErrors = {
	accountHolder?: AccountHolderRefusal;
	iban?: IbanRefusal;
	bic?: BicRefusal;
};

export type BankAccountRefusal = AccountHolderRefusal | IbanRefusal | BicRefusal;

export function parseBankAccount(
	input: BankAccountInput,
): { ok: true; value: BankAccountValue } | { ok: false; errors: BankAccountErrors } {
	const accountHolder = parseAccountHolder(input.accountHolder);
	const iban = parseIban(input.iban);
	const bic = parseBic(input.bic);
	if (accountHolder.ok && iban.ok && bic.ok) {
		return {
			ok: true,
			value: { accountHolder: accountHolder.value, iban: iban.value, bic: bic.value },
		};
	}
	return {
		ok: false,
		errors: {
			...(accountHolder.ok ? {} : { accountHolder: accountHolder.code }),
			...(iban.ok ? {} : { iban: iban.code }),
			...(bic.ok ? {} : { bic: bic.code }),
		},
	};
}

export type ValidFromRefusal = "valid_from_invalid";

const EARLIEST_VALID_FROM = Temporal.PlainDate.from("1900-01-01");

/**
 * A valid-from is a plain calendar day (YYYY-MM-DD). Changes may be dated in the
 * past (corrections) or the future; only nonsensical days are refused.
 */
export function parseValidFrom(input: string): Parsed<Temporal.PlainDate, ValidFromRefusal> {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return { ok: false, code: "valid_from_invalid" };
	try {
		const day = Temporal.PlainDate.from(input, { overflow: "reject" });
		if (Temporal.PlainDate.compare(day, EARLIEST_VALID_FROM) < 0) {
			return { ok: false, code: "valid_from_invalid" };
		}
		return { ok: true, value: day };
	} catch {
		return { ok: false, code: "valid_from_invalid" };
	}
}
