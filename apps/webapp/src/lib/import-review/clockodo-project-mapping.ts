import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { clockodoProjectMapping, project } from "@/db/schema";
import type { MappedClockodoProject } from "./clockodo-billability";

/**
 * The Z8 projects (with their customers) that an organization mapped the given
 * Clockodo projects to (#907). Unmapped Clockodo projects are absent.
 */
export async function loadClockodoProjectTargets(input: {
	organizationId: string;
	clockodoProjectIds: number[];
}): Promise<Map<number, MappedClockodoProject>> {
	const clockodoProjectIds = [
		...new Set(input.clockodoProjectIds.filter((id) => Number.isSafeInteger(id))),
	];
	if (clockodoProjectIds.length === 0) return new Map();

	const rows = await db
		.select({
			clockodoProjectId: clockodoProjectMapping.clockodoProjectId,
			projectId: project.id,
			customerId: project.customerId,
		})
		.from(clockodoProjectMapping)
		.innerJoin(
			project,
			and(
				eq(project.id, clockodoProjectMapping.projectId),
				eq(project.organizationId, clockodoProjectMapping.organizationId),
			),
		)
		.where(
			and(
				eq(clockodoProjectMapping.organizationId, input.organizationId),
				inArray(clockodoProjectMapping.clockodoProjectId, clockodoProjectIds),
			),
		);

	return new Map(
		rows.map((row) => [
			row.clockodoProjectId,
			{ projectId: row.projectId, customerId: row.customerId },
		]),
	);
}
