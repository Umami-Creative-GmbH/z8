/**
 * An employee custom field as payroll personnel identifier (#821), the pure part.
 *
 * A payroll configuration may name an active employee custom field of type text
 * or number as the personnel number (DATEV, Lexware, Sage) or as the employee
 * match key (Personio, SuccessFactors, Workday). Its value is read as of the
 * period's last day, frozen with the run's collected input, and written wherever
 * the personnel number or match key is written today. A row without a value is
 * never filled in from the employee number or ID.
 */

/** The identifier option that names a custom field. */
export const CUSTOM_FIELD_IDENTIFIER = "customField";

/** Personnel number choices of the German file formats. */
export type PersonnelNumberType = "employeeNumber" | "employeeId" | typeof CUSTOM_FIELD_IDENTIFIER;

/** Config keys holding the custom field ID next to the identifier choice. */
export const PERSONNEL_NUMBER_CUSTOM_FIELD_KEY = "personnelNumberCustomFieldId";
export const EMPLOYEE_MATCH_CUSTOM_FIELD_KEY = "employeeMatchCustomFieldId";

/** Custom field types that can serve as identifier. */
export const PAYROLL_IDENTIFIER_FIELD_TYPES = ["text", "number"] as const;

/** A row a payroll output names an employee on. */
export interface PayrollIdentityRow {
	employeeId: string;
	employeeNumber: string | null;
	/** The frozen custom field value, when the configuration names a custom field. */
	personnelIdentifier?: string | null;
}

function fieldIdAt(config: Record<string, unknown>, key: string): string | null {
	const value = config[key];
	return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * The custom field a payroll configuration names as personnel identifier or
 * match key, or null when it names none. A custom field choice without a field
 * yields an empty string: configured, but naming nothing usable.
 */
export function payrollIdentifierCustomFieldId(config: unknown): string | null {
	if (typeof config !== "object" || config === null) return null;
	const record = config as Record<string, unknown>;
	if (record.personnelNumberType === CUSTOM_FIELD_IDENTIFIER) {
		return fieldIdAt(record, PERSONNEL_NUMBER_CUSTOM_FIELD_KEY) ?? "";
	}
	if (record.employeeMatchStrategy === CUSTOM_FIELD_IDENTIFIER) {
		return fieldIdAt(record, EMPLOYEE_MATCH_CUSTOM_FIELD_KEY) ?? "";
	}
	return null;
}

/** The validation error for a personnel number type, or null when it is valid. */
export function personnelNumberTypeError(config: Record<string, unknown>): string | null {
	const type = config.personnelNumberType;
	if (type === "employeeNumber" || type === "employeeId") return null;
	if (type === CUSTOM_FIELD_IDENTIFIER) {
		return fieldIdAt(config, PERSONNEL_NUMBER_CUSTOM_FIELD_KEY)
			? null
			: "Choose the custom field to use as personnel number";
	}
	return "Personnel number type must be 'employeeNumber', 'employeeId' or 'customField'";
}

/** The validation error for a custom field match strategy, or null when it is valid. */
export function customFieldMatchError(config: Record<string, unknown>): string | null {
	if (config.employeeMatchStrategy !== CUSTOM_FIELD_IDENTIFIER) return null;
	return fieldIdAt(config, EMPLOYEE_MATCH_CUSTOM_FIELD_KEY)
		? null
		: "Choose the custom field to match employees by";
}

/**
 * Some exported employees have no value for the configured identifier field.
 * The export is refused; nothing falls back to the employee number.
 */
export class PayrollIdentifierMissingError extends Error {
	constructor(
		readonly employeeIds: readonly string[],
		readonly organizationId: string | null = null,
	) {
		super(
			`Payroll export blocked: ${employeeIds.length} employee(s) have no value for the payroll identifier`,
		);
		this.name = "PayrollIdentifierMissingError";
	}
}

/**
 * The configuration now names a custom field identifier that the run's frozen
 * input does not carry (collected before the setting changed, or before #821).
 */
export class PayrollIdentifierChangedError extends Error {
	constructor(
		readonly jobId: string,
		readonly organizationId: string,
	) {
		super(
			`The payroll identifier setting changed after job ${jobId} was collected; start a new export`,
		);
		this.name = "PayrollIdentifierChangedError";
	}
}

/** The row's frozen identifier; a missing one refuses the export. */
export function requirePersonnelIdentifier(row: PayrollIdentityRow): string {
	if (row.personnelIdentifier) return row.personnelIdentifier;
	throw new PayrollIdentifierMissingError([row.employeeId]);
}

/** The rows with each employee's identifier value set (null without one). */
export function withPersonnelIdentifiers<T extends { employeeId: string }>(
	rows: readonly T[],
	values: Readonly<Record<string, string>>,
): Array<T & { personnelIdentifier: string | null }> {
	return rows.map((row) => ({ ...row, personnelIdentifier: values[row.employeeId] ?? null }));
}

/** Employees of the rows without an identifier value, sorted and unique. */
export function employeesWithoutIdentifier(
	rows: readonly { employeeId: string }[],
	values: Readonly<Record<string, string>>,
): string[] {
	return [
		...new Set(rows.map((row) => row.employeeId).filter((id) => values[id] === undefined)),
	].toSorted();
}
