import type { StoreAppPlatform } from "./shell";
import type { AuthSessionOutcome, StoreAppSignInDependencies } from "./store-app-sign-in";

/**
 * The system browser's auth session for the store app (#842).
 *
 * - iOS: `ASWebAuthenticationSession` through the shell's own `Z8AuthSession`
 *   plugin (`apps/mobile/ios/App/App/Z8AuthSessionPlugin.swift`). It
 *   intercepts the callback scheme itself, so iOS registers no URL scheme.
 * - Android: Custom Tabs through `@capacitor/browser`; the callback reaches
 *   the app through its intent filter and `@capacitor/app`'s `appUrlOpen`.
 */

type OpenAuthSession = StoreAppSignInDependencies["openAuthSession"];
type ListenerHandle = { remove: () => Promise<void> | void };

export type IosAuthSessionPlugin = {
	start(options: { url: string; callbackScheme: string }): Promise<{ url: string }>;
};

export type AndroidAuthSessionPlugins = {
	browser: {
		open(options: { url: string }): Promise<void>;
		close(): Promise<void>;
		addListener(eventName: "browserFinished", callback: () => void): Promise<ListenerHandle>;
	};
	app: {
		addListener(
			eventName: "appUrlOpen",
			callback: (event: { url: string }) => void,
		): Promise<ListenerHandle>;
	};
};

export function iosAuthSession(plugin: IosAuthSessionPlugin): OpenAuthSession {
	return async (url, callbackScheme) => {
		try {
			const result = await plugin.start({ url, callbackScheme });
			return { status: "completed", callbackUrl: result.url };
		} catch (error) {
			const code = error && typeof error === "object" && "code" in error ? error.code : null;
			return code === "cancelled" ? { status: "cancelled" } : { status: "failed" };
		}
	};
}

/** Android may report the closed tab just before the app link that closed it. */
const CANCEL_GRACE_MS = 1_500;

export function androidAuthSession(plugins: AndroidAuthSessionPlugins): OpenAuthSession {
	return (url, callbackScheme) =>
		new Promise<AuthSessionOutcome>((resolve) => {
			const handles: Promise<ListenerHandle>[] = [];
			let cancelTimer: ReturnType<typeof setTimeout> | undefined;
			let settled = false;
			const finish = (outcome: AuthSessionOutcome) => {
				if (settled) return;
				settled = true;
				clearTimeout(cancelTimer);
				for (const handle of handles) void handle.then((listener) => listener.remove());
				resolve(outcome);
			};

			handles.push(
				plugins.app.addListener("appUrlOpen", (event) => {
					if (!event.url.toLowerCase().startsWith(`${callbackScheme}:`)) return;
					void plugins.browser.close().catch(() => {});
					finish({ status: "completed", callbackUrl: event.url });
				}),
				plugins.browser.addListener("browserFinished", () => {
					cancelTimer = setTimeout(() => finish({ status: "cancelled" }), CANCEL_GRACE_MS);
				}),
			);

			void Promise.all(handles)
				.then(() => plugins.browser.open({ url }))
				.catch(() => finish({ status: "failed" }));
		});
}

/** Loads the native plugins from the shell's Capacitor bridge, only in the shell. */
export async function loadNativeAuthSession(platform: StoreAppPlatform): Promise<OpenAuthSession> {
	const { registerPlugin } = await import("@capacitor/core");
	if (platform === "ios") {
		return iosAuthSession(registerPlugin<IosAuthSessionPlugin>("Z8AuthSession"));
	}
	return androidAuthSession({
		browser: registerPlugin<AndroidAuthSessionPlugins["browser"]>("Browser"),
		app: registerPlugin<AndroidAuthSessionPlugins["app"]>("App"),
	});
}
