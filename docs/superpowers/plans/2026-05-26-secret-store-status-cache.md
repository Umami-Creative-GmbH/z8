# Secret Store Status Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/settings/enterprise/email` show provider-accurate secret-store availability and cache Scaleway organization key status in Redis for one day.

**Architecture:** Add a provider-neutral secret-store status API behind the existing `@/lib/vault` module. Vault mode wraps the current Vault health result; Scaleway mode checks existing organization key metadata and remote Key Manager state without provisioning, then caches the result in Redis. The email settings server action and client form consume the neutral status shape instead of Vault-specific props.

**Tech Stack:** Next.js server actions, React client components, Drizzle ORM, Redis via `secondaryStorage`, Vitest, TanStack Form, Tolgee translations, Tabler icons.

---

## File Structure

- Create `apps/webapp/src/lib/vault/scaleway-key-utils.ts`: shared Scaleway key metadata type plus enabled/compatible key predicates.
- Create `apps/webapp/src/lib/vault/status.ts`: provider-neutral secret-store status types, Redis cache helpers, Vault status mapping, Scaleway organization key verification, and cache invalidation exports.
- Modify `apps/webapp/src/lib/vault/scaleway-provider.ts`: use shared Scaleway key predicates, call status cache invalidation after successful writes/deletes, and keep provisioning behavior unchanged.
- Modify `apps/webapp/src/lib/vault/index.ts`: export `getSecretStoreStatus` and `invalidateSecretStoreStatusCache` from `status.ts`.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/actions.ts`: replace `getVaultConnectionStatus()` with `getSecretStoreConnectionStatus(organizationId)` and update imports.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/page.tsx`: request organization-scoped secret-store status and pass `secretStoreStatus` to the client component.
- Modify `apps/webapp/src/components/settings/enterprise/email-config-form.tsx`: replace Vault-only prop/type/component names with provider-aware status rendering and Scaleway-specific copy.
- Add `apps/webapp/src/lib/vault/status.test.ts`: test provider status mapping, Scaleway key checks, Redis caching, and cache invalidation.
- Modify `apps/webapp/src/lib/vault/scaleway-provider.test.ts`: test successful store/delete invalidates the status cache.

## Task 1: Add Provider-Neutral Status Tests

**Files:**
- Create: `apps/webapp/src/lib/vault/status.test.ts`
- Create later: `apps/webapp/src/lib/vault/status.ts`

- [ ] **Step 1: Write the failing status tests**

Create `apps/webapp/src/lib/vault/status.test.ts` with:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	env: { SECRET_STORE_PROVIDER: "vault" },
	db: {
		query: {
			organizationSecretKey: { findFirst: vi.fn() },
		},
	},
	drizzle: {
		and: vi.fn((...conditions: unknown[]) => ({ and: conditions })),
		eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
		isNull: vi.fn((value: unknown) => ({ isNull: value })),
	},
	tables: {
		organizationSecretKey: {
			organizationId: "organizationSecretKey.organizationId",
			provider: "organizationSecretKey.provider",
			disabledAt: "organizationSecretKey.disabledAt",
			scalewayKeyId: "organizationSecretKey.scalewayKeyId",
		},
	},
	vault: {
		getVaultStatus: vi.fn(),
	},
	redis: {
		get: vi.fn(),
		set: vi.fn(),
		delete: vi.fn(),
	},
	clientConstructor: vi.fn(),
	client: {
		getKey: vi.fn(),
	},
}));

vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("@/db", () => ({ db: mocks.db }));
vi.mock("@/db/schema", () => mocks.tables);
vi.mock("drizzle-orm", () => mocks.drizzle);
vi.mock("@/lib/redis", () => ({ secondaryStorage: mocks.redis }));
vi.mock("./client", () => ({ getVaultStatus: mocks.vault.getVaultStatus }));
vi.mock("./scaleway-key-manager-client", () => ({
	ScalewayKeyManagerClient: mocks.clientConstructor,
}));

