/**
 * Why a Contractor Time & Fee Statement was refused (#2000). Client-safe: the
 * export form words each code (`CONTRACTOR_STATEMENT_REFUSALS`).
 */
export type ContractorStatementRefusal = "employee_not_found" | "not_contractor" | "invalid_period";

/**
 * A refusal the export action throws from its store step, so `storeStep` turns
 * it into a `ValidationError` with its code. The message is a diagnostic for
 * logs; it is never shown.
 */
export class ContractorStatementRefused extends Error {
	readonly code: Exclude<ContractorStatementRefusal, "employee_not_found">;

	constructor(code: ContractorStatementRefused["code"]) {
		super(`Contractor statement refused: ${code}`);
		this.name = "ContractorStatementRefused";
		this.code = code;
	}
}
