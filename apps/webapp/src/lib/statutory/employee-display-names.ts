import { and, eq, inArray } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import type { DatabaseClient } from "@/lib/effect/services/database.service";

/**
 * The display names of `employeeIds` in the organization, by the user-name rule
 * (`buildAuthUserDisplayName`): empty when the user has no name or email on record. An employee of
 * another organization, or one that no longer exists, has no entry. Callers choose their fallback.
 */
export async function employeeDisplayNames(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	employeeIds: readonly string[],
): Promise<Map<string, string>> {
	if (employeeIds.length === 0) return new Map();
	// The display name derives from the user, not the deprecated employee name columns.
	const rows = await db
		.select({
			id: employee.id,
			firstName: user.firstName,
			lastName: user.lastName,
			name: user.name,
			email: user.email,
		})
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(eq(employee.organizationId, organizationId), inArray(employee.id, [...employeeIds])),
		);
	return new Map(rows.map((row) => [row.id, buildAuthUserDisplayName(row)]));
}