const localKey = {
	organizationId: "org-1",
	provider: "scaleway",
	scalewayKeyId: "key-local",
	region: "fr-par",
	disabledAt: null,
};

const compatibleRemoteKey = {
	id: "key-local",
	state: "enabled",
	usage: { symmetric_encryption: "aes_256_gcm" },
	tags: ["z8-customer-secrets", "z8-org:org-1"],
};

describe("secret store status", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mocks.env.SECRET_STORE_PROVIDER = "vault";
		mocks.vault.getVaultStatus.mockResolvedValue({
			available: true,
			initialized: true,
			sealed: false,
			address: "http://vault.test:8200",
		});
		mocks.redis.get.mockResolvedValue(null);
		mocks.redis.set.mockResolvedValue(undefined);
		mocks.redis.delete.mockResolvedValue(undefined);
		mocks.db.query.organizationSecretKey.findFirst.mockResolvedValue(undefined);
		mocks.client.getKey.mockResolvedValue(compatibleRemoteKey);
		mocks.clientConstructor.mockImplementation(
			class {
				getKey = mocks.client.getKey;
			},
		);
	});

	test("vault mode maps the existing Vault status", async () => {
		const { getSecretStoreStatus } = await import("./status");

		await expect(getSecretStoreStatus("org-1")).resolves.toEqual({
			provider: "vault",
			available: true,
			initialized: true,
			sealed: false,
			address: "http://vault.test:8200",
			reason: "available",
		});
		expect(mocks.vault.getVaultStatus).toHaveBeenCalledTimes(1);
		expect(mocks.redis.get).not.toHaveBeenCalled();
	});

	test("scaleway mode returns unavailable when no organization key metadata exists", async () => {
		mocks.env.SECRET_STORE_PROVIDER = "scaleway";
		const { getSecretStoreStatus } = await import("./status");

		await expect(getSecretStoreStatus("org-1")).resolves.toEqual({
			provider: "scaleway",
			available: false,
			reason: "missing-key",
		});
		expect(mocks.client.getKey).not.toHaveBeenCalled();
		expect(mocks.redis.set).toHaveBeenCalledWith(
			"secret-store-status:scaleway:org-1",
			JSON.stringify({ provider: "scaleway", available: false, reason: "missing-key" }),
			86400,
		);
	});

	test("scaleway mode returns available when the local key is remotely compatible", async () => {
		mocks.env.SECRET_STORE_PROVIDER = "scaleway";
		mocks.db.query.organizationSecretKey.findFirst.mockResolvedValue(localKey);
		const { getSecretStoreStatus } = await import("./status");

		await expect(getSecretStoreStatus("org-1")).resolves.toEqual({
			provider: "scaleway",
			available: true,
			reason: "available",
			scalewayKeyId: "key-local",
		});
		expect(mocks.client.getKey).toHaveBeenCalledWith("key-local");
	});

	test("scaleway mode returns unavailable when the remote key is incompatible", async () => {
		mocks.env.SECRET_STORE_PROVIDER = "scaleway";
		mocks.db.query.organizationSecretKey.findFirst.mockResolvedValue(localKey);
		mocks.client.getKey.mockResolvedValue({
			...compatibleRemoteKey,
			usage: { symmetric_encryption: "aes_128_gcm" },
		});
		const { getSecretStoreStatus } = await import("./status");

		await expect(getSecretStoreStatus("org-1")).resolves.toEqual({
			provider: "scaleway",
			available: false,
			reason: "invalid-key",
			scalewayKeyId: "key-local",
		});
	});

	test("scaleway mode returns unavailable when Key Manager lookup fails", async () => {
		mocks.env.SECRET_STORE_PROVIDER = "scaleway";
		mocks.db.query.organizationSecretKey.findFirst.mockResolvedValue(localKey);
		mocks.client.getKey.mockRejectedValue(new Error("not found"));
		const { getSecretStoreStatus } = await import("./status");

		await expect(getSecretStoreStatus("org-1")).resolves.toEqual({
			provider: "scaleway",
			available: false,
			reason: "unreachable",
			scalewayKeyId: "key-local",
		});
	});

	test("scaleway mode uses cached status without database or Key Manager calls", async () => {
		mocks.env.SECRET_STORE_PROVIDER = "scaleway";
		mocks.redis.get.mockResolvedValue(
			JSON.stringify({
				provider: "scaleway",
				available: true,
				reason: "available",
				scalewayKeyId: "key-cached",
			}),
		);
		const { getSecretStoreStatus } = await import("./status");

		await expect(getSecretStoreStatus("org-1")).resolves.toEqual({
			provider: "scaleway",
			available: true,
			reason: "available",
			scalewayKeyId: "key-cached",
		});
		expect(mocks.db.query.organizationSecretKey.findFirst).not.toHaveBeenCalled();
		expect(mocks.client.getKey).not.toHaveBeenCalled();
	});

	test("invalid cached JSON falls back to a live Scaleway check", async () => {
		mocks.env.SECRET_STORE_PROVIDER = "scaleway";
		mocks.redis.get.mockResolvedValue("not-json");
		mocks.db.query.organizationSecretKey.findFirst.mockResolvedValue(localKey);
		const { getSecretStoreStatus } = await import("./status");

		await expect(getSecretStoreStatus("org-1")).resolves.toMatchObject({
			provider: "scaleway",
			available: true,
			reason: "available",
		});
		expect(mocks.client.getKey).toHaveBeenCalledWith("key-local");
	});

	test("cache invalidation deletes the organization scoped Scaleway status key", async () => {
		const { invalidateSecretStoreStatusCache } = await import("./status");

		await invalidateSecretStoreStatusCache("org-1");

		expect(mocks.redis.delete).toHaveBeenCalledWith("secret-store-status:scaleway:org-1");
	});
});
```

- [ ] **Step 2: Run the status tests to verify they fail**

Run: `pnpm --filter webapp test apps/webapp/src/lib/vault/status.test.ts`

Expected: FAIL because `./status` does not exist yet.

- [ ] **Step 3: Checkpoint without committing**

Run: `git diff -- apps/webapp/src/lib/vault/status.test.ts`

Expected: the diff contains only the new failing tests. Do not commit unless the user explicitly asked for commits.

## Task 2: Implement Provider-Neutral Status API

**Files:**
- Create: `apps/webapp/src/lib/vault/status.ts`
- Create: `apps/webapp/src/lib/vault/scaleway-key-utils.ts`
- Modify: `apps/webapp/src/lib/vault/scaleway-provider.ts`
- Modify: `apps/webapp/src/lib/vault/index.ts`

- [ ] **Step 1: Create reusable Scaleway key compatibility helpers**

Create `apps/webapp/src/lib/vault/scaleway-key-utils.ts` with:

```ts
export type ScalewayKey = {
	id?: string;
	state?: string;
	usage?: {
		symmetric_encryption?: string;
	};
	tags?: string[];
};

