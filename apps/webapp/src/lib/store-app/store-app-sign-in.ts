import { getAllowedAppRedirect } from "@/lib/auth/app-redirect";
import { challengeForVerifier, createPkceVerifier } from "./pkce";

/**
 * Store app sign-in (#842), run by the email screen inside the shell's web view.
 *
 * 1. The server picks where to sign in for the email (main origin or the
 *    organization's custom sign-in domain) and returns its app-login URL.
 * 2. The system browser signs in there with that domain's methods and
 *    returns a one-time `mobile` code through the app's callback.
 * 3. The web view exchanges code and verifier at its own origin. The
 *    response sets the session cookie, so pages load signed in.
 *
 * The verifier never leaves this function before the exchange, and the
 * session token never reaches the web view's scripts.
 */

export type AuthSessionOutcome =
	| { status: "completed"; callbackUrl: string }
	| { status: "cancelled" }
	| { status: "failed" };

export type StoreAppSignInResult =
	| { status: "signed-in" }
	| { status: "cancelled" }
	| {
			status: "failed";
			reason: "rate-limited" | "unavailable" | "browser" | "callback" | "exchange";
	  };

export type StoreAppSignInDependencies = {
	fetch: typeof fetch;
	/** Opens the system browser's auth session and waits for the callback. */
	openAuthSession: (url: string, callbackScheme: string) => Promise<AuthSessionOutcome>;
};

const MOBILE_CALLBACK = new URL(getAllowedAppRedirect("mobile"));
const MOBILE_CALLBACK_SCHEME = MOBILE_CALLBACK.protocol.slice(0, -1);

function codeFromCallback(callbackUrl: string): string | null {
	try {
		const url = new URL(callbackUrl);
		if (
			url.protocol !== MOBILE_CALLBACK.protocol ||
			url.host !== MOBILE_CALLBACK.host ||
			url.pathname !== MOBILE_CALLBACK.pathname
		) {
			return null;
		}
		return url.searchParams.get("code") || null;
	} catch {
		return null;
	}
}

function postJson(
	fetcher: typeof fetch,
	url: string,
	body: unknown,
	headers: Record<string, string> = {},
) {
	return fetcher(url, {
		method: "POST",
		credentials: "same-origin",
		cache: "no-store",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
}

export async function signInFromStoreApp(
	email: string,
	{ fetch: fetcher, openAuthSession }: StoreAppSignInDependencies,
): Promise<StoreAppSignInResult> {
	const verifier = createPkceVerifier();
	try {
		const challenge = await challengeForVerifier(verifier);
		const started = await postJson(fetcher, "/api/auth/app-sign-in", { email, challenge });
		if (started.status === 429) return { status: "failed", reason: "rate-limited" };
		if (!started.ok) return { status: "failed", reason: "unavailable" };
		const { authorizeUrl } = (await started.json()) as { authorizeUrl: string };

		const outcome = await openAuthSession(authorizeUrl, MOBILE_CALLBACK_SCHEME);
		if (outcome.status === "cancelled") return { status: "cancelled" };
		if (outcome.status === "failed") return { status: "failed", reason: "browser" };

		const code = codeFromCallback(outcome.callbackUrl);
		if (!code) return { status: "failed", reason: "callback" };

		const exchanged = await postJson(
			fetcher,
			"/api/auth/app-exchange",
			{ code, verifier },
			{ "X-Z8-App-Type": "mobile" },
		);
		if (exchanged.status === 429) return { status: "failed", reason: "rate-limited" };
		if (!exchanged.ok) return { status: "failed", reason: "exchange" };
		return { status: "signed-in" };
	} catch {
		return { status: "failed", reason: "unavailable" };
	}
}
