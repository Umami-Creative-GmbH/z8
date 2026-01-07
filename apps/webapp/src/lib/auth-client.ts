"use client";

import { adminClient, organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";

export const authClient = createAuthClient({
	baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
	plugins: [
		adminClient(),
		organizationClient(),
		twoFactorClient(),
		passkeyClient(),
	],
});

export const { signIn, signUp, signOut, useSession, updateUser, admin, organization, twoFactor, passkey } = authClient;
