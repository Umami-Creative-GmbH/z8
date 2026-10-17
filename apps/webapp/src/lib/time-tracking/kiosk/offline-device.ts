import { env } from "@/env";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { installKioskWorker, KIOSK_DEVELOPMENT_BUILD, removeKioskWorker } from "./kiosk-worker";
import { type CachedKioskEmployee, kioskOfflineCache } from "./offline-cache";
import { kioskOfflineClock } from "./offline-clock";
import { kioskOfflineQueue } from "./offline-queue";
import type { KioskPinAttemptVerdict } from "./pin-attempt-limit";
import type { KioskDeviceInfo, KioskEmployeesResponse, KioskOfflineContact } from "./protocol";

/**
 * What the kiosk page does with its offline data at each contact (#1291, spec
 * #885). An offline-mode kiosk keeps its kiosk, employees and states and its
 * own service worker; a kiosk whose offline mode is off, or that is revoked or
 * unpaired, deletes them at that contact. Kiosks without offline mode never
 * create any of it.
 */

/** The build the kiosk worker caches for; each deployment caches its own page and assets. */
function currentBuild(): string {
	return env.NEXT_PUBLIC_BUILD_HASH || KIOSK_DEVELOPMENT_BUILD;
}

/**
 * A contact told the device about its kiosk (session, heartbeat or pairing).
 * With offline mode, its `offline` answer (#1292) anchors the kiosk's clock for
 * this page and is cached: the contact anchor every queued command carries back,
 * and Z8's key to seal PINs with.
 */
export async function rememberKioskContact(
	kiosk: KioskDeviceInfo,
	locale: string,
	offline?: KioskOfflineContact,
): Promise<void> {
	const contact = kiosk.offlineMode ? offline : undefined;
	if (contact) kioskOfflineClock.noteContact(contact.contact.serverTime);
	await kioskOfflineCache.rememberKiosk(kiosk);
	await kioskOfflineCache.rememberContact(kiosk.id, contact);
	if (kiosk.offlineMode) {
		// The page's own locale and the organization's, which the kiosk returns to after a turn.
		await installKioskWorker({ locales: [locale, kiosk.language], build: currentBuild() }).catch(
			() => undefined,
		);
	} else {
		await removeKioskWorker().catch(() => undefined);
	}
}

/**
 * A contact listed the kiosk's employees; with offline mode their states are
 * cached, and the commands Z8 confirmed before those states were read are no
 * longer applied on top of them.
 */
export async function rememberKioskEmployees(
	kiosk: KioskDeviceInfo,
	listed: KioskEmployeesResponse,
): Promise<void> {
	if (!kiosk.offlineMode) return;
	await kioskOfflineCache.rememberEmployees(kiosk.id, listed);
	if (listed.offline) {
		await kioskOfflineQueue.forgetConfirmedBefore(kiosk.id, listed.offline.learnedAt);
	}
}

/**
 * The kiosk was revoked or its token is no longer known: delete everything it
 * cached. Its queued commands are not cached data: they are sent once with the
 * old token first (`retireKioskToken`).
 */
export async function forgetKioskOfflineData(): Promise<void> {
	await Promise.all([kioskOfflineCache.forget(), removeKioskWorker().catch(() => undefined)]);
}

/**
 * Gives up a device token Z8 no longer accepts for clocking (the kiosk was
 * revoked, or its token is unknown): sends the commands queued under it once,
 * so Z8 refuses and lists them for its kiosk, then deletes the kiosk's offline
 * data. Answers whether Z8 was reached; when it was not, the commands keep the
 * token and are sent at a later contact, even after the device is paired again
 * (`kioskOfflineQueue.sendRetired`). The stored token itself is the caller's.
 */
export async function retireKioskToken(token: string): Promise<boolean> {
	const { sent } = await kioskOfflineQueue.sendBeforeForgetting(token);
	await forgetKioskOfflineData();
	return sent;
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

/** The kiosk's latest contact anchor and sealing key; without them it cannot clock offline. */
export function readOfflineContact(kioskId: string): Promise<KioskOfflineContact | null> {
	return kioskOfflineCache.readContact(kioskId);
}

/**
 * One offline PIN attempt against the per-kiosk attempt limit (#1292), timed by
 * the kiosk's offline clock (server time plus a monotonic clock since the last
 * contact), so changing the device clock does not clear the window.
 */
export function takeOfflinePinAttempt(): Promise<KioskPinAttemptVerdict> {
	return kioskOfflineCache.takePinAttempt(parseInstant(kioskOfflineClock.now().occurredAt));
}