export function isEnabledScalewayKey(key: unknown): key is ScalewayKey & { id: string } {
	const scalewayKey = key as ScalewayKey;
	return (
		typeof scalewayKey.id === "string" &&
		scalewayKey.id.length > 0 &&
		scalewayKey.state === "enabled"
	);
}

export function isCompatibleScalewayKey(
	key: unknown,
	organizationId: string,
): key is ScalewayKey & { id: string } {
	const scalewayKey = key as ScalewayKey;
	return (
		isEnabledScalewayKey(key) &&
		scalewayKey.usage?.symmetric_encryption === "aes_256_gcm" &&
		Array.isArray(scalewayKey.tags) &&
		scalewayKey.tags.includes("z8-customer-secrets") &&
		scalewayKey.tags.includes(`z8-org:${organizationId}`)
	);
}
```

- [ ] **Step 2: Update the Scaleway provider to use the shared helpers**

In `apps/webapp/src/lib/vault/scaleway-provider.ts`, add this import near the existing imports:

```ts
import {
	isCompatibleScalewayKey,
	isEnabledScalewayKey,
	type ScalewayKey,
} from "./scaleway-key-utils";
```

Remove the local `type ScalewayKey`, `isEnabledKey`, and `isCompatibleKey` definitions. Replace calls to `isEnabledKey(...)` with `isEnabledScalewayKey(...)`, and replace calls to `isCompatibleKey(...)` with `isCompatibleScalewayKey(...)`. Keep the private `isKeyWithId` helper unchanged.

- [ ] **Step 3: Create the status implementation**

Create `apps/webapp/src/lib/vault/status.ts` with:

```ts
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { organizationSecretKey } from "@/db/schema";
import { env } from "@/env";
import { createLogger } from "@/lib/logger";
import { secondaryStorage } from "@/lib/redis";
import { getVaultStatus } from "./client";
import { ScalewayKeyManagerClient } from "./scaleway-key-manager-client";
import { isCompatibleScalewayKey } from "./scaleway-key-utils";

