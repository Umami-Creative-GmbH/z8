# Better Auth 1.7 SCIM Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore organization-scoped SCIM User and Group provisioning on Better Auth 1.7 with self-service managed credentials, atomic Z8 lifecycle and role projection, and no legacy credential compatibility.

**Architecture:** Register `@better-auth/scim` in managed-connection mode and bind every connection to an immutable Z8 organization ID. Better Auth owns protocol resources and credential storage; focused Z8 modules use Better Auth's transaction adapter for identity, organization lifecycle, projection, and durable billing-outbox writes. Thin server actions expose the trusted managed APIs to authorized organization administrators, while a database-backed maintenance job handles billing delivery and resumable decommissioning.

**Tech Stack:** Next.js 16 App Router, Better Auth 1.7.1, `@better-auth/scim` 1.7.1, Drizzle ORM/PostgreSQL, Vitest, BullMQ cron jobs, React 19, Tolgee, pnpm.

---

## File Structure

Create focused backend modules under `apps/webapp/src/lib/scim/`:

- `constants.ts`: scopes, one-year credential lifetime, connection states, and safe DTOs.
- `transaction-store.ts`: the only callback-facing wrapper over Better Auth's `DBTransactionAdapter` and read adapter.
- `identity-resolution.ts`: verified organization-member linking decisions.
- `sso-resolution.ts`: active SCIM subject linking for paired persisted SSO providers.
- `lifecycle-reconciler.ts`: reversible organization membership/employee state and billing-outbox writes.
- `projection-reconciler.ts`: Group mapping, template validation, deterministic winner selection, and complete access reconciliation.
- `plugin.ts`: Better Auth SCIM plugin assembly.
- `managed-control-plane.ts`: trusted managed connection, credential, event, and creation-recovery operations.
- `seat-sync-outbox.ts`: durable claims, completion, and retry behavior outside SCIM callbacks.
- `decommission.ts`: durable decommission state transitions and Better Auth retry calls.

Create thin administrator and UI boundaries:

- `apps/webapp/src/app/[locale]/(app)/settings/enterprise/identity-setup/scim-actions.ts`: authorization-first server actions.
- `apps/webapp/src/components/settings/enterprise/scim/`: SCIM step, controller, one-time credential dialog, credential list, event list, and destructive dialogs.
- `apps/webapp/src/lib/jobs/scim-maintenance.ts`: bounded outbox and decommission processing.

Do not add a separate SCIM HTTP route. Extend the existing Better Auth catch-all to forward all five SCIM methods.

### Task 1: Install And Gate The SCIM Runtime

**Files:**
- Modify: `apps/webapp/package.json:21-30`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/webapp/src/env.ts:51-58,260-280`
- Modify: `apps/webapp/src/env.test.ts:5-12,105-448`
- Modify: `apps/webapp/vitest.config.ts:8-11`
- Modify: `apps/webapp/src/app/api/auth/[...all]/route.ts:1-42`
- Modify: `turbo.json:12-15`
- Modify: `deploy/k8s/webapp.yaml:105-115`
- Modify: `deploy/k8s/worker.yaml:41-103`
- Modify: `deploy/compose/docker-compose.yml:235-250,340-356`
- Modify: `deploy/README.md:250-260`
- Test: `apps/webapp/src/app/api/auth/[...all]/route.test.ts`

- [ ] **Step 1: Add failing environment tests**

Add a valid SCIM secret to `baseEnv` and these explicit cases using the existing `importEnv` helper:

```ts
it("requires an independent SCIM credential hash secret", async () => {
	vi.spyOn(process, "exit").mockImplementation((() => {
		throw new Error("process.exit:1");
	}) as never);
	await expect(importEnv({ SCIM_CREDENTIAL_HASH_SECRET: undefined })).rejects.toThrow(
		"process.exit:1",
	);
	await expect(importEnv({ SCIM_CREDENTIAL_HASH_SECRET: "x".repeat(31) })).rejects.toThrow(
		"process.exit:1",
	);
	const { env } = await importEnv({ SCIM_CREDENTIAL_HASH_SECRET: "x".repeat(32) });
	expect(env.SCIM_CREDENTIAL_HASH_SECRET).toBe("x".repeat(32));
});
```

- [ ] **Step 2: Add a failing route-method contract test**

Assert that the auth route exports and host-checks every SCIM method:

```ts
for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
	expect(authRouteSource).toContain(`export const ${method} = withPlatformHostCheck("${method}")`);
}
```

- [ ] **Step 3: Run the focused tests and verify failure**

Run:

```bash
pnpm --dir apps/webapp exec vitest run src/env.test.ts 'src/app/api/auth/[...all]/route.test.ts'
```

Expected: FAIL because the variable is not validated and the route exports only `GET` and `POST`.

- [ ] **Step 4: Install the exact plugin patch and add environment validation**

Run:

```bash
pnpm --dir apps/webapp add @better-auth/scim@1.7.1 --save-exact
```

Add to the server schema and runtime mapping:

```ts
SCIM_CREDENTIAL_HASH_SECRET: z.string().min(32),
```

```ts
SCIM_CREDENTIAL_HASH_SECRET: process.env.SCIM_CREDENTIAL_HASH_SECRET,
```

Set the Vitest-only value to:

```ts
SCIM_CREDENTIAL_HASH_SECRET: "test-scim-credential-hash-secret-at-least-32-characters",
```

- [ ] **Step 5: Forward all SCIM methods**

Replace the duplicated wrappers with:

```ts
type SCIMHTTPMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function withPlatformHostCheck(method: SCIMHTTPMethod) {
	return async (request: Request) => {
		const response = await rejectUnsupportedPlatformHost(request);
		return response ?? handlers[method](request);
	};
}

