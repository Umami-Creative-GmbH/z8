# Employee Invitation Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee one stable pending employee draft per organization/email, preserve edits across resends, consume drafts on acceptance, and repair existing duplicate rows.

**Architecture:** Move draft identity from invitation-attempt ID to `(organizationId, normalizedEmail)` while retaining a link to the current Better Auth invitation. Centralize email normalization and invitation actionability, make resend one server operation, and enforce pending/unexpired/no-employee eligibility in list, detail, edit, and delete paths.

**Tech Stack:** Next.js 16 server actions, Better Auth organization plugin, Drizzle ORM/PostgreSQL, Effect, Temporal, TanStack Query, Vitest, Testing Library.

**Design:** `docs/superpowers/specs/2026-07-18-employee-invitation-lifecycle-design.md`

---

## File Map

**Create:**

- `apps/webapp/src/lib/auth/employee-invitation-draft.ts`: normalized identity, actionability, and stable draft attachment.
- `apps/webapp/src/lib/auth/employee-invitation-draft.test.ts`: unit tests for those invariants.
- `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-invitation-draft-eligibility.ts`: shared Drizzle eligibility predicate.
- `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-invitation-draft-eligibility.test.ts`: executable predicate tests.
- `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-draft-actions.tsx`: resend/delete controls.
- `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-draft-actions.test.tsx`: control interaction tests.
- `apps/webapp/drizzle/0054_employee_invitation_draft_identity.sql`: deterministic cleanup and uniqueness migration.
- `apps/webapp/drizzle/meta/0054_snapshot.json`: generated schema snapshot.

**Modify:**

- `apps/webapp/src/db/schema/employee-invitation-draft.ts`
- `apps/webapp/src/db/schema/__tests__/employee-invitation-draft-schema.test.ts`
- `apps/webapp/src/db/__tests__/drizzle-migrations.test.ts`
- `apps/webapp/drizzle/meta/_journal.json`
- `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.test.ts`
- `apps/webapp/src/components/organization/members-table.tsx`
- `apps/webapp/src/components/organization/members-table.test.tsx`
- `apps/webapp/src/components/organization/invite-member-dialog.tsx`
- `apps/webapp/src/components/organization/invite-member-dialog.test.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.test.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/actions.ts`
- `apps/webapp/src/lib/auth/organization-member-provisioning.ts`
- `apps/webapp/src/lib/auth/organization-member-provisioning.test.ts`
- `apps/webapp/src/lib/auth.ts`
- `apps/webapp/src/lib/auth.test.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx`

Do not modify `apps/webapp/src/db/auth-schema.ts`.

### Task 1: Define Draft Identity And Invitation Actionability

**Files:**

- Create: `apps/webapp/src/lib/auth/employee-invitation-draft.ts`
- Create: `apps/webapp/src/lib/auth/employee-invitation-draft.test.ts`

- [ ] **Step 1: Write failing normalization and expiry tests**

```ts
import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import {
	isInvitationActionable,
	normalizeInvitationEmail,
} from "./employee-invitation-draft";

describe("normalizeInvitationEmail", () => {
	it.each([
		[" Ada@Example.COM ", "ada@example.com"],
		["employee@example.com", "employee@example.com"],
	])("normalizes %j", (input, expected) => {
		expect(normalizeInvitationEmail(input)).toBe(expected);
	});
});

describe("isInvitationActionable", () => {
	const now = Temporal.Instant.from("2026-07-18T12:00:00Z");

	it("accepts a pending invitation expiring after now", () => {
		expect(
			isInvitationActionable(
				{ status: "pending", expiresAt: new Date("2026-07-18T12:00:01Z") },
				now,
			),
		).toBe(true);
	});

	it.each(["accepted", "canceled", "rejected"])("rejects %s", (status) => {
		expect(
			isInvitationActionable(
				{ status, expiresAt: new Date("2026-07-19T12:00:00Z") },
				now,
			),
		).toBe(false);
	});

	it.each(["2026-07-18T12:00:00Z", "2026-07-18T11:59:59Z"])(
		"rejects pending expiry %s",
		(expiresAt) => {
			expect(
				isInvitationActionable({ status: "pending", expiresAt: new Date(expiresAt) }, now),
			).toBe(false);
		},
	);
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir apps/webapp exec vitest run src/lib/auth/employee-invitation-draft.test.ts`

