"use client";

import { IconCircleCheck, IconMapPin } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent } from "react";
import { kioskFetch, kioskRefusalOf } from "@/lib/kiosk/device";
import type { KioskDeviceInfo } from "@/lib/kiosk/protocol";
import { KioskWhoIsInBoard } from "./kiosk-who-is-in-board";

/** How often a paired kiosk checks in, so revocation shows and "last seen" stays current. */
const KIOSK_HEARTBEAT_MS = 60_000;

interface KioskPairedScreenProps {
	token: string;
	kiosk: KioskDeviceInfo;
	onRevoked: () => void;
	onUnpaired: () => void;
}

/**
 * A paired kiosk (#859 placeholder). #862 replaces the body with the kiosk home
 * screen (employee list, PIN pad, clocking); the heartbeat stays, and so does
 * the who-is-in board (#863), mounted while the kiosk's board is switched on.
 */
export function KioskPairedScreen({ token, kiosk, onRevoked, onUnpaired }: KioskPairedScreenProps) {
	const { t } = useTranslate();

	const checkIn = useEffectEvent(async () => {
		const response = await kioskFetch(token, "/api/kiosk/session").catch(() => null);
		if (!response) return;
		const refusal = await kioskRefusalOf(response);
		if (refusal === "kiosk_revoked") onRevoked();
		if (refusal === "kiosk_unknown") onUnpaired();
	});

	useEffect(() => {
		const timer = window.setInterval(() => void checkIn(), KIOSK_HEARTBEAT_MS);
		return () => window.clearInterval(timer);
	}, []);

	return (
		<div className="m-auto flex max-w-md flex-col items-center gap-6 text-center">
			<IconCircleCheck className="size-14 text-primary" aria-hidden="true" />
			<div className="space-y-2">
				<h1 className="text-3xl font-semibold">{kiosk.name}</h1>
				<p className="flex items-center justify-center gap-1 text-lg text-muted-foreground">
					<IconMapPin className="size-5" aria-hidden="true" />
					<span>{kiosk.locationName}</span>
				</p>
			</div>
			<p className="text-muted-foreground">
				{t(
					"timeTracking.kiosk.paired.description",
					"This device is paired as a kiosk. Clocking at the kiosk is not available yet.",
				)}
			</p>
			{kiosk.boardEnabled ? (
				<KioskWhoIsInBoard token={token} onRevoked={onRevoked} onUnpaired={onUnpaired} />
			) : null}
		</div>
	);
}
