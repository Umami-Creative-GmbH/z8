/**
 * The personal details module's public types (spec #2068). Client-safe: the
 * settings UI renders these views and words these refusals.
 */
import type { BankAccountErrors, BankAccountInput } from "./validation";

/** The parts of an employee's personal details; health insurance follows (#2070). */
export const PERSONAL_DETAILS_PARTS = ["bank_account"] as const;
export type PersonalDetailsPart = (typeof PERSONAL_DETAILS_PARTS)[number];

/**
 * A bank account as a viewer sees it. `iban` is null while masked: a decider
 * sees only `ibanLastFour` until they reveal it; the employee always sees their own.
 */
export type BankAccountView = {
	accountHolder: string;
	iban: string | null;
	ibanLastFour: string;
	bic: string | null;
};

/** One row of a part's history: in force from `validFrom`; no value means ended. */
export type PersonalDetailsEntry<Value> = {
	/** A plain calendar day, YYYY-MM-DD. */
	validFrom: string;
	value: Value | null;
};

export type PersonalDetailsHistory<Value> = {
	/** The entry in force on the view's day; null when none was or it was ended. */
	current: PersonalDetailsEntry<Value> | null;
	/** Every entry, latest valid-from first, future-dated ones included. */
	history: PersonalDetailsEntry<Value>[];
};

/** What the viewer may do with these personal details. */
export type PersonalDetailsViewer = {
	/** The viewer is the employee: they see their own in full and change only by request. */
	own: boolean;
	/** The viewer may change and end the details directly. */
	mayChange: boolean;
	/** Whether IBANs are shown in full in this view. */
	revealed: boolean;
};

export type PersonalDetailsView = {
	employeeId: string;
	/** The day `current` is in force on, in the organization's timezone; YYYY-MM-DD. */
	on: string;
	viewer: PersonalDetailsViewer;
	bankAccount: PersonalDetailsHistory<BankAccountView>;
};

export type PersonalDetailsChangeInput = {
	part: "bank_account";
	/** A plain calendar day, YYYY-MM-DD; past days correct history. */
	validFrom: string;
	value: BankAccountInput;
};

export type PersonalDetailsEndInput = {
	part: PersonalDetailsPart;
	/** A plain calendar day, YYYY-MM-DD, from which no value is in force; past days included. */
	validFrom: string;
};

export type PersonalDetailsRefusalCode =
	/** No such employee for this viewer: unknown, another organization's, or no right to see. */
	| "not_found"
	/** The viewer sees these details but may not change them directly. */
	| "not_allowed"
	/** The viewer's own details: changed only by a personal details change request. */
	| "own_details"
	/** No value is in force on or after the end day: there is nothing to end. */
	| "nothing_to_end"
	/** The input is refused; `details` names each refused field. */
	| "invalid_input";

export type PersonalDetailsRefusalDetails = {
	fields?: BankAccountErrors & { validFrom?: "valid_from_invalid" };
};

export class PersonalDetailsRefusal extends Error {
	constructor(
		readonly code: PersonalDetailsRefusalCode,
		message: string,
		readonly details?: PersonalDetailsRefusalDetails,
	) {
		super(message);
		this.name = "PersonalDetailsRefusal";
	}
}
