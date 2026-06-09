# Invited Employee Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let org admins and owners see invited users as draft employee rows in `/settings/employees`, edit their employee details before registration, and apply those details when the invitation is accepted.

**Architecture:** Add an app-owned `employee_invitation_draft` table keyed to Better Auth invitations. Server actions expose discriminated real employee and invitation draft records while preserving the Better Auth invitation acceptance path. The existing employee list/detail UI is adapted to render draft rows and hide real-employee-only sections.

**Tech Stack:** Next.js App Router, Server Actions, Better Auth organization plugin, Drizzle/Postgres, Effect, TanStack Query, TanStack Form, Vitest, Testing Library.

---

## File Map

- Create: `apps/webapp/src/db/schema/employee-invitation-draft.ts` for the draft table.
- Modify: `apps/webapp/src/db/schema/index.ts` to export the table.
- Modify: `apps/webapp/src/db/schema/relations.ts` to relate drafts to organization, invitation, team, and updater user.
- Create: `apps/webapp/drizzle/0050_employee_invitation_draft.sql` for the migration.
- Modify: `apps/webapp/drizzle/meta/_journal.json` to register migration `0050_employee_invitation_draft` with `when` greater than `1780773132900`.
- Create: `apps/webapp/src/db/schema/__tests__/employee-invitation-draft-schema.test.ts` for schema and migration guards.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts` to create draft rows after invitation creation.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.test.ts` to assert draft creation.
- Modify: `apps/webapp/src/lib/auth/organization-member-provisioning.ts` to apply draft values during employee creation/reactivation.
- Create: `apps/webapp/src/lib/auth/organization-member-provisioning.test.ts` for provisioning behavior.
- Modify: `apps/webapp/src/lib/auth.ts` to pass `invitation.id` to provisioning.
- Modify: `apps/webapp/src/lib/auth.test.ts` to guard hook wiring.
- Modify: `apps/webapp/src/lib/validations/employee.ts` to add `updateEmployeeInvitationDraftSchema` reusing employee update validation fields.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-types.ts` to add discriminated list/detail types and draft status filter support.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.ts` to list and read drafts for `orgAdmin` only.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts` to update draft records safely.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/actions.ts` to export the widened detail and draft update actions.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.test.ts` and `employee-mutations.actions.test.ts` for server behavior.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/columns.tsx` and `columns.test.tsx` to render draft rows and draft status.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.tsx` and `apps/webapp/src/lib/query/use-employees.ts` to include a Draft status filter.
- Modify: `apps/webapp/src/lib/query/use-employee.ts` to skip real-employee-only queries for drafts and call the draft update action.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page.tsx`, `employee-detail-page-client.tsx`, `page-sections.tsx`, and `page-utils.ts` to render and sync draft details.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx` and `page-utils.test.ts` for detail behavior.

## Shared Type Conventions

Use these identifiers throughout the implementation:

```ts
export const EMPLOYEE_DRAFT_ID_PREFIX = "draft:";

export type EmployeeRecordKind = "employee" | "invitationDraft";

export type InvitationDraftStatus = "draft";

export type EmployeeDirectoryStatus = "active" | "inactive" | "draft" | "all";

export function encodeEmployeeInvitationDraftId(draftId: string) {
	return `${EMPLOYEE_DRAFT_ID_PREFIX}${draftId}`;
}

export function decodeEmployeeInvitationDraftId(id: string) {
	return id.startsWith(EMPLOYEE_DRAFT_ID_PREFIX) ? id.slice(EMPLOYEE_DRAFT_ID_PREFIX.length) : null;
}
```

---

### Task 1: Schema And Migration

**Files:**
- Create: `apps/webapp/src/db/schema/employee-invitation-draft.ts`
- Modify: `apps/webapp/src/db/schema/index.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Create: `apps/webapp/drizzle/0050_employee_invitation_draft.sql`
- Modify: `apps/webapp/drizzle/meta/_journal.json`
- Create: `apps/webapp/src/db/schema/__tests__/employee-invitation-draft-schema.test.ts`

- [ ] **Step 1: Write the failing schema and migration test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { employeeInvitationDraft } from "../employee-invitation-draft";

