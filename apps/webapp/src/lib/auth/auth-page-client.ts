"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";
import { inferAdditionalFields, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { auth } from "../auth";

/**
 * Better Auth client for the signed-out pages (sign-in, sign-up, password reset,
 * email verification, 2FA): only the plugins their actions call. The app client in
 * `@/lib/auth-client` also carries the admin, API key and organization plugins,
 * which these pages never use. Load this module with `loadAuthPageClient()` so it
 * stays out of the pages' first-load JavaScript.
 */
export const authPageClient = createAuthClient({
	plugins: [
		inferAdditionalFields<typeof auth>(),
		twoFactorClient(),
		passkeyClient(),
		ssoClient(),
	],
});

export type AuthPageClient = typeof authPageClient;
