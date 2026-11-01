import { and, eq } from "drizzle-orm";
import { implementationChecklistManualState } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { withAuditTrail } from "@/lib/audit-trail";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { IMPLEMENTATION_CHECKLIST_ITEMS, type ImplementationChecklistItemId } from "../definition";
import { computeConfirmationFingerprint } from "./fingerprint";

/**
 * Manual checklist confirmations (#1516). Confirming stores who confirmed, when,
 * and a fingerprint of the configuration the item covers; unconfirming removes
 * the confirmation. Each writes an organization audit entry in the same
 * transaction. Callers have authorized an org admin and validated the item.
 */

function coversOf(itemId: ImplementationChecklistItemId) {
	return (
		IMPLEMENTATION_CHECKLIST_ITEMS.find((item) => item.id === itemId)?.confirmationCovers ?? null
	);
}

export async function confirmImplementationChecklistItem(
	database: DatabaseClient,
	input: {
		organizationId: string;
		itemId: ImplementationChecklistItemId;
		actorUserId: string;
		confirmedAt: Date;
	},
): Promise<void> {
	const covers = coversOf(input.itemId);
	await withAuditTrail((audit) =>
		database.transaction(
			async (tx) => {
				// One snapshot for the fingerprint and the write.
				const configurationFingerprint = covers
					? await computeConfirmationFingerprint(tx, input.organizationId, covers)
					: null;
				const [previous] = await tx
					.select({ completedAt: implementationChecklistManualState.completedAt })
					.from(implementationChecklistManualState)
					.where(
						and(
							eq(implementationChecklistManualState.organizationId, input.organizationId),
							eq(implementationChecklistManualState.itemId, input.itemId),
						),
					);
				const [row] = await tx
					.insert(implementationChecklistManualState)
					.values({
						organizationId: input.organizationId,
						itemId: input.itemId,
						status: "complete",
						completedAt: input.confirmedAt,
						completedByUserId: input.actorUserId,
						configurationFingerprint,
					})
					.onConflictDoUpdate({
						target: [
							implementationChecklistManualState.organizationId,
							implementationChecklistManualState.itemId,
						],
						set: {
							status: "complete",
							completedAt: input.confirmedAt,
							completedByUserId: input.actorUserId,
							configurationFingerprint,
						},
					})
					.returning({ id: implementationChecklistManualState.id });
				if (!row) throw new Error("Checklist confirmation upsert returned no row");

				await audit.record(tx, {
					organizationId: input.organizationId,
					action: AuditAction.IMPLEMENTATION_CHECKLIST_ITEM_CONFIRMED,
					actorUserId: input.actorUserId,
					targetType: "implementation_checklist_item",
					targetId: row.id,
					changes: {
						confirmedAt: {
							from: previous?.completedAt?.toISOString() ?? null,
							to: input.confirmedAt.toISOString(),
						},
					},
					metadata: {
						itemId: input.itemId,
						covers,
						configurationFingerprint,
						reconfirmed: previous !== undefined,
					},
				});
			},
			{ isolationLevel: "repeatable read" },
		),
	);
}

export async function unconfirmImplementationChecklistItem(
	database: DatabaseClient,
	input: { organizationId: string; itemId: ImplementationChecklistItemId; actorUserId: string },
): Promise<{ removed: boolean }> {
	return withAuditTrail((audit) =>
		database.transaction(async (tx) => {
			const [removed] = await tx
				.delete(implementationChecklistManualState)
				.where(
					and(
						eq(implementationChecklistManualState.organizationId, input.organizationId),
						eq(implementationChecklistManualState.itemId, input.itemId),
					),
				)
				.returning({
					id: implementationChecklistManualState.id,
					completedAt: implementationChecklistManualState.completedAt,
				});
			if (!removed) return { removed: false };

			await audit.record(tx, {
				organizationId: input.organizationId,
				action: AuditAction.IMPLEMENTATION_CHECKLIST_ITEM_UNCONFIRMED,
				actorUserId: input.actorUserId,
				targetType: "implementation_checklist_item",
				targetId: removed.id,
				changes: {
					confirmedAt: { from: removed.completedAt?.toISOString() ?? null, to: null },
				},
				metadata: { itemId: input.itemId, covers: coversOf(input.itemId) },
			});
			return { removed: true };
		}),
	);
}
