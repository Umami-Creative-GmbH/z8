# Auth Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the messy auth route presentation with a modern shadcn `login-02`-style split layout for all localized `(auth)` routes while preserving existing auth behavior.

**Architecture:** The route group layout owns the full-page shell, request-scoped domain auth setup, cookie-consent script, top controls, footer, and desktop image panel. `AuthFormWrapper` becomes a focused form card wrapper used by login, sign-up, reset, verification, invite, and join flows. Auth flow logic, actions, provider handling, Turnstile, redirects, and callback URL handling remain unchanged.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS v4, shadcn/ui primitives, Vitest, Testing Library, Better Auth domain context.

---

## Files

- Modify: `apps/webapp/src/app/[locale]/(auth)/layout.tsx` - render the split auth shell and move image responsibility into the route layout.
- Modify: `apps/webapp/src/components/auth-form-wrapper.tsx` - remove the nested image/card split and keep only the focused auth form card.
- Modify: `apps/webapp/src/components/auth-form-wrapper.test.tsx` - verify the wrapper no longer renders its old image panel and still renders branding/title/body.
- Reference only: `docs/superpowers/specs/2026-04-30-auth-layout-redesign-design.md` - approved design source.

## Image Choice

Use this Unsplash image URL for the right panel:

```text
https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1600&q=80
```

It shows a modern office corridor with cool neutral tones, no distracting face as the focal point, and enough structural negative space for a restrained blue overlay.

## Task 1: Simplify AuthFormWrapper

**Files:**
- Modify: `apps/webapp/src/components/auth-form-wrapper.tsx`
- Modify: `apps/webapp/src/components/auth-form-wrapper.test.tsx`

- [ ] **Step 1: Update the failing test expectation first**

Replace `apps/webapp/src/components/auth-form-wrapper.test.tsx` with:

```tsx
/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("next/image", () => ({
	default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));

import { AuthFormWrapper } from "./auth-form-wrapper";

describe("AuthFormWrapper", () => {
	it("renders a focused auth card without the legacy image panel", () => {
		render(
			<AuthFormWrapper title="Create your account">
				<div>form body</div>
			</AuthFormWrapper>,
		);

		expect(screen.getByText("z8")).toBeTruthy();
		expect(screen.getByText("Create your account")).toBeTruthy();
		expect(screen.getByText("form body")).toBeTruthy();
		expect(screen.queryByAltText(/background image/i)).toBeNull();
	});

	it("renders organization branding without adding a layout image", () => {
		render(
			<AuthFormWrapper
				title="Welcome back"
				branding={{
					appName: "Acme Time",
					logoUrl: "https://example.com/logo.png",
					primaryColor: "#2563eb",
					backgroundImageUrl: "https://example.com/background.jpg",
				}}
			>
				<div>branded form</div>
			</AuthFormWrapper>,
		);

		expect(screen.getByAltText("Acme Time logo")).toBeTruthy();
		expect(screen.getByText("Welcome back")).toBeTruthy();
		expect(screen.getByText("branded form")).toBeTruthy();
		expect(screen.queryByAltText("Acme Time background")).toBeNull();
	});
});
```

- [ ] **Step 2: Run the wrapper test and verify it fails**

Run:

```bash
pnpm --dir apps/webapp test src/components/auth-form-wrapper.test.tsx
```

Expected: FAIL because the current wrapper still renders a legacy background image panel and the branded background image.

- [ ] **Step 3: Replace the wrapper implementation**

Replace `apps/webapp/src/components/auth-form-wrapper.tsx` with:

```tsx
"use client";

import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import type { OrganizationBranding } from "@/lib/domain";
import { cn } from "@/lib/utils";

interface AuthFormWrapperProps extends React.ComponentPropsWithoutRef<"div"> {
	title: string;
	children: React.ReactNode;
	formProps?: React.ComponentPropsWithoutRef<"form">;
	branding?: OrganizationBranding | null;
}

export function AuthFormWrapper({
	title,
	children,
	className,
	formProps,
	branding,
	...props
}: AuthFormWrapperProps) {
	const appName = branding?.appName || "z8";

	const customStyles = branding?.primaryColor
		? ({
				"--primary": branding.primaryColor,
				"--ring": branding.primaryColor,
			} as React.CSSProperties)
		: undefined;

	return (
		<div className={cn("w-full", className)} style={customStyles} {...props}>
			<Card className="w-full border-border/70 bg-card/95 shadow-xl shadow-black/5 dark:shadow-black/30">
				<CardContent className="p-6 sm:p-8">
					<form className="w-full" method="post" {...formProps}>
						<div className="flex flex-col gap-6">
							<div className="flex flex-col items-center text-center">
								{branding?.logoUrl ? (
									<div className="relative mb-2 h-12 w-32">
										<Image
											alt={`${appName} logo`}
											className="object-contain"
											fill
											sizes="128px"
											src={branding.logoUrl}
										/>
									</div>
								) : (
									<h1 className="font-bold text-2xl">{appName}</h1>
								)}
								<p className="text-balance text-muted-foreground">{title}</p>
							</div>
							{children}
						</div>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
```