export const GET = withPlatformHostCheck("GET");
export const POST = withPlatformHostCheck("POST");
export const PUT = withPlatformHostCheck("PUT");
export const PATCH = withPlatformHostCheck("PATCH");
export const DELETE = withPlatformHostCheck("DELETE");
```

Preserve the existing platform-host request validation around every exported method. If the route wraps methods individually, create each wrapper from the same validated handler rather than bypassing the host check.

- [ ] **Step 6: Run the focused tests and verify success**

Run the Step 3 command.

Expected: PASS.

- [ ] **Step 7: Pass the independent secret to builds and runtime processes**

Add `SCIM_CREDENTIAL_HASH_SECRET` to Turborepo's test environment allowlist. Add `scim-credential-hash-secret` from `z8-secrets` to the webapp and worker Kubernetes deployments. Add required `SCIM_CREDENTIAL_HASH_SECRET` values to both compose services. Because the worker resumes managed decommissioning through `auth.api`, also pass the existing `auth-secret`/`BETTER_AUTH_SECRET` to the worker. Document the new independent secret and its 32-character minimum in `deploy/README.md`.

- [ ] **Step 8: Commit**

```bash
git add apps/webapp/package.json pnpm-lock.yaml apps/webapp/src/env.ts apps/webapp/src/env.test.ts apps/webapp/vitest.config.ts 'apps/webapp/src/app/api/auth/[...all]/route.ts' 'apps/webapp/src/app/api/auth/[...all]/route.test.ts' turbo.json deploy/k8s/webapp.yaml deploy/k8s/worker.yaml deploy/compose/docker-compose.yml deploy/README.md
git commit -m "feat: prepare Better Auth SCIM runtime"
```

### Task 2: Define Organization-Owned SCIM State

**Files:**
- Modify: `apps/webapp/src/db/schema/scim.ts:1-147`
- Modify: `apps/webapp/src/db/schema/identity.ts:200-300`
- Modify: `apps/webapp/src/db/schema/relations.ts:2828-2953`
- Modify: `apps/webapp/src/db/index.ts:110-315`
- Test: `apps/webapp/src/db/schema/__tests__/scim-schema.test.ts`
- Test: `apps/webapp/src/db/__tests__/index.test.ts`

- [ ] **Step 1: Write schema tests for the new ownership model**

Test these exact invariants:

```ts
expect(columnNames(scimProviderConfig)).toEqual(
	expect.arrayContaining([
		"organization_id",
		"creation_request_id",
		"connection_id",
		"connection_state",
		"default_role_template_id",
	]),
);
expect(columnNames(scimProviderConfig)).not.toContain("provider_id");
expect(uniqueColumns(scimUserLifecycleState)).toContainEqual([
	"organization_id",
	"user_id",
]);
expect(uniqueColumns(scimSeatSyncOutbox)).toContainEqual([
	"organization_id",
	"dedupe_key",
]);
expect(scimSchemaSource).not.toContain("legacyScimProvider");
```

Also assert that `userLifecycleEvent.createdBy` permits `null` for system events and that the outbox has a status/availability index.

- [ ] **Step 2: Run schema tests and verify failure**

Run:

```bash
pnpm --dir apps/webapp exec vitest run src/db/schema/__tests__/scim-schema.test.ts src/db/__tests__/index.test.ts
```

Expected: FAIL because the new tables and columns do not exist.

- [ ] **Step 3: Replace the legacy provider/config schema**

Define these values in `src/db/schema/scim.ts`:

```ts
export const scimConnectionStateEnum = pgEnum("scim_connection_state", [
	"creating",
	"active",
	"decommissioning",
	"decommissioned",
]);

export const scimProviderConfig = pgTable(
	"scim_provider_config",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" })
			.unique(),
		creationRequestId: text("creation_request_id").notNull().unique(),
		connectionId: text("connection_id").unique(),
		connectionState: scimConnectionStateEnum("connection_state")
			.default("creating")
			.notNull(),
		autoActivateUsers: boolean("auto_activate_users").default(false).notNull(),
		deprovisionAction: text("deprovision_action")
			.$type<"soft_delete" | "suspend">()
			.default("suspend")
			.notNull(),
		defaultRoleTemplateId: uuid("default_role_template_id")
			.notNull()
			.references(() => roleTemplate.id),
		decommissionRetryAt: timestamp("decommission_retry_at"),
		decommissionAttemptCount: integer("decommission_attempt_count").default(0).notNull(),
		decommissionLastError: text("decommission_last_error"),
		decommissionStartedAt: timestamp("decommission_started_at"),
		decommissionCompletedAt: timestamp("decommission_completed_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by").notNull().references(() => user.id),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("scimProviderConfig_org_connection_idx").on(
			table.organizationId,
			table.connectionId,
		),
	],
);
```

Import `roleTemplate` from `identity.ts`. Remove `legacyScimProvider` and token-generation metadata. Add nullable `connectionId`, `scimResourceId`, and `requestId` columns to `scimProvisioningLog`; these store opaque identifiers only. Keep bearer tokens and complete request payloads out of the audit table.

- [ ] **Step 4: Add reversible lifecycle, projection, and outbox tables**

Define:

```ts
export const scimUserLifecycleState = pgTable(
	"scim_user_lifecycle_state",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
		connectionId: text("connection_id").notNull(),
		membershipRevision: integer("membership_revision").default(0).notNull(),
		scimActive: boolean("scim_active").default(true).notNull(),
		memberStatusBeforeDeactivation: text("member_status_before_deactivation"),
		employeeActiveBeforeDeactivation: boolean("employee_active_before_deactivation"),
		deactivationOwned: boolean("deactivation_owned").default(false).notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("scimUserLifecycleState_org_user_uidx").on(table.organizationId, table.userId),
		index("scimUserLifecycleState_org_connection_idx").on(table.organizationId, table.connectionId),
	],
);

export const scimRoleProjectionState = pgTable(
	"scim_role_projection_state",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
		roleTemplateId: uuid("role_template_id").notNull().references(() => roleTemplate.id),
		sourceGroupId: text("source_group_id"),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("scimRoleProjectionState_org_user_uidx").on(table.organizationId, table.userId),
	],
);

export const scimSeatSyncOutboxStatusEnum = pgEnum("scim_seat_sync_outbox_status", [
	"pending",
	"processing",
	"completed",
]);

export const scimSeatSyncOutbox = pgTable(
	"scim_billing_seat_sync_outbox",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		connectionId: text("connection_id").notNull(),
		userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
		membershipRevision: integer("membership_revision").notNull(),
		dedupeKey: text("dedupe_key").notNull(),
		status: scimSeatSyncOutboxStatusEnum("status").default("pending").notNull(),
		availableAt: timestamp("available_at").defaultNow().notNull(),
		claimedAt: timestamp("claimed_at"),
		claimToken: uuid("claim_token"),
		attemptCount: integer("attempt_count").default(0).notNull(),
		lastError: text("last_error"),
		processedAt: timestamp("processed_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("scimSeatSyncOutbox_org_dedupe_uidx").on(table.organizationId, table.dedupeKey),
		index("scimSeatSyncOutbox_status_available_idx").on(table.status, table.availableAt),
	],
);
```

Use a membership-revision dedupe key, not a request ID.

- [ ] **Step 5: Make lifecycle actor attribution explicit**

Change `userLifecycleEvent.createdBy` to nullable and add:

```ts
actorType: text("actor_type").$type<"user" | "system">().default("user").notNull(),
```

Existing user-originated writes keep `actorType: "user"`; SCIM writes use `actorType: "system"` and `createdBy: null`.

- [ ] **Step 6: Add relations and exports**

Add organization-qualified relations for config, lifecycle state, projection state, outbox, User, role template, and audit actor. Export the new symbols through `@/db` only where current consumers use that barrel.

- [ ] **Step 7: Run tests and verify success**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/webapp/src/db/schema/scim.ts apps/webapp/src/db/schema/identity.ts apps/webapp/src/db/schema/relations.ts apps/webapp/src/db/index.ts apps/webapp/src/db/schema/__tests__/scim-schema.test.ts apps/webapp/src/db/__tests__/index.test.ts
git commit -m "feat: define managed SCIM application state"
```

### Task 3: Implement Explicit Identity Resolution

**Files:**
- Create: `apps/webapp/src/lib/scim/constants.ts`
- Create: `apps/webapp/src/lib/scim/transaction-store.ts`
- Create: `apps/webapp/src/lib/scim/identity-resolution.ts`
- Test: `apps/webapp/src/lib/scim/identity-resolution.test.ts`

- [ ] **Step 1: Write identity decision tests**

Cover the four decisions with a fake Better Auth read adapter:

```ts
it.each([
	{ verified: true, memberOrganizationId: ORG_ID, expected: { action: "link", userId: USER_ID, profile: "preserve" } },
	{ verified: false, memberOrganizationId: ORG_ID, expectedCode: "SCIM_IDENTITY_CONFLICT" },
	{ verified: true, memberOrganizationId: OTHER_ORG_ID, expectedCode: "SCIM_IDENTITY_CONFLICT" },
])("links only a verified member in the provisioning organization", async (testCase) => {
	const store = createIdentityStoreFixture({
		user: { id: USER_ID, emailVerified: testCase.verified },
		membership:
			testCase.memberOrganizationId === ORG_ID
				? { id: MEMBER_ID, status: "approved" }
				: null,
	});
	const operation = resolveSCIMUserIdentity(input, store);
	if (testCase.expected) {
		await expect(operation).resolves.toEqual(testCase.expected);
	} else {
		await expect(operation).rejects.toMatchObject({ code: testCase.expectedCode });
	}
});

it("creates when no Better Auth User owns the normalized email", async () => {
	await expect(resolveSCIMUserIdentity(input, emptyStore)).resolves.toEqual({ action: "create" });
});
```

Use `userName: " Ada@Example.com "` and assert the lookup key is `ada@example.com`.

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
pnpm --dir apps/webapp exec vitest run src/lib/scim/identity-resolution.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Define shared constants and safe DTOs**

```ts
import type { SCIMScope } from "@better-auth/scim";

export const SCIM_SCOPES = [
	"scim.users.read",
	"scim.users.write",
	"scim.groups.read",
	"scim.groups.write",
] as const satisfies readonly SCIMScope[];

export const SCIM_CREDENTIAL_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

export function getSCIMCredentialExpiry(now = new Date()): Date {
	return new Date(now.getTime() + SCIM_CREDENTIAL_LIFETIME_MS);
}
```

Define safe connection/credential/event DTOs without a token property. Define a separate `SCIMOneTimeCredential` response containing `token`, `credentialId`, and `expiresAt`.

- [ ] **Step 4: Implement a narrow transaction store**

Expose operations such as:

```ts
export interface SCIMReadStore {
	findUserByEmail(email: string): Promise<{ id: string; emailVerified: boolean } | null>;
	findOrganizationMember(userId: string, organizationId: string): Promise<{ id: string; status: string } | null>;
}

export function createSCIMReadStore(database: SCIMIdentityResolutionContext["database"]): SCIMReadStore {
	return {
		async findUserByEmail(email) {
			return database.findOne({ model: "user", where: [{ field: "email", value: email, mode: "insensitive" }] });
		},
		async findOrganizationMember(userId, organizationId) {
			return database.findOne({
				model: "member",
				where: [
					{ field: "userId", value: userId },
					{ field: "organizationId", value: organizationId },
				],
			});
		},
	};
}
```

Keep all callback model names centralized in this file.

- [ ] **Step 5: Implement the resolver**

```ts
export async function resolveSCIMUserIdentity(
	input: SCIMIdentityResolutionInput,
	store: SCIMReadStore,
): Promise<SCIMIdentityResolution> {
	const email = input.resource.primaryEmail.trim().toLowerCase();
	const existing = await store.findUserByEmail(email);
	if (!existing) return { action: "create" };

	const membership = await store.findOrganizationMember(
		existing.id,
		input.provisioningDomainId,
	);
	if (!existing.emailVerified || !membership) {
		throw new APIError("CONFLICT", {
			code: "SCIM_IDENTITY_CONFLICT",
			message: "The SCIM identity cannot be linked",
		});
	}

	return { action: "link", userId: existing.id, profile: "preserve" };
}
```

Import `APIError` from `better-auth/api`. The integration suite must prove this produces SCIM `409` without email or foreign-organization details.

- [ ] **Step 6: Run tests and verify success**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/lib/scim
git commit -m "feat: resolve SCIM identities safely"
```

### Task 4: Implement Transactional Lifecycle And Role Projection

**Files:**
- Create: `apps/webapp/src/lib/scim/lifecycle-reconciler.ts`
- Create: `apps/webapp/src/lib/scim/projection-reconciler.ts`
- Test: `apps/webapp/src/lib/scim/lifecycle-reconciler.test.ts`
- Test: `apps/webapp/src/lib/scim/projection-reconciler.test.ts`
- Modify: `apps/webapp/src/lib/scim/transaction-store.ts`
- Modify: `apps/webapp/src/lib/effect/services/role-template.service.ts:273-328,492-519`
- Create: `apps/webapp/src/lib/effect/services/role-template-scim-reconciliation.test.ts`

- [ ] **Step 1: Write lifecycle convergence tests**

Use an in-memory fake of the narrow transaction store and cover:

```ts
it("keeps a new member pending when auto activation is disabled", async () => {
	await reconcileSCIMLifecycle(activeState, txStore({ autoActivateUsers: false }));
	expect(state.member.status).toBe("pending");
	expect(state.employee.isActive).toBe(false);
});

it("restores only SCIM-owned pre-deactivation state", async () => {
	await reconcileSCIMLifecycle(inactiveState, txStore({ memberStatus: "pending", employeeActive: false }));
	await reconcileSCIMLifecycle(activeState, state.store);
	expect(state.member.status).toBe("pending");
	expect(state.employee.isActive).toBe(false);
});

it("writes one outbox row for one resulting membership revision", async () => {
	await reconcileSCIMLifecycle(activeState, state.store);
	await reconcileSCIMLifecycle(activeState, state.store);
	expect(state.outbox).toHaveLength(1);
});
```

Also verify system attribution and organization qualification on every operation.

- [ ] **Step 2: Write projection tests**

Cover:

```ts
it("chooses priority descending and mapping id ascending", async () => {
	const result = await chooseSCIMRoleTemplate([
		{ roleTemplateId: "b", priority: 10, mappingId: "b", sourceGroupId: "g2" },
		{ roleTemplateId: "a", priority: 10, mappingId: "a", sourceGroupId: "g1" },
	]);
	expect(result?.roleTemplateId).toBe("a");
});

it("uses the default after the winning group is removed", async () => {
	await reconcileSCIMProjection(stateWithNoGrants, storeWithDefaultTemplate);
	expect(state.projection.roleTemplateId).toBe(DEFAULT_TEMPLATE_ID);
});

it("preserves a manual effective assignment", async () => {
	await reconcileSCIMProjection(stateWithGrant, storeWithManualAssignment);
	expect(state.effectiveAssignment.assignmentSource).toBe("manual");
	expect(state.scimDesired.roleTemplateId).toBe(MAPPED_TEMPLATE_ID);
});
```

Verify foreign/inactive templates grant nothing and global `user.canUse*` fields are never updated.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm --dir apps/webapp exec vitest run src/lib/scim/lifecycle-reconciler.test.ts src/lib/scim/projection-reconciler.test.ts
```

Expected: FAIL because the reconcilers do not exist.

- [ ] **Step 4: Extend the transaction store with exact operations**

Add organization-qualified methods for config, member, employee, lifecycle state, role mappings, role templates, effective assignments, SCIM desired state, team permissions, default-team membership, audit, and outbox. Every update/delete method must require `organizationId`; no reconciler imports global `db`.

Use a single complete callback-facing interface:

