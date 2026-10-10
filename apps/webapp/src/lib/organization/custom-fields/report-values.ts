/**
 * Custom field values as reports and exports show them (#820, spec #769).
 * Pure and client-safe; `report-reads.ts` reads them as of a date for a viewer.
 *
 * Every field the viewer sees is listed, in the defined order, whether the
 * record has a value or not, so report sections and export columns line up.
 */

import type { CustomFieldType } from "./definition-rules";
import type { CustomFieldValue } from "./value-rules";

/** One custom field of one record in a report or export. */
export interface CustomFieldReportValue {
	fieldId: string;
	/** The field name: the label of its report line or export column. */
	name: string;
	type: CustomFieldType;
	/**
	 * The value as of the report's date: text as written, a number as a
	 * canonical decimal ("12.5"), a date as ISO "YYYY-MM-DD", a select value as
	 * its option label (also an archived option's), a boolean as is. Null = no value.
	 */
	value: string | boolean | null;
}

/** What the projection needs to know about a field. */
export interface CustomFieldReportField {
	id: string;
	name: string;
	type: CustomFieldType;
	options: readonly { id: string; label: string }[];
}

/** The report values of one record: one entry per field, in the fields' order. */
export function customFieldReportValues(
	fields: readonly CustomFieldReportField[],
	values: Readonly<Record<string, CustomFieldValue>>,
): CustomFieldReportValue[] {
	return fields.map((field) => {
		const value = values[field.id];
		return {
			fieldId: field.id,
			name: field.name,
			type: field.type,
			value: reportValueOf(field, value),
		};
	});
}

function reportValueOf(
	field: CustomFieldReportField,
	value: CustomFieldValue | undefined,
): string | boolean | null {
	if (!value || value.type !== field.type) return null;
	if (value.type === "select") {
		return field.options.find((option) => option.id === value.value)?.label ?? null;
	}
	return value.value;
}

/**
 * A report value as text: booleans with the given labels (English "Yes" / "No"
 * by default; exports pass "true" / "false"), no value as "".
 */
export function customFieldReportText(
	field: Pick<CustomFieldReportValue, "value">,
	labels: { yes: string; no: string } = { yes: "Yes", no: "No" },
): string {
	if (field.value === null) return "";
	if (typeof field.value === "boolean") return field.value ? labels.yes : labels.no;
	return field.value;
}
