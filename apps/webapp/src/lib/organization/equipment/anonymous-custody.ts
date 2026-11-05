import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import {
	equipmentAssignment,
	equipmentCustodyReceipt,
	equipmentItem,
	equipmentItemCustodyHistory,
} from "@/db/schema/equipment";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import { type EquipmentActor, equipmentWorkerAccess } from "./access";
import type { EquipmentChange, EquipmentOutcome } from "./contracts";
import type { EquipmentTransaction } from "./setup";

type Change = Extract<
	EquipmentChange,
	{ kind: "propose_custody_receipt" | "confirm_custody_receipt" }
>;
export async function receiptProposer(
	tx: EquipmentTransaction,
	organizationId: string,
	proposalId: string,
) {
	const [proposal] = await tx
		.select()
		.from(equipmentCustodyReceipt)
		.where(
			and(
				eq(equipmentCustodyReceipt.organizationId, organizationId),
				eq(equipmentCustodyReceipt.id, proposalId),
			),
		);
	return proposal;
}
/** Called before replay as well: each staff member's authority remains live. */
export async function authorizeCustodyConfirmation(
	tx: EquipmentTransaction,
	actor: EquipmentActor,
	proposalId: string,
	now: Instant,
): Promise<EquipmentOutcome | null> {
	const proposal = await receiptProposer(tx, actor.organizationId, proposalId);
	if (!proposal) return { ok: false, reason: "not_found" };
	if (proposal.proposedBy === actor.userId)
		return { ok: false, reason: "self_receipt" };
	if (
		!proposal.proposedBy ||
		!(
			await equipmentWorkerAccess(
				tx,
				{ organizationId: actor.organizationId, userId: proposal.proposedBy },
				now,
			)
		)?.all
	)
		return { ok: false, reason: "forbidden" };
	return null;
}
export async function receiveAnonymousCustody(
	tx: EquipmentTransaction,
	actor: EquipmentActor,
	change: Change,
	today: Temporal.PlainDate,
	now: Instant,
): Promise<EquipmentOutcome> {
	const scope = and(
		eq(equipmentItem.organizationId, actor.organizationId),
		eq(equipmentItem.id, change.itemId),
	);
	const [item] = await tx.select().from(equipmentItem).where(scope);
	if (!item) return { ok: false, reason: "not_found" };
	if (item.revision !== change.expectedRevision)
		return { ok: false, reason: "stale_revision" };
	if (!item.inCustody) return { ok: false, reason: "already_received" };
	const [held] = await tx
		.select({ id: equipmentAssignment.id })
		.from(equipmentAssignment)
		.where(
			and(
				eq(equipmentAssignment.organizationId, actor.organizationId),
				eq(equipmentAssignment.itemId, item.id),
				eq(equipmentAssignment.received, false),
			),
		);
	// The ordinary assignment boundary is mandatory while holder identity survives.
	if (held) return { ok: false, reason: "forbidden" };
	const [boundary] = await tx
		.select()
		.from(equipmentItemCustodyHistory)
		.where(
			and(
				eq(equipmentItemCustodyHistory.organizationId, actor.organizationId),
				eq(equipmentItemCustodyHistory.itemId, item.id),
				isNull(equipmentItemCustodyHistory.receiptDate),
			),
		)
		.orderBy(desc(equipmentItemCustodyHistory.issueSequence))
		.limit(1);
	if (!boundary) return { ok: false, reason: "conflicting_history" };
	const proposal =
		change.kind === "confirm_custody_receipt"
			? await receiptProposer(tx, actor.organizationId, change.proposalId)
			: null;
	if (
		change.kind === "confirm_custody_receipt" &&
		(!proposal ||
			proposal.itemId !== item.id ||
			proposal.itemRevision !== item.revision ||
			proposal.confirmedAt)
	)
		return { ok: false, reason: "stale_revision" };
	const actualDate =
		change.kind === "propose_custody_receipt"
			? change.actualDate
			: proposal?.actualDate;
	if (!actualDate) return { ok: false, reason: "conflicting_history" };
	if (Temporal.PlainDate.compare(actualDate, today) > 0)
		return { ok: false, reason: "future_date" };
	if (
		[item.lastHandoverDate, boundary.issueDate].some(
			(date) => date && Temporal.PlainDate.compare(actualDate, date) < 0,
		)
	)
		return { ok: false, reason: "conflicting_history" };
	const revision = item.revision + 1;
	if (change.kind === "propose_custody_receipt") {
		await tx.insert(equipmentCustodyReceipt).values({
			organizationId: actor.organizationId,
			itemId: item.id,
			itemRevision: revision,
			actualDate,
			condition: change.condition,
			proposedBy: actor.userId,
			proposedAt: dateFromInstant(now),
		});
		await tx
			.update(equipmentItem)
			.set({
				revision,
				updatedAt: dateFromInstant(now),
				updatedBy: actor.userId,
			})
			.where(scope);
	} else {
		if (!proposal) return { ok: false, reason: "not_found" };
		await tx
			.update(equipmentCustodyReceipt)
			.set({ confirmedBy: actor.userId, confirmedAt: dateFromInstant(now) })
			.where(
				and(
					eq(equipmentCustodyReceipt.organizationId, actor.organizationId),
					eq(equipmentCustodyReceipt.id, proposal.id),
				),
			);
		await tx
			.update(equipmentItemCustodyHistory)
			.set({ receiptDate: actualDate })
			.where(
				and(
					eq(equipmentItemCustodyHistory.organizationId, actor.organizationId),
					eq(equipmentItemCustodyHistory.itemId, item.id),
					eq(equipmentItemCustodyHistory.issueSequence, boundary.issueSequence),
				),
			);
		await tx
			.update(equipmentItem)
			.set({
				inCustody: false,
				lastHandoverDate: actualDate,
				revision,
				status:
					proposal.condition === "damaged" && item.status !== "retired"
						? "unavailable"
						: item.status,
				updatedAt: dateFromInstant(now),
				updatedBy: actor.userId,
			})
			.where(scope);
	}
	return { ok: true, id: item.id, revision };
}
