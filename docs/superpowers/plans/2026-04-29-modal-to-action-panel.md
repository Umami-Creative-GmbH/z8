# Modal To Action Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ordinary webapp feature modals with a consistent right-side `ActionPanel` while preserving true blocking `AlertDialog` confirmations.

**Architecture:** Add `ActionPanel` as a product-level shell that composes the existing Radix-based `Sheet` primitive. Migrate feature workflows from `Dialog` to `ActionPanel` in batches, keeping form state, submit handlers, validation, permissions, and organization scoping unchanged.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, Radix Dialog via existing `Sheet`, Vitest, Testing Library, pnpm.

---

## File Structure

- Create: `apps/webapp/src/components/ui/action-panel.tsx` exports the new right-side workflow panel API.
- Create: `apps/webapp/src/components/ui/action-panel.test.tsx` verifies the primitive renders accessible title/description, width variants, body/footer slots, and optional close button behavior.
- Modify: feature files currently importing from `@/components/ui/dialog`, except `apps/webapp/src/components/ui/command.tsx`, which remains on `Dialog` because it is a command-palette primitive rather than a product workflow.
- Review only: files importing from `@/components/ui/alert-dialog`; keep them unless the implementation pass proves the usage is not a blocking confirmation.

## Migration Inventory

Convert these `Dialog` imports to `ActionPanel` unless a file-level inspection shows command-palette or blocking-confirmation semantics:

- `apps/webapp/src/components/absences/request-absence-dialog.tsx`
- `apps/webapp/src/components/approvals/approval-action-dialog.tsx`
- `apps/webapp/src/components/calendar/split-work-period-dialog.tsx`
- `apps/webapp/src/components/calendar/work-period-edit-dialog.tsx`
- `apps/webapp/src/components/enterprise/api-key-create-dialog.tsx`
- `apps/webapp/src/components/enterprise/api-key-edit-dialog.tsx`
- `apps/webapp/src/components/enterprise/api-key-show-dialog.tsx`
- `apps/webapp/src/components/notifications/push-permission-modal.tsx`
- `apps/webapp/src/components/organization/create-organization-dialog.tsx`
- `apps/webapp/src/components/organization/create-team-dialog.tsx`
- `apps/webapp/src/components/organization/edit-organization-dialog.tsx`
- `apps/webapp/src/components/organization/edit-team-dialog.tsx`
- `apps/webapp/src/components/organization/invite-code-dialog.tsx`
- `apps/webapp/src/components/organization/invite-code-qr-dialog.tsx`
- `apps/webapp/src/components/organization/invite-member-dialog.tsx`
- `apps/webapp/src/components/organization/team-members-dialog.tsx`
- `apps/webapp/src/components/scheduling/scheduler/publish-compliance-dialog.tsx`
- `apps/webapp/src/components/scheduling/shifts/shift-dialog.tsx`
- `apps/webapp/src/components/scheduling/shifts/shift-dialog-sections.tsx`
- `apps/webapp/src/components/settings/assignment-dialog.tsx`
- `apps/webapp/src/components/settings/audit-export/audit-packages-table.tsx`
- `apps/webapp/src/components/settings/audit-export/key-management.tsx`
- `apps/webapp/src/components/settings/audit-log-viewer.tsx`
- `apps/webapp/src/components/settings/category-dialog.tsx`
- `apps/webapp/src/components/settings/change-policy-assignment-dialog.tsx`
- `apps/webapp/src/components/settings/change-policy-dialog.tsx`
- `apps/webapp/src/components/settings/coverage-rule-dialog.tsx`
- `apps/webapp/src/components/settings/custom-roles/custom-roles-management.tsx`
- `apps/webapp/src/components/settings/custom-roles/employee-custom-roles-card.tsx`
- `apps/webapp/src/components/settings/customer-dialog.tsx`
- `apps/webapp/src/components/settings/employee-skills-card.tsx`
- `apps/webapp/src/components/settings/enterprise/domain-add-dialog.tsx`
- `apps/webapp/src/components/settings/enterprise/domain-auth-config-dialog.tsx`
- `apps/webapp/src/components/settings/enterprise/domain-verification-dialog.tsx`
- `apps/webapp/src/components/settings/enterprise/social-oauth-dialog.tsx`
- `apps/webapp/src/components/settings/enterprise/sso-provider-dialog.tsx`
- `apps/webapp/src/components/settings/holiday-assignment-dialog.tsx`
- `apps/webapp/src/components/settings/holiday-dialog.tsx`
- `apps/webapp/src/components/settings/holiday-import-dialog.tsx`
- `apps/webapp/src/components/settings/location-dialog.tsx`
- `apps/webapp/src/components/settings/location-employee-dialog.tsx`
- `apps/webapp/src/components/settings/payroll-export/wage-type-mappings.tsx`
- `apps/webapp/src/components/settings/preset-dialog.tsx`
- `apps/webapp/src/components/settings/project-dialog.tsx`
- `apps/webapp/src/components/settings/rate-history-card.tsx`
- `apps/webapp/src/components/settings/scheduled-exports/execution-history-dialog.tsx`
- `apps/webapp/src/components/settings/scheduled-exports/scheduled-export-dialog.tsx`
- `apps/webapp/src/components/settings/shift-template-management.tsx`
- `apps/webapp/src/components/settings/skill-catalog-management.tsx`
- `apps/webapp/src/components/settings/subarea-dialog.tsx`
- `apps/webapp/src/components/settings/subarea-employee-dialog.tsx`
- `apps/webapp/src/components/settings/surcharge-assignment-dialog.tsx`
- `apps/webapp/src/components/settings/surcharge-model-dialog.tsx`
- `apps/webapp/src/components/settings/travel-expense-policy-dialog.tsx`
- `apps/webapp/src/components/settings/two-factor-setup.tsx`
- `apps/webapp/src/components/settings/vacation-assignment-dialog.tsx`
- `apps/webapp/src/components/settings/vacation-policy-form.tsx`
- `apps/webapp/src/components/settings/work-category-assignment-dialog.tsx`
- `apps/webapp/src/components/settings/work-category-dialog.tsx`
- `apps/webapp/src/components/settings/work-category-set-dialog.tsx`
- `apps/webapp/src/components/settings/work-policy-assignment-dialog.tsx`
- `apps/webapp/src/components/settings/work-policy-compliance-view.tsx`
- `apps/webapp/src/components/settings/work-policy-dialog.tsx`
- `apps/webapp/src/components/time-tracking/manual-time-entry-dialog.tsx`
- `apps/webapp/src/components/time-tracking/time-correction-dialog.tsx`
- `apps/webapp/src/components/travel-expenses/travel-expense-claim-dialog.tsx`
- `apps/webapp/src/components/travel-expenses/travel-expense-decision-dialog.tsx`
- `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog.tsx`
- `apps/webapp/src/components/webhooks/webhook-form-dialog.tsx`
- `apps/webapp/src/components/webhooks/webhook-secret-dialog.tsx`
- `apps/webapp/src/app/[locale]/(admin)/platform-admin/organizations/page.tsx`
- `apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.tsx`
- `apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/permissions/page-sections.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/teams/[teamId]/page-sections.tsx`

Keep this file on `Dialog`:

- `apps/webapp/src/components/ui/command.tsx`

---

### Task 1: Add `ActionPanel` Primitive

**Files:**
- Create: `apps/webapp/src/components/ui/action-panel.tsx`
- Create: `apps/webapp/src/components/ui/action-panel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/webapp/src/components/ui/action-panel.test.tsx`:

```tsx
/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "./action-panel";

describe("ActionPanel", () => {
	it("renders an accessible right-side panel shell", () => {
		render(
			<ActionPanel open>
				<ActionPanelContent>
					<ActionPanelHeader>
						<ActionPanelTitle>Panel title</ActionPanelTitle>
						<ActionPanelDescription>Panel description</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody>Panel body</ActionPanelBody>
					<ActionPanelFooter>Panel footer</ActionPanelFooter>
				</ActionPanelContent>
			</ActionPanel>,
		);

		expect(screen.getByRole("dialog", { name: "Panel title" })).toBeTruthy();
		expect(screen.getByText("Panel description")).toBeTruthy();
		expect(screen.getByText("Panel body")).toBeTruthy();
		expect(screen.getByText("Panel footer")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
	});

	it("supports width variants", () => {
		const { rerender } = render(
			<ActionPanel open>
				<ActionPanelContent size="compact">
					<ActionPanelTitle>Compact panel</ActionPanelTitle>
				</ActionPanelContent>
			</ActionPanel>,
		);

		expect(screen.getByRole("dialog", { name: "Compact panel" }).className).toContain("sm:max-w-md");

		rerender(
			<ActionPanel open>
				<ActionPanelContent size="wide">
					<ActionPanelTitle>Wide panel</ActionPanelTitle>
				</ActionPanelContent>
			</ActionPanel>,
		);

		expect(screen.getByRole("dialog", { name: "Wide panel" }).className).toContain("lg:max-w-3xl");
	});

	it("can hide the close button", () => {
		render(
			<ActionPanel open>
				<ActionPanelContent showCloseButton={false}>
					<ActionPanelTitle>No close panel</ActionPanelTitle>
				</ActionPanelContent>
			</ActionPanel>,
		);

		expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
	});
});
```

- [ ] **Step 2: Run the failing tests**

Run: `pnpm --dir apps/webapp vitest run src/components/ui/action-panel.test.tsx`

Expected: FAIL because `./action-panel` does not exist.

- [ ] **Step 3: Implement the primitive**

Create `apps/webapp/src/components/ui/action-panel.tsx`:

```tsx
"use client";

import type * as React from "react";

import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const actionPanelSizes = {
	compact: "sm:max-w-md",
	default: "sm:max-w-xl",
	wide: "sm:max-w-2xl lg:max-w-3xl",
} as const;

type ActionPanelSize = keyof typeof actionPanelSizes;

function ActionPanel({ ...props }: React.ComponentProps<typeof Sheet>) {
	return <Sheet data-slot="action-panel" {...props} />;
}

function ActionPanelTrigger({ ...props }: React.ComponentProps<typeof SheetTrigger>) {
	return <SheetTrigger data-slot="action-panel-trigger" {...props} />;
}

function ActionPanelClose({ ...props }: React.ComponentProps<typeof SheetClose>) {
	return <SheetClose data-slot="action-panel-close" {...props} />;
}

function ActionPanelContent({
	className,
	children,
	size = "default",
	showCloseButton = true,
	...props
}: React.ComponentProps<typeof SheetContent> & {
	size?: ActionPanelSize;
	showCloseButton?: boolean;
}) {
	return (
		<SheetContent
			className={cn(
				"w-[calc(100vw-1rem)] gap-0 overflow-hidden p-0 sm:w-3/4",
				actionPanelSizes[size],
				className,
			)}
			data-slot="action-panel-content"
			side="right"
			{...props}
		>
			{children}
			{showCloseButton && (
				<SheetClose className="absolute right-4 top-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
					<XIcon className="size-4" />
					<span className="sr-only">Close</span>
				</SheetClose>
			)}
		</SheetContent>
	);
}

function ActionPanelHeader({ className, ...props }: React.ComponentProps<typeof SheetHeader>) {
	return (
		<SheetHeader
			className={cn("border-b px-6 py-5 pr-12 text-left", className)}
			data-slot="action-panel-header"
			{...props}
		/>
	);
}

function ActionPanelBody({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-5", className)}
			data-slot="action-panel-body"
			{...props}
		/>
	);
}

function ActionPanelFooter({ className, ...props }: React.ComponentProps<typeof SheetFooter>) {
	return (
		<SheetFooter
			className={cn("mt-0 border-t px-6 py-4 sm:flex-row sm:justify-end", className)}
			data-slot="action-panel-footer"
			{...props}
		/>
	);
}

function ActionPanelTitle({ className, ...props }: React.ComponentProps<typeof SheetTitle>) {
	return (
		<SheetTitle
			className={cn("text-lg font-semibold leading-none", className)}
			data-slot="action-panel-title"
			{...props}
		/>
	);
}

function ActionPanelDescription({
	className,
	...props
}: React.ComponentProps<typeof SheetDescription>) {
	return (
		<SheetDescription
			className={cn("text-sm text-muted-foreground", className)}
			data-slot="action-panel-description"
			{...props}
		/>
	);
}

export {
	ActionPanel,
	ActionPanelBody,
	ActionPanelClose,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
	ActionPanelTrigger,
};
```

