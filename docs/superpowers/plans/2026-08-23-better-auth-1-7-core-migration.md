# Better Auth 1.7 Core Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Z8's production-safe Better Auth 1.7 core migration while preserving account identity and legacy SCIM data.

**Architecture:** Update the active Better Auth configuration and callers first, transfer the legacy SCIM table to application schema ownership, then regenerate the 1.7 auth schema. Apply account identity through a guarded PostgreSQL migration that derives only trusted issuers and aborts on unknown providers, custom legacy subject mappings, null issuers, or collisions.

**Tech Stack:** Next.js 16, React 19, TypeScript 7, Better Auth 1.7.1, Drizzle ORM/Kit, PostgreSQL, Redis/ioredis, Vitest, pnpm.

---

## File Map

**Dependencies and documentation**

- Modify `apps/webapp/package.json`: exact Better Auth and CLI versions.
- Modify `pnpm-lock.yaml`: lockfile after dependency removal/pinning.
- Modify `docker/targets/worker/package.json`: generated worker runtime dependency manifest.
- Modify `docker/targets/worker/pnpm-lock.yaml`: generated worker runtime lockfile.
- Modify `docs/refs/better-auth.md`: link the 1.7 migration runbook and record the pinned generation workflow.
- Create `docs/refs/better-auth-1-7-account-migration.md`: maintenance-window inventory, backup, migration, and verification runbook.

**Auth configuration and persistence**

- Modify `apps/webapp/src/lib/auth.ts`: joins location and removal of incompatible SCIM plugin.
- Modify `apps/webapp/src/lib/auth.test.ts`: preserve the complete wrapped 1.7 adapter surface.
- Modify `apps/webapp/src/lib/auth-security.test.ts`: assert no legacy SCIM runtime is registered.
- Modify `apps/webapp/src/db/schema/scim.ts`: application-owned declaration of the retained `scim_provider` table.
- Modify `apps/webapp/src/db/auth-schema.ts`: generated only through `pnpm run auth:generate`; never edit manually.

**Storage**

- Modify `apps/webapp/src/lib/redis.ts`: atomic `increment` and `getAndDelete`.
- Modify `apps/webapp/src/lib/redis.test.ts`: Redis atomic-operation tests.
- Modify `apps/webapp/src/lib/auth/guarded-secondary-storage.ts`: forward the 1.7 storage methods.
- Modify `apps/webapp/src/lib/auth/guarded-secondary-storage.test.ts`: forwarding and failure-contract tests.

**Account identity**

- Create `apps/webapp/src/lib/auth/account-issuer.ts`: canonical built-in account issuer mapping.
- Create `apps/webapp/src/lib/auth/account-issuer.test.ts`: exact mappings and unknown-provider rejection.
- Modify `apps/webapp/src/lib/effect/services/setup.service.ts`: credential issuer.
- Create `apps/webapp/src/lib/effect/services/setup.service.test.ts`: credential account insert contract.
- Modify `apps/webapp/src/app/api/auth/callback/social-org/[provider]/route.ts`: issuer-based lookup and inserts.
- Modify `apps/webapp/src/app/api/auth/callback/social-org/[provider]/route.test.ts`: lookup/insert identity tests.
- Modify `apps/webapp/src/components/settings/auth/social-accounts.tsx`: 1.7 unlink selector.
- Modify `apps/webapp/src/components/settings/auth/social-accounts.test.tsx`: local row-ID unlink test.

**2FA and SSO**

- Create `apps/webapp/src/components/settings/auth/two-factor-enrollment-response.ts`: narrow TOTP enrollment responses.
- Create `apps/webapp/src/components/settings/auth/two-factor-enrollment-response.test.ts`: parser tests.
- Modify `apps/webapp/src/components/settings/auth/use-two-factor-setup-controller.ts`: request and consume TOTP safely.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.ts`: SAML 1.7 shape and disabled SCIM actions.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts`: SAML and disabled-SCIM contracts.
- Modify `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.tsx`: SAML ACS display and static SCIM-unavailable state.
- Modify `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.test.tsx`: SAML ACS and disabled-SCIM tests.

**Database migration**

- Create `apps/webapp/drizzle/0061_better_auth_account_issuer.sql`: guarded issuer backfill and constraints.
- Create `apps/webapp/drizzle/meta/0061_snapshot.json`: generated final schema snapshot.
- Modify `apps/webapp/drizzle/meta/_journal.json`: generated migration registration.
- Create `apps/webapp/src/db/__tests__/better-auth-account-issuer-migration.test.ts`: migration ordering, guards, and preservation checks.

### Task 1: Pin Better Auth And CLI Versions

**Files:**
- Modify: `apps/webapp/package.json:14,25-29,81`
- Modify: `pnpm-lock.yaml`
- Modify: `docker/targets/worker/package.json`
- Modify: `docker/targets/worker/pnpm-lock.yaml`
- Modify: `docs/refs/better-auth.md:17-30`

- [ ] **Step 1: Record the current package mismatch**

Run from the repository root:

```bash
pnpm --filter webapp list better-auth @better-auth/api-key @better-auth/drizzle-adapter @better-auth/passkey @better-auth/scim @better-auth/sso --depth 0
```

Expected: installed packages resolve to 1.7.1, while `apps/webapp/package.json` still mixes caret and exact ranges and `auth:generate` still references `auth@latest`.

- [ ] **Step 2: Pin retained packages and remove the inactive SCIM package**

Run:

```bash
pnpm --filter webapp add --save-exact better-auth@1.7.1 @better-auth/api-key@1.7.1 @better-auth/drizzle-adapter@1.7.1 @better-auth/passkey@1.7.1 @better-auth/scim@1.7.1 @better-auth/sso@1.7.1
pnpm run docker:sync:non-web-targets
```

