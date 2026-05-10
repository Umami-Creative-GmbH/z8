# Platform Admin User Redaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redact full user names by default in the cross-tenant platform-admin users view while preserving email-based account operations.

**Architecture:** Minimize personal data at the service boundary by removing `name` and `image` from `PlatformAdminService.listUsers` and changing search to email-only. Render a stable redacted display label in the users page from the user ID, update docs, and add guardrail tests so full names are not accidentally reintroduced.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle ORM, Effect, TanStack Query, Vitest, Testing Library, Tolgee, Luxon.

---

## File Structure

- Modify: `apps/webapp/src/lib/effect/services/platform-admin.service.ts`
  - Owns the platform-admin service contract, database query, and email-only search behavior.
- Create: `apps/webapp/src/lib/effect/services/platform-admin.service.test.ts`
  - Adds source-level guardrails that the users list service no longer selects or searches by full names or profile images.
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.tsx`
  - Renders redacted user labels and neutral avatars in the platform-admin users table.
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.test.tsx`
  - Verifies the users page does not render full names and still renders email addresses.
- Modify: `apps/docs/content/docs/guide/admin-guide/platform-admin.mdx`
  - Documents default name redaction in the users view.

## Execution Rules

- Use `pnpm`, not `npm` or `bun`.
- Do not edit `apps/webapp/src/db/auth-schema.ts`; it is generated.
- Do not create commits unless the user explicitly asks for commits. The checkpoint steps below use `git status` instead of `git commit` for this session.
- Keep the implementation minimal. Do not add reveal workflows, new roles, or privacy settings.

### Task 1: Add Users Page Redaction Test

**Files:**
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.test.tsx`

- [ ] **Step 1: Write the failing users page test**

Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.test.tsx` with this content:

```tsx
/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock, useQueryMock, invalidateQueriesMock } = vi.hoisted(() => ({
	pushMock: vi.fn(),
	useQueryMock: vi.fn(),
	invalidateQueriesMock: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: useQueryMock,
	useQueryClient: () => ({
		invalidateQueries: invalidateQueriesMock,
	}),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string, params?: Record<string, string | number>) => {
			if (!defaultValue) return _key;
			return Object.entries(params ?? {}).reduce(
				(value, [key, replacement]) => value.replace(`{${key}}`, String(replacement)),
				defaultValue,
			);
		},
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({
		push: pushMock,
	}),
}));

vi.mock("./actions", () => ({
	banUserAction: vi.fn(),
	listUserSessionsAction: vi.fn(),
	listUsersAction: vi.fn(),
	revokeAllUserSessionsAction: vi.fn(),
	revokeSessionAction: vi.fn(),
	unbanUserAction: vi.fn(),
}));

vi.mock("@/components/ui/action-panel", () => ({
	ActionPanel: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
		open ? <div>{children}</div> : null,
	ActionPanelBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ActionPanelContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ActionPanelDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ActionPanelFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ActionPanelHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ActionPanelTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
	AlertDialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
		open ? <div>{children}</div> : null,
	AlertDialogAction: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
	AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
	AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button {...props}>{children}</button>
	),
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/input", () => ({
	Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
	Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
		<label {...props}>{children}</label>
	),
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
	SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}));

vi.mock("@/components/ui/skeleton", () => ({
	Skeleton: () => <div>loading</div>,
}));

vi.mock("@/components/ui/table", () => ({
	Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
	TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
	TableCell: ({ children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
		<td {...props}>{children}</td>
	),
	TableHead: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
	TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
	TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
}));

vi.mock("@/components/ui/textarea", () => ({
	Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

import UsersPage from "./page";

describe("Platform admin users page", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useQueryMock.mockReturnValue({
			data: {
				data: [
					{
						id: "usr_abcdef1234567890",
						name: "Ada Lovelace",
						email: "ada@example.com",
						emailVerified: true,
						role: "user",
						banned: false,
						banReason: null,
						banExpires: null,
						createdAt: new Date("2026-05-01T08:00:00Z"),
						image: "https://example.com/avatar.png",
					},
				],
				total: 1,
				page: 1,
				pageSize: 20,
				totalPages: 1,
			},
			isLoading: false,
			error: null,
		});
	});

	it("redacts full names while preserving email visibility", () => {
		render(<UsersPage />);

		expect(screen.getByText("User abcdef")).toBeTruthy();
		expect(screen.getByText("ada@example.com")).toBeTruthy();
		expect(screen.queryByText("Ada Lovelace")).toBeNull();
		expect(screen.queryByAltText("Ada Lovelace")).toBeNull();
	});
});
```

