# Onboarding Week Start Preference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the existing Sunday/Monday week-start user preference to the onboarding profile setup.

**Architecture:** Reuse the existing user-level `user_settings.week_start_day` field and `WeekStartDay` helpers. Extend the onboarding profile schema, submit the value from the profile form, and persist it in `OnboardingService.updateProfile` alongside the onboarding step update.

**Tech Stack:** Next.js App Router, React, TanStack Form, Drizzle ORM, Effect services, Zod, Vitest, pnpm.

---

## File Structure

- Modify `apps/webapp/src/lib/validations/onboarding.ts`: add `weekStartDay` to the profile onboarding schema and exported form values.
- Modify `apps/webapp/src/app/[locale]/onboarding/profile/page.tsx`: add a Sunday/Monday select to the onboarding profile form default values and submit payload.
- Modify `apps/webapp/src/lib/effect/services/onboarding.service.ts`: persist `weekStartDay` into `userSettings` during profile completion.
- Test existing focused targets if available; otherwise run the closest validation/unit tests and TypeScript checks for `apps/webapp`.

## Task 1: Extend Onboarding Profile Schema

**Files:**
- Modify: `apps/webapp/src/lib/validations/onboarding.ts`

- [ ] **Step 1: Add a failing schema expectation if a validation test exists**

Search for existing onboarding validation tests:

Run: `pnpm --filter webapp test -- --run src/lib/validations/onboarding.test.ts`

Expected: If the file does not exist, Vitest reports no matching test file. Continue to Step 2 without creating broad new test infrastructure.

- [ ] **Step 2: Update the schema**

Change `onboardingProfileSchema` to include the preference:

```ts
export const onboardingProfileSchema = z.object({
	firstName: z.string().min(1, "First name is required").max(50),
	lastName: z.string().min(1, "Last name is required").max(50),
	gender: z.enum(["male", "female", "other"]).optional(),
	birthday: z.date().optional(),
	weekStartDay: z.enum(["sunday", "monday"]).default("sunday"),
});
```

- [ ] **Step 3: Verify TypeScript accepts the schema change**

Run: `pnpm --filter webapp typecheck`

Expected: PASS or unrelated pre-existing errors only. If `typecheck` is not defined, run `pnpm --filter webapp exec tsc --noEmit`.

## Task 2: Add the Select to the Onboarding Profile Form

**Files:**
- Modify: `apps/webapp/src/app/[locale]/onboarding/profile/page.tsx`

- [ ] **Step 1: Import select UI and week-start options**

Add imports near the existing UI imports:

```ts
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { WEEK_START_OPTIONS, type WeekStartDay } from "@/lib/user-preferences/week-start";
```

- [ ] **Step 2: Add the default form value**

Update `defaultValues`:

```ts
const defaultValues = {
	firstName: "",
	lastName: "",
	gender: undefined as "male" | "female" | "other" | undefined,
	birthday: undefined as Date | undefined,
	weekStartDay: "sunday" as WeekStartDay,
};
```

- [ ] **Step 3: Render the week-start select before action buttons**

Insert this form field after the birthday field and before the action buttons:

```tsx
<form.Field name="weekStartDay">
	{(field) => (
		<div className="space-y-2">
			<Label>{t("onboarding.profile.weekStartDay", "First day of the week")}</Label>
			<Select
				value={field.state.value}
				onValueChange={(value) => field.handleChange(value as WeekStartDay)}
				disabled={loading}
			>
				<SelectTrigger className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{WEEK_START_OPTIONS.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p className="text-sm text-muted-foreground">
				{t(
					"onboarding.profile.weekStartDayDesc",
					"This controls how calendars and weekly summaries are displayed.",
				)}
			</p>
		</div>
	)}
</form.Field>
```

- [ ] **Step 4: Run a focused compile check**

Run: `pnpm --filter webapp typecheck`

Expected: PASS or unrelated pre-existing errors only.

## Task 3: Persist the Preference During Profile Completion

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/onboarding.service.ts`

- [ ] **Step 1: Update the existing user settings upsert**

In `updateProfile`, modify the `userSettings` upsert so both insert and conflict update include `weekStartDay`:

```ts
await dbService.db
	.insert(userSettings)
	.values({
		userId: session.user.id,
		onboardingStep: nextStep,
		weekStartDay: data.weekStartDay,
	})
	.onConflictDoUpdate({
		target: userSettings.userId,
		set: {
			onboardingStep: nextStep,
			weekStartDay: data.weekStartDay,
		},
	});
```

- [ ] **Step 2: Leave skip behavior unchanged**

Confirm `skipProfileSetup` still only updates `onboardingStep`, preserving the database default of Sunday for users who skip profile setup.

- [ ] **Step 3: Run focused tests**

Run: `pnpm --filter webapp test -- --run src/lib/user-preferences/week-start.test.ts`

Expected: PASS.

## Task 4: Verify End-to-End Quality

**Files:**
- Verify modified files only.

- [ ] **Step 1: Run formatting/linting for the package**

Run: `pnpm --filter webapp lint`

Expected: PASS or unrelated pre-existing errors only.

- [ ] **Step 2: Run tests for the package**

Run: `pnpm --filter webapp test -- --run`

Expected: PASS or unrelated pre-existing errors only.

- [ ] **Step 3: Review git diff**

Run: `git diff -- apps/webapp/src/lib/validations/onboarding.ts apps/webapp/src/app/[locale]/onboarding/profile/page.tsx apps/webapp/src/lib/effect/services/onboarding.service.ts docs/superpowers/specs/2026-05-08-onboarding-week-start-preference-design.md docs/superpowers/plans/2026-05-08-onboarding-week-start-preference.md`

Expected: Diff only shows the onboarding week-start preference and the supporting spec/plan. Do not commit unless the user explicitly requests a commit.
