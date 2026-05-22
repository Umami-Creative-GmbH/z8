# Scaleway Key Manager Secret Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selectable organization secret store that keeps Vault as the default and supports Scaleway Key Manager-backed encrypted Postgres storage for customer-entered organization secrets.

**Architecture:** Keep the existing public `@/lib/vault` helper API stable and route it through an internal provider selector. Vault mode delegates to the current Vault implementation. Scaleway mode stores ciphertext rows in Postgres, automatically provisions one Scaleway Key Manager symmetric key per organization, and calls Key Manager for encrypt/decrypt operations with associated data bound to `organizationId` and logical secret key.

**Tech Stack:** Next.js 16, TypeScript, Drizzle ORM, PostgreSQL, Vitest, `@t3-oss/env-nextjs`, Scaleway Key Manager HTTP API via built-in `fetch`.

---

## File Map

- Modify: `apps/webapp/src/env.ts` - add `SECRET_STORE_PROVIDER` and Scaleway env vars with conditional validation.
- Create: `apps/webapp/src/env.test.ts` - test conditional env validation with module isolation.
- Create: `apps/webapp/src/db/schema/secret-store.ts` - Drizzle tables for org key metadata and encrypted org secret rows.
- Modify: `apps/webapp/src/db/schema/index.ts` - export new schema file.
- Modify: `apps/webapp/src/db/index.ts` - export new tables from the top-level db barrel.
- Create: `apps/webapp/src/db/schema/__tests__/secret-store-schema.test.ts` - schema-level tests for inserts and metadata.
- Create: `apps/webapp/src/lib/vault/types.ts` - shared provider interface.
- Create: `apps/webapp/src/lib/vault/vault-provider.ts` - move current Vault logic into a provider class.
- Create: `apps/webapp/src/lib/vault/scaleway-key-manager-client.ts` - small HTTP client for Key Manager list/create/get/encrypt/decrypt.
- Create: `apps/webapp/src/lib/vault/scaleway-provider.ts` - encrypted Postgres provider and idempotent org key provisioning.
- Modify: `apps/webapp/src/lib/vault/secrets.ts` - replace direct Vault implementation with provider selector wrapper.
- Create: `apps/webapp/src/lib/vault/secrets.test.ts` - provider selection and wrapper behavior tests.
- Create: `apps/webapp/src/lib/vault/scaleway-key-manager-client.test.ts` - API request/response tests.
- Create: `apps/webapp/src/lib/vault/scaleway-provider.test.ts` - provisioning, encryption/decryption, and delete behavior tests.
- Modify or create: Drizzle migration files under `apps/webapp/drizzle/` - generated after schema changes; do not hand-edit snapshots unless the repository pattern requires it.

## Task 1: Conditional Environment Validation

**Files:**
- Modify: `apps/webapp/src/env.ts`
- Create: `apps/webapp/src/env.test.ts`

- [ ] **Step 1: Write failing env validation tests**

Create `apps/webapp/src/env.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function resetEnv(overrides: Record<string, string | undefined>) {
	process.env = { ...ORIGINAL_ENV };
	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	process.env.SKIP_ENV_VALIDATION = "false";
	process.env.CI = "false";
	process.env.BETTER_AUTH_SECRET = "test-secret-key-32-characters-minimum!";
	process.env.S3_BUCKET = "test-bucket";
	process.env.S3_ACCESS_KEY_ID = "test-access-key";
	process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
	process.env.S3_ENDPOINT = "https://s3.example.test";
	process.env.S3_PUBLIC_URL = "https://public-s3.example.test";
}

async function importEnv() {
	vi.resetModules();
	return import("./env");
}

describe("env secret store validation", () => {
	afterEach(() => {
		process.env = { ...ORIGINAL_ENV };
		vi.restoreAllMocks();
	});

	it("defaults to vault without Scaleway credentials", async () => {
		resetEnv({
			SECRET_STORE_PROVIDER: undefined,
			SCALEWAY_ACCESS_KEY: undefined,
			SCALEWAY_SECRET_KEY: undefined,
			SCALEWAY_PROJECT_ID: undefined,
		});

		const { env } = await importEnv();

		expect(env.SECRET_STORE_PROVIDER).toBe("vault");
		expect(env.SCALEWAY_REGION).toBe("fr-par");
		expect(env.SCALEWAY_KEY_MANAGER_API_URL).toBe("https://api.scaleway.com");
	});

	it("fails startup when scaleway provider is selected without required Scaleway credentials", async () => {
		resetEnv({
			SECRET_STORE_PROVIDER: "scaleway",
			SCALEWAY_ACCESS_KEY: undefined,
			SCALEWAY_SECRET_KEY: undefined,
			SCALEWAY_PROJECT_ID: undefined,
		});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
			throw new Error("process.exit called");
		}) as never);

		await expect(importEnv()).rejects.toThrow("process.exit called");
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("accepts scaleway provider when required Scaleway credentials are present", async () => {
		resetEnv({
			SECRET_STORE_PROVIDER: "scaleway",
			SCALEWAY_ACCESS_KEY: "SCWACCESSKEY",
			SCALEWAY_SECRET_KEY: "scw-secret-key",
			SCALEWAY_PROJECT_ID: "6170692e-7363-616c-6577-61792e636f6d",
		});

		const { env } = await importEnv();

		expect(env.SECRET_STORE_PROVIDER).toBe("scaleway");
		expect(env.SCALEWAY_ACCESS_KEY).toBe("SCWACCESSKEY");
		expect(env.SCALEWAY_SECRET_KEY).toBe("scw-secret-key");
		expect(env.SCALEWAY_PROJECT_ID).toBe("6170692e-7363-616c-6577-61792e636f6d");
	});
});
```

