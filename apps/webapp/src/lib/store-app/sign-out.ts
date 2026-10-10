/**
 * Sign-out seam for the store app shell (#842).
 *
 * The shell's session is the web view's Better Auth session cookie, so
 * `authClient.signOut()` clears it: the server deletes the session and expires
 * the cookie, and the next launch shows the email screen. Device-bound state
 * that needs the session to clean up runs first: native push removes the
 * device's token (`removeNativePushTokenBeforeSignOut`, #843), then every task
 * registered here. Every web app sign-out awaits `runStoreAppSignOutTasks()`
 * before it signs out.
 *
 * A task that fails or hangs never blocks sign-out.
 */

import { removeNativePushTokenBeforeSignOut } from "./native-push";

export type StoreAppSignOutTask = () => Promise<void> | void;

const TASK_TIMEOUT_MS = 3_000;
const tasks = new Set<StoreAppSignOutTask>();

/** Registers a task to run before sign-out; returns its unregister function. */
export function onStoreAppSignOut(task: StoreAppSignOutTask): () => void {
	tasks.add(task);
	return () => {
		tasks.delete(task);
	};
}

async function runBounded(task: StoreAppSignOutTask): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			Promise.resolve().then(task),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, TASK_TIMEOUT_MS);
			}),
		]);
	} catch {
		// Sign-out must still happen; the task's own module reports its failures.
	} finally {
		clearTimeout(timer);
	}
}

/** Every web app sign-out awaits this before `authClient.signOut()`. */
export async function runStoreAppSignOutTasks(): Promise<void> {
	// Native push (#843) removes this device's token while the session still exists.
	await runBounded(removeNativePushTokenBeforeSignOut);
	for (const task of [...tasks]) await runBounded(task);
}
