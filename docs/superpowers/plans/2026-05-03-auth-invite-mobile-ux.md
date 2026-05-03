# Auth Invite Mobile UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the auth-adjacent invite experience so invite code management, invite panels, QR display, and join-code redemption work cleanly on mobile while preserving existing behavior.

**Architecture:** Keep existing server actions, queries, mutations, and route ownership intact. Make responsive UI changes in the existing auth shell, shared form/panel primitives, and invite components; use a desktop table plus mobile card layout for invite management.

**Tech Stack:** Next.js App Router, React 19, Tailwind CSS v4 utility classes, shadcn/Radix UI primitives, TanStack Query, Tolgee translations, Vitest with jsdom.

---

## File Structure

- Modify: `apps/webapp/src/app/[locale]/(auth)/layout.tsx`
  - Responsibility: shared auth route shell, dynamic domain auth context, cookie consent, desktop split image, mobile document flow.
- Modify: `apps/webapp/src/components/auth-form-wrapper.tsx`
  - Responsibility: shared visual wrapper for auth forms and branded auth content.
- Modify: `apps/webapp/src/components/auth-form-wrapper.test.tsx`
  - Responsibility: source/render assertions for mobile-friendly auth wrapper classes and branding behavior.
- Modify: `apps/webapp/src/components/ui/action-panel.tsx`
  - Responsibility: shared settings side-panel layout, mobile width, scroll body, and footer stacking behavior.
- Modify: `apps/webapp/src/components/ui/action-panel.test.tsx`
  - Responsibility: source/render assertions for panel responsive classes and right-side behavior.
- Modify: `apps/webapp/src/components/join-organization-form.tsx`
  - Responsibility: public invite-code validation and redemption UI states.
- Create: `apps/webapp/src/components/join-organization-form.test.tsx`
  - Responsibility: source assertions for mobile stacking, code presentation, and status-card structure without mocking full auth/query behavior.
- Modify: `apps/webapp/src/components/organization/invite-code-management.tsx`
  - Responsibility: invite code list UI, desktop table, mobile cards, copy/QR/edit/delete actions.
- Create: `apps/webapp/src/components/organization/invite-code-management.test.tsx`
  - Responsibility: source assertions for responsive table/card rendering and mobile action affordances.
- Modify: `apps/webapp/src/components/organization/invite-code-dialog.tsx`
  - Responsibility: create/edit invite code action panel form layout.
- Modify: `apps/webapp/src/components/organization/invite-member-dialog.tsx`
  - Responsibility: invite member action panel layout consistency.
- Modify: `apps/webapp/src/components/organization/invite-code-qr-dialog.tsx`
  - Responsibility: QR action panel URL wrapping and responsive QR preview.

## Implementation Notes

- Do not edit `apps/webapp/src/db/auth-schema.ts`.
- Do not change server action signatures or organization scoping.
- Do not introduce native `Date` in new logic. This plan only changes presentation and does not require date logic changes.
- Keep existing translations and fallback strings. New visible copy should use `t()` with existing keys where possible.
- Preserve icon-only button `aria-label` values.
- Use `pnpm`, not `npm` or `bun`.

---

