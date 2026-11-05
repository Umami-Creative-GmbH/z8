import "server-only";
import { and, asc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import {
	equipmentItem,
	equipmentItemReadinessEvent,
	equipmentType,
} from "@/db/schema/equipment";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import type {
	EquipmentChange,
	EquipmentOutcome,
	EquipmentReadinessItemView,
} from "./contracts";
import type { EquipmentTransaction } from "./setup";

type ReadinessChange = Extract<
	EquipmentChange,
	{ kind: "clear_item" | "mark_item_unavailable" | "retire_item" }
>;

/** Called only by the shared authorized, locked, replay-protected command transaction. */
export async function applyItemReadiness(
	tx: EquipmentTransaction,
	actor: { organizationId: string; userId: string },
	change: ReadinessChange,
	recordedAt: Date,
): Promise<EquipmentOutcome> {
	const scope = and(
		eq(equipmentItem.organizationId, actor.organizationId),
		eq(equipmentItem.id, change.itemId),
	);
	const [item] = await tx.select().from(equipmentItem).where(scope);
	if (!item) return { ok: false, reason: "not_found" };
	if (item.revision !== change.expectedRevision)
		return { ok: false, reason: "stale_revision" };
	if (item.status === "retired") return { ok: false, reason: "item_retired" };
	if (change.kind === "clear_item" && item.inCustody)
		return { ok: false, reason: "item_in_custody" };
	if (item.archivedAt) return { ok: false, reason: "archived" };
	const status =
		change.kind === "clear_item"
			? "available"
			: change.kind === "retire_item"
				? "retired"
				: "unavailable";
	if (item.status === status)
		return { ok: false, reason: "readiness_unchanged" };
	const revision = item.revision + 1;
	await tx
		.update(equipmentItem)
		.set({ status, revision, updatedAt: recordedAt, updatedBy: actor.userId })
		.where(scope);
	await tx.insert(equipmentItemReadinessEvent).values({
		organizationId: actor.organizationId,
		itemId: item.id,
		itemRevision: revision,
		kind:
			change.kind === "clear_item"
				? "clearance"
				: status === "retired"
					? "retired"
					: "unavailable",
		actorId: actor.userId,
		recordedAt,
	});
	return { ok: true, id: item.id, revision };
}

/** Nonpersonal item controls are exposed only inside the staff read boundary. */
export async function readItemReadiness(
	tx: EquipmentTransaction,
	organizationId: string,
	itemScope?: SQL<boolean>,
): Promise<EquipmentReadinessItemView[]> {
	const items = await tx
		.select({
			item: equipmentItem,
			typeName: equipmentType.name,
			personalHistoryCleaned: sql<boolean>`exists (select 1 from equipment_item_custody_history h where h.organization_id=${equipmentItem.organizationId} and h.item_id=${equipmentItem.id})`,
		})
		.from(equipmentItem)
		.innerJoin(
			equipmentType,
			and(
				eq(equipmentType.id, equipmentItem.typeId),
				eq(equipmentType.organizationId, equipmentItem.organizationId),
			),
		)
		.where(and(eq(equipmentItem.organizationId, organizationId), itemScope))
		.orderBy(asc(equipmentItem.identifier));
	const events = items.length
		? await tx
				.select({ event: equipmentItemReadinessEvent, actorName: user.name })
				.from(equipmentItemReadinessEvent)
				.leftJoin(user, eq(user.id, equipmentItemReadinessEvent.actorId))
				.where(
					and(
						eq(equipmentItemReadinessEvent.organizationId, organizationId),
						inArray(
							equipmentItemReadinessEvent.itemId,
							items.map(({ item }) => item.id),
						),
					),
				)
				.orderBy(asc(equipmentItemReadinessEvent.itemRevision))
		: [];
	const history = new Map<string, EquipmentReadinessItemView["history"]>();
	for (const { event, actorName } of events) {
		const entries = history.get(event.itemId) ?? [];
		entries.push({
			id: event.id,
			kind: event.kind,
			actorId: event.actorId,
			actorName,
			recordedAt: instantFromDate(event.recordedAt).toString(),
		});
		history.set(event.itemId, entries);
	}
	return items.map(({ item, typeName, personalHistoryCleaned }) => ({
		personalHistoryCleaned,
		id: item.id,
		typeId: item.typeId,
		typeName,
		identifier: item.identifier,
		serialNumber: item.serialNumber,
		status: item.status,
		inCustody: item.inCustody,
		archived: !!item.archivedAt,
		revision: item.revision,
		canClear:
			!item.archivedAt && !item.inCustody && item.status === "unavailable",
		canMarkUnavailable: !item.archivedAt && item.status === "available",
		canRetire: !item.archivedAt && item.status !== "retired",
		history: history.get(item.id) ?? [],
	}));
}
