import { sql } from "drizzle-orm";
import type { db as appDb } from "@/db";

type EmployeeIdentityLockClient = Pick<typeof appDb, "execute">;
const employeeIdentityConflictMessage =
	"Employee identity already exists in organization";
const employeeIdentityUniqueIndex = "employee_organizationId_userId_unique_idx";

export function isEmployeeIdentityConflict(error: unknown): boolean {
	let candidate: unknown = error;

	for (
		let depth = 0;
		depth < 4 && candidate && typeof candidate === "object";
		depth += 1
	) {
		const current = candidate as {
			code?: unknown;
			constraint?: unknown;
			message?: unknown;
			cause?: unknown;
		};
		if (
			current.code === "23505" &&
			(current.message === employeeIdentityConflictMessage ||
				current.constraint === employeeIdentityUniqueIndex)
		) {
			return true;
		}
		candidate = current.cause;
	}

	return false;
}

export async function acquireEmployeeIdentityLock(
	dbClient: EmployeeIdentityLockClient,
	input: { organizationId: string; normalizedEmail: string },
) {
	await dbClient.execute(sql`
		select pg_advisory_xact_lock(
			hashtextextended(jsonb_build_array(${input.organizationId}, ${input.normalizedEmail})::text, 0)
		)
	`);
}
