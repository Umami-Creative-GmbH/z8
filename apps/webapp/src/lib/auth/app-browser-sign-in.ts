import { randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { resolvePublicRedirectOrigin } from "@/lib/domain/request-origin";
import type { SupportedApp } from "./app-auth-code";
import { getValidatedAppRedirectUrl } from "./app-redirect";
import { clearBetterAuthSessionCookies, hasBetterAuthSessionCookie } from "./session-cookies";

const privateResponseHeaders = {
	"Cache-Control": "private, no-store",
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
};

/** Next's request origin can be the pod's listening address behind a proxy.
 *
 * `clearStaleSession` expires a leftover session cookie. The store app's
 * system browser keeps the cookie of a session the app has signed out since;
 * with it, the proxy would send `/sign-in` to the dashboard and drop the way
 * back to the app.
 */
export async function createAppSignInRedirect(
	request: NextRequest,
	{ clearStaleSession = false }: { clearStaleSession?: boolean } = {},
) {
	const origin = await resolvePublicRedirectOrigin(request);
	const callbackUrl = new URL(origin);
	callbackUrl.pathname = request.nextUrl.pathname;
	callbackUrl.search = request.nextUrl.search;
	const signInUrl = new URL("/sign-in", origin);
	signInUrl.searchParams.set("callbackUrl", callbackUrl.toString());
	const response = NextResponse.redirect(signInUrl, { headers: privateResponseHeaders });
	if (clearStaleSession && hasBetterAuthSessionCookie(request.headers.get("cookie"))) {
		clearBetterAuthSessionCookies(response);
	}
	return response;
}

type HandoffCopy = Record<
	"en" | "de",
	{ title: string; description: string; action: string; hint: string; close: string }
>;

const desktopHandoffCopy: HandoffCopy = {
	en: {
		title: "Continue to Z8",
		description: "Your sign-in is ready. We are opening the Z8 desktop app.",
		action: "Open Z8",
		hint: "If Z8 does not open automatically, use the button above and allow your browser to open the app.",
		close: "Once Z8 opens, you can close this tab.",
	},
	de: {
		title: "Weiter zu Z8",
		description: "Deine Anmeldung ist bereit. Wir öffnen die Z8 Desktop-App.",
		action: "Z8 öffnen",
		hint: "Falls Z8 nicht automatisch startet, nutze den Button oben und erlaube deinem Browser, die App zu öffnen.",
		close: "Sobald Z8 geöffnet ist, kannst du diesen Tab schließen.",
	},
};

const mobileHandoffCopy: HandoffCopy = {
	en: {
		title: "Continue to Z8",
		description: "Your sign-in is ready. We are opening the Z8 app.",
		action: "Open Z8",
		hint: "If Z8 does not open automatically, use the button above.",
		close: "Once Z8 opens, you can close this page.",
	},
	// Formal "Sie", like the app's own sign-in screen (auth.storeApp.*).
	de: {
		title: "Weiter zu Z8",
		description: "Ihre Anmeldung ist bereit. Wir öffnen die Z8 App.",
		action: "Z8 öffnen",
		hint: "Falls Z8 nicht automatisch startet, nutzen Sie die Schaltfläche oben.",
		close: "Sobald Z8 geöffnet ist, können Sie diese Seite schließen.",
	},
};

const handoffCopyByApp: Record<SupportedApp, HandoffCopy> = {
	desktop: desktopHandoffCopy,
	mobile: mobileHandoffCopy,
};

function escapeHtml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

/** A real page provides an initiating origin and a user-gesture fallback for external protocols.
 * Only the PKCE-bound one-time code enters this isolated, uncached document.
 *
 * The same handoff serves either app. Android's Custom Tabs, like desktop browsers,
 * may block an external launch that no user gesture started; iOS's
 * ASWebAuthenticationSession intercepts the callback before it loads.
 */
export function createAppCallbackResponse(
	request: NextRequest,
	callback: URL,
	app: SupportedApp,
) {
	const safeCallback = getValidatedAppRedirectUrl(callback.toString(), app);
	if (!safeCallback) throw new Error(`Invalid ${app} callback`);
	if (!request.headers.get("accept")?.includes("text/html")) {
		return NextResponse.redirect(safeCallback, {
			headers: privateResponseHeaders,
		});
	}
	const cookieLocale = /(?:^|;\s*)NEXT_LOCALE=(de|en)(?:;|$)/.exec(
		request.headers.get("cookie") ?? "",
	)?.[1];
	const language =
		cookieLocale === "de" ||
		(!cookieLocale &&
			/^de(?:-|;|,|$)/i.test(request.headers.get("accept-language") ?? ""))
			? "de"
			: "en";
	const copy = handoffCopyByApp[app][language];
	const nonce = randomBytes(16).toString("base64");
	const html = `<!DOCTYPE html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#f8fafc" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f172a" media="(prefers-color-scheme: dark)">
<title>${copy.title}</title>
<style nonce="${nonce}">
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; font-family: system-ui, sans-serif; color: #172554; background: #f8fafc; }
main { width: 100%; max-width: 420px; padding: 36px; border: 1px solid #dbe4ef; border-radius: 20px; background: white; }
.brand { font-size: 22px; font-weight: 750; color: #2563eb; letter-spacing: -1px; }
h1 { margin: 24px 0 12px; font-size: 26px; letter-spacing: -.5px; text-wrap: balance; }
p { line-height: 1.6; color: #475569; text-wrap: pretty; }
a { display: block; margin: 28px 0 20px; padding: 14px 20px; border-radius: 10px; background: #2563eb; color: white; text-align: center; text-decoration: none; font-weight: 650; touch-action: manipulation; }
a:hover { background: #1d4ed8; }
a:focus-visible { outline: 3px solid #60a5fa; outline-offset: 4px; }
.hint { font-size: 14px; }
@media (prefers-color-scheme: dark) { body { color: #f1f5f9; background: #0f172a; } main { background: #172033; border-color: #334155; } p { color: #cbd5e1; } .brand { color: #60a5fa; } }
</style>
</head>
<body>
<main>
<div class="brand" translate="no">Z8</div>
<h1>${copy.title}</h1>
<p>${copy.description}</p>
<a id="open-z8" href="${escapeHtml(safeCallback.toString())}">${copy.action}</a>
<p class="hint">${copy.hint}</p>
<p class="hint">${copy.close}</p>
</main>
<script nonce="${nonce}">
const link = document.getElementById("open-z8");
if (link) {
 try { window.location.assign(link.href); }
 catch { /* The visible link remains available if automatic launch is blocked. */ }
}
</script>
</body>
</html>`;
	return new NextResponse(html, {
		status: 200,
		headers: {
			...privateResponseHeaders,
			"Content-Type": "text/html; charset=utf-8",
			"Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
			"X-Frame-Options": "DENY",
			Vary: "Accept, Accept-Language, Cookie",
		},
	});
}
