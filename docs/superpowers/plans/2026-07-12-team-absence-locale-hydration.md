# Team Absence Calendar Locale Hydration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make team absence calendar day labels render with the same application locale during SSR and browser hydration.

**Architecture:** Read the active Tolgee language once in `TeamAbsenceYearCalendar`, then pass the locale through `TeamAbsenceMonth` and `TeamAbsenceDayDetails` to the date-label formatter. Keep UTC Luxon calendar arithmetic unchanged and make only display formatting locale-explicit.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tolgee, Luxon, Vitest, Testing Library

## Global Constraints

- Preserve UTC calendar construction and ISO date keys.
- Use Tolgee's active language as the display locale, with `en` only as the missing-language fallback.
- Do not add translation keys or change calendar layout, interactions, business boundaries, or existing fallback copy.
- Use pnpm for every command.

---

### Task 1: Make day-label formatting application-locale stable

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.test.tsx:8-130`
- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.tsx:3-270`

**Interfaces:**
- Consumes: Tolgee `useTolgee(["language"]).getLanguage(): string | undefined` and existing UTC Luxon `DateTime` values.
- Produces: `formatDateLabel(date: DateTime, locale: string): string` and `buildDayLabel(day, date, locale, isToday?): string`; internal month and detail components receive a required `locale: string` prop.

- [x] **Step 1: Write the failing locale-stability regression test**

Because the existing assertions expect English dates, make the mocked application language mutable and reset it after every test:

```tsx
let applicationLocale = "en";

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({
		getLanguage: () => applicationLocale,
	}),
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));

afterEach(() => {
	Settings.now = () => Date.now();
	Settings.defaultLocale = null;
	applicationLocale = "en";
});
```

Add this test inside the existing `describe` block:

```tsx
it("formats day labels with the application locale instead of the runtime default", () => {
	Settings.defaultLocale = "en-US";
	applicationLocale = "de";

	render(
		<TeamAbsenceYearCalendar
			data={{
				year: 2026,
				teamId: null,
				entries: [],
			}}
		/>,
	);

	expect(screen.getByRole("button", { name: "12. Juni 2026" })).toBeTruthy();
});
```

- [x] **Step 2: Run the focused test and verify the expected failure**

Run:

```bash
pnpm --filter ./apps/webapp test --run 'src/app/[locale]/(app)/team/absences/team-absence-year-calendar.test.tsx'
```

Expected: the new test fails because the button is still labelled `June 12, 2026`, proving that formatting inherits `Settings.defaultLocale` instead of Tolgee's `de` language.

- [x] **Step 3: Implement explicit locale propagation**

Import `useTolgee` with `useTranslate`, then make label formatting require a locale:

```tsx
import { useTolgee, useTranslate } from "@tolgee/react";

function formatDateLabel(date: DateTime, locale: string): string {
	return date.setLocale(locale).toLocaleString({
		month: "long",
		day: "numeric",
		year: "numeric",
	});
}

function buildDayLabel(
	day: ManagerAbsenceCalendarDay | undefined,
	date: DateTime,
	locale: string,
	isToday = false,
): string {
	const dateLabel = `${isToday ? "Today, " : ""}${formatDateLabel(date, locale)}`;

	if (!day) {
		return dateLabel;
	}

	const pendingPart = day.pendingCount > 0 ? `, ${day.pendingCount} pending` : "";

	return `${dateLabel}: ${day.totalCount} absent${pendingPart}`;
}
```

Add `locale: string` to the `TeamAbsenceDayDetails` and `TeamAbsenceMonth` props, and pass it to every label call:

```tsx
<p className="font-medium">{buildDayLabel(day, date, locale)}</p>

<button aria-label={buildDayLabel(day, date, locale, isToday)}>

<TeamAbsenceDayDetails dateKey={dateKey} day={day} date={date} locale={locale} />
```

Read the active language in the root component and pass it into every month:

```tsx
const tolgee = useTolgee(["language"]);
const locale = tolgee.getLanguage() ?? "en";

<TeamAbsenceMonth
	key={month}
	month={month}
	year={data.year}
	monthName={monthNames[month - 1] ?? String(month)}
	weekdays={weekdays}
	weekStartDay={weekStartDay}
	daysByDate={daysByDate}
	todayDateKey={todayDateKey}
	locale={locale}
/>
```

- [x] **Step 4: Run the focused regression suite and verify green**

Run:

```bash
pnpm --filter ./apps/webapp test --run 'src/app/[locale]/(app)/team/absences/team-absence-year-calendar.test.tsx'
```

Expected: all five calendar tests pass with no warnings or recoverable hydration errors.

- [x] **Step 5: Run static verification for the changed files**

Run:

```bash
pnpm exec ultracite check 'apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.tsx' 'apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.test.tsx'
pnpm --filter ./apps/webapp typecheck
git diff --check
```

Expected: every command exits with status 0. If repository-wide type checking reports an unrelated concurrent-work failure, preserve that work and report the exact failure separately.

- [x] **Step 6: Commit the isolated bug fix**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.tsx' 'apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.test.tsx' docs/superpowers/plans/2026-07-12-team-absence-locale-hydration.md
git commit -m "fix: stabilize absence calendar locale hydration"
```
