/**
 * Native push registration in the store app shell (#843).
 *
 * In the shell the web app registers for Firebase Cloud Messaging instead of
 * web push. Permission is asked only when the user turns push on (onboarding
 * or notification settings), never on launch. The device token is saved for
 * the signed-in user and remembered on the device, so each app start can
 * re-register it (rotation, last seen) without prompting. Turning push off
 * and signing out remove it again.
 */

import { nativePushPath } from "@/lib/notifications/native-push-message";
import { getStoreAppPlatform, type StoreAppPlatform } from "./shell";

type PluginPermission = "prompt" | "prompt-with-rationale" | "granted" | "denied";
export type NativePushPermission = "default" | "granted" | "denied";

interface ListenerHandle {
	remove(): Promise<void>;
}

/** The part of `@capacitor-firebase/messaging` the web app uses. */
export interface NativePushPlugin {
	checkPermissions(): Promise<{ receive: PluginPermission }>;
	requestPermissions(): Promise<{ receive: PluginPermission }>;
	getToken(): Promise<{ token: string }>;
	deleteToken(): Promise<void>;
	addListener(
		eventName: "tokenReceived",
		listener: (event: { token: string }) => void,
	): Promise<ListenerHandle>;
	addListener(
		eventName: "notificationActionPerformed",
		listener: (event: { notification: { data?: unknown } }) => void,
	): Promise<ListenerHandle>;
}

export interface NativePushStorage {
	get(key: string): string | null;
	set(key: string, value: string): void;
	remove(key: string): void;
}

