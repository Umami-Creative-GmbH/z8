import { eq } from "drizzle-orm";
import { db, employee } from "@/db";
import { runCanonicalBackfill } from "./backfill";
import { reconcileLegacyToCanonical } from "./reconciliation";

export async function assertCanonicalCutoverReady(organizationId: string) {
	let reconciliation = await reconcileLegacyToCanonical(organizationId);

	if (!hasReconciliationMismatch(reconciliation)) {
		return;
	}

	const repairActor = await db.query.employee.findFirst({
		where: eq(employee.organizationId, organizationId),
		columns: { userId: true },
	});

	if (repairActor?.userId) {
		await runCanonicalBackfill({
			organizationId,
			actorId: repairActor.userId,
		});

		reconciliation = await reconcileLegacyToCanonical(organizationId);
	}

	if (hasReconciliationMismatch(reconciliation)) {
		throw new Error(
			`Canonical time-record backfill is incomplete for organization ${organizationId}`,
		);
	}
}

function hasReconciliationMismatch(reconciliation: Record<string, number>) {
	return Object.values(reconciliation).some((count) => count > 0);
}
