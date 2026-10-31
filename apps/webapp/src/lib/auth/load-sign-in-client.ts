import type { SignInClient } from "./sign-in-client";

let pending: Promise<SignInClient> | null = null;

/**
 * Loads the sign-in Better Auth client on first use and reuses it afterwards.
 * A failed chunk load is forgotten so the next attempt can retry.
 */
export function loadSignInClient(): Promise<SignInClient> {
	pending ??= import("./sign-in-client")
		.then((mod) => mod.signInClient)
		.catch((error: unknown) => {
			pending = null;
			throw error;
		});
	return pending;
}
