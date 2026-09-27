import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { workCategory } from "@/db/schema";
import {
	employeeHasAccessToCategory,
	type WorkCategoryReader,
} from "@/lib/query/work-category.queries";

/** Why a work category cannot be assigned, or null when it can. */
export type WorkCategoryIneligibility = "not_found" | "not_accessible";

/**
 * Whether the employee may book work to an active category of their organization.
 * Protected preparation passes its transaction and evaluation instant.
 */
export async function workCategoryIneligibility(
	input: { employeeId: string; organizationId: string; workCategoryId: string },
	reader: WorkCategoryReader = db,
	now: Date = new Date(),
): Promise<WorkCategoryIneligibility | null> {
	const category = await reader.query.workCategory.findFirst({
		where: and(
			eq(workCategory.id, input.workCategoryId),
			eq(workCategory.organizationId, input.organizationId),
			eq(workCategory.isActive, true),
		),
	});
	if (!category) return "not_found";
	return (await employeeHasAccessToCategory(
		input.employeeId,
		input.workCategoryId,
		input.organizationId,
		reader,
		now,
	))
		? null
		: "not_accessible";
}
