# SSO + SCIM Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a resumable enterprise identity setup wizard for org owners/admins that configures SSO, optional SCIM, pending access policies, default role templates, and guarded activation.

**Architecture:** Add a Z8-owned `enterprise_identity_setup` table for workflow state, keep Better Auth as the system of record for SSO/SCIM provider behavior, and expose narrowly scoped server actions under enterprise settings. The UI is a new `/settings/enterprise/identity-setup` page with a client stepper that saves progress and never re-displays stored secrets.

**Tech Stack:** Next.js App Router, React client components, `@tanstack/react-form`, Drizzle/Postgres schema, Better Auth SSO + SCIM APIs, Luxon for timestamps, Vitest, existing shadcn-style UI components.

---

## File Structure

- Create `apps/webapp/src/db/schema/enterprise-identity-setup.ts`: Drizzle table, enums, and TypeScript state types for the wizard workflow.
- Modify `apps/webapp/src/db/schema/index.ts`: export the new schema file.
- Modify `apps/webapp/src/db/schema/relations.ts`: add relation from setup state to organization and default role template.
- Create `apps/webapp/src/lib/enterprise-identity/provider-presets.ts`: static Okta, Microsoft Entra ID, Google Workspace, and generic provider presets.
- Create `apps/webapp/src/lib/enterprise-identity/setup-state.ts`: pure helpers for defaults, safe serialization, completion/readiness, and Better Auth error mapping.
- Create `apps/webapp/src/lib/enterprise-identity/setup-state.test.ts`: unit tests for pure helpers.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.ts`: add setup-state, SSO, SCIM, role-template, and activation server actions.
- Create `apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts`: source-level and pure-behavior tests for the new action contracts and guardrails.
- Create `apps/webapp/src/app/[locale]/(app)/settings/enterprise/identity-setup/page.tsx`: server page that enforces org-admin settings access and loads initial wizard data.
- Create `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.tsx`: client stepper container and per-step rendering.
- Create `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.test.tsx`: component/source tests for step labels, guarded activation, token show-once copy, and mobile-safe classes.
- Modify `apps/webapp/src/components/settings/enterprise/domains-branding-tabs.tsx`: add a guided setup call-to-action near SSO provider management.
- Modify `apps/webapp/src/components/settings/settings-config.ts`: add an Enterprise Identity settings card.
- Modify `apps/webapp/src/lib/settings-access.ts`: include `/settings/enterprise/identity-setup` in org-admin-only routes.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`: add route/access regression coverage.
- Modify `apps/docs/content/docs/guide/admin-guide/scim-provisioning.mdx`: replace “no self-serve setup page” copy with the new wizard behavior.

---

### Task 1: Setup State Schema And Pure Helpers

**Files:**
- Create: `apps/webapp/src/db/schema/enterprise-identity-setup.ts`
- Modify: `apps/webapp/src/db/schema/index.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Create: `apps/webapp/src/lib/enterprise-identity/provider-presets.ts`
- Create: `apps/webapp/src/lib/enterprise-identity/setup-state.ts`
- Create: `apps/webapp/src/lib/enterprise-identity/setup-state.test.ts`

- [ ] **Step 1: Write failing pure-helper tests**

Create `apps/webapp/src/lib/enterprise-identity/setup-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	ENTERPRISE_IDENTITY_PROVIDER_PRESETS,
	getEnterpriseIdentityPreset,
} from "./provider-presets";
import {
	createDefaultEnterpriseIdentitySetupState,
	getEnterpriseIdentityReadiness,
	mapBetterAuthIdentityError,
} from "./setup-state";

describe("enterprise identity setup helpers", () => {
	it("defines the supported provider presets", () => {
		expect(Object.keys(ENTERPRISE_IDENTITY_PROVIDER_PRESETS)).toEqual([
			"okta",
			"microsoft-entra",
			"google-workspace",
			"generic",
		]);
		expect(getEnterpriseIdentityPreset("okta")?.supportedProtocols).toContain("oidc");
		expect(getEnterpriseIdentityPreset("generic")?.supportedProtocols).toEqual(["oidc", "saml"]);
	});

	it("creates conservative default setup state", () => {
		const state = createDefaultEnterpriseIdentitySetupState({ organizationId: "org_1" });

		expect(state.organizationId).toBe("org_1");
		expect(state.currentStep).toBe("provider");
		expect(state.enforcement.ssoRequired).toBe(false);
		expect(state.enforcement.domainRestrictionEnabled).toBe(false);
		expect(state.enforcement.inviteRestrictionEnabled).toBe(false);
		expect(state.scim.enabled).toBe(false);
	});

	it("requires verified domain and passing SSO test before activation readiness", () => {
		const state = createDefaultEnterpriseIdentitySetupState({ organizationId: "org_1" });

		expect(getEnterpriseIdentityReadiness(state)).toMatchObject({
			canActivate: false,
			missing: ["provider", "domain", "ssoTest"],
		});

		const ready = getEnterpriseIdentityReadiness({
			...state,
			provider: { preset: "okta", protocol: "oidc", providerId: "acme-okta" },
			domain: { domain: "acme.test", verified: true },
			ssoTest: {
				status: "passed",
				testEmail: "admin@acme.test",
				providerId: "acme-okta",
				checkedAt: "2026-05-03T10:00:00.000Z",
				error: null,
			},
		});

		expect(ready).toEqual({ canActivate: true, missing: [] });
	});

	it("maps Better Auth setup errors to actionable copy", () => {
		expect(mapBetterAuthIdentityError({ code: "discovery_untrusted_origin" })).toBe(
			"The identity provider origin is not trusted by the auth server. Check the issuer URL and trusted origin configuration.",
		);
		expect(mapBetterAuthIdentityError({ code: "unsupported_token_auth_method" })).toBe(
			"The identity provider only advertises an unsupported token authentication method. Use client_secret_basic or client_secret_post.",
		);
		expect(mapBetterAuthIdentityError(new Error("metadata failed"))).toBe("metadata failed");
	});
});
```

- [ ] **Step 2: Run helper test to verify it fails**

Run from `/home/kai/projects/z8/apps/webapp`:

```bash
pnpm test src/lib/enterprise-identity/setup-state.test.ts
```

Expected: FAIL because `provider-presets.ts` and `setup-state.ts` do not exist.

- [ ] **Step 3: Add provider presets**

Create `apps/webapp/src/lib/enterprise-identity/provider-presets.ts`:

```ts
export type EnterpriseIdentityProviderPresetId =
	| "okta"
	| "microsoft-entra"
	| "google-workspace"
	| "generic";

export type EnterpriseIdentityProtocol = "oidc" | "saml";

export interface EnterpriseIdentityProviderPreset {
	id: EnterpriseIdentityProviderPresetId;
	name: string;
	description: string;
	supportedProtocols: EnterpriseIdentityProtocol[];
	defaultProtocol: EnterpriseIdentityProtocol;
	issuerPlaceholder: string;
	domainHelp: string;
	setupHints: string[];
	defaultOidcScopes: string[];
}

export const ENTERPRISE_IDENTITY_PROVIDER_PRESETS: Record<
	EnterpriseIdentityProviderPresetId,
	EnterpriseIdentityProviderPreset
