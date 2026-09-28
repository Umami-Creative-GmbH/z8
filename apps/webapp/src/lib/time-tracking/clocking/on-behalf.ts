import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { employee, workPeriod } from "@/db/schema";

/**
 * The active employee who owns a period, inside the organization only: the
 * subject of an on-behalf clock-out that names the period. Another organization's
 * period is indistinguishable from an unknown one.
 */
export async function workPeriodOwner(
	organizationId: string,
	workPeriodId: string,
): Promise<typeof employee.$inferSelect | null> {
	const [row] = await db
		.select({ employee })
		.from(workPeriod)
		.innerJoin(employee, eq(workPeriod.employeeId, employee.id))
		.where(
			and(
				eq(workPeriod.id, workPeriodId),
				eq(workPeriod.organizationId, organizationId),
				eq(employee.organizationId, organizationId),
				eq(employee.isActive, true),
				isNull(workPeriod.deletedAt),
			),
		)
		.limit(1);
	return row?.employee ?? null;
}
