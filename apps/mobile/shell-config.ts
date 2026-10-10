/**
 * Build-time settings of the Z8 store app shell.
 *
 * The shell loads the live web app; it never bundles a copy. Each build points
 * at one origin, read from the environment when `cap sync` runs:
 *
 * - `Z8_APP_ORIGIN`: the web app origin (default: production).
 * - `Z8_APP_ALLOWED_HOSTS`: optional comma-separated extra hosts that stay
 *   inside the app (for example a custom sign-in domain). Every other origin
 *   opens in the system browser.
 *
 * This file must stay erasable TypeScript (no enums, no parameter properties):
 * Capacitor loads `capacitor.config.ts`, and with it this file, through Node's
 * built-in type stripping.
 */
import type { CapacitorConfig } from "@capacitor/cli";

export const DEFAULT_APP_ORIGIN = "https://ui.z8-time.app";

/**
 * Appended to the web view's user agent as `Z8StoreApp/<platform>`. The web
 * app reads it in `apps/webapp/src/lib/store-app/shell.ts`; keep both equal.
 */
export const STORE_APP_USER_AGENT_MARKER = "Z8StoreApp";

/**
 * Local page shown when the web app cannot be loaded (see `www/`). Android
 * serves it at the app origin, so the name must not collide with a web route.
 */
export const OFFLINE_PAGE = "z8-shell-offline.html";

/** iOS honours at most 10 entries in `WKAppBoundDomains`. */
const MAX_APP_BOUND_DOMAINS = 10;

/** Development hosts that may be reached over plain http (Android emulator: 10.0.2.2). */
const LOCAL_DEVELOPMENT_HOSTS = new Set(["localhost", "127.0.0.1", "10.0.2.2"]);

const HOSTNAME =
	/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type ShellEnvironment = Readonly<Record<string, string | undefined>>;

export interface ShellSettings {
	/** Web app origin, without a trailing slash. */
	origin: string;
	/** Hosts besides the origin's own host that stay inside the web view. */
	navigationHosts: string[];
	/** iOS `WKAppBoundDomains`: the origin, the extra hosts and the local error page host. */
	appBoundDomains: string[];
	/** Plain-http development origin (Android needs cleartext allowed). */
	cleartext: boolean;
}

export function resolveShellSettings(env: ShellEnvironment): ShellSettings {
	const origin = parseOrigin(env.Z8_APP_ORIGIN?.trim() || DEFAULT_APP_ORIGIN);
	const originHost = origin.hostname;

	const navigationHosts = parseHosts(env.Z8_APP_ALLOWED_HOSTS).filter(
		(host) => host !== originHost,
	);
	// `localhost` is where Capacitor serves the local offline page on iOS.
	const appBoundDomains = unique([originHost, ...navigationHosts, "localhost"]);

	if (appBoundDomains.length > MAX_APP_BOUND_DOMAINS) {
		throw new Error(
			`iOS allows at most ${MAX_APP_BOUND_DOMAINS} app-bound domains, got ${appBoundDomains.length}: ${appBoundDomains.join(", ")}. Shorten Z8_APP_ALLOWED_HOSTS.`,
		);
	}

	return {
		origin: origin.origin,
		navigationHosts,
		appBoundDomains,
		cleartext: origin.protocol === "http:",
	};
}

export function createCapacitorConfig(settings: ShellSettings): CapacitorConfig {
	return {
		appId: "com.z8.app",
		appName: "Z8",
		webDir: "www",
		server: {
			url: `${settings.origin}/`,
			allowNavigation: settings.navigationHosts,
			cleartext: settings.cleartext,
			errorPath: OFFLINE_PAGE,
		},
		ios: {
			appendUserAgent: `${STORE_APP_USER_AGENT_MARKER}/ios`,
			// Service workers only run in WKWebView for app-bound domains.
			limitsNavigationsToAppBoundDomains: true,
			contentInset: "automatic",
		},
		android: {
			appendUserAgent: `${STORE_APP_USER_AGENT_MARKER}/android`,
			// Service worker requests pass through the bridge, which hands them to the
			// network unchanged and serves the offline page when nothing answers.
			resolveServiceWorkerRequests: true,
		},
		plugins: {
			SplashScreen: {
				launchShowDuration: 1500,
				launchAutoHide: true,
				backgroundColor: "#3860c6",
				showSpinner: false,
			},
			// Native push through FCM (#843). iOS shows pushes while the app is open too.
			FirebaseMessaging: {
				presentationOptions: ["alert", "badge", "sound"],
			},
		},
		experimental: {
			ios: {
				spm: {
					// Avoids a SwiftPM package identity collision of the Firebase plugin
					// (see the plugin README); needs Capacitor CLI 8.4+.
					packageOptions: { "@capacitor-firebase/messaging": { symlink: true } },
				},
			},
		},
	};
}

/**
 * Writes `WKAppBoundDomains` into an iOS Info.plist, replacing an earlier list.
 * The key is the one shell setting Capacitor does not manage itself.
 */
export function withAppBoundDomains(infoPlist: string, domains: readonly string[]): string {
	const newline = infoPlist.includes("\r\n") ? "\r\n" : "\n";
	const lf = infoPlist.replaceAll("\r\n", "\n");
	const entry = [
		"\t<key>WKAppBoundDomains</key>",
		"\t<array>",
		...domains.map((domain) => `\t\t<string>${domain}</string>`),
		"\t</array>",
	].join("\n");

	const existing =
		/\t<key>WKAppBoundDomains<\/key>\n\t<array>\n(?:\t\t<string>[^<]*<\/string>\n)*\t<\/array>/;
	let patched: string;
	if (existing.test(lf)) {
		patched = lf.replace(existing, entry);
	} else {
		const end = lf.lastIndexOf("</dict>");
		if (end === -1) {
			throw new Error("Info.plist has no top-level <dict>.");
		}
		patched = `${lf.slice(0, end)}${entry}\n${lf.slice(end)}`;
	}

	return patched.replaceAll("\n", newline);
}

function parseOrigin(value: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`Z8_APP_ORIGIN is not a URL: ${value}`);
	}

	const isLocalDevelopment = url.protocol === "http:" && LOCAL_DEVELOPMENT_HOSTS.has(url.hostname);
	if (url.protocol !== "https:" && !isLocalDevelopment) {
		throw new Error(
			`Z8_APP_ORIGIN must use https (plain http only for ${[...LOCAL_DEVELOPMENT_HOSTS].join(", ")}): ${value}`,
		);
	}

	return url;
}

function parseHosts(value: string | undefined): string[] {
	if (!value?.trim()) {
		return [];
	}

	const hosts = value
		.split(",")
		.map((host) => host.trim().toLowerCase())
		.filter(Boolean);

	for (const host of hosts) {
		if (!HOSTNAME.test(host)) {
			throw new Error(
				`Z8_APP_ALLOWED_HOSTS takes plain host names without scheme, path or wildcard: ${host}`,
			);
		}
	}

	return unique(hosts);
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}
