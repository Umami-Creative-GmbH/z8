/**
 * The web app's one sign-out (#842, #843).
 *
 * In the store app shell the session is the web view's Better Auth session
 * cookie, so `authClient.signOut()` clears it: the server deletes the session
 * and expires the cookie, and the next launch shows the email screen. Device
 * cleanup that needs the session runs first: native push removes the
 * device's token. Every sign-out button calls `signOut()` so none can skip it.
 *
 * The cleanup is bounded and best effort: it never blocks sign-out. When it
 * gives up, the server still stops pushes once the session is deleted (#843).
 */

import { authClient } from "@/lib/auth-client";
import { removeNativePushTokenBeforeSignOut } from "./native-push";

const CLEANUP_TIMEOUT_MS = 3_000;

async function cleanUpDeviceBeforeSignOut(): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			removeNativePushTokenBeforeSignOut(),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, CLEANUP_TIMEOUT_MS);
			}),
		]);
	} catch {
		// Sign-out must still happen.
	} finally {
		clearTimeout(timer);
	}
}

/** Sign out: device cleanup while the session still exists, then Better Auth. */
export async function signOut(...args: Parameters<typeof authClient.signOut>) {
	await cleanUpDeviceBeforeSignOut();
	return authClient.signOut(...args);
}
