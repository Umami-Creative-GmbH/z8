# Webapp Error Pages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the default Next.js fallback screens in the webapp with a polished, localized global `404` page and a matching app-wide `5xx` error page.

**Architecture:** Add one reusable error-state component in the shared errors area, then wire it into the locale-level app-router fallbacks at `apps/webapp/src/app/[locale]/not-found.tsx` and `apps/webapp/src/app/[locale]/error.tsx`. Keep all copy in the common translation namespace, use only globally safe recovery destinations, and leave the existing route-specific settings error boundary untouched.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS v4, `@tolgee/react`, `next-intl` navigation, Vitest, Testing Library.

---

### Task 1: Shared Error State Component

**Files:**
- Create: `apps/webapp/src/components/errors/app-error-state.tsx`
- Test: `apps/webapp/src/components/errors/app-error-state.test.tsx`
- Reference: `apps/webapp/src/components/ui/button.tsx`
- Reference: `apps/webapp/src/components/ui/card.tsx`

**Step 1: Write the failing test**

```tsx
/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
	useRouter: () => ({ push: pushMock, back: vi.fn() }),
}));

import { AppErrorState } from "./app-error-state";

describe("AppErrorState", () => {
	it("renders 404 actions and optional support details", () => {
		render(
			<AppErrorState
				variant="not-found"
				titleKey="errors.notFound.title"
				titleDefault="Page not found"
				descriptionKey="errors.notFound.description"
				descriptionDefault="The page may have moved or the link may be outdated."
				digest="digest-123"
			/>,
		);

		expect(screen.getByText("Page not found")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /go to dashboard/i })).toHaveAttribute("href", "/");
		expect(screen.getByText(/digest-123/i)).toBeInTheDocument();
	});

	it("calls retry handler for the error variant", () => {
		const onRetry = vi.fn();

		render(
			<AppErrorState
				variant="error"
				titleKey="errors.unexpected.title"
				titleDefault="Something went wrong"
				descriptionKey="errors.unexpected.description"
				descriptionDefault="Please try again."
				onRetry={onRetry}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /retry/i }));
		expect(onRetry).toHaveBeenCalledTimes(1);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/errors/app-error-state.test.tsx`
Expected: FAIL with `Cannot find module './app-error-state'`.

**Step 3: Write minimal implementation**

```tsx
"use client";

import { IconAlertTriangle, IconArrowLeft, IconHome, IconRefresh, IconSettings } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link, useRouter } from "@/navigation";

type AppErrorStateProps = {
	variant: "not-found" | "error";
	titleKey: string;
	titleDefault: string;
	descriptionKey: string;
	descriptionDefault: string;
	digest?: string;
	onRetry?: () => void;
};

export function AppErrorState(props: AppErrorStateProps) {
	const { t } = useTranslate();
	const router = useRouter();

	return (
		<div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
			<div className="absolute inset-0 bg-[radial-gradient(circle_at_top,oklch(0.92_0.05_265/.55),transparent_45%)]" />
			<Card className="relative w-full max-w-2xl border-border/60 bg-card/95 backdrop-blur">
				<CardHeader className="space-y-4 text-center">
					<div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
						<IconAlertTriangle className="size-8" aria-hidden="true" />
					</div>
					<p className="text-sm font-medium uppercase tracking-[0.3em] text-muted-foreground">
						{props.variant === "not-found" ? "404" : t("common.error", "Error")}
					</p>
					<CardTitle className="text-balance text-3xl">{t(props.titleKey, props.titleDefault)}</CardTitle>
					<CardDescription className="mx-auto max-w-xl text-base">
						{t(props.descriptionKey, props.descriptionDefault)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					<div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
						{props.variant === "error" && props.onRetry ? (
							<Button onClick={props.onRetry}>
								<IconRefresh className="mr-2 size-4" />
								{t("common.retry", "Retry")}
							</Button>
						) : null}
						<Button asChild>
							<Link href="/">
								<IconHome className="mr-2 size-4" />
								{t("common.goToDashboard", "Go to Dashboard")}
							</Link>
						</Button>
						<Button variant="outline" asChild>
							<Link href="/settings">
								<IconSettings className="mr-2 size-4" />
								{t("nav.settings", "Settings")}
							</Link>
						</Button>
						<Button variant="ghost" onClick={() => router.back()}>
							<IconArrowLeft className="mr-2 size-4" />
							{t("common.back", "Back")}
						</Button>
					</div>

					{props.digest ? (
						<div className="rounded-xl border border-border/60 bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
							{t("errors.unexpected.digest", "Reference: {digest}", { digest: props.digest })}
						</div>
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/errors/app-error-state.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/components/errors/app-error-state.tsx apps/webapp/src/components/errors/app-error-state.test.tsx
git commit -m "feat(webapp): add shared error page state"
```

### Task 2: Localized Copy for Global Fallback Pages

**Files:**
- Modify: `apps/webapp/messages/common/en.json`
- Modify: `apps/webapp/messages/common/de.json`
- Modify: `apps/webapp/messages/common/es.json`
- Modify: `apps/webapp/messages/common/fr.json`
- Modify: `apps/webapp/messages/common/it.json`
- Modify: `apps/webapp/messages/common/pt.json`
- Reference: `apps/webapp/.claude/docs/i18n.md`

**Step 1: Write the failing test**

Add one assertion to `apps/webapp/src/components/errors/app-error-state.test.tsx` that expects the shared component to render a translated digest label and the `Go to Dashboard` button text through translation keys instead of only hardcoded strings.