Expected: FAIL because `employee-invitation-draft.ts` does not exist.

- [ ] **Step 3: Implement the minimal helpers with Temporal**

```ts
import type { Instant } from "@/lib/datetime/temporal-core";
import { compareInstants, instantFromDate, systemClock } from "@/lib/datetime/temporal-core";

export function normalizeInvitationEmail(email: string) {
	return email.trim().toLowerCase();
}

export function isInvitationActionable(
	invitation: { status: string; expiresAt: Date },
	now: Instant = systemClock.nowInstant(),
) {
	return (
		invitation.status === "pending" &&
		compareInstants(instantFromDate(invitation.expiresAt), now) > 0
	);
}
```

- [ ] **Step 4: Verify GREEN**

Run the Step 2 command.

Expected: PASS.

### Task 2: Add Normalized Draft Identity And Repair Migration

**Files:**

- Modify: `apps/webapp/src/db/schema/employee-invitation-draft.ts`
- Modify: `apps/webapp/src/db/schema/__tests__/employee-invitation-draft-schema.test.ts`
- Modify: `apps/webapp/src/db/__tests__/drizzle-migrations.test.ts`
- Create: `apps/webapp/drizzle/0054_employee_invitation_draft_identity.sql`
- Create: `apps/webapp/drizzle/meta/0054_snapshot.json`
- Modify: `apps/webapp/drizzle/meta/_journal.json`

- [ ] **Step 1: Write failing schema assertions**

Add assertions using `getTableConfig(employeeInvitationDraft)`:

```ts
expect(employeeInvitationDraft.normalizedEmail.name).toBe("normalized_email");
expect(
	getTableConfig(employeeInvitationDraft).indexes.some(
		(index) =>
			index.config.name ===
				"employeeInvitationDraft_organizationNormalizedEmail_unique_idx" &&
			index.config.unique,
	),
).toBe(true);
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir apps/webapp exec vitest run src/db/schema/__tests__/employee-invitation-draft-schema.test.ts`

Expected: FAIL because `normalizedEmail` and its index do not exist.

- [ ] **Step 3: Add the app-owned schema field and unique index**

```ts
normalizedEmail: text("normalized_email").notNull(),
```

```ts
uniqueIndex("employeeInvitationDraft_organizationNormalizedEmail_unique_idx").on(
	table.organizationId,
	table.normalizedEmail,
),
```

Retain `employeeInvitationDraft_invitationId_unique_idx`.

- [ ] **Step 4: Generate migration metadata**

Run: `pnpm --dir apps/webapp exec drizzle-kit generate --name employee_invitation_draft_identity`

Expected: new `0054` SQL/snapshot files and journal entry. Confirm the journal `when` is greater than `1781096400000`; adjust only the new entry if necessary.

- [ ] **Step 5: Write failing migration contract tests**

Require the migration to contain these ordered repair operations:

```ts
expect(sql).toContain('ADD COLUMN IF NOT EXISTS "normalized_email" text');
expect(sql).toContain('lower(btrim("invitation"."email"))');
expect(sql).toContain('"candidate_invitation"."status" = \'pending\'');
expect(sql).toContain('"candidate_invitation"."expires_at" > now()');
expect(sql).toContain(
	'ORDER BY "draft"."updated_at" DESC, "draft"."created_at" DESC, "draft"."id" DESC',
);
expect(sql).toContain(
	'CREATE UNIQUE INDEX IF NOT EXISTS "employeeInvitationDraft_organizationNormalizedEmail_unique_idx"',
);
```

Also assert the `0054` journal entry exists and has `when > Math.max(...priorEntries.map(e => e.when))`.

- [ ] **Step 6: Verify RED**

