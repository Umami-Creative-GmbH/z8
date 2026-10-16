import { env } from "@/env";
import { installKioskWorker, removeKioskWorker } from "./kiosk-worker";
import { type CachedKioskEmployee, kioskOfflineCache } from "./offline-cache";
import type { KioskDeviceInfo, KioskEmployeesResponse } from "./protocol";

/**
 * What the kiosk page does with its offline data at each contact (#1291, spec
 * #885). An offline-mode kiosk keeps its kiosk, employees and states and its
 * own service worker; a kiosk whose offline mode is off, or that is revoked or
 * unpaired, deletes them at that contact. Kiosks without offline mode never
 * create any of it.
 */

/** The build the kiosk worker caches for; each deployment caches its own page and assets. */
function currentBuild(): string {
	return env.NEXT_PUBLIC_BUILD_HASH || "development";
}

/** A contact told the device about its kiosk (session, heartbeat or pairing). */
export async function rememberKioskContact(kiosk: KioskDeviceInfo, locale: string): Promise<void> {
	await kioskOfflineCache.rememberKiosk(kiosk);
	if (kiosk.offlineMode) {
		// The page's own locale and the organization's, which the kiosk returns to after a turn.
		await installKioskWorker({ locales: [locale, kiosk.language], build: currentBuild() }).catch(
			() => undefined,
		);
	} else {
		await removeKioskWorker().catch(() => undefined);
	}
}

/** A contact listed the kiosk's employees; with offline mode their states are cached. */
export function rememberKioskEmployees(
	kiosk: KioskDeviceInfo,
	listed: KioskEmployeesResponse,
): Promise<void> {
	if (!kiosk.offlineMode) return Promise.resolve();
	return kioskOfflineCache.rememberEmployees(kiosk.id, listed);
}

/** The kiosk was revoked or its token is no longer known: delete everything it cached. */
export async function forgetKioskOfflineData(): Promise<void> {
	await Promise.all([kioskOfflineCache.forget(), removeKioskWorker().catch(() => undefined)]);
}

/** The kiosk to open on while the server cannot be reached; only an offline-mode kiosk has one. */
export async function readOfflineKiosk(): Promise<KioskDeviceInfo | null> {
	const kiosk = await kioskOfflineCache.readKiosk();
	return kiosk?.offlineMode ? kiosk : null;
}

/** The kiosk's cached employees with their states; null when none are cached. */
export function readOfflineEmployees(kioskId: string): Promise<CachedKioskEmployee[] | null> {
	return kioskOfflineCache.readEmployees(kioskId);
}