const logger = createLogger("SecretStoreStatus");
const SCALEWAY_STATUS_CACHE_TTL_SECONDS = 24 * 60 * 60;
const PROVIDER_SCALEWAY = "scaleway";

export type SecretStoreProvider = "vault" | "scaleway";

export type VaultSecretStoreStatus = {
	provider: "vault";
	available: boolean;
	initialized: boolean;
	sealed: boolean;
	address: string;
	reason: "available" | "unavailable" | "sealed";
};

export type ScalewaySecretStoreStatus = {
	provider: "scaleway";
	available: boolean;
	reason: "available" | "missing-key" | "invalid-key" | "unreachable";
	scalewayKeyId?: string;
};

export type SecretStoreStatus = VaultSecretStoreStatus | ScalewaySecretStoreStatus;

const scalewayClient = new ScalewayKeyManagerClient({
	apiUrl: env.SCALEWAY_KEY_MANAGER_API_URL ?? "",
	secretKey: env.SCALEWAY_SECRET_KEY ?? "",
	projectId: env.SCALEWAY_PROJECT_ID ?? "",
	region: env.SCALEWAY_REGION ?? "",
});

function scalewayStatusCacheKey(organizationId: string) {
	return `secret-store-status:scaleway:${organizationId}`;
}

function parseCachedScalewayStatus(value: string | null): ScalewaySecretStoreStatus | null {
	if (!value) {
		return null;
	}

	try {
		const parsed = JSON.parse(value) as Partial<ScalewaySecretStoreStatus>;
		if (
			parsed.provider === "scaleway" &&
			typeof parsed.available === "boolean" &&
			(parsed.reason === "available" ||
				parsed.reason === "missing-key" ||
				parsed.reason === "invalid-key" ||
				parsed.reason === "unreachable")
		) {
			return {
				provider: "scaleway",
				available: parsed.available,
				reason: parsed.reason,
				...(typeof parsed.scalewayKeyId === "string" ? { scalewayKeyId: parsed.scalewayKeyId } : {}),
			};
		}
	} catch (error) {
		logger.warn({ error }, "Ignoring invalid Scaleway status cache entry");
	}

	return null;
}

async function getCachedScalewayStatus(organizationId: string) {
	const cached = await secondaryStorage.get(scalewayStatusCacheKey(organizationId));
	return parseCachedScalewayStatus(cached);
}

async function cacheScalewayStatus(organizationId: string, status: ScalewaySecretStoreStatus) {
	await secondaryStorage.set(
		scalewayStatusCacheKey(organizationId),
		JSON.stringify(status),
		SCALEWAY_STATUS_CACHE_TTL_SECONDS,
	);
}

async function getVaultSecretStoreStatus(): Promise<VaultSecretStoreStatus> {
	const status = await getVaultStatus();
	return {
		provider: "vault",
		available: status.available && status.initialized && !status.sealed,
		initialized: status.initialized,
		sealed: status.sealed,
		address: status.address,
		reason: status.available && status.initialized && !status.sealed ? "available" : status.sealed ? "sealed" : "unavailable",
	};
}

