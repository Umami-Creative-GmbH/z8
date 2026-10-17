import "server-only";
import { eq } from "drizzle-orm";
import { vacationPolicyRollout } from "@/db/schema";
import type { AbsenceDaysDatabase } from "./absence-days-resolver";
/** One persisted admission decision shared by balance readers and posting jobs. */
export async function vacationPolicyCalculationsEnabled(
	database: AbsenceDaysDatabase,
	organizationId: string,
	year: number,
): Promise<boolean> {
	if (year < 2026) return false;
	const rollout = await database.query.vacationPolicyRollout.findFirst({
		where: eq(vacationPolicyRollout.organizationId, organizationId),
		columns: { calculationsEnabled: true },
	});
	return rollout?.calculationsEnabled ?? false;
}