```tsx
expect(screen.getByRole("link", { name: /go to dashboard/i })).toBeInTheDocument();
expect(screen.getByText(/reference: digest-123/i)).toBeInTheDocument();
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/errors/app-error-state.test.tsx`
Expected: FAIL after changing the component to use keys that do not yet exist in the common message files.

**Step 3: Write minimal implementation**

Add the new error-page keys under the existing `errors` and `common` trees in each common namespace file.

```json
{
  "errors": {
    "notFound": {
      "title": "Page not found",
      "description": "The page may have moved, the link may be outdated, or the address may be incorrect.",
      "eyebrow": "404"
    },
    "unexpected": {
      "title": "Something went wrong",
      "description": "We couldn't load this page right now. Please try again or return to a safe place in the app.",
      "digest": "Reference: {digest}"
    }
  }
}
```

Use equivalent translations where available; if translation quality is not immediately verifiable, start by mirroring the English source text in the non-English files so the build remains complete and follow up with native-language copy later.

**Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/errors/app-error-state.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/messages/common/en.json apps/webapp/messages/common/de.json apps/webapp/messages/common/es.json apps/webapp/messages/common/fr.json apps/webapp/messages/common/it.json apps/webapp/messages/common/pt.json apps/webapp/src/components/errors/app-error-state.test.tsx apps/webapp/src/components/errors/app-error-state.tsx
git commit -m "feat(webapp): add localized error page copy"
```

### Task 3: Wire the Global 404 and 5xx Routes

**Files:**
- Create: `apps/webapp/src/app/[locale]/not-found.tsx`
- Create: `apps/webapp/src/app/[locale]/error.tsx`
- Modify: `apps/webapp/src/components/errors/app-error-state.tsx`
- Reference: `apps/webapp/src/app/[locale]/layout.tsx`
- Reference: `apps/webapp/src/app/[locale]/(app)/settings/error.tsx`

**Step 1: Write the failing test**

Extend `apps/webapp/src/components/errors/app-error-state.test.tsx` to assert that the `error` variant renders the retry button and the `not-found` variant does not.

```tsx
expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/errors/app-error-state.test.tsx`
Expected: FAIL until the variant-specific actions are wired correctly.

**Step 3: Write minimal implementation**

Create the locale-level route files and pass the proper props into the shared component.

```tsx
// apps/webapp/src/app/[locale]/not-found.tsx
import { AppErrorState } from "@/components/errors/app-error-state";

export default function NotFoundPage() {
	return (
		<AppErrorState
			variant="not-found"
			titleKey="errors.notFound.title"
			titleDefault="Page not found"
			descriptionKey="errors.notFound.description"
			descriptionDefault="The page may have moved, the link may be outdated, or the address may be incorrect."
		/>
	);
}
```

```tsx
// apps/webapp/src/app/[locale]/error.tsx
"use client";

import { useEffect } from "react";
import { AppErrorState } from "@/components/errors/app-error-state";

export default function LocaleError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error("Unhandled locale error:", error);
	}, [error]);

	return (
		<AppErrorState
			variant="error"
			titleKey="errors.unexpected.title"
			titleDefault="Something went wrong"
			descriptionKey="errors.unexpected.description"
			descriptionDefault="We couldn't load this page right now. Please try again or return to a safe place in the app."
			digest={error.digest}
			onRetry={reset}
		/>
	);
}
```

Keep `apps/webapp/src/app/[locale]/(app)/settings/error.tsx` unchanged so the route-specific override still wins for settings.

**Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/errors/app-error-state.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/not-found.tsx apps/webapp/src/app/[locale]/error.tsx apps/webapp/src/components/errors/app-error-state.tsx apps/webapp/src/components/errors/app-error-state.test.tsx
git commit -m "feat(webapp): add global app error pages"
```

### Task 4: Regression Checks and Manual Verification

**Files:**
- Verify: `apps/webapp/src/app/[locale]/not-found.tsx`
- Verify: `apps/webapp/src/app/[locale]/error.tsx`
- Verify: `apps/webapp/src/components/errors/app-error-state.tsx`

**Step 1: Run the focused automated test**

```bash
pnpm test -- src/components/errors/app-error-state.test.tsx
```

Expected: PASS.

**Step 2: Run the webapp build**

```bash
pnpm build
```

Expected: PASS with the new route files and translations included.

**Step 3: Manually verify the 404 page**

```bash
pnpm dev
```

Open `/en/this-route-does-not-exist` and verify:

- the custom layout appears instead of the default Next.js 404
- `Go to Dashboard`, `Settings`, and `Back` actions render
- spacing and background treatment work on mobile and desktop

**Step 4: Manually verify the error page**

Temporarily throw from a safe local test route or a guarded debug branch, then verify:

- the custom error layout appears
- the retry action calls `reset()` and re-renders
- the digest appears only when provided
- the page does not expose stack traces or raw internal messages

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/not-found.tsx apps/webapp/src/app/[locale]/error.tsx apps/webapp/src/components/errors/app-error-state.tsx apps/webapp/src/components/errors/app-error-state.test.tsx apps/webapp/messages/common/en.json apps/webapp/messages/common/de.json apps/webapp/messages/common/es.json apps/webapp/messages/common/fr.json apps/webapp/messages/common/it.json apps/webapp/messages/common/pt.json
git commit -m "test(webapp): verify custom error page regressions"
```
