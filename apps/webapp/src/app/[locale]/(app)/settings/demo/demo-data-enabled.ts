import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";

/**
 * Whether the organization offers the demo data tools. An organization that
 * has not decided yet offers them; a missing organization does not.
 */
export async function isDemoDataEnabledForOrganization(
	organizationId: string,
	database: Pick<typeof db, "query"> = db,
): Promise<boolean> {
	const row = await database.query.organization.findFirst({
		columns: { demoDataEnabled: true },
		where: eq(organization.id, organizationId),
	});

	return row ? (row.demoDataEnabled ?? true) : false;
}