### Task 1: Auth Shell And Wrapper Mobile Polish

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(auth)/layout.tsx`
- Modify: `apps/webapp/src/components/auth-form-wrapper.tsx`
- Modify: `apps/webapp/src/components/auth-form-wrapper.test.tsx`

- [ ] **Step 1: Add failing wrapper test assertions**

Update `apps/webapp/src/components/auth-form-wrapper.test.tsx` with this test after the existing tests:

```tsx
it("uses mobile-friendly card spacing before desktop card polish", () => {
	const { container } = render(
		<AuthFormWrapper title="Join workspace">
			<div>join form</div>
		</AuthFormWrapper>,
	);

	const wrapper = container.firstElementChild;
	const card = wrapper?.firstElementChild;
	const cardContent = card?.firstElementChild;

	expect(wrapper?.className).toContain("max-w-md");
	expect(card?.className).toContain("shadow-none");
	expect(card?.className).toContain("sm:shadow-xl");
	expect(cardContent?.className).toContain("p-5");
	expect(cardContent?.className).toContain("sm:p-8");
});
```

- [ ] **Step 2: Run wrapper test to verify it fails**

Run:

```bash
pnpm --dir apps/webapp test src/components/auth-form-wrapper.test.tsx
```

Expected: FAIL because `shadow-none` and `p-5` are not present yet.

- [ ] **Step 3: Update auth layout mobile document flow**

In `apps/webapp/src/app/[locale]/(auth)/layout.tsx`, replace the layout class section with these class names while preserving all server logic and children:

```tsx
<div className="min-h-svh bg-background lg:grid lg:grid-cols-2">
	<section className="flex min-h-svh flex-col px-4 py-4 sm:px-8 sm:py-6 lg:h-svh lg:overflow-y-auto lg:px-10">
		<div className="flex items-center justify-end gap-2">
			<ThemeToggle />
			<LanguageSwitcher />
		</div>

		<main className="flex flex-1 items-center justify-center py-8 sm:py-10">
			<div className="w-full max-w-3xl">{children}</div>
		</main>

		<div className="pt-2">
			<InfoFooter />
		</div>
	</section>

	<aside className="fixed top-0 right-0 hidden h-svh w-1/2 overflow-hidden bg-muted lg:block">
```

- [ ] **Step 4: Update auth wrapper mobile card treatment**

In `apps/webapp/src/components/auth-form-wrapper.tsx`, change the card and content class names to:

```tsx
<Card className="w-full border-border/70 bg-card/95 shadow-none shadow-black/5 sm:shadow-xl dark:shadow-black/30">
	<CardContent className="p-5 sm:p-8">
```

- [ ] **Step 5: Run wrapper test to verify it passes**

Run:

```bash
pnpm --dir apps/webapp test src/components/auth-form-wrapper.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit auth shell polish**

Run:

```bash
git add apps/webapp/src/app/[locale]/\(auth\)/layout.tsx apps/webapp/src/components/auth-form-wrapper.tsx apps/webapp/src/components/auth-form-wrapper.test.tsx
git commit -m "fix: improve auth mobile layout polish"
```

Expected: commit succeeds with only these three files staged.

---

### Task 2: Shared Action Panel Mobile Behavior

**Files:**
- Modify: `apps/webapp/src/components/ui/action-panel.tsx`
- Modify: `apps/webapp/src/components/ui/action-panel.test.tsx`

- [ ] **Step 1: Add failing panel responsive class assertions**

Add this test to `apps/webapp/src/components/ui/action-panel.test.tsx` after the width variants test:

```tsx
it("uses mobile-safe width and stacked footer actions", () => {
	render(
		<ActionPanel open>
			<ActionPanelContent>
				<ActionPanelTitle>Responsive panel</ActionPanelTitle>
				<ActionPanelFooter>Footer actions</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>,
	);

	const dialogClassName = screen.getByRole("dialog", { name: "Responsive panel" }).className;
	expect(dialogClassName).toContain("w-[calc(100vw-0.75rem)]");
	expect(dialogClassName).toContain("sm:w-3/4");
	expect(screen.getByText("Footer actions").className).toContain("flex-col-reverse");
	expect(screen.getByText("Footer actions").className).toContain("*:w-full");
	expect(screen.getByText("Footer actions").className).toContain("sm:*:w-auto");
});
```

- [ ] **Step 2: Run panel test to verify it fails**

Run:

```bash
pnpm --dir apps/webapp test src/components/ui/action-panel.test.tsx
```

Expected: FAIL because the mobile width and footer action width classes are not present yet.

- [ ] **Step 3: Update panel content width**

In `apps/webapp/src/components/ui/action-panel.tsx`, change the base `ActionPanelContent` class string to:

```tsx
"w-[calc(100vw-0.75rem)] gap-0 overflow-hidden p-0 sm:w-3/4"
```

- [ ] **Step 4: Update panel footer stacking**

In `apps/webapp/src/components/ui/action-panel.tsx`, change `ActionPanelFooter` class string to:

```tsx
"mt-0 flex-col-reverse border-t px-4 py-4 sm:flex-row sm:justify-end sm:px-6 *:w-full sm:*:w-auto"
```