- [ ] **Step 2: Run the env tests and verify they fail**

Run: `pnpm --filter webapp test -- src/env.test.ts`

Expected: FAIL because `SECRET_STORE_PROVIDER` and Scaleway env vars are not defined in `apps/webapp/src/env.ts`.

- [ ] **Step 3: Add conditional env schema**

Modify `apps/webapp/src/env.ts` by adding these server fields near the existing Vault section:

```ts
		// Organization secret store backend
		SECRET_STORE_PROVIDER: z.enum(["vault", "scaleway"]).default("vault"),

		// Scaleway Key Manager for customer-entered organization secrets
		SCALEWAY_ACCESS_KEY: z.string().optional(),
		SCALEWAY_SECRET_KEY: z.string().optional(),
		SCALEWAY_PROJECT_ID: z.string().optional(),
		SCALEWAY_REGION: z.enum(["fr-par", "nl-ams", "pl-waw"]).default("fr-par"),
		SCALEWAY_KEY_MANAGER_API_URL: z.url().default("https://api.scaleway.com"),
```

Add matching entries to `runtimeEnv`:

```ts
		SECRET_STORE_PROVIDER: process.env.SECRET_STORE_PROVIDER,
		SCALEWAY_ACCESS_KEY: process.env.SCALEWAY_ACCESS_KEY,
		SCALEWAY_SECRET_KEY: process.env.SCALEWAY_SECRET_KEY,
		SCALEWAY_PROJECT_ID: process.env.SCALEWAY_PROJECT_ID,
		SCALEWAY_REGION: process.env.SCALEWAY_REGION,
		SCALEWAY_KEY_MANAGER_API_URL: process.env.SCALEWAY_KEY_MANAGER_API_URL,
```

Apply conditional validation by refining the server schema object before passing it to `createEnv`:

```ts
const serverSchema = z
	.object({
		// keep the existing server fields here
	})
	.superRefine((value, ctx) => {
		if (value.SECRET_STORE_PROVIDER !== "scaleway") return;

		for (const key of ["SCALEWAY_ACCESS_KEY", "SCALEWAY_SECRET_KEY", "SCALEWAY_PROJECT_ID"] as const) {
			if (!value[key]) {
				ctx.addIssue({
					code: "custom",
					path: [key],
					message: `${key} is required when SECRET_STORE_PROVIDER=scaleway`,
				});
			}
		}
	});
```

Then use `server: serverSchema` in `createEnv`. Preserve all existing server env fields; only wrap them in `z.object(...).superRefine(...)`.

- [ ] **Step 4: Run the env tests and verify they pass**

Run: `pnpm --filter webapp test -- src/env.test.ts`

Expected: PASS.

## Task 2: Add Secret Store Database Schema

**Files:**
- Create: `apps/webapp/src/db/schema/secret-store.ts`
- Modify: `apps/webapp/src/db/schema/index.ts`
- Modify: `apps/webapp/src/db/index.ts`
- Create: `apps/webapp/src/db/schema/__tests__/secret-store-schema.test.ts`

- [ ] **Step 1: Write schema tests**

Create `apps/webapp/src/db/schema/__tests__/secret-store-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { organizationSecret, organizationSecretKey } from "@/db/schema/secret-store";

describe("secret store schema", () => {
	it("types Scaleway organization key metadata without key material", () => {
		const row: typeof organizationSecretKey.$inferInsert = {
			organizationId: "org_123",
			provider: "scaleway",
			scalewayKeyId: "6170692e-7363-616c-6577-61792e636f6d",
			region: "fr-par",
		};

		expect(row.provider).toBe("scaleway");
		expect("keyMaterial" in row).toBe(false);
	});

	it("types encrypted organization secret rows without plaintext", () => {
		const row: typeof organizationSecret.$inferInsert = {
			organizationId: "org_123",
			key: "email/smtp_password",
			provider: "scaleway",
			kmsKeyId: "6170692e-7363-616c-6577-61792e636f6d",
			ciphertext: "encrypted-payload",
		};

		expect(row.key).toBe("email/smtp_password");
		expect("value" in row).toBe(false);
		expect("plaintext" in row).toBe(false);
	});

	it("exposes expected Drizzle column names", () => {
		expect(organizationSecretKey.organizationId.name).toBe("organization_id");
		expect(organizationSecretKey.scalewayKeyId.name).toBe("scaleway_key_id");
		expect(organizationSecret.organizationId.name).toBe("organization_id");
		expect(organizationSecret.ciphertext.name).toBe("ciphertext");
	});
});
```

- [ ] **Step 2: Run the schema tests and verify they fail**

Run: `pnpm --filter webapp test -- src/db/schema/__tests__/secret-store-schema.test.ts`

Expected: FAIL because `@/db/schema/secret-store` does not exist.

- [ ] **Step 3: Add schema file**

Create `apps/webapp/src/db/schema/secret-store.ts`:

```ts
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { organization } from "../auth-schema";

export const secretStoreProviderEnum = pgEnum("secret_store_provider", ["vault", "scaleway"]);

export const organizationSecretKey = pgTable(
	"organization_secret_key",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		provider: secretStoreProviderEnum("provider").notNull(),
		scalewayKeyId: text("scaleway_key_id").notNull(),
		region: text("region").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		disabledAt: timestamp("disabled_at"),
	},
	(table) => [
		index("organizationSecretKey_organizationId_idx").on(table.organizationId),
		uniqueIndex("organizationSecretKey_org_provider_active_idx")
			.on(table.organizationId, table.provider)
			.where(sql`${table.disabledAt} IS NULL`),
		uniqueIndex("organizationSecretKey_scalewayKeyId_idx").on(table.scalewayKeyId),
	],
);

export const organizationSecret = pgTable(
	"organization_secret",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		key: text("key").notNull(),
		provider: secretStoreProviderEnum("provider").notNull(),
		kmsKeyId: text("kms_key_id").notNull(),
		ciphertext: text("ciphertext").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("organizationSecret_organizationId_idx").on(table.organizationId),
		uniqueIndex("organizationSecret_org_key_idx").on(table.organizationId, table.key),
	],
);
```

