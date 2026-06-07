# Radix to Base UI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Radix from `apps/webapp` by migrating the shared UI wrapper layer to Base UI while preserving product-screen imports and behavior.

**Architecture:** Convert Radix-backed components inside `apps/webapp/src/components/ui/*` to Base UI or small local React composition helpers. Product code should continue importing Z8 wrappers from `@/components/ui/*`; broad screen-level rewrites are not part of the migration. Keep Radix installed while wrappers are converted, then remove Radix dependencies only after source guards and tests prove there are no active Radix imports.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS v4, shadcn-style UI wrappers, Base UI `@base-ui/react`, Vitest, pnpm.

---

## Pre-Implementation Notes

Do not edit unrelated dirty files. The workspace had unrelated changes before this plan was written.

Use pnpm only.

Do not commit unless the user explicitly requests commits. The plan includes checkpoint points instead of mandatory commits to respect the workspace rule.

Read these before implementation:

- `docs/superpowers/specs/2026-06-06-radix-to-base-ui-migration-design.md`
- `docs/refs/agent-workflow.md`
- `docs/refs/project-conventions.md`
- `docs/refs/design-context.md`
- `https://base-ui.com/llms.txt`

## File Map

Primary files to modify:

- `apps/webapp/package.json`: add `@base-ui/react`, remove Radix dependencies at the end.
- `pnpm-lock.yaml`: dependency graph updates from pnpm.
- `apps/webapp/src/app/globals.css`: replace Radix animation CSS variables with Base UI variables.
- `apps/webapp/src/components/ui/slot.tsx`: local non-Radix slot composition helper for non-Base wrappers.
- `apps/webapp/src/components/ui/*.tsx`: migrate Radix-backed wrappers to Base UI or local slot helper.
- `apps/webapp/src/data/licenses.json`: regenerate after final dependency removal.

Source guard tests to create or update:

- `apps/webapp/src/components/ui/radix-source-guard.test.ts`: proves active UI source no longer imports Radix.
- `apps/webapp/src/components/ui/base-ui-wrapper-source.test.ts`: protects the migration conventions after completion.

Focused wrapper tests to add when behavior is not already covered:

- `apps/webapp/src/components/ui/slot.test.tsx`
- `apps/webapp/src/components/ui/dialog.test.tsx`
- `apps/webapp/src/components/ui/sheet.test.tsx`
- `apps/webapp/src/components/ui/dropdown-menu.test.tsx`
- `apps/webapp/src/components/ui/select.test.tsx`
- `apps/webapp/src/components/ui/tooltip.test.tsx`

## Component Mapping

Use this mapping during wrapper conversion:

| Current wrapper | Base UI target |
| --- | --- |
| `accordion` | `@base-ui/react/accordion` |
| `alert-dialog` | `@base-ui/react/alert-dialog` |
| `aspect-ratio` | native wrapper or `@base-ui/react` equivalent if available in installed version |
| `avatar` | `@base-ui/react/avatar` |
| `checkbox` | `@base-ui/react/checkbox` |
| `collapsible` | `@base-ui/react/collapsible` |
| `context-menu` | `@base-ui/react/context-menu` |
| `dialog` | `@base-ui/react/dialog` |
| `dropdown-menu` | `@base-ui/react/menu` |
| `hover-card` | `@base-ui/react/preview-card` |
| `label` | `@base-ui/react/field` label or native `label` wrapper where simpler |
| `menubar` | `@base-ui/react/menubar` |
| `navigation-menu` | `@base-ui/react/navigation-menu` |
| `popover` | `@base-ui/react/popover` |
| `progress` | `@base-ui/react/progress` |
| `radio-group` | `@base-ui/react/radio-group` and `@base-ui/react/radio` |
| `scroll-area` | `@base-ui/react/scroll-area` |
| `select` | `@base-ui/react/select` |
| `separator` | `@base-ui/react/separator` |
| `sheet` | `@base-ui/react/dialog` with side-positioned styling |
| `slider` | `@base-ui/react/slider` |
| `switch` | `@base-ui/react/switch` |
| `tabs` | `@base-ui/react/tabs` |
| `toggle` | `@base-ui/react/toggle` |
| `toggle-group` | `@base-ui/react/toggle-group` |
| `tooltip` | `@base-ui/react/tooltip` |
| `button`, `badge`, `breadcrumb`, `button-group`, `item`, `sidebar`, `tanstack-form` | local `slot.tsx` helper or direct native elements |

