"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { kioskFetch, kioskRefusalOf } from "@/lib/time-tracking/kiosk/device";
import { readOfflineContact, rememberKioskContact } from "@/lib/time-tracking/kiosk/offline-device";
import { type KioskQueueNotice, kioskOfflineQueue } from "@/lib/time-tracking/kiosk/offline-queue";
import type {
	KioskDeviceInfo,
	KioskOfflineContact,
	KioskRefusalCode,
} from "@/lib/time-tracking/kiosk/protocol";

/** How often a paired kiosk checks in, so revocation shows and "last seen" stays current. */
export const KIOSK_HEARTBEAT_MS = 60_000;
/** Notices about refused offline clockings disappear on their own after this long. */
const KIOSK_NOTICE_MS = 5 * 60_000;

/**
 * Whether the kiosk reaches Z8 (#862, #1291, #1292):
 * - `online`: it does, as far as the last contact and the browser tell;
 * - `offline`: it does not, and clocking is not possible (no offline mode, or no
 *   contact anchor and sealing key cached yet);
 * - `queueing`: it does not, and an offline-mode kiosk saves clockings on itself.
 */
export type KioskConnection = "online" | "offline" | "queueing";

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
	return { kiosk: body.kiosk, ...(body.offline ? { offline: body.offline } : {}) };
}

/**
 * A paired kiosk's contact with Z8 and its offline mode (#1291, #1292): the
 * heartbeat (and a check-in as soon as the browser is back online), the offline
 * data each contact keeps or deletes (`offline-device.ts`), and the queue of
 * offline clockings sent at each contact, including what a retired token still
 * holds (`kioskOfflineQueue.sendRetired`). Refusals become notices.
 *
 * One state says whether the last contact reached Z8 and whether the kiosk can
 * queue (`KioskConnection`); `contacts` counts an offline-mode kiosk's reached
 * contacts, so its employee list (and cache) refreshes at each.
 */
export function useKioskOfflineMode(input: {
	token: string;
	/** The kiosk as last described; `onKiosk` receives each newer description. */
	kiosk: KioskDeviceInfo;
	onKiosk: (kiosk: KioskDeviceInfo) => void;
	/** Opened from the cache because the server could not be reached (#1291). */
	cached: boolean;
	/** The opening contact's `offline` answer (#1292). */
	openingContact?: KioskOfflineContact;
	locale: string;
	onKioskRefused: (code: KioskRefusalCode) => void;
}) {
	const { token, kiosk, cached } = input;
	const online = useOnlineStatus();
	const [link, setLink] = useState({ reached: !cached, canQueue: false });
	const [contacts, setContacts] = useState(0);
	const [notices, setNotices] = useState<KioskQueueNotice[]>([]);

	const reached = () => setLink((prev) => ({ ...prev, reached: true }));
	const lost = () => setLink((prev) => ({ ...prev, reached: false }));

	/** Whether the kiosk can queue offline: a contact anchor and sealing key are cached. */
	async function refreshCanQueue(current: KioskDeviceInfo) {
		const canQueue = current.offlineMode && (await readOfflineContact(current.id)) !== null;
		setLink((prev) => ({ ...prev, canQueue }));
	}

	/** Sends this kiosk's queue and what retired tokens still hold; answers whether any settled. */
	async function sendQueue(kioskId: string): Promise<boolean> {
		const own = await kioskOfflineQueue.send(token, kioskId);
		const retired = await kioskOfflineQueue.sendRetired(token);
		const refused = [...own.refused, ...retired.refused];
		if (refused.length > 0) setNotices((shown) => [...shown, ...refused]);
		return own.settled + retired.settled > 0;
	}

	const checkIn = useEffectEvent(async () => {
		const response = await kioskFetch(token, "/api/kiosk/session").catch(() => null);
		if (!response) return lost();
		const refusal = await kioskRefusalOf(response);
		if (refusal) return input.onKioskRefused(refusal);
		const current = await kioskInfoOf(response);
		if (!current) return lost();
		input.onKiosk(current.kiosk);
		reached();
		await rememberKioskContact(current.kiosk, input.locale, current.offline);
		await refreshCanQueue(current.kiosk);
		const settled = await sendQueue(current.kiosk.id);
		if (current.kiosk.offlineMode || settled) setContacts((count) => count + 1);
	});

	// The kiosk the page opened on came from the server: that was a contact too.
	const rememberOpening = useEffectEvent(async () => {
		if (!cached) await rememberKioskContact(kiosk, input.locale, input.openingContact);
		await refreshCanQueue(kiosk);
		if (cached) return;
		if (await sendQueue(kiosk.id)) setContacts((count) => count + 1);
	});

	useEffect(() => {
		void rememberOpening();
		const timer = window.setInterval(() => void checkIn(), KIOSK_HEARTBEAT_MS);
		return () => window.clearInterval(timer);
	}, []);

	// An offline-mode kiosk checks in as soon as the connection is back.
	useEffect(() => {
		if (online && kiosk.offlineMode && !link.reached) void checkIn();
	}, [online, kiosk.offlineMode, link.reached]);

	// Notices about refused offline clockings go away on their own after a while.
	useEffect(() => {
		if (notices.length === 0) return;
		const timer = window.setTimeout(() => setNotices([]), KIOSK_NOTICE_MS);
		return () => window.clearTimeout(timer);
	}, [notices]);

	const offline = !online || (kiosk.offlineMode && !link.reached);
	const connection: KioskConnection = !offline
		? "online"
		: kiosk.offlineMode && link.canQueue
			? "queueing"
			: "offline";

	return {
		connection,
		/** The browser reports a network (a kiosk without offline mode still needs it to clock). */
		online,
		contacts,
		notices,
		dismissNotices: () => setNotices([]),
		/** A call found Z8 unreachable while the browser had a network. */
		contactLost: lost,
	};
}