```ts
export interface SCIMTransactionStore extends SCIMReadStore {
	getConfig(organizationId: string): Promise<SCIMConfigRecord>;
	ensureMemberAndEmployee(input: EnsureSCIMMemberInput): Promise<SCIMMemberState>;
	getLifecycleState(organizationId: string, userId: string): Promise<SCIMLifecycleRecord | null>;
	putLifecycleState(input: SCIMLifecycleRecord): Promise<void>;
	putSeatSyncOutbox(input: SCIMSeatSyncOutboxInput): Promise<void>;
	findGroupMapping(organizationId: string, externalId: string): Promise<SCIMRoleCandidate | null>;
	roleTemplateExists(organizationId: string, roleTemplateId: string): Promise<boolean>;
	getEffectiveAssignment(organizationId: string, userId: string): Promise<EffectiveAssignment | null>;
	putDesiredSCIMAssignment(input: DesiredSCIMAssignment): Promise<void>;
	applyOrganizationTemplate(input: ApplyOrganizationTemplateInput): Promise<void>;
}
```

- [ ] **Step 5: Implement lifecycle reconciliation**

Use `SCIMProjectedUserState.provisioningDomainId` as the organization. Determine active state from the projected state, create pending/active records according to config, record prior values before a SCIM-owned deactivation, and restore only those values on reactivation. Increment `membershipRevision` only when billable membership state changes, then write:

```ts
await store.putSeatSyncOutbox({
	organizationId,
	connectionId: state.sources[0]?.connectionId ?? config.connectionId,
	userId: state.userId,
	membershipRevision: nextRevision,
	dedupeKey: `scim-seat:${organizationId}:${state.userId}:${nextRevision}`,
});
```

- [ ] **Step 6: Implement role mapping and complete reconciliation**

Map only nonempty stable `source.externalId` values. Return the role-template UUID as Better Auth's opaque role. Validate it again in `roles.exists`. Sort candidates by `priority DESC, mappingId ASC`, fall back to the mandatory default, persist SCIM desired state, and apply it only when the effective assignment is absent or already SCIM-owned.

Template application may update employee role, organization-wide team permissions, and default-team membership. It must not update Better Auth User app-access fields.

- [ ] **Step 7: Replay projections after mapping or override changes**

Change `deleteIdpMapping` to require both mapping ID and organization ID, and qualify the delete by both fields. After a committed SCIM mapping create/delete or manual assignment removal, call:

```ts
await auth.api.reconcileSCIMProjection({
	body: { provisioningDomainId: organizationId },
});
```

Do not invoke replay for SSO-only mappings. Add tests proving organization scope is included, replay occurs after persistence, and a foreign mapping ID cannot be deleted.

- [ ] **Step 8: Run tests and verify success**

Run:

```bash
pnpm --dir apps/webapp exec vitest run src/lib/scim/lifecycle-reconciler.test.ts src/lib/scim/projection-reconciler.test.ts src/lib/effect/services/role-template-scim-reconciliation.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/webapp/src/lib/scim apps/webapp/src/lib/effect/services/role-template.service.ts apps/webapp/src/lib/effect/services/role-template-scim-reconciliation.test.ts
git commit -m "feat: reconcile SCIM lifecycle and roles"
```

### Task 5: Register The Plugin And Generate Better Auth Models

**Files:**
- Create: `apps/webapp/src/lib/scim/plugin.ts`
- Test: `apps/webapp/src/lib/scim/plugin.test.ts`
- Create: `apps/webapp/src/lib/scim/sso-resolution.ts`
- Test: `apps/webapp/src/lib/scim/sso-resolution.test.ts`
- Modify: `apps/webapp/src/lib/auth.ts:1-16,194-218,453-781`
- Modify generated: `apps/webapp/src/db/auth-schema.ts`
- Test: `apps/webapp/src/lib/auth.test.ts:247-347`
- Test: `apps/webapp/src/lib/auth-security.test.ts:37-80`
- Create: `apps/webapp/src/db/__tests__/better-auth-scim-schema.test.ts`

- [ ] **Step 1: Write plugin and generated-schema contract tests**

Assert:

```ts
expect(pluginOptions.connections).toEqual([]);
expect(pluginOptions.managedConnections.credentialHashSecret).toBe(TEST_SCIM_SECRET);
expect(pluginOptions.compatibility.microsoftEntra.acceptLegacyGroupSchema).toBe(true);
expect(adapterOptions.transaction).toBe(true);
expect(authRouteMethods).toEqual(["GET", "POST", "PUT", "PATCH", "DELETE"]);
```

The generated-schema test imports all ten model exports and asserts managed credential columns include digest/hash metadata but no raw-token column. Assert `scimUser.serializedAttributes` has no default.

Add SSO resolution tests for a persisted organization provider:

```ts
it("links an active exact SCIM external subject for a paired SSO provider", async () => {
	await expect(resolveSCIMSSOUser(ssoInput, context)).resolves.toEqual({
		action: "link",
		userId: USER_ID,
		profile: "preserve",
	});
	expect(acquireActiveLink).toHaveBeenCalledWith(
		{ connectionId: CONNECTION_ID, externalId: ssoInput.accountKey.accountId },
		context,
	);
});

it("continues unchanged when the SSO provider has no active SCIM connection", async () => {
	await expect(resolveSCIMSSOUser(unpairedInput, context)).resolves.toEqual({ action: "continue" });
});

it("rejects an inactive or missing subject for a paired provider", async () => {
	await expect(resolveSCIMSSOUser(ssoInput, context)).resolves.toEqual({
		action: "reject",
		code: "SCIM_USER_NOT_ACTIVE",
	});
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --dir apps/webapp exec vitest run src/lib/scim/plugin.test.ts src/lib/scim/sso-resolution.test.ts src/lib/auth.test.ts src/lib/auth-security.test.ts src/db/__tests__/better-auth-scim-schema.test.ts
```

Expected: FAIL because the plugin and generated models are absent.

- [ ] **Step 3: Assemble the plugin**

```ts
import { scim, type SCIMIdentity, type SCIMProjection } from "@better-auth/scim";
import { env } from "@/env";
import { resolveSCIMUserIdentity } from "./identity-resolution";
import { reconcileSCIMLifecycle } from "./lifecycle-reconciler";
import { mapSCIMGroupRoles, reconcileSCIMProjection, scimRoleExists } from "./projection-reconciler";
import { createSCIMReadStore, createSCIMTransactionStore } from "./transaction-store";

const identity: SCIMIdentity = {
	resolveUser(input, { database }) {
		return resolveSCIMUserIdentity(input, createSCIMReadStore(database));
	},
};

const projection: SCIMProjection = {
	roles: {
		map(input, { database }) {
			return mapSCIMGroupRoles(input, createSCIMTransactionStore(database));
		},
		exists(input, { database }) {
			return scimRoleExists(input, createSCIMTransactionStore(database));
		},
	},
	async reconcileUser(input, { database }) {
		const store = createSCIMTransactionStore(database);
		await reconcileSCIMLifecycle(input, store);
		await reconcileSCIMProjection(input, store);
	},
};

export const scimPlugin = scim({
	connections: [],
	managedConnections: { credentialHashSecret: env.SCIM_CREDENTIAL_HASH_SECRET },
	identity,
	projection,
	compatibility: { microsoftEntra: { acceptLegacyGroupSchema: true } },
});
```

Use the domain-specific projection callback for organization lifecycle because `identity.reconcileUser` is global and does not identify one provisioning domain.