> = {
	okta: {
		id: "okta",
		name: "Okta",
		description: "Use Okta Workforce Identity for SAML or OIDC single sign-on.",
		supportedProtocols: ["oidc", "saml"],
		defaultProtocol: "oidc",
		issuerPlaceholder: "https://acme.okta.com",
		domainHelp: "Use the corporate email domain assigned to this Okta tenant.",
		setupHints: [
			"Create an OIDC or SAML app integration in Okta.",
			"Copy the callback or ACS URL from Z8 into Okta.",
			"Assign a small pilot group before enabling enforcement.",
		],
		defaultOidcScopes: ["openid", "email", "profile"],
	},
	"microsoft-entra": {
		id: "microsoft-entra",
		name: "Microsoft Entra ID",
		description: "Use Microsoft Entra ID for enterprise SSO and optional provisioning.",
		supportedProtocols: ["oidc", "saml"],
		defaultProtocol: "oidc",
		issuerPlaceholder: "https://login.microsoftonline.com/{tenant-id}/v2.0",
		domainHelp: "Use the verified email domain for the Entra tenant.",
		setupHints: [
			"Register an enterprise application in Entra ID.",
			"Use the Z8 redirect URI for the selected protocol.",
			"Grant admin consent before running the SSO test.",
		],
		defaultOidcScopes: ["openid", "email", "profile"],
	},
	"google-workspace": {
		id: "google-workspace",
		name: "Google Workspace",
		description: "Use Google Workspace OIDC for SSO and optional directory sync.",
		supportedProtocols: ["oidc"],
		defaultProtocol: "oidc",
		issuerPlaceholder: "https://accounts.google.com",
		domainHelp: "Use the primary Google Workspace email domain.",
		setupHints: [
			"Create an OAuth client in Google Cloud Console.",
			"Add the Z8 redirect URI to authorized redirect URIs.",
			"Limit rollout to the verified Workspace domain first.",
		],
		defaultOidcScopes: ["openid", "email", "profile"],
	},
	generic: {
		id: "generic",
		name: "Generic SAML/OIDC",
		description: "Use any standards-compliant OIDC or SAML 2.0 identity provider.",
		supportedProtocols: ["oidc", "saml"],
		defaultProtocol: "oidc",
		issuerPlaceholder: "https://idp.example.com",
		domainHelp: "Use the corporate email domain controlled by this identity provider.",
		setupHints: [
			"Confirm the provider supports OIDC authorization code flow or SAML 2.0.",
			"Use SHA-256 or stronger signing algorithms.",
			"Test with one admin account before activating enforcement.",
		],
		defaultOidcScopes: ["openid", "email", "profile"],
	},
};

export function getEnterpriseIdentityPreset(id: string | null | undefined) {
	if (!id) return null;
	return ENTERPRISE_IDENTITY_PROVIDER_PRESETS[id as EnterpriseIdentityProviderPresetId] ?? null;
}
```

- [ ] **Step 4: Add setup-state helper implementation**

Create `apps/webapp/src/lib/enterprise-identity/setup-state.ts`:

```ts
import { DateTime } from "luxon";
import type {
	EnterpriseIdentityProtocol,
	EnterpriseIdentityProviderPresetId,
} from "./provider-presets";

export type EnterpriseIdentitySetupStep =
	| "provider"
	| "domain"
	| "sso"
	| "test-user"
	| "scim"
	| "access-policy"
	| "review";

export interface EnterpriseIdentitySetupState {
	organizationId: string;
	currentStep: EnterpriseIdentitySetupStep;
	provider: {
		preset: EnterpriseIdentityProviderPresetId | null;
		protocol: EnterpriseIdentityProtocol | null;
		providerId: string | null;
	};
	domain: {
		domain: string | null;
		verified: boolean;
	};
	ssoTest: {
		status: "not_tested" | "passed" | "failed";
		testEmail: string | null;
		providerId: string | null;
		checkedAt: string | null;
		error: string | null;
	};
	scim: {
		enabled: boolean;
		providerId: string | null;
		tokenGeneratedAt: string | null;
		lastObservedEventAt: string | null;
		autoActivateUsers: boolean;
		deprovisionAction: "soft_delete" | "suspend";
	};
	enforcement: {
		ssoRequired: boolean;
		domainRestrictionEnabled: boolean;
		inviteRestrictionEnabled: boolean;
		defaultRoleTemplateId: string | null;
	};
	activatedAt: string | null;
}

export function createDefaultEnterpriseIdentitySetupState({
	organizationId,
}: {
	organizationId: string;
}): EnterpriseIdentitySetupState {
	return {
		organizationId,
		currentStep: "provider",
		provider: { preset: null, protocol: null, providerId: null },
		domain: { domain: null, verified: false },
		ssoTest: {
			status: "not_tested",
			testEmail: null,
			providerId: null,
			checkedAt: null,
			error: null,
		},
		scim: {
			enabled: false,
			providerId: null,
			tokenGeneratedAt: null,
			lastObservedEventAt: null,
			autoActivateUsers: false,
			deprovisionAction: "suspend",
		},
		enforcement: {
			ssoRequired: false,
			domainRestrictionEnabled: false,
			inviteRestrictionEnabled: false,
			defaultRoleTemplateId: null,
		},
		activatedAt: null,
	};
}

export function getEnterpriseIdentityReadiness(state: EnterpriseIdentitySetupState) {
	const missing: Array<"provider" | "domain" | "ssoTest"> = [];

	if (!state.provider.providerId || !state.provider.preset || !state.provider.protocol) {
		missing.push("provider");
	}

	if (!state.domain.domain || !state.domain.verified) {
		missing.push("domain");
	}

	if (state.ssoTest.status !== "passed") {
		missing.push("ssoTest");
	}

	return { canActivate: missing.length === 0, missing };
}

export function markSsoTestPassed(
	state: EnterpriseIdentitySetupState,
	params: { testEmail: string; providerId: string },
): EnterpriseIdentitySetupState {
	return {
		...state,
		ssoTest: {
			status: "passed",
			testEmail: params.testEmail,
			providerId: params.providerId,
			checkedAt: DateTime.utc().toISO(),
			error: null,
		},
	};
}

export function mapBetterAuthIdentityError(error: unknown): string {
	const code =
		error && typeof error === "object" && "code" in error
			? String((error as { code?: unknown }).code)
			: null;

	if (code === "issuer_mismatch") {
		return "The identity provider discovery document reports a different issuer than the URL entered in Z8.";
	}
	if (code === "discovery_incomplete") {
		return "The identity provider discovery document is missing required authorization, token, or JWKS endpoints.";
	}
	if (code === "discovery_untrusted_origin") {
		return "The identity provider origin is not trusted by the auth server. Check the issuer URL and trusted origin configuration.";
	}
	if (code === "discovery_timeout") {
		return "The identity provider discovery endpoint did not respond in time. Retry after checking IdP availability.";
	}
	if (code === "unsupported_token_auth_method") {
		return "The identity provider only advertises an unsupported token authentication method. Use client_secret_basic or client_secret_post.";
	}
	if (code === "discovery_invalid_json") {
		return "The identity provider discovery endpoint did not return valid JSON.";
	}

	if (error instanceof Error && error.message) return error.message;
	return "Enterprise identity setup failed. Check the provider settings and retry.";
}
```

- [ ] **Step 5: Add schema table and exports**

Create `apps/webapp/src/db/schema/enterprise-identity-setup.ts`:

```ts
import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { organization, user } from "../auth-schema";
import { roleTemplate } from "./identity";

export const enterpriseIdentityPresetEnum = pgEnum("enterprise_identity_preset", [
	"okta",
	"microsoft-entra",
	"google-workspace",
	"generic",
]);

export const enterpriseIdentityProtocolEnum = pgEnum("enterprise_identity_protocol", ["oidc", "saml"]);

export const enterpriseIdentitySetupStepEnum = pgEnum("enterprise_identity_setup_step", [
	"provider",
	"domain",
	"sso",
	"test-user",
	"scim",
	"access-policy",
	"review",
]);

