# Trial Banner Billing Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the trial banner once Stripe subscription setup is prepared, and restrict the banner upgrade button to organization owners/admins.

**Architecture:** Keep the billing banner as a presentational client component and derive visibility in the server app layout. Use the existing subscription table as the local source of truth: a `trialing` subscription with `stripeSubscriptionId` means checkout created a Stripe subscription that should collect payment after trial end.

**Tech Stack:** Next.js App Router, React, Drizzle ORM, Better Auth organization membership, Vitest, Testing Library, Tolgee.

---

## File Structure

- Modify `apps/webapp/src/components/billing/trial-banner.tsx`: add a boolean prop that controls whether the upgrade link renders.
- Modify `apps/webapp/src/components/billing/trial-banner.test.tsx`: test button visibility and source-level layout wiring.
- Modify `apps/webapp/src/app/[locale]/(app)/layout.tsx`: fetch active membership and subscription row, derive banner/action visibility.

## Tasks

- Task 1: Add `showUpgradeButton` to `TrialBanner` and cover both visible/hidden link states.
- Task 2: Fetch active membership and subscription row in the app layout, hide prepared Stripe-backed trials, and pass `showUpgradeButton={canManageBilling}`.
- Task 3: Run focused verification, broader tests when feasible, and inspect the final diff.

## Self-Review

- Spec coverage: The plan covers owner/admin-only upgrade button, prepared Stripe subscription hiding, existing local trial behavior, and testing.
- Placeholder scan: No placeholder implementation steps remain.
- Type consistency: The plan consistently uses `showUpgradeButton`, `membershipRole`, `canManageBilling`, and `hasPreparedTrialSubscription`.