- [ ] **Step 2: Run the users page test to verify it fails**

Run:

```bash
pnpm --dir apps/webapp test -- src/app/[locale]/\(admin\)/platform-admin/users/page.test.tsx
```

Expected: FAIL because the page still renders `Ada Lovelace` and does not render `User abcdef`.

- [ ] **Step 3: Checkpoint without commit**

Run:

```bash
git status --short
```

Expected: the new users page test is listed as untracked or modified. Do not commit unless the user explicitly asks.

### Task 2: Implement Users Page Redacted Rendering

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.tsx`

- [ ] **Step 1: Add a deterministic redacted label helper**

In `apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.tsx`, add this helper after `getInitialFilters()`:

```tsx
function getRedactedUserLabel(userId: string): string {
	return `User ${userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "redacted"}`;
}
```

- [ ] **Step 2: Replace name and avatar rendering in the user cell**

Replace the table user cell block currently rendering `user.image`, `alt={user.name}`, and `{user.name}` with:

```tsx
<TableCell>
	<div className="flex items-center gap-3">
		<div className="size-8 rounded-full bg-muted flex items-center justify-center">
			<IconUser className="size-4" aria-hidden="true" />
		</div>
		<div>
			<div className="font-medium">{getRedactedUserLabel(user.id)}</div>
			<div className="text-sm text-muted-foreground">{user.email}</div>
		</div>
	</div>
</TableCell>
```

- [ ] **Step 3: Run the users page test to verify it passes**

Run:

```bash
pnpm --dir apps/webapp test -- src/app/[locale]/\(admin\)/platform-admin/users/page.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Checkpoint without commit**

Run:

```bash
git status --short
```

Expected: the users page and users page test are modified. Do not commit unless the user explicitly asks.

### Task 3: Add Service Guardrail Test

**Files:**
- Create: `apps/webapp/src/lib/effect/services/platform-admin.service.test.ts`

- [ ] **Step 1: Write source-level service guardrail tests**

Create `apps/webapp/src/lib/effect/services/platform-admin.service.test.ts` with this content:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SERVICE_SOURCE = fileURLToPath(new URL("./platform-admin.service.ts", import.meta.url));

function getListUsersSource(): string {
	const source = readFileSync(SERVICE_SOURCE, "utf8");
	const start = source.indexOf("listUsers: (filters, pagination) =>");
	const end = source.indexOf("\n\t\t\tbanUser:", start);

	expect(start).toBeGreaterThan(-1);
	expect(end).toBeGreaterThan(start);

	return source.slice(start, end);
}

describe("PlatformAdminService listUsers privacy guardrails", () => {
	it("does not select full names or profile images for the platform users list", () => {
		const listUsersSource = getListUsersSource();

		expect(listUsersSource).not.toContain("name: user.name");
		expect(listUsersSource).not.toContain("image: user.image");
	});

	it("searches platform users by email only", () => {
		const listUsersSource = getListUsersSource();

		expect(listUsersSource).toContain("ilike(user.email");
		expect(listUsersSource).not.toContain("ilike(user.name");
	});
});
```

- [ ] **Step 2: Run the service test to verify it fails**

Run:

```bash
pnpm --dir apps/webapp test -- src/lib/effect/services/platform-admin.service.test.ts
```

Expected: FAIL because `listUsers` still selects `name` and `image`, and still searches `user.name`.

- [ ] **Step 3: Checkpoint without commit**

Run:

```bash
git status --short
```

Expected: the new service guardrail test is listed as untracked or modified. Do not commit unless the user explicitly asks.

### Task 4: Minimize Platform User Service Contract And Search

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/platform-admin.service.ts`

- [ ] **Step 1: Remove name and image from the `PlatformUser` interface**

Change the `PlatformUser` interface to:

```ts
export interface PlatformUser {
	id: string;
	email: string;
	emailVerified: boolean;
	role: string | null;
	banned: boolean | null;
	banReason: string | null;
	banExpires: Date | null;
	createdAt: Date;
}
```

- [ ] **Step 2: Change users search to email-only**

Replace the current search condition:

```ts
if (search) {
	conditions.push(
		or(
			ilike(user.name, `%${search}%`),
			ilike(user.email, `%${search}%`),
		),
	);
}
```

with:

```ts
if (search) {
	conditions.push(ilike(user.email, `%${search}%`));
}
```

- [ ] **Step 3: Remove name and image from the database select**

Change the users select block to:

```ts
const users = await db
	.select({
		id: user.id,
		email: user.email,
		emailVerified: user.emailVerified,
		role: user.role,
		banned: user.banned,
		banReason: user.banReason,
		banExpires: user.banExpires,
		createdAt: user.createdAt,
	})
	.from(user)
	.where(whereClause)
	.orderBy(desc(user.createdAt))
	.limit(pageSize)
	.offset(offset);
```

- [ ] **Step 4: Run the service guardrail test to verify it passes**

Run:

```bash
pnpm --dir apps/webapp test -- src/lib/effect/services/platform-admin.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the users page test again**

Run:

```bash
pnpm --dir apps/webapp test -- src/app/[locale]/\(admin\)/platform-admin/users/page.test.tsx
```

Expected: PASS. If TypeScript complains that the test object has extra `name` or `image` properties, remove those two properties from the mocked user object and keep the assertions that query for `Ada Lovelace` and `alt` text.

- [ ] **Step 6: Checkpoint without commit**

Run:

```bash
git status --short
```

Expected: service, service test, users page, and users page test are modified. Do not commit unless the user explicitly asks.

### Task 5: Update Platform Admin Documentation

**Files:**
- Modify: `apps/docs/content/docs/guide/admin-guide/platform-admin.mdx`

- [ ] **Step 1: Update the Users section**

Replace the current Users section text:

```mdx
Use `/platform-admin/users` to search platform accounts, filter by status, ban or unban users, and inspect or revoke active sessions.

These actions are platform-scoped. They are not the same as adjusting a member's permissions inside one organization.
```

with:

```mdx
Use `/platform-admin/users` to search platform accounts by email, filter by status, ban or unban users, and inspect or revoke active sessions.

For data-protection compliance, full user names are redacted by default in this cross-tenant view. Platform admins see a stable redacted user label plus the account email needed for operational lookup.

These actions are platform-scoped. They are not the same as adjusting a member's permissions inside one organization.
```

- [ ] **Step 2: Run a docs content grep check**

Run:

```bash
git diff -- apps/docs/content/docs/guide/admin-guide/platform-admin.mdx
```

Expected: the diff mentions email search and default full-name redaction.

- [ ] **Step 3: Checkpoint without commit**

Run:

```bash
git status --short
```

Expected: docs guide is modified. Do not commit unless the user explicitly asks.

### Task 6: Run Focused Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run focused Vitest files**

Run:

```bash
pnpm --dir apps/webapp test -- src/app/[locale]/\(admin\)/platform-admin/users/page.test.tsx src/lib/effect/services/platform-admin.service.test.ts
```

Expected: both focused test files PASS.

- [ ] **Step 2: Run existing platform-admin tests touched by nearby behavior**

Run:

```bash
pnpm --dir apps/webapp test -- src/app/[locale]/\(admin\)/platform-admin/organizations/page.test.tsx src/app/[locale]/\(admin\)/platform-admin/layout.test.ts
```

Expected: existing nearby platform-admin tests PASS.

- [ ] **Step 3: Run TypeScript or full webapp tests if the focused suite passes**

Run:

```bash
pnpm --dir apps/webapp test
```

Expected: webapp Vitest suite PASS. If this is too slow or fails from unrelated pre-existing tests, record the failing command output and keep the focused passing commands as the feature verification evidence.

- [ ] **Step 4: Inspect final diff for privacy regressions**

Run:

```bash
git diff -- apps/webapp/src/lib/effect/services/platform-admin.service.ts apps/webapp/src/app/[locale]/\(admin\)/platform-admin/users/page.tsx apps/webapp/src/app/[locale]/\(admin\)/platform-admin/users/page.test.tsx apps/webapp/src/lib/effect/services/platform-admin.service.test.ts apps/docs/content/docs/guide/admin-guide/platform-admin.mdx
```

Expected: no `name: user.name`, no `image: user.image`, no `ilike(user.name`, and no JSX rendering `user.name` in the users page.

- [ ] **Step 5: Final checkpoint without commit**

Run:

```bash
git status --short
```

Expected: only files related to the spec and implementation are modified or untracked by this work. Do not revert unrelated worktree changes and do not commit unless the user explicitly asks.

## Self-Review

- Spec coverage: The plan covers service-level minimization, UI redaction, email-only search, docs, authorization preservation, and testing.
- Placeholder scan: The plan contains concrete files, code snippets, commands, and expected outcomes.
- Type consistency: `PlatformUser` removes `name` and `image`; the users page uses only `id` and `email` for the user cell.
- Scope check: This is a single focused privacy improvement for the platform-admin users view and does not need decomposition.