export const enterpriseIdentitySetup = pgTable(
	"enterprise_identity_setup",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" })
			.unique(),
		currentStep: enterpriseIdentitySetupStepEnum("current_step").default("provider").notNull(),
		providerPreset: enterpriseIdentityPresetEnum("provider_preset"),
		protocol: enterpriseIdentityProtocolEnum("protocol"),
		providerId: text("provider_id"),
		domain: text("domain"),
		domainVerified: boolean("domain_verified").default(false).notNull(),
		ssoTestStatus: text("sso_test_status")
			.$type<"not_tested" | "passed" | "failed">()
			.default("not_tested")
			.notNull(),
		ssoTestEmail: text("sso_test_email"),
		ssoTestedAt: timestamp("sso_tested_at"),
		ssoTestError: text("sso_test_error"),
		scimEnabled: boolean("scim_enabled").default(false).notNull(),
		scimProviderId: text("scim_provider_id"),
		scimTokenGeneratedAt: timestamp("scim_token_generated_at"),
		scimLastObservedEventAt: timestamp("scim_last_observed_event_at"),
		scimAutoActivateUsers: boolean("scim_auto_activate_users").default(false).notNull(),
		scimDeprovisionAction: text("scim_deprovision_action")
			.$type<"soft_delete" | "suspend">()
			.default("suspend")
			.notNull(),
		defaultRoleTemplateId: uuid("default_role_template_id").references(() => roleTemplate.id, {
			onDelete: "set null",
		}),
		pendingEnforcement: jsonb("pending_enforcement")
			.$type<{
				ssoRequired: boolean;
				domainRestrictionEnabled: boolean;
				inviteRestrictionEnabled: boolean;
			}>()
			.default({
				ssoRequired: false,
				domainRestrictionEnabled: false,
				inviteRestrictionEnabled: false,
			})
			.notNull(),
		activatedAt: timestamp("activated_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("enterpriseIdentitySetup_organizationId_idx").on(table.organizationId),
		index("enterpriseIdentitySetup_providerId_idx").on(table.providerId),
		index("enterpriseIdentitySetup_activatedAt_idx").on(table.activatedAt),
	],
);
```

Modify `apps/webapp/src/db/schema/index.ts` by adding this export next to `enterprise`:

```ts
export * from "./enterprise";
export * from "./enterprise-identity-setup";
```

Modify `apps/webapp/src/db/schema/relations.ts` by importing `enterpriseIdentitySetup` and adding relations near other enterprise relations:

```ts
export const enterpriseIdentitySetupRelations = relations(enterpriseIdentitySetup, ({ one }) => ({
	organization: one(organization, {
		fields: [enterpriseIdentitySetup.organizationId],
		references: [organization.id],
	}),
	defaultRoleTemplate: one(roleTemplate, {
		fields: [enterpriseIdentitySetup.defaultRoleTemplateId],
		references: [roleTemplate.id],
	}),
}));
```

If `relations.ts` already imports `organization` or `roleTemplate`, reuse the existing imports instead of duplicating them.

- [ ] **Step 6: Run helper test to verify it passes**

Run from `/home/kai/projects/z8/apps/webapp`:

```bash
pnpm test src/lib/enterprise-identity/setup-state.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit schema and helper work**

```bash
git add src/db/schema/enterprise-identity-setup.ts src/db/schema/index.ts src/db/schema/relations.ts src/lib/enterprise-identity/provider-presets.ts src/lib/enterprise-identity/setup-state.ts src/lib/enterprise-identity/setup-state.test.ts
git commit -m "feat: add enterprise identity setup state"
```

---

### Task 2: Server Actions For Setup State, SSO, SCIM, And Activation

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts`

- [ ] **Step 1: Write failing action contract tests**

Create `apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const actionsPath = join(process.cwd(), "src/app/[locale]/(app)/settings/enterprise/actions.ts");

function source() {
	return readFileSync(actionsPath, "utf8");
}

describe("enterprise identity setup actions", () => {
	it("exports the setup wizard server action contract", () => {
		const text = source();

		expect(text).toContain("export async function getEnterpriseIdentitySetupAction()");
		expect(text).toContain("export async function updateEnterpriseIdentityProviderAction");
		expect(text).toContain("export async function registerEnterpriseIdentitySSOProviderAction");
		expect(text).toContain("export async function recordEnterpriseIdentitySsoTestAction");
		expect(text).toContain("export async function generateEnterpriseIdentityScimTokenAction");
		expect(text).toContain("export async function updateEnterpriseIdentityAccessPolicyAction");
		expect(text).toContain("export async function activateEnterpriseIdentitySetupAction()");
	});

	it("keeps setup actions organization scoped and owner/admin gated", () => {
		const text = source();

		expect(text).toContain("requireEnterpriseOrgAdmin()");
		expect(text).toContain("organizationId");
		expect(text).toContain("enterpriseIdentitySetup.organizationId");
		expect(text).toContain("canManageCurrentOrganizationSettings(");
		expect(text).not.toContain('authContext.employee?.role !== "admin"');
	});

	it("uses Better Auth for SSO and SCIM without exposing stored secrets", () => {
		const text = source();

		expect(text).toContain("registerSSOProvider");
		expect(text).toContain("generateSCIMToken");
		expect(text).toContain("listSCIMProviderConnections");
		expect(text).toContain("mapBetterAuthIdentityError");
		expect(text).toContain("hasOidcConfig");
	});
});
```

- [ ] **Step 2: Run action contract tests to verify they fail**

Run from `/home/kai/projects/z8/apps/webapp`:

```bash
pnpm test 'src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts'
```

Expected: FAIL because the new action names are not exported.

- [ ] **Step 3: Add action imports and response types**

Modify `apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.ts` imports:

```ts
import { and, desc, eq, or } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { enterpriseIdentitySetup, roleTemplate, scimProviderConfig, scimProvisioningLog } from "@/db/schema";
import type {
	EnterpriseIdentityProtocol,
	EnterpriseIdentityProviderPresetId,
} from "@/lib/enterprise-identity/provider-presets";
import {
	createDefaultEnterpriseIdentitySetupState,
	getEnterpriseIdentityReadiness,
	mapBetterAuthIdentityError,
	type EnterpriseIdentitySetupState,
	type EnterpriseIdentitySetupStep,
} from "@/lib/enterprise-identity/setup-state";
```

If `and`, `eq`, `db`, or `DateTime` are already imported in this file after concurrent edits, merge the imports.

Add these types near the SSO response types:

```ts
export interface EnterpriseIdentitySetupResponse {
	state: EnterpriseIdentitySetupState;
	roleTemplates: Array<{ id: string; name: string; description: string | null; isGlobal: boolean }>;
	scimConnection: { providerId: string; createdAt: Date | null } | null;
}

export interface EnterpriseIdentityProviderInput {
	preset: EnterpriseIdentityProviderPresetId;
	protocol: EnterpriseIdentityProtocol;
	providerId: string;
	domain: string;
	currentStep?: EnterpriseIdentitySetupStep;
}

export type EnterpriseIdentitySSOInput =
	| {
			protocol: "oidc";
			providerId: string;
			issuer: string;
			domain: string;
			clientId: string;
			clientSecret: string;
	  }
	| {
			protocol: "saml";
			providerId: string;
			issuer: string;
			domain: string;
			metadata: string;
	  };
```

- [ ] **Step 4: Add setup-state serialization helpers**

Add below `normalizeSSOProvider`:

```ts
function toIsoFromDate(value: Date | string | null | undefined): string | null {
	if (!value) return null;
	if (value instanceof Date) return DateTime.fromJSDate(value).toUTC().toISO();
	const parsed = DateTime.fromISO(value, { zone: "utc" });
	return parsed.isValid ? parsed.toISO() : null;
}

function normalizeEnterpriseIdentitySetupRecord(
	record: typeof enterpriseIdentitySetup.$inferSelect,
): EnterpriseIdentitySetupState {
	const defaults = createDefaultEnterpriseIdentitySetupState({ organizationId: record.organizationId });
	return {
		...defaults,
		currentStep: record.currentStep,
		provider: {
			preset: record.providerPreset,
			protocol: record.protocol,
			providerId: record.providerId,
		},
		domain: {
			domain: record.domain,
			verified: record.domainVerified,
		},
		ssoTest: {
			status: record.ssoTestStatus,
			testEmail: record.ssoTestEmail,
			providerId: record.providerId,
			checkedAt: toIsoFromDate(record.ssoTestedAt),
			error: record.ssoTestError,
		},
		scim: {
			enabled: record.scimEnabled,
			providerId: record.scimProviderId,
			tokenGeneratedAt: toIsoFromDate(record.scimTokenGeneratedAt),
			lastObservedEventAt: toIsoFromDate(record.scimLastObservedEventAt),
			autoActivateUsers: record.scimAutoActivateUsers,
			deprovisionAction: record.scimDeprovisionAction,
		},
		enforcement: {
			ssoRequired: record.pendingEnforcement.ssoRequired,
			domainRestrictionEnabled: record.pendingEnforcement.domainRestrictionEnabled,
			inviteRestrictionEnabled: record.pendingEnforcement.inviteRestrictionEnabled,
			defaultRoleTemplateId: record.defaultRoleTemplateId,
		},
		activatedAt: toIsoFromDate(record.activatedAt),
	};
}

