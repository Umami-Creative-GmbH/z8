import { eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { organization } from "@/db/auth-schema";
import { resolveOrganizationTimezone } from "./resolve-timezone";

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;

/** The organization's resolved IANA timezone (UTC for a missing or unknown zone). */
export async function loadOrganizationTimezone(
	database: Reader,
	organizationId: string,
): Promise<string> {
	const [row] = await database
		.select({ timezone: organization.timezone })
		.from(organization)
		.where(eq(organization.id, organizationId))
		.limit(1);
	return resolveOrganizationTimezone(row?.timezone).timezone;
}