async function computeScalewaySecretStoreStatus(
	organizationId: string,
): Promise<ScalewaySecretStoreStatus> {
	const localKey = await db.query.organizationSecretKey.findFirst({
		where: and(
			eq(organizationSecretKey.organizationId, organizationId),
			eq(organizationSecretKey.provider, PROVIDER_SCALEWAY),
			isNull(organizationSecretKey.disabledAt),
		),
	});

	if (!localKey) {
		return { provider: "scaleway", available: false, reason: "missing-key" };
	}

	try {
		const remoteKey = await scalewayClient.getKey(localKey.scalewayKeyId);
		if (!isCompatibleScalewayKey(remoteKey, organizationId)) {
			return {
				provider: "scaleway",
				available: false,
				reason: "invalid-key",
				scalewayKeyId: localKey.scalewayKeyId,
			};
		}

		return {
			provider: "scaleway",
			available: true,
			reason: "available",
			scalewayKeyId: localKey.scalewayKeyId,
		};
	} catch (error) {
		logger.warn(
			{ error, organizationId, scalewayKeyId: localKey.scalewayKeyId },
			"Failed to verify Scaleway organization key status",
		);
		return {
			provider: "scaleway",
			available: false,
			reason: "unreachable",
			scalewayKeyId: localKey.scalewayKeyId,
		};
	}
}

async function getScalewaySecretStoreStatus(organizationId: string) {
	const cached = await getCachedScalewayStatus(organizationId);
	if (cached) {
		return cached;
	}

	const status = await computeScalewaySecretStoreStatus(organizationId);
	await cacheScalewayStatus(organizationId, status);
	return status;
}

export async function getSecretStoreStatus(organizationId: string): Promise<SecretStoreStatus> {
	if (env.SECRET_STORE_PROVIDER === "scaleway") {
		return getScalewaySecretStoreStatus(organizationId);
	}

	return getVaultSecretStoreStatus();
}

export async function invalidateSecretStoreStatusCache(organizationId: string): Promise<void> {
	await secondaryStorage.delete(scalewayStatusCacheKey(organizationId));
}
```

- [ ] **Step 4: Export the status API**

In `apps/webapp/src/lib/vault/index.ts`, add this export block after the client exports:

```ts
export {
	getSecretStoreStatus,
	invalidateSecretStoreStatusCache,
} from "./status";
export type { SecretStoreStatus } from "./status";
```

- [ ] **Step 5: Run the status tests**

Run: `pnpm --filter webapp test apps/webapp/src/lib/vault/status.test.ts`

Expected: PASS for all tests in `status.test.ts`.

- [ ] **Step 6: Checkpoint without committing**

Run: `git diff -- apps/webapp/src/lib/vault/status.ts apps/webapp/src/lib/vault/scaleway-key-utils.ts apps/webapp/src/lib/vault/scaleway-provider.ts apps/webapp/src/lib/vault/index.ts apps/webapp/src/lib/vault/status.test.ts`

Expected: the diff contains the status API, helper exports, and passing tests. Do not commit unless the user explicitly asked for commits.

## Task 3: Invalidate Status Cache After Scaleway Secret Mutations

**Files:**
- Modify: `apps/webapp/src/lib/vault/scaleway-provider.ts`
- Modify: `apps/webapp/src/lib/vault/scaleway-provider.test.ts`

- [ ] **Step 1: Add failing invalidation tests**

In `apps/webapp/src/lib/vault/scaleway-provider.test.ts`, add `invalidateSecretStoreStatusCache` to the hoisted mocks:

```ts
	invalidateSecretStoreStatusCache: vi.fn(),
