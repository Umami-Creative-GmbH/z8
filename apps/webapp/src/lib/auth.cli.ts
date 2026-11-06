/**
 * Config for the Better Auth CLI only:
 *
 *   pnpm --dir apps/webapp run auth:generate
 *
 * regenerates `src/db/auth-schema.ts` (never hand-written, see
 * docs/refs/better-auth.md). The runtime never imports this file. The runtime
 * config in `auth.ts` pulls in server-only modules, Redis, mail and the
 * database, which the CLI cannot resolve, so this config repeats only what
 * shapes the schema: the shared options from `auth/auth-schema-options.ts` and
 * every plugin that adds tables or fields. Callbacks and secrets are omitted or
 * placeholders; nothing here runs a request or opens a connection.
 *
 * Keep it relative-import only, and add any new schema-bearing plugin of
 * `auth.ts` here too.
 */
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { scim } from "@better-auth/scim";
import { sso } from "@better-auth/sso";
import { betterAuth } from "better-auth/minimal";
import { admin } from "better-auth/plugins/admin";
import { organization } from "better-auth/plugins/organization";
import { twoFactor } from "better-auth/plugins/two-factor";
import * as currentAuthSchema from "../db/auth-schema";
import {
	AUTH_ORGANIZATION_SCHEMA,
	AUTH_SSO_DOMAIN_VERIFICATION,
	AUTH_USER_ADDITIONAL_FIELDS,
} from "./auth/auth-schema-options";
import { API_KEY_PLUGIN_OPTIONS } from "./public-api/keys/plugin-config";

/** The generator only reads the adapter's settings; it never queries. */
const noDatabase = {} as Parameters<typeof drizzleAdapter>[0];

export const auth = betterAuth({
	secret: "cli-only-placeholder-secret-not-used-at-runtime",
	baseURL: "http://localhost:3000",
	database: drizzleAdapter(noDatabase, {
		provider: "pg",
		// The current schema, so the CLI reports exactly what a run changes.
		schema: currentAuthSchema,
		// SCIM refuses an adapter without declared transaction support.
		transaction: true,
	}),
	verification: { storeInDatabase: true },
	user: { additionalFields: AUTH_USER_ADDITIONAL_FIELDS },
	emailAndPassword: { enabled: true },
	session: { storeSessionInDatabase: true },
	plugins: [
		scim({
			connections: [],
			managedConnections: {
				credentialHashSecret: "cli-only-placeholder-scim-secret",
			},
		}),
		admin({ defaultRole: "user", adminRole: "admin" }),
		organization({ schema: AUTH_ORGANIZATION_SCHEMA }),
		twoFactor({ issuer: "Z8" }),
		passkey({ rpName: "Z8", rpID: "localhost" }),
		sso({
			domainVerification: AUTH_SSO_DOMAIN_VERIFICATION,
			organizationProvisioning: { disabled: true },
		}),
		apiKey(API_KEY_PLUGIN_OPTIONS),
	],
});