Also add the missing import at the top of this new file:

```ts
import { sql } from "drizzle-orm";
```

- [ ] **Step 4: Export the schema**

Add to `apps/webapp/src/db/schema/index.ts` near the other domain exports:

```ts
export * from "./secret-store";
```

Add to the named export block in `apps/webapp/src/db/index.ts`:

```ts
	organizationSecret,
	organizationSecretKey,
	secretStoreProviderEnum,
```

- [ ] **Step 5: Run the schema tests and typecheck the touched schema**

Run: `pnpm --filter webapp test -- src/db/schema/__tests__/secret-store-schema.test.ts`

Expected: PASS.

Run: `pnpm --filter webapp exec tsc --noEmit --pretty false`

Expected: PASS or unrelated pre-existing type errors only. Fix type errors introduced by this task.

## Task 3: Extract Vault Provider and Add Provider Selector

**Files:**
- Create: `apps/webapp/src/lib/vault/types.ts`
- Create: `apps/webapp/src/lib/vault/vault-provider.ts`
- Modify: `apps/webapp/src/lib/vault/secrets.ts`
- Create: `apps/webapp/src/lib/vault/secrets.test.ts`

- [ ] **Step 1: Write provider selector tests**

Create `apps/webapp/src/lib/vault/secrets.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	env: { SECRET_STORE_PROVIDER: "vault" },
	vaultStore: vi.fn(),
	vaultGet: vi.fn(),
	vaultDelete: vi.fn(),
	vaultDeleteAll: vi.fn(),
	scalewayStore: vi.fn(),
	scalewayGet: vi.fn(),
	scalewayDelete: vi.fn(),
	scalewayDeleteAll: vi.fn(),
}));

vi.mock("@/env", () => ({ env: mockState.env }));

vi.mock("./vault-provider", () => ({
	vaultSecretProvider: {
		storeOrgSecret: mockState.vaultStore,
		getOrgSecret: mockState.vaultGet,
		deleteOrgSecret: mockState.vaultDelete,
		deleteAllOrgSecrets: mockState.vaultDeleteAll,
	},
}));

vi.mock("./scaleway-provider", () => ({
	scalewaySecretProvider: {
		storeOrgSecret: mockState.scalewayStore,
		getOrgSecret: mockState.scalewayGet,
		deleteOrgSecret: mockState.scalewayDelete,
		deleteAllOrgSecrets: mockState.scalewayDeleteAll,
	},
}));

const secrets = await import("./secrets");

describe("organization secret provider selection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.env.SECRET_STORE_PROVIDER = "vault";
	});

	it("uses Vault provider by default", async () => {
		mockState.vaultGet.mockResolvedValue("vault-value");

		await expect(secrets.getOrgSecret("org_1", "email/smtp_password")).resolves.toBe("vault-value");

		expect(mockState.vaultGet).toHaveBeenCalledWith("org_1", "email/smtp_password");
		expect(mockState.scalewayGet).not.toHaveBeenCalled();
	});

	it("uses Scaleway provider when configured", async () => {
		mockState.env.SECRET_STORE_PROVIDER = "scaleway";
		mockState.scalewayStore.mockResolvedValue(undefined);

		await secrets.storeOrgSecret("org_1", "email/smtp_password", "secret-value");

		expect(mockState.scalewayStore).toHaveBeenCalledWith("org_1", "email/smtp_password", "secret-value");
		expect(mockState.vaultStore).not.toHaveBeenCalled();
	});

	it("stores multiple secrets through the selected provider", async () => {
		mockState.env.SECRET_STORE_PROVIDER = "scaleway";
		mockState.scalewayStore.mockResolvedValue(undefined);

		await secrets.storeOrgSecrets("org_1", {
			"email/smtp_password": "smtp-secret",
			"sso/provider/client_secret": "oauth-secret",
		});

		expect(mockState.scalewayStore).toHaveBeenCalledTimes(2);
		expect(mockState.vaultStore).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter webapp test -- src/lib/vault/secrets.test.ts`

Expected: FAIL because `vault-provider` and `scaleway-provider` do not exist and `secrets.ts` still contains direct Vault logic.

- [ ] **Step 3: Add provider interface**

Create `apps/webapp/src/lib/vault/types.ts`:

```ts
export interface OrganizationSecretProvider {
	storeOrgSecret(organizationId: string, key: string, value: string): Promise<void>;
	getOrgSecret(organizationId: string, key: string): Promise<string | null>;
	deleteOrgSecret(organizationId: string, key: string): Promise<void>;
	deleteAllOrgSecrets(organizationId: string): Promise<void>;
}
```

- [ ] **Step 4: Move current Vault logic into a provider**

Create `apps/webapp/src/lib/vault/vault-provider.ts` by moving the existing implementation from `secrets.ts` into an object:

```ts
import { createLogger } from "@/lib/logger";
import type { OrganizationSecretProvider } from "./types";
import { initVaultSecrets, isVaultAvailable, vaultClient } from "./client";

const logger = createLogger("VaultSecrets");
const ORG_SECRETS_PATH = "secret/data/organizations";

export const vaultSecretProvider: OrganizationSecretProvider = {
	async storeOrgSecret(organizationId, key, value) {
		if (!(await isVaultAvailable())) {
			throw new Error("Vault is not available. Please ensure Vault is running and configured.");
		}

		await initVaultSecrets();
		const path = `${ORG_SECRETS_PATH}/${organizationId}/${key}`;

		try {
			await vaultClient.write(path, { data: { value } });
			logger.info({ organizationId, key }, "Stored organization secret");
		} catch (error) {
			logger.error({ error, organizationId, key }, "Failed to store organization secret");
			throw new Error(`Failed to store secret: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	},

	async getOrgSecret(organizationId, key) {
		if (!(await isVaultAvailable())) {
			logger.warn("Vault not available, returning null for secret");
			return null;
		}

		await initVaultSecrets();
		const path = `${ORG_SECRETS_PATH}/${organizationId}/${key}`;

		try {
			const result = await vaultClient.read(path);
			return result?.data?.data?.value ?? null;
		} catch (error: unknown) {
			if (error instanceof Error && error.message?.includes("404")) return null;
			logger.error({ error, organizationId, key }, "Failed to retrieve organization secret");
			throw new Error(`Failed to retrieve secret: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	},

	async deleteOrgSecret(organizationId, key) {
		if (!(await isVaultAvailable())) {
			logger.warn("Vault not available, skipping secret deletion");
			return;
		}

		await initVaultSecrets();
		const metadataPath = `secret/metadata/organizations/${organizationId}/${key}`;

		try {
			await vaultClient.delete(metadataPath);
			logger.info({ organizationId, key }, "Deleted organization secret");
		} catch (error: unknown) {
			if (error instanceof Error && error.message?.includes("404")) return;
			logger.error({ error, organizationId, key }, "Failed to delete organization secret");
			throw new Error(`Failed to delete secret: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	},

	async deleteAllOrgSecrets(organizationId) {
		if (!(await isVaultAvailable())) {
			logger.warn("Vault not available, skipping all secrets deletion");
			return;
		}

		await initVaultSecrets();
		const metadataPath = `secret/metadata/organizations/${organizationId}`;

		try {
			const result = await vaultClient.list(metadataPath);
			const keys = result?.data?.keys || [];

			for (const key of keys) {
				try {
					await vaultClient.delete(`${metadataPath}/${key}`);
				} catch {
					logger.warn({ organizationId, key }, "Failed to delete individual secret");
				}
			}

			try {
				await vaultClient.delete(metadataPath);
			} catch {}

			logger.info({ organizationId }, "Deleted all organization secrets");
		} catch (error: unknown) {
			if (error instanceof Error && error.message?.includes("404")) return;
			logger.error({ error, organizationId }, "Failed to delete all organization secrets");
			throw new Error(`Failed to delete secrets: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	},
};
```

- [ ] **Step 5: Add temporary Scaleway provider stub for selector tests**

Create `apps/webapp/src/lib/vault/scaleway-provider.ts`:

```ts
import type { OrganizationSecretProvider } from "./types";

export const scalewaySecretProvider: OrganizationSecretProvider = {
	async storeOrgSecret() {
		throw new Error("Scaleway secret provider is not implemented yet");
	},
	async getOrgSecret() {
		throw new Error("Scaleway secret provider is not implemented yet");
	},
	async deleteOrgSecret() {
		throw new Error("Scaleway secret provider is not implemented yet");
	},
	async deleteAllOrgSecrets() {
		throw new Error("Scaleway secret provider is not implemented yet");
	},
};
```

- [ ] **Step 6: Replace `secrets.ts` with wrapper functions**

Replace `apps/webapp/src/lib/vault/secrets.ts` with:

```ts
import { env } from "@/env";
import { scalewaySecretProvider } from "./scaleway-provider";
import type { OrganizationSecretProvider } from "./types";
import { vaultSecretProvider } from "./vault-provider";

function getProvider(): OrganizationSecretProvider {
	return env.SECRET_STORE_PROVIDER === "scaleway" ? scalewaySecretProvider : vaultSecretProvider;
}

export async function storeOrgSecret(organizationId: string, key: string, value: string): Promise<void> {
	return getProvider().storeOrgSecret(organizationId, key, value);
}

export async function getOrgSecret(organizationId: string, key: string): Promise<string | null> {
	return getProvider().getOrgSecret(organizationId, key);
}

export async function deleteOrgSecret(organizationId: string, key: string): Promise<void> {
	return getProvider().deleteOrgSecret(organizationId, key);
}

export async function deleteAllOrgSecrets(organizationId: string): Promise<void> {
	return getProvider().deleteAllOrgSecrets(organizationId);
}

export async function hasOrgSecret(organizationId: string, key: string): Promise<boolean> {
	const secret = await getOrgSecret(organizationId, key);
	return secret !== null;
}

export async function storeOrgSecrets(organizationId: string, secrets: Record<string, string>): Promise<void> {
	for (const [key, value] of Object.entries(secrets)) {
		await storeOrgSecret(organizationId, key, value);
	}
}
```

- [ ] **Step 7: Run selector tests**

Run: `pnpm --filter webapp test -- src/lib/vault/secrets.test.ts`

Expected: PASS.

## Task 4: Add Scaleway Key Manager HTTP Client

**Files:**
- Create: `apps/webapp/src/lib/vault/scaleway-key-manager-client.ts`
- Create: `apps/webapp/src/lib/vault/scaleway-key-manager-client.test.ts`

- [ ] **Step 1: Write client tests**

Create `apps/webapp/src/lib/vault/scaleway-key-manager-client.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

const { ScalewayKeyManagerClient } = await import("./scaleway-key-manager-client");

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("ScalewayKeyManagerClient", () => {
	beforeEach(() => {
		mockFetch.mockReset();
	});

	it("lists active keys with project and tag filters", async () => {
		mockFetch.mockResolvedValue(jsonResponse({ keys: [{ id: "key-1", state: "enabled" }] }));
		const client = new ScalewayKeyManagerClient({
			apiUrl: "https://api.scaleway.com",
			secretKey: "secret-token",
			projectId: "project-1",
			region: "fr-par",
		});

		const keys = await client.listOrganizationKeys("org_123");

		expect(keys).toEqual([{ id: "key-1", state: "enabled" }]);
		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining("/key-manager/v1alpha1/regions/fr-par/keys"),
			expect.objectContaining({ headers: expect.objectContaining({ "X-Auth-Token": "secret-token" }) }),
		);
		expect(String(mockFetch.mock.calls[0][0])).toContain("project_id=project-1");
		expect(String(mockFetch.mock.calls[0][0])).toContain("scheduled_for_deletion=false");
		expect(String(mockFetch.mock.calls[0][0])).toContain("tags=z8-org%3Aorg_123");
	});

	it("creates a protected AES-256-GCM organization key", async () => {
		mockFetch.mockResolvedValue(jsonResponse({ id: "key-1", state: "enabled" }));
		const client = new ScalewayKeyManagerClient({ apiUrl: "https://api.scaleway.com", secretKey: "secret-token", projectId: "project-1", region: "fr-par" });

		await client.createOrganizationKey("org_123");

		const body = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
		expect(body).toMatchObject({
			project_id: "project-1",
			name: "z8-org-org_123-customer-secrets",
			usage: { symmetric_encryption: "aes_256_gcm" },
			unprotected: false,
		});
		expect(body.tags).toContain("z8-customer-secrets");
		expect(body.tags).toContain("z8-org:org_123");
	});

	it("encrypts and decrypts payloads with associated data", async () => {
		mockFetch
			.mockResolvedValueOnce(jsonResponse({ key_id: "key-1", ciphertext: "ciphertext" }))
			.mockResolvedValueOnce(jsonResponse({ key_id: "key-1", plaintext: Buffer.from("secret-value", "utf8").toString("base64") }));
		const client = new ScalewayKeyManagerClient({ apiUrl: "https://api.scaleway.com", secretKey: "secret-token", projectId: "project-1", region: "fr-par" });

		await expect(client.encrypt("key-1", "secret-value", "aad-value")).resolves.toBe("ciphertext");
		await expect(client.decrypt("key-1", Buffer.from("ciphertext", "utf8").toString("base64"), "aad-value")).resolves.toBe("secret-value");
	});

	it("throws a sanitized error for non-2xx responses", async () => {
		mockFetch.mockResolvedValue(jsonResponse({ message: "bad token" }, 403));
		const client = new ScalewayKeyManagerClient({ apiUrl: "https://api.scaleway.com", secretKey: "secret-token", projectId: "project-1", region: "fr-par" });

		await expect(client.getKey("key-1")).rejects.toThrow("Scaleway Key Manager request failed with status 403");
	});
});
```

- [ ] **Step 2: Run client tests and verify they fail**

Run: `pnpm --filter webapp test -- src/lib/vault/scaleway-key-manager-client.test.ts`

Expected: FAIL because the client file does not exist.

- [ ] **Step 3: Implement the client**

Create `apps/webapp/src/lib/vault/scaleway-key-manager-client.ts`:

```ts
interface ScalewayKeyManagerClientOptions {
	apiUrl: string;
	secretKey: string;
	projectId: string;
	region: string;
}

interface ScalewayKey {
	id: string;
	state: string;
	region?: string;
}

export class ScalewayKeyManagerClient {
	constructor(private readonly options: ScalewayKeyManagerClientOptions) {}

	async listOrganizationKeys(organizationId: string): Promise<ScalewayKey[]> {
		const url = new URL(`/key-manager/v1alpha1/regions/${this.options.region}/keys`, this.options.apiUrl);
		url.searchParams.set("project_id", this.options.projectId);
		url.searchParams.set("scheduled_for_deletion", "false");
		url.searchParams.append("tags", `z8-org:${organizationId}`);

		const body = await this.request<{ keys?: ScalewayKey[] }>(url, { method: "GET" });
		return body.keys ?? [];
	}

	async getKey(keyId: string): Promise<ScalewayKey> {
		const url = new URL(`/key-manager/v1alpha1/regions/${this.options.region}/keys/${keyId}`, this.options.apiUrl);
		return this.request<ScalewayKey>(url, { method: "GET" });
	}

	async createOrganizationKey(organizationId: string): Promise<ScalewayKey> {
		const url = new URL(`/key-manager/v1alpha1/regions/${this.options.region}/keys`, this.options.apiUrl);
		return this.request<ScalewayKey>(url, {
			method: "POST",
			body: JSON.stringify({
				project_id: this.options.projectId,
				name: `z8-org-${organizationId}-customer-secrets`,
				description: "Z8 customer-entered organization secrets encryption key",
				usage: { symmetric_encryption: "aes_256_gcm" },
				tags: ["z8-customer-secrets", `z8-org:${organizationId}`],
				unprotected: false,
			}),
		});
	}

	async encrypt(keyId: string, plaintext: string, associatedData: string): Promise<string> {
		const url = new URL(`/key-manager/v1alpha1/regions/${this.options.region}/keys/${keyId}/encrypt`, this.options.apiUrl);
		const body = await this.request<{ ciphertext: string }>(url, {
			method: "POST",
			body: JSON.stringify({
				plaintext: Buffer.from(plaintext, "utf8").toString("base64"),
				associated_data: { value: associatedData },
			}),
		});
		return body.ciphertext;
	}

	async decrypt(keyId: string, ciphertext: string, associatedData: string): Promise<string> {
		const url = new URL(`/key-manager/v1alpha1/regions/${this.options.region}/keys/${keyId}/decrypt`, this.options.apiUrl);
		const body = await this.request<{ plaintext: string }>(url, {
			method: "POST",
			body: JSON.stringify({
				ciphertext,
				associated_data: { value: associatedData },
			}),
		});
		return Buffer.from(body.plaintext, "base64").toString("utf8");
	}

	private async request<T>(url: URL, init: RequestInit): Promise<T> {
		const response = await fetch(url, {
			...init,
			headers: {
				"Content-Type": "application/json",
				"X-Auth-Token": this.options.secretKey,
				...init.headers,
			},
		});

		if (!response.ok) {
			throw new Error(`Scaleway Key Manager request failed with status ${response.status}`);
		}

		return (await response.json()) as T;
	}
}
```

- [ ] **Step 4: Run client tests**

Run: `pnpm --filter webapp test -- src/lib/vault/scaleway-key-manager-client.test.ts`

Expected: PASS.

## Task 5: Implement Scaleway Encrypted Postgres Provider

**Files:**
- Modify: `apps/webapp/src/lib/vault/scaleway-provider.ts`
- Create: `apps/webapp/src/lib/vault/scaleway-provider.test.ts`

- [ ] **Step 1: Write provider behavior tests**

Create `apps/webapp/src/lib/vault/scaleway-provider.test.ts` with focused mocks for `@/db`, `drizzle-orm`, `@/env`, and `ScalewayKeyManagerClient`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	findKey: vi.fn(),
	findSecret: vi.fn(),
	insertValues: vi.fn(),
	insertOnConflict: vi.fn(),
	deleteWhere: vi.fn(),
	listOrganizationKeys: vi.fn(),
	getKey: vi.fn(),
	createOrganizationKey: vi.fn(),
	encrypt: vi.fn(),
	decrypt: vi.fn(),
}));

vi.mock("@/env", () => ({
	env: {
		SCALEWAY_KEY_MANAGER_API_URL: "https://api.scaleway.com",
		SCALEWAY_SECRET_KEY: "secret-token",
		SCALEWAY_PROJECT_ID: "project-1",
		SCALEWAY_REGION: "fr-par",
	},
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	isNull: vi.fn((value: unknown) => ({ isNull: value })),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			organizationSecretKey: { findFirst: mockState.findKey },
			organizationSecret: { findFirst: mockState.findSecret },
		},
		insert: vi.fn(() => ({
			values: mockState.insertValues.mockReturnValue({
				onConflictDoUpdate: mockState.insertOnConflict.mockResolvedValue(undefined),
				returning: vi.fn().mockResolvedValue([{ id: "row-1", scalewayKeyId: "key-1", region: "fr-par" }]),
			}),
		})),
		delete: vi.fn(() => ({ where: mockState.deleteWhere.mockResolvedValue(undefined) })),
	},
	organizationSecret: { organizationId: "organizationId", key: "key" },
	organizationSecretKey: { organizationId: "organizationId", provider: "provider", disabledAt: "disabledAt" },
}));

