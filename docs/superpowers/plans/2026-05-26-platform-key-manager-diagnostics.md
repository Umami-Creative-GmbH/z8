# Platform Key Manager Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a platform-admin diagnostics button that provisions or reuses a platform Scaleway Key Manager key, encrypts a faker-generated value, decrypts it, and shows whether the values match.

**Architecture:** Add a focused server-only platform key manager under `src/lib/vault` backed by `system_config.platform_scaleway_key_id`. Extend the existing Scaleway client with platform key creation, expose the end-to-end test through a platform-admin-protected server action, and render the result in the existing diagnostics client card layout.

**Tech Stack:** Next.js server actions, React 19 client component, Drizzle ORM, Vitest, Testing Library, Scaleway Key Manager client, `@faker-js/faker`, `nanoid`, `effect` server-action wrapper.

---

## File Map

- Modify: `apps/webapp/src/lib/vault/scaleway-key-manager-client.ts`
  - Add `createPlatformKey(name: string)` for platform-scoped Key Manager key creation.
- Modify: `apps/webapp/src/lib/vault/scaleway-key-utils.ts`
  - Add a platform-compatible key predicate that checks enabled state, AES-256-GCM usage, and platform tag.
- Create: `apps/webapp/src/lib/vault/platform-key-manager.ts`
  - Owns `system_config` persistence, remote key verification, first-run provisioning, encryption/decryption test logic, and testable dependency injection.
- Create: `apps/webapp/src/lib/vault/platform-key-manager.test.ts`
  - Unit-tests platform key provisioning, reuse, failure behavior, and encrypt/decrypt result shape.
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.ts`
  - Add `testPlatformKeyManagerEncryptionAction()` after platform-admin authorization.
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts`
  - Add source-level authorization ordering test for the new action.
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.tsx`
  - Add the new card, button, pending state, success state, and error alert.
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx`
  - Test initial card rendering, success result rendering, and error rendering.

---

### Task 1: Scaleway Platform Key Service

**Files:**
- Modify: `apps/webapp/src/lib/vault/scaleway-key-manager-client.ts`
- Modify: `apps/webapp/src/lib/vault/scaleway-key-utils.ts`
- Create: `apps/webapp/src/lib/vault/platform-key-manager.ts`
- Create: `apps/webapp/src/lib/vault/platform-key-manager.test.ts`

- [ ] **Step 1: Write the failing platform key manager tests**

Create `apps/webapp/src/lib/vault/platform-key-manager.test.ts` with this test file:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	env: {
		SCALEWAY_KEY_MANAGER_API_URL: "https://key-manager.test",
		SCALEWAY_SECRET_KEY: "test-secret-key",
		SCALEWAY_PROJECT_ID: "project-123",
		SCALEWAY_REGION: "fr-par",
	},
	db: {
		select: vi.fn(),
		insert: vi.fn(),
		transaction: vi.fn(),
		execute: vi.fn(),
	},
	drizzle: {
		eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
		sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings, values })),
	},
	tables: {
		systemConfig: {
			key: "systemConfig.key",
			value: "systemConfig.value",
			description: "systemConfig.description",
		},
	},
	clientConstructor: vi.fn(),
	client: {
		getKey: vi.fn(),
		createPlatformKey: vi.fn(),
		encrypt: vi.fn(),
		decrypt: vi.fn(),
	},
	nanoid: vi.fn(() => "abc123"),
	insertValues: vi.fn(),
	onConflictDoUpdate: vi.fn(),
	selectFrom: vi.fn(),
	selectWhere: vi.fn(),
	selectLimit: vi.fn(),
}));

vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("drizzle-orm", () => mocks.drizzle);
vi.mock("@/db", () => ({ db: mocks.db }));
vi.mock("@/db/schema", () => mocks.tables);
vi.mock("nanoid", () => ({ nanoid: mocks.nanoid }));
vi.mock("./scaleway-key-manager-client", () => ({
	ScalewayKeyManagerClient: mocks.clientConstructor,
}));