```

Add this mock after the existing `vi.mock("./scaleway-key-manager-client", ...)` block:

```ts
vi.mock("./status", () => ({
	invalidateSecretStoreStatusCache: mocks.invalidateSecretStoreStatusCache,
}));
```

In the `beforeEach`, add:

```ts
	mocks.invalidateSecretStoreStatusCache.mockResolvedValue(undefined);
```

Add these tests before the final logging test:

```ts
	test("store invalidates Scaleway status cache after a successful encrypted row upsert", async () => {
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		await scalewaySecretProvider.storeOrgSecret("org-1", "email/api_key", "secret-value");

		expect(mocks.invalidateSecretStoreStatusCache).toHaveBeenCalledWith("org-1");
	});

	test("delete operations invalidate Scaleway status cache after successful deletes", async () => {
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		await scalewaySecretProvider.deleteOrgSecret("org-1", "email/api_key");
		await scalewaySecretProvider.deleteAllOrgSecrets("org-1");

		expect(mocks.invalidateSecretStoreStatusCache).toHaveBeenCalledTimes(2);
		expect(mocks.invalidateSecretStoreStatusCache).toHaveBeenNthCalledWith(1, "org-1");
		expect(mocks.invalidateSecretStoreStatusCache).toHaveBeenNthCalledWith(2, "org-1");
	});

	test("cache invalidation failure does not fail a successful store", async () => {
		mocks.invalidateSecretStoreStatusCache.mockRejectedValueOnce(new Error("redis unavailable"));
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		await expect(
			scalewaySecretProvider.storeOrgSecret("org-1", "email/api_key", "secret-value"),
		).resolves.toBeUndefined();
	});
```

- [ ] **Step 2: Run the provider tests to verify they fail**

Run: `pnpm --filter webapp test apps/webapp/src/lib/vault/scaleway-provider.test.ts`

Expected: FAIL because `scaleway-provider.ts` does not invalidate the cache yet.

- [ ] **Step 3: Implement best-effort invalidation**

In `apps/webapp/src/lib/vault/scaleway-provider.ts`, add this import:

```ts
import { invalidateSecretStoreStatusCache } from "./status";
```

Add this helper near `ensureOrganizationKey`:

```ts
async function invalidateStatusCache(organizationId: string) {
	try {
		await invalidateSecretStoreStatusCache(organizationId);
	} catch (error) {
		// Cache invalidation should never fail the secret mutation that already succeeded.
		console.warn("Failed to invalidate Scaleway secret store status cache", { error, organizationId });
	}
}
```

At the end of `storeOrgSecret`, after `.onConflictDoUpdate(...)` resolves, add:

```ts
		await invalidateStatusCache(organizationId);
```

At the end of `deleteOrgSecret`, after the delete query resolves, add:

```ts
		await invalidateStatusCache(organizationId);
```

At the end of `deleteAllOrgSecrets`, after the delete query resolves, add:

```ts
		await invalidateStatusCache(organizationId);
```

- [ ] **Step 4: Run the provider tests**

Run: `pnpm --filter webapp test apps/webapp/src/lib/vault/scaleway-provider.test.ts`

Expected: PASS for all tests in `scaleway-provider.test.ts`.

- [ ] **Step 5: Checkpoint without committing**

Run: `git diff -- apps/webapp/src/lib/vault/scaleway-provider.ts apps/webapp/src/lib/vault/scaleway-provider.test.ts`

Expected: the diff contains only helper exports, cache invalidation, and related tests. Do not commit unless the user explicitly asked for commits.

## Task 4: Wire Secret-Store Status Into Email Settings Actions and Page

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/page.tsx`

- [ ] **Step 1: Update the server action status function**

In `apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/actions.ts`, change the imports from:

```ts
import { deleteOrgSecret, getVaultStatus, hasOrgSecret, storeOrgSecret } from "@/lib/vault";
```

to:

```ts
import {
	deleteOrgSecret,
	getSecretStoreStatus,
	hasOrgSecret,
	storeOrgSecret,
	type SecretStoreStatus,
} from "@/lib/vault";
```