- [ ] **Step 4: Run the primitive tests**

Run: `pnpm --dir apps/webapp vitest run src/components/ui/action-panel.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the primitive**

Run:

```bash
git add apps/webapp/src/components/ui/action-panel.tsx apps/webapp/src/components/ui/action-panel.test.tsx
git commit -m "feat: add action panel primitive"
```

Expected: commit succeeds.

---

### Task 2: Migrate Tested Workflow Dialogs First

**Files:**
- Modify: `apps/webapp/src/components/absences/request-absence-dialog.tsx`
- Modify: `apps/webapp/src/components/settings/holiday-dialog.tsx`
- Modify: `apps/webapp/src/components/settings/travel-expense-policy-dialog.tsx`
- Modify: `apps/webapp/src/components/scheduling/shifts/shift-dialog.tsx`
- Modify: `apps/webapp/src/components/scheduling/shifts/shift-dialog-sections.tsx`
- Modify: `apps/webapp/src/components/travel-expenses/travel-expense-claim-dialog.tsx`
- Test: existing tests beside these components.

- [ ] **Step 1: Run current tests before migration**

Run: `pnpm --dir apps/webapp vitest run src/components/absences/request-absence-dialog.test.tsx src/components/settings/holiday-dialog.test.tsx src/components/settings/travel-expense-policy-dialog.test.tsx src/components/scheduling/shifts/shift-dialog.test.tsx src/components/travel-expenses/travel-expense-claim-dialog.test.tsx`

Expected: all existing tests either PASS or reveal unrelated baseline failures before changes.

- [ ] **Step 2: Replace imports in each tested workflow file**

Use this replacement pattern in each file:

```tsx
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelClose,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
	ActionPanelTrigger,
} from "@/components/ui/action-panel";
```

Remove the corresponding `Dialog`, `DialogClose`, `DialogContent`, `DialogDescription`, `DialogFooter`, `DialogHeader`, `DialogTitle`, and `DialogTrigger` imports from `@/components/ui/dialog`.

- [ ] **Step 3: Replace JSX tags in the tested workflow files**

Apply these exact tag replacements in the six files:

```tsx
<Dialog open={open} onOpenChange={onOpenChange}>
```

becomes:

```tsx
<ActionPanel open={open} onOpenChange={onOpenChange}>
```

```tsx
<Dialog open={open} onOpenChange={handleOpenChange}>
```

becomes:

```tsx
<ActionPanel open={open} onOpenChange={handleOpenChange}>
```

```tsx
<DialogTrigger asChild>
```

becomes:

```tsx
<ActionPanelTrigger asChild>
```

```tsx
<DialogClose asChild>
```

becomes:

```tsx
<ActionPanelClose asChild>
```

```tsx
<DialogContent className="sm:max-w-md">
```

becomes:

```tsx
<ActionPanelContent size="compact">
```

```tsx
<DialogContent className="sm:max-w-[520px]">
```

becomes:

```tsx
<ActionPanelContent>
```

```tsx
<DialogContent className="sm:max-w-[560px]">
```

becomes:

```tsx
<ActionPanelContent>
```

```tsx
<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
```

becomes:

```tsx
<ActionPanelContent size="wide">
```

```tsx
<DialogHeader>
```

becomes:

```tsx
<ActionPanelHeader>
```

```tsx
<DialogTitle>
```

becomes:

```tsx
<ActionPanelTitle>
```

```tsx
<DialogDescription>
```

becomes:

```tsx
<ActionPanelDescription>
```

```tsx
<DialogFooter>
```

becomes:

```tsx
<ActionPanelFooter>
```

Apply matching closing tag replacements, for example `</DialogContent>` becomes `</ActionPanelContent>` and `</Dialog>` becomes `</ActionPanel>`.

- [ ] **Step 4: Add body wrappers where forms are long**

For `holiday-dialog.tsx`, `shift-dialog.tsx`, and `travel-expense-claim-dialog.tsx`, wrap the content between the header and footer with `ActionPanelBody`. In `holiday-dialog.tsx`, the target structure starts like this and then continues with the current `form.Field` blocks unchanged:

```tsx
<ActionPanel open={open} onOpenChange={onOpenChange}>
	<ActionPanelContent size="wide">
		<ActionPanelHeader>
			<ActionPanelTitle>
				{isEditing
					? t("settings.holidays.edit", "Edit Holiday")
					: t("settings.holidays.add", "Add Holiday")}
			</ActionPanelTitle>
			<ActionPanelDescription>
				{t(
					"settings.holidays.form.description",
					"Create or update a holiday for your organization",
				)}
			</ActionPanelDescription>
		</ActionPanelHeader>
		<form
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
			className="flex min-h-0 flex-1 flex-col"
		>
			<ActionPanelBody className="space-y-4">