async function getOrCreateEnterpriseIdentitySetupRecord(organizationId: string, userId: string) {
	const existing = await db.query.enterpriseIdentitySetup.findFirst({
		where: eq(enterpriseIdentitySetup.organizationId, organizationId),
	});
	if (existing) return existing;

	const [created] = await db
		.insert(enterpriseIdentitySetup)
		.values({ organizationId, createdBy: userId, updatedBy: userId })
		.returning();
	return created;
}
```

- [ ] **Step 5: Add read/update/provider actions**

Append this section before Branding Actions:

```ts
// ============ Enterprise Identity Setup Actions ============

export async function getEnterpriseIdentitySetupAction(): Promise<EnterpriseIdentitySetupResponse> {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	const record = await getOrCreateEnterpriseIdentitySetupRecord(organizationId, authContext.user.id);

	const [templates, scimConnectionResult] = await Promise.all([
		db.query.roleTemplate.findMany({
			where: and(
				eq(roleTemplate.isActive, true),
				or(eq(roleTemplate.organizationId, organizationId), eq(roleTemplate.isGlobal, true)),
			),
			columns: { id: true, name: true, description: true, isGlobal: true },
		}),
		(auth.api as any)
			.listSCIMProviderConnections({ headers: await headers() })
			.catch(() => null),
	]);

	const connections = Array.isArray(scimConnectionResult)
		? scimConnectionResult
		: Array.isArray(scimConnectionResult?.connections)
			? scimConnectionResult.connections
			: [];

	const scimConnection = connections.find(
		(connection: { providerId?: string; organizationId?: string }) =>
			connection.organizationId === organizationId && connection.providerId === record.scimProviderId,
	);

	return {
		state: normalizeEnterpriseIdentitySetupRecord(record),
		roleTemplates: templates,
		scimConnection: scimConnection
			? {
					providerId: scimConnection.providerId,
					createdAt: scimConnection.createdAt ? new Date(scimConnection.createdAt) : null,
				}
			: null,
	};
}

export async function updateEnterpriseIdentityProviderAction(input: EnterpriseIdentityProviderInput) {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	const providerId = input.providerId.trim().toLowerCase();
	const domain = input.domain.trim().toLowerCase();

	if (!providerId || !domain) {
		throw new Error("Provider ID and domain are required");
	}

	const record = await getOrCreateEnterpriseIdentitySetupRecord(organizationId, authContext.user.id);
	const [updated] = await db
		.update(enterpriseIdentitySetup)
		.set({
			providerPreset: input.preset,
			protocol: input.protocol,
			providerId,
			domain,
			currentStep: input.currentStep ?? record.currentStep,
			updatedBy: authContext.user.id,
		})
		.where(eq(enterpriseIdentitySetup.organizationId, organizationId))
		.returning();

	revalidatePath("/settings/enterprise/identity-setup");
	return normalizeEnterpriseIdentitySetupRecord(updated);
}
```

- [ ] **Step 6: Add SSO registration and test recording actions**

Append after the provider action:

```ts
export async function registerEnterpriseIdentitySSOProviderAction(input: EnterpriseIdentitySSOInput) {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	const providerId = input.providerId.trim().toLowerCase();
	const issuer = input.issuer.trim();
	const domain = input.domain.trim().toLowerCase();

	if (!providerId || !issuer || !domain) {
		throw new Error("Provider ID, issuer, and domain are required");
	}

	try {
		let rawProvider: RawSSOProvider;
		if (input.protocol === "oidc") {
			if (!input.clientId.trim() || !input.clientSecret.trim()) {
				throw new Error("Client ID and client secret are required for OIDC");
			}
			await storeOrgSecret(organizationId, `sso/${providerId}/client_secret`, input.clientSecret.trim());
			rawProvider = (await (auth.api as any).registerSSOProvider({
				body: {
					providerId,
					issuer,
					domain,
					organizationId,
					oidcConfig: {
						clientId: input.clientId.trim(),
						clientSecret: input.clientSecret.trim(),
						scopes: ["openid", "email", "profile"],
					},
				},
				headers: await headers(),
			})) as RawSSOProvider;
		} else {
			if (!input.metadata.trim()) {
				throw new Error("SAML metadata is required");
			}
			rawProvider = (await (auth.api as any).registerSSOProvider({
				body: {
					providerId,
					issuer,
					domain,
					organizationId,
					samlConfig: { idpMetadata: { metadata: input.metadata.trim() } },
				},
				headers: await headers(),
			})) as RawSSOProvider;
		}

		await db
			.update(enterpriseIdentitySetup)
			.set({
				providerId,
				domain,
				protocol: input.protocol,
				currentStep: "test-user",
				updatedBy: authContext.user.id,
			})
			.where(eq(enterpriseIdentitySetup.organizationId, organizationId));

		revalidatePath("/settings/enterprise/identity-setup");
		return normalizeSSOProvider(rawProvider);
	} catch (error) {
		if (input.protocol === "oidc") {
			await deleteOrgSecret(organizationId, `sso/${providerId}/client_secret`).catch(() => undefined);
		}
		throw new Error(mapBetterAuthIdentityError(error));
	}
}

export async function recordEnterpriseIdentitySsoTestAction(input: {
	providerId: string;
	testEmail: string;
	status: "passed" | "failed";
	error?: string | null;
}) {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	const providerId = input.providerId.trim().toLowerCase();
	const testEmail = input.testEmail.trim().toLowerCase();

	if (!providerId || !testEmail) {
		throw new Error("Provider ID and test email are required");
	}

	const [updated] = await db
		.update(enterpriseIdentitySetup)
		.set({
			ssoTestStatus: input.status,
			ssoTestEmail: testEmail,
			ssoTestedAt: new Date(),
			ssoTestError: input.status === "failed" ? input.error || "SSO test failed" : null,
			currentStep: input.status === "passed" ? "scim" : "test-user",
			updatedBy: authContext.user.id,
		})
		.where(and(eq(enterpriseIdentitySetup.organizationId, organizationId), eq(enterpriseIdentitySetup.providerId, providerId)))
		.returning();

	if (!updated) throw new Error("Enterprise identity setup not found for provider");
	revalidatePath("/settings/enterprise/identity-setup");
	return normalizeEnterpriseIdentitySetupRecord(updated);
}
```

- [ ] **Step 7: Add SCIM and access policy actions**

Append after the SSO test action:

```ts
export async function generateEnterpriseIdentityScimTokenAction(input: {
	providerId: string;
	autoActivateUsers: boolean;
	deprovisionAction: "soft_delete" | "suspend";
	defaultRoleTemplateId?: string | null;
}) {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	const providerId = input.providerId.trim().toLowerCase();
	if (!providerId) throw new Error("Provider ID is required");

	const result = await (auth.api as any).generateSCIMToken({
		body: { providerId, organizationId },
		headers: await headers(),
	});

	await db
		.insert(scimProviderConfig)
		.values({
			organizationId,
			providerId,
			autoActivateUsers: input.autoActivateUsers,
			deprovisionAction: input.deprovisionAction,
			defaultRoleTemplateId: input.defaultRoleTemplateId || null,
			createdBy: authContext.user.id,
			updatedBy: authContext.user.id,
		})
		.onConflictDoUpdate({
			target: scimProviderConfig.organizationId,
			set: {
				providerId,
				autoActivateUsers: input.autoActivateUsers,
				deprovisionAction: input.deprovisionAction,
				defaultRoleTemplateId: input.defaultRoleTemplateId || null,
				updatedBy: authContext.user.id,
			},
		});

	await db
		.update(enterpriseIdentitySetup)
		.set({
			scimEnabled: true,
			scimProviderId: providerId,
			scimTokenGeneratedAt: new Date(),
			scimAutoActivateUsers: input.autoActivateUsers,
			scimDeprovisionAction: input.deprovisionAction,
			defaultRoleTemplateId: input.defaultRoleTemplateId || null,
			currentStep: "access-policy",
			updatedBy: authContext.user.id,
		})
		.where(eq(enterpriseIdentitySetup.organizationId, organizationId));

	revalidatePath("/settings/enterprise/identity-setup");
	return {
		providerId,
		scimToken: result?.scimToken ?? result?.token ?? null,
		baseUrl: "/api/auth/scim/v2",
	};
}

