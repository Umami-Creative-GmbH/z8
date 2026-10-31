"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Better Auth client for the sign-in page: only the plugins its actions call
 * (email, social, passkey, SSO, TOTP). The app client in `@/lib/auth-client` also
 * carries the admin, API key and organization plugins, which the login form never
 * uses. Load this module with `loadSignInClient()` so it stays out of the page's
 * first-load JavaScript.
 */
export const signInClient = createAuthClient({
	plugins: [twoFactorClient(), passkeyClient(), ssoClient()],
});

export type SignInClient = typeof signInClient;