function remotePlatformKey(id: string, state = "enabled") {
	return {
		id,
		state,
		usage: { symmetric_encryption: "aes_256_gcm" },
		tags: ["z8-platform-secrets"],
	};
}

function selectRows(rows: Array<{ value: string }>) {
	mocks.selectLimit.mockResolvedValue(rows);
	mocks.selectWhere.mockReturnValue({ limit: mocks.selectLimit });
	mocks.selectFrom.mockReturnValue({ where: mocks.selectWhere });
	mocks.db.select.mockReturnValue({ from: mocks.selectFrom });
}

describe("platform key manager", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();

		mocks.clientConstructor.mockImplementation(
			class {
				getKey = mocks.client.getKey;
				createPlatformKey = mocks.client.createPlatformKey;
				encrypt = mocks.client.encrypt;
				decrypt = mocks.client.decrypt;
			},
		);

		selectRows([]);
		mocks.client.getKey.mockResolvedValue(remotePlatformKey("key-existing"));
		mocks.client.createPlatformKey.mockResolvedValue(remotePlatformKey("key-created"));
		mocks.client.encrypt.mockResolvedValue("ciphertext-value");
		mocks.client.decrypt.mockResolvedValue("Ada Lovelace");
		mocks.db.execute.mockResolvedValue(undefined);
		mocks.db.transaction.mockImplementation(async (callback) => callback(mocks.db));
		mocks.onConflictDoUpdate.mockResolvedValue(undefined);
		mocks.insertValues.mockReturnValue({ onConflictDoUpdate: mocks.onConflictDoUpdate });
		mocks.db.insert.mockReturnValue({ values: mocks.insertValues });
	});

	test("creates and stores a platform key when no key id exists", async () => {
		const { testPlatformKeyManagerEncryption } = await import("./platform-key-manager");

		const result = await testPlatformKeyManagerEncryption("Ada Lovelace");

		expect(mocks.client.createPlatformKey).toHaveBeenCalledWith("z8-platform-abc123");
		expect(mocks.insertValues).toHaveBeenCalledWith({
			key: "platform_scaleway_key_id",
			value: "key-created",
			description: "Scaleway Key Manager key ID for platform-scoped secrets.",
		});
		expect(result).toEqual({
			input: "Ada Lovelace",
			output: "Ada Lovelace",
			matches: true,
			ciphertextPreview: "ciphertext-value",
			platformKeyId: "key-created",
			keyStatus: "created",
		});
	});

	test("reuses a stored platform key after remote verification", async () => {
		selectRows([{ value: "key-existing" }]);
		const { testPlatformKeyManagerEncryption } = await import("./platform-key-manager");

		await testPlatformKeyManagerEncryption("Ada Lovelace");

		expect(mocks.client.getKey).toHaveBeenCalledWith("key-existing");
		expect(mocks.client.createPlatformKey).not.toHaveBeenCalled();
		expect(mocks.client.encrypt).toHaveBeenCalledWith(
			"key-existing",
			"Ada Lovelace",
			"scope=platform;purpose=diagnostics;version=1",
		);
	});

	test("does not replace an unusable stored platform key", async () => {
		selectRows([{ value: "key-existing" }]);
		mocks.client.getKey.mockResolvedValue(remotePlatformKey("key-existing", "disabled"));
		const { testPlatformKeyManagerEncryption } = await import("./platform-key-manager");

		await expect(testPlatformKeyManagerEncryption("Ada Lovelace")).rejects.toThrow(
			"Scaleway platform key key-existing is not enabled",
		);
		expect(mocks.client.createPlatformKey).not.toHaveBeenCalled();
		expect(mocks.client.encrypt).not.toHaveBeenCalled();
	});

	test("reports mismatched decrypted output", async () => {
		mocks.client.decrypt.mockResolvedValue("Grace Hopper");
		const { testPlatformKeyManagerEncryption } = await import("./platform-key-manager");

		const result = await testPlatformKeyManagerEncryption("Ada Lovelace");

		expect(result.matches).toBe(false);
		expect(result.output).toBe("Grace Hopper");
	});
});
```

- [ ] **Step 2: Run the platform key manager test to verify it fails**

Run:

```bash
pnpm --filter webapp test src/lib/vault/platform-key-manager.test.ts
```

Expected: FAIL because `src/lib/vault/platform-key-manager.ts` and `createPlatformKey` do not exist yet.

- [ ] **Step 3: Extend the Scaleway key client**

Modify `apps/webapp/src/lib/vault/scaleway-key-manager-client.ts` by adding this method after `createOrganizationKey`:

```ts
	async createPlatformKey(name: string) {
		return this.request("/keys", {
			method: "POST",
			body: {
				project_id: this.projectId,
				name,
				usage: { symmetric_encryption: "aes_256_gcm" },
				tags: ["z8-platform-secrets"],
				unprotected: false,
			},
		});
	}