export async function refreshEnterpriseIdentityScimStatusAction() {
	const { organizationId } = await requireEnterpriseOrgAdmin();
	const latestEvent = await db.query.scimProvisioningLog.findFirst({
		where: eq(scimProvisioningLog.organizationId, organizationId),
		orderBy: desc(scimProvisioningLog.createdAt),
		columns: { createdAt: true },
	});

	if (latestEvent) {
		await db
			.update(enterpriseIdentitySetup)
			.set({ scimLastObservedEventAt: latestEvent.createdAt })
			.where(eq(enterpriseIdentitySetup.organizationId, organizationId));
	}

	revalidatePath("/settings/enterprise/identity-setup");
	return { lastObservedEventAt: latestEvent?.createdAt ?? null };
}

export async function updateEnterpriseIdentityAccessPolicyAction(input: {
	ssoRequired: boolean;
	domainRestrictionEnabled: boolean;
	inviteRestrictionEnabled: boolean;
	defaultRoleTemplateId?: string | null;
}) {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	const [updated] = await db
		.update(enterpriseIdentitySetup)
		.set({
			pendingEnforcement: {
				ssoRequired: input.ssoRequired,
				domainRestrictionEnabled: input.domainRestrictionEnabled,
				inviteRestrictionEnabled: input.inviteRestrictionEnabled,
			},
			defaultRoleTemplateId: input.defaultRoleTemplateId || null,
			currentStep: "review",
			updatedBy: authContext.user.id,
		})
		.where(eq(enterpriseIdentitySetup.organizationId, organizationId))
		.returning();

	if (!updated) throw new Error("Enterprise identity setup not found");
	revalidatePath("/settings/enterprise/identity-setup");
	return normalizeEnterpriseIdentitySetupRecord(updated);
}
```

- [ ] **Step 8: Add guarded activation action**

Append after the access policy action:

```ts
export async function activateEnterpriseIdentitySetupAction() {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	const record = await getOrCreateEnterpriseIdentitySetupRecord(organizationId, authContext.user.id);
	const state = normalizeEnterpriseIdentitySetupRecord(record);
	const readiness = getEnterpriseIdentityReadiness(state);

	if (!readiness.canActivate) {
		throw new Error(`Cannot activate enterprise identity setup. Missing: ${readiness.missing.join(", ")}`);
	}

	const [updated] = await db
		.update(enterpriseIdentitySetup)
		.set({ activatedAt: new Date(), updatedBy: authContext.user.id })
		.where(eq(enterpriseIdentitySetup.organizationId, organizationId))
		.returning();

	revalidatePath("/settings/enterprise/identity-setup");
	revalidatePath("/settings/enterprise/domains");
	return normalizeEnterpriseIdentitySetupRecord(updated);
}
```

This action records activation readiness only. If later tasks wire actual domain/invite enforcement to existing settings, they must keep the same readiness check and current-admin warning in the UI.

- [ ] **Step 9: Run action tests**

Run from `/home/kai/projects/z8/apps/webapp`:

```bash
pnpm test 'src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts'
```

Expected: PASS.

- [ ] **Step 10: Commit action work**

```bash
git add 'src/app/[locale]/(app)/settings/enterprise/actions.ts' 'src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts'
git commit -m "feat: add enterprise identity setup actions"
```

---

### Task 3: Route, Settings Entry, And Access Regression

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/identity-setup/page.tsx`
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Modify: `apps/webapp/src/lib/settings-access.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`

- [ ] **Step 1: Write failing route/access test updates**

Modify `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`:

Add `"enterprise/identity-setup/page.tsx"` to the existing enterprise route list near the other enterprise pages.

Add this assertion to the org-admin route access test that checks enterprise pages:

```ts
expect(orgAdminRoutes).toContain("/settings/enterprise/identity-setup");
```

Add this test near the enterprise action access tests:

```ts
it("keeps enterprise identity setup on org-admin settings access", () => {
	const setupPageSource = stripComments(
		readFileSync(join(SETTINGS_ROOT, "enterprise/identity-setup/page.tsx"), "utf8"),
	);
	const settingsAccessSource = stripComments(
		readFileSync(join(SETTINGS_ROOT, "../../../../lib/settings-access.ts"), "utf8"),
	);

	expect(setupPageSource.includes("requireOrgAdminSettingsAccess(")).toBe(true);
	expect(setupPageSource.includes('employee?.role !== "admin"')).toBe(false);
	expect(settingsAccessSource.includes('"/settings/enterprise/identity-setup"')).toBe(true);
});
```

- [ ] **Step 2: Run route/access tests to verify they fail**

Run from `/home/kai/projects/z8/apps/webapp`:

```bash
pnpm test 'src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts'
```

Expected: FAIL because the identity setup page and route entry do not exist yet.

- [ ] **Step 3: Add settings access route**

Modify `apps/webapp/src/lib/settings-access.ts`:

```ts
	"/settings/enterprise/domains",
	"/settings/enterprise/identity-setup",
	"/settings/enterprise/email",
```

- [ ] **Step 4: Add settings grid card**

Modify `apps/webapp/src/components/settings/settings-config.ts` in the Enterprise settings section:

```ts
	{
		id: "enterprise-identity-setup",
		titleKey: "settings.enterpriseIdentitySetup.title",
		titleDefault: "Enterprise Identity Setup",
		descriptionKey: "settings.enterpriseIdentitySetup.description",
		descriptionDefault: "Guide SSO, SCIM provisioning, domain restrictions, invite policy, and default roles",
		href: "/settings/enterprise/identity-setup",
		icon: "key",
		minimumTier: "orgAdmin",
		group: "enterprise",
	},
```

Place it before `custom-domains` so guided setup appears before direct domain/provider management.

- [ ] **Step 5: Add server page**

Create `apps/webapp/src/app/[locale]/(app)/settings/enterprise/identity-setup/page.tsx`:

```tsx
import { IdentitySetupWizard } from "@/components/settings/enterprise/identity-setup-wizard";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getEnterpriseIdentitySetupAction } from "../actions";

export default async function EnterpriseIdentitySetupPage() {
	const [{ organizationId }, t] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
	]);

	const setup = await getEnterpriseIdentitySetupAction();

	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto max-w-5xl space-y-6">
				<div className="space-y-2">
					<h1 className="text-2xl font-semibold">
						{t("settings.enterpriseIdentitySetup.title", "Enterprise Identity Setup")}
					</h1>
					<p className="max-w-3xl text-muted-foreground">
						{t(
							"settings.enterpriseIdentitySetup.description",
							"Guide SSO, SCIM provisioning, domain restrictions, invite policy, and default roles for this organization.",
						)}
					</p>
				</div>

				<IdentitySetupWizard initialSetup={setup} organizationId={organizationId} />
			</div>
		</div>
	);
}
```

- [ ] **Step 6: Run route/access tests**

Run from `/home/kai/projects/z8/apps/webapp`:

```bash
pnpm test 'src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts'
```

Expected: PASS once the client component exists. If it fails because `identity-setup-wizard.tsx` is missing, proceed to Task 4 before committing this task.

- [ ] **Step 7: Commit route and settings entry**

```bash
git add src/lib/settings-access.ts src/components/settings/settings-config.ts 'src/app/[locale]/(app)/settings/enterprise/identity-setup/page.tsx' 'src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts'
git commit -m "feat: add enterprise identity setup route"
```

---

### Task 4: Wizard UI Component