Run: `pnpm --dir apps/webapp exec vitest run src/db/schema/__tests__/employee-invitation-draft-schema.test.ts src/db/__tests__/drizzle-migrations.test.ts`

Expected: FAIL until the generated SQL is replaced with deterministic repair SQL.

- [ ] **Step 7: Implement deterministic, idempotent repair SQL**

Use this operation order:

```sql
ALTER TABLE "employee_invitation_draft"
	ADD COLUMN IF NOT EXISTS "normalized_email" text;

UPDATE "employee_invitation_draft" AS "draft"
SET "normalized_email" = lower(btrim("invitation"."email"))
FROM "invitation"
WHERE "invitation"."id" = "draft"."invitation_id"
	AND "invitation"."organization_id" = "draft"."organization_id";

DELETE FROM "employee_invitation_draft" AS "draft"
USING "employee", "user"
WHERE "employee"."organization_id" = "draft"."organization_id"
	AND "user"."id" = "employee"."user_id"
	AND lower(btrim("user"."email")) = "draft"."normalized_email";

DELETE FROM "employee_invitation_draft" AS "draft"
WHERE NOT EXISTS (
	SELECT 1 FROM "invitation" AS "candidate_invitation"
	WHERE "candidate_invitation"."organization_id" = "draft"."organization_id"
		AND lower(btrim("candidate_invitation"."email")) = "draft"."normalized_email"
		AND "candidate_invitation"."status" = 'pending'
		AND "candidate_invitation"."expires_at" > now()
);

CREATE TEMP TABLE "employee_invitation_draft_repair" ON COMMIT DROP AS
WITH "ranked_drafts" AS (
	SELECT "draft"."id", "draft"."organization_id", "draft"."normalized_email",
		row_number() OVER (
			PARTITION BY "draft"."organization_id", "draft"."normalized_email"
			ORDER BY "draft"."updated_at" DESC, "draft"."created_at" DESC, "draft"."id" DESC
		) AS "draft_rank"
	FROM "employee_invitation_draft" AS "draft"
), "ranked_invitations" AS (
	SELECT "candidate_invitation"."id", "candidate_invitation"."organization_id",
		lower(btrim("candidate_invitation"."email")) AS "normalized_email",
		row_number() OVER (
			PARTITION BY "candidate_invitation"."organization_id", lower(btrim("candidate_invitation"."email"))
			ORDER BY "candidate_invitation"."created_at" DESC, "candidate_invitation"."id" DESC
		) AS "invitation_rank"
	FROM "invitation" AS "candidate_invitation"
	WHERE "candidate_invitation"."status" = 'pending'
		AND "candidate_invitation"."expires_at" > now()
)
SELECT "ranked_drafts"."id" AS "draft_id", "ranked_invitations"."id" AS "invitation_id"
FROM "ranked_drafts"
INNER JOIN "ranked_invitations"
	ON "ranked_invitations"."organization_id" = "ranked_drafts"."organization_id"
	AND "ranked_invitations"."normalized_email" = "ranked_drafts"."normalized_email"
	AND "ranked_invitations"."invitation_rank" = 1
WHERE "ranked_drafts"."draft_rank" = 1;

DELETE FROM "employee_invitation_draft" AS "draft"
WHERE NOT EXISTS (
	SELECT 1 FROM "employee_invitation_draft_repair" AS "repair"
	WHERE "repair"."draft_id" = "draft"."id"
);

UPDATE "employee_invitation_draft" AS "draft"
SET "invitation_id" = "repair"."invitation_id"
FROM "employee_invitation_draft_repair" AS "repair"
WHERE "draft"."id" = "repair"."draft_id";

ALTER TABLE "employee_invitation_draft"
	ALTER COLUMN "normalized_email" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS
	"employeeInvitationDraft_organizationNormalizedEmail_unique_idx"
ON "employee_invitation_draft" USING btree ("organization_id", "normalized_email");
```

Preserve the generated snapshot and existing migration-only composite foreign keys.

- [ ] **Step 8: Verify GREEN**

Run the Step 6 command.

Expected: PASS and `git diff --check` reports no whitespace errors.

