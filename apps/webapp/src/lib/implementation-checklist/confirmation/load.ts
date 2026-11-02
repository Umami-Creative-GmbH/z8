import { and, eq } from "drizzle-orm";
import { implementationChecklistManualState } from "@/db/schema";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import {
	IMPLEMENTATION_CHECKLIST_ITEMS,
	type ImplementationChecklistCoveredConfiguration,
	type ImplementationChecklistItemId,
} from "../definition";
import { computeConfirmationFingerprint } from "./fingerprint";
import { type ManualConfirmation, manualConfirmationFreshness } from "./freshness";

const logger = createLogger("ImplementationChecklistConfirmations");

export interface LoadedManualConfirmations {
	/** Items with a stored confirmation, counting or not. */
	manualCompleteIds: Set<ImplementationChecklistItemId>;
	/** When each stored confirmation was made and whether it is still fresh. */
	manualConfirmations: Map<ImplementationChecklistItemId, ManualConfirmation>;
}

/**
 * The organization's manual confirmations, each compared with a fingerprint of
 * its covered configuration worked out now. A fingerprint that can't be worked
 * out leaves the confirmation `unchecked`, which doesn't count.
 */
export async function loadManualConfirmations(
	database: DatabaseClient,
	organizationId: string,
): Promise<LoadedManualConfirmations> {
	const confirmable = IMPLEMENTATION_CHECKLIST_ITEMS.filter((item) => item.canManualComplete);
	const rows = await Promise.all(
		confirmable.map((item) =>
			database.query.implementationChecklistManualState.findFirst({
				where: and(
					eq(implementationChecklistManualState.organizationId, organizationId),
					eq(implementationChecklistManualState.itemId, item.id),
					eq(implementationChecklistManualState.status, "complete"),
				),
			}),
		),
	);

	const currentFingerprints = new Map<
		ImplementationChecklistCoveredConfiguration,
		Promise<string | null>
	>();
	function currentFingerprint(covers: ImplementationChecklistCoveredConfiguration) {
		let fingerprint = currentFingerprints.get(covers);
		if (!fingerprint) {
			fingerprint = computeConfirmationFingerprint(database, organizationId, covers).catch(
				(error: unknown) => {
					logger.error(
						{ organizationId, covers, error },
						"Could not work out a checklist configuration fingerprint",
					);
					return null;
				},
			);
			currentFingerprints.set(covers, fingerprint);
		}
		return fingerprint;
	}

	const manualCompleteIds = new Set<ImplementationChecklistItemId>();
	const manualConfirmations = new Map<ImplementationChecklistItemId, ManualConfirmation>();
	await Promise.all(
		confirmable.map(async (item, index) => {
			const row = rows[index];
			if (!row) return;
			manualCompleteIds.add(item.id);
			const stored = row.configurationFingerprint ?? null;
			const current =
				stored !== null && item.confirmationCovers
					? await currentFingerprint(item.confirmationCovers)
					: null;
			manualConfirmations.set(item.id, {
				confirmedAt: row.completedAt ? row.completedAt.toISOString() : null,
				freshness: item.confirmationCovers
					? manualConfirmationFreshness({ stored, current })
					: "current",
			});
		}),
	);

	return { manualCompleteIds, manualConfirmations };
}