## Base UI Styling Mapping

Use these replacements while editing wrapper class strings:

| Radix state or variable | Base UI replacement |
| --- | --- |
| `data-[state=open]` on popups | `data-starting-style`, `data-ending-style`, `data-popup-open` depending on part |
| `data-[state=closed]` | `data-ending-style` |
| `data-[state=checked]` | `data-checked` |
| `data-[state=unchecked]` | `data-unchecked` |
| menu item `focus:` highlight | `data-highlighted:` |
| `--radix-accordion-content-height` | `--accordion-panel-height` |
| `--radix-collapsible-content-height` | `--collapsible-panel-height` |
| `--radix-select-trigger-width` | `--anchor-width` |
| `--radix-select-content-available-height` | `--available-height` |
| `--radix-dropdown-menu-content-transform-origin` | `--transform-origin` |
| `--radix-tooltip-content-transform-origin` | `--transform-origin` |

## Task 1: Add Base UI And Guard The Migration

**Files:**

- Modify: `apps/webapp/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/webapp/src/components/ui/radix-source-guard.test.ts`
- Create: `apps/webapp/src/components/ui/base-ui-wrapper-source.test.ts`

- [ ] **Step 1: Add Base UI dependency**

Run: `pnpm --filter webapp add @base-ui/react`

Expected: `apps/webapp/package.json` gains `@base-ui/react`, and `pnpm-lock.yaml` updates.

- [ ] **Step 2: Write the failing Radix source guard**

Create `apps/webapp/src/components/ui/radix-source-guard.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const uiDir = join(process.cwd(), "src/components/ui");

function collectSourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		const stat = statSync(path);

		if (stat.isDirectory()) {
			return collectSourceFiles(path);
		}

		return /\.(ts|tsx)$/.test(entry) ? [path] : [];
	});
}

describe("Radix source guard", () => {
	it("does not import Radix from active UI wrappers", () => {
		const offenders = collectSourceFiles(uiDir).filter((file) =>
			readFileSync(file, "utf8").includes("@radix-ui"),
		);

		expect(offenders.map((file) => relative(process.cwd(), file))).toEqual([]);
	});
});
```

- [ ] **Step 3: Run the failing guard**

Run: `pnpm --filter webapp test src/components/ui/radix-source-guard.test.ts`

Expected: FAIL with a list of existing `src/components/ui/*` Radix-backed wrappers.

- [ ] **Step 4: Add a Base UI convention guard**

Create `apps/webapp/src/components/ui/base-ui-wrapper-source.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const wrappersThatShouldUseBaseUi = [
	"accordion.tsx",
	"alert-dialog.tsx",
	"avatar.tsx",
	"checkbox.tsx",
	"collapsible.tsx",
	"context-menu.tsx",
	"dialog.tsx",
	"dropdown-menu.tsx",
	"hover-card.tsx",
	"menubar.tsx",
	"navigation-menu.tsx",
	"popover.tsx",
	"progress.tsx",
	"radio-group.tsx",
	"scroll-area.tsx",
	"select.tsx",
	"separator.tsx",
	"sheet.tsx",
	"slider.tsx",
	"switch.tsx",
	"tabs.tsx",
	"toggle.tsx",
	"toggle-group.tsx",
	"tooltip.tsx",
];

describe("Base UI wrapper conventions", () => {
	it("uses Base UI for migrated primitive wrappers", () => {
		const missing = wrappersThatShouldUseBaseUi.filter((file) => {
			const source = readFileSync(join(process.cwd(), "src/components/ui", file), "utf8");

			return !source.includes("@base-ui/react");
		});

		expect(missing).toEqual([]);
	});
});
```

- [ ] **Step 5: Run the convention guard**

Run: `pnpm --filter webapp test src/components/ui/base-ui-wrapper-source.test.ts`

Expected: FAIL until the listed primitive wrappers use Base UI.

- [ ] **Step 6: Checkpoint**