- [ ] **Step 4: Pair persisted SSO providers with active SCIM subjects**

Implement `resolveSCIMSSOUser` by loading the exact persisted `ssoProvider` through `input.providerReference.recordId`, loading the organization-qualified active `scimProviderConfig`, and calling Better Auth's `acquireActiveSCIMUserLink` with `externalId: input.accountKey.accountId`. Return `continue` for configured providers or persisted providers without active SCIM. Return `reject` when an active paired connection has no active exact subject.

Configure the existing `sso({ resolveUser })` option to call this resolver. This requires the directory's SCIM `externalId` to equal the validated OIDC `sub` or signed SAML `NameID`; expose that requirement in the administrator guide and integration fixtures. Never fall back to email in SSO resolution.

- [ ] **Step 5: Enable native transactions and app models**

Pass `transaction: true` to `drizzleAdapter`. Supply a schema containing generated auth models and the exact app-owned callback models. Preserve `transaction` through `makeEmailLookupCaseInsensitiveAdapter`, and extend its test to prove callback forwarding rather than method presence only.

- [ ] **Step 6: Register the plugin and regenerate**

Add `scimPlugin` before `nextCookies()` in the plugin array, then run:

```bash
SCIM_CREDENTIAL_HASH_SECRET="test-scim-credential-hash-secret-at-least-32-characters" pnpm --dir apps/webapp run auth:generate
```

Review the generated file and confirm all ten official model names.

- [ ] **Step 7: Replace pre-cutover security assertions**

Require plugin registration, managed mode, the independent secret, transaction support, all route methods, and absence of `legacyScimProvider`, raw token storage, and legacy API fallback.

- [ ] **Step 8: Run tests and verify success**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/webapp/src/lib/scim/plugin.ts apps/webapp/src/lib/scim/plugin.test.ts apps/webapp/src/lib/scim/sso-resolution.ts apps/webapp/src/lib/scim/sso-resolution.test.ts apps/webapp/src/lib/auth.ts apps/webapp/src/lib/auth.test.ts apps/webapp/src/lib/auth-security.test.ts apps/webapp/src/db/auth-schema.ts apps/webapp/src/db/__tests__/better-auth-scim-schema.test.ts
git commit -m "feat: enable Better Auth managed SCIM"
```

### Task 6: Generate The Guarded PostgreSQL Migration

**Files:**
- Create: `apps/webapp/drizzle/0062_better_auth_scim_managed_connections.sql`
- Create: `apps/webapp/drizzle/meta/0062_snapshot.json`
- Modify: `apps/webapp/drizzle/meta/_journal.json`
- Modify: `apps/webapp/src/db/__tests__/drizzle-migrations.test.ts:153-160,1969-2022`
- Create: `apps/webapp/src/db/__tests__/better-auth-scim-migration.integration.test.ts`
- Create: `apps/webapp/scripts/run-better-auth-scim-integration.sh`
- Modify: `apps/webapp/package.json:5-19`

- [ ] **Step 1: Add failing static migration tests**

Require the next journal entry, all ten generated tables, app-owned tables, absence of legacy columns in the snapshot, and a guard before destructive DDL. Check ordering with string indexes:

```ts
expect(sql.indexOf("Legacy SCIM data exists")).toBeGreaterThanOrEqual(0);
expect(sql.indexOf("Legacy SCIM data exists")).toBeLessThan(sql.indexOf('DROP TABLE "scim_provider"'));
expect(snapshot.tables["public.scim_provider"]).toBeUndefined();
expect(snapshot.tables["public.scim_managed_credential"].columns.token).toBeUndefined();
```

- [ ] **Step 2: Add failing PostgreSQL guard tests**

The integration suite must apply through 0061, then independently verify that 0062 aborts when:

```sql
INSERT INTO scim_provider (id, provider_id, scim_token) VALUES ('legacy', 'legacy', 'secret');
```

```sql
INSERT INTO scim_provider_config (
  id,
  organization_id,
  provider_id,
  created_by
) VALUES (
  '00000000-0000-0000-0000-000000000062',
  'legacy-scim-org',
  'legacy-provider',
  'legacy-scim-user'
);
```

```sql
UPDATE enterprise_identity_setup SET scim = '{"enabled":true,"providerId":"legacy"}'::jsonb;
```

It must also verify the empty path succeeds and creates all expected tables.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm --dir apps/webapp exec vitest run src/db/__tests__/drizzle-migrations.test.ts
```

Expected: FAIL because migration 0062 does not exist.

- [ ] **Step 4: Generate and review the migration**

Run the repository's Drizzle generation workflow, rename the generated migration to `0062_better_auth_scim_managed_connections.sql`, and ensure the journal timestamp is greater than `1787590288956`.

Prepend a PostgreSQL `DO` block that raises before any destructive statement when any guard query returns a row. Do not copy provider IDs or token data. Keep 0061 historical assertions unchanged.

- [ ] **Step 5: Add the disposable PostgreSQL runner**

Follow `scripts/run-approval-workflow-repository-integration.sh`: use PostgreSQL 16, a unique label-owned container, loopback binding, sentinel/database verification, and cleanup only for the owned container. Add:

```json
"test:better-auth-scim:integration": "bash ./scripts/run-better-auth-scim-integration.sh"
```

- [ ] **Step 6: Run static and PostgreSQL tests**

Run:

```bash
pnpm --dir apps/webapp exec vitest run src/db/__tests__/drizzle-migrations.test.ts
pnpm --dir apps/webapp run test:better-auth-scim:integration
```

Expected: PASS, including rollback of every populated guard and successful empty migration.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/drizzle apps/webapp/src/db/__tests__/drizzle-migrations.test.ts apps/webapp/src/db/__tests__/better-auth-scim-migration.integration.test.ts apps/webapp/scripts/run-better-auth-scim-integration.sh apps/webapp/package.json
git commit -m "feat: migrate managed SCIM schema"
```

### Task 7: Prove Callback Transaction Atomicity

**Files:**
- Create: `apps/webapp/src/lib/scim/transactions.integration.test.ts`
- Modify: `apps/webapp/scripts/run-better-auth-scim-integration.sh`

- [ ] **Step 1: Write real PostgreSQL atomicity tests**

Construct the actual wrapped Drizzle adapter with `provider: "pg"`, `transaction: true`, and the combined schema. Test:

```ts
await expect(
	adapter.transaction(async (tx) => {
		await tx.create({ model: "scimUserLifecycleState", data: lifecycleRow });
		await tx.create({ model: "scimSeatSyncOutbox", data: outboxRow });
		throw new Error("rollback sentinel");
	}),
).rejects.toThrow("rollback sentinel");

expect(await countRows("scim_user_lifecycle_state")).toBe(0);
expect(await countRows("scim_billing_seat_sync_outbox")).toBe(0);
```

Add a successful commit case and a callback failure that rolls back canonical Better Auth SCIM plus Z8 rows.

- [ ] **Step 2: Run the integration suite and verify failure**

Run:

```bash
pnpm --dir apps/webapp run test:better-auth-scim:integration
```

Expected: FAIL until app-owned models are correctly exposed through the Better Auth transaction adapter.

- [ ] **Step 3: Correct adapter model registration**

Limit the adapter schema extension to the app-owned SCIM callback models and their referenced tables. Do not switch callbacks to global `db`. Keep the generated auth schema untouched except through `auth:generate`.

- [ ] **Step 4: Run the integration suite and verify success**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/lib/auth.ts apps/webapp/src/lib/scim/transaction-store.ts apps/webapp/src/lib/scim/transactions.integration.test.ts apps/webapp/scripts/run-better-auth-scim-integration.sh
git commit -m "test: prove SCIM transaction atomicity"
```

