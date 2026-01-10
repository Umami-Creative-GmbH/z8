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

export const authClient = createAuthClient({
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

export const {
	signIn,
	signUp,
	signOut,
	useSession,
	updateUser,
	admin,
	organization,
	twoFactor,
	passkey,
	sso,
} = authClient;
