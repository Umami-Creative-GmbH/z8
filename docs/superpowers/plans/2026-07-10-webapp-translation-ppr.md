# Webapp Translation PPR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream request-derived route translations behind Suspense while retaining translation context for the prerendered application shell.

**Architecture:** The locale layout will separate provider nesting from request-dependent record loading. `TranslationProvider` continues to derive records from `headers()`, but is rendered inside Suspense; the fallback uses the same provider nesting with empty records and the same application content.

**Tech Stack:** Next.js 16 Cache Components, React 19 Suspense, next-intl, Tolgee, Vitest, pnpm, Turborepo.

---

### Task 1: Add a Failing Translation PPR Contract Test

**Files:**
- Modify: `apps/webapp/src/app/[locale]/layout.test.tsx:133-162`

- [ ] **Step 1: Write the failing source-contract test**

Add this test inside `describe("LocaleLayout", ...)`:

```tsx
	it("streams request-derived translations with a base-provider fallback", () => {
		const source = readFileSync("src/app/[locale]/layout.tsx", "utf8");

		expect(source).toContain('import { Suspense, type ReactNode } from "react";');
		expect(source).toContain("function TranslationProviders(");
		expect(source).toContain("<Suspense");
		expect(source).toContain("records={{}}");
	});
```

- [ ] **Step 2: Run the layout test to verify it fails**

Run: `pnpm --filter webapp exec vitest run 'src/app/[locale]/layout.test.tsx'`

Expected: FAIL because the layout does not import `Suspense`, has no reusable `TranslationProviders` component, and directly renders the header-dependent provider.

### Task 2: Stream Route Translations Behind Suspense

**Files:**
- Modify: `apps/webapp/src/app/[locale]/layout.tsx:1-89`
- Test: `apps/webapp/src/app/[locale]/layout.test.tsx:133-175`

- [ ] **Step 1: Extract shared provider nesting**

Replace the React type-only import with:

```tsx
import { Suspense, type ReactNode } from "react";
```

Add these types and component before `TranslationProvider`:

```tsx
type TranslationRecords = Awaited<ReturnType<typeof loadRouteTranslations>>;

function TranslationProviders({
	children,
	locale,
	records,
}: {
	children: ReactNode;
	locale: string;
	records: TranslationRecords;
}) {
	return (
		<TolgeeNextProvider language={locale} staticData={records}>
			<NextIntlClientProvider locale={locale} messages={{ locale }}>
				{children}
			</NextIntlClientProvider>
		</TolgeeNextProvider>
	);
}
```

Change `TranslationProvider` to return `TranslationProviders` with its loaded `records`:

```tsx
	return (
		<TranslationProviders locale={locale} records={records}>
			{children}
		</TranslationProviders>
	);
```

- [ ] **Step 2: Extract the shared application content**

Add this component before `AppProviders` so the loaded and fallback translation providers wrap identical content:

```tsx
function ApplicationContent({ children }: { children: ReactNode }) {
	return (
		<QueryProvider>
			<BProgressBar />
			<TooltipProvider delayDuration={0}>
				<OfflineBanner />
				<SWUpdatePrompt />
				<DeploymentRefreshChecker clientBuildHash={env.NEXT_PUBLIC_BUILD_HASH ?? "development"} />
				{children}
				<Toaster position="bottom-right" richColors />
			</TooltipProvider>
		</QueryProvider>
	);
}
```

- [ ] **Step 3: Add the Suspense boundary in `AppProviders`**

Replace the direct `TranslationProvider` nesting with:

```tsx
				<Suspense
					fallback={
						<TranslationProviders locale={locale} records={{}}>
							<ApplicationContent>{children}</ApplicationContent>
						</TranslationProviders>
					}
				>
					<TranslationProvider locale={locale}>
						<ApplicationContent>{children}</ApplicationContent>
					</TranslationProvider>
				</Suspense>
```

Keep the existing outer `ThemeProvider` and `FontSizeProvider` unchanged.

- [ ] **Step 4: Run the layout test to verify it passes**

Run: `pnpm --filter webapp exec vitest run 'src/app/[locale]/layout.test.tsx'`

Expected: PASS with the existing layout tests and the new translation PPR contract test.

- [ ] **Step 5: Run the font and Docker regressions**

Run: `pnpm --filter webapp exec vitest run src/components/font-size-preference.test.tsx`

Expected: PASS with 13 tests.

Run: `pnpm node --test docker/scripts/prepare-target-runtime.test.mjs`

Expected: PASS with 22 tests.

- [ ] **Step 6: Run the CI-equivalent pruned webapp build**

Run:

```bash
pnpm exec turbo prune webapp --docker --out-dir /tmp/opencode/webapp-translation-ppr-verify
pnpm --dir /tmp/opencode/webapp-translation-ppr-verify/full install --lockfile-only
pnpm --dir /tmp/opencode/webapp-translation-ppr-verify/full install --frozen-lockfile
SKIP_ENV_VALIDATION=1 pnpm --dir /tmp/opencode/webapp-translation-ppr-verify/full --filter webapp run generate-licenses
CI=true SKIP_ENV_VALIDATION=1 NEXT_DEPLOYMENT_ID=verification BUILD_HASH=verification NEXT_PUBLIC_BUILD_HASH=verification pnpm --dir /tmp/opencode/webapp-translation-ppr-verify/full --filter webapp exec next build
```

Expected: The build completes static page generation without `Uncached data was accessed outside of <Suspense>` errors from `TranslationProvider` or `FontSizeProvider`.