### Task 3: Implement Stable Draft Attachment

**Files:**

- Modify: `apps/webapp/src/lib/auth/employee-invitation-draft.ts`
- Modify: `apps/webapp/src/lib/auth/employee-invitation-draft.test.ts`

- [ ] **Step 1: Write a failing conflict-behavior test**

Assert the upsert targets organization/email and updates only the current invitation:

```ts
expect(onConflictDoUpdate).toHaveBeenCalledWith({
	target: [
		employeeInvitationDraft.organizationId,
		employeeInvitationDraft.normalizedEmail,
	],
	set: { invitationId: "invitation-2" },
});
expect(onConflictDoUpdate.mock.calls[0]?.[0].set).not.toHaveProperty("teamId");
expect(onConflictDoUpdate.mock.calls[0]?.[0].set).not.toHaveProperty("role");
```

- [ ] **Step 2: Verify RED**

Run Task 1's test command.

Expected: FAIL because `attachInvitationToEmployeeDraft` is missing.

- [ ] **Step 3: Implement the stable attachment API**

```ts
export async function attachInvitationToEmployeeDraft(
	dbClient: typeof appDb,
	input: {
		organizationId: string;
		normalizedEmail: string;
		invitationId: string;
		initialTeamId: string | null;
		initialRole: "admin" | "employee";
		updatedBy: string;
	},
) {
	const [draft] = await dbClient
		.insert(employeeInvitationDraft)
		.values({
			organizationId: input.organizationId,
			normalizedEmail: input.normalizedEmail,
			invitationId: input.invitationId,
			teamId: input.initialTeamId,
			role: input.initialRole,
			contractType: "fixed",
			updatedBy: input.updatedBy,
		})
		.onConflictDoUpdate({
			target: [
				employeeInvitationDraft.organizationId,
				employeeInvitationDraft.normalizedEmail,
			],
			set: { invitationId: input.invitationId },
		})
		.returning();

	return draft;
}
```

- [ ] **Step 4: Verify GREEN**

Run Task 1's test command.

Expected: PASS.

### Task 4: Correct Invitation Creation And Add Server-Owned Resend

**Files:**

- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.test.ts`

- [ ] **Step 1: Write failing invitation creation tests**

Add cases proving:

```ts
expect(createInvitation).toHaveBeenCalledWith({
	body: expect.objectContaining({ email: "ada@example.com", resend: false }),
	headers: expect.any(Headers),
});
expect(attachInvitationToEmployeeDraft).toHaveBeenCalledWith(
	expect.anything(),
	expect.objectContaining({
		organizationId: "org-1",
		normalizedEmail: "ada@example.com",
		invitationId: "invitation-current",
	}),
);
```

Also prove actor membership requires `status: "approved"`, expired `pending` invitations do not block creation, and the returned Better Auth invitation ID is authoritative.

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir apps/webapp exec vitest run "src/app/[locale]/(app)/settings/organizations/actions.test.ts"`

Expected: FAIL on normalization, approved status, expiry, or stable attachment.

- [ ] **Step 3: Implement corrected creation flow**

Normalize once, require approved membership, search only `status = pending AND expiresAt > dateFromInstant(systemClock.nowInstant())`, call Better Auth with `resend: false`, update custom invitation fields with both invitation and organization IDs, then call `attachInvitationToEmployeeDraft`. Remove the invitation-ID conflict upsert local to `sendInvitation`.

- [ ] **Step 4: Verify creation tests pass**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Write failing resend tests**

Add tests for this API:

```ts
export async function resendInvitation(
	organizationId: string,
	invitationId: string,
): Promise<ServerActionResult<void>>;
```

Required assertions:

```ts
expect(createInvitation).toHaveBeenCalledWith({
	body: {
		organizationId: "org-1",
		email: "invitee@example.com",
		role: "member",
		resend: true,
	},
	headers: expect.any(Headers),
});
expect(cancelInvitation).not.toHaveBeenCalled();
expect(attachInvitationToEmployeeDraft).toHaveBeenCalledWith(
	expect.anything(),
	expect.objectContaining({ invitationId: "replacement-invitation" }),
);
```

