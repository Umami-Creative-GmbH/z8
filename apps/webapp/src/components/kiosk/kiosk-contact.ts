import { kioskFetch, kioskRefusalOf } from "@/lib/time-tracking/kiosk/device";
import { readOfflineContact, rememberKioskContact } from "@/lib/time-tracking/kiosk/offline-device";
import { type KioskQueueNotice, kioskOfflineQueue } from "@/lib/time-tracking/kiosk/offline-queue";
import type {
	KioskDeviceInfo,
	KioskOfflineContact,
	KioskRefusalCode,
} from "@/lib/time-tracking/kiosk/protocol";

/**
 * What a contact with Z8 tells the kiosk screen (#1291, #1292). Every callback
 * runs once the contact's asynchronous work has answered; the screen keeps the
 * state they describe.
 */
export interface KioskContactSink {
	/** The contact reached Z8. */
	reached: () => void;
	/** The contact did not reach Z8. */
	lost: () => void;
	/** Whether the kiosk can queue offline: a contact anchor and sealing key are cached. */
	canQueue: (canQueue: boolean) => void;
	/** Offline clockings Z8 refused. */
	refused: (notices: KioskQueueNotice[]) => void;
	/** A contact an offline-mode kiosk (or a settled queue) counts, so its employee list refreshes. */
	counted: () => void;
}

/** The kiosk as the server describes it now, from the heartbeat; null when unreadable. */
async function kioskInfoOf(
	response: Response,
): Promise<{ kiosk: KioskDeviceInfo; offline?: KioskOfflineContact } | null> {
	if (!response.ok) return null;
	const body = (await response.json().catch(() => null)) as {
		kiosk?: KioskDeviceInfo;
		offline?: KioskOfflineContact;
	} | null;
	if (!body?.kiosk || typeof body.kiosk.boardEnabled !== "boolean") return null;
	return {
		kiosk: body.kiosk,
		...(body.offline ? { offline: body.offline } : {}),
	};
}

async function refreshCanQueue(current: KioskDeviceInfo, sink: KioskContactSink) {
	sink.canQueue(current.offlineMode && (await readOfflineContact(current.id)) !== null);
}

/** Sends this kiosk's queue and what retired tokens still hold; answers whether any settled. */
async function sendQueue(token: string, kioskId: string, sink: KioskContactSink): Promise<boolean> {
	// Both run one after the other on the queue's own serialization, in this order.
	const [own, retired] = await Promise.all([
		kioskOfflineQueue.send(token, kioskId),
		kioskOfflineQueue.sendRetired(token),
	]);
	const refused = [...own.refused, ...retired.refused];
	if (refused.length > 0) sink.refused(refused);
	return own.settled + retired.settled > 0;
}

/**
 * A heartbeat contact: reads the kiosk as Z8 describes it now, keeps (or deletes)
 * its offline data and sends its queue of offline clockings.
 */
export async function checkInKiosk(
	input: {
		token: string;
		locale: string;
		onKiosk: (kiosk: KioskDeviceInfo) => void;
		onKioskRefused: (code: KioskRefusalCode) => void;
	},
	sink: KioskContactSink,
) {
	const response = await kioskFetch(input.token, "/api/kiosk/session").catch(() => null);
	if (!response) return sink.lost();
	const refusal = await kioskRefusalOf(response);
	if (refusal) return input.onKioskRefused(refusal);
	const current = await kioskInfoOf(response);
	if (!current) return sink.lost();
	input.onKiosk(current.kiosk);
	sink.reached();
	await rememberKioskContact(current.kiosk, input.locale, current.offline);
	await refreshCanQueue(current.kiosk, sink);
	const settled = await sendQueue(input.token, current.kiosk.id, sink);
	if (current.kiosk.offlineMode || settled) sink.counted();
}

/** The kiosk the page opened on came from the server (unless `cached`): that was a contact too. */
export async function rememberOpeningContact(
	input: {
		token: string;
		kiosk: KioskDeviceInfo;
		cached: boolean;
		locale: string;
		openingContact?: KioskOfflineContact;
	},
	sink: KioskContactSink,
) {
	const { kiosk, cached } = input;
	if (!cached) await rememberKioskContact(kiosk, input.locale, input.openingContact);
	await refreshCanQueue(kiosk, sink);
	if (cached) return;
	if (await sendQueue(input.token, kiosk.id, sink)) sink.counted();
}
