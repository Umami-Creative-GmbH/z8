import { eq } from "drizzle-orm";
import { db, employee } from "@/db";
import { runCanonicalBackfill } from "./backfill";
import type { LegacyCanonicalReconciliation } from "./reconciliation";
import { reconcileLegacyToCanonical } from "./reconciliation";

export class CanonicalCutoverNotReadyError extends Error {
	readonly organizationId: string;
	readonly reconciliation: LegacyCanonicalReconciliation;

	constructor(
		organizationId: string,
		reconciliation: LegacyCanonicalReconciliation,
	) {
		super(
			`Canonical time-record backfill is incomplete for organization ${organizationId}`,
		);
		this.name = "CanonicalCutoverNotReadyError";
		this.organizationId = organizationId;
		this.reconciliation = reconciliation;
	}
}

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
		throw new CanonicalCutoverNotReadyError(organizationId, reconciliation);
	}
}

function hasReconciliationMismatch(reconciliation: Record<string, number>) {
	return Object.values(reconciliation).some((count) => count > 0);
}