Then change the generator script in `apps/webapp/package.json` to:

```json
"auth:generate": "TZ=UTC NODE_OPTIONS='--require=./scripts/register-auth-generate-alias.cjs' pnpm dlx auth@1.7.1 generate --config ./src/lib/auth.ts --output ./src/db/auth-schema.ts"
```

- [ ] **Step 3: Document the generator requirement**

Add this text to `docs/refs/better-auth.md`:

```markdown
## Better Auth 1.7

- Keep `better-auth`, every `@better-auth/*` package, and the `auth` CLI on the same patch.
- The auth CLI requires Node.js 22.12 or newer.
- Read [Better Auth 1.7 Account Migration](better-auth-1-7-account-migration.md) before applying schema changes.
- Never run `auth:migrate` or `drizzle-kit push` as a schema-generation check against a shared database.
```

- [ ] **Step 4: Verify dependency alignment**

Run:

```bash
pnpm --filter webapp list better-auth @better-auth/api-key @better-auth/drizzle-adapter @better-auth/passkey @better-auth/scim @better-auth/sso --depth 0
```

Expected: every Better Auth package, including SCIM until Task 3 removes its active integration, is exactly 1.7.1. Confirm `docker/targets/worker/package.json` also pins every Better Auth package exactly.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/package.json pnpm-lock.yaml docker/targets/worker/package.json docker/targets/worker/pnpm-lock.yaml docs/refs/better-auth.md
git commit -m "chore: align Better Auth 1.7 packages"
```

### Task 2: Add Atomic Secondary Storage Operations

**Files:**
- Modify: `apps/webapp/src/lib/redis.test.ts`
- Modify: `apps/webapp/src/lib/redis.ts:149-204`
- Modify: `apps/webapp/src/lib/auth/guarded-secondary-storage.test.ts`
- Modify: `apps/webapp/src/lib/auth/guarded-secondary-storage.ts:9-17,93-156`

- [ ] **Step 1: Write failing Redis atomic-operation tests**

Extend the hoisted Redis mock with `eval`, then add tests equivalent to:

```ts
test("increments atomically without extending an existing TTL", async () => {
	mocks.redisEval.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
	const { secondaryStorage } = await import("./redis");

	await expect(secondaryStorage.increment("rate-limit:user-1", 60)).resolves.toBe(1);
	await expect(secondaryStorage.increment("rate-limit:user-1", 60)).resolves.toBe(2);
	expect(mocks.redisEval).toHaveBeenCalledTimes(2);
	expect(mocks.redisEval.mock.calls[0]?.slice(-2)).toEqual(["rate-limit:user-1", "60"]);
});

test("gets and deletes a value atomically", async () => {
	mocks.redisEval.mockResolvedValueOnce("single-use-value").mockResolvedValueOnce(null);
	const { secondaryStorage } = await import("./redis");

	await expect(secondaryStorage.getAndDelete("verification:1")).resolves.toBe(
		"single-use-value",
	);
	await expect(secondaryStorage.getAndDelete("verification:1")).resolves.toBeNull();
});
```

Also test that `increment` logs and returns `0` on failure and `getAndDelete` logs and returns `null` on failure.

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm exec vitest run src/lib/redis.test.ts
```

Expected: FAIL because `secondaryStorage.increment`, `secondaryStorage.getAndDelete`, and the mock's `eval` method do not exist.

- [ ] **Step 3: Implement Redis operations with atomic Lua scripts**

Add module constants and methods in `src/lib/redis.ts`:

```ts
const incrementWithInitialExpiryScript = `
local existed = redis.call("EXISTS", KEYS[1])
local value = redis.call("INCR", KEYS[1])
if existed == 0 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return value
`;

const getAndDeleteScript = `
local value = redis.call("GET", KEYS[1])
if value ~= false then
  redis.call("DEL", KEYS[1])
end
return value
`;
```

Add these object methods:

```ts
increment: async (key: string, ttl: number): Promise<number> => {
	if (shouldDisableRedisDuringBuild) return 0;
	try {
		const value = await redis.eval(incrementWithInitialExpiryScript, 1, key, String(ttl));
		return Number(value);
	} catch (error) {
		logger.error({ error, key }, "Failed to increment in Redis");
		return 0;
	}
},
getAndDelete: async (key: string): Promise<string | null> => {
	if (shouldDisableRedisDuringBuild) return null;
	try {
		const value = await redis.eval(getAndDeleteScript, 1, key);
		return typeof value === "string" ? value : null;
	} catch (error) {
		logger.error({ error, key }, "Failed to get and delete from Redis");
		return null;
	}
},
```

- [ ] **Step 4: Write failing guarded-wrapper delegation tests**

Add `increment` and `getAndDelete` mocks to `setup().storage`, then add:

```ts
it("forwards Better Auth 1.7 atomic operations", async () => {
	const harness = setup();
	harness.storage.increment.mockResolvedValue(3);
	harness.storage.getAndDelete.mockResolvedValue("value");

	await expect(harness.adapter.increment("counter", 30)).resolves.toBe(3);
	await expect(harness.adapter.getAndDelete("single-use")).resolves.toBe("value");
	expect(harness.storage.increment).toHaveBeenCalledWith("counter", 30);
	expect(harness.storage.getAndDelete).toHaveBeenCalledWith("single-use");
});
```

- [ ] **Step 5: Run the wrapper test to verify it fails**

Run:

```bash
pnpm exec vitest run src/lib/auth/guarded-secondary-storage.test.ts
```

Expected: FAIL because the wrapper's storage types and returned object lack the methods.

- [ ] **Step 6: Extend and forward the storage contract**

Change `SecondaryStorage` to:

```ts
type SecondaryStorage = {
	get: (key: string) => Promise<string | null>;
	set: (key: string, value: string, ttl?: number) => Promise<void>;
	delete: (key: string) => Promise<void>;
	increment: (key: string, ttl: number) => Promise<number>;
	getAndDelete: (key: string) => Promise<string | null>;
};
```

Return the methods unchanged:

```ts
delete: storage.delete,
getAndDelete: storage.getAndDelete,
increment: storage.increment,
set: storage.set,
```

- [ ] **Step 7: Run focused tests and commit**

Run:

```bash
pnpm exec vitest run src/lib/redis.test.ts src/lib/auth/guarded-secondary-storage.test.ts
```

Expected: PASS.

```bash
git add apps/webapp/src/lib/redis.ts apps/webapp/src/lib/redis.test.ts apps/webapp/src/lib/auth/guarded-secondary-storage.ts apps/webapp/src/lib/auth/guarded-secondary-storage.test.ts
git commit -m "fix: add Better Auth atomic storage operations"
```

### Task 3: Update Core Auth Configuration And Preserve Legacy SCIM Storage

**Files:**
- Modify: `apps/webapp/src/lib/auth.test.ts`
- Modify: `apps/webapp/src/lib/auth-security.test.ts`
- Modify: `apps/webapp/src/lib/auth.ts`
- Modify: `apps/webapp/src/db/schema/scim.ts`
- Modify: `apps/webapp/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `docker/targets/worker/package.json`
- Modify: `docker/targets/worker/pnpm-lock.yaml`

- [ ] **Step 1: Write failing configuration and preservation tests**

Extend `auth.test.ts` so the wrapped adapter test preserves representative 1.7 methods:

```ts
expect(wrapped.findMany).toBe(adapter.findMany);
expect(wrapped.count).toBe(adapter.count);
expect(wrapped.updateMany).toBe(adapter.updateMany);
expect(wrapped.deleteMany).toBe(adapter.deleteMany);
```

Update `auth-security.test.ts` source assertions:

```ts
expect(authSource).not.toContain('@better-auth/scim');
expect(authSource).not.toMatch(/\bscim\s*\(/);
expect(authSource).toContain("database: {");
expect(authSource).toContain("joins: true");
expect(authSource).not.toContain("experimental: {");
```

Add a source/schema assertion that `src/db/schema/scim.ts` declares `pgTable("scim_provider"`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run src/lib/auth.test.ts src/lib/auth-security.test.ts
```

Expected: FAIL because joins remain experimental, SCIM remains active, and the legacy table remains generated-auth-owned.

- [ ] **Step 3: Transfer the legacy SCIM table to application ownership**

Add this declaration near the top of `src/db/schema/scim.ts`:

```ts
export const legacyScimProvider = pgTable("scim_provider", {
	id: text("id").primaryKey(),
	providerId: text("provider_id").notNull().unique(),
	scimToken: text("scim_token").notNull().unique(),
	organizationId: text("organization_id"),
});
```

Update comments to state that this is retained read-only legacy data pending the separate 1.7 SCIM cutover. Do not add Better Auth 1.7 SCIM tables.

- [ ] **Step 4: Remove the incompatible plugin and move joins**

In `auth.ts`:

- Remove the `@better-auth/scim` import.
- Remove `scimProvisioningLog` and `team` imports if unused after plugin removal.
- Remove `isSCIMAdministrator`, `assertSCIMAdministrator`, and the entire `scim({...})` plugin entry.
- Replace `experimental.joins` with:

```ts
advanced: {
	database: {
		joins: true,
	},
	ipAddress: {
		ipv6Subnet: 64,
	},
},
```

Do not add `trustedProxyHeaders`.

- [ ] **Step 5: Remove the now-unused SCIM package from runtime manifests**

Run from the repository root after the import and plugin are gone:

```bash
pnpm --filter webapp remove @better-auth/scim
pnpm run docker:sync:non-web-targets
```

Expected: `@better-auth/scim` is absent from `apps/webapp/package.json`, `docker/targets/worker/package.json`, and their lockfiles, while every retained Better Auth package remains exactly 1.7.1.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
pnpm exec vitest run src/lib/auth.test.ts src/lib/auth-security.test.ts
```

Expected: PASS.

```bash
git add apps/webapp/src/lib/auth.ts apps/webapp/src/lib/auth.test.ts apps/webapp/src/lib/auth-security.test.ts apps/webapp/src/db/schema/scim.ts apps/webapp/package.json pnpm-lock.yaml docker/targets/worker/package.json docker/targets/worker/pnpm-lock.yaml
git commit -m "fix: update Better Auth core configuration"
```

### Task 4: Disable Legacy SCIM Actions And UI

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.ts`
- Modify: `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.test.tsx`
- Modify: `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.tsx`

- [ ] **Step 1: Replace positive SCIM action tests with fail-closed tests**

Replace tests that require `generateSCIMToken`, `listSCIMProviderConnections`, token persistence, and status mutation with:

```ts
it("keeps legacy SCIM unavailable without invoking removed APIs", () => {
	expect(source).not.toContain("generateSCIMToken");
	expect(source).not.toContain("listSCIMProviderConnections");
	expect(source).not.toContain("deleteSCIMProviderConnection");
	expect(getFunctionSource("generateEnterpriseIdentityScimTokenAction")).toContain(
		"SCIM provisioning is temporarily unavailable",
	);
	expect(getFunctionSource("refreshEnterpriseIdentityScimStatusAction")).toContain(
		"SCIM provisioning is temporarily unavailable",
	);
});
```

Retain the authorization assertion so both disabled actions still call `requireEnterpriseOrgAdmin()`.

- [ ] **Step 2: Run the action tests to verify they fail**

Run:

```bash
pnpm exec vitest run 'src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts'
```

Expected: FAIL because legacy Better Auth SCIM calls and database mutations remain.

- [ ] **Step 3: Make server actions fail closed without mutation**

Add:

```ts
const SCIM_UNAVAILABLE_MESSAGE =
	"SCIM provisioning is temporarily unavailable during the Better Auth 1.7 migration";
```

Change setup loading to return `scimConnection: null` without calling Better Auth. Replace the two action bodies with:

```ts
export async function generateEnterpriseIdentityScimTokenAction(
	input: EnterpriseIdentityScimTokenInput,
) {
	await requireEnterpriseOrgAdmin();
	void input;
	throw new Error(SCIM_UNAVAILABLE_MESSAGE);
}

export async function refreshEnterpriseIdentityScimStatusAction() {
	await requireEnterpriseOrgAdmin();
	throw new Error(SCIM_UNAVAILABLE_MESSAGE);
}
```

Remove now-unused SCIM config/log imports, helper functions, and token response imports. Preserve the application-owned SCIM tables and historical setup state.

- [ ] **Step 4: Write failing disabled-UI tests**

Replace token-generation/status tests in `identity-setup-wizard.test.tsx` with:

```ts
it("shows SCIM as temporarily unavailable without exposing legacy controls", () => {
	renderWizard(configuredSetup({ currentStep: "scim" }));

	expect(screen.getByText("SCIM provisioning is temporarily unavailable")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Token generieren" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Status aktualisieren" })).toBeNull();
	expect(screen.queryByText("/api/auth/scim/v2")).toBeNull();
});
```

- [ ] **Step 5: Replace the SCIM step with a static unavailable state**

Keep the existing `scim` step ID to avoid rewriting persisted wizard state, but replace `ScimStep` with:

```tsx
function ScimStep({ controller }: { controller: IdentitySetupController }) {
	const { t } = controller;
	return (
		<WizardCard
			title={t("settings.enterprise.identity.scim.title", "SCIM Provisioning")}
			description={t(
				"settings.enterprise.identity.scim.unavailable",
				"SCIM provisioning is temporarily unavailable",
			)}
		>
			<p className="text-muted-foreground text-sm">
				{t(
					"settings.enterprise.identity.scim.unavailableDescription",
					"Existing provisioning data is preserved while the Better Auth 1.7 SCIM cutover is prepared.",
				)}
			</p>
		</WizardCard>
	);
}
```

Remove controller state and handlers used only for token generation/status refresh. Update nearby English fallback copy so it does not advertise active SCIM configuration.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
pnpm exec vitest run 'src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts' src/components/settings/enterprise/identity-setup-wizard.test.tsx
```

Expected: PASS.

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.ts' 'apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts' apps/webapp/src/components/settings/enterprise/identity-setup-wizard.tsx apps/webapp/src/components/settings/enterprise/identity-setup-wizard.test.tsx
git commit -m "fix: stage legacy SCIM for separate migration"
```

### Task 5: Update SAML Registration And ACS Guidance

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.ts:405-459`
- Modify: `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.test.tsx`
- Modify: `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.tsx`

- [ ] **Step 1: Write the failing SAML request-shape test**

Add a source or mocked-action test that requires:

```ts
expect(samlRequest.body.samlConfig).toEqual({
	idpMetadata: {
		metadata: "<EntityDescriptor entityID=\"https://idp.example.com\" />",
	},
});
```

Also assert blank metadata fails before `registerSSOProvider` is called.

- [ ] **Step 2: Run the action test to verify it fails**

Run:

```bash
pnpm exec vitest run 'src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts'
```

Expected: FAIL because metadata remains at `samlConfig.metadata`.

- [ ] **Step 3: Use the Better Auth 1.7 metadata shape**

Change the SAML registration body to:

```ts
samlConfig: {
	idpMetadata: {
		metadata,
	},
},
```

Keep the existing non-empty metadata validation. Do not reinterpret the top-level `issuer` as the IdP entity ID; Better Auth uses it as the service-provider issuer in 1.7.

- [ ] **Step 4: Write a failing protocol-specific ACS test**

In the wizard test, select/configure SAML with provider ID `acme/okta` and assert:

```ts
expect(
	screen.getByText("/api/auth/sso/saml2/sp/acs/acme%2Fokta"),
).toBeTruthy();
```

Keep the existing generic OIDC management callback `/api/auth/sso/callback` unchanged.

- [ ] **Step 5: Display the encoded SAML ACS path**

In the SAML configuration branch of the wizard, compute:

```ts
const samlAcsPath = providerId
	? `/api/auth/sso/saml2/sp/acs/${encodeURIComponent(providerId)}`
	: "/api/auth/sso/saml2/sp/acs/:providerId";
```

Render it next to the metadata setup instructions only for SAML.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
pnpm exec vitest run 'src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts' src/components/settings/enterprise/identity-setup-wizard.test.tsx src/components/settings/enterprise/enterprise-management.test.tsx
```

Expected: PASS.

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.ts' 'apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts' apps/webapp/src/components/settings/enterprise/identity-setup-wizard.tsx apps/webapp/src/components/settings/enterprise/identity-setup-wizard.test.tsx
git commit -m "fix: migrate SAML setup to Better Auth 1.7"
```

### Task 6: Regenerate The Better Auth 1.7 Schema

**Files:**
- Modify (generated): `apps/webapp/src/db/auth-schema.ts`

- [ ] **Step 1: Verify the CLI runtime**

Run from `apps/webapp`:

```bash
node --version
```

Expected: Node.js 22.12 or newer. If older, stop; do not generate with an unsupported CLI runtime.

- [ ] **Step 2: Generate the schema**

Run:

```bash
pnpm run auth:generate
```

Expected: `src/db/auth-schema.ts` is regenerated from the 1.7.1 configuration.

- [ ] **Step 3: Review generated invariants**

Run:

```bash
git diff -- src/db/auth-schema.ts
```

Verify all of the following:

- `account` contains `issuer: text("issuer").notNull()`.
- `account` contains one unique index over `issuer` and `accountId`.
- The generated legacy `scimProvider` declaration is gone.
- No Better Auth 1.7 SCIM connection tables were generated.
- Organization relation/team changes, if generated, match active plugin configuration.
- Existing Z8 user, organization, member, and invitation additional fields remain present.

- [ ] **Step 4: Verify application-owned legacy SCIM ownership**

Run:

```bash
pnpm exec vitest run src/lib/auth-security.test.ts
```

Expected: PASS and `src/db/schema/scim.ts` still owns physical table `scim_provider`.

- [ ] **Step 5: Commit generated schema**

```bash
git add apps/webapp/src/db/auth-schema.ts
git commit -m "chore: regenerate Better Auth 1.7 schema"
```

### Task 7: Migrate Account Writers And Selectors

**Files:**
- Create: `apps/webapp/src/lib/auth/account-issuer.test.ts`
- Create: `apps/webapp/src/lib/auth/account-issuer.ts`
- Modify: `apps/webapp/src/lib/effect/services/setup.service.ts`
- Create: `apps/webapp/src/lib/effect/services/setup.service.test.ts`
- Modify: `apps/webapp/src/app/api/auth/callback/social-org/[provider]/route.ts`
- Modify: `apps/webapp/src/app/api/auth/callback/social-org/[provider]/route.test.ts`
- Modify: `apps/webapp/src/components/settings/auth/social-accounts.tsx`
- Modify: `apps/webapp/src/components/settings/auth/social-accounts.test.tsx`

- [ ] **Step 1: Write failing issuer mapping tests**

Create `account-issuer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getAccountIssuer } from "./account-issuer";

describe("getAccountIssuer", () => {
	it.each([
		["credential", "local:credential"],
		["google", "https://accounts.google.com"],
		["apple", "https://appleid.apple.com"],
		["github", "local:oauth:github"],
		["linkedin", "local:oauth:linkedin"],
	] as const)("maps %s to its Better Auth issuer", (providerId, issuer) => {
		expect(getAccountIssuer(providerId)).toBe(issuer);
	});

	it("rejects unknown providers", () => {
		expect(() => getAccountIssuer("tenant-oidc")).toThrow("Unknown account provider");
	});
});
```

- [ ] **Step 2: Run the mapping test to verify it fails**

Run:

```bash
pnpm exec vitest run src/lib/auth/account-issuer.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the explicit mapping**

Create `account-issuer.ts`:

```ts
const accountIssuers = {
	credential: "local:credential",
	google: "https://accounts.google.com",
	apple: "https://appleid.apple.com",
	github: "local:oauth:github",
	linkedin: "local:oauth:linkedin",
} as const;

export function getAccountIssuer(providerId: string): string {
	const issuer = accountIssuers[providerId as keyof typeof accountIssuers];
	if (!issuer) throw new Error(`Unknown account provider: ${providerId}`);
	return issuer;
}
```

- [ ] **Step 4: Write failing direct-writer tests**

Create `setup.service.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./setup.service.ts", import.meta.url), "utf8");

describe("platform setup credential account", () => {
	it("writes the Better Auth 1.7 credential issuer and stable user subject", () => {
		const insertStart = source.indexOf("tx.insert(account).values({");
		const insertEnd = source.indexOf("});", insertStart);
		const accountInsert = source.slice(insertStart, insertEnd);

		expect(insertStart).toBeGreaterThan(-1);
		expect(accountInsert).toContain('issuer: "local:credential"');
		expect(accountInsert).toContain("accountId: userId");
		expect(accountInsert).toContain('providerId: "credential"');
		expect(accountInsert).toContain("userId: userId");
	});
});
```

In the existing route test, read `route.ts`, isolate `findOrCreateUserWithAccount`, and add:

```ts
it("uses issuer plus provider subject for organization social accounts", () => {
	const start = routeSource.indexOf("async function findOrCreateUserWithAccount");
	const end = routeSource.indexOf("export async function GET", start);
	const functionSource = routeSource.slice(start, end);

	expect(functionSource).toContain("const issuer = getAccountIssuer(provider)");
	expect(functionSource).toContain("eq(authSchema.account.issuer, issuer)");
	expect(functionSource).toContain("eq(authSchema.account.accountId, providerUserId)");
	expect(functionSource.match(/\n\s+issuer,/g)).toHaveLength(2);
	expect(functionSource.match(/\n\s+providerId: provider,/g)).toHaveLength(2);
});
```

- [ ] **Step 5: Run direct-writer tests to verify they fail**

Run:

```bash
pnpm exec vitest run src/lib/effect/services/setup.service.test.ts 'src/app/api/auth/callback/social-org/[provider]/route.test.ts'
```

Expected: FAIL because inserts omit issuer and lookup still uses `providerId`.

- [ ] **Step 6: Update credential and social account writes**

Add to the setup service insert:

```ts
issuer: "local:credential",
```

In `findOrCreateUserWithAccount`, resolve once:

```ts
const issuer = getAccountIssuer(provider);
```

Change account lookup to:

```ts
where: and(
	eq(authSchema.account.issuer, issuer),
	eq(authSchema.account.accountId, providerUserId),
),
```

Add `issuer` to both account inserts while retaining `providerId: provider`.

- [ ] **Step 7: Write the failing unlink-selector test**

Use distinct IDs:

```ts
const connectedAccount = {
	id: "local-row-1",
	providerId: "github",
	accountId: "github-subject-7",
	createdAt: new Date(),
};

expect(unlinkAccountMock).toHaveBeenCalledWith({
	accountId: "local-row-1",
});
```

Assert the payload has no `providerId` property.

- [ ] **Step 8: Use only the local account row selector**

Change the ref and mutation input to `{ accountRowId: string }`, then call:

```ts
authClient.unlinkAccount({ accountId: accountRowId });
```

Call `confirmUnlink(connectedAccount.id)`; do not pass provider-side `accountId` or `providerId`.

- [ ] **Step 9: Run focused tests and commit**

Run:

```bash
pnpm exec vitest run src/lib/auth/account-issuer.test.ts src/lib/effect/services/setup.service.test.ts 'src/app/api/auth/callback/social-org/[provider]/route.test.ts' src/components/settings/auth/social-accounts.test.tsx
```

Expected: PASS.

```bash
git add apps/webapp/src/lib/auth/account-issuer.ts apps/webapp/src/lib/auth/account-issuer.test.ts apps/webapp/src/lib/effect/services/setup.service.ts apps/webapp/src/lib/effect/services/setup.service.test.ts 'apps/webapp/src/app/api/auth/callback/social-org/[provider]/route.ts' 'apps/webapp/src/app/api/auth/callback/social-org/[provider]/route.test.ts' apps/webapp/src/components/settings/auth/social-accounts.tsx apps/webapp/src/components/settings/auth/social-accounts.test.tsx
git commit -m "fix: scope Better Auth accounts by issuer"
```

### Task 8: Narrow Two-Factor Enrollment Responses

**Files:**
- Create: `apps/webapp/src/components/settings/auth/two-factor-enrollment-response.test.ts`
- Create: `apps/webapp/src/components/settings/auth/two-factor-enrollment-response.ts`
- Modify: `apps/webapp/src/components/settings/auth/use-two-factor-setup-controller.ts:21-60`

- [ ] **Step 1: Write failing parser tests**

Create:

```ts
import { describe, expect, it } from "vitest";
import { parseTotpEnrollment } from "./two-factor-enrollment-response";

describe("parseTotpEnrollment", () => {
	it("returns TOTP enrollment data", () => {
		expect(
			parseTotpEnrollment({
				method: "totp",
				totpURI: "otpauth://totp/Z8:user",
				backupCodes: ["code-1"],
			}),
		).toEqual({ totpURI: "otpauth://totp/Z8:user", backupCodes: ["code-1"] });
	});

	it("rejects non-TOTP enrollment", () => {
		expect(() => parseTotpEnrollment({ method: "otp" })).toThrow(
			"Expected TOTP enrollment response",
		);
	});
});
```

Also test blank `totpURI` and non-array `backupCodes` through `unknown` input.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm exec vitest run src/components/settings/auth/two-factor-enrollment-response.test.ts
```

Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Implement the runtime parser**

Create:

```ts
export function parseTotpEnrollment(value: unknown): {
	totpURI: string;
	backupCodes: string[];
} {
	if (!value || typeof value !== "object") {
		throw new Error("Expected TOTP enrollment response");
	}
	const response = value as Record<string, unknown>;
	if (
		response.method !== "totp" ||
		typeof response.totpURI !== "string" ||
		response.totpURI.length === 0 ||
		!Array.isArray(response.backupCodes) ||
		!response.backupCodes.every((code) => typeof code === "string")
	) {
		throw new Error("Expected TOTP enrollment response");
	}
	return { totpURI: response.totpURI, backupCodes: response.backupCodes };
}
```

- [ ] **Step 4: Request and consume TOTP explicitly**

Change the enable request and success branch:

```ts
const result = await authClient.twoFactor.enable({
	password: state.password,
	method: "totp",
});
```

```ts
} else if (result.data) {
	const enrollment = parseTotpEnrollment(result.data);
	actions.setTotpUri(enrollment.totpURI);
	actions.setBackupCodes(enrollment.backupCodes);
```

The existing `catch` displays the controlled parser error and does not open the setup dialog.

- [ ] **Step 5: Run the focused test and typecheck the file**

Run:

```bash
pnpm exec vitest run src/components/settings/auth/two-factor-enrollment-response.test.ts
pnpm exec tsc --project tsconfig.typecheck.json --noEmit --incremental false --pretty false
```

Expected: parser tests PASS and the previous `totpURI`/`backupCodes` union errors are absent.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/components/settings/auth/two-factor-enrollment-response.ts apps/webapp/src/components/settings/auth/two-factor-enrollment-response.test.ts apps/webapp/src/components/settings/auth/use-two-factor-setup-controller.ts
git commit -m "fix: narrow Better Auth two-factor enrollment"
```

### Task 9: Generate And Guard The Account Issuer Migration

**Files:**
- Create: `apps/webapp/drizzle/0061_better_auth_account_issuer.sql`
- Create: `apps/webapp/drizzle/meta/0061_snapshot.json`
- Modify: `apps/webapp/drizzle/meta/_journal.json`
- Create: `apps/webapp/src/db/__tests__/better-auth-account-issuer-migration.test.ts`

- [ ] **Step 1: Generate migration metadata from final schema**

Run from `apps/webapp`:

```bash
pnpm drizzle-kit generate --name better_auth_account_issuer
```

Expected: migration index `0061`, a journal entry, and a final-state snapshot. If concurrent work has already claimed `0061`, stop and rebase this plan's paths to the next contiguous migration index before editing.

- [ ] **Step 2: Write failing migration contract tests**

Create a test that reads the SQL and snapshot and asserts ordered operations:

```ts
const addIssuer = migration.indexOf('ADD COLUMN "issuer" text');
const reservedProviderGuard = migration.indexOf("SSO provider ID conflicts with a built-in provider");
const credentialBackfill = migration.indexOf("local:credential");
const unknownProviderGuard = migration.indexOf("Unmapped Better Auth account providers");
const customMappingGuard = migration.indexOf("Legacy SSO subject mappings require manual migration");
const collisionGuard = migration.indexOf("Account issuer identity collision detected");
const notNull = migration.indexOf('ALTER COLUMN "issuer" SET NOT NULL');
const uniqueIndex = migration.indexOf("CREATE UNIQUE INDEX");

expect(addIssuer).toBeGreaterThan(-1);
expect(reservedProviderGuard).toBeGreaterThan(addIssuer);
expect(credentialBackfill).toBeGreaterThan(reservedProviderGuard);
expect(customMappingGuard).toBeGreaterThan(credentialBackfill);
expect(unknownProviderGuard).toBeGreaterThan(customMappingGuard);
expect(collisionGuard).toBeGreaterThan(unknownProviderGuard);
expect(notNull).toBeGreaterThan(collisionGuard);
expect(uniqueIndex).toBeGreaterThan(notNull);
expect(migration).not.toMatch(/DROP TABLE\s+"scim_provider"/i);
```

Parse the snapshot and assert `public.account.columns.issuer.notNull === true`, exactly one unique account index has expressions `issuer` and `account_id`, and `public.scim_provider` remains present.

- [ ] **Step 3: Run migration tests to verify generated SQL is unsafe**

Run:

```bash
pnpm exec vitest run src/db/__tests__/better-auth-account-issuer-migration.test.ts src/db/__tests__/drizzle-migrations.test.ts
```

Expected: the focused test FAILS because generated SQL attempts a direct required-column change without trusted backfill guards.

- [ ] **Step 4: Replace only the generated SQL body with guarded PostgreSQL SQL**

Keep the generated journal and final snapshot. Replace the SQL body with this sequence, using the exact generated unique-index name in the final statement:

```sql
ALTER TABLE "account" ADD COLUMN "issuer" text;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "sso_provider"
    WHERE "provider_id" IN ('credential', 'google', 'apple', 'github', 'linkedin')
  ) THEN
    RAISE EXCEPTION 'SSO provider ID conflicts with a built-in provider';
  END IF;
END $$;
--> statement-breakpoint
UPDATE "account"
SET "issuer" = 'local:credential', "account_id" = "user_id"
WHERE "provider_id" = 'credential';
--> statement-breakpoint
UPDATE "account"
SET "issuer" = CASE "provider_id"
  WHEN 'google' THEN 'https://accounts.google.com'
  WHEN 'apple' THEN 'https://appleid.apple.com'
  WHEN 'github' THEN 'local:oauth:github'
  WHEN 'linkedin' THEN 'local:oauth:linkedin'
END
WHERE "provider_id" IN ('google', 'apple', 'github', 'linkedin');
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "sso_provider"
    WHERE
      ("oidc_config" IS NOT NULL AND ("oidc_config"::jsonb #> '{mapping}') ? 'id')
      OR ("saml_config" IS NOT NULL AND ("saml_config"::jsonb #> '{mapping}') ? 'id')
  ) THEN
    RAISE EXCEPTION 'Legacy SSO subject mappings require manual migration';
  END IF;
END $$;
--> statement-breakpoint
UPDATE "account" AS account_row
SET "issuer" = provider."issuer"
FROM "sso_provider" AS provider
WHERE
  account_row."provider_id" = provider."provider_id"
  AND provider."oidc_config" IS NOT NULL
  AND provider."issuer" IS NOT NULL
  AND btrim(provider."issuer") <> '';
--> statement-breakpoint
DO $$
DECLARE
  provider_row record;
  metadata_xml text;
  entity_id text;
BEGIN
  FOR provider_row IN
    SELECT "provider_id", "saml_config"
    FROM "sso_provider"
    WHERE "saml_config" IS NOT NULL
  LOOP
    metadata_xml := COALESCE(
      provider_row."saml_config"::jsonb #>> '{idpMetadata,metadata}',
      provider_row."saml_config"::jsonb #>> '{metadata}'
    );
    IF metadata_xml IS NULL OR btrim(metadata_xml) = '' THEN
      RAISE EXCEPTION 'SAML provider metadata is required for account issuer migration';
    END IF;
    SELECT NULLIF(
      btrim((xpath(
        'string(/*[local-name()="EntityDescriptor"]/@entityID)',
        metadata_xml::xml
      ))[1]::text),
      ''
    ) INTO entity_id;
    IF entity_id IS NULL THEN
      RAISE EXCEPTION 'SAML provider entity ID is required for account issuer migration';
    END IF;
    UPDATE "account"
    SET "issuer" = entity_id
    WHERE "provider_id" = provider_row."provider_id";
  END LOOP;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "account"
    WHERE "issuer" IS NULL OR btrim("issuer") = ''
  ) THEN
    RAISE EXCEPTION 'Unmapped Better Auth account providers';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "account"
    GROUP BY "issuer", "account_id"
    HAVING count(*) > 1 OR count(DISTINCT "user_id") > 1
  ) THEN
    RAISE EXCEPTION 'Account issuer identity collision detected';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx"
ON "account" USING btree ("issuer", "account_id");
```

Use the generated index name if it differs. The reserved-provider guard prevents a tenant-defined SSO provider from being silently assigned a built-in provider's issuer. Keep exception messages free of account IDs, provider subjects, emails, tokens, and secrets.

- [ ] **Step 5: Verify generated non-account statements are preserved deliberately**

Compare the original generated SQL with the guarded replacement. If the 1.7 generator emitted additive statements unrelated to `account.issuer`, retain those exact statements after the issuer index and add snapshot assertions for them. Reject any generated `DROP TABLE` or `DROP COLUMN` affecting legacy SCIM data. With the current plugin configuration, no Better Auth organization-team counter tables are active, so no team-counter SQL is expected.

- [ ] **Step 6: Run migration tests**

Run:

```bash
pnpm exec vitest run src/db/__tests__/better-auth-account-issuer-migration.test.ts src/db/__tests__/drizzle-migrations.test.ts
```

Expected: PASS, including journal continuity, snapshot chain, no legacy SCIM drop, and all guard-order assertions.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/drizzle/0061_better_auth_account_issuer.sql apps/webapp/drizzle/meta/0061_snapshot.json apps/webapp/drizzle/meta/_journal.json apps/webapp/src/db/__tests__/better-auth-account-issuer-migration.test.ts
git commit -m "feat: migrate Better Auth account issuers"
```

### Task 10: Add The Maintenance-Window Runbook And Verify The Release

**Files:**
- Create: `docs/refs/better-auth-1-7-account-migration.md`

- [ ] **Step 1: Write the operational runbook**

Create the document with these exact phases:

````markdown
# Better Auth 1.7 Account Migration

## Preconditions

- Use Node.js 22.12 or newer for Better Auth CLI commands.
- Back up `account`, `user`, and `sso_provider`.
- Stop all authentication, account-linking, setup, admin, and background account writes.
- Do not run this migration while an old application instance can insert accounts.

## Inventory

```sql
SELECT provider_id, COUNT(*) FROM account GROUP BY provider_id ORDER BY provider_id;

SELECT
  provider_id,
  issuer,
  oidc_config IS NOT NULL AS has_oidc_config,
  saml_config IS NOT NULL AS has_saml_config
FROM sso_provider
ORDER BY provider_id;

SELECT provider_id
FROM sso_provider
WHERE
  (oidc_config IS NOT NULL AND (oidc_config::jsonb #> '{mapping}') ? 'id')
  OR (saml_config IS NOT NULL AND (saml_config::jsonb #> '{mapping}') ? 'id');
```

The final query must return zero rows. If it does not, obtain a trusted old-to-new subject mapping from the identity provider and stop this deployment. Never map by email.

## Dry Run

- Restore a production snapshot into an isolated PostgreSQL database.
- Apply all pending Drizzle migrations there.
- Confirm the issuer migration reports no unmapped providers or collisions.
- Exercise credential, social, OIDC, and SAML sign-in against the isolated environment.

## Apply

- Keep authentication writes stopped.
- Apply the reviewed Drizzle migration through the normal deployment migration runner.
- Deploy the Better Auth 1.7 application and generated schema together.

## Verify Before Restoring Traffic

```sql
SELECT COUNT(*) FROM account WHERE issuer IS NULL OR btrim(issuer) = '';

SELECT issuer, account_id, COUNT(*), COUNT(DISTINCT user_id)
FROM account
GROUP BY issuer, account_id
HAVING COUNT(*) > 1 OR COUNT(DISTINCT user_id) > 1;

SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'account' AND indexdef LIKE '%issuer%account_id%';
```

The first two queries must return zero problem rows. The final query must show the unique issuer/account index.

## Functional Checks

- Email/password sign-in and password reset.
- Google, GitHub, LinkedIn, and Apple sign-in when configured.
- Organization-specific social linking and account unlinking.
- Session retrieval with active organization fields.
- TOTP enrollment and sign-in.
- Passkey registration and sign-in.
- OIDC and SAML SP-initiated sign-in.
- SAML IdP-initiated sign-in.
- Custom-domain callback and cookie origins.
- Rate limiting and single-use verification state.
- SCIM controls are unavailable and all legacy SCIM tables/data remain intact.
````

- [ ] **Step 2: Run focused migration checks**

Run from `apps/webapp`:

```bash
pnpm exec vitest run src/lib/auth.test.ts src/lib/auth-security.test.ts src/lib/redis.test.ts src/lib/auth/guarded-secondary-storage.test.ts src/lib/auth/account-issuer.test.ts src/lib/effect/services/setup.service.test.ts 'src/app/api/auth/callback/social-org/[provider]/route.test.ts' src/components/settings/auth/social-accounts.test.tsx src/components/settings/auth/two-factor-enrollment-response.test.ts 'src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts' src/components/settings/enterprise/identity-setup-wizard.test.tsx src/components/settings/enterprise/enterprise-management.test.tsx src/db/__tests__/better-auth-account-issuer-migration.test.ts src/db/__tests__/drizzle-migrations.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the full quality suite**

Run:

```bash
pnpm test
pnpm run typecheck
CI=true pnpm build
```

Expected: all commands exit 0. Do not run `pnpm run auth:migrate` or `pnpm drizzle-kit push`; those commands mutate the configured database and Phase-provided credentials are unavailable to agents.

- [ ] **Step 4: Review the final generated and migration diff**

Run from the repository root:

```bash
git diff --check
git status --short
git diff -- apps/webapp/src/db/auth-schema.ts apps/webapp/drizzle/0061_better_auth_account_issuer.sql apps/webapp/drizzle/meta/0061_snapshot.json apps/webapp/drizzle/meta/_journal.json
```

Expected: no whitespace errors; only intended files; generated schema and final snapshot agree; SQL never drops `scim_provider`, `scim_provider_config`, or `scim_provisioning_log`.

- [ ] **Step 5: Commit the runbook**

```bash
git add docs/refs/better-auth-1-7-account-migration.md
git commit -m "docs: add Better Auth migration runbook"
```

Do not commit unrelated concurrent changes.