- [ ] **Step 5: Run panel test to verify it passes**

Run:

```bash
pnpm --dir apps/webapp test src/components/ui/action-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit action panel polish**

Run:

```bash
git add apps/webapp/src/components/ui/action-panel.tsx apps/webapp/src/components/ui/action-panel.test.tsx
git commit -m "fix: improve action panel mobile layout"
```

Expected: commit succeeds with only action panel files staged.

---

### Task 3: Join-Code Route Responsive States

**Files:**
- Modify: `apps/webapp/src/components/join-organization-form.tsx`
- Create: `apps/webapp/src/components/join-organization-form.test.tsx`

- [ ] **Step 1: Add source-level responsive tests**

Create `apps/webapp/src/components/join-organization-form.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("JoinOrganizationForm mobile UX", () => {
	it("stacks invite code validation controls on mobile", () => {
		const source = readFileSync(join(process.cwd(), "src/components/join-organization-form.tsx"), "utf8");

		expect(source).toContain("flex flex-col gap-2 sm:flex-row");
		expect(source).toContain("font-mono uppercase tracking-[0.2em]");
		expect(source).toContain("w-full sm:w-auto");
	});

	it("uses full-width status cards for terminal invite states", () => {
		const source = readFileSync(join(process.cwd(), "src/components/join-organization-form.tsx"), "utf8");

		expect(source).toContain("mx-auto w-full max-w-md");
		expect(source).toContain("CardFooter className=\"flex flex-col gap-2 sm:flex-row sm:justify-center\"");
	});
});
```

- [ ] **Step 2: Run join form test to verify it fails**

Run:

```bash
pnpm --dir apps/webapp test src/components/join-organization-form.test.tsx
```

Expected: FAIL because the responsive classes do not exist yet.

- [ ] **Step 3: Update terminal state card widths**

In `apps/webapp/src/components/join-organization-form.tsx`, replace both occurrences of:

```tsx
<Card className="max-w-md mx-auto">
```

with:

```tsx
<Card className="mx-auto w-full max-w-md">
```

- [ ] **Step 4: Update success footer layout**

In the success state, replace:

```tsx
<CardFooter className="flex justify-center">
```

with:

```tsx
<CardFooter className="flex flex-col gap-2 sm:flex-row sm:justify-center">
```

In the already-member state, make the same replacement.

- [ ] **Step 5: Update invite code input row**

Replace the code input wrapper in the main form from:

```tsx
<div className="flex gap-2">
```

to:

```tsx
<div className="flex flex-col gap-2 sm:flex-row">
```

Change the invite code input class from:

```tsx
className="uppercase"
```

to:

```tsx
className="font-mono uppercase tracking-[0.2em]"
```

Change the validate button to include responsive width:

```tsx
className="w-full sm:w-auto"
```

- [ ] **Step 6: Run join form test to verify it passes**

Run:

```bash
pnpm --dir apps/webapp test src/components/join-organization-form.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit join-code route polish**

Run:

```bash
git add apps/webapp/src/components/join-organization-form.tsx apps/webapp/src/components/join-organization-form.test.tsx
git commit -m "fix: improve join invite mobile layout"
```

Expected: commit succeeds with only join form files staged.

---

### Task 4: Invite Code Management Mobile Cards

**Files:**
- Modify: `apps/webapp/src/components/organization/invite-code-management.tsx`
- Create: `apps/webapp/src/components/organization/invite-code-management.test.tsx`

- [ ] **Step 1: Add responsive source tests**

Create `apps/webapp/src/components/organization/invite-code-management.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("InviteCodeManagement responsive UX", () => {
	it("keeps the table for desktop and renders mobile invite cards", () => {
		const source = readFileSync(
			join(process.cwd(), "src/components/organization/invite-code-management.tsx"),
			"utf8",
		);

		expect(source).toContain("hidden md:block");
		expect(source).toContain("md:hidden");
		expect(source).toContain("InviteCodeMobileCard");
	});

	it("makes copy URL and QR primary mobile actions", () => {
		const source = readFileSync(
			join(process.cwd(), "src/components/organization/invite-code-management.tsx"),
			"utf8",
		);

		expect(source).toContain("settings.inviteCodes.copyUrl");
		expect(source).toContain("settings.inviteCodes.qrCode");
		expect(source).toContain("font-mono text-base font-semibold tracking-[0.18em]");
	});
});
```