### Task 8: Implement Durable Seat Sync Maintenance

**Files:**
- Create: `apps/webapp/src/lib/scim/seat-sync-outbox.ts`
- Test: `apps/webapp/src/lib/scim/seat-sync-outbox.test.ts`
- Create: `apps/webapp/src/lib/jobs/scim-maintenance.ts`
- Test: `apps/webapp/src/lib/jobs/scim-maintenance.test.ts`
- Modify: `apps/webapp/src/lib/cron/registry.ts:211-265`
- Modify: `apps/webapp/src/lib/cron/registry.test.ts:4-68`
- Modify: `apps/webapp/src/lib/cron/schedules.ts:54-67`
- Modify: `apps/webapp/src/lib/cron/schedules.test.ts:10-31`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/worker-queue/schedule-controls.tsx:32-45`

- [ ] **Step 1: Write claim, lease, and retry tests**

Cover concurrent claims, stale lease recovery, stale token rejection, strict billing reconciliation, completed-row exclusion, and bounded retry. Assert the consumer calls:

```ts
await reconcileBillingSeatsForOrganization(organizationId, { strict: true });
```

and never calls event-style `syncBillingSeatsAfterMemberChange`.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --dir apps/webapp exec vitest run src/lib/scim/seat-sync-outbox.test.ts src/lib/jobs/scim-maintenance.test.ts src/lib/cron/registry.test.ts src/lib/cron/schedules.test.ts
```

Expected: FAIL because maintenance does not exist.

- [ ] **Step 3: Implement bounded durable processing**

Claim no more than 50 due rows with `FOR UPDATE SKIP LOCKED` or an equivalent conditional update. Use a UUID claim token. Completion and failure updates must match `id`, `organizationId`, `status = processing`, and claim token. Retry with a bounded exponential delay and a sanitized error string.

`runSCIMMaintenance` processes independent rows without one row blocking the remainder. It throws only when the database scan itself fails.

- [ ] **Step 4: Register the cron processor**

Add `cron:scim-maintenance` on `* * * * *`, one BullMQ attempt, and priority 8. Add it to both high-risk schedule lists. Do not add a new one-off `JobType` or worker switch case.

- [ ] **Step 5: Run tests and verify success**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/lib/scim/seat-sync-outbox.ts apps/webapp/src/lib/scim/seat-sync-outbox.test.ts apps/webapp/src/lib/jobs/scim-maintenance.ts apps/webapp/src/lib/jobs/scim-maintenance.test.ts apps/webapp/src/lib/cron apps/webapp/src/app/'[locale]'/'(admin)'/platform-admin/worker-queue/schedule-controls.tsx
git commit -m "feat: deliver SCIM seat sync durably"
```

### Task 9: Implement The Managed Connection Control Plane

**Files:**
- Create: `apps/webapp/src/lib/scim/managed-control-plane.ts`
- Test: `apps/webapp/src/lib/scim/managed-control-plane.test.ts`
- Create: `apps/webapp/src/lib/scim/decommission.ts`
- Test: `apps/webapp/src/lib/scim/decommission.test.ts`
- Modify: `apps/webapp/src/lib/jobs/scim-maintenance.ts`
- Modify: `apps/webapp/src/lib/jobs/scim-maintenance.test.ts`

- [ ] **Step 1: Write managed API qualification tests**

Use a typed fake of `auth.api` and assert every item method receives both IDs:

```ts
expect(authApi.getSCIMManagedConnection).toHaveBeenCalledWith({
	body: { connectionId: CONNECTION_ID, provisioningDomainId: ORGANIZATION_ID },
});
```

Test one-year expiry, all four scopes, actor ID, safe DTO mapping, no token in list/status DTOs, and one token only in create/rotate responses.

- [ ] **Step 2: Write creation-recovery tests**

Cover:

```ts
it("adopts a correlated connection, rotates, and revokes the lost credential", async () => {
	const result = await recoverManagedConnection(reservation, dependencies);
	expect(result.token).toBe(ROTATED_TOKEN);
	expect(authApi.revokeSCIMManagedCredential).toHaveBeenCalledWith(
		expect.objectContaining({ body: expect.objectContaining({ credentialId: LOST_CREDENTIAL_ID }) }),
	);
});
```

Creation must persist the reservation before calling Better Auth and persist `connectionId` before returning the raw token.

- [ ] **Step 3: Write decommission retry tests**

Verify active-to-decommissioning commits before the API call, exact `retryAfter` persistence, no early retry, both immutable IDs on every call, matching-row-only completion, and crash recovery through the cron job.

- [ ] **Step 4: Run tests and verify failure**

Run:

```bash
pnpm --dir apps/webapp exec vitest run src/lib/scim/managed-control-plane.test.ts src/lib/scim/decommission.test.ts src/lib/jobs/scim-maintenance.test.ts
```

Expected: FAIL because the services do not exist.

- [ ] **Step 5: Implement trusted managed operations**

Wrap these exact Better Auth server APIs:

```ts
createSCIMManagedConnection
listSCIMManagedConnections
getSCIMManagedConnection
rotateSCIMManagedCredential
revokeSCIMManagedCredential
listSCIMManagedConnectionEvents
decommissionSCIMManagedConnection
```

Use `SCIM_SCOPES`, `getSCIMCredentialExpiry`, `actorId`, and `provisioningDomainId: organizationId`. Map Date values to ISO strings only at action DTO boundaries.

- [ ] **Step 6: Implement resumable decommissioning**

Persist `decommissioning` before the first API call. On `reconciling`, persist exact `retryAfter`; on infrastructure failure, persist a bounded retry time and safe error. On complete, clear only the matching organization/connection association and mark the row `decommissioned`.

Extend `runSCIMMaintenance` to process due decommissions after seat rows.

- [ ] **Step 7: Run tests and verify success**

Run the Step 4 command.

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/webapp/src/lib/scim/managed-control-plane.ts apps/webapp/src/lib/scim/managed-control-plane.test.ts apps/webapp/src/lib/scim/decommission.ts apps/webapp/src/lib/scim/decommission.test.ts apps/webapp/src/lib/jobs/scim-maintenance.ts apps/webapp/src/lib/jobs/scim-maintenance.test.ts
git commit -m "feat: manage SCIM connections and credentials"
```

### Task 10: Add Authorization-First Administrator Actions

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/identity-setup/scim-actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/identity-setup/scim-actions.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.ts:51-68,81-138,215-245,494-513`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts:94-212`
- Modify: `apps/webapp/src/lib/enterprise-identity/setup-state.ts:16-48,71-122`
- Modify: `apps/webapp/src/lib/enterprise-identity/setup-state.test.ts:25-78`
- Modify: `apps/webapp/src/db/schema/enterprise-identity-setup.ts:31-85`

- [ ] **Step 1: Write action security and token-separation tests**

For create, status, rotate, revoke, events, and decommission, assert the authorization guard runs before DB or Better Auth calls. Assert client input contains no authoritative organization ID. Assert status responses cannot contain `token`:

```ts
expect(status).not.toHaveProperty("token");
expect(status.connection?.provisioningDomainId).toBe(ACTIVE_ORGANIZATION_ID);
```

Test cross-organization and unknown connection IDs produce the same public error.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --dir apps/webapp exec vitest run 'src/app/[locale]/(app)/settings/enterprise/identity-setup/scim-actions.test.ts' 'src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts' src/lib/enterprise-identity/setup-state.test.ts
```

Expected: FAIL because the current actions fail closed.

- [ ] **Step 3: Add thin server actions**

Export:

```ts
createEnterpriseIdentityScimConnectionAction
getEnterpriseIdentityScimStatusAction
rotateEnterpriseIdentityScimCredentialAction
revokeEnterpriseIdentityScimCredentialAction
listEnterpriseIdentityScimEventsAction
decommissionEnterpriseIdentityScimConnectionAction
```

Each action first calls the shared `requireEnterpriseOrgAdmin`, then invokes the control plane with `organizationId` and `authContext.user.id`. Create validates the mandatory default role template with organization/global scope before making a reservation.

- [ ] **Step 4: Separate persistent, safe live, and transient token state**

Persistent setup state contains connection state and policy but no credential. The normal setup response contains safe managed metadata. Only create/rotate returns:

```ts
export interface EnterpriseIdentitySCIMCredentialIssueResponse {
	connection: EnterpriseIdentitySCIMConnection;
	credential: EnterpriseIdentitySCIMCredential;
	token: string;
}
```

Keep enterprise identity activation independent of SCIM.

- [ ] **Step 5: Remove fail-closed legacy actions and tests**

Delete `SCIM_UNAVAILABLE_MESSAGE`, legacy `providerId` token input, and assertions that SCIM APIs are absent. Keep the authorization behavior and organization-scoped setup helpers.

- [ ] **Step 6: Run tests and verify success**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/enterprise' apps/webapp/src/lib/enterprise-identity/setup-state.ts apps/webapp/src/lib/enterprise-identity/setup-state.test.ts apps/webapp/src/db/schema/enterprise-identity-setup.ts
git commit -m "feat: expose managed SCIM administration"
```

### Task 11: Restore The SCIM Administrator UI

**Files:**
- Create: `apps/webapp/src/components/settings/enterprise/scim/scim-step.tsx`
- Create: `apps/webapp/src/components/settings/enterprise/scim/use-scim-admin-controller.ts`
- Create: `apps/webapp/src/components/settings/enterprise/scim/scim-one-time-credential-dialog.tsx`
- Create: `apps/webapp/src/components/settings/enterprise/scim/scim-credential-list.tsx`
- Create: `apps/webapp/src/components/settings/enterprise/scim/scim-events-list.tsx`
- Create: `apps/webapp/src/components/settings/enterprise/scim/scim-destructive-dialogs.tsx`
- Test: `apps/webapp/src/components/settings/enterprise/scim/scim-step.test.tsx`
- Test: `apps/webapp/src/components/settings/enterprise/scim/scim-one-time-credential-dialog.test.tsx`
- Modify: `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.tsx:8-16,334-688,1172-1187`
- Modify: `apps/webapp/src/components/settings/enterprise/identity-setup-wizard.test.tsx:421-513`
- Modify: `apps/webapp/src/components/settings/enterprise/domains-branding-tabs.tsx:83-103`

- [ ] **Step 1: Write one-time credential behavior tests**

Following the API-key and webhook secret dialog patterns, verify:

```ts
expect(screen.getByText(RAW_TOKEN)).toBeVisible();
await user.click(screen.getByRole("button", { name: /copy/i }));
expect(navigator.clipboard.writeText).toHaveBeenCalledWith(RAW_TOKEN);
await user.click(screen.getByRole("button", { name: /saved/i }));
expect(screen.queryByText(RAW_TOKEN)).not.toBeInTheDocument();
```

Reopening the setup must not restore the token. Prevent outside-click dismissal and require a second confirmation if the credential was not copied.

- [ ] **Step 2: Write SCIM step state tests**

Cover disconnected, creating, active-unverified, verified, rotating, decommissioning, and decommissioned states. Require endpoint display, one-year expiry, last-used verification, event list, revoke confirmation, and irreversible decommission warning. Ensure mobile rendering does not overflow.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm --dir apps/webapp exec vitest run src/components/settings/enterprise/scim 'src/components/settings/enterprise/identity-setup-wizard.test.tsx'
```

Expected: FAIL because only the unavailable card exists.

- [ ] **Step 4: Implement the isolated controller and transient secret state**

The controller calls the new actions, stores the raw token only in component state, clears it on confirmed close, and refreshes safe metadata after each mutation. Use transitions for mutations and do not place the token in URL state, query cache, analytics, or toast content.

- [ ] **Step 5: Implement the SCIM step components**

Reuse the existing design language and Tabler icons. Require a default role template before create. Render `/api/auth/scim/v2`, connection state, credential status/expiry/last use, rotate/revoke actions, events, and decommission state. Keep enterprise activation controls independent.

- [ ] **Step 6: Replace the unavailable wizard card and stale guided copy**

Import `ScimStep` into the existing wizard and pass safe setup metadata plus role-template policy. Remove unavailable copy and dead SCIM mocks.

- [ ] **Step 7: Run tests and verify success**

Run the Step 3 command.

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/webapp/src/components/settings/enterprise/scim apps/webapp/src/components/settings/enterprise/identity-setup-wizard.tsx apps/webapp/src/components/settings/enterprise/identity-setup-wizard.test.tsx apps/webapp/src/components/settings/enterprise/domains-branding-tabs.tsx
git commit -m "feat: restore SCIM setup controls"
```

### Task 12: Update Locales And Administrator Documentation

**Files:**
- Modify: `apps/webapp/messages/settings/enterprise/en.json`
- Modify: `apps/webapp/messages/settings/enterprise/de.json`
- Modify: `apps/webapp/messages/settings/enterprise/es.json`
- Modify: `apps/webapp/messages/settings/enterprise/fr.json`
- Modify: `apps/webapp/messages/settings/enterprise/it.json`
- Modify: `apps/webapp/messages/settings/enterprise/gsw.json`
- Modify: `apps/webapp/messages/settings/enterprise/el.json`
- Modify: `apps/webapp/messages/settings/enterprise/pl.json`
- Modify: `apps/webapp/messages/settings/enterprise/pt.json`
- Modify: `apps/webapp/messages/settings/enterprise/tr.json`
- Modify: `apps/docs/content/docs/guide/admin-guide/scim-provisioning.mdx:1-54`
- Test: `apps/webapp/src/components/settings/enterprise/scim/scim-i18n.test.ts`

- [ ] **Step 1: Write translation-key coverage tests**