```

- [ ] **Step 4: Add platform key compatibility helper**

Modify `apps/webapp/src/lib/vault/scaleway-key-utils.ts` by adding this function below `isCompatibleScalewayKey`:

```ts
export function isCompatibleScalewayPlatformKey(
	key: unknown,
): key is ScalewayKey & { id: string } {
	const scalewayKey = key as ScalewayKey;
	return (
		isEnabledScalewayKey(key) &&
		scalewayKey.usage?.symmetric_encryption === "aes_256_gcm" &&
		Array.isArray(scalewayKey.tags) &&
		scalewayKey.tags.includes("z8-platform-secrets")
	);
}
```

- [ ] **Step 5: Implement the platform key manager**

Create `apps/webapp/src/lib/vault/platform-key-manager.ts` with this code:

```ts
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { systemConfig } from "@/db/schema";
import { env } from "@/env";
import { ScalewayKeyManagerClient } from "./scaleway-key-manager-client";
import { isCompatibleScalewayPlatformKey, isEnabledScalewayKey, type ScalewayKey } from "./scaleway-key-utils";

const PLATFORM_KEY_CONFIG_KEY = "platform_scaleway_key_id";
const PLATFORM_KEY_DESCRIPTION = "Scaleway Key Manager key ID for platform-scoped secrets.";
const PLATFORM_ASSOCIATED_DATA = "scope=platform;purpose=diagnostics;version=1";

type PlatformKeyStatus = "created" | "reused";

export type PlatformKeyManagerEncryptionResult = {
	input: string;
	output: string;
	matches: boolean;
	ciphertextPreview: string;
	platformKeyId: string;
	keyStatus: PlatformKeyStatus;
};

type PlatformKeyDb = Pick<typeof db, "select" | "insert" | "transaction" | "execute">;

const client = new ScalewayKeyManagerClient({
	apiUrl: env.SCALEWAY_KEY_MANAGER_API_URL ?? "",
	secretKey: env.SCALEWAY_SECRET_KEY ?? "",
	projectId: env.SCALEWAY_PROJECT_ID ?? "",
	region: env.SCALEWAY_REGION ?? "",
});

function isKeyWithId(key: unknown): key is ScalewayKey & { id: string } {
	const scalewayKey = key as ScalewayKey;
	return typeof scalewayKey.id === "string" && scalewayKey.id.length > 0;
}

function ciphertextPreview(ciphertext: string) {
	if (ciphertext.length <= 96) {
		return ciphertext;
	}
	return `${ciphertext.slice(0, 48)}...${ciphertext.slice(-24)}`;
}

async function readStoredPlatformKeyId(database: PlatformKeyDb = db) {
	const [row] = await database
		.select({ value: systemConfig.value })
		.from(systemConfig)
		.where(eq(systemConfig.key, PLATFORM_KEY_CONFIG_KEY))
		.limit(1);

	return row?.value?.trim() || null;
}