describe("employee invitation draft schema", () => {
	it("defines organization-scoped invitation draft fields", () => {
		expect(employeeInvitationDraft.invitationId.name).toBe("invitation_id");
		expect(employeeInvitationDraft.organizationId.name).toBe("organization_id");
		expect(employeeInvitationDraft.teamId.name).toBe("team_id");
		expect(employeeInvitationDraft.role.name).toBe("role");
		expect(employeeInvitationDraft.contractType.name).toBe("contract_type");
		expect(employeeInvitationDraft.currentHourlyRate.name).toBe("current_hourly_rate");
	});

	it("registers the migration after the latest journal entry", () => {
		const migration = readFileSync("drizzle/0050_employee_invitation_draft.sql", "utf8");
		const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
		expect(migration).toContain('CREATE TABLE IF NOT EXISTS "employee_invitation_draft"');
		expect(migration).toContain('"invitation_id" text NOT NULL');
		expect(migration).toContain('"organization_id" text NOT NULL');
		expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "employeeInvitationDraft_invitationId_unique_idx"');
		expect(journal.entries.at(-1)).toMatchObject({
			idx: 50,
			tag: "0050_employee_invitation_draft",
		});
		expect(journal.entries.at(-1).when).toBeGreaterThan(1780773132900);
	});
});
```

- [ ] **Step 2: Run the schema test to verify it fails**

Run: `pnpm --dir apps/webapp test src/db/schema/__tests__/employee-invitation-draft-schema.test.ts`

Expected: FAIL because `../employee-invitation-draft` and `drizzle/0050_employee_invitation_draft.sql` do not exist.

- [ ] **Step 3: Add the schema file**

Create `apps/webapp/src/db/schema/employee-invitation-draft.ts`:

```ts
import { decimal, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { invitation, organization, user } from "../auth-schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { contractTypeEnum, genderEnum, roleEnum } from "./enums";
import { team } from "./organization";

export const employeeInvitationDraft = pgTable(
	"employee_invitation_draft",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		invitationId: text("invitation_id")
			.notNull()
			.references(() => invitation.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		teamId: uuid("team_id").references(() => team.id, { onDelete: "set null" }),
		role: roleEnum("role").default("employee").notNull(),
		firstName: text("first_name"),
		lastName: text("last_name"),
		position: text("position"),
		employeeNumber: text("employee_number"),
		gender: genderEnum("gender"),
		pronouns: text("pronouns"),
		birthday: timestamp("birthday", { mode: "date" }),
		startDate: timestamp("start_date"),
		endDate: timestamp("end_date"),
		contractType: contractTypeEnum("contract_type").default("fixed").notNull(),
		currentHourlyRate: decimal("current_hourly_rate", { precision: 10, scale: 2 }),
		updatedBy: text("updated_by").references(() => user.id),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").$onUpdate(() => currentTimestamp()).notNull(),
	},
	(table) => [
		uniqueIndex("employeeInvitationDraft_invitationId_unique_idx").on(table.invitationId),
		index("employeeInvitationDraft_organizationId_idx").on(table.organizationId),
		index("employeeInvitationDraft_teamId_idx").on(table.teamId),
	],
);
```

- [ ] **Step 4: Export the schema and add relations**

In `apps/webapp/src/db/schema/index.ts`, add:

```ts
export * from "./employee-invitation-draft";
```

In `apps/webapp/src/db/schema/relations.ts`, import the table:

```ts
import { employeeInvitationDraft } from "./employee-invitation-draft";
```

Add `employeeInvitationDrafts: many(employeeInvitationDraft),` to `organizationRelations`.

Add this relation block near employee relations:

```ts
export const employeeInvitationDraftRelations = relations(employeeInvitationDraft, ({ one }) => ({
	organization: one(organization, {
		fields: [employeeInvitationDraft.organizationId],
		references: [organization.id],
	}),
	invitation: one(invitation, {
		fields: [employeeInvitationDraft.invitationId],
		references: [invitation.id],
	}),
	team: one(team, {
		fields: [employeeInvitationDraft.teamId],
		references: [team.id],
	}),
	updater: one(user, {
		fields: [employeeInvitationDraft.updatedBy],
		references: [user.id],
	}),
}));
```

- [ ] **Step 5: Add migration and journal entry**

Create `apps/webapp/drizzle/0050_employee_invitation_draft.sql`:

```sql
CREATE TABLE IF NOT EXISTS "employee_invitation_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"team_id" uuid,
	"role" "role" DEFAULT 'employee' NOT NULL,
	"first_name" text,
	"last_name" text,
	"position" text,
	"employee_number" text,
	"gender" "gender",
	"pronouns" text,
	"birthday" timestamp,
	"start_date" timestamp,
	"end_date" timestamp,
	"contract_type" "contract_type" DEFAULT 'fixed' NOT NULL,
	"current_hourly_rate" numeric(10, 2),
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
	ALTER TABLE "employee_invitation_draft" ADD CONSTRAINT "employee_invitation_draft_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "employee_invitation_draft" ADD CONSTRAINT "employee_invitation_draft_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "employee_invitation_draft" ADD CONSTRAINT "employee_invitation_draft_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "employee_invitation_draft" ADD CONSTRAINT "employee_invitation_draft_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "employeeInvitationDraft_invitationId_unique_idx" ON "employee_invitation_draft" USING btree ("invitation_id");
CREATE INDEX IF NOT EXISTS "employeeInvitationDraft_organizationId_idx" ON "employee_invitation_draft" USING btree ("organization_id");
CREATE INDEX IF NOT EXISTS "employeeInvitationDraft_teamId_idx" ON "employee_invitation_draft" USING btree ("team_id");
```

Append this object as the last entry in `apps/webapp/drizzle/meta/_journal.json`:

```json
{
  "idx": 50,
  "version": "7",
  "when": 1780773132901,
  "tag": "0050_employee_invitation_draft",
  "breakpoints": true
}
```

- [ ] **Step 6: Run the schema test to verify it passes**

Run: `pnpm --dir apps/webapp test src/db/schema/__tests__/employee-invitation-draft-schema.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit schema work**

```bash
git add apps/webapp/src/db/schema/employee-invitation-draft.ts apps/webapp/src/db/schema/index.ts apps/webapp/src/db/schema/relations.ts apps/webapp/drizzle/0050_employee_invitation_draft.sql apps/webapp/drizzle/meta/_journal.json apps/webapp/src/db/schema/__tests__/employee-invitation-draft-schema.test.ts
git commit -m "feat: add employee invitation draft schema"
```

---

### Task 2: Create Drafts When Invitations Are Sent

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.test.ts`

- [ ] **Step 1: Write the failing invitation draft creation test**

Add this test to `describe("organization invitation actions")` in `actions.test.ts`:

```ts
it("creates an employee invitation draft after creating an invitation", async () => {
	invitationFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
		id: "invite-created",
		organizationId: "org-1",
		status: "pending",
	});

	const result = await sendInvitation({
		organizationId: "org-1",
		email: "invitee@example.com",
		role: "admin",
		targetTeamId: "11111111-1111-4111-8111-111111111111",
	});

	expect(result).toMatchObject({ success: true });
	expect(insertValuesMock).toHaveBeenCalledWith({
		invitationId: "invite-created",
		organizationId: "org-1",
		teamId: "11111111-1111-4111-8111-111111111111",
		role: "admin",
		contractType: "fixed",
		updatedBy: "user-admin",
	});
	expect(onConflictDoUpdateMock).toHaveBeenCalledWith(
		expect.objectContaining({
			target: expect.anything(),
			set: expect.objectContaining({
				teamId: "11111111-1111-4111-8111-111111111111",
				role: "admin",
				updatedBy: "user-admin",
			}),
		}),
	);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/settings/organizations/actions.test.ts'`

Expected: FAIL because no insert into `employeeInvitationDraft` occurs.

- [ ] **Step 3: Implement draft creation**

Modify the import in `actions.ts`:

```ts
import { employee, employeeInvitationDraft, organizationNotificationSettings, team } from "@/db/schema";
```

Inside the existing `if (newInvitation) { ... }` block after updating `authSchema.invitation`, add:

```ts
const draftRole = validatedData!.role === "admin" || validatedData!.role === "owner" ? "admin" : "employee";

await db
	.insert(employeeInvitationDraft)
	.values({
		invitationId: newInvitation.id,
		organizationId: data.organizationId,
		teamId: validatedData!.targetTeamId ?? null,
		role: draftRole,
		contractType: "fixed",
		updatedBy: session.user.id,
	})
	.onConflictDoUpdate({
		target: employeeInvitationDraft.invitationId,
		set: {
			teamId: validatedData!.targetTeamId ?? null,
			role: draftRole,
			updatedBy: session.user.id,
		},
	});
```

- [ ] **Step 4: Run the invitation action tests**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/settings/organizations/actions.test.ts'`

Expected: PASS.

- [ ] **Step 5: Commit invitation draft creation**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts' 'apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.test.ts'
git commit -m "feat: create employee drafts for invitations"
```

---

### Task 3: Apply Drafts During Invitation Acceptance

**Files:**
- Modify: `apps/webapp/src/lib/auth/organization-member-provisioning.ts`
- Create: `apps/webapp/src/lib/auth/organization-member-provisioning.test.ts`
- Modify: `apps/webapp/src/lib/auth.ts`
- Modify: `apps/webapp/src/lib/auth.test.ts`

- [ ] **Step 1: Write failing provisioning tests**

Create `apps/webapp/src/lib/auth/organization-member-provisioning.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ensureEmployeeForOrganizationMember } from "./organization-member-provisioning";