Run: `git diff -- apps/webapp/package.json pnpm-lock.yaml apps/webapp/src/components/ui/radix-source-guard.test.ts apps/webapp/src/components/ui/base-ui-wrapper-source.test.ts`

Expected: diff only contains dependency additions and the two source-guard tests.

## Task 2: Add Local Slot Compatibility

**Files:**

- Create: `apps/webapp/src/components/ui/slot.tsx`
- Create: `apps/webapp/src/components/ui/slot.test.tsx`
- Modify: `apps/webapp/src/components/ui/button.tsx`
- Modify: `apps/webapp/src/components/ui/badge.tsx`
- Modify: `apps/webapp/src/components/ui/breadcrumb.tsx`
- Modify: `apps/webapp/src/components/ui/button-group.tsx`
- Modify: `apps/webapp/src/components/ui/item.tsx`
- Modify: `apps/webapp/src/components/ui/sidebar.tsx`
- Modify: `apps/webapp/src/components/ui/tanstack-form.tsx`

- [ ] **Step 1: Write slot behavior tests**

Create `apps/webapp/src/components/ui/slot.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Slot } from "@/components/ui/slot";

describe("Slot", () => {
	it("merges class names and forwards props to the child", () => {
		render(
			<Slot className="from-slot" data-slot="button">
				<a href="/settings" className="from-child">
					Settings
				</a>
			</Slot>,
		);

		const link = screen.getByRole("link", { name: "Settings" });
		expect(link).toHaveAttribute("href", "/settings");
		expect(link).toHaveAttribute("data-slot", "button");
		expect(link).toHaveClass("from-child", "from-slot");
	});

	it("runs child and slot event handlers", async () => {
		const user = userEvent.setup();
		const childClick = vi.fn();
		const slotClick = vi.fn();

		render(
			<Slot onClick={slotClick}>
				<button type="button" onClick={childClick}>
					Open
				</button>
			</Slot>,
		);

		await user.click(screen.getByRole("button", { name: "Open" }));

		expect(childClick).toHaveBeenCalledTimes(1);
		expect(slotClick).toHaveBeenCalledTimes(1);
	});
});
```

- [ ] **Step 2: Run slot tests to verify failure**

Run: `pnpm --filter webapp test src/components/ui/slot.test.tsx`

Expected: FAIL because `@/components/ui/slot` does not exist.

- [ ] **Step 3: Implement the local slot helper**

Create `apps/webapp/src/components/ui/slot.tsx`:

```tsx
import { cloneElement, isValidElement } from "react";
import type * as React from "react";

import { cn } from "@/lib/utils";

type SlotProps = React.HTMLAttributes<HTMLElement> & {
	children: React.ReactElement;
};

function composeEventHandlers<E extends React.SyntheticEvent>(
	childHandler: ((event: E) => void) | undefined,
	slotHandler: ((event: E) => void) | undefined,
) {
	return (event: E) => {
		childHandler?.(event);
		slotHandler?.(event);
	};
}

function Slot({ children, className, ...slotProps }: SlotProps) {
	if (!isValidElement<Record<string, unknown>>(children)) {
		return null;
	}

	const childProps = children.props;
	const mergedProps: Record<string, unknown> = {
		...slotProps,
		...childProps,
		className: cn(childProps.className as string | undefined, className),
	};

	for (const key of Object.keys(slotProps)) {
		const slotValue = slotProps[key as keyof typeof slotProps];
		const childValue = childProps[key];

		if (/^on[A-Z]/.test(key) && typeof slotValue === "function" && typeof childValue === "function") {
			mergedProps[key] = composeEventHandlers(childValue as (event: React.SyntheticEvent) => void, slotValue as (event: React.SyntheticEvent) => void);
		}
	}

	return cloneElement(children, mergedProps);
}

export { Slot };
```

- [ ] **Step 4: Run slot tests to verify pass**

Run: `pnpm --filter webapp test src/components/ui/slot.test.tsx`

Expected: PASS.

- [ ] **Step 5: Replace Radix Slot imports**

In these files, replace `import { Slot } from "@radix-ui/react-slot";` with `import { Slot } from "@/components/ui/slot";`:

- `apps/webapp/src/components/ui/button.tsx`
- `apps/webapp/src/components/ui/badge.tsx`
- `apps/webapp/src/components/ui/breadcrumb.tsx`
- `apps/webapp/src/components/ui/button-group.tsx`
- `apps/webapp/src/components/ui/item.tsx`
- `apps/webapp/src/components/ui/sidebar.tsx`
- `apps/webapp/src/components/ui/tanstack-form.tsx`

In `apps/webapp/src/components/ui/tanstack-form.tsx`, replace the type import from Radix Label with the local `Label` component type:

```tsx
type TFormLabelProps = React.ComponentProps<typeof Label> & {
	hasError?: boolean;
	required?: boolean;
};
```

Then use `TFormLabelProps` as the `TFormLabel` props type.

- [ ] **Step 6: Run slot-dependent tests**

Run: `pnpm --filter webapp test src/components/ui/slot.test.tsx src/components/ui/tanstack-form.test.tsx src/components/ui/sidebar.test.tsx src/components/ui/button-variants.test.ts`

Expected: PASS, except failures directly caused by existing unrelated workspace changes should be captured with exact test names before continuing.

## Task 3: Migrate Simple Primitive Wrappers

**Files:**

- Modify: `apps/webapp/src/components/ui/separator.tsx`
- Modify: `apps/webapp/src/components/ui/aspect-ratio.tsx`
- Modify: `apps/webapp/src/components/ui/progress.tsx`
- Modify: `apps/webapp/src/components/ui/avatar.tsx`
- Modify: `apps/webapp/src/components/ui/label.tsx`

- [ ] **Step 1: Convert imports and anatomy**

Update each wrapper to import its Base UI primitive from `@base-ui/react/<component>`. Preserve exported names and `data-slot` attributes.

Use these import shapes:

```tsx
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
```

For `label.tsx`, use a native `label` wrapper if the current component only needs `htmlFor`, classes, and `data-slot`:

```tsx
function Label({ className, ...props }: React.ComponentProps<"label">) {
	return <label data-slot="label" className={cn("flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50", className)} {...props} />;
}
```

- [ ] **Step 2: Verify no Radix remains in simple wrappers**

Run: `rg '@radix-ui' apps/webapp/src/components/ui/separator.tsx apps/webapp/src/components/ui/aspect-ratio.tsx apps/webapp/src/components/ui/progress.tsx apps/webapp/src/components/ui/avatar.tsx apps/webapp/src/components/ui/label.tsx`

Expected: no output.

- [ ] **Step 3: Run relevant tests**

Run: `pnpm --filter webapp test src/components/ui/chart.test.tsx src/components/ui/action-panel.test.tsx`

Expected: PASS.

## Task 4: Migrate Form And Control Wrappers

**Files:**

- Modify: `apps/webapp/src/components/ui/checkbox.tsx`
- Modify: `apps/webapp/src/components/ui/radio-group.tsx`
- Modify: `apps/webapp/src/components/ui/switch.tsx`
- Modify: `apps/webapp/src/components/ui/slider.tsx`
- Modify: `apps/webapp/src/components/ui/toggle.tsx`
- Modify: `apps/webapp/src/components/ui/toggle-group.tsx`
- Modify: `apps/webapp/src/components/ui/tabs.tsx`

- [ ] **Step 1: Convert checked-state selectors**

Replace `data-[state=checked]` with `data-checked`, `data-[state=unchecked]` with `data-unchecked`, and `data-[state=on]` with the Base UI checked or pressed attribute documented for the target component.

- [ ] **Step 2: Preserve wrapper exports**

Each file must continue exporting the same public names currently imported by product code. Confirm with:

Run: `rg 'from "@/components/ui/(checkbox|radio-group|switch|slider|toggle|toggle-group|tabs)"' apps/webapp/src`

Expected: call sites should not require import path changes.

- [ ] **Step 3: Convert Base UI anatomy**

Use these target parts:

```tsx
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
```

Map indicators explicitly. For example, checkbox should render:

```tsx
<CheckboxPrimitive.Root data-slot="checkbox" className={cn("... data-checked:... data-unchecked:...", className)} {...props}>
	<CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="flex data-unchecked:hidden">
		<IconCheck className="size-3.5" />
	</CheckboxPrimitive.Indicator>
</CheckboxPrimitive.Root>
```

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter webapp test src/components/settings/payroll-access/payroll-access-form.test.tsx src/components/ui/time-input.test.tsx`

Expected: PASS.

- [ ] **Step 5: Verify converted controls do not import Radix**

Run: `rg '@radix-ui' apps/webapp/src/components/ui/checkbox.tsx apps/webapp/src/components/ui/radio-group.tsx apps/webapp/src/components/ui/switch.tsx apps/webapp/src/components/ui/slider.tsx apps/webapp/src/components/ui/toggle.tsx apps/webapp/src/components/ui/toggle-group.tsx apps/webapp/src/components/ui/tabs.tsx`

Expected: no output.

## Task 5: Migrate Disclosure Wrappers And Global CSS

**Files:**

- Modify: `apps/webapp/src/components/ui/accordion.tsx`
- Modify: `apps/webapp/src/components/ui/collapsible.tsx`
- Modify: `apps/webapp/src/app/globals.css`

- [ ] **Step 1: Convert accordion and collapsible anatomy**

Use:

```tsx
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
```

Map Radix content parts to Base UI panel parts:

- `AccordionContent` renders `AccordionPrimitive.Panel`.
- `CollapsibleContent` renders `CollapsiblePrimitive.Panel`.
- Trigger icons rotate with `data-panel-open` instead of `data-[state=open]`.

- [ ] **Step 2: Update global accordion/collapsible animation CSS**

In `apps/webapp/src/app/globals.css`, replace the Radix height variables with Base UI variables:

```css
height: var(--accordion-panel-height, var(--collapsible-panel-height));
```

Keep the existing keyframe names if product classes still reference them.

- [ ] **Step 3: Verify disclosure wrappers**

Run: `rg '@radix-ui|--radix-accordion|--radix-collapsible' apps/webapp/src/components/ui/accordion.tsx apps/webapp/src/components/ui/collapsible.tsx apps/webapp/src/app/globals.css`

Expected: no output.

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter webapp test src/components/settings/settings-nav-component.test.tsx src/components/ui/sidebar.test.tsx`

Expected: PASS.

## Task 6: Migrate Overlay Wrappers And Sheet

**Files:**

- Modify: `apps/webapp/src/components/ui/dialog.tsx`
- Modify: `apps/webapp/src/components/ui/alert-dialog.tsx`
- Modify: `apps/webapp/src/components/ui/popover.tsx`
- Modify: `apps/webapp/src/components/ui/hover-card.tsx`
- Modify: `apps/webapp/src/components/ui/tooltip.tsx`
- Modify: `apps/webapp/src/components/ui/sheet.tsx`
- Create: `apps/webapp/src/components/ui/dialog.test.tsx`
- Create: `apps/webapp/src/components/ui/sheet.test.tsx`
- Create: `apps/webapp/src/components/ui/tooltip.test.tsx`

- [ ] **Step 1: Write overlay smoke tests**

Create `apps/webapp/src/components/ui/dialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

describe("Dialog", () => {
	it("opens dialog content from the trigger", async () => {
		const user = userEvent.setup();

		render(
			<Dialog>
				<DialogTrigger>Open dialog</DialogTrigger>
				<DialogContent>
					<DialogTitle>Example dialog</DialogTitle>
				</DialogContent>
			</Dialog>,
		);

		await user.click(screen.getByRole("button", { name: "Open dialog" }));

		expect(screen.getByRole("dialog", { name: "Example dialog" })).toBeInTheDocument();
	});
});
```

Create `apps/webapp/src/components/ui/sheet.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

describe("Sheet", () => {
	it("opens side sheet content from the trigger", async () => {
		const user = userEvent.setup();

		render(
			<Sheet>
				<SheetTrigger>Open sheet</SheetTrigger>
				<SheetContent side="right">
					<SheetTitle>Details</SheetTitle>
				</SheetContent>
			</Sheet>,
		);

		await user.click(screen.getByRole("button", { name: "Open sheet" }));

		expect(screen.getByRole("dialog", { name: "Details" })).toBeInTheDocument();
	});
});
```

