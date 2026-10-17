import "server-only";

import { env } from "@/env";
import { type Clock, systemClock } from "@/lib/datetime/temporal-core";
import { signKioskContact } from "./contact-anchor";
import { hashKioskSecret } from "./credentials";
import { type KioskClient, type PairedKiosk, readKioskDeviceInfo } from "./kiosk-store";
import { kioskSealingKey } from "./pin-seal.server";
import type { KioskSessionResponse } from "./protocol";

/**
 * The server secret that keys kiosk contact anchors and PIN sealing (#1289),
 * each through its own HKDF derivation; no secret of its own is needed.
 */
export function kioskOfflineSecret(): string {
	return env.BETTER_AUTH_SECRET;
}

/**
 * The kiosk session answer (#859, #1287, #1289): what the device may show about
 * its kiosk and, while offline mode is in effect, this contact's signed anchor
 * and Z8's sealing key. A kiosk without offline mode gets exactly the kiosk.
 */
export async function readKioskSession(
	client: KioskClient,
	kiosk: PairedKiosk,
	token: string,
	options: { clock?: Clock; secret?: string } = {},
): Promise<KioskSessionResponse> {
	const info = await readKioskDeviceInfo(client, kiosk);
	if (!info.offlineMode) return { kiosk: info };
	const secret = options.secret ?? kioskOfflineSecret();
	return {
		kiosk: info,
		offline: {
			contact: signKioskContact(
				{
					organizationId: kiosk.organizationId,
					kioskId: kiosk.kioskId,
					tokenHash: hashKioskSecret(token),
				},
				(options.clock ?? systemClock).nowInstant(),
				secret,
			),
			sealingKey: kioskSealingKey(secret),
		},
	};
}