function createDbMock({ existingEmployee = null, draft = null, validTeam = true } = {}) {
	const returning = vi.fn().mockResolvedValue([{ id: "employee-created", organizationId: "org-1" }]);
	const values = vi.fn(() => ({ returning }));
	const insert = vi.fn(() => ({ values }));
	const updateReturning = vi.fn().mockResolvedValue([{ id: "employee-existing", organizationId: "org-1" }]);
	const updateWhere = vi.fn(() => ({ returning: updateReturning }));
	const set = vi.fn(() => ({ where: updateWhere }));
	const update = vi.fn(() => ({ set }));

	return {
		insert,
		update,
		values,
		set,
		query: {
			employee: { findFirst: vi.fn().mockResolvedValue(existingEmployee) },
			employeeInvitationDraft: { findFirst: vi.fn().mockResolvedValue(draft) },
			team: { findFirst: vi.fn().mockResolvedValue(validTeam ? { id: "team-1" } : null) },
			teamPermissions: { findFirst: vi.fn().mockResolvedValue(null) },
		},
	};
}

describe("ensureEmployeeForOrganizationMember invitation drafts", () => {
	it("applies invitation draft fields when creating an employee", async () => {
		const db = createDbMock({
			draft: {
				invitationId: "invite-1",
				organizationId: "org-1",
				teamId: "team-1",
				role: "manager",
				firstName: "Ada",
				lastName: "Lovelace",
				position: "Lead",
				employeeNumber: "E-100",
				contractType: "hourly",
				currentHourlyRate: "42.50",
			},
		});

		await ensureEmployeeForOrganizationMember(db as any, {
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			invitationId: "invite-1",
		});

		expect(db.values).toHaveBeenCalledWith(expect.objectContaining({
			userId: "user-1",
			organizationId: "org-1",
			teamId: "team-1",
			role: "manager",
			firstName: "Ada",
			lastName: "Lovelace",
			position: "Lead",
			employeeNumber: "E-100",
			contractType: "hourly",
			currentHourlyRate: "42.50",
		}));
	});

	it("ignores a draft team that no longer belongs to the organization", async () => {
		const db = createDbMock({
			draft: { invitationId: "invite-1", organizationId: "org-1", teamId: "deleted-team", role: "employee", contractType: "fixed" },
			validTeam: false,
		});

		await ensureEmployeeForOrganizationMember(db as any, {
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			invitationId: "invite-1",
		});

		expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ teamId: null }));
	});

	it("keeps current behavior when no draft exists", async () => {
		const db = createDbMock();

		await ensureEmployeeForOrganizationMember(db as any, {
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "admin",
		});

		expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ role: "admin", teamId: null }));
	});
});
```

Add to `apps/webapp/src/lib/auth.test.ts`:

```ts
it("passes invitation id into employee provisioning", () => {
	const source = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");
	const acceptInvitationHook = source.slice(
		source.indexOf("afterAcceptInvitation"),
		source.indexOf("// Create employee record when user is added to organization"),
	);
	expect(acceptInvitationHook).toContain("invitationId: invitation.id");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/lib/auth/organization-member-provisioning.test.ts src/lib/auth.test.ts`

Expected: FAIL because provisioning has no `invitationId` input and `auth.ts` does not pass it.

- [ ] **Step 3: Implement draft application**

In `organization-member-provisioning.ts`, import tables:

```ts
import { employee, employeeInvitationDraft, team, teamPermissions } from "@/db/schema";
```

Extend input type:

```ts
invitationId?: string | null;
```

Add helper functions above `ensureEmployeeForOrganizationMember`:

```ts
async function loadInvitationDraft(dbClient: EmployeeProvisioningDb, input: { organizationId: string; invitationId?: string | null }) {
	if (!input.invitationId) return null;
	return await dbClient.query.employeeInvitationDraft.findFirst({
		where: and(
			eq(employeeInvitationDraft.organizationId, input.organizationId),
			eq(employeeInvitationDraft.invitationId, input.invitationId),
		),
	});
}

async function resolveDraftTeamId(dbClient: EmployeeProvisioningDb, organizationId: string, teamId?: string | null) {
	if (!teamId) return null;
	const targetTeam = await dbClient.query.team.findFirst({
		where: and(eq(team.id, teamId), eq(team.organizationId, organizationId)),
		columns: { id: true },
	});
	return targetTeam?.id ?? null;
}

function draftEmployeeValues(draft: typeof employeeInvitationDraft.$inferSelect | null, teamId: string | null) {
	if (!draft) return { teamId };
	return {
		teamId,
		role: draft.role,
		firstName: draft.firstName,
		lastName: draft.lastName,
		gender: draft.gender,
		pronouns: draft.pronouns,
		birthday: draft.birthday,
		position: draft.position,
		employeeNumber: draft.employeeNumber,
		startDate: draft.startDate,
		endDate: draft.endDate,
		contractType: draft.contractType,
		currentHourlyRate: draft.currentHourlyRate,
	};
}
```

Inside `ensureEmployeeForOrganizationMember`, load the draft before checking `existingEmployee`:

```ts
const draft = await loadInvitationDraft(dbClient, input);
const targetTeamId = draft
	? await resolveDraftTeamId(dbClient, input.organizationId, draft.teamId)
	: (input.targetTeamId ?? null);
const preparedValues = draftEmployeeValues(draft, targetTeamId);
```

Use `preparedValues` in both update and insert. Preserve admin promotion when there is no draft:

```ts
role: draft?.role ?? (isAdminRole ? "admin" : "employee"),
```

- [ ] **Step 4: Pass invitation id from Better Auth hook**

In `apps/webapp/src/lib/auth.ts`, change the `afterAcceptInvitation` provisioning call to:

```ts
await ensureEmployeeForOrganizationMember(db, {
	userId: user.id,
	organizationId: invitation.organizationId,
	memberRole: member.role,
	targetTeamId,
	invitationId: invitation.id,
});
```

- [ ] **Step 5: Run provisioning tests**

Run: `pnpm --dir apps/webapp test src/lib/auth/organization-member-provisioning.test.ts src/lib/auth.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit provisioning work**

```bash
git add apps/webapp/src/lib/auth/organization-member-provisioning.ts apps/webapp/src/lib/auth/organization-member-provisioning.test.ts apps/webapp/src/lib/auth.ts apps/webapp/src/lib/auth.test.ts
git commit -m "feat: apply invitation drafts on acceptance"
```

---

### Task 4: Server Actions For Draft List, Detail, And Update

**Files:**
- Modify: `apps/webapp/src/lib/validations/employee.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-types.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts`

- [ ] **Step 1: Write failing source-structure query tests**

Add to `employee-queries.actions.test.ts`:

```ts
it("includes invitation draft rows for org admins", () => {
	expect(source).toContain("employeeInvitationDraft");
	expect(source).toContain('kind: "invitationDraft"');
	expect(source).toContain("actor.accessTier === \"orgAdmin\"");
	expect(source).toContain("decodeEmployeeInvitationDraftId(employeeId)");
});

it("searches invitation drafts by prepared names, email, and position", () => {
	expect(source).toContain("ilike(employeeInvitationDraft.firstName, pattern)");
	expect(source).toContain("ilike(employeeInvitationDraft.lastName, pattern)");
	expect(source).toContain("ilike(invitation.email, pattern)");
	expect(source).toContain("ilike(employeeInvitationDraft.position, pattern)");
});
```

Add to `employee-mutations.actions.test.ts`:

```ts
it("exposes a draft update action guarded by org admin access", () => {
	const source = readFileSync(new URL("./employee-mutations.actions.ts", import.meta.url), "utf8");
	expect(source).toContain("updateEmployeeInvitationDraftAction");
	expect(source).toContain("requireOrgAdminEmployeeSettingsAccess(actor");
	expect(source).toContain("employeeInvitationDraft");
	expect(source).toContain("getEmployeeInvitationDraftForUpdate");
});
```

Import `readFileSync` in `employee-mutations.actions.test.ts` if needed:

```ts
import { readFileSync } from "node:fs";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/settings/employees/employee-queries.actions.test.ts' 'src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts'`

Expected: FAIL because draft server action code does not exist.

- [ ] **Step 3: Add validation and types**

In `apps/webapp/src/lib/validations/employee.ts`, export:

```ts
export const updateEmployeeInvitationDraftSchema = updateEmployeeSchema.pick({
	teamId: true,
	role: true,
	position: true,
	employeeNumber: true,
	gender: true,
	pronouns: true,
	birthday: true,
	startDate: true,
	endDate: true,
	contractType: true,
	hourlyRate: true,
	firstName: true,
	lastName: true,
});

export type UpdateEmployeeInvitationDraft = z.infer<typeof updateEmployeeInvitationDraftSchema>;
```

In `employee-action-types.ts`, add the shared type conventions from the top of this plan and define:

```ts
import type { invitation } from "@/db/auth-schema";
import type { employeeInvitationDraft } from "@/db/schema";

export type EmployeeWithRelations = typeof employee.$inferSelect & {
	kind: "employee";
	user: typeof user.$inferSelect;
	team: typeof team.$inferSelect | null;
};

export type EmployeeInvitationDraftWithRelations = typeof employeeInvitationDraft.$inferSelect & {
	kind: "invitationDraft";
	encodedId: string;
	invitation: typeof invitation.$inferSelect;
	team: typeof team.$inferSelect | null;
	user: Pick<typeof user.$inferSelect, "id" | "firstName" | "lastName" | "name" | "email" | "image"> & {
		canUseWebapp?: boolean;
		canUseDesktop?: boolean;
		canUseMobile?: boolean;
	};
	isActive: false;
	invitationStatus: string;
	realEmployeeId: string | null;
};

export type EmployeeDirectoryRow = EmployeeWithRelations | EmployeeInvitationDraftWithRelations;
export type EmployeeDetailRecord = EmployeeDirectoryRow & { managers?: unknown[] };
```

Change `EmployeeListParams.status` to `EmployeeDirectoryStatus` and `PaginatedEmployeeResponse.employees` to `EmployeeDirectoryRow[]`.

- [ ] **Step 4: Implement draft query helpers**

In `employee-queries.actions.ts`, import `invitation` and `employeeInvitationDraft`, add draft ID helpers from `employee-action-types`, and add these functions:

```ts
function mapDraftRow(row: {
	draft: typeof employeeInvitationDraft.$inferSelect;
	invitation: typeof invitation.$inferSelect;
	team: typeof team.$inferSelect | null;
	realEmployee: Pick<typeof employee.$inferSelect, "id"> | null;
}): EmployeeInvitationDraftWithRelations {
	const displayName = [row.draft.firstName, row.draft.lastName].filter(Boolean).join(" ").trim();
	return {
		...row.draft,
		kind: "invitationDraft",
		encodedId: encodeEmployeeInvitationDraftId(row.draft.id),
		invitation: row.invitation,
		team: row.team,
		isActive: false,
		invitationStatus: row.invitation.status,
		realEmployeeId: row.realEmployee?.id ?? null,
		user: {
			id: row.draft.id,
			firstName: row.draft.firstName,
			lastName: row.draft.lastName,
			name: displayName || row.invitation.email,
			email: row.invitation.email,
			image: null,
			canUseWebapp: true,
			canUseDesktop: true,
			canUseMobile: true,
		},
	};
}
```

Add a `buildInvitationDraftFilters` function matching organization, role, status, team, and search. Drafts are included when status is `all`, `draft`, or omitted; they are excluded when status is `active` or `inactive`.

Update `loadEmployeePage` to query real employees as it does now and, when `actor.accessTier === "orgAdmin"`, query draft rows with the draft filters. Merge, sort by display name/email, slice by requested `offset` and `limit`, and return a combined `total`.

Update `getEmployeeAction` to decode draft IDs first:

```ts
const draftId = decodeEmployeeInvitationDraftId(employeeId);
if (draftId) {
	if (actor.accessTier !== "orgAdmin") return yield* _(Effect.fail(new NotFoundError({ message: "Employee not found", entityType: "employee", entityId: employeeId })));
	// query draft joined to invitation, team, and realEmployee by invitation.invitedVia where possible
	// return mapDraftRow(row) as EmployeeDetailRecord
}
```

- [ ] **Step 5: Implement draft update action**

In `employee-mutations.actions.ts`, import `employeeInvitationDraft`, `team`, `updateEmployeeInvitationDraftSchema`, `UpdateEmployeeInvitationDraft`, and `decodeEmployeeInvitationDraftId`.

Add:

```ts
export async function updateEmployeeInvitationDraftAction(
	draftEmployeeId: string,
	data: UpdateEmployeeInvitationDraft,
): Promise<ServerActionResult<void>> {
	return runTracedEmployeeAction({
		name: "updateEmployeeInvitationDraft",
		attributes: { "employeeDraft.id": draftEmployeeId },
		logError: (error) => logger.error({ error, draftEmployeeId }, "Failed to update employee invitation draft"),
		execute: () =>
			Effect.gen(function* (_) {
				const actor = yield* _(getEmployeeSettingsActorContext());
				yield* _(requireOrgAdminEmployeeSettingsAccess(actor, {
					message: "Only organization admins can update invited employee drafts",
					resource: "employee_invitation_draft",
					action: "update",
				}));
				const draftId = decodeEmployeeInvitationDraftId(draftEmployeeId) ?? draftEmployeeId;
				const validatedData = yield* _(validateInput(updateEmployeeInvitationDraftSchema, data));
				const targetDraft = yield* _(actor.dbService.query("getEmployeeInvitationDraftForUpdate", async () => {
					return await actor.dbService.db.query.employeeInvitationDraft.findFirst({
						where: and(eq(employeeInvitationDraft.id, draftId), eq(employeeInvitationDraft.organizationId, actor.organizationId)),
					});
				}));
				if (!targetDraft) return yield* _(Effect.fail(new NotFoundError({ message: "Employee invitation draft not found", entityType: "employee_invitation_draft", entityId: draftId })));
				if (validatedData.teamId) {
					const targetTeam = yield* _(actor.dbService.query("getEmployeeInvitationDraftTeam", async () => {
						return await actor.dbService.db.query.team.findFirst({ where: and(eq(team.id, validatedData.teamId!), eq(team.organizationId, actor.organizationId)) });
					}));
					if (!targetTeam) return yield* _(Effect.fail(new ValidationError({ message: "Target team not found in this organization", field: "teamId", value: validatedData.teamId })));
				}
				const hourlyRate = parseHourlyRate(validatedData.hourlyRate);
				const { hourlyRate: _hourlyRate, ...draftUpdate } = validatedData;
				yield* _(actor.dbService.query("updateEmployeeInvitationDraft", async () => {
					await actor.dbService.db.update(employeeInvitationDraft).set({
						...draftUpdate,
						currentHourlyRate: hourlyRate?.toString() ?? null,
						updatedBy: actor.session.user.id,
						updatedAt: currentTimestamp(),
					}).where(and(eq(employeeInvitationDraft.id, draftId), eq(employeeInvitationDraft.organizationId, actor.organizationId)));
				}));
				revalidateEmployeesCache(actor.organizationId);
			}),
	});
}
```

Export it from `actions.ts` as `updateEmployeeInvitationDraft`.

- [ ] **Step 6: Run server action tests**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/settings/employees/employee-queries.actions.test.ts' 'src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts'`

Expected: PASS.

- [ ] **Step 7: Commit server action work**

```bash
git add apps/webapp/src/lib/validations/employee.ts 'apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-types.ts' 'apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.ts' 'apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts' 'apps/webapp/src/app/[locale]/(app)/settings/employees/actions.ts' 'apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.test.ts' 'apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts'
git commit -m "feat: expose employee invitation drafts"
```

---

### Task 5: Employee Directory Draft Rows

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/columns.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/columns.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.tsx`
- Modify: `apps/webapp/src/lib/query/use-employees.ts`

- [ ] **Step 1: Write failing column tests**

In `columns.test.tsx`, import `EmployeeDirectoryRow` and add a draft factory and tests:

```ts
function createDraft(overrides: Partial<EmployeeDirectoryRow> = {}): EmployeeDirectoryRow {
	return {
		kind: "invitationDraft",
		id: "draft-1",
		encodedId: "draft:draft-1",
		invitationId: "invite-1",
		organizationId: "org_1",
		teamId: null,
		role: "manager",
		firstName: "Invited",
		lastName: "Manager",
		pronouns: null,
		position: "Ops Lead",
		employeeNumber: "D-1",
		gender: null,
		birthday: null,
		startDate: null,
		endDate: null,
		contractType: "fixed",
		currentHourlyRate: null,
		updatedBy: null,
		createdAt: new Date("2024-01-01T00:00:00Z"),
		updatedAt: new Date("2024-01-01T00:00:00Z"),
		isActive: false,
		invitationStatus: "pending",
		realEmployeeId: null,
		invitation: { email: "invited@example.com", status: "pending" } as EmployeeDirectoryRow["invitation"],
		user: { id: "draft-1", firstName: "Invited", lastName: "Manager", name: "Invited Manager", email: "invited@example.com", image: null },
		team: null,
		...overrides,
	} as EmployeeDirectoryRow;
}

it("renders invitation drafts with draft status and draft detail link", () => {
	renderEmployeeCell(createDraft());
	expect(screen.getByText("Invited Manager")).toBeTruthy();
	expect(screen.getByText("invited@example.com")).toBeTruthy();

	const statusColumn = columns.find((column) => column.id === "status" || column.accessorKey === "isActive");
	const cell = statusColumn?.cell;
	if (typeof cell !== "function") throw new Error("Status cell is not renderable");
	render(cell({ row: { original: createDraft() } } as Parameters<typeof cell>[0]) as React.ReactElement);
	expect(screen.getByText("Draft")).toBeTruthy();
	expect(screen.getByText("pending")).toBeTruthy();
});
```

- [ ] **Step 2: Run column tests to verify failure**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/settings/employees/columns.test.tsx'`

Expected: FAIL because columns are typed only for real employees and status is active/inactive only.

- [ ] **Step 3: Update columns for drafts**

Change column typing to `ColumnDef<EmployeeDirectoryRow>[]`. Update name, status, and action cells:

```tsx
function StatusCell({ row }: { row: EmployeeDirectoryRow }) {
	const { t } = useTranslate();
	if (row.kind === "invitationDraft") {
		return (
			<div className="flex flex-wrap gap-1">
				<Badge variant="secondary">{t("settings.employees.directory.statuses.draft", "Draft")}</Badge>
				<Badge variant="outline">{row.invitationStatus}</Badge>
			</div>
		);
	}
	return <Badge variant={row.isActive ? "default" : "secondary"}>{row.isActive ? t("settings.employees.directory.statuses.active", "Active") : t("settings.employees.directory.statuses.inactive", "Inactive")}</Badge>;
}

function ViewDetailsCell({ row }: { row: EmployeeDirectoryRow }) {
	const { t } = useTranslate();
	const href = row.kind === "invitationDraft" ? `/settings/employees/${row.encodedId}` : `/settings/employees/${row.id}`;
	return <div className="text-right"><Button variant="ghost" size="sm" asChild><Link href={href}>{t("settings.employees.directory.actions.viewDetails", "View Details")}</Link></Button></div>;
}
```

Use `<StatusCell row={row.original} />` and `<ViewDetailsCell row={row.original} />`.

- [ ] **Step 4: Add Draft status filter to client state**

In `use-employees.ts`, keep `status` as `EmployeeDirectoryStatus` and allow `draft` through params:

```ts
const [status, setStatusState] = useState<EmployeeDirectoryStatus>("all");
status: status === "all" ? undefined : status,
```

In `employees-page-client.tsx`, add:

```tsx
<SelectItem value="draft">
	{t("settings.employees.directory.statuses.draft", "Draft")}
</SelectItem>
```

- [ ] **Step 5: Run directory UI tests**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/settings/employees/columns.test.tsx'`

Expected: PASS.

- [ ] **Step 6: Commit directory work**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/employees/columns.tsx' 'apps/webapp/src/app/[locale]/(app)/settings/employees/columns.test.tsx' 'apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.tsx' apps/webapp/src/lib/query/use-employees.ts
git commit -m "feat: show invited employee drafts in directory"
```

---

### Task 6: Draft Detail View With Hidden Real-Employee Sections

**Files:**
- Modify: `apps/webapp/src/lib/query/use-employee.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx`

- [ ] **Step 1: Write failing page utility tests**

Add to `page-utils.test.ts`:

```ts
it("syncs invitation draft identity fields into the employee detail form", () => {
	const form = createFormMock();
	syncEmployeeForm(form, {
		kind: "invitationDraft",
		id: "draft-1",
		user: { firstName: "Ada", lastName: "Lovelace", name: "Ada Lovelace", email: "ada@example.com", image: null, id: "draft-1" },
		gender: null,
		pronouns: "they/them",
		position: "Lead",
		employeeNumber: "D-100",
		startDate: new Date("2026-06-01T00:00:00.000Z"),
		role: "manager",
		contractType: "hourly",
		currentHourlyRate: "45.00",
		team: null,
	} as EmployeeDetail);

	expect(form.setFieldValue).toHaveBeenCalledWith("firstName", "Ada");
	expect(form.setFieldValue).toHaveBeenCalledWith("lastName", "Lovelace");
	expect(form.setFieldValue).toHaveBeenCalledWith("role", "manager");
	expect(form.setFieldValue).toHaveBeenCalledWith("hourlyRate", "45.00");
});
```

Add to `page-sections.test.tsx`:

```tsx
it("labels draft overview records and shows invitation status", () => {
	render(
		<EmployeeOverviewCard
			employee={{
				kind: "invitationDraft",
				id: "draft-1",
				user: { id: "draft-1", name: "Ada Lovelace", email: "ada@example.com", image: null, firstName: "Ada", lastName: "Lovelace" },
				team: null,
				role: "manager",
				pronouns: null,
				isActive: false,
				invitationStatus: "pending",
			} as EmployeeDetail}
			schedule={null}
		/>,
	);
	expect(screen.getByText("Draft")).toBeTruthy();
	expect(screen.getByText("pending")).toBeTruthy();
});
```

- [ ] **Step 2: Run detail tests to verify failure**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.test.ts' 'src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx'`

Expected: FAIL because detail helpers and overview do not understand drafts.

- [ ] **Step 3: Update query hook for drafts**

In `use-employee.ts`, widen `EmployeeDetail` to `EmployeeDetailRecord & { managers?: ManagerRelation[] }` and compute:

```ts
const isDraft = employeeQuery.data?.kind === "invitationDraft";
```

Update query enablement:

```ts
enabled: enabled && hasEmployee && !isDraft
```

for schedule, managers, rate history, and employment history queries.

Update mutation selection:

```ts
mutationFn: (data: UpdateEmployee) =>
	employeeQuery.data?.kind === "invitationDraft"
		? updateEmployeeInvitationDraft(employeeId, data)
		: updateEmployee(employeeId, data),
```

- [ ] **Step 4: Update detail client to hide sections**

In `employee-detail-page-client.tsx`, compute:

```ts
const isDraft = employee.kind === "invitationDraft";
const canShowRealEmployeeSections = !isDraft;
```

Wrap real-employee-only sections with `canShowRealEmployeeSections`, including `ManagerAssignment`, `EmployeeCustomRolesCard`, `EmployeeSkillsCard`, `EmployeeEmploymentHistoryCard`, `WorkBalanceRecalculationCard`, and `RateHistoryCard`.

Pass draft-aware header/overview props and keep `EmployeeEditFormCard` visible.

- [ ] **Step 5: Update overview and form sync**

In `page-sections.tsx`, render draft status in `EmployeeOverviewCard`:

```tsx
{employee.kind === "invitationDraft" ? (
	<div className="flex flex-wrap gap-1">
		<Badge variant="secondary">{t("settings.employees.detailView.statusDraft", "Draft")}</Badge>
		<Badge variant="outline">{employee.invitationStatus}</Badge>
	</div>
) : (
	<Badge variant={employee.isActive ? "default" : "secondary"}>
		{employee.isActive ? t("settings.employees.detailView.statusActive", "Active") : t("settings.employees.detailView.statusInactive", "Inactive")}
	</Badge>
)}
```

If `employee.kind === "invitationDraft" && employee.realEmployeeId`, render a small link:

```tsx
<Button asChild variant="outline" size="sm">
	<Link href={`/settings/employees/${employee.realEmployeeId}`}>{t("settings.employees.detailView.editRealEmployee", "Edit active employee")}</Link>
</Button>
```

In `page-utils.ts`, use `employee.user.firstName`/`lastName` for both kinds, as the draft mapper already provides those fields.

- [ ] **Step 6: Run detail tests**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.test.ts' 'src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx'`

Expected: PASS.

- [ ] **Step 7: Commit detail work**

```bash
git add apps/webapp/src/lib/query/use-employee.ts 'apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page.tsx' 'apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx' 'apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.tsx' 'apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.ts' 'apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.test.ts' 'apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx'
git commit -m "feat: edit invited employee drafts"
```

---

### Task 7: Full Verification And Regression Pass

**Files:**
- Review all files changed in Tasks 1-6.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm --dir apps/webapp test src/db/schema/__tests__/employee-invitation-draft-schema.test.ts src/lib/auth/organization-member-provisioning.test.ts src/lib/auth.test.ts 'src/app/[locale]/(app)/settings/organizations/actions.test.ts' 'src/app/[locale]/(app)/settings/employees/employee-queries.actions.test.ts' 'src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts' 'src/app/[locale]/(app)/settings/employees/columns.test.tsx' 'src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.test.ts' 'src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx'
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `CI=true pnpm build`

Expected: PASS.

- [ ] **Step 4: Inspect diff for scope and security**

Run: `git diff --stat HEAD~6..HEAD` and `git diff HEAD~6..HEAD -- apps/webapp/src/lib/auth/organization-member-provisioning.ts 'apps/webapp/src/app/[locale]/(app)/settings/employees' 'apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts'`

Expected: Diff only contains invited employee draft implementation, all draft queries/mutations filter by `organizationId`, and no generated `apps/webapp/src/db/auth-schema.ts` changes exist.

- [ ] **Step 5: Commit verification fixes if needed**

If verification changes files from this feature, inspect them before staging:

```bash
git diff
git status --short
```

Stage only the invited employee draft files changed by the verification fix, then commit:

```bash
git commit -m "fix: stabilize invited employee drafts"
```

If no verification fixes are required, do not create an empty commit.