- [ ] **Step 4: Run the wrapper test and verify it passes**

Run:

```bash
pnpm --dir apps/webapp test src/components/auth-form-wrapper.test.tsx
```

Expected: PASS for both `AuthFormWrapper` tests.

- [ ] **Step 5: Commit the wrapper change**

Run:

```bash
git add apps/webapp/src/components/auth-form-wrapper.tsx apps/webapp/src/components/auth-form-wrapper.test.tsx
git commit -m "refactor: simplify auth form wrapper"
```

Expected: commit succeeds. Do not stage unrelated files already present in the worktree.

## Task 2: Add the Split Auth Route Layout

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(auth)/layout.tsx`

- [ ] **Step 1: Replace the auth layout shell**

Replace `apps/webapp/src/app/[locale]/(auth)/layout.tsx` with:

```tsx
import { headers } from "next/headers";
import Script from "next/script";
import { connection } from "next/server";
import { InfoFooter } from "@/components/info-footer";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { env } from "@/env";
import { DomainAuthProvider } from "@/lib/auth/domain-auth-context";
import { type DomainAuthContext, getDomainConfig } from "@/lib/domain";
import { getCookieConsentScript } from "@/lib/platform-settings";
import { DOMAIN_HEADERS } from "@/proxy";
import { ALL_LANGUAGES } from "@/tolgee/shared";

const AUTH_IMAGE_URL =
	"https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1600&q=80";

export async function generateStaticParams() {
	return ALL_LANGUAGES.map((locale) => ({ locale }));
}

export default async function AuthLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	// Get domain from proxy headers
	const headersList = await headers();
	const customDomain = headersList.get(DOMAIN_HEADERS.DOMAIN);

	// Fetch domain config if on custom domain, otherwise use global config
	let domainContext: DomainAuthContext | null = null;
	if (customDomain) {
		domainContext = await getDomainConfig(customDomain);
	} else {
		// Main domain: use global Turnstile config from env vars
		const globalTurnstileSiteKey = env.TURNSTILE_SITE_KEY ?? null;
		domainContext = {
			organizationId: "",
			domain: "",
			authConfig: {
				emailPasswordEnabled: true,
				socialProvidersEnabled: ["google", "github", "linkedin", "apple"],
				ssoEnabled: false,
				passkeyEnabled: true,
			},
			branding: null,
			socialOAuthConfigured: {
				google: false,
				github: false,
				linkedin: false,
				apple: false,
			},
			turnstile: {
				enabled: !!globalTurnstileSiteKey,
				siteKey: globalTurnstileSiteKey,
				isEnterprise: false,
			},
		};
	}

	// Fetch cookie consent script for auth pages
	const cookieConsentScript = await getCookieConsentScript();

	return (
		<DomainAuthProvider domainContext={domainContext}>
			{/* Cookie consent script - injected on auth pages only */}
			{cookieConsentScript && (
				<Script
					id="cookie-consent"
					strategy="afterInteractive"
					dangerouslySetInnerHTML={{ __html: cookieConsentScript }}
				/>
			)}
			<div className="grid min-h-svh bg-background lg:grid-cols-2">
				<section className="flex min-h-svh flex-col px-6 py-6 sm:px-8 lg:px-10">
					<div className="flex items-center justify-end gap-2">
						<ThemeToggle />
						<LanguageSwitcher />
					</div>

					<main className="flex flex-1 items-center justify-center py-10">
						<div className="w-full max-w-md">{children}</div>
					</main>

					<div className="pt-2">
						<InfoFooter />
					</div>
				</section>

				<aside className="relative hidden overflow-hidden bg-muted lg:block">
					<img
						alt=""
						className="absolute inset-0 h-full w-full object-cover"
						decoding="async"
						src={AUTH_IMAGE_URL}
					/>
					<div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(15,23,42,0.82),rgba(37,99,235,0.35),rgba(2,6,23,0.72))]" />
					<div className="absolute inset-x-0 bottom-0 p-10 text-white">
						<div className="max-w-md space-y-3">
							<p className="font-medium text-sm uppercase tracking-[0.24em] text-white/70">
								Z8 Workforce Management
							</p>
							<p className="text-balance font-semibold text-3xl leading-tight">
								Precise time tracking for teams that need dependable operations.
							</p>
							<p className="text-balance text-sm leading-6 text-white/72">
								Clock time, manage absences, and keep audit-ready records from one calm workspace.
							</p>
						</div>
					</div>
				</aside>
			</div>
		</DomainAuthProvider>
	);
}
```

- [ ] **Step 2: Run formatter/checks on changed files**

Run:

```bash
pnpm --dir apps/webapp exec biome check --write src/app/[locale]/\(auth\)/layout.tsx src/components/auth-form-wrapper.tsx src/components/auth-form-wrapper.test.tsx
```

Expected: command exits 0 and may rewrite formatting only in these three files.

- [ ] **Step 3: Run the wrapper test again**

Run:

```bash
pnpm --dir apps/webapp test src/components/auth-form-wrapper.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit the layout change**

