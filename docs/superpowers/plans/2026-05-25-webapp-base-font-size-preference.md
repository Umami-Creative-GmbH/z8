# Webapp Base Font Size Preference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local `Default / Comfortable / Large` base font-size preference across auth, onboarding, and signed-in webapp UI.

**Architecture:** Create a small client-side provider that stores the preference in `localStorage`, exposes it through React context, and applies `data-font-size` to `<html>`. Reuse a shared compact dropdown control on auth/onboarding and add matching radio sections to the existing signed-in user menu.

**Tech Stack:** Next.js 16 App Router, React 19 client components, Tailwind CSS v4, Radix dropdown menu wrappers, Tabler icons, Vitest, Testing Library.

---

## File Structure

- Create `apps/webapp/src/components/font-size-preference.tsx`: owns font-size types, options, storage helpers, DOM application helper, provider, and hook.
- Create `apps/webapp/src/components/font-size-preference.test.tsx`: tests helper and provider behavior.
- Create `apps/webapp/src/components/font-size-toggle.tsx`: compact icon dropdown used outside the signed-in app shell.
- Create `apps/webapp/src/components/font-size-toggle.test.tsx`: tests the compact dropdown choices and update behavior.
- Modify `apps/webapp/src/app/globals.css`: maps `html[data-font-size="comfortable"]` and `html[data-font-size="large"]` to larger root font sizes.
- Modify `apps/webapp/src/app/[locale]/layout.tsx`: wraps the app in `FontSizeProvider` so all route groups inherit it.
- Modify `apps/webapp/src/app/[locale]/(auth)/layout.tsx`: renders `FontSizeToggle` beside `ThemeToggle` and `LanguageSwitcher`.
- Modify `apps/webapp/src/app/[locale]/(auth)/layout.test.tsx`: mocks and asserts the auth font-size control.
- Modify `apps/webapp/src/app/[locale]/onboarding/layout.tsx`: renders `FontSizeToggle` beside `ThemeToggle` and `LanguageSwitcher`.
- Modify `apps/webapp/src/app/[locale]/onboarding/layout.test.tsx`: mocks and asserts the onboarding font-size control.
- Modify `apps/webapp/src/components/nav-user.tsx`: adds desktop submenu and mobile collapsible radio group for font size.
- Modify `apps/webapp/src/components/nav-user.test.tsx`: updates existing mobile behavior tests to include font size.

## Task 1: Font Size Preference Provider

**Files:**
- Create: `apps/webapp/src/components/font-size-preference.tsx`
- Create: `apps/webapp/src/components/font-size-preference.test.tsx`

- [ ] **Step 1: Write failing helper and provider tests**

Create `apps/webapp/src/components/font-size-preference.test.tsx` with this content:

```tsx
/* @vitest-environment jsdom */

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	FONT_SIZE_STORAGE_KEY,
	FontSizeProvider,
	applyFontSizePreference,
	readStoredFontSize,
	useFontSizePreference,
	writeStoredFontSize,
} from "./font-size-preference";

function Consumer() {
	const { fontSize, setFontSize } = useFontSizePreference();

	return (
		<div>
			<p>Current: {fontSize}</p>
			<button type="button" onClick={() => setFontSize("large")}>
				Set large
			</button>
		</div>
	);
}

describe("font size preference helpers", () => {
	it("reads valid stored values", () => {
		localStorage.setItem(FONT_SIZE_STORAGE_KEY, "comfortable");

		expect(readStoredFontSize(localStorage)).toBe("comfortable");
	});

	it("falls back to default for invalid stored values", () => {
		localStorage.setItem(FONT_SIZE_STORAGE_KEY, "giant");

		expect(readStoredFontSize(localStorage)).toBe("default");
	});

	it("falls back to default when storage throws", () => {
		const storage = {
			getItem: vi.fn(() => {
				throw new Error("blocked");
			}),
		} as unknown as Storage;

		expect(readStoredFontSize(storage)).toBe("default");
	});

	it("writes values when storage is available", () => {
		writeStoredFontSize(localStorage, "large");

		expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe("large");
	});

	it("does not throw when storage writes fail", () => {
		const storage = {
			setItem: vi.fn(() => {
				throw new Error("blocked");
			}),
		} as unknown as Storage;

		expect(() => writeStoredFontSize(storage, "comfortable")).not.toThrow();
	});

	it("applies default by removing the html attribute", () => {
		document.documentElement.setAttribute("data-font-size", "large");

		applyFontSizePreference("default");

		expect(document.documentElement.hasAttribute("data-font-size")).toBe(false);
	});

	it("applies non-default values to html", () => {
		applyFontSizePreference("comfortable");

		expect(document.documentElement.dataset.fontSize).toBe("comfortable");
	});
});

describe("FontSizeProvider", () => {
	it("loads stored preference and updates the document", async () => {
		localStorage.setItem(FONT_SIZE_STORAGE_KEY, "comfortable");

		render(
			<FontSizeProvider>
				<Consumer />
			</FontSizeProvider>,
		);

		expect(await screen.findByText("Current: comfortable")).toBeTruthy();
		expect(document.documentElement.dataset.fontSize).toBe("comfortable");
	});

	it("updates state, storage, and html when changed", async () => {
		render(
			<FontSizeProvider>
				<Consumer />
			</FontSizeProvider>,
		);

		await screen.findByText("Current: default");

		act(() => {
			screen.getByRole("button", { name: "Set large" }).click();
		});

		expect(screen.getByText("Current: large")).toBeTruthy();
		expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe("large");
		expect(document.documentElement.dataset.fontSize).toBe("large");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir apps/webapp test src/components/font-size-preference.test.tsx
```

Expected: FAIL because `./font-size-preference` does not exist.

- [ ] **Step 3: Implement the provider and helpers**

Create `apps/webapp/src/components/font-size-preference.tsx` with this content:

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export const FONT_SIZE_STORAGE_KEY = "z8-font-size";

export type FontSizePreference = "default" | "comfortable" | "large";

export const FONT_SIZE_OPTIONS: Array<{ value: FontSizePreference; labelKey: string; label: string }> = [
	{ value: "default", labelKey: "user.font-size-default", label: "Default" },
	{ value: "comfortable", labelKey: "user.font-size-comfortable", label: "Comfortable" },
	{ value: "large", labelKey: "user.font-size-large", label: "Large" },
];

type FontSizeContextValue = {
	fontSize: FontSizePreference;
	setFontSize: (value: FontSizePreference) => void;
};

const FontSizeContext = createContext<FontSizeContextValue | null>(null);

export function isFontSizePreference(value: string | null): value is FontSizePreference {
	return value === "default" || value === "comfortable" || value === "large";
}

export function readStoredFontSize(storage: Storage | undefined): FontSizePreference {
	try {
		const value = storage?.getItem(FONT_SIZE_STORAGE_KEY) ?? null;
		return isFontSizePreference(value) ? value : "default";
	} catch {
		return "default";
	}
}

export function writeStoredFontSize(storage: Storage | undefined, value: FontSizePreference) {
	try {
		storage?.setItem(FONT_SIZE_STORAGE_KEY, value);
	} catch {
		// Keep the current session updated even when persistence is blocked.
	}
}

export function applyFontSizePreference(value: FontSizePreference) {
	if (typeof document === "undefined") {
		return;
	}

	if (value === "default") {
		document.documentElement.removeAttribute("data-font-size");
		return;
	}

	document.documentElement.dataset.fontSize = value;
}

export function FontSizeProvider({ children }: { children: React.ReactNode }) {
	const [fontSize, setFontSizeState] = useState<FontSizePreference>("default");

	useEffect(() => {
		const storedFontSize = readStoredFontSize(window.localStorage);
		setFontSizeState(storedFontSize);
		applyFontSizePreference(storedFontSize);
	}, []);

	const setFontSize = useCallback((value: FontSizePreference) => {
		setFontSizeState(value);
		writeStoredFontSize(typeof window === "undefined" ? undefined : window.localStorage, value);
		applyFontSizePreference(value);
	}, []);

	const value = useMemo(() => ({ fontSize, setFontSize }), [fontSize, setFontSize]);

	return <FontSizeContext.Provider value={value}>{children}</FontSizeContext.Provider>;
}

