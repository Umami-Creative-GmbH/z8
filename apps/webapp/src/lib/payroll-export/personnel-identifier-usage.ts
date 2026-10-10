import "server-only";

import { eq } from "drizzle-orm";
import { payrollExportConfig, payrollExportFormat } from "@/db/schema";
import type {
	CustomFieldArchiveGuard,
	CustomFieldReader,
} from "@/lib/organization/custom-fields/definitions";
import { payrollIdentifierCustomFieldId } from "./personnel-identifier";

/**
 * Names of the organization's payroll configurations, active or not, that use
 * the custom field as personnel identifier or match key (#821), sorted and
 * without duplicates. An inactive configuration counts too: activating it again
 * must not find its identifier archived.
 */
export async function payrollConfigurationsUsingCustomField(
	reader: CustomFieldReader,
	organizationId: string,
	customFieldId: string,
): Promise<string[]> {
	const rows = await reader
		.select({ config: payrollExportConfig.config, name: payrollExportFormat.name })
		.from(payrollExportConfig)
		.innerJoin(payrollExportFormat, eq(payrollExportFormat.id, payrollExportConfig.formatId))
		.where(eq(payrollExportConfig.organizationId, organizationId));
	const names = rows
		.filter((row) => payrollIdentifierCustomFieldId(row.config) === customFieldId)
		.map((row) => row.name);
	return [...new Set(names)].toSorted((left, right) => left.localeCompare(right));
}

/** Archiving an employee field a payroll configuration names as identifier is refused, naming them. */
export const payrollIdentifierArchiveGuard: CustomFieldArchiveGuard = async (reader, field) => {
	if (field.entity !== "employee") return null;
	const configurations = await payrollConfigurationsUsingCustomField(
		reader,
		field.organizationId,
		field.fieldId,
	);
	return configurations.length > 0
		? { reason: "used_as_payroll_identifier", configurations }
		: null;
};