- [ ] **Step 2: Run invite management test to verify it fails**

Run:

```bash
pnpm --dir apps/webapp test src/components/organization/invite-code-management.test.tsx
```

Expected: FAIL because mobile card rendering does not exist yet.

- [ ] **Step 3: Add a local mobile card component**

In `apps/webapp/src/components/organization/invite-code-management.tsx`, add this component between the `statusColors` constant and `export function InviteCodeManagement`:

```tsx
function InviteCodeMobileCard({
	code,
	copiedCode,
	onCopyCode,
	onCopyUrl,
	onOpenQr,
	onEdit,
	onDelete,
	formatDate,
	formatUsage,
	t,
}: {
	code: InviteCodeWithRelations;
	copiedCode: string | null;
	onCopyCode: (code: string) => void;
	onCopyUrl: (code: string) => void;
	onOpenQr: (code: InviteCodeWithRelations) => void;
	onEdit: (code: InviteCodeWithRelations) => void;
	onDelete: (code: InviteCodeWithRelations) => void;
	formatDate: (date: Date | null | undefined) => string;
	formatUsage: (code: InviteCodeWithRelations) => string;
	t: ReturnType<typeof useTranslate>["t"];
}) {
	return (
		<div className="rounded-xl border bg-card p-4 shadow-sm">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 space-y-1">
					<div className="flex items-center gap-2">
						<code className="rounded-md bg-muted px-2.5 py-1 font-mono text-base font-semibold tracking-[0.18em]">
							{code.code}
						</code>
						<Button
							variant="ghost"
							size="sm"
							className="h-8 w-8 p-0"
							onClick={() => onCopyCode(code.code)}
							aria-label={t("settings.inviteCodes.copyCode", "Copy code")}
						>
							{copiedCode === code.code ? (
								<IconCheck className="h-4 w-4 text-green-600" />
							) : (
								<IconCopy className="h-4 w-4" />
							)}
						</Button>
					</div>
					<div className="truncate font-medium">{code.label}</div>
					{code.description && (
						<div className="line-clamp-2 text-sm text-muted-foreground">{code.description}</div>
					)}
				</div>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="sm" aria-label={t("common.moreActions", "More actions")}>
							•••
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={() => onEdit(code)}>{t("common.edit", "Edit")}</DropdownMenuItem>
						<DropdownMenuItem onClick={() => onDelete(code)} className="text-destructive">
							{t("common.delete", "Delete")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			<div className="mt-4 grid grid-cols-2 gap-3 text-sm">
				<div>
					<div className="text-muted-foreground">{t("settings.inviteCodes.status", "Status")}</div>
					<Badge variant="secondary" className={statusColors[code.status]}>
						{t(`settings.inviteCodes.status.${code.status}`, code.status)}
					</Badge>
				</div>
				<div>
					<div className="text-muted-foreground">{t("settings.inviteCodes.usage", "Usage")}</div>
					<div className="font-medium">{formatUsage(code)}</div>
				</div>
				<div>
					<div className="text-muted-foreground">{t("settings.inviteCodes.expires", "Expires")}</div>
					<div className="font-medium">{formatDate(code.expiresAt)}</div>
				</div>
				<div>
					<div className="text-muted-foreground">{t("settings.inviteCodes.approval", "Approval")}</div>
					<Badge variant={code.requiresApproval ? "default" : "secondary"}>
						{code.requiresApproval
							? t("settings.inviteCodes.required", "Required")
							: t("settings.inviteCodes.auto", "Auto")}
					</Badge>
				</div>
			</div>

			<div className="mt-4 grid grid-cols-2 gap-2">
				<Button variant="outline" onClick={() => onCopyUrl(code.code)}>
					<IconCopy className="mr-2 h-4 w-4" />
					{t("settings.inviteCodes.copyUrl", "Copy invite URL")}
				</Button>
				<Button variant="outline" onClick={() => onOpenQr(code)}>
					<IconQrcode className="mr-2 h-4 w-4" />
					{t("settings.inviteCodes.qrCode", "QR Code")}
				</Button>
			</div>
		</div>
	);
}
```