**Files:**
- Create: `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.tsx`
- Create: `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.test.tsx`
- Modify: `apps/webapp/src/components/settings/enterprise/domains-branding-tabs.tsx`

- [ ] **Step 1: Write failing wizard tests**

Create `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.test.tsx`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const wizardPath = join(process.cwd(), "src/components/settings/enterprise/identity-setup-wizard.tsx");
const tabsPath = join(process.cwd(), "src/components/settings/enterprise/domains-branding-tabs.tsx");

describe("identity setup wizard source", () => {
	it("renders all guided setup steps", () => {
		const source = readFileSync(wizardPath, "utf8");

		expect(source).toContain("Provider");
		expect(source).toContain("Domain");
		expect(source).toContain("SSO Configuration");
		expect(source).toContain("Test User");
		expect(source).toContain("SCIM Provisioning");
		expect(source).toContain("Access Policy");
		expect(source).toContain("Review & Activate");
	});

	it("keeps activation disabled until readiness passes", () => {
		const source = readFileSync(wizardPath, "utf8");

		expect(source).toContain("getEnterpriseIdentityReadiness");
		expect(source).toContain("disabled={!readiness.canActivate || isPending}");
		expect(source).toContain("This token is shown once");
	});

	it("uses TanStack Form and mobile-safe layout classes", () => {
		const source = readFileSync(wizardPath, "utf8");

		expect(source).toContain("useForm");
		expect(source).toContain("grid gap-4 lg:grid-cols-[220px_1fr]");
		expect(source).toContain("min-w-0");
	});

	it("links existing SSO management to guided setup", () => {
		const source = readFileSync(tabsPath, "utf8");

		expect(source).toContain("/settings/enterprise/identity-setup");
		expect(source).toContain("Guided setup");
	});
});
```

- [ ] **Step 2: Run wizard tests to verify they fail**

Run from `/home/kai/projects/z8/apps/webapp`:

```bash
pnpm test src/components/settings/enterprise/identity-setup-wizard.test.tsx
```

Expected: FAIL because the wizard component does not exist and the tabs CTA is not linked.

- [ ] **Step 3: Add wizard component shell and interactions**

Create `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.tsx`:

```tsx
"use client";

import { useForm } from "@tanstack/react-form";
import { IconCheck, IconCopy, IconRefresh, IconShieldCheck } from "@tabler/icons-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
	activateEnterpriseIdentitySetupAction,
	generateEnterpriseIdentityScimTokenAction,
	recordEnterpriseIdentitySsoTestAction,
	registerEnterpriseIdentitySSOProviderAction,
	type EnterpriseIdentitySetupResponse,
	updateEnterpriseIdentityAccessPolicyAction,
	updateEnterpriseIdentityProviderAction,
} from "@/app/[locale]/(app)/settings/enterprise/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
	ENTERPRISE_IDENTITY_PROVIDER_PRESETS,
	type EnterpriseIdentityProviderPresetId,
} from "@/lib/enterprise-identity/provider-presets";
import {
	getEnterpriseIdentityReadiness,
	type EnterpriseIdentitySetupState,
} from "@/lib/enterprise-identity/setup-state";

const steps = [
	"Provider",
	"Domain",
	"SSO Configuration",
	"Test User",
	"SCIM Provisioning",
	"Access Policy",
	"Review & Activate",
];

interface IdentitySetupWizardProps {
	initialSetup: EnterpriseIdentitySetupResponse;
	organizationId: string;
}