export function useFontSizePreference() {
	const context = useContext(FontSizeContext);

	if (!context) {
		throw new Error("useFontSizePreference must be used within FontSizeProvider");
	}

	return context;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir apps/webapp test src/components/font-size-preference.test.tsx
```

Expected: PASS for all tests in `font-size-preference.test.tsx`.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/webapp/src/components/font-size-preference.tsx apps/webapp/src/components/font-size-preference.test.tsx
git commit -m "feat: add font size preference provider"
```

## Task 2: Compact Font Size Toggle

**Files:**
- Create: `apps/webapp/src/components/font-size-toggle.tsx`
- Create: `apps/webapp/src/components/font-size-toggle.test.tsx`

- [ ] **Step 1: Write failing toggle tests**

Create `apps/webapp/src/components/font-size-toggle.test.tsx` with this content:

```tsx
/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FontSizeToggle } from "./font-size-toggle";

const mockFontSizeState = vi.hoisted(() => ({
	fontSize: "default",
	setFontSize: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, defaultValue?: string) => defaultValue ?? _key }),
}));

vi.mock("./font-size-preference", async () => {
	const actual = await vi.importActual<typeof import("./font-size-preference")>("./font-size-preference");
	return {
		...actual,
		useFontSizePreference: () => mockFontSizeState,
	};
});

vi.mock("@/components/ui/dropdown-menu", () => ({
	DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DropdownMenuRadioGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DropdownMenuRadioItem: ({ children, onClick }: React.ComponentProps<"button">) => (
		<button type="button" onClick={onClick}>
			{children}
		</button>
	),
	DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("FontSizeToggle", () => {
	it("renders an accessible icon trigger and all choices", () => {
		render(<FontSizeToggle />);

		expect(screen.getByRole("button", { name: "Font size" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Default" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Comfortable" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Large" })).toBeTruthy();
	});

	it("updates the preference when a choice is selected", () => {
		render(<FontSizeToggle />);

		fireEvent.click(screen.getByRole("button", { name: "Large" }));

		expect(mockFontSizeState.setFontSize).toHaveBeenCalledWith("large");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir apps/webapp test src/components/font-size-toggle.test.tsx
```

Expected: FAIL because `./font-size-toggle` does not exist.

- [ ] **Step 3: Implement the compact toggle**

Create `apps/webapp/src/components/font-size-toggle.tsx` with this content:

```tsx
"use client";

import { IconTextSize } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FONT_SIZE_OPTIONS, useFontSizePreference } from "./font-size-preference";

export function FontSizeToggle() {
	const { t } = useTranslate();
	const { fontSize, setFontSize } = useFontSizePreference();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="icon">
					<IconTextSize className="size-4" />
					<span className="sr-only">{t("common:user.font-size", "Font size")}</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuRadioGroup value={fontSize} onValueChange={setFontSize}>
					{FONT_SIZE_OPTIONS.map((option) => (
						<DropdownMenuRadioItem key={option.value} value={option.value}>
							{t(`common:${option.labelKey}`, option.label)}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir apps/webapp test src/components/font-size-toggle.test.tsx
```

Expected: PASS for all tests in `font-size-toggle.test.tsx`.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/webapp/src/components/font-size-toggle.tsx apps/webapp/src/components/font-size-toggle.test.tsx
git commit -m "feat: add font size toggle"
```

## Task 3: Global Application and Route Controls

**Files:**
- Modify: `apps/webapp/src/app/globals.css`
- Modify: `apps/webapp/src/app/[locale]/layout.tsx`
- Modify: `apps/webapp/src/app/[locale]/(auth)/layout.tsx`
- Modify: `apps/webapp/src/app/[locale]/(auth)/layout.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/onboarding/layout.tsx`
- Modify: `apps/webapp/src/app/[locale]/onboarding/layout.test.tsx`

- [ ] **Step 1: Write failing layout tests**

In `apps/webapp/src/app/[locale]/(auth)/layout.test.tsx`, add this mock after the `ThemeToggle` mock:

```tsx
vi.mock("@/components/font-size-toggle", () => ({
	FontSizeToggle: () => <button type="button">Font size</button>,
}));
```

In the `uses a full-page background image behind the auth content` test, add this assertion after the theme and language assertions if present, or after the background assertions:

```tsx
expect(screen.getByRole("button", { name: "Font size" })).toBeTruthy();
```

In `apps/webapp/src/app/[locale]/onboarding/layout.test.tsx`, add this mock after the `ThemeToggle` mock:

```tsx
vi.mock("@/components/font-size-toggle", () => ({
	FontSizeToggle: () => <button type="button">Font size</button>,
}));
```

In the `uses the auth-style full-screen glass shell` test, add this assertion after the theme and language assertions:

```tsx
expect(screen.getByRole("button", { name: "Font size" })).toBeTruthy();
```

- [ ] **Step 2: Run layout tests to verify they fail**

Run:

```bash
pnpm --dir apps/webapp test 'src/app/[locale]/(auth)/layout.test.tsx' 'src/app/[locale]/onboarding/layout.test.tsx'
```

Expected: FAIL because the layouts do not render `FontSizeToggle` yet.

- [ ] **Step 3: Apply global CSS and provider**

In `apps/webapp/src/app/globals.css`, add these rules inside the first `@layer base` block before the universal selector:

```css
	html[data-font-size="comfortable"] {
		font-size: 17px;
	}

	html[data-font-size="large"] {
		font-size: 18px;
	}
```

In `apps/webapp/src/app/[locale]/layout.tsx`, add this import near the other component imports:

```tsx
import { FontSizeProvider } from "@/components/font-size-preference";
```

Then replace `AppProviders` with this full implementation:

```tsx
function AppProviders({ children, locale }: { children: ReactNode; locale: string }) {
	return (
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
			<FontSizeProvider>
				<TranslationProvider locale={locale}>
					<QueryProvider>
						<BProgressBar />
						<TooltipProvider delayDuration={0}>
							<OfflineBanner />
							<SWUpdatePrompt />
							{children}
							<Toaster position="bottom-right" richColors />
						</TooltipProvider>
					</QueryProvider>
				</TranslationProvider>
			</FontSizeProvider>
		</ThemeProvider>
	);
}
```

- [ ] **Step 4: Add auth and onboarding controls**

In `apps/webapp/src/app/[locale]/(auth)/layout.tsx`, add this import near `ThemeToggle`:

```tsx
import { FontSizeToggle } from "@/components/font-size-toggle";
```

Then replace the top-right controls block with:

```tsx
<div className="flex items-center justify-end gap-2 drop-shadow-sm">
	<ThemeToggle />
	<FontSizeToggle />
	<LanguageSwitcher />
</div>
```

In `apps/webapp/src/app/[locale]/onboarding/layout.tsx`, add this import near `ThemeToggle`:

```tsx
import { FontSizeToggle } from "@/components/font-size-toggle";
```

Then replace the top-right controls block with:

```tsx
<div className="flex items-center justify-end gap-2 drop-shadow-sm">
	<ThemeToggle />
	<FontSizeToggle />
	<LanguageSwitcher />
</div>
```

- [ ] **Step 5: Run route and provider tests**

Run:

```bash
pnpm --dir apps/webapp test src/components/font-size-preference.test.tsx src/components/font-size-toggle.test.tsx 'src/app/[locale]/(auth)/layout.test.tsx' 'src/app/[locale]/onboarding/layout.test.tsx'
```

Expected: PASS for all listed tests.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/webapp/src/app/globals.css apps/webapp/src/app/[locale]/layout.tsx apps/webapp/src/app/[locale]/\(auth\)/layout.tsx apps/webapp/src/app/[locale]/\(auth\)/layout.test.tsx apps/webapp/src/app/[locale]/onboarding/layout.tsx apps/webapp/src/app/[locale]/onboarding/layout.test.tsx
git commit -m "feat: apply font size preference globally"
```

## Task 4: Signed-In User Menu Integration

**Files:**
- Modify: `apps/webapp/src/components/nav-user.tsx`
- Modify: `apps/webapp/src/components/nav-user.test.tsx`

- [ ] **Step 1: Write failing nav-user tests**

In `apps/webapp/src/components/nav-user.test.tsx`, add this mock after the `next-themes` mock:

```tsx
const mockFontSizeState = vi.hoisted(() => ({
	fontSize: "default",
	setFontSize: vi.fn(),
}));

vi.mock("@/components/font-size-preference", async () => {
	const actual = await vi.importActual<typeof import("@/components/font-size-preference")>(
		"@/components/font-size-preference",
	);
	return {
		...actual,
		useFontSizePreference: () => mockFontSizeState,
	};
});
```

Update the first test to this full body:

```tsx
it("collapses mobile language, font size, and theme options until their sections are opened", () => {
	render(<NavUser user={{ id: "user-1", name: "Kai", email: "kai@example.com" }} />);

	expect(screen.getByRole("button", { name: /language/i })).toBeTruthy();
	expect(screen.getByRole("button", { name: /font size/i })).toBeTruthy();
	expect(screen.getByRole("button", { name: /theme/i })).toBeTruthy();
	expect(screen.queryByText("Deutsch")).toBeNull();
	expect(screen.queryByText("Comfortable")).toBeNull();
	expect(screen.queryByText("Light")).toBeNull();

	fireEvent.click(screen.getByRole("button", { name: /language/i }));
	expect(screen.getByText("Deutsch")).toBeTruthy();
	expect(screen.queryByText("Comfortable")).toBeNull();
	expect(screen.queryByText("Light")).toBeNull();

	fireEvent.click(screen.getByRole("button", { name: /font size/i }));
	expect(screen.getByText("Comfortable")).toBeTruthy();
	expect(screen.queryByText("Deutsch")).toBeNull();
	expect(screen.queryByText("Light")).toBeNull();

	fireEvent.click(screen.getByRole("button", { name: /theme/i }));
	expect(screen.getByText("Light")).toBeTruthy();
});
```

Add this new test after the selected row styling test:

```tsx
it("uses selected row styling for mobile font size options", () => {
	render(<NavUser user={{ id: "user-1", name: "Kai", email: "kai@example.com" }} />);

	fireEvent.click(screen.getByRole("button", { name: /font size/i }));
	const selectedFontSize = screen.getByText("Default").closest("div");

	expect(selectedFontSize?.className).toContain("data-[state=checked]:bg-accent");
	expect(selectedFontSize?.className).toContain("pl-2");
	expect(selectedFontSize?.className).not.toContain("pl-8");
});
```

- [ ] **Step 2: Run nav-user tests to verify they fail**

Run:

```bash
pnpm --dir apps/webapp test src/components/nav-user.test.tsx
```

Expected: FAIL because `NavUser` does not expose the font-size section yet.

- [ ] **Step 3: Add font-size menu UI**

In `apps/webapp/src/components/nav-user.tsx`, add `IconTextSize` to the Tabler import list:

```tsx
	IconTextSize,
```

Add this import near the other component imports:

```tsx
import { FONT_SIZE_OPTIONS, useFontSizePreference } from "@/components/font-size-preference";
```

Inside `NavUser`, after `const { theme, setTheme } = useTheme();`, add:

```tsx
	const { fontSize, setFontSize } = useFontSizePreference();
```

Change the mobile section state type and helper signatures from:

```tsx
const [mobileOpenSection, setMobileOpenSection] = useState<"language" | "theme" | null>(null);
```

to:

```tsx
const [mobileOpenSection, setMobileOpenSection] = useState<"language" | "fontSize" | "theme" | null>(null);
```

and from:

```tsx
const setMobileSectionOpen = (section: "language" | "theme", open: boolean) => {
	setMobileOpenSection(open ? section : null);
};
```

to:

```tsx
const setMobileSectionOpen = (section: "language" | "fontSize" | "theme", open: boolean) => {
	setMobileOpenSection(open ? section : null);
};
```

In the mobile branch, insert this block between the language collapsible separator and the theme collapsible:

```tsx
<Collapsible
	open={mobileOpenSection === "fontSize"}
	onOpenChange={(open) => setMobileSectionOpen("fontSize", open)}
>
	<CollapsibleTrigger asChild>
		<DropdownMenuItem
			className="w-full data-[state=open]:bg-accent data-[state=open]:text-accent-foreground [&[data-state=open]>svg:last-child]:rotate-180"
			onSelect={(event) => event.preventDefault()}
		>
			<IconTextSize className="mr-2 size-4" stroke={1.5} />
			{t("user.font-size", "Font size")}
			<IconChevronDown className="ml-auto size-4 transition-transform duration-200" />
		</DropdownMenuItem>
	</CollapsibleTrigger>
	<CollapsibleContent className="overflow-hidden pl-2 motion-safe:data-[state=closed]:animate-accordion-up motion-safe:data-[state=open]:animate-accordion-down">
		<DropdownMenuRadioGroup value={fontSize} onValueChange={setFontSize}>
			{FONT_SIZE_OPTIONS.map((option) => (
				<DropdownMenuRadioItem key={option.value} className={mobileRadioItemClassName} value={option.value}>
					{t(option.labelKey, option.label)}
				</DropdownMenuRadioItem>
			))}
		</DropdownMenuRadioGroup>
	</CollapsibleContent>
</Collapsible>
<DropdownMenuSeparator />
```

In the desktop branch, insert this submenu between the language submenu and theme submenu:

```tsx
<DropdownMenuSub>
	<DropdownMenuSubTrigger>
		<IconTextSize className="mr-2 size-4" stroke={1.5} />
		{t("user.font-size", "Font size")}
	</DropdownMenuSubTrigger>
	<DropdownMenuSubContent>
		<DropdownMenuRadioGroup value={fontSize} onValueChange={setFontSize}>
			{FONT_SIZE_OPTIONS.map((option) => (
				<DropdownMenuRadioItem key={option.value} value={option.value}>
					{t(option.labelKey, option.label)}
				</DropdownMenuRadioItem>
			))}
		</DropdownMenuRadioGroup>
	</DropdownMenuSubContent>
</DropdownMenuSub>
```

- [ ] **Step 4: Run nav-user tests to verify they pass**

Run:

```bash
pnpm --dir apps/webapp test src/components/nav-user.test.tsx
```

Expected: PASS for all tests in `nav-user.test.tsx`.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/webapp/src/components/nav-user.tsx apps/webapp/src/components/nav-user.test.tsx
git commit -m "feat: add font size to user menu"
```

## Task 5: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run all targeted tests**

Run:

```bash
pnpm --dir apps/webapp test src/components/font-size-preference.test.tsx src/components/font-size-toggle.test.tsx src/components/nav-user.test.tsx 'src/app/[locale]/(auth)/layout.test.tsx' 'src/app/[locale]/onboarding/layout.test.tsx'
```

Expected: PASS for all targeted tests.

- [ ] **Step 2: Run the webapp test suite**

Run:

```bash
pnpm --dir apps/webapp test
```

Expected: PASS for the webapp Vitest suite.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only intended webapp files are changed, unless unrelated user or peer-agent files were already present.

- [ ] **Step 4: Commit final verification fixes if any were needed**

If Step 2 exposed a real issue and the implementation was adjusted, run:

```bash
git add apps/webapp/src/components/font-size-preference.tsx apps/webapp/src/components/font-size-preference.test.tsx apps/webapp/src/components/font-size-toggle.tsx apps/webapp/src/components/font-size-toggle.test.tsx apps/webapp/src/components/nav-user.tsx apps/webapp/src/components/nav-user.test.tsx apps/webapp/src/app/globals.css apps/webapp/src/app/[locale]/layout.tsx apps/webapp/src/app/[locale]/\(auth\)/layout.tsx apps/webapp/src/app/[locale]/\(auth\)/layout.test.tsx apps/webapp/src/app/[locale]/onboarding/layout.tsx apps/webapp/src/app/[locale]/onboarding/layout.test.tsx
git commit -m "fix: stabilize font size preference tests"
```

Expected: a commit is created only when Step 2 required code changes.

## Self-Review

- Spec coverage: Tasks cover local-only storage, default/current UI preservation, global application, auth/onboarding controls, signed-in user menu controls, accessibility labels, invalid storage handling, and tests.
- Placeholder scan: The plan contains concrete file paths, commands, expected outcomes, and code blocks for each code change.
- Type consistency: `FontSizePreference`, `FONT_SIZE_OPTIONS`, `useFontSizePreference`, and `setFontSize` are defined in Task 1 and reused consistently in later tasks.