- [ ] **Step 4: Wrap the existing table in a desktop-only container**

In the non-empty invite codes branch, wrap the existing `<Table>` block with:

```tsx
<div className="hidden md:block">
	<Table>
		...
	</Table>
</div>
```

Do not change the existing table cells except for formatting required by the formatter.

- [ ] **Step 5: Add mobile card list below the table wrapper**

Still inside the non-empty invite codes branch, add this after the desktop table wrapper:

```tsx
<div className="space-y-3 md:hidden">
	{inviteCodes.map((code) => (
		<InviteCodeMobileCard
			key={code.id}
			code={code}
			copiedCode={copiedCode}
			onCopyCode={handleCopyCodeOnly}
			onCopyUrl={handleCopyCode}
			onOpenQr={setQrDialogCode}
			onEdit={setEditingCode}
			onDelete={setDeleteDialogCode}
			formatDate={formatDate}
			formatUsage={formatUsage}
			t={t}
		/>
	))}
</div>
```

- [ ] **Step 6: Run invite management test to verify it passes**

Run:

```bash
pnpm --dir apps/webapp test src/components/organization/invite-code-management.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit invite management cards**

Run:

```bash
git add apps/webapp/src/components/organization/invite-code-management.tsx apps/webapp/src/components/organization/invite-code-management.test.tsx
git commit -m "fix: add mobile invite code cards"
```

Expected: commit succeeds with only invite management files staged.

---

### Task 5: Invite Panels And QR Mobile Polish

**Files:**
- Modify: `apps/webapp/src/components/organization/invite-code-dialog.tsx`
- Modify: `apps/webapp/src/components/organization/invite-member-dialog.tsx`
- Modify: `apps/webapp/src/components/organization/invite-code-qr-dialog.tsx`
- Modify: `apps/webapp/src/components/organization/invite-code-management.test.tsx`

- [ ] **Step 1: Extend source tests for panel polish**

Append this test to `apps/webapp/src/components/organization/invite-code-management.test.tsx`:

```tsx
it("keeps invite panels readable on mobile", () => {
	const createPanel = readFileSync(
		join(process.cwd(), "src/components/organization/invite-code-dialog.tsx"),
		"utf8",
	);
	const memberPanel = readFileSync(
		join(process.cwd(), "src/components/organization/invite-member-dialog.tsx"),
		"utf8",
	);
	const qrPanel = readFileSync(
		join(process.cwd(), "src/components/organization/invite-code-qr-dialog.tsx"),
		"utf8",
	);

	expect(createPanel).toContain("flex flex-col gap-2 sm:flex-row");
	expect(createPanel).toContain("space-y-5");
	expect(memberPanel).toContain("space-y-5");
	expect(qrPanel).toContain("break-all");
	expect(qrPanel).toContain("size-[min(256px,70vw)]");
});
```

- [ ] **Step 2: Run panel polish test to verify it fails**

Run:

```bash
pnpm --dir apps/webapp test src/components/organization/invite-code-management.test.tsx
```

Expected: FAIL because panel polish classes are not present yet.

- [ ] **Step 3: Update invite code dialog body spacing**

In `apps/webapp/src/components/organization/invite-code-dialog.tsx`, change:

```tsx
<ActionPanelBody className="grid gap-4">
```

to:

```tsx
<ActionPanelBody className="space-y-5">
```

Change the code input row from:

```tsx
<div className="flex gap-2">
```

to:

```tsx
<div className="flex flex-col gap-2 sm:flex-row">
```

Change the code input class from:

```tsx
className="uppercase"
```

to:

```tsx
className="font-mono uppercase tracking-[0.18em]"
```

Add `className="w-full sm:w-auto"` to the generate button.

Replace the requires-approval helper class:

```tsx
className="text-sm text-muted-foreground -mt-2"
```

with:

```tsx
className="text-sm text-muted-foreground"
```

- [ ] **Step 4: Update invite member panel spacing**

In `apps/webapp/src/components/organization/invite-member-dialog.tsx`, change:

```tsx
<ActionPanelBody className="space-y-4">
```

to:

```tsx
<ActionPanelBody className="space-y-5">
```

- [ ] **Step 5: Update QR URL and preview responsiveness**

In `apps/webapp/src/components/organization/invite-code-qr-dialog.tsx`, change the URL display from:

```tsx
<div className="text-sm text-muted-foreground truncate mt-1">{joinUrl}</div>
```

to:

```tsx
<div className="mt-1 break-all text-sm text-muted-foreground">{joinUrl}</div>
```

Change both QR preview containers from:

```tsx
<div className="flex items-center justify-center min-h-[256px] bg-white rounded-lg p-4">
```

to:

```tsx
<div className="flex min-h-[220px] items-center justify-center rounded-lg bg-white p-4">
```

Change the PNG image class from:

```tsx
className="max-w-full"
```

to:

```tsx
className="size-[min(256px,70vw)]"
```

Change the SVG image class from:

```tsx
className="max-w-full h-auto"
```

to:

```tsx
className="size-[min(256px,70vw)]"
```

- [ ] **Step 6: Run panel polish test to verify it passes**

Run:

```bash
pnpm --dir apps/webapp test src/components/organization/invite-code-management.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit panel polish**