vi.mock("./scaleway-key-manager-client", () => ({
	ScalewayKeyManagerClient: vi.fn().mockImplementation(() => ({
		listOrganizationKeys: mockState.listOrganizationKeys,
		getKey: mockState.getKey,
		createOrganizationKey: mockState.createOrganizationKey,
		encrypt: mockState.encrypt,
		decrypt: mockState.decrypt,
	})),
}));

const { scalewaySecretProvider } = await import("./scaleway-provider");

describe("scalewaySecretProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.findKey.mockResolvedValue(null);
		mockState.findSecret.mockResolvedValue(null);
		mockState.listOrganizationKeys.mockResolvedValue([]);
		mockState.createOrganizationKey.mockResolvedValue({ id: "key-1", state: "enabled" });
		mockState.getKey.mockResolvedValue({ id: "key-1", state: "enabled" });
		mockState.encrypt.mockResolvedValue("ciphertext");
		mockState.decrypt.mockResolvedValue("secret-value");
	});

	it("creates an organization key on first secret save", async () => {
		await scalewaySecretProvider.storeOrgSecret("org_123", "email/smtp_password", "secret-value");

		expect(mockState.listOrganizationKeys).toHaveBeenCalledWith("org_123");
		expect(mockState.createOrganizationKey).toHaveBeenCalledWith("org_123");
		expect(mockState.encrypt).toHaveBeenCalledWith("key-1", "secret-value", "organizationId=org_123;key=email/smtp_password;version=1");
		expect(mockState.insertOnConflict).toHaveBeenCalled();
	});

	it("reuses local key metadata and verifies the remote key", async () => {
		mockState.findKey.mockResolvedValue({ scalewayKeyId: "key-existing", region: "fr-par" });

		await scalewaySecretProvider.storeOrgSecret("org_123", "email/smtp_password", "secret-value");

		expect(mockState.getKey).toHaveBeenCalledWith("key-existing");
		expect(mockState.createOrganizationKey).not.toHaveBeenCalled();
		expect(mockState.encrypt).toHaveBeenCalledWith("key-existing", "secret-value", expect.any(String));
	});

	it("discovers an existing remote organization key when local metadata is missing", async () => {
		mockState.listOrganizationKeys.mockResolvedValue([{ id: "remote-key", state: "enabled" }]);

		await scalewaySecretProvider.storeOrgSecret("org_123", "email/smtp_password", "secret-value");

		expect(mockState.createOrganizationKey).not.toHaveBeenCalled();
		expect(mockState.encrypt).toHaveBeenCalledWith("remote-key", "secret-value", expect.any(String));
	});

	it("throws when local metadata references an unusable key", async () => {
		mockState.findKey.mockResolvedValue({ scalewayKeyId: "key-disabled", region: "fr-par" });
		mockState.getKey.mockResolvedValue({ id: "key-disabled", state: "disabled" });

		await expect(
			scalewaySecretProvider.storeOrgSecret("org_123", "email/smtp_password", "secret-value"),
		).rejects.toThrow("Scaleway organization key is not usable");
		expect(mockState.createOrganizationKey).not.toHaveBeenCalled();
	});

	it("returns null for missing encrypted secret rows", async () => {
		await expect(scalewaySecretProvider.getOrgSecret("org_123", "email/smtp_password")).resolves.toBeNull();
		expect(mockState.decrypt).not.toHaveBeenCalled();
	});

	it("decrypts existing encrypted secret rows", async () => {
		mockState.findSecret.mockResolvedValue({ kmsKeyId: "key-1", ciphertext: "ciphertext" });

		await expect(scalewaySecretProvider.getOrgSecret("org_123", "email/smtp_password")).resolves.toBe("secret-value");
		expect(mockState.decrypt).toHaveBeenCalledWith("key-1", "ciphertext", "organizationId=org_123;key=email/smtp_password;version=1");
	});
});
```

- [ ] **Step 2: Run provider tests and verify they fail**

Run: `pnpm --filter webapp test -- src/lib/vault/scaleway-provider.test.ts`

Expected: FAIL because `scaleway-provider.ts` is still a stub.

- [ ] **Step 3: Implement provider helpers and methods**

Replace `apps/webapp/src/lib/vault/scaleway-provider.ts` with an implementation that:

```ts
import { and, eq, isNull } from "drizzle-orm";
import { env } from "@/env";
import { db, organizationSecret, organizationSecretKey } from "@/db";
import { createLogger } from "@/lib/logger";
import type { OrganizationSecretProvider } from "./types";
import { ScalewayKeyManagerClient } from "./scaleway-key-manager-client";

