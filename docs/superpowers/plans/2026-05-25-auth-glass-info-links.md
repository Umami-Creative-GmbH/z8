# Auth Glass Info Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the auth shell into a full-background glass-card layout, move legal/trust links external, delete obsolete internal legal routes, and keep `/licenses` internal with a better scrollable layout.

**Architecture:** The auth route group layout owns the background image, top controls, and page-level footer links. `AuthFormWrapper` owns only the glass form card and optional in-card build version. `/licenses` uses the auth shell and a bounded glass info card with a scrollable table region.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS, shadcn/ui, Tolgee, Vitest, Testing Library.

---

## Files

- Modify: `apps/webapp/src/app/[locale]/(auth)/layout.tsx` - switch from split layout to full-page background and pass build hash into auth descendants.
- Modify: `apps/webapp/src/components/auth-form-wrapper.tsx` - add glass styling and optional bottom-right version label.
- Modify: `apps/webapp/src/components/auth-form-wrapper.test.tsx` - assert glass classes and in-card version rendering.
- Modify: `apps/webapp/src/components/info-footer.tsx` - replace internal legal links with external marketing-site links and remove version rendering.
- Create: `apps/webapp/src/components/info-footer.test.tsx` - verify external URLs and local licenses link.
- Delete: `apps/webapp/src/app/[locale]/(auth)/terms/page.tsx` - remove obsolete in-app terms page.
- Delete: `apps/webapp/src/app/[locale]/(auth)/privacy/page.tsx` - remove obsolete in-app privacy page.
- Modify: `apps/webapp/src/app/[locale]/(auth)/licenses/page.tsx` - use glass layout and better viewport constraints.
- Modify: `apps/webapp/src/components/licenses/license-table.tsx` - make table region reliably scrollable in the licenses card.

## Task 1: Auth Card Glass Surface and Version

- [ ] Update `apps/webapp/src/components/auth-form-wrapper.test.tsx` to assert that the wrapper can render `buildHash`, includes `backdrop-blur-md`, uses `bg-white/20`, and has dark-mode translucent styling.
- [ ] Run `pnpm --dir apps/webapp test src/components/auth-form-wrapper.test.tsx` and confirm it fails before implementation.
- [ ] Update `apps/webapp/src/components/auth-form-wrapper.tsx` with a `buildHash?: string` prop, glass card classes, relative positioning, and an absolute version label at `right-3 bottom-1.5`.
- [ ] Run `pnpm --dir apps/webapp test src/components/auth-form-wrapper.test.tsx` and confirm it passes.

## Task 2: Full-Background Auth Shell

- [ ] Update `apps/webapp/src/app/[locale]/(auth)/layout.tsx` to render the image as an absolute full-screen background with an overlay and remove `lg:grid-cols-2` plus the fixed right image panel.
- [ ] Pass the build hash to auth children through a small client/server-safe wrapper only if existing routes can consume it without broad rewrites; otherwise keep the version prop change ready for sign-in forms that already pass wrapper props.
- [ ] Verify the route shell still renders `ThemeToggle`, `LanguageSwitcher`, `InfoFooter`, and `children`.

## Task 3: External Info Footer Links

- [ ] Add `apps/webapp/src/components/info-footer.test.tsx` with assertions for `https://www.z8-time.app/terms-app`, `https://www.z8-time.app/privacy-app`, `https://www.z8-time.app/imprint`, `https://www.z8-time.app/agb`, `https://www.z8-time.app/trustcenter`, and local `/licenses`.
- [ ] Run `pnpm --dir apps/webapp test src/components/info-footer.test.tsx` and confirm it fails before implementation.
- [ ] Update `apps/webapp/src/components/info-footer.tsx` to render external anchors for legal/trust links, keep the local localized `Link` for `/licenses`, and remove build hash output.
- [ ] Run `pnpm --dir apps/webapp test src/components/info-footer.test.tsx` and confirm it passes.

## Task 4: Remove Obsolete Internal Legal Pages

- [ ] Delete `apps/webapp/src/app/[locale]/(auth)/terms/page.tsx`.
- [ ] Delete `apps/webapp/src/app/[locale]/(auth)/privacy/page.tsx`.
- [ ] Search for `/terms`, `/privacy`, `termsContent`, and `privacyContent` references and remove or update only references that point at the deleted auth pages.

## Task 5: Licenses Layout and Scroll Behavior

- [ ] Update `apps/webapp/src/app/[locale]/(auth)/licenses/page.tsx` to use a wider glass card, responsive height constraints, `backdrop-blur-md`, `bg-white/20`, and `dark:bg-slate-950/45`.
- [ ] Update `apps/webapp/src/components/licenses/license-table.tsx` so the table wrapper uses `min-h-0`, `overflow-auto`, and a sticky header background compatible with translucent cards.
- [ ] Run targeted tests or type checks for license components if available; otherwise run the nearest webapp test command.

## Task 6: Final Verification

- [ ] Run targeted tests: `pnpm --dir apps/webapp test src/components/auth-form-wrapper.test.tsx src/components/info-footer.test.tsx`.
- [ ] Run a formatting/lint command available for the package, preferring the repo's standard `pnpm --dir apps/webapp lint` if present.
- [ ] Review the diff and ensure no unrelated files were modified.
