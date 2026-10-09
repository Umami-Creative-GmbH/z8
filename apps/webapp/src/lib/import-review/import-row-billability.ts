import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { db } from "@/db";
import { project } from "@/db/schema";
import { activeProjectCustomerIdSql } from "@/lib/billable-time/project-customer";
import {
	type ImportRowBillability,
	importRowBillability,
	stagedAttributionProjectId,
} from "./staged-work-billability";

type Reader = Pick<typeof db, "select">;

/**
 * The review screen's billability of each row (null for other entities), in
 * row order. A provider's billable value is a request (#907): when the mapped
 * project has no active customer now (it was removed or deleted after the
 * scan), the row imports, or was imported, as non-billable, and the screen says
 * it is because the project has no customer.
 */
export async function listImportRowBillability(
	reader: Reader,
	organizationId: string,
	rows: readonly { entityType: string; normalizedPayload: unknown }[],
): Promise<(ImportRowBillability | null)[]> {
	const staged = rows.map((row) => ({
		billability: importRowBillability(row),
		projectId: stagedAttributionProjectId(row.normalizedPayload),
	}));
	const projectIds = [
		...new Set(
			staged.flatMap(({ billability, projectId }) =>
				billability?.billable && projectId ? [projectId] : [],
			),
		),
	];
	if (projectIds.length === 0) return staged.map(({ billability }) => billability);

	const projects = await reader
		.select({ id: project.id, customerId: activeProjectCustomerIdSql() })
		.from(project)
		.where(and(eq(project.organizationId, organizationId), inArray(project.id, projectIds)));
	const withCustomer = new Set(
		projects.flatMap((row) => (row.customerId === null ? [] : [row.id])),
	);

	return staged.map(({ billability, projectId }) =>
		billability?.billable && projectId && !withCustomer.has(projectId)
			? { ...billability, billable: false, note: "no_customer" }
			: billability,
	);
}