const logger = createLogger("ScalewaySecretProvider");
const PROVIDER = "scaleway" as const;

const client = new ScalewayKeyManagerClient({
	apiUrl: env.SCALEWAY_KEY_MANAGER_API_URL,
	secretKey: env.SCALEWAY_SECRET_KEY ?? "",
	projectId: env.SCALEWAY_PROJECT_ID ?? "",
	region: env.SCALEWAY_REGION,
});

function associatedData(organizationId: string, key: string): string {
	return `organizationId=${organizationId};key=${key};version=1`;
}

function assertUsableKey(key: { state?: string }) {
	if (key.state !== "enabled") throw new Error("Scaleway organization key is not usable");
}

async function ensureOrganizationKey(organizationId: string): Promise<string> {
	const existing = await db.query.organizationSecretKey.findFirst({
		where: and(
			eq(organizationSecretKey.organizationId, organizationId),
			eq(organizationSecretKey.provider, PROVIDER),
			isNull(organizationSecretKey.disabledAt),
		),
	});

	if (existing) {
		const remote = await client.getKey(existing.scalewayKeyId);
		assertUsableKey(remote);
		return existing.scalewayKeyId;
	}

	const [remoteExisting] = await client.listOrganizationKeys(organizationId);
	const key = remoteExisting ?? (await client.createOrganizationKey(organizationId));
	assertUsableKey(key);

	await db
		.insert(organizationSecretKey)
		.values({
			organizationId,
			provider: PROVIDER,
			scalewayKeyId: key.id,
			region: env.SCALEWAY_REGION,
		})
		.onConflictDoUpdate({
			target: [organizationSecretKey.organizationId, organizationSecretKey.provider],
			set: {
				scalewayKeyId: key.id,
				region: env.SCALEWAY_REGION,
			},
		});

	return key.id;
}