Create `apps/webapp/src/components/ui/tooltip.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

describe("Tooltip", () => {
	it("shows tooltip content on hover", async () => {
		const user = userEvent.setup();

		render(
			<Tooltip>
				<TooltipTrigger aria-label="Save">Save</TooltipTrigger>
				<TooltipContent>Save changes</TooltipContent>
			</Tooltip>,
		);

		await user.hover(screen.getByRole("button", { name: "Save" }));

		expect(await screen.findByText("Save changes")).toBeInTheDocument();
	});
});
```

- [ ] **Step 2: Run overlay tests to verify current pass or capture failures**

Run: `pnpm --filter webapp test src/components/ui/dialog.test.tsx src/components/ui/sheet.test.tsx src/components/ui/tooltip.test.tsx`

Expected: PASS before migration or failures caused by current Radix portal/test-environment behavior. Record exact failures and keep the tests for migrated behavior.

- [ ] **Step 3: Convert overlay imports and anatomy**

Use these imports:

```tsx
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { PreviewCard as HoverCardPrimitive } from "@base-ui/react/preview-card";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
```

Map dialog parts:

- `Overlay` becomes `Backdrop`.
- `Content` becomes `Popup`.
- Keep `Portal`, `Trigger`, `Close`, `Title`, and `Description` exported names.
- Convert animation selectors to `data-starting-style` and `data-ending-style`.

Map popover and tooltip parts:

- Wrap popup parts with `Positioner` inside `Portal`.
- Use `--transform-origin`, `--available-height`, and `--anchor-width` instead of Radix variables.

- [ ] **Step 4: Implement Sheet with Base UI Dialog**

Use `@base-ui/react/dialog` in `sheet.tsx`. Preserve `Sheet`, `SheetTrigger`, `SheetClose`, `SheetContent`, `SheetHeader`, `SheetFooter`, `SheetTitle`, and `SheetDescription` exports. Keep the existing `side` prop and side-specific classes, converting open/closed animation selectors to Base UI transition attributes.

- [ ] **Step 5: Run overlay tests**

Run: `pnpm --filter webapp test src/components/ui/dialog.test.tsx src/components/ui/sheet.test.tsx src/components/ui/tooltip.test.tsx src/components/notifications/notification-popover.test.tsx`

Expected: PASS.

- [ ] **Step 6: Verify no Radix remains in overlay wrappers**

Run: `rg '@radix-ui' apps/webapp/src/components/ui/dialog.tsx apps/webapp/src/components/ui/alert-dialog.tsx apps/webapp/src/components/ui/popover.tsx apps/webapp/src/components/ui/hover-card.tsx apps/webapp/src/components/ui/tooltip.tsx apps/webapp/src/components/ui/sheet.tsx`

Expected: no output.

## Task 7: Migrate Menu, Navigation, And Select Wrappers

**Files:**

- Modify: `apps/webapp/src/components/ui/dropdown-menu.tsx`
- Modify: `apps/webapp/src/components/ui/context-menu.tsx`
- Modify: `apps/webapp/src/components/ui/menubar.tsx`
- Modify: `apps/webapp/src/components/ui/navigation-menu.tsx`
- Modify: `apps/webapp/src/components/ui/select.tsx`
- Create: `apps/webapp/src/components/ui/dropdown-menu.test.tsx`
- Create: `apps/webapp/src/components/ui/select.test.tsx`

- [ ] **Step 1: Write dropdown menu smoke test**

Create `apps/webapp/src/components/ui/dropdown-menu.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

describe("DropdownMenu", () => {
	it("opens menu items from the trigger", async () => {
		const user = userEvent.setup();

		render(
			<DropdownMenu>
				<DropdownMenuTrigger>Actions</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuItem>Archive</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>,
		);

		await user.click(screen.getByRole("button", { name: "Actions" }));

		expect(screen.getByRole("menuitem", { name: "Archive" })).toBeInTheDocument();
	});
});
```

- [ ] **Step 2: Write select smoke test**

