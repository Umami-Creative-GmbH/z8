# Hydration Streak Leaderboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-5 organization hydration streak leaderboard and hide team streaks when there is no teammate competition.

**Architecture:** Reuse the existing hydration leaderboard row type and rendering style. Extend the server action to return separate team and organization leaderboards, then render both via a small shared leaderboard component in the widget.

**Tech Stack:** Next.js server actions, Drizzle ORM, Effect, React, Vitest, Testing Library, pnpm.

---

## File Structure

- Modify `apps/webapp/src/components/dashboard/hydration-team-streak-leaders.ts`: add a configurable limit and a minimum participant rule.
- Modify `apps/webapp/src/components/dashboard/actions.ts`: return `organizationStreakLeaders`, increase team limit to 5, and query org leaders by active organization.
- Modify `apps/webapp/src/components/dashboard/hydration-widget.tsx`: add `organizationStreakLeaders` to the data type and render a shared leaderboard block for team and org lists.
- Modify `apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts`: cover max 5 and solo-team hiding helper behavior.
- Modify `apps/webapp/src/components/dashboard/hydration-widget.test.tsx`: cover org leaderboard rendering and team hiding.

### Task 1: Leaderboard Builder Behavior

**Files:**
- Modify: `apps/webapp/src/components/dashboard/hydration-team-streak-leaders.ts`
- Test: `apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts`

- [ ] **Step 1: Write failing tests for configurable limit and minimum participants**

Add tests that call `buildTeamStreakLeaders(candidates, currentUserId, { limit: 5, minimumParticipants: 2 })` and verify it returns five rows for six candidates, and returns `[]` for one candidate.

- [ ] **Step 2: Run focused tests**

Run: `pnpm vitest run apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts`

Expected: FAIL because `buildTeamStreakLeaders` does not accept the options object yet.

- [ ] **Step 3: Implement options**

Update `buildTeamStreakLeaders` to accept an optional third parameter:

```ts
type BuildTeamStreakLeadersOptions = {
	limit?: number;
	minimumParticipants?: number;
};
```

Use `limit ?? 3` to preserve current default behavior and `minimumParticipants ?? 1`. Deduplicate candidates first, return `[]` when the deduplicated count is below `minimumParticipants`, then sort and slice by `limit`.

- [ ] **Step 4: Run focused tests again**

Run: `pnpm vitest run apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts`

Expected: PASS.

### Task 2: Server Data Shape

**Files:**
- Modify: `apps/webapp/src/components/dashboard/actions.ts`

- [ ] **Step 1: Extend return type and disabled data**

Add `organizationStreakLeaders: TeamStreakLeader[]` to the `getHydrationWidgetData` result type. Return `organizationStreakLeaders: []` in the disabled branch.

- [ ] **Step 2: Increase team leaderboard limit and hide solo teams**

Call `buildTeamStreakLeaders(mappedCandidates, session.user.id, { limit: 5, minimumParticipants: 2 })` for the team query.

- [ ] **Step 3: Add org-wide leaderboard query**

After `teamStreakLeaders`, add an Effect-wrapped query that returns `[]` without an active organization. Query active employees in `activeOrganizationId`, join users, left join hydration stats, and call `buildTeamStreakLeaders(mappedCandidates, session.user.id, { limit: 5 })`.

- [ ] **Step 4: Include org leaders in final payload**

Return `organizationStreakLeaders` beside `teamStreakLeaders`.

### Task 3: Widget Rendering

**Files:**
- Modify: `apps/webapp/src/components/dashboard/hydration-widget.tsx`
- Test: `apps/webapp/src/components/dashboard/hydration-widget.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Add tests that mock `organizationStreakLeaders` and assert an `hydration-organization-streak-leaders` block appears with org rows. Add a test where `teamStreakLeaders: []` and `organizationStreakLeaders` has rows, asserting the team block is absent and the org block remains visible.

- [ ] **Step 2: Run focused widget tests**

Run: `pnpm vitest run apps/webapp/src/components/dashboard/hydration-widget.test.tsx`

Expected: FAIL because the widget does not render org leaders yet.

- [ ] **Step 3: Add shared leaderboard component**

Extract the existing leaderboard block into a local `HydrationStreakLeaderboard` component that accepts `testId`, `title`, and `leaders`. Keep the same row markup and labels.

- [ ] **Step 4: Render both lists**

Render team leaders with title `dashboard.hydration.team-streaks` / “Team streaks”. Render org leaders below with title `dashboard.hydration.organization-streaks` / “Org streaks”.

- [ ] **Step 5: Run focused widget tests again**

Run: `pnpm vitest run apps/webapp/src/components/dashboard/hydration-widget.test.tsx`

Expected: PASS.

### Task 4: Verification

**Files:**
- Existing test files only.

- [ ] **Step 1: Run all hydration dashboard tests**

Run: `pnpm vitest run apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts apps/webapp/src/components/dashboard/hydration-widget.test.tsx apps/webapp/src/components/dashboard/hydration-team-streak-leaders-query.test.ts`

Expected: PASS.

- [ ] **Step 2: Run type/lint-adjacent verification if available through test command**

Run: `pnpm test -- --run apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts apps/webapp/src/components/dashboard/hydration-widget.test.tsx`

Expected: PASS or equivalent Vitest pass output.

## Self-Review

- Spec coverage: Team hiding, top 5 limits, org leaderboard, existing styling, org scoping, and non-critical error handling are covered.
- Placeholder scan: No placeholders remain.
- Type consistency: `organizationStreakLeaders` and `TeamStreakLeader` names are consistent across tasks.
