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

const ABSENCE_RECONCILIATION_KEYS = [
	"absenceCountMismatch",
	"missingAbsenceCanonicalRecords",
	"missingAbsenceDetailRows",
	"missingAbsenceCanonicalLinks",
	"missingAbsenceOrganizationIds",
] as const satisfies readonly (keyof LegacyCanonicalReconciliation)[];

/**
 * Read-only absence readiness for organizations under scoped payroll work
 * collection (#322). Work readiness is the collection's own scoped assessment, so
 * the organization-wide backfill must not run and rewrite work lineage; absences
 * keep this organization-wide check until they get a scoped one.
 */
export async function assertCanonicalAbsencesReady(organizationId: string) {
	const reconciliation = await reconcileLegacyToCanonical(organizationId);
	if (ABSENCE_RECONCILIATION_KEYS.some((key) => reconciliation[key] > 0)) {
		throw new CanonicalCutoverNotReadyError(organizationId, reconciliation);
	}
}

function hasReconciliationMismatch(reconciliation: Record<string, number>) {
	return Object.values(reconciliation).some((count) => count > 0);
}
