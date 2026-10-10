import type { CompletedWorkActorKind } from "@/db/schema";

/**
 * Who a completed-work receipt records as acting (#860). A human acts for
 * themselves; a kiosk acts as itself, so its receipts name the kiosk and never
 * a human authority (the employee's user stays creator provenance on the
 * entries). A system process names itself.
 */
export type ReceiptActor =
	| { kind: "human"; userId: string }
	| { kind: "kiosk"; kioskId: string }
	| { kind: "system"; process: "automatic_clock_out" };

/** The receipt writer of kiosk clock commands; replay only matches the same writer. */
export const KIOSK_CLOCK_WRITER_VERSION = 1;

/** The device evidence kiosk clock entries carry: the kiosk's identity. */
export function kioskDeviceInfo(kioskId: string) {
	return `kiosk:${kioskId}`;
}

/** The actor a writer's receipt records: a kiosk writer records its kiosk. */
export function writerActor(
	writer: { kioskId?: string },
	actorUserId: string,
): Extract<ReceiptActor, { kind: "human" | "kiosk" }> {
	return writer.kioskId
		? { kind: "kiosk", kioskId: writer.kioskId }
		: { kind: "human", userId: actorUserId };
}

/** The receipt row's actor columns; `actor_user_id` names a human actor only. */
export function receiptActorColumns(actor: ReceiptActor): {
	actorKind: CompletedWorkActorKind;
	actorUserId: string | null;
	kioskId: string | null;
} {
	if (actor.kind === "human") {
		return { actorKind: "human", actorUserId: actor.userId, kioskId: null };
	}
	if (actor.kind === "kiosk") {
		return { actorKind: "kiosk", actorUserId: null, kioskId: actor.kioskId };
	}
	return { actorKind: "system", actorUserId: null, kioskId: null };
}