Run:

```bash
git add apps/webapp/src/components/organization/invite-code-dialog.tsx apps/webapp/src/components/organization/invite-member-dialog.tsx apps/webapp/src/components/organization/invite-code-qr-dialog.tsx apps/webapp/src/components/organization/invite-code-management.test.tsx
git commit -m "fix: polish invite panels on mobile"
```

Expected: commit succeeds with only invite panel files and the invite management test staged.

---

### Task 6: Final Verification

**Files:**
- Review changed files only.
- No new files.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
pnpm --dir apps/webapp test src/components/auth-form-wrapper.test.tsx src/components/ui/action-panel.test.tsx src/components/join-organization-form.test.tsx src/components/organization/invite-code-management.test.tsx
```

Expected: PASS for all four test files.

- [ ] **Step 2: Run full webapp tests**

Run:

```bash
pnpm --dir apps/webapp test
```

Expected: PASS. If unrelated existing tests fail, capture the failing test names and error text before deciding whether the failures are related to these UI changes.

- [ ] **Step 3: Inspect git diff for scope**

Run:

```bash
git diff --stat
```

Expected: only auth layout, auth wrapper, action panel, join organization form, invite organization components, and the new focused tests are changed.

- [ ] **Step 4: Commit verification-only fixes when files changed during verification**

If formatter or tests required final code fixes, run:

```bash
git add apps/webapp/src/app/[locale]/\(auth\)/layout.tsx apps/webapp/src/components/auth-form-wrapper.tsx apps/webapp/src/components/auth-form-wrapper.test.tsx apps/webapp/src/components/ui/action-panel.tsx apps/webapp/src/components/ui/action-panel.test.tsx apps/webapp/src/components/join-organization-form.tsx apps/webapp/src/components/join-organization-form.test.tsx apps/webapp/src/components/organization/invite-code-management.tsx apps/webapp/src/components/organization/invite-code-management.test.tsx apps/webapp/src/components/organization/invite-code-dialog.tsx apps/webapp/src/components/organization/invite-member-dialog.tsx apps/webapp/src/components/organization/invite-code-qr-dialog.tsx
git commit -m "fix: complete auth invite mobile ux polish"
```

Expected: commit succeeds only when there are final fixes. If there are no changes, do not create an empty commit.

## Self-Review

- Spec coverage: covered auth mobile shell, auth wrapper, join-code states, invite management desktop/table plus mobile/cards, create/edit panel, invite member panel, QR panel, shared action panel behavior, error/status visibility, and verification.
- Placeholder scan: the plan contains concrete file paths, commands, code snippets, and expected results for every task.
- Type consistency: new local mobile card uses existing `InviteCodeWithRelations`, existing `useTranslate`, and existing handler signatures from `InviteCodeManagement`.