Create `apps/webapp/src/components/ui/select.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

describe("Select", () => {
	it("opens and selects an option", async () => {
		const user = userEvent.setup();

		render(
			<Select defaultValue="draft">
				<SelectTrigger aria-label="Status">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="draft">Draft</SelectItem>
					<SelectItem value="ready">Ready</SelectItem>
				</SelectContent>
			</Select>,
		);

		await user.click(screen.getByRole("button", { name: "Status" }));
		await user.click(screen.getByRole("option", { name: "Ready" }));

		expect(screen.getByRole("button", { name: "Status" })).toHaveTextContent("Ready");
	});
});
```

- [ ] **Step 3: Convert menu anatomy**

Use:

```tsx
import { Menu as DropdownMenuPrimitive } from "@base-ui/react/menu";
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { Menubar as MenubarPrimitive } from "@base-ui/react/menubar";
import { NavigationMenu as NavigationMenuPrimitive } from "@base-ui/react/navigation-menu";
import { Select as SelectPrimitive } from "@base-ui/react/select";
```

For dropdown menu:

- `Content` renders `Portal` > `Positioner` > `Popup`.
- `Item` styling uses `data-highlighted`.
- `CheckboxItem` renders `CheckboxItemIndicator`.
- `RadioItem` renders `RadioItemIndicator`.
- `Sub` maps to `SubmenuRoot` if Base UI names differ in the installed version.

For select:

- `Content` renders `Portal` > `Positioner` > `Popup` > `ScrollUpArrow` > `List` > items > `ScrollDownArrow`.
- `Item` renders `ItemIndicator` and `ItemText`.
- `Value` keeps placeholder support.
- Replace `--radix-select-*` CSS variables with `--anchor-width`, `--available-height`, and `--transform-origin`.

- [ ] **Step 4: Run menu and select tests**

Run: `pnpm --filter webapp test src/components/ui/dropdown-menu.test.tsx src/components/ui/select.test.tsx src/components/header-timezone-control.test.tsx src/components/organization/members-table.test.tsx`

Expected: PASS. If `members-table.test.tsx` does not exist, run the nearest existing organization table tests reported by `rg --files apps/webapp/src/components/organization | rg 'test\\.tsx$'`.

- [ ] **Step 5: Verify no Radix remains in menu wrappers**

Run: `rg '@radix-ui' apps/webapp/src/components/ui/dropdown-menu.tsx apps/webapp/src/components/ui/context-menu.tsx apps/webapp/src/components/ui/menubar.tsx apps/webapp/src/components/ui/navigation-menu.tsx apps/webapp/src/components/ui/select.tsx`

Expected: no output.

## Task 8: Migrate Remaining Base-Covered Wrappers

**Files:**

- Modify: `apps/webapp/src/components/ui/scroll-area.tsx`

- [ ] **Step 1: Convert scroll area anatomy**

Use:

```tsx
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
```

Preserve exported names and `data-slot` attributes for `ScrollArea`, `ScrollBar`, and any viewport/thumb wrapper names currently exported by `scroll-area.tsx`.

- [ ] **Step 2: Run scroll area affected tests**

Run: `pnpm --filter webapp test src/components/organization/team-members-dialog.test.tsx src/components/ui/sidebar.test.tsx`

Expected: PASS. If `team-members-dialog.test.tsx` does not exist, run `pnpm --filter webapp test src/components/ui/sidebar.test.tsx` and record that no direct scroll-area test exists.

- [ ] **Step 3: Verify no Radix remains in scroll area**

Run: `rg '@radix-ui' apps/webapp/src/components/ui/scroll-area.tsx`

Expected: no output.

## Task 9: Remove Radix Dependencies And Regenerate Licenses

**Files:**

- Modify: `apps/webapp/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/webapp/src/data/licenses.json`

- [ ] **Step 1: Run active source guard**

Run: `pnpm --filter webapp test src/components/ui/radix-source-guard.test.ts src/components/ui/base-ui-wrapper-source.test.ts`

Expected: PASS. Do not remove dependencies until both guards pass.

- [ ] **Step 2: Remove Radix packages**