export const scalewaySecretProvider: OrganizationSecretProvider = {
	async storeOrgSecret(organizationId, key, value) {
		const kmsKeyId = await ensureOrganizationKey(organizationId);
		const ciphertext = await client.encrypt(kmsKeyId, value, associatedData(organizationId, key));

		await db
			.insert(organizationSecret)
			.values({ organizationId, key, provider: PROVIDER, kmsKeyId, ciphertext })
			.onConflictDoUpdate({
				target: [organizationSecret.organizationId, organizationSecret.key],
				set: { provider: PROVIDER, kmsKeyId, ciphertext },
			});

		logger.info({ organizationId, key }, "Stored encrypted organization secret");
	},

	async getOrgSecret(organizationId, key) {
		const row = await db.query.organizationSecret.findFirst({
			where: and(eq(organizationSecret.organizationId, organizationId), eq(organizationSecret.key, key)),
		});
		if (!row) return null;
		return client.decrypt(row.kmsKeyId, row.ciphertext, associatedData(organizationId, key));
	},

	async deleteOrgSecret(organizationId, key) {
		await db
			.delete(organizationSecret)
			.where(and(eq(organizationSecret.organizationId, organizationId), eq(organizationSecret.key, key)));
		logger.info({ organizationId, key }, "Deleted encrypted organization secret");
	},

	async deleteAllOrgSecrets(organizationId) {
		await db.delete(organizationSecret).where(eq(organizationSecret.organizationId, organizationId));
		logger.info({ organizationId }, "Deleted encrypted organization secrets");
	},
};
```

If Drizzle rejects partial-index conflict targets for `organizationSecretKey`, change the implementation to insert metadata after remote key discovery and catch unique-constraint errors by re-reading the active local row. Do not create a second active Scaleway key when a local row already exists.

- [ ] **Step 4: Run provider tests**

Run: `pnpm --filter webapp test -- src/lib/vault/scaleway-provider.test.ts`

Expected: PASS.

## Task 6: Generate and Validate Database Migration

**Files:**
- Create/modify: `apps/webapp/drizzle/*.sql`
- Create/modify: `apps/webapp/drizzle/meta/_journal.json`
- Create/modify: `apps/webapp/drizzle/meta/*_snapshot.json`

- [ ] **Step 1: Generate migration from schema**

Run: `pnpm --filter webapp drizzle-kit generate`

Expected: A new migration is generated for `secret_store_provider`, `organization_secret_key`, and `organization_secret`. If the repo uses a different Drizzle command, inspect `apps/webapp/package.json` and use the repository’s existing migration generation command.

- [ ] **Step 2: Inspect the generated SQL**

Open the generated migration and verify it includes:

```sql
CREATE TYPE "public"."secret_store_provider" AS ENUM('vault', 'scaleway');
CREATE TABLE "organization_secret_key" (...);
CREATE TABLE "organization_secret" (...);
CREATE UNIQUE INDEX ... ON "organization_secret" ("organization_id", "key");
```

Expected: no plaintext secret value column, no key material column, and foreign keys reference Better Auth `organization` with `ON DELETE cascade`.

- [ ] **Step 3: Run schema tests again**

Run: `pnpm --filter webapp test -- src/db/schema/__tests__/secret-store-schema.test.ts`

Expected: PASS.

## Task 7: Integration Test Existing Public API

**Files:**
- Modify: `apps/webapp/src/lib/vault/secrets.test.ts`

- [ ] **Step 1: Add public API behavior tests**

Append to `apps/webapp/src/lib/vault/secrets.test.ts`:

```ts
it("deletes all organization secrets through the selected provider", async () => {
	mockState.env.SECRET_STORE_PROVIDER = "scaleway";
	mockState.scalewayDeleteAll.mockResolvedValue(undefined);

	await secrets.deleteAllOrgSecrets("org_1");

	expect(mockState.scalewayDeleteAll).toHaveBeenCalledWith("org_1");
	expect(mockState.vaultDeleteAll).not.toHaveBeenCalled();
});

it("checks secret existence through getOrgSecret", async () => {
	mockState.env.SECRET_STORE_PROVIDER = "scaleway";
	mockState.scalewayGet.mockResolvedValueOnce("secret-value").mockResolvedValueOnce(null);

	await expect(secrets.hasOrgSecret("org_1", "email/smtp_password")).resolves.toBe(true);
	await expect(secrets.hasOrgSecret("org_1", "email/missing")).resolves.toBe(false);
});
```

- [ ] **Step 2: Run all vault secret tests**

Run: `pnpm --filter webapp test -- src/lib/vault/secrets.test.ts src/lib/vault/scaleway-key-manager-client.test.ts src/lib/vault/scaleway-provider.test.ts`

Expected: PASS.

## Task 8: Final Verification

**Files:**
- No new files unless previous tasks expose required fixes.

- [ ] **Step 1: Run focused tests**

Run: `pnpm --filter webapp test -- src/env.test.ts src/db/schema/__tests__/secret-store-schema.test.ts src/lib/vault/secrets.test.ts src/lib/vault/scaleway-key-manager-client.test.ts src/lib/vault/scaleway-provider.test.ts`

Expected: PASS.

- [ ] **Step 2: Run existing secret-adjacent tests**

Run: `pnpm --filter webapp test -- src/lib/social-oauth/service.test.ts src/app/[locale]/(app)/settings/payroll-export/actions.workday.test.ts src/app/[locale]/(app)/settings/enterprise/actions.social-oauth.test.ts`

Expected: PASS. These tests mock `@/lib/vault` or `@/lib/vault/secrets`; if they fail, keep the public exports and call signatures unchanged.

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter webapp exec tsc --noEmit --pretty false`

Expected: PASS or only unrelated pre-existing errors. Fix all errors introduced by this work.

- [ ] **Step 4: Run full test suite if time allows**

Run: `pnpm --filter webapp test`

Expected: PASS. If unrelated tests fail, record the failing test names and why they are unrelated.

## Self-Review Notes

- Spec coverage: provider env switch is Task 1 and Task 3; Scaleway env validation is Task 1; one key per org and automatic lookup/create is Task 5; encrypted PG storage is Task 2 and Task 5; no Secret Manager usage is enforced by using only Key Manager API paths in Task 4; existing helper API stability is Task 3 and Task 7; testing requirements are covered across Tasks 1, 2, 4, 5, 7, and 8.
- Placeholder scan: no implementation steps contain placeholder markers. The only generated-file task is the Drizzle migration, which must be produced by the project tool to stay consistent with Drizzle metadata.
- Type consistency: the plan consistently uses `organizationSecretKey`, `organizationSecret`, `scalewayKeyId`, `kmsKeyId`, `ciphertext`, `SECRET_STORE_PROVIDER`, and provider values `vault`/`scaleway`.

## Operational Notes

- Do not log plaintext secret values, ciphertext bodies, Scaleway API tokens, or decrypted key material.
- Do not add Scaleway Secret Manager permissions or API calls.
- Do not migrate existing Vault values in this implementation; migration is a separate operational task.
- Do not commit during implementation unless the user explicitly requests commits.
