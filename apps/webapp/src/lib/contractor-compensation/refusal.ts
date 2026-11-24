import type { ContractorCompensationRefusal } from "./terms";

/**
 * Why a contractor terms change was refused (#1998). Client-safe: the client
 * words each code (`CONTRACTOR_COMPENSATION_REFUSALS`); the server sends only
 * the code.
 */
export type ContractorTermsRefusal =
	| ContractorCompensationRefusal
	| "invalid_date"
	| "employee_not_found"
	/** The employee's active engagement is not an External Contractor engagement (or there is none). */
	| "not_contractor"
	/** Terms cannot start before the contractor's engagement started. */
	| "before_engagement";

/** Why saving a contractor's contracting details was refused. */
export type ContractorDetailsRefusal = "employee_not_found" | "not_contractor";

/**
 * A refusal the compensation actions throw from their store step, so
 * `storeStep` turns it into a `ValidationError` with its code. The message is
 * a diagnostic for logs; it is never shown.
 */
export class ContractorCompensationRefused extends Error {
	readonly code: Exclude<ContractorTermsRefusal | ContractorDetailsRefusal, "employee_not_found">;

	constructor(code: ContractorCompensationRefused["code"]) {
		super(`Contractor compensation change refused: ${code}`);
		this.name = "ContractorCompensationRefused";
		this.code = code;
	}
}