```

In the same file, move the current footer out of the scroll body so the target ending is:

```tsx
			</ActionPanelBody>
			<ActionPanelFooter>
				<Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
					{t("common.cancel", "Cancel")}
				</Button>
				<Button type="submit" disabled={loading}>
					{loading && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
					{isEditing ? t("common.save", "Save") : t("common.create", "Create")}
				</Button>
			</ActionPanelFooter>
		</form>
	</ActionPanelContent>
</ActionPanel>
```

- [ ] **Step 5: Run tested workflow tests**

Run: `pnpm --dir apps/webapp vitest run src/components/absences/request-absence-dialog.test.tsx src/components/settings/holiday-dialog.test.tsx src/components/settings/travel-expense-policy-dialog.test.tsx src/components/scheduling/shifts/shift-dialog.test.tsx src/components/travel-expenses/travel-expense-claim-dialog.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit tested workflow migration**

Run:

```bash
git add apps/webapp/src/components/absences/request-absence-dialog.tsx apps/webapp/src/components/settings/holiday-dialog.tsx apps/webapp/src/components/settings/travel-expense-policy-dialog.tsx apps/webapp/src/components/scheduling/shifts/shift-dialog.tsx apps/webapp/src/components/scheduling/shifts/shift-dialog-sections.tsx apps/webapp/src/components/travel-expenses/travel-expense-claim-dialog.tsx
git commit -m "refactor: migrate tested dialogs to action panels"
```

Expected: commit succeeds.

---

### Task 3: Migrate Remaining Feature Dialogs In Batches

**Files:**
- Modify: every remaining file in the Migration Inventory except `apps/webapp/src/components/ui/command.tsx` and files already committed in Task 2.

- [ ] **Step 1: Confirm remaining imports**

Run: `rg 'from "@/components/ui/dialog"|from '\''@/components/ui/dialog'\''' apps/webapp/src`

Expected: output includes remaining feature files and `apps/webapp/src/components/ui/command.tsx`.

- [ ] **Step 2: Apply the standard import replacement**

For each remaining feature file, replace dialog imports with the smallest needed subset from `@/components/ui/action-panel`. Use this exact import form when all parts are needed:

```tsx
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelClose,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
	ActionPanelTrigger,
} from "@/components/ui/action-panel";
```

If a file only imports `DialogFooter`, such as `shift-dialog-sections.tsx`, replace it with:

```tsx
import { ActionPanelFooter } from "@/components/ui/action-panel";
```

- [ ] **Step 3: Apply the standard JSX replacement**

Use these exact replacements in remaining files:

```tsx
Dialog -> ActionPanel
DialogTrigger -> ActionPanelTrigger
DialogClose -> ActionPanelClose
DialogContent -> ActionPanelContent
DialogHeader -> ActionPanelHeader
DialogTitle -> ActionPanelTitle
DialogDescription -> ActionPanelDescription
DialogFooter -> ActionPanelFooter
```

Preserve existing props except sizing-only classes on `DialogContent`. Convert sizing classes as follows:

```tsx
className="sm:max-w-md" -> size="compact"
className="sm:max-w-lg" -> no size prop
className="sm:max-w-[500px]" -> no size prop
className="sm:max-w-[520px]" -> no size prop
className="sm:max-w-[560px]" -> no size prop
className="max-w-2xl" -> size="wide"
className="sm:max-w-2xl" -> size="wide"
className="max-w-3xl" -> size="wide"
className="sm:max-w-3xl" -> size="wide"
```

Preserve non-sizing classes by keeping `className`. Example:

```tsx
<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
```

becomes:

```tsx
<ActionPanelContent className="max-h-[90vh] overflow-y-auto" size="wide">
```

- [ ] **Step 4: Use `ActionPanelBody` for long content**

For files where the existing `DialogContent` uses `max-h`, `overflow-y-auto`, `max-w-2xl`, `max-w-3xl`, `sm:max-w-2xl`, `sm:max-w-3xl`, or contains `DialogFooter`, place the middle content in `ActionPanelBody` while keeping the header and footer outside it. Keep the current title JSX inside `ActionPanelTitle`, current description JSX inside `ActionPanelDescription`, current field/detail/log JSX inside `ActionPanelBody`, and current submit/cancel JSX inside `ActionPanelFooter`. Do not change server actions, query hooks, form schemas, organization filters, CASL checks, or submit functions.

- [ ] **Step 5: Keep `ui/command.tsx` on Dialog**

Confirm `apps/webapp/src/components/ui/command.tsx` still imports from `@/components/ui/dialog`:

```tsx
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
```

Expected: this file remains unchanged unless compilation requires import formatting.

- [ ] **Step 6: Run TypeScript/build check for migrated code**

Run: `pnpm --dir apps/webapp build`

Expected: PASS, or FAIL only for unrelated environment/Phase CLI limitations. If it fails because environment variables are unavailable to agents, record the missing variables and continue with targeted tests and static import checks.

- [ ] **Step 7: Commit remaining migration**

Run:

```bash
git add apps/webapp/src
git commit -m "refactor: migrate feature modals to action panels"
```

Expected: commit succeeds. Confirm the staged files do not include unrelated user changes before committing.

---

### Task 4: Review `AlertDialog` Usage And Remaining `Dialog` Imports

**Files:**
- Review: all files importing `@/components/ui/alert-dialog`.
- Review: any remaining files importing `@/components/ui/dialog`.

- [ ] **Step 1: Check remaining `Dialog` imports**

Run: `rg 'from "@/components/ui/dialog"|from '\''@/components/ui/dialog'\''' apps/webapp/src`

Expected: only `apps/webapp/src/components/ui/command.tsx` remains, unless a feature file has a documented centered-dialog reason.

- [ ] **Step 2: Check `AlertDialog` imports**

Run: `rg 'from "@/components/ui/alert-dialog"|from '\''@/components/ui/alert-dialog'\''' apps/webapp/src`

Expected: each result is a blocking confirmation, destructive action, credential reset, disconnect, delete, revoke, or explicit run-now confirmation.

- [ ] **Step 3: Convert any non-blocking `AlertDialog` found during review**

If review finds a non-blocking workflow using `AlertDialog`, convert that file using this exact import shape:

```tsx
import {
	ActionPanel,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
```

Replace `AlertDialog` shell tags with `ActionPanel` shell tags, replace `AlertDialogContent` with `ActionPanelContent`, replace `AlertDialogHeader` with `ActionPanelHeader`, replace `AlertDialogTitle` with `ActionPanelTitle`, replace `AlertDialogDescription` with `ActionPanelDescription`, and replace `AlertDialogFooter` with `ActionPanelFooter`. Replace `AlertDialogCancel` with the existing button component already used in the file or keep the existing cancel button if present. Do not convert delete, revoke, disconnect, or irreversible confirmations.

- [ ] **Step 4: Commit review changes if any**

If Step 3 changed files, run:

```bash
git add apps/webapp/src
git commit -m "refactor: keep blocking confirmations as alert dialogs"
```

Expected: commit succeeds. If no files changed in Step 3, skip this commit.

---

### Task 5: Final Verification

**Files:**
- Verify: `apps/webapp/src/components/ui/action-panel.tsx`
- Verify: migrated feature files.

- [ ] **Step 1: Run targeted tests**

Run: `pnpm --dir apps/webapp vitest run src/components/ui/action-panel.test.tsx src/components/absences/request-absence-dialog.test.tsx src/components/settings/holiday-dialog.test.tsx src/components/settings/travel-expense-policy-dialog.test.tsx src/components/scheduling/shifts/shift-dialog.test.tsx src/components/travel-expenses/travel-expense-claim-dialog.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run full webapp tests**

Run: `pnpm --dir apps/webapp test`

Expected: PASS, or known unrelated failures documented with file names and error messages.

- [ ] **Step 3: Run production build**

Run: `pnpm --dir apps/webapp build`

Expected: PASS, or environment-variable failure documented as skipped because Phase CLI variables are unavailable to agents.

- [ ] **Step 4: Browser spot-check representative flows**

Run: `pnpm dev:webapp`

Open the app in a browser and verify these representative interactions if local auth/session data is available:

```text
Short form: manual time entry opens from the right and closes with Escape and close button.
Long form: holiday or work policy editor scrolls body content while footer actions remain reachable.
Detail/log panel: webhook delivery logs open from the right with readable content.
Blocking confirmation: one delete confirmation still opens as AlertDialog and requires explicit cancel/confirm.
Mobile width: at a narrow viewport, the action panel remains usable and nearly full width.
```

Expected: interactions match the design. If auth or environment prevents browser access, document the blocker and rely on tests, build, and static checks.

- [ ] **Step 5: Final static checks**

Run: `rg '<Dialog|DialogContent|DialogHeader|DialogFooter|DialogTitle|DialogDescription' apps/webapp/src`

Expected: matches only in `apps/webapp/src/components/ui/dialog.tsx`, `apps/webapp/src/components/ui/command.tsx`, and any explicitly documented remaining centered-dialog exception.

Run: `rg 'ActionPanelContent className="[^"]*max-w|ActionPanelContent className="[^"]*sm:max-w' apps/webapp/src`

Expected: no matches; width should come from `size` variants unless a documented exception requires a one-off width.

- [ ] **Step 6: Final commit**

Run:

```bash
git status --short
git add apps/webapp/src docs/superpowers/plans/2026-04-29-modal-to-action-panel.md
git commit -m "docs: plan modal action panel migration"
```

Expected: commit includes this plan if it has not been committed yet. Do not stage unrelated user changes shown by `git status --short`.

## Self-Review

Spec coverage:

- `ActionPanel` composed from `Sheet`: Task 1.
- Right-side default, sizing variants, body/footer/header layout: Task 1.
- Convert feature `Dialog` workflows: Tasks 2 and 3.
- Preserve `AlertDialog` for blocking confirmations: Task 4.
- Preserve `Popover`: no plan task touches popover imports.
- Verify with tests, static search, build, and browser spot checks: Task 5.

Placeholder scan: no placeholders are intentionally left in this plan.

Type consistency: exported names in Task 1 match migration names in Tasks 2 through 5.
