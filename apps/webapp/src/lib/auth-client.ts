"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";
import {
	adminClient,
	inferAdditionalFields,
	inferOrgAdditionalFields,
	organizationClient,
	twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { auth } from "./auth";

// Helper to check if we're on the client side
const isClient = typeof window !== "undefined";

// Create auth client configuration (shared)
const createClientConfig = () => ({
	baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
	plugins: [
		// Infer additional fields from auth config for type safety
		inferAdditionalFields<typeof auth>(),
		adminClient(),
		organizationClient({
			// Infer organization additional fields for type safety
			schema: inferOrgAdditionalFields<typeof auth>(),
		}),
		twoFactorClient(),
		passkeyClient(),
		ssoClient({
			domainVerification: {
				enabled: true,
			},
		}),
	],
});

// Type for our auth client
type AuthClientConfig = ReturnType<typeof createClientConfig>;
type AuthClient = ReturnType<typeof createAuthClient<AuthClientConfig>>;

// Lazy singleton - only created when actually accessed on the client
let _authClient: AuthClient | null = null;

/**
 * Get the auth client instance.
 * This function lazily initializes the client only on the client-side.
 * @throws Error if called on the server side
 */
export function getAuthClient(): AuthClient {
	if (!isClient) {
		throw new Error(
			"getAuthClient() can only be called on the client side. " +
			"For server-side session access, use auth.api.getSession() from @/lib/auth instead."
		);
	}

	if (!_authClient) {
		_authClient = createAuthClient(createClientConfig());
	}

	return _authClient;
}

/**
 * Auth client proxy that lazily initializes the real client.
 * This allows importing authClient without immediately triggering initialization.
 *
 * IMPORTANT: Only use this in client components (files with "use client").
 * For server components, use auth.api.getSession() from @/lib/auth.
 */
export const authClient = new Proxy({} as AuthClient, {
	get(_, prop: keyof AuthClient) {
		return getAuthClient()[prop];
	},
});

/**
 * Hook to get the current session.
 * Must be used in a client component.
 */
export function useSession() {
	return getAuthClient().useSession();
}

// Re-export commonly used methods via getters for convenience
// These will only be evaluated when accessed (lazy)
export const signIn = new Proxy({} as AuthClient["signIn"], {
	get(_, prop) {
		return (getAuthClient().signIn as any)[prop];
	},
});

export const signUp = new Proxy({} as AuthClient["signUp"], {
	get(_, prop) {
		return (getAuthClient().signUp as any)[prop];
	},
});

export const signOut: AuthClient["signOut"] = (...args: any[]) => {
	return (getAuthClient().signOut as any)(...args);
};