export function IdentitySetupWizard({ initialSetup, organizationId }: IdentitySetupWizardProps) {
	const [setup, setSetup] = useState<EnterpriseIdentitySetupState>(initialSetup.state);
	const [scimToken, setScimToken] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();
	const readiness = getEnterpriseIdentityReadiness(setup);

	const providerForm = useForm({
		defaultValues: {
			preset: setup.provider.preset ?? "okta",
			protocol: setup.provider.protocol ?? "oidc",
			providerId: setup.provider.providerId ?? "",
			domain: setup.domain.domain ?? "",
		},
		onSubmit: async ({ value }) => {
			const next = await updateEnterpriseIdentityProviderAction({
				preset: value.preset as EnterpriseIdentityProviderPresetId,
				protocol: value.protocol as "oidc" | "saml",
				providerId: value.providerId,
				domain: value.domain,
				currentStep: "sso",
			});
			setSetup(next);
			toast.success("Provider details saved");
		},
	});

	const ssoForm = useForm({
		defaultValues: {
			issuer: "",
			clientId: "",
			clientSecret: "",
			metadata: "",
		},
		onSubmit: async ({ value }) => {
			if (!setup.provider.providerId || !setup.domain.domain || !setup.provider.protocol) return;
			await registerEnterpriseIdentitySSOProviderAction(
				setup.provider.protocol === "oidc"
					? {
							protocol: "oidc",
							providerId: setup.provider.providerId,
							domain: setup.domain.domain,
							issuer: value.issuer,
							clientId: value.clientId,
							clientSecret: value.clientSecret,
						}
					: {
							protocol: "saml",
							providerId: setup.provider.providerId,
							domain: setup.domain.domain,
							issuer: value.issuer,
							metadata: value.metadata,
						},
			);
			setSetup((prev) => ({ ...prev, currentStep: "test-user" }));
			toast.success("SSO provider registered");
		},
	});

	function recordSsoTest(status: "passed" | "failed") {
		if (!setup.provider.providerId) return;
		startTransition(async () => {
			const next = await recordEnterpriseIdentitySsoTestAction({
				providerId: setup.provider.providerId!,
				testEmail: setup.ssoTest.testEmail || `admin@${setup.domain.domain ?? "example.com"}`,
				status,
				error: status === "failed" ? "Manual test marked as failed" : null,
			});
			setSetup(next);
		});
	}

	function generateScimToken() {
		if (!setup.provider.providerId) return;
		startTransition(async () => {
			const result = await generateEnterpriseIdentityScimTokenAction({
				providerId: setup.provider.providerId!,
				autoActivateUsers: setup.scim.autoActivateUsers,
				deprovisionAction: setup.scim.deprovisionAction,
				defaultRoleTemplateId: setup.enforcement.defaultRoleTemplateId,
			});
			setScimToken(result.scimToken);
			setSetup((prev) => ({
				...prev,
				currentStep: "access-policy",
				scim: { ...prev.scim, enabled: true, providerId: result.providerId },
			}));
		});
	}

	function saveAccessPolicy() {
		startTransition(async () => {
			const next = await updateEnterpriseIdentityAccessPolicyAction(setup.enforcement);
			setSetup(next);
		});
	}

	function activate() {
		startTransition(async () => {
			const next = await activateEnterpriseIdentitySetupAction();
			setSetup(next);
			toast.success("Enterprise identity setup activated");
		});
	}

	const selectedPreset =
		ENTERPRISE_IDENTITY_PROVIDER_PRESETS[
			(providerForm.state.values.preset as EnterpriseIdentityProviderPresetId) || "okta"
		];

	return (
		<div className="grid gap-4 lg:grid-cols-[220px_1fr]">
			<Card className="h-fit">
				<CardHeader>
					<CardTitle className="text-base">Setup steps</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2">
					{steps.map((step, index) => (
						<div key={step} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm">
							<Badge variant={index === 0 ? "default" : "secondary"}>{index + 1}</Badge>
							<span className="truncate">{step}</span>
						</div>
					))}
				</CardContent>
			</Card>

			<div className="min-w-0 space-y-4">
				<Card>
					<CardHeader>
						<CardTitle>Provider</CardTitle>
						<CardDescription>Select the identity provider and protocol for this organization.</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							className="grid gap-4 md:grid-cols-2"
							onSubmit={(event) => {
								event.preventDefault();
								providerForm.handleSubmit();
							}}
						>
							<providerForm.Field name="preset">
								{(field) => (
									<div className="space-y-2">
										<Label>Provider preset</Label>
										<Select value={field.state.value} onValueChange={(value) => field.handleChange(value as EnterpriseIdentityProviderPresetId)}>
											<SelectTrigger><SelectValue /></SelectTrigger>
											<SelectContent>
												{Object.values(ENTERPRISE_IDENTITY_PROVIDER_PRESETS).map((preset) => (
													<SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>
												))}
											</SelectContent>
										</Select>
										<p className="text-sm text-muted-foreground">{selectedPreset.description}</p>
									</div>
								)}
							</providerForm.Field>
							<providerForm.Field name="protocol">
								{(field) => (
									<div className="space-y-2">
										<Label>Protocol</Label>
										<Select value={field.state.value} onValueChange={(value) => field.handleChange(value as "oidc" | "saml")}>
											<SelectTrigger><SelectValue /></SelectTrigger>
											<SelectContent>
												{selectedPreset.supportedProtocols.map((protocol) => (
													<SelectItem key={protocol} value={protocol}>{protocol.toUpperCase()}</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								)}
							</providerForm.Field>
							<providerForm.Field name="providerId">
								{(field) => <FieldInput label="Provider ID" value={field.state.value} onChange={field.handleChange} placeholder="acme-okta" />}
							</providerForm.Field>
							<providerForm.Field name="domain">
								{(field) => <FieldInput label="Email domain" value={field.state.value} onChange={field.handleChange} placeholder="acme.com" />}
							</providerForm.Field>
							<Button type="submit" disabled={isPending}>Save provider</Button>
						</form>
					</CardContent>
				</Card>

				<Card>
					<CardHeader><CardTitle>Domain</CardTitle><CardDescription>Verify ownership before enforcement is available.</CardDescription></CardHeader>
					<CardContent className="space-y-3 text-sm">
						<p>TXT token generation and DNS verification use the existing SSO domain verification actions.</p>
						<Badge variant={setup.domain.verified ? "default" : "secondary"}>{setup.domain.verified ? "Verified" : "Pending"}</Badge>
					</CardContent>
				</Card>

				<Card>
					<CardHeader><CardTitle>SSO Configuration</CardTitle><CardDescription>Register OIDC or SAML using Better Auth.</CardDescription></CardHeader>
					<CardContent>
						<form
							className="space-y-4"
							onSubmit={(event) => {
								event.preventDefault();
								ssoForm.handleSubmit();
							}}
						>
							<ssoForm.Field name="issuer">
								{(field) => <FieldInput label="Issuer URL" value={field.state.value} onChange={field.handleChange} placeholder={selectedPreset.issuerPlaceholder} />}
							</ssoForm.Field>
							{providerForm.state.values.protocol === "saml" ? (
								<ssoForm.Field name="metadata">
									{(field) => (
										<div className="space-y-2">
											<Label>SAML metadata XML</Label>
											<Textarea value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} rows={6} />
										</div>
									)}
								</ssoForm.Field>
							) : (
								<div className="grid gap-4 md:grid-cols-2">
									<ssoForm.Field name="clientId">
										{(field) => <FieldInput label="Client ID" value={field.state.value} onChange={field.handleChange} placeholder="client-id" />}
									</ssoForm.Field>
									<ssoForm.Field name="clientSecret">
										{(field) => <FieldInput label="Client Secret" value={field.state.value} onChange={field.handleChange} placeholder="client-secret" type="password" />}
									</ssoForm.Field>
								</div>
							)}
							<Button type="submit" disabled={isPending}>Register SSO provider</Button>
						</form>
					</CardContent>
				</Card>

				<Card>
					<CardHeader><CardTitle>Test User</CardTitle><CardDescription>Record a live SSO test before activation.</CardDescription></CardHeader>
					<CardContent className="flex flex-col gap-3 sm:flex-row">
						<Button variant="outline" onClick={() => recordSsoTest("failed")} disabled={isPending}>Mark failed</Button>
						<Button onClick={() => recordSsoTest("passed")} disabled={isPending}><IconCheck className="mr-2 h-4 w-4" />Mark passed</Button>
					</CardContent>
				</Card>

				<Card>
					<CardHeader><CardTitle>SCIM Provisioning</CardTitle><CardDescription>Optional directory sync. This token is shown once.</CardDescription></CardHeader>
					<CardContent className="space-y-4">
						<Button onClick={generateScimToken} disabled={isPending || !setup.provider.providerId}>Generate SCIM token</Button>
						{scimToken && <CopyableSecret value={scimToken} />}
						<p className="text-sm text-muted-foreground">SCIM base URL: <code>/api/auth/scim/v2</code></p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader><CardTitle>Access Policy</CardTitle><CardDescription>Save ready-but-disabled enforcement choices.</CardDescription></CardHeader>
					<CardContent className="space-y-3">
						<PolicyCheckbox label="Require SSO for verified domain" checked={setup.enforcement.ssoRequired} onChange={(checked) => setSetup((prev) => ({ ...prev, enforcement: { ...prev.enforcement, ssoRequired: checked } }))} />
						<PolicyCheckbox label="Restrict signups to verified domain" checked={setup.enforcement.domainRestrictionEnabled} onChange={(checked) => setSetup((prev) => ({ ...prev, enforcement: { ...prev.enforcement, domainRestrictionEnabled: checked } }))} />
						<PolicyCheckbox label="Restrict invites to verified domain" checked={setup.enforcement.inviteRestrictionEnabled} onChange={(checked) => setSetup((prev) => ({ ...prev, enforcement: { ...prev.enforcement, inviteRestrictionEnabled: checked } }))} />
						<Button variant="outline" onClick={saveAccessPolicy} disabled={isPending}>Save access policy</Button>
					</CardContent>
				</Card>

				<Card>
					<CardHeader><CardTitle>Review & Activate</CardTitle><CardDescription>Activation is blocked until provider, verified domain, and SSO test are ready.</CardDescription></CardHeader>
					<CardContent className="space-y-4">
						{!readiness.canActivate && <p className="text-sm text-muted-foreground">Missing: {readiness.missing.join(", ")}</p>}
						<p className="text-sm text-amber-700 dark:text-amber-300">Confirm the current admin can still sign in before requiring SSO for the domain.</p>
						<Button onClick={activate} disabled={!readiness.canActivate || isPending}><IconShieldCheck className="mr-2 h-4 w-4" />Activate setup</Button>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

function FieldInput({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; type?: string }) {
	return (
		<div className="space-y-2">
			<Label>{label}</Label>
			<Input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
		</div>
	);
}

function PolicyCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
	return (
		<label className="flex items-center gap-2 text-sm">
			<Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
			{label}
		</label>
	);
}

function CopyableSecret({ value }: { value: string }) {
	return (
		<div className="flex min-w-0 items-center justify-between gap-2 rounded-md border bg-muted p-3 text-sm">
			<code className="min-w-0 truncate">{value}</code>
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={() => {
					navigator.clipboard.writeText(value);
					toast.success("SCIM token copied");
				}}
			>
				<IconCopy className="h-4 w-4" />
			</Button>
		</div>
	);
}
```

- [ ] **Step 4: Add guided setup CTA to existing enterprise tabs**

Modify `apps/webapp/src/components/settings/enterprise/domains-branding-tabs.tsx` imports:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
```

Modify the SSO tab content:

```tsx
			<TabsContent value="sso" className="space-y-4">
				<div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
					<div className="space-y-1">
						<p className="font-medium">Guided setup</p>
						<p className="text-sm text-muted-foreground">
							Configure SSO, optional SCIM provisioning, access policy, and activation guardrails.
						</p>
					</div>
					<Button asChild>
						<Link href="/settings/enterprise/identity-setup">Open guided setup</Link>
					</Button>
				</div>
				<SSOProviderManagement initialProviders={initialProviders} />
			</TabsContent>
```

- [ ] **Step 5: Run wizard and route tests**

Run from `/home/kai/projects/z8/apps/webapp`:

```bash
pnpm test src/components/settings/enterprise/identity-setup-wizard.test.tsx 'src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts'
```

Expected: PASS.

- [ ] **Step 6: Commit wizard UI**

```bash
git add src/components/settings/enterprise/identity-setup-wizard.tsx src/components/settings/enterprise/identity-setup-wizard.test.tsx src/components/settings/enterprise/domains-branding-tabs.tsx
git commit -m "feat: add enterprise identity setup wizard"
```

---

### Task 5: Tighten Validation, Secret Masking, And SCIM Status Behavior

**Files:**
- Modify: `apps/webapp/src/lib/enterprise-identity/setup-state.ts`
- Modify: `apps/webapp/src/lib/enterprise-identity/setup-state.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts`
- Modify: `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.tsx`

- [ ] **Step 1: Add failing tests for validation and show-once token behavior**

Append to `setup-state.test.ts`:

```ts
import { validateEnterpriseIdentityProviderInput } from "./setup-state";

describe("enterprise identity validation", () => {
	it("rejects invalid provider IDs and domains", () => {
		expect(
			validateEnterpriseIdentityProviderInput({ providerId: "Bad ID", domain: "acme.com" }),
		).toEqual("Provider ID must contain only lowercase letters, numbers, and hyphens");
		expect(
			validateEnterpriseIdentityProviderInput({ providerId: "acme-okta", domain: "not a domain" }),
		).toEqual("Enter a valid email domain such as example.com");
		expect(
			validateEnterpriseIdentityProviderInput({ providerId: "acme-okta", domain: "acme.com" }),
		).toBeNull();
	});
});
```

Append to `actions.identity-setup.test.ts`:

```ts
it("does not persist or return SCIM token outside the generation response", () => {
	const text = source();

	expect(text).toContain("scimToken: result?.scimToken ?? result?.token ?? null");
	expect(text).not.toContain("scim_token");
	expect(text).not.toContain("scimTokenGeneratedAt: result");
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run from `/home/kai/projects/z8/apps/webapp`:

```bash
pnpm test src/lib/enterprise-identity/setup-state.test.ts 'src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts'
```

Expected: FAIL because `validateEnterpriseIdentityProviderInput` is not implemented.

- [ ] **Step 3: Implement validation helper**

Modify `apps/webapp/src/lib/enterprise-identity/setup-state.ts`:

```ts
const PROVIDER_ID_REGEX = /^[a-z0-9-]+$/;
const DOMAIN_REGEX = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

export function validateEnterpriseIdentityProviderInput(input: {
	providerId: string;
	domain: string;
}): string | null {
	if (!PROVIDER_ID_REGEX.test(input.providerId)) {
		return "Provider ID must contain only lowercase letters, numbers, and hyphens";
	}
	if (!DOMAIN_REGEX.test(input.domain)) {
		return "Enter a valid email domain such as example.com";
	}
	return null;
}
```

- [ ] **Step 4: Use validation in server action**

Modify the setup-state import in `actions.ts`:

```ts
	validateEnterpriseIdentityProviderInput,
```

In `updateEnterpriseIdentityProviderAction`, replace the simple `if (!providerId || !domain)` block with:

```ts
	const validationError = validateEnterpriseIdentityProviderInput({ providerId, domain });
	if (validationError) {
		throw new Error(validationError);
	}
```

In `registerEnterpriseIdentitySSOProviderAction`, after domain/provider normalization, add the same validation block.

- [ ] **Step 5: Keep SCIM status honest in UI**

Modify `identity-setup-wizard.tsx` in the SCIM card to include real observed status only:

```tsx
						<p className="text-sm text-muted-foreground">
							SCIM verification updates after your identity provider sends a test user or group change.
						</p>
						<Badge variant={setup.scim.lastObservedEventAt ? "default" : "secondary"}>
							{setup.scim.lastObservedEventAt ? "Provisioning activity observed" : "No provisioning activity yet"}
						</Badge>
```

- [ ] **Step 6: Run focused tests**

Run from `/home/kai/projects/z8/apps/webapp`:

```bash
pnpm test src/lib/enterprise-identity/setup-state.test.ts 'src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts' src/components/settings/enterprise/identity-setup-wizard.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit validation and token behavior**

```bash
git add src/lib/enterprise-identity/setup-state.ts src/lib/enterprise-identity/setup-state.test.ts 'src/app/[locale]/(app)/settings/enterprise/actions.ts' 'src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts' src/components/settings/enterprise/identity-setup-wizard.tsx
git commit -m "fix: guard enterprise identity setup validation"
```

---

### Task 6: Documentation And Final Verification

**Files:**
- Modify: `apps/docs/content/docs/guide/admin-guide/scim-provisioning.mdx`
- Modify: `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.tsx`

- [ ] **Step 1: Write failing docs/source expectation**

Append this assertion to `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.test.tsx` so the SCIM docs update is tracked by the existing webapp test command:

```ts
it("keeps SCIM docs aligned with self-serve identity setup", () => {
	const docsSource = readFileSync(
		join(process.cwd(), "../../apps/docs/content/docs/guide/admin-guide/scim-provisioning.mdx"),
		"utf8",
	);

	expect(docsSource).toContain("Enterprise Identity Setup");
	expect(docsSource).toContain("/settings/enterprise/identity-setup");
	expect(docsSource).not.toContain("does not expose a dedicated self-serve SCIM setup page");
});
```

- [ ] **Step 2: Run docs/source test to verify it fails**

Run from `/home/kai/projects/z8/apps/webapp`:

```bash
pnpm test src/components/settings/enterprise/identity-setup-wizard.test.tsx
```

Expected: FAIL because the SCIM docs still describe managed-only setup.

- [ ] **Step 3: Update SCIM docs**

Modify `apps/docs/content/docs/guide/admin-guide/scim-provisioning.mdx` lines 9-17 to:

```mdx
SCIM provisioning is available through the **Enterprise Identity Setup** wizard for organization owners and admins.

Open the wizard from **Settings → Enterprise → Enterprise Identity Setup** or go directly to `/settings/enterprise/identity-setup` in the web app.
```

Modify the Admin Expectations section to:

```mdx
## Admin Expectations

- Configure SSO first, then enable optional SCIM provisioning in the same wizard.
- Copy the SCIM base URL and bearer token when the wizard generates them. The token is shown only once.
- Use your identity provider's test provisioning action, then return to the wizard to refresh SCIM status and logs.
- Review the resulting members and employee records in [Employee Management](/docs/guide/admin-guide/employee-management).
```

- [ ] **Step 4: Run final focused tests**

Run from `/home/kai/projects/z8/apps/webapp`:

```bash
pnpm test src/lib/enterprise-identity/setup-state.test.ts 'src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts' src/components/settings/enterprise/identity-setup-wizard.test.tsx 'src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts'
```

Expected: PASS.

- [ ] **Step 5: Run full webapp test suite**

Run from `/home/kai/projects/z8/apps/webapp`:

```bash
pnpm test
```

Expected: PASS. If unrelated pre-existing tests fail, capture the failing test names and confirm the focused tests above still pass.

- [ ] **Step 6: Run build if environment does not require unavailable secrets**

Run from `/home/kai/projects/z8/apps/webapp` only if it does not require Phase CLI secrets:

```bash
pnpm build
```

Expected: PASS. If the build requires unavailable Phase CLI environment variables, skip it and note the skipped build with the missing variables.

- [ ] **Step 7: Commit docs and verification updates**

```bash
git add ../../apps/docs/content/docs/guide/admin-guide/scim-provisioning.mdx src/components/settings/enterprise/identity-setup-wizard.test.tsx
git commit -m "docs: update scim provisioning setup guide"
```

---

## Final Review Checklist

- [ ] `enterprise_identity_setup` is Z8-owned schema and `src/db/auth-schema.ts` was not edited.
- [ ] All setup actions derive `organizationId` from the active session and use `requireEnterpriseOrgAdmin()`.
- [ ] OIDC client secrets are stored through the existing org vault path and not returned.
- [ ] SCIM bearer token is returned only by `generateEnterpriseIdentityScimTokenAction`.
- [ ] Required SSO activation is blocked until provider, verified domain, and successful SSO test are present.
- [ ] The current admin lockout warning is visible in the Review & Activate step.
- [ ] The new route is present in `ORG_ADMIN_SETTINGS_ROUTES` and settings route tests.
- [ ] Focused tests and full `pnpm test` have passed, or unrelated failures are documented.
