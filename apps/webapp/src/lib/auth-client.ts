"use client";

import { apiKeyClient } from "@better-auth/api-key/client";
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
// Note: No baseURL - let better-auth use relative URLs which automatically use current browser origin
// This enables custom domain proxying (e.g., https://custom.domain proxies to the app)
const createClientConfig = () => ({
	plugins: [
		// Infer additional fields from auth config for type safety
		inferAdditionalFields<typeof auth>(),
		adminClient(),
		apiKeyClient(),
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

// Shared client is safe to create during pre-render and keeps Better Auth state unified.
const authClientInstance: AuthClient = createAuthClient(createClientConfig());

/**
 * Get the auth client instance.
 * Returns the shared client only on the client-side.
 * Returns null on server side - callers must handle this case.
 */
export function getAuthClient(): AuthClient | null {
	if (!isClient) {
		return null;
	}

	return authClientInstance;
}

/**
 * Get the auth client instance, throwing if called on server.
 * Use this for operations that should never happen during SSR.
 */
function requireAuthClient(): AuthClient {
	const client = getAuthClient();
	if (!client) {
		throw new Error(
			"Auth client operations can only be performed on the client side. " +
				"For server-side session access, use auth.api.getSession() from @/lib/auth instead.",
		);
	}
	return client;
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
		return requireAuthClient()[prop];
	},
});

/**
 * Hook to get the current session.
 * Must be used in a client component.
 * For server components, use auth.api.getSession() from @/lib/auth.
 */
export function useSession() {
	return authClientInstance.useSession();
}

// Re-export commonly used methods via getters for convenience
// These will only be evaluated when accessed (lazy)
// These use requireAuthClient() because they should never be called during SSR
export const signIn = new Proxy({} as AuthClient["signIn"], {
	get(_, prop) {
		return (requireAuthClient().signIn as any)[prop];
	},
});

export const signUp = new Proxy({} as AuthClient["signUp"], {
	get(_, prop) {
		return (requireAuthClient().signUp as any)[prop];
	},
});

export const signOut: AuthClient["signOut"] = (...args: any[]) => {
	return (requireAuthClient().signOut as any)(...args);
};
