import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { compareInstants, instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { isAccountBanned } from "./account-ban";

/** The session row's expiry (a database `Date`) has been reached. */
function hasExpired(expiresAt: Date): boolean {
	return compareInstants(instantFromDate(expiresAt), systemClock.nowInstant()) <= 0;
}

/**
 * Store app sign-in (#842): the shell's web view receives the session that the
 * system browser signed in, as Better Auth's own signed session cookie.
 *
 * The endpoint is server-only: it is never on the HTTP router. Its only caller
 * is `/api/auth/app-exchange` for `mobile`, after the one-time, PKCE-bound app
 * auth code has been consumed. The cookie names the same session row, so the
 * active organization, SSO provenance and revocation stay server-side.
 */
export function storeAppSessionPlugin() {
	return {
		id: "z8-store-app-session",
		endpoints: {
			setStoreAppSessionCookie: createAuthEndpoint.serverOnly(
				{
					method: "POST",
					body: z.object({ sessionToken: z.string().min(1) }),
				},
				async (ctx) => {
					const found = await ctx.context.internalAdapter.findSession(ctx.body.sessionToken);
					if (!found || hasExpired(found.session.expiresAt) || isAccountBanned(found.user)) {
						throw new APIError("UNAUTHORIZED", { message: "Session unavailable" });
					}
					await setSessionCookie(ctx, found);
					return ctx.json({ ok: true });
				},
			),
		},
	} satisfies BetterAuthPlugin;
}
