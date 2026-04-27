# Marketing Trust Banner Dark Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the marketing trust banner quieter in dark mode while preserving clear section separation.

**Architecture:** Add a dedicated theme token for the trust banner background and apply it to the existing `LogoBar` section. Light mode stays visually unchanged by using a transparent token value, while dark mode receives a subtle dark navy-gray panel.

**Tech Stack:** Next.js marketing app, React, Tailwind utility classes, inline theme CSS variables from `apps/marketing/src/components/theme/tokens.ts`.

---

## File Structure

- Modify: `apps/marketing/src/components/theme/tokens.ts` to add `trustBannerBg` to both theme token maps.
- Modify: `apps/marketing/src/components/landing/logo-bar.tsx` to apply the new background token to the trust banner section.

### Task 1: Add Trust Banner Background Token

**Files:**
- Modify: `apps/marketing/src/components/theme/tokens.ts`
- Modify: `apps/marketing/src/components/landing/logo-bar.tsx`

- [ ] **Step 1: Add the theme token**

In `apps/marketing/src/components/theme/tokens.ts`, add `trustBannerBg` to both `light` and `dark` theme objects near the existing trust/logo tokens:

```ts
logoColor: "#d0d0d0",
trustedLabel: "#ccc",
trustBannerBg: "transparent",
```

```ts
logoColor: "#444",
trustedLabel: "#444",
trustBannerBg: "#10151c",
```

- [ ] **Step 2: Apply the token to the logo bar section**

In `apps/marketing/src/components/landing/logo-bar.tsx`, change the section style from:

```tsx
style={{ borderTop: `1px solid ${v("border")}`, transition: "border-color 0.4s ease" }}
```

to:

```tsx
style={{
	background: v("trustBannerBg"),
	borderTop: `1px solid ${v("border")}`,
	transition: "background-color 0.4s ease, border-color 0.4s ease",
}}
```

- [ ] **Step 3: Build the marketing app**

Run: `pnpm --filter marketing build`

Expected: command exits successfully and Next.js completes the production build.

- [ ] **Step 4: Review changed files**

Run: `git diff -- apps/marketing/src/components/theme/tokens.ts apps/marketing/src/components/landing/logo-bar.tsx`

Expected: only the new token and `LogoBar` background style changed.

## Self-Review

- Spec coverage: The plan covers the approved subtle-panel dark-mode treatment, preserves light mode, and keeps existing border separation.
- Placeholder scan: No placeholders remain.
- Type consistency: `trustBannerBg` is added to both theme objects, so `ThemeTokens` and `v("trustBannerBg")` remain type-safe.