Cover cross-organization rejection, approved admin/owner authorization, and preservation of `targetTeamId` and `canCreateOrganizations` on a replacement invitation.

- [ ] **Step 6: Verify RED**

Run the Step 2 command.

Expected: FAIL because `resendInvitation` is missing.

- [ ] **Step 7: Implement resend as one server action**

Load the original invitation with `id + organizationId`, authorize an approved admin/owner, call Better Auth `createInvitation({ resend: true })`, copy app-owned invitation fields to the returned organization-scoped invitation, and attach the existing normalized draft. Do not call cancellation.

- [ ] **Step 8: Verify GREEN**

Run the Step 2 command.

Expected: PASS.

### Task 5: Replace Client Cancel-Then-Create And Fix Cache/Rollback

**Files:**

- Modify: `apps/webapp/src/components/organization/members-table.tsx`
- Modify: `apps/webapp/src/components/organization/members-table.test.tsx`
- Modify: `apps/webapp/src/components/organization/invite-member-dialog.tsx`
- Modify: `apps/webapp/src/components/organization/invite-member-dialog.test.tsx`

- [ ] **Step 1: Write failing resend interaction tests**

```ts
expect(resendInvitation).toHaveBeenCalledWith("org-1", "invitation-1");
expect(cancelInvitation).not.toHaveBeenCalled();
expect(sendInvitation).not.toHaveBeenCalled();
```

Add a resolved `{ success: false }` cancellation test proving the optimistically removed invitation is restored.

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir apps/webapp exec vitest run src/components/organization/members-table.test.tsx`

Expected: FAIL because resend still cancels then sends and semantic failures do not roll back.

- [ ] **Step 3: Use the server resend action and restore semantic failures**

```ts
mutationFn: (invitation: InvitationWithInviter) =>
	resendInvitation(organizationId, invitation.id),
```

On successful resend invalidate `queryKeys.invitations.list(organizationId)` and `queryKeys.employees.all`. In cancellation `onSuccess`, restore `context.previousInvitations` before showing an error when `result.success` is false.

- [ ] **Step 4: Verify GREEN**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Write and pass invite-form invalidation tests**

Require successful invitation creation to invalidate both invitation list and `queryKeys.employees.all`; failed creation invalidates neither. Implement with `Promise.all` and retain the existing `router.refresh()`.

Run: `pnpm --dir apps/webapp exec vitest run src/components/organization/invite-member-dialog.test.tsx`

Expected: PASS after implementation.

### Task 6: Enforce One Eligibility Predicate In List, Detail, And Edit

**Files:**

- Create: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-invitation-draft-eligibility.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-invitation-draft-eligibility.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts`

- [ ] **Step 1: Write failing predicate tests**

The generated condition must include:

```ts
and(
	eq(employeeInvitationDraft.organizationId, organizationId),
	eq(invitation.organizationId, organizationId),
	eq(invitation.status, "pending"),
	gt(invitation.expiresAt, now),
	sql<boolean>`not exists (
		select 1 from ${employee}
		inner join ${user} on ${user.id} = ${employee.userId}
		where ${employee.organizationId} = ${organizationId}
		and lower(btrim(${user.email})) = ${employeeInvitationDraft.normalizedEmail}
	)`,
);
```

Also test optional draft-ID scoping.

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir apps/webapp exec vitest run "src/app/[locale]/(app)/settings/employees/employee-invitation-draft-eligibility.test.ts"`

Expected: FAIL because the helper is missing.

- [ ] **Step 3: Implement `buildEligibleInvitationDraftPredicate`**

Accept `{ organizationId, now, draftId? }`, include every condition above, and return one Drizzle predicate reused by all consumers.

- [ ] **Step 4: Add failing list/detail/edit behavior tests**

Cover pending/future visibility and exclusion of accepted, canceled, rejected, expired, same-org employee identities, cross-org drafts, and manager access. Editing each excluded state must return the existing user-safe validation/not-found result and perform no update.

- [ ] **Step 5: Verify RED**

Run:

```bash
pnpm --dir apps/webapp exec vitest run \
  "src/app/[locale]/(app)/settings/employees/employee-queries.actions.test.ts" \
  "src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts"
