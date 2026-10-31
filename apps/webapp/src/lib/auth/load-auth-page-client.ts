import type { AuthPageClient } from "./auth-page-client";

let pending: Promise<AuthPageClient> | null = null;

/**
 * Loads the sign-in Better Auth client on first use and reuses it afterwards.
 * A failed chunk load is forgotten so the next attempt can retry.
 */
export function loadAuthPageClient(): Promise<AuthPageClient> {
	pending ??= import("./auth-page-client")
		.then((mod) => mod.authPageClient)
		.catch((error: unknown) => {
			pending = null;
			throw error;
		});
	return pending;
}
