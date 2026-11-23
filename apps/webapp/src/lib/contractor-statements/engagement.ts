import "server-only";

import { and, eq } from "drizzle-orm";
import { employeeEmploymentPeriod } from "@/db/schema";
import type { Transaction } from "@/lib/time-tracking/work-transaction/ranks";

/**
 * Whether the person ever had an External Contractor engagement in the
 * organization (#2000): the contractor self-service offers their Time & Fee
 * Statements then, including to a contractor later converted to an employee.
 * Kept apart from the statement loader so pages can ask cheaply.
 */
export async function hasContractorEngagement(
	reader: Pick<Transaction, "select">,
	organizationId: string,
	employeeId: string,
): Promise<boolean> {
	const [row] = await reader
		.select({ id: employeeEmploymentPeriod.id })
		.from(employeeEmploymentPeriod)
		.where(
			and(
				eq(employeeEmploymentPeriod.organizationId, organizationId),
				eq(employeeEmploymentPeriod.employeeId, employeeId),
				eq(employeeEmploymentPeriod.engagementKind, "contractor"),
			),
		)
		.limit(1);
	return row !== undefined;
}