Load all ten catalogs and require the same keys for create, one-time warning, endpoint, verified/unverified, expiry, last used, rotate, revoke, events, full reprovisioning, and decommissioning. Reject the migration-unavailable phrase and legacy “generate provisioning token” description.

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
pnpm --dir apps/webapp exec vitest run src/components/settings/enterprise/scim/scim-i18n.test.ts
```

Expected: FAIL because catalogs contain stale copy.

- [ ] **Step 3: Update every locale**

Add the exact key set used by the SCIM components. Translate visible copy in every catalog; do not rely on English component fallbacks.

- [ ] **Step 4: Rewrite the administrator guide**

Document the exact endpoint, organization binding, one-time credential, one-year expiry, overlap rotation, revocation, verification after authenticated traffic, complete User/Group reprovisioning, default template and stable Group external ID mapping, organization-local deactivation, and irreversible decommissioning. Require each SCIM User `externalId` to equal the paired provider's validated OIDC `sub` or signed SAML `NameID`, and state that no email fallback or legacy token works.

- [ ] **Step 5: Run webapp and docs verification**

Run:

```bash
pnpm --dir apps/webapp exec vitest run src/components/settings/enterprise/scim/scim-i18n.test.ts
CI=true pnpm --dir apps/docs build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/messages/settings/enterprise apps/webapp/src/components/settings/enterprise/scim/scim-i18n.test.ts apps/docs/content/docs/guide/admin-guide/scim-provisioning.mdx
git commit -m "docs: document managed SCIM provisioning"
```

### Task 13: Remove Legacy SCIM Implementation

**Files:**
- Delete: `apps/webapp/src/lib/effect/services/scim-provisioning.service.ts`
- Delete: `apps/webapp/src/lib/effect/services/scim-provisioning.service.test.ts`
- Delete: `apps/webapp/src/lib/enterprise-identity/scim-token-response.ts`
- Modify: `apps/webapp/src/lib/effect/services/cached-queries.ts:1-40`
- Modify: `apps/webapp/src/db/__tests__/employee-owner-lifecycle-migration.test.ts:241-290`
- Test: `apps/webapp/src/lib/auth-security.test.ts`

- [ ] **Step 1: Strengthen the legacy-absence test**

Assert no production source references:

```ts
expect(source).not.toContain("generateSCIMToken");
expect(source).not.toContain("listSCIMProviderConnections");
expect(source).not.toContain("deleteSCIMProviderConnection");
expect(source).not.toContain("legacyScimProvider");
expect(source).not.toContain("scimToken");
```

Allow the transient managed response property `token` only in the control-plane issue type and one-time UI state.

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
pnpm --dir apps/webapp exec vitest run src/lib/auth-security.test.ts src/db/__tests__/employee-owner-lifecycle-migration.test.ts
```

Expected: FAIL while legacy files and old concurrency assumptions remain.

- [ ] **Step 3: Delete obsolete files and cached queries**

Remove the orphaned Effect service, source-level test, legacy token response helper, `getScimProviderConfig`, and unused imports. Update the concurrency model to restore prior SCIM-owned state rather than always setting approved/active.

- [ ] **Step 4: Run tests and verify success**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/webapp/src/lib/effect/services apps/webapp/src/lib/enterprise-identity apps/webapp/src/lib/auth-security.test.ts apps/webapp/src/db/__tests__/employee-owner-lifecycle-migration.test.ts
git commit -m "refactor: remove legacy SCIM provisioning"
```

### Task 14: Add Protocol And End-To-End PostgreSQL Coverage

**Files:**
- Create: `apps/webapp/src/lib/scim/protocol.integration.test.ts`
- Modify: `apps/webapp/scripts/run-better-auth-scim-integration.sh`
- Test: `apps/webapp/src/lib/scim/transactions.integration.test.ts`

- [ ] **Step 1: Add managed credential and protocol tests**

Start the real auth handler against disposable PostgreSQL, create a managed connection through `auth.api`, and send HTTP requests to:

```text
/api/auth/scim/v2/ServiceProviderConfig
/api/auth/scim/v2/Users
/api/auth/scim/v2/Groups
```

Cover User and Group POST, PUT, PATCH, DELETE, equality filters, pagination, Microsoft Entra's exact legacy Group marker, invalid/expired credentials (`401`), missing scope (`403`), invalid resource (`400`), and identity conflict (`409`).

- [ ] **Step 2: Add a complete reprovisioning scenario**

Provision two Users and two Groups, verify default and mapped templates, remove the winning Group, deactivate/reactivate one User, rotate and revoke the credential, and decommission until complete. Assert organization B remains unchanged at every step.

- [ ] **Step 3: Run integration tests and verify failures expose missing behavior**

Run:

```bash
pnpm --dir apps/webapp run test:better-auth-scim:integration
```

Expected before final fixes: any remaining protocol, transaction, projection, or tenant-isolation defect fails with a concrete assertion.

- [ ] **Step 4: Fix only defects demonstrated by the integration suite**

Keep fixes in the focused SCIM modules. Do not add legacy fallback, raw token persistence, global User deactivation, or display-name authorization.

- [ ] **Step 5: Run integration tests and verify success**

Run the Step 3 command.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/lib/scim apps/webapp/scripts/run-better-auth-scim-integration.sh
git commit -m "test: cover managed SCIM provisioning"
```

### Task 15: Complete Repository Verification

**Files:**
- Verify all files changed by Tasks 1-14

- [ ] **Step 1: Run targeted SCIM tests**

```bash
pnpm --dir apps/webapp exec vitest run src/lib/scim src/lib/auth.test.ts src/lib/auth-security.test.ts src/db/schema/__tests__/scim-schema.test.ts src/db/__tests__/better-auth-scim-schema.test.ts src/db/__tests__/drizzle-migrations.test.ts 'src/app/[locale]/(app)/settings/enterprise/identity-setup/scim-actions.test.ts' src/components/settings/enterprise/scim 'src/components/settings/enterprise/identity-setup-wizard.test.tsx'
```

Expected: PASS.

- [ ] **Step 2: Run disposable PostgreSQL verification**

```bash
pnpm --dir apps/webapp run test:better-auth-scim:integration
```

Expected: PASS.

- [ ] **Step 3: Check generated schema parity**

```bash
SCIM_CREDENTIAL_HASH_SECRET="test-scim-credential-hash-secret-at-least-32-characters" pnpm --dir apps/webapp run auth:generate
```

Expected: no diff.

- [ ] **Step 4: Run full tests and typecheck**

```bash
pnpm --dir apps/webapp test
SCIM_CREDENTIAL_HASH_SECRET="test-scim-credential-hash-secret-at-least-32-characters" pnpm --dir apps/webapp run typecheck
```

Expected: PASS.

- [ ] **Step 5: Run React diagnostics**

Invoke the repository `react-doctor` skill and resolve actionable diagnostics introduced by the SCIM UI. Re-run the changed component tests after every fix.

- [ ] **Step 6: Run production builds**

```bash
SCIM_CREDENTIAL_HASH_SECRET="test-scim-credential-hash-secret-at-least-32-characters" CI=true pnpm --dir apps/webapp build
CI=true pnpm --dir apps/docs build
```

Expected: PASS.

- [ ] **Step 7: Inspect the final diff for migration and secret safety**

Confirm the diff contains no raw token fixture outside tests, no legacy token compatibility, no global User deactivation, no unqualified organization lookup, and no manual edit inconsistent with generated `auth-schema.ts`.

- [ ] **Step 8: Commit verification-only fixes only when Step 7 changed files**

```bash
git status --short
git diff --check
```

If `git status --short` lists verification fixes, stage only those listed files and commit them with `git commit -m "fix: complete SCIM migration verification"`. Skip the commit when verification required no file changes.