export interface NativePushState {
	/** The server has FCM credentials. */
	available: boolean;
	permission: NativePushPermission;
	/** This device's token is saved for the user. */
	subscribed: boolean;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const ENDPOINT = "/api/notifications/push/native-token";
const TOKEN_KEY = "z8.nativePush.token";

function toPermission(state: PluginPermission): NativePushPermission {
	if (state === "granted") return "granted";
	if (state === "denied") return "denied";
	return "default";
}

export function createNativePushClient(deps: {
	plugin: NativePushPlugin;
	platform: StoreAppPlatform;
	fetch: FetchLike;
	storage: NativePushStorage;
}) {
	const { plugin, platform, storage } = deps;

	const send = (method: "POST" | "DELETE", body: Record<string, string>) =>
		deps.fetch(ENDPOINT, {
			method,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			credentials: "same-origin",
		});

	async function available(): Promise<boolean> {
		const response = await deps.fetch(ENDPOINT, { credentials: "same-origin" });
		if (!response.ok) return false;
		const body = (await response.json()) as { available?: unknown };
		return body.available === true;
	}

	async function save(token: string): Promise<boolean> {
		const response = await send("POST", { token, platform });
		return response.ok;
	}

	async function forget(token: string): Promise<void> {
		await send("DELETE", { token }).catch(() => undefined);
	}

	/** Save `token` for the user and drop the token it replaces. */
	async function replaceToken(token: string): Promise<void> {
		const previous = storage.get(TOKEN_KEY);
		if (!previous) return;
		if (!(await save(token))) return;
		storage.set(TOKEN_KEY, token);
		if (previous !== token) await forget(previous);
	}

	return {
		async loadState(): Promise<NativePushState> {
			const [isAvailable, permission] = await Promise.all([
				available(),
				plugin.checkPermissions().then((result) => toPermission(result.receive)),
			]);
			return {
				available: isAvailable,
				permission,
				subscribed: isAvailable && permission === "granted" && storage.get(TOKEN_KEY) !== null,
			};
		},

		async requestPermission(): Promise<NativePushPermission> {
			return toPermission((await plugin.requestPermissions()).receive);
		},

		/** Turn push on for this device. Asks for permission if it was never asked. */
		async subscribe(): Promise<boolean> {
			let permission = toPermission((await plugin.checkPermissions()).receive);
			if (permission === "default") {
				permission = toPermission((await plugin.requestPermissions()).receive);
			}
			if (permission !== "granted") return false;

			const { token } = await plugin.getToken();
			if (!(await save(token))) {
				await plugin.deleteToken().catch(() => undefined);
				return false;
			}
			storage.set(TOKEN_KEY, token);
			return true;
		},

		/** Turn push off for this device. */
		async unsubscribe(): Promise<boolean> {
			const token = storage.get(TOKEN_KEY);
			if (token) {
				const response = await send("DELETE", { token });
				if (!response.ok) return false;
			}
			storage.remove(TOKEN_KEY);
			await plugin.deleteToken().catch(() => undefined);
			return true;
		},

		/** On app start: re-register a device that turned push on, never prompting. */
		async refresh(): Promise<void> {
			if (!storage.get(TOKEN_KEY)) return;
			if (!(await available())) return;
			const permission = toPermission((await plugin.checkPermissions()).receive);
			if (permission !== "granted") return;
			const { token } = await plugin.getToken();
			await replaceToken(token);
		},

		/** FCM issued a new token for this device. */
		replaceToken,

		/**
		 * Listen for taps on notifications (with the push's `data`) and for token
		 * rotation. A tap that launched the app is delivered once a listener is
		 * added. Returns a function that removes both listeners.
		 */
		async listen(onTap: (data: unknown) => void): Promise<() => Promise<void>> {
			const handles = await Promise.all([
				plugin.addListener("notificationActionPerformed", (event) => {
					onTap(event.notification?.data);
				}),
				plugin.addListener("tokenReceived", (event) => {
					void replaceToken(event.token).catch(() => undefined);
				}),
			]);
			return async () => {
				await Promise.allSettled(handles.map((handle) => handle.remove()));
			};
		},

		/**
		 * Remove the device token while the session still exists. Best effort:
		 * failures are swallowed. `signOut()` (sign-out.ts) bounds how long
		 * sign-out waits for it.
		 */
		async removeForSignOut(): Promise<void> {
			const token = storage.get(TOKEN_KEY);
			if (!token) return;
			storage.remove(TOKEN_KEY);
			await Promise.allSettled([
				Promise.resolve().then(() => send("DELETE", { token })),
				Promise.resolve().then(() => plugin.deleteToken()),
			]);
		},
	};
}

export type NativePushClient = ReturnType<typeof createNativePushClient>;

/**
 * Where a tapped notification opens. A notification of another (or an
 * unknown) active organization goes through the organization switch at
 * `/init` first, so another organization's data never shows under the wrong
 * one; `/init` asks the user when the switch needs SSO or is not possible.
 */
export function nativePushTapTarget(
	data: unknown,
	activeOrganizationId: string | null | undefined,
): string {
	const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
	const path = nativePushPath(typeof record.path === "string" ? record.path : null);
	const organizationId =
		typeof record.organizationId === "string" && record.organizationId
			? record.organizationId
			: null;
	if (!organizationId || organizationId === activeOrganizationId) return path;
	return `/init?${new URLSearchParams({ organizationId, callbackUrl: path })}`;
}

/** Pages whose news reaches the user by push: requests, approvals, schedules, expenses. */
const PROMPT_MOMENT_SECTIONS = [
	"/approvals",
	"/absences",
	"/my-requests",
	"/scheduling",
	"/travel-expenses",
];

/**
 * Whether the store app may offer push on this (locale-free) page. The shell
 * does not offer push on launch; it waits until the user opens a page whose
 * updates arrive by push, so the question makes sense.
 */
export function isNativePushPromptMoment(pathname: string): boolean {
	return PROMPT_MOMENT_SECTIONS.some(
		(section) => pathname === section || pathname.startsWith(`${section}/`),
	);
}

const browserStorage: NativePushStorage = {
	get(key) {
		try {
			return window.localStorage.getItem(key);
		} catch {
			return null;
		}
	},
	set(key, value) {
		try {
			window.localStorage.setItem(key, value);
		} catch {
			// Without storage the device re-registers only when the user turns push on again.
		}
	},
	remove(key) {
		try {
			window.localStorage.removeItem(key);
		} catch {
			// Nothing stored.
		}
	},
};

let clientPromise: Promise<NativePushClient | null> | null = null;

/**
 * The native push client inside the store app shell with the Firebase
 * messaging plugin, otherwise `null`. Loads `@capacitor/core` only there.
 */
export function getNativePushClient(): Promise<NativePushClient | null> {
	const platform = getStoreAppPlatform();
	if (!platform) return Promise.resolve(null);
	clientPromise ??= import("@capacitor/core").then(({ Capacitor, registerPlugin }) => {
		if (!Capacitor.isPluginAvailable("FirebaseMessaging")) return null;
		return createNativePushClient({
			plugin: registerPlugin<NativePushPlugin>("FirebaseMessaging"),
			platform,
			fetch: (input, init) => fetch(input, init),
			storage: browserStorage,
		});
	});
	return clientPromise;
}

/** Remove this device's push token before signing out; a no-op outside the shell. */
export async function removeNativePushTokenBeforeSignOut(): Promise<void> {
	try {
		const client = await getNativePushClient();
		await client?.removeForSignOut();
	} catch {
		// Never block sign-out on push cleanup.
	}
}
