import "server-only";
import { asc, eq } from "drizzle-orm";
import type { WorksCouncilScopeOptions } from "@/components/settings/works-council-settings-form";
import { db } from "@/db";
import { location, team } from "@/db/schema";

/**
 * Team and location names the Works Council scope pickers offer.
 * Callers must pass the organization id from the authorized settings context, never a client value.
 */
export async function loadWorksCouncilScopeOptions(
	organizationId: string,
): Promise<WorksCouncilScopeOptions> {
	const [teams, locations] = await Promise.all([
		db
			.select({ id: team.id, name: team.name })
			.from(team)
			.where(eq(team.organizationId, organizationId))
			.orderBy(asc(team.name)),
		db
			.select({ id: location.id, name: location.name })
			.from(location)
			.where(eq(location.organizationId, organizationId))
			.orderBy(asc(location.name)),
	]);

	return { teams, locations };
}