Run:

```bash
git add apps/webapp/src/app/[locale]/\(auth\)/layout.tsx apps/webapp/src/components/auth-form-wrapper.tsx apps/webapp/src/components/auth-form-wrapper.test.tsx
git commit -m "feat: add split auth layout"
```

Expected: commit succeeds. Do not stage unrelated files already present in the worktree.

## Task 3: Verify Auth Routes And Build Safety

**Files:**
- Verify: `apps/webapp/src/app/[locale]/(auth)/layout.tsx`
- Verify: `apps/webapp/src/components/auth-form-wrapper.tsx`
- Verify: all existing route files under `apps/webapp/src/app/[locale]/(auth)`

- [ ] **Step 1: Run focused component test**

Run:

```bash
pnpm --dir apps/webapp test src/components/auth-form-wrapper.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript/Next validation through the production build**

Run:

```bash
pnpm --dir apps/webapp build
```

Expected: build exits 0. If the build cannot run because required system-level environment variables are unavailable to agents, stop the build attempt and record the exact missing variable/error in the final handoff instead of inventing local secrets.

- [ ] **Step 3: Manually inspect route rendering in development if environment is available**

Run:

```bash
pnpm --dir apps/webapp dev
```

Expected: the dev server starts. In a browser, inspect these paths for the default locale available in the app:

```text
/en/sign-in
/en/sign-up
/en/forgot-password
/en/reset-password
/en/verify-email
/en/verify-email-pending
/en/verify-2fa
/en/join/example-code
/en/accept-invitation/example-invitation
```

Expected visual result: desktop shows left auth content and right image panel; mobile hides the image panel; theme and language controls remain visible; footer remains visible; form errors, loading states, provider buttons, and 2FA controls are not clipped.

- [ ] **Step 4: Record verification status**

In the implementation handoff, include exact command results:

```text
pnpm --dir apps/webapp test src/components/auth-form-wrapper.test.tsx: PASS or failure details
pnpm --dir apps/webapp build: PASS, or skipped/failed with exact missing environment details
Manual route inspection: completed paths, or skipped with reason
```

- [ ] **Step 5: Commit verification-only fixes if any were required**

If verification required small fixes, stage only the relevant auth files and commit:

```bash
git add apps/webapp/src/app/[locale]/\(auth\)/layout.tsx apps/webapp/src/components/auth-form-wrapper.tsx apps/webapp/src/components/auth-form-wrapper.test.tsx
git commit -m "fix: polish auth layout rendering"
```

Expected: commit succeeds if there were verification fixes. If there were no changes after verification, do not create an empty commit.

## Self-Review

Spec coverage:

- Shared split layout for all `(auth)` routes: Task 2.
- Preserve domain auth, cookie consent, theme/language controls, and footer: Task 2 keeps existing server logic and controls.
- Right-side Unsplash image with decorative alt and overlay: Task 2.
- Mobile single-column layout: Task 2 uses `hidden lg:block` for the image panel and a single content column.
- Keep existing auth behavior: Task 1 limits `AuthFormWrapper` to presentation and Task 2 leaves page logic untouched.
- Verification across routes, themes, and build safety: Task 3.

Placeholder scan: no placeholder tasks remain; commands, file paths, expected results, and code snippets are explicit.

Type consistency: `AuthFormWrapperProps`, `OrganizationBranding`, `DomainAuthContext`, and `AUTH_IMAGE_URL` names are used consistently across tasks.
