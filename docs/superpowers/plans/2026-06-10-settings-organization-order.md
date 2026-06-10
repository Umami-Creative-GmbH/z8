# Settings Organization Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Employees into the Organization settings group and order organization settings as Organization, Employees, Teams, Billing, Data Processing Agreement, Email Templates.

**Architecture:** The settings sidebar and overview are driven by `SETTINGS_ENTRIES` in `apps/webapp/src/components/settings/settings-config.ts`. A focused test in `settings-config.test.ts` locks the group assignment and order so the shared config stays consistent.

**Tech Stack:** Next.js, TypeScript, Vitest, pnpm.

---

### Task 1: Lock Organization Group Order

**Files:**
- Modify: `apps/webapp/src/components/settings/settings-config.test.ts`
- Modify: `apps/webapp/src/components/settings/settings-config.ts`

- [ ] **Step 1: Write the failing test**

Add a test asserting that org-admin-visible organization entries resolve to this order:

```ts
expect(organizationEntries.map((entry) => entry.id)).toEqual([
	"organizations",
	"employees",
	"teams",
	"billing",
	"avv",
	"email-templates",
]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/webapp/src/components/settings/settings-config.test.ts`

Expected: fail because `employees` is currently in `administration` and `email-templates` appears before `teams`.

- [ ] **Step 3: Write minimal implementation**

Move the `employees` entry into the organization block in `SETTINGS_ENTRIES`, set `group: "organization"`, and place the entries in this sequence: `organizations`, `employees`, `teams`, `billing`, `avv`, `email-templates`.

- [ ] **Step 4: Run focused tests**

Run: `pnpm vitest run apps/webapp/src/components/settings/settings-config.test.ts`

Expected: pass.

- [ ] **Step 5: Review other groups**

Inspect the remaining `SETTINGS_ENTRIES` sequence. Only change additional ordering if an entry is clearly in the wrong group; otherwise report that no obvious low-risk grouping changes were made.