```

Expected: FAIL because stale drafts are still returned/editable.

- [ ] **Step 6: Apply the shared predicate everywhere**

Use one `Date` database boundary from `dateFromInstant(systemClock.nowInstant())`. Remove invitation-ID-based `realEmployeeUser.invitedVia` joins from draft eligibility. Keep final mutation predicates scoped by draft ID and organization ID.

- [ ] **Step 7: Verify GREEN**

Run Steps 2 and 5 commands.

Expected: PASS.

### Task 7: Separate Explicit Acceptance From Routine Reconciliation

**Files:**

- Modify: `apps/webapp/src/lib/auth/organization-member-provisioning.ts`
- Modify: `apps/webapp/src/lib/auth/organization-member-provisioning.test.ts`
- Modify: `apps/webapp/src/lib/auth.ts`
- Modify: `apps/webapp/src/lib/auth.test.ts`

- [ ] **Step 1: Write failing provisioning-mode tests**

Require:

```ts
type EmployeeProvisioningMode = "reconcile" | "membershipAccepted";
```

Test that `reconcile` returns an inactive employee unchanged and never calls update, while `membershipAccepted` reactivates the existing employee regardless of team assignment and applies the accepted draft.

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir apps/webapp exec vitest run src/lib/auth/organization-member-provisioning.test.ts`

Expected: FAIL because routine provisioning currently reactivates some employees.

- [ ] **Step 3: Require explicit provisioning mode**

Add `mode` to `ensureEmployeeForOrganizationMember`. Existing employees update only when `mode === "membershipAccepted"`; reconciliation returns them unchanged. Update acceptance/direct-add hooks to `membershipAccepted` and directory/switch/team reconciliation callers to `reconcile`.

- [ ] **Step 4: Verify GREEN**

Run the Step 2 command plus `pnpm --dir apps/webapp exec vitest run src/lib/auth.test.ts`.

Expected: PASS.

### Task 8: Consume Drafts After Successful Acceptance

**Files:**

- Modify: `apps/webapp/src/lib/auth/organization-member-provisioning.ts`
- Modify: `apps/webapp/src/lib/auth/organization-member-provisioning.test.ts`

- [ ] **Step 1: Write failing cleanup and retry tests**

Cover new employee creation, explicit reactivation, and retry with an already-active employee. Each `membershipAccepted` case deletes by both draft ID and organization ID; `reconcile` never deletes drafts.

- [ ] **Step 2: Verify RED**

Run Task 7's provisioning test command.

Expected: FAIL because accepted drafts remain.

- [ ] **Step 3: Restructure provisioning around one result and consume afterward**

```ts
let provisionedEmployee: typeof employee.$inferSelect | undefined;
// create, explicitly reactivate, or reuse existing employee

if (draft && input.mode === "membershipAccepted") {
	await dbClient.delete(employeeInvitationDraft).where(
		and(
			eq(employeeInvitationDraft.id, draft.id),
			eq(employeeInvitationDraft.organizationId, input.organizationId),
		),
	);
}

return provisionedEmployee;
```

Do not return early before cleanup. A retry must return the same employee and retry deletion.

- [ ] **Step 4: Verify GREEN**

Run Task 7's command.

Expected: PASS.

### Task 9: Add Organization-Scoped Draft Deletion

**Files:**

- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/actions.ts`

- [ ] **Step 1: Write failing deletion tests**

Specify:

```ts
export async function deleteEmployeeInvitationDraftAction(
	draftEmployeeId: string,
): Promise<ServerActionResult<void>>;
```

Test org-admin permission, cross-org rejection, normalized existing-employee protection, cancellation-before-delete for actionable invitations, no delete when cancellation fails, direct delete for stale invitations, final `draftId + organizationId` predicate, and employee cache revalidation.

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir apps/webapp exec vitest run "src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts"`