Run: `pnpm --filter webapp remove @radix-ui/react-accordion @radix-ui/react-alert-dialog @radix-ui/react-aspect-ratio @radix-ui/react-avatar @radix-ui/react-checkbox @radix-ui/react-collapsible @radix-ui/react-context-menu @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-hover-card @radix-ui/react-label @radix-ui/react-menubar @radix-ui/react-navigation-menu @radix-ui/react-popover @radix-ui/react-progress @radix-ui/react-radio-group @radix-ui/react-scroll-area @radix-ui/react-select @radix-ui/react-separator @radix-ui/react-slider @radix-ui/react-slot @radix-ui/react-switch @radix-ui/react-tabs @radix-ui/react-toggle @radix-ui/react-toggle-group @radix-ui/react-tooltip radix-ui`

Expected: Radix packages are removed from `apps/webapp/package.json` and `pnpm-lock.yaml` updates.

- [ ] **Step 3: Regenerate licenses**

Run: `pnpm --filter webapp run generate-licenses`

Expected: `apps/webapp/src/data/licenses.json` no longer lists Radix packages and includes `@base-ui/react`.

- [ ] **Step 4: Verify dependency removal**

Run: `rg '@radix-ui|"radix-ui"' apps/webapp/package.json pnpm-lock.yaml apps/webapp/src/data/licenses.json`

Expected: no active dependency entries. Historical lockfile references should be absent after pnpm removal.

## Task 10: Final Verification And Regression Sweep

**Files:**

- Review all modified files.

- [ ] **Step 1: Check active source imports**

Run: `rg '@radix-ui' apps/webapp/src apps/webapp/package.json`

Expected: no output.

- [ ] **Step 2: Run UI wrapper tests**

Run: `pnpm --filter webapp test src/components/ui/radix-source-guard.test.ts src/components/ui/base-ui-wrapper-source.test.ts src/components/ui/slot.test.tsx src/components/ui/dialog.test.tsx src/components/ui/sheet.test.tsx src/components/ui/dropdown-menu.test.tsx src/components/ui/select.test.tsx src/components/ui/tooltip.test.tsx`

Expected: PASS.

- [ ] **Step 3: Run webapp tests**

Run: `pnpm --filter webapp test`

Expected: PASS.

- [ ] **Step 4: Run production build**

Run: `CI=true pnpm --filter webapp build`

Expected: PASS.

- [ ] **Step 5: Inspect the full diff**

Run: `git diff -- apps/webapp/package.json pnpm-lock.yaml apps/webapp/src/app/globals.css apps/webapp/src/components/ui apps/webapp/src/data/licenses.json docs/superpowers/specs/2026-06-06-radix-to-base-ui-migration-design.md docs/superpowers/plans/2026-06-06-radix-to-base-ui-migration.md`

Expected: diff only contains the migration, the spec, and this plan. Do not revert unrelated changes outside these paths.

- [ ] **Step 6: Manual smoke checklist**

Run: `pnpm dev:webapp`

Manually verify these screens or flows in browser:

- Login form tooltip and two-factor UI.
- App sidebar collapse and navigation.
- Header timezone popover.
- Notification popover on desktop and mobile sheet.
- Settings pages with tabs, switches, selects, and dialogs.
- Calendar sheet/detail panel.
- Organization member dropdown actions.
- Approval inbox sheet and dialog flows.

Expected: interactions are usable with mouse and keyboard, focus remains visible, overlays stack above the app shell, and light/dark theme styling matches the pre-migration visual language.

## Self-Review

Spec coverage:

- Full Radix removal target is covered by Tasks 1, 9, and 10.
- Wrapper-first migration is covered by Tasks 2 through 8.
- Base UI `render` and `asChild` compatibility is covered by Task 2 and wrapper conversion notes.
- CSS state and variable migration is covered by Tasks 4, 5, 6, and 7.
- Overlay, menu, select, form-control, disclosure, and sheet risks are covered by targeted tests and manual verification.

Placeholder scan:

- The plan avoids placeholder markers, incomplete task descriptions, and unspecified file paths.
- Where a Base UI exported part name may differ by installed version, the plan instructs the implementer to map to the installed Base UI name in the same task and verify with tests.

Type consistency:

- Public wrapper exports are preserved throughout the plan.
- The local `Slot` helper is defined before wrappers depend on it.
- Source guards are introduced before dependency removal and expected to fail until conversion is complete.
