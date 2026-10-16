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

/**
 * The device evidence kiosk clock entries carry: the kiosk's identity, and for a
 * frozen kiosk command (#1289, offline kiosk clocking) also where its instant
 * came from, `kiosk:<kioskId>:offline:<timeSource>`. Live kiosk entries keep
 * `kiosk:<kioskId>`.
 */
export function kioskDeviceInfo(kioskId: string, offlineTimeSource?: string) {
	return offlineTimeSource ? `kiosk:${kioskId}:offline:${offlineTimeSource}` : `kiosk:${kioskId}`;
}

/** The kiosk and, for offline kiosk clocking, the time source a kiosk entry's device evidence names. */
export function parseKioskDeviceInfo(
	deviceInfo: string | null | undefined,
): { kioskId: string; offlineTimeSource: string | null } | null {
	const match = /^kiosk:([0-9a-f-]{36})(?::offline:([a-z_]+))?$/.exec(deviceInfo ?? "");
	return match ? { kioskId: match[1], offlineTimeSource: match[2] ?? null } : null;
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

/** The signed-in user who acted, or null for a kiosk or a system process. */
export function humanActorUserId(actor: ReceiptActor): string | null {
	return actor.kind === "human" ? actor.userId : null;
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