Expected: FAIL because deletion is missing.

- [ ] **Step 3: Implement cancellation-first deletion**

Load draft and invitation with organization-scoped joins. Check no same-organization employee matches `normalizedEmail`. If `isInvitationActionable`, call Better Auth cancellation and only then delete. Return `The pending invitation could not be canceled. The employee draft was kept.` for cancellation failures without exposing internals.

- [ ] **Step 4: Export the client wrapper**

```ts
export async function deleteEmployeeInvitationDraft(draftEmployeeId: string) {
	return deleteEmployeeInvitationDraftAction(draftEmployeeId);
}
```

- [ ] **Step 5: Verify GREEN**

Run the Step 2 command.

Expected: PASS.

### Task 10: Add Draft Resend/Delete Controls

**Files:**

- Create: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-draft-actions.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-draft-actions.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx`

- [ ] **Step 1: Write failing interaction tests**

Test resend calls `resendInvitation(organizationId, invitationId)`, delete opens a confirmation, confirmed delete calls `deleteEmployeeInvitationDraft(encodedDraftId)`, semantic/thrown failures retain the page, success invalidates invitation/employees/detail caches, and successful delete navigates to `/settings/employees`.

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir apps/webapp exec vitest run "src/app/[locale]/(app)/settings/employees/[employeeId]/employee-draft-actions.test.tsx"`

Expected: FAIL because the component is missing.

- [ ] **Step 3: Implement focused controls**

Use `IconMailForward`, `IconTrash`, and `IconLoader2`. Confirmation text:

```text
Delete employee draft?

This permanently deletes the prepared employee data and cancels the pending invitation. No employee history will be deleted.
```

Convert `{ success: false }` into a thrown mutation error so one rollback/error path handles both semantic and network failures.

- [ ] **Step 4: Render controls only for eligible draft details**

The detail query already rejects stale drafts after Task 6, so render the component only when `employee.kind === "invitationDraft"`.

- [ ] **Step 5: Verify GREEN**

Run the Step 2 command and the existing `page-sections.test.tsx`.

Expected: PASS.

### Task 11: Verify The Workstream

**Files:** all files changed above.

- [ ] **Step 1: Run focused tests**

```bash
pnpm --dir apps/webapp exec vitest run \
  src/lib/auth/employee-invitation-draft.test.ts \
  src/db/schema/__tests__/employee-invitation-draft-schema.test.ts \
  src/db/__tests__/drizzle-migrations.test.ts \
  "src/app/[locale]/(app)/settings/organizations/actions.test.ts" \
  "src/app/[locale]/(app)/settings/employees/employee-invitation-draft-eligibility.test.ts" \
  "src/app/[locale]/(app)/settings/employees/employee-queries.actions.test.ts" \
  "src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts" \
  src/lib/auth/organization-member-provisioning.test.ts \
  src/lib/auth.test.ts \
  src/components/organization/members-table.test.tsx \
  src/components/organization/invite-member-dialog.test.tsx \
  "src/app/[locale]/(app)/settings/employees/[employeeId]/employee-draft-actions.test.tsx" \
  "src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx"
```

Expected: all tests PASS with no warnings.

- [ ] **Step 2: Run type checking**

Run: `pnpm --dir apps/webapp typecheck`

Expected: exit 0.

- [ ] **Step 3: Run the full webapp suite**

Run: `pnpm --dir apps/webapp test`

Expected: exit 0.

- [ ] **Step 4: Run production build**

Run: `CI=true pnpm --dir apps/webapp build`

Expected: exit 0.

- [ ] **Step 5: Verify the migration against a real PostgreSQL fixture when credentials are available**

Create three same-org drafts for case-varied email, multiple expired/canceled invitations, one newest actionable invitation, and one existing employee case. Apply `0054` and verify one canonical pending draft remains only for the future employee. If Phase-managed database credentials are unavailable, report this check as skipped rather than inventing a substitute.

No commit step is included because repository policy requires an explicit user request before committing.
