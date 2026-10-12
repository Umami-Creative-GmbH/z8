import "server-only";

import type { PlainDate } from "@/lib/datetime/temporal-core";
import type { CustomFieldEntity, CustomFieldType } from "./definition-rules";
import type { CustomFieldReader } from "./definitions";
import { type CustomFieldReportValue, customFieldReportValues } from "./report-values";
import { type CustomFieldViewer, readCustomFieldValues } from "./values";

/** A custom field column of a report or export: the active fields the viewer sees, in order. */
export interface CustomFieldReportColumn {
	fieldId: string;
	name: string;
	type: CustomFieldType;
}

export interface CustomFieldReportRead {
	columns: CustomFieldReportColumn[];
	/** By record id: one value per column, in column order (every requested record). */
	byRecord: Record<string, CustomFieldReportValue[]>;
}

/**
 * The custom field values of some records as reports and exports show them
 * (#820): the active fields `viewer` sees, in order, with values as of `asOf`
 * (the report period's last day or the export date, in the organization's
 * business zone). Archived fields never appear. Reads go through the as-of
 * read contract (`readCustomFieldValues`), so tracked values follow their history.
 *
 * The caller passes only records the viewer reaches.
 */
export async function readCustomFieldReportValues(
	reader: CustomFieldReader,
	input: {
		organizationId: string;
		entity: CustomFieldEntity;
		recordIds: readonly string[];
		asOf: PlainDate;
		viewer: CustomFieldViewer;
	},
): Promise<CustomFieldReportRead> {
	const read = await readCustomFieldValues(reader, input);
	const byRecord: Record<string, CustomFieldReportValue[]> = {};
	for (const recordId of input.recordIds) {
		byRecord[recordId] = customFieldReportValues(read.fields, read.values[recordId] ?? {});
	}
	return {
		columns: read.fields.map((field) => ({
			fieldId: field.id,
			name: field.name,
			type: field.type,
		})),
		byRecord,
	};
}
