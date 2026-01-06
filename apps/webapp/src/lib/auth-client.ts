"use client";

import { adminClient } from "better-auth/client/plugins/admin";
import { organizationClient } from "better-auth/client/plugins/organization";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
	plugins: [adminClient(), organizationClient()],
});

export const { signIn, signUp, signOut, useSession, updateUser, admin, organization } = authClient;