async function persistPlatformKeyId(keyId: string, database: PlatformKeyDb = db) {
	await database
		.insert(systemConfig)
		.values({
			key: PLATFORM_KEY_CONFIG_KEY,
			value: keyId,
			description: PLATFORM_KEY_DESCRIPTION,
		})
		.onConflictDoUpdate({
			target: systemConfig.key,
			set: {
				value: keyId,
				description: PLATFORM_KEY_DESCRIPTION,
			},
		});
}

async function verifyPlatformKey(keyId: string) {
	let remoteKey: unknown;
	try {
		remoteKey = await client.getKey(keyId);
	} catch (error) {
		throw new Error(`Configured Scaleway platform key ${keyId} is not usable`, { cause: error });
	}

	if (!isEnabledScalewayKey(remoteKey)) {
		throw new Error(`Scaleway platform key ${keyId} is not enabled`);
	}

	if (!isCompatibleScalewayPlatformKey(remoteKey)) {
		throw new Error(`Scaleway platform key ${keyId} is not compatible`);
	}

	return keyId;
}

async function provisionPlatformKey(database: PlatformKeyDb = db): Promise<{ keyId: string; status: PlatformKeyStatus }> {
	const storedKeyId = await readStoredPlatformKeyId(database);
	if (storedKeyId) {
		return { keyId: await verifyPlatformKey(storedKeyId), status: "reused" };
	}

	return database.transaction(async (tx) => {
		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('platform_scaleway_key_id', 0))`);

		const lockedStoredKeyId = await readStoredPlatformKeyId(tx as PlatformKeyDb);
		if (lockedStoredKeyId) {
			return { keyId: await verifyPlatformKey(lockedStoredKeyId), status: "reused" };
		}

		const createdKey = await client.createPlatformKey(`z8-platform-${nanoid(10)}`);
		if (!isEnabledScalewayKey(createdKey)) {
			if (isKeyWithId(createdKey)) {
				throw new Error(`Created Scaleway platform key ${createdKey.id} is not enabled`);
			}
			throw new Error("Created Scaleway platform key response did not include an id");
		}

		if (!isCompatibleScalewayPlatformKey(createdKey)) {
			throw new Error(`Created Scaleway platform key ${createdKey.id} is not compatible`);
		}

		await persistPlatformKeyId(createdKey.id, tx as PlatformKeyDb);
		return { keyId: createdKey.id, status: "created" };
	});
}

export async function testPlatformKeyManagerEncryption(value: string): Promise<PlatformKeyManagerEncryptionResult> {
	const platformKey = await provisionPlatformKey();
	const ciphertext = await client.encrypt(platformKey.keyId, value, PLATFORM_ASSOCIATED_DATA);
	const output = await client.decrypt(platformKey.keyId, ciphertext, PLATFORM_ASSOCIATED_DATA);

	return {
		input: value,
		output,
		matches: output === value,
		ciphertextPreview: ciphertextPreview(ciphertext),
		platformKeyId: platformKey.keyId,
		keyStatus: platformKey.status,
	};
}
```

- [ ] **Step 6: Run the platform key manager tests**

Run:

```bash
pnpm --filter webapp test src/lib/vault/platform-key-manager.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit platform key service**

Run:

```bash
git add apps/webapp/src/lib/vault/scaleway-key-manager-client.ts apps/webapp/src/lib/vault/scaleway-key-utils.ts apps/webapp/src/lib/vault/platform-key-manager.ts apps/webapp/src/lib/vault/platform-key-manager.test.ts
git commit -m "feat: add platform key manager service"
```

---

### Task 2: Diagnostics Server Action

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts`

- [ ] **Step 1: Extend the source-level action test**

Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts` by adding this test inside the existing `describe` block:

```ts
	it("requires platform-admin authorization before testing platform key manager encryption", () => {
		const source = stripComments(readFileSync(ACTIONS_PATH, "utf8"));
		const authCheck = "adminService.requirePlatformAdmin()";
		const encryptionCall = "testPlatformKeyManagerEncryption(testValue)";
		const fakerCall = "faker.person.fullName()";

		expect(source).toContain("testPlatformKeyManagerEncryptionAction");
		expect(source).toContain("PlatformAdminService");
		expect(source).toContain(authCheck);
		expect(source).toContain(fakerCall);
		expect(source).toContain(encryptionCall);
		expect(source.indexOf(authCheck)).toBeLessThan(source.indexOf(fakerCall));
		expect(source.indexOf(fakerCall)).toBeLessThan(source.indexOf(encryptionCall));
		expect(source).toContain("runServerActionSafe");
	});
```

- [ ] **Step 2: Run the action test to verify it fails**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts'
```

Expected: FAIL because `testPlatformKeyManagerEncryptionAction` is not implemented.

- [ ] **Step 3: Implement the diagnostics server action**

Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.ts` to include the new imports:

```ts
import { faker } from "@faker-js/faker";
import { testPlatformKeyManagerEncryption, type PlatformKeyManagerEncryptionResult } from "@/lib/vault/platform-key-manager";
```

Then append this action after `refreshPlatformDiagnosticsAction()`:

```ts
export async function testPlatformKeyManagerEncryptionAction(): Promise<
	ServerActionResult<PlatformKeyManagerEncryptionResult>
> {
	const effect = Effect.gen(function* () {
		const adminService = yield* PlatformAdminService;
		yield* adminService.requirePlatformAdmin();

		const testValue = faker.person.fullName();
		return yield* Effect.promise(() => testPlatformKeyManagerEncryption(testValue));
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}
```

- [ ] **Step 4: Run the action test**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts'
```

Expected: PASS.

- [ ] **Step 5: Commit server action**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.ts' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts'
git commit -m "feat: add platform key diagnostics action"
```

---

### Task 3: Diagnostics Client UI

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx`

- [ ] **Step 1: Update the client test action mock**

Modify the hoisted mock in `diagnostics-client.test.tsx` to include the new action:

```ts
const { refreshPlatformDiagnosticsActionMock, testPlatformKeyManagerEncryptionActionMock } = vi.hoisted(() => ({
	refreshPlatformDiagnosticsActionMock: vi.fn(),
	testPlatformKeyManagerEncryptionActionMock: vi.fn(),
}));
```

Modify the `vi.mock("./actions"...)` block:

```ts
vi.mock("./actions", () => ({
	refreshPlatformDiagnosticsAction: refreshPlatformDiagnosticsActionMock,
	testPlatformKeyManagerEncryptionAction: testPlatformKeyManagerEncryptionActionMock,
}));
```

- [ ] **Step 2: Add failing client UI tests**

Add these tests inside the existing `describe("DiagnosticsClient", ...)` block:

```ts
	it("renders the Scaleway Key Manager encryption test card", () => {
		render(<DiagnosticsClient initialSnapshot={snapshot()} />);

		expect(screen.getByText("Scaleway Key Manager Encryption")).toBeTruthy();
		expect(screen.getByText("Run an end-to-end platform key encrypt/decrypt test.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Test encryption" })).toBeTruthy();
	});

	it("runs the platform key manager encryption test and renders the successful result", async () => {
		testPlatformKeyManagerEncryptionActionMock.mockResolvedValue({
			success: true,
			data: {
				input: "Ada Lovelace",
				output: "Ada Lovelace",
				matches: true,
				ciphertextPreview: "ciphertext-value",
				platformKeyId: "key-created",
				keyStatus: "created",
			},
		});

		render(<DiagnosticsClient initialSnapshot={snapshot()} />);
		fireEvent.click(screen.getByRole("button", { name: "Test encryption" }));

		await waitFor(() => expect(screen.getByText("Input and output match")).toBeTruthy());
		expect(screen.getByText("Ada Lovelace")).toBeTruthy();
		expect(screen.getByText("key-created")).toBeTruthy();
		expect(screen.getByText("Created new platform key")).toBeTruthy();
		expect(screen.getByText("ciphertext-value")).toBeTruthy();
	});

	it("shows an inline error when the encryption test fails", async () => {
		testPlatformKeyManagerEncryptionActionMock.mockResolvedValue({
			success: false,
			error: "Scaleway Key Manager request failed",
		});

		render(<DiagnosticsClient initialSnapshot={snapshot()} />);
		fireEvent.click(screen.getByRole("button", { name: "Test encryption" }));

		await waitFor(() => expect(screen.getByText("Scaleway Key Manager request failed")).toBeTruthy());
		expect(screen.getByRole("alert").getAttribute("aria-live")).toBe("polite");
	});
```

- [ ] **Step 3: Run the client test to verify it fails**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx'
```

Expected: FAIL because the card and action import do not exist in the component.

- [ ] **Step 4: Update diagnostics client imports and state**

Modify imports in `diagnostics-client.tsx`:

```ts
import { IconAlertTriangle, IconCheck, IconKey, IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import type { PlatformKeyManagerEncryptionResult } from "@/lib/vault/platform-key-manager";
import { refreshPlatformDiagnosticsAction, testPlatformKeyManagerEncryptionAction } from "./actions";
```

Add state after the existing refresh state:

```ts
	const [keyManagerResult, setKeyManagerResult] = useState<PlatformKeyManagerEncryptionResult | null>(null);
	const [keyManagerError, setKeyManagerError] = useState<string | null>(null);
	const [isKeyManagerPending, startKeyManagerTransition] = useTransition();
```

Add this function below `refreshDiagnostics()`:

```ts
	function testKeyManagerEncryption() {
		setKeyManagerError(null);
		startKeyManagerTransition(async () => {
			const result = await testPlatformKeyManagerEncryptionAction();

			if (result.success) {
				setKeyManagerResult(result.data);
				return;
			}

			setKeyManagerError(result.error);
		});
	}
```

- [ ] **Step 5: Add the diagnostics card JSX**

Insert this card after the diagnostics sections grid and before recommended actions:

```tsx
			<Card>
				<CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
					<div className="space-y-2">
						<div className="flex flex-wrap items-center gap-3">
							<CardTitle>{t("admin:admin.diagnostics.keyManager.title", "Scaleway Key Manager Encryption")}</CardTitle>
							{keyManagerResult ? (
								<StatusBadge
									status={keyManagerResult.matches ? "healthy" : "error"}
									label={
										keyManagerResult.matches
											? t("admin:admin.diagnostics.keyManager.match", "Input and output match")
											: t("admin:admin.diagnostics.keyManager.mismatch", "Input and output differ")
									}
								/>
							) : null}
						</div>
						<CardDescription>
							{t(
								"admin:admin.diagnostics.keyManager.description",
								"Run an end-to-end platform key encrypt/decrypt test.",
							)}
						</CardDescription>
						<p className="sr-only" role="status" aria-live="polite">
							{isKeyManagerPending
								? t("admin:admin.diagnostics.keyManager.pending", "Testing Scaleway Key Manager encryption.")
								: keyManagerResult
									? keyManagerResult.matches
										? t("admin:admin.diagnostics.keyManager.successAnnouncement", "Scaleway Key Manager test passed.")
										: t("admin:admin.diagnostics.keyManager.failureAnnouncement", "Scaleway Key Manager test completed with a mismatch.")
									: ""}
						</p>
					</div>
					<Button
						onClick={testKeyManagerEncryption}
						disabled={isKeyManagerPending}
						aria-label={t("admin:admin.diagnostics.keyManager.action", "Test encryption")}
					>
						{isKeyManagerPending ? (
							<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
						) : (
							<IconKey className="mr-2 size-4" aria-hidden="true" />
						)}
						{t("admin:admin.diagnostics.keyManager.action", "Test encryption")}
					</Button>
				</CardHeader>
				<CardContent className="space-y-4">
					{keyManagerError ? (
						<div
							className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-400"
							role="alert"
							aria-live="polite"
						>
							{keyManagerError}
						</div>
					) : null}
					{keyManagerResult ? (
						<div className="grid gap-3 text-sm sm:grid-cols-2">
							<div>
								<div className="text-muted-foreground">{t("admin:admin.diagnostics.keyManager.input", "Input")}</div>
								<div className="font-mono">{keyManagerResult.input}</div>
							</div>
							<div>
								<div className="text-muted-foreground">{t("admin:admin.diagnostics.keyManager.output", "Output")}</div>
								<div className="font-mono">{keyManagerResult.output}</div>
							</div>
							<div>
								<div className="text-muted-foreground">{t("admin:admin.diagnostics.keyManager.keyId", "Platform key ID")}</div>
								<div className="break-all font-mono">{keyManagerResult.platformKeyId}</div>
							</div>
							<div>
								<div className="text-muted-foreground">{t("admin:admin.diagnostics.keyManager.keyStatus", "Key status")}</div>
								<div>
									{keyManagerResult.keyStatus === "created"
										? t("admin:admin.diagnostics.keyManager.created", "Created new platform key")
										: t("admin:admin.diagnostics.keyManager.reused", "Reused existing platform key")}
								</div>
							</div>
							<div className="sm:col-span-2">
								<div className="text-muted-foreground">{t("admin:admin.diagnostics.keyManager.ciphertext", "Ciphertext preview")}</div>
								<div className="break-all font-mono text-muted-foreground">{keyManagerResult.ciphertextPreview}</div>
							</div>
						</div>
					) : null}
				</CardContent>
			</Card>
```

- [ ] **Step 6: Run the client tests**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx'
```

Expected: PASS.

- [ ] **Step 7: Commit diagnostics UI**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx'
git commit -m "feat: add key manager diagnostics UI"
```

---

### Task 4: Integration Verification

**Files:**
- No new files.
- Verify all files touched in Tasks 1-3.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm --filter webapp test src/lib/vault/platform-key-manager.test.ts 'src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts' 'src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx'
```

Expected: PASS for all three test files.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm exec tsc --noEmit
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Inspect final diff for security issues**

Run:

```bash
git diff HEAD -- apps/webapp/src/lib/vault apps/webapp/src/app/[locale]/\(admin\)/platform-admin/diagnostics
```

Verify manually:

- no Scaleway credentials or raw env values are returned to the client
- `PlatformAdminService.requirePlatformAdmin()` runs before faker generation and Key Manager work
- no organization ID is accepted by platform key manager APIs
- `system_config` stores only `platform_scaleway_key_id`
- stored-but-broken keys fail instead of being replaced silently

- [ ] **Step 4: Commit verification-only fixes if needed**

If Step 1, Step 2, or Step 3 required code changes, run the relevant targeted tests again, then commit only those fixes:

```bash
git add apps/webapp/src/lib/vault apps/webapp/src/app/[locale]/\(admin\)/platform-admin/diagnostics
git commit -m "fix: harden platform key diagnostics"
```

If no fixes were needed, do not create an empty commit.

---

## Plan Self-Review

- Spec coverage: The plan covers platform key creation, ID persistence in `system_config`, faker-generated input, encrypt/decrypt, UI result display, platform-admin authorization, safe error display, and tests.
- Placeholder scan: No task uses unfinished placeholder language; each implementation task includes concrete code or exact verification commands.
- Type consistency: `PlatformKeyManagerEncryptionResult`, `testPlatformKeyManagerEncryption`, and `testPlatformKeyManagerEncryptionAction` are named consistently across service, action, and UI tasks.
