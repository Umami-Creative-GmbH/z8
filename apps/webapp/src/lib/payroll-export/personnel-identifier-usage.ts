import "server-only";

import { and, eq } from "drizzle-orm";
import type { db as database } from "@/db";
import { payrollExportConfig, payrollExportFormat } from "@/db/schema";
import { payrollIdentifierCustomFieldId } from "./personnel-identifier";

type Database = typeof database;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Names of the organization's active payroll configurations that use the custom
 * field as personnel identifier or match key (#821), sorted. Archiving such a
 * field is refused with these names.
 */
export async function payrollConfigurationsUsingCustomField(
	reader: Pick<Transaction, "select">,
	organizationId: string,
	customFieldId: string,
): Promise<string[]> {
	const rows = await reader
		.select({ config: payrollExportConfig.config, name: payrollExportFormat.name })
		.from(payrollExportConfig)
		.innerJoin(payrollExportFormat, eq(payrollExportFormat.id, payrollExportConfig.formatId))
		.where(
			and(
				eq(payrollExportConfig.organizationId, organizationId),
				eq(payrollExportConfig.isActive, true),
			),
		);
	return rows
		.filter((row) => payrollIdentifierCustomFieldId(row.config) === customFieldId)
		.map((row) => row.name)
		.toSorted((left, right) => left.localeCompare(right));
}