Replace the `getVaultConnectionStatus` function with:

```ts
/**
 * Get configured secret store status for UI display.
 */
export async function getSecretStoreConnectionStatus(
	organizationId: string,
): Promise<SecretStoreStatus> {
	return getSecretStoreStatus(organizationId);
}
```

- [ ] **Step 2: Update the page to use organization-scoped status**

In `apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/page.tsx`, change the import from:

```ts
import { getEmailConfig, getVaultConnectionStatus } from "./actions";
```

to:

```ts
import { getEmailConfig, getSecretStoreConnectionStatus } from "./actions";
```

Replace the status promise and resolved variable block with:

```tsx
	const secretStoreStatusPromise = authContextPromise.then(({ organizationId }) =>
		getSecretStoreConnectionStatus(organizationId),
	);
	const [{ organizationId }, t, emailConfig, secretStoreStatus] = await Promise.all([
		authContextPromise,
		getTranslate(),
		emailConfigPromise,
		secretStoreStatusPromise,
	]);
```

Change the form prop from:

```tsx
					vaultStatus={vaultStatus}
```

to:

```tsx
					secretStoreStatus={secretStoreStatus}
```

- [ ] **Step 3: Run TypeScript tests for obvious import failures**

Run: `pnpm --filter webapp test apps/webapp/src/lib/vault/status.test.ts apps/webapp/src/lib/vault/scaleway-provider.test.ts`

Expected: PASS. Component type errors may still exist until Task 5 updates the form prop.

## Task 5: Update Email Form Status UI

**Files:**
- Modify: `apps/webapp/src/components/settings/enterprise/email-config-form.tsx`

- [ ] **Step 1: Update imports and props**

In `apps/webapp/src/components/settings/enterprise/email-config-form.tsx`, add the type import:

```ts
import type { SecretStoreStatus } from "@/lib/vault";
```

Change the props interface from:

```ts
interface EmailConfigFormProps {
	organizationId: string;
	initialConfig: EmailConfigOutput | null;
	vaultStatus: VaultStatus;
}

interface VaultStatus {
	available: boolean;
	initialized: boolean;
	sealed: boolean;
	address: string;
}
```

to:

```ts
interface EmailConfigFormProps {
	organizationId: string;
	initialConfig: EmailConfigOutput | null;
	secretStoreStatus: SecretStoreStatus;
}
```

- [ ] **Step 2: Replace `VaultStatusAlert` with provider-aware status rendering**

Replace the `VaultStatusAlert` function with:

```tsx
function SecretStoreStatusAlert({ secretStoreStatus }: { secretStoreStatus: SecretStoreStatus }) {
	const { t } = useTranslate();

	if (secretStoreStatus.provider === "scaleway") {
		if (secretStoreStatus.available) {
			return (
				<Alert className="mb-4">
					<IconShield className="size-4" />
					<AlertTitle>
						{t("settings.enterprise.email.scalewayConnected", "Scaleway Secret Store Ready")}
					</AlertTitle>
					<AlertDescription>
						{t(
							"settings.enterprise.email.scalewayConnectedDesc",
							"This organization has a verified Scaleway Key Manager key for encrypted secret storage.",
						)}
					</AlertDescription>
				</Alert>
			);
		}

		if (secretStoreStatus.reason === "missing-key") {
			return (
				<Alert className="mb-4">
					<IconShield className="size-4" />
					<AlertTitle>
						{t("settings.enterprise.email.scalewayKeyPending", "Scaleway Key Not Generated Yet")}
					</AlertTitle>
					<AlertDescription>
						{t(
							"settings.enterprise.email.scalewayKeyPendingDesc",
							"A Scaleway organization key will be generated when you save a secret such as a Resend API key or SMTP password.",
						)}
					</AlertDescription>
				</Alert>
			);
		}

		return (
			<Alert variant="destructive" className="mb-4">
				<IconAlertTriangle className="size-4" />
				<AlertTitle>
					{t("settings.enterprise.email.scalewayUnavailable", "Scaleway Secret Store Unavailable")}
				</AlertTitle>
				<AlertDescription>
					{t(
						"settings.enterprise.email.scalewayUnavailableDesc",
						"The configured Scaleway organization key could not be verified. Secrets cannot be stored securely until this is fixed.",
					)}
				</AlertDescription>
			</Alert>
		);
	}

	if (!secretStoreStatus.available) {
		return (
			<Alert variant="destructive" className="mb-4">
				<IconAlertTriangle className="size-4" />
				<AlertTitle>{t("settings.enterprise.email.vaultUnavailable", "Vault Unavailable")}</AlertTitle>
				<AlertDescription>
					{secretStoreStatus.sealed
						? t(
								"settings.enterprise.email.vaultSealedDesc",
								"HashiCorp Vault is sealed. Please unseal it to store secrets.",
							)
						: t(
								"settings.enterprise.email.vaultUnavailableDesc",
								"HashiCorp Vault is not available. Secrets cannot be stored securely.",
							)}
				</AlertDescription>
			</Alert>
		);
	}

	return (
		<Alert className="mb-4">
			<IconShield className="size-4" />
			<AlertTitle>{t("settings.enterprise.email.vaultConnected", "Vault Connected")}</AlertTitle>
			<AlertDescription>
				{t(
					"settings.enterprise.email.vaultConnectedDesc",
					"Secrets are stored securely in HashiCorp Vault.",
				)}
			</AlertDescription>
		</Alert>
	);
}
```

- [ ] **Step 3: Update the component signature and render call**

Change the component signature from:

```tsx
export function EmailConfigForm({
	organizationId,
	initialConfig,
	vaultStatus,
}: EmailConfigFormProps) {
```

to:

```tsx
export function EmailConfigForm({
	organizationId,
	initialConfig,
	secretStoreStatus,
}: EmailConfigFormProps) {
```

Change the render call from:

```tsx
					<VaultStatusAlert vaultStatus={vaultStatus} />
```

to:

```tsx
					<SecretStoreStatusAlert secretStoreStatus={secretStoreStatus} />
```

- [ ] **Step 4: Search for stale Vault prop names in the email page path**

Run: `rg "vaultStatus|getVaultConnectionStatus|VaultStatusAlert" apps/webapp/src/app apps/webapp/src/components/settings/enterprise/email-config-form.tsx`

Expected: no matches for the old email settings status names.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter webapp test apps/webapp/src/lib/vault/status.test.ts apps/webapp/src/lib/vault/scaleway-provider.test.ts apps/webapp/src/lib/vault/secrets.test.ts`

Expected: PASS for all listed test files.

## Task 6: Final Verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run focused secret-store tests**

Run: `pnpm --filter webapp test apps/webapp/src/lib/vault/status.test.ts apps/webapp/src/lib/vault/scaleway-provider.test.ts apps/webapp/src/lib/vault/secrets.test.ts`

Expected: PASS.

- [ ] **Step 2: Run type/lint level validation available through tests or build**

Run: `CI=true pnpm build`

Expected: build completes successfully. If it fails because required environment variables or Phase CLI secrets are unavailable to agents, stop and report the skipped build with the exact missing variables or command failure.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff -- apps/webapp/src/lib/vault/status.ts apps/webapp/src/lib/vault/status.test.ts apps/webapp/src/lib/vault/scaleway-provider.ts apps/webapp/src/lib/vault/scaleway-provider.test.ts apps/webapp/src/lib/vault/index.ts apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/actions.ts apps/webapp/src/app/[locale]/(app)/settings/enterprise/email/page.tsx apps/webapp/src/components/settings/enterprise/email-config-form.tsx`

Expected: diff is limited to provider-aware status, cache invalidation, email page wiring, and tests.

- [ ] **Step 4: Check working tree status**

Run: `git status --short`

Expected: modified files match the implementation and existing unrelated user/agent changes, if any, are not touched.
