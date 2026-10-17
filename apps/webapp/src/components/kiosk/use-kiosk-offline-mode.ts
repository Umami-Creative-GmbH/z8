"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { useOnlineStatus } from "@/hooks/use-online-status";
import type { KioskQueueNotice } from "@/lib/time-tracking/kiosk/offline-queue";
import type {
	KioskDeviceInfo,
	KioskOfflineContact,
	KioskRefusalCode,
} from "@/lib/time-tracking/kiosk/protocol";
import { checkInKiosk, type KioskContactSink, rememberOpeningContact } from "./kiosk-contact";

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

/**
 * A paired kiosk's contact with Z8 and its offline mode (#1291, #1292): the
 * heartbeat (and a check-in as soon as the browser is back online), the offline
 * data each contact keeps or deletes (`offline-device.ts`), and the queue of
 * offline clockings sent at each contact, including what a retired token still
 * holds (`kioskOfflineQueue.sendRetired`). Refusals become notices. The contacts
 * themselves live in `kiosk-contact.ts`; this hook keeps what they report.
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

	const lost = () => setLink((prev) => ({ ...prev, reached: false }));

	const sink: KioskContactSink = {
		reached: () => setLink((prev) => ({ ...prev, reached: true })),
		lost,
		// Unchanged answers keep the state as it is, so they cause no render.
		canQueue: (canQueue) =>
			setLink((prev) => (prev.canQueue === canQueue ? prev : { ...prev, canQueue })),
		refused: (refused) => setNotices((shown) => [...shown, ...refused]),
		counted: () => setContacts((count) => count + 1),
	};

	const checkIn = useEffectEvent(() =>
		checkInKiosk(
			{
				token,
				locale: input.locale,
				onKiosk: input.onKiosk,
				onKioskRefused: input.onKioskRefused,
			},
			sink,
		),
	);

	const rememberOpening = useEffectEvent(() =>
		rememberOpeningContact(
			{
				token,
				kiosk,
				cached,
				locale: input.locale,
				openingContact: input.openingContact,
			},
			sink,
		),
	);

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
