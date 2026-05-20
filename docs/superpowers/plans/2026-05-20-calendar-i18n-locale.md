# Calendar i18n and Locale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded `/calendar` strings with Tolgee translations and use the active Tolgee language for calendar date labels.

**Architecture:** Keep the existing calendar components and state flow. Add Tolgee translation and language reads inside `schedule-x-calendar.tsx`, reuse the existing Tolgee language read in `year-calendar-view.tsx`, and add `calendar.view.*` keys to the calendar namespace locale files.

**Tech Stack:** Next.js client components, React, Tolgee `@tolgee/react`, Luxon `DateTime`, Schedule-X, pnpm.

---

## File Structure

- Modify `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`: translate custom controls, format Luxon ranges with the active locale, and pass the locale to Schedule-X if accepted by its config type.
- Modify `apps/webapp/src/components/calendar/year-calendar-view.tsx`: translate the remaining hardcoded custom controls.
- Modify `apps/webapp/messages/calendar/en.json`, `de.json`, `es.json`, `fr.json`, `it.json`, `pt.json`: add the shared `calendar.view.*` keys.

### Task 1: Add Translation Keys

**Files:**
- Modify: `apps/webapp/messages/calendar/en.json:201-211`
- Modify: `apps/webapp/messages/calendar/de.json`
- Modify: `apps/webapp/messages/calendar/es.json`
- Modify: `apps/webapp/messages/calendar/fr.json`
- Modify: `apps/webapp/messages/calendar/it.json`
- Modify: `apps/webapp/messages/calendar/pt.json`

- [ ] **Step 1: Add English keys**

In `apps/webapp/messages/calendar/en.json`, add this sibling object under top-level `calendar`, after `legend` and before `split`:

```json
"view": {
  "day": "Day",
  "loading": "Loading calendar...",
  "month": "Month",
  "refresh": "Refresh",
  "today": "Today",
  "week": "Week",
  "year": "Year"
}
```

- [ ] **Step 2: Add translated keys to the other calendar locale files**

Use the same key names in each file. Use these values:

```json
// de.json
"view": {
  "day": "Tag",
  "loading": "Kalender wird geladen...",
  "month": "Monat",
  "refresh": "Aktualisieren",
  "today": "Heute",
  "week": "Woche",
  "year": "Jahr"
}
```

```json
// es.json
"view": {
  "day": "Día",
  "loading": "Cargando calendario...",
  "month": "Mes",
  "refresh": "Actualizar",
  "today": "Hoy",
  "week": "Semana",
  "year": "Año"
}
```

```json
// fr.json
"view": {
  "day": "Jour",
  "loading": "Chargement du calendrier...",
  "month": "Mois",
  "refresh": "Actualiser",
  "today": "Aujourd'hui",
  "week": "Semaine",
  "year": "Année"
}
```

```json
// it.json
"view": {
  "day": "Giorno",
  "loading": "Caricamento calendario...",
  "month": "Mese",
  "refresh": "Aggiorna",
  "today": "Oggi",
  "week": "Settimana",
  "year": "Anno"
}
```

```json
// pt.json
"view": {
  "day": "Dia",
  "loading": "Carregando calendário...",
  "month": "Mês",
  "refresh": "Atualizar",
  "today": "Hoje",
  "week": "Semana",
  "year": "Ano"
}
```

- [ ] **Step 3: Validate JSON**

Run: `pnpm --filter webapp exec prettier --check messages/calendar/en.json messages/calendar/de.json messages/calendar/es.json messages/calendar/fr.json messages/calendar/it.json messages/calendar/pt.json`

Expected: all files parse; formatting may fail if the repo expects formatting changes. If formatting fails, run the matching `--write` command on only these files.

### Task 2: Localize Schedule-X Wrapper

**Files:**
- Modify: `apps/webapp/src/components/calendar/schedule-x-calendar.tsx:20-224`

- [ ] **Step 1: Import Tolgee hooks**

Add this import near the other package imports:

```ts
import { useTolgee, useTranslate } from "@tolgee/react";
```

- [ ] **Step 2: Read translations and locale**

Inside `ScheduleXCalendarWrapper`, after `const { resolvedTheme } = useTheme();`, add:

```ts
const { t } = useTranslate();
const tolgee = useTolgee(["language"]);
const locale = tolgee.getLanguage() ?? "en";
```

- [ ] **Step 3: Format date ranges with locale**

At the start of the `dateRangeDisplay` memo, add:

```ts
const localizedCurrentDate = currentDate.setLocale(locale);
```

Then replace each `currentDate.toFormat(...)` call in that memo with `localizedCurrentDate.toFormat(...)`. Replace week bounds input with `localizedCurrentDate`:

```ts
const { start: weekStart, end: weekEnd } = getWeekBounds(localizedCurrentDate, weekStartDay);
```

Update the dependency array from:

```ts
}, [viewMode, currentDate, weekStartDay]);
```

to:

```ts
}, [viewMode, currentDate, weekStartDay, locale]);
```

- [ ] **Step 4: Pass locale into Schedule-X config if supported**

In the `useCalendarApp` config object, add:

```ts
locale,
```

Run TypeScript verification after this task. If Schedule-X types reject `locale`, remove this property and keep the custom wrapper localized.

- [ ] **Step 5: Replace hardcoded JSX strings**

Replace these strings in the return block:

```tsx
<div className="animate-pulse text-muted-foreground">
  {t("calendar.view.loading", "Loading calendar...")}
</div>
```

```tsx
<Button variant="outline" size="sm" onClick={navigateToday}>
  {t("calendar.view.today", "Today")}
</Button>
```

```tsx
<Button
  variant="outline"
  size="icon"
  onClick={onRefresh}
  title={t("calendar.view.refresh", "Refresh")}
>
```

```tsx
<TabsTrigger value="day">{t("calendar.view.day", "Day")}</TabsTrigger>
<TabsTrigger value="week">{t("calendar.view.week", "Week")}</TabsTrigger>
<TabsTrigger value="month">{t("calendar.view.month", "Month")}</TabsTrigger>
<TabsTrigger value="year">{t("calendar.view.year", "Year")}</TabsTrigger>
```

- [ ] **Step 6: Verify this file**

Run: `pnpm --filter webapp exec tsc --noEmit`

Expected: no new TypeScript errors. If the only error is `locale` not existing in the Schedule-X config type, remove the `locale` config property and rerun.

### Task 3: Localize Year Calendar Controls

**Files:**
- Modify: `apps/webapp/src/components/calendar/year-calendar-view.tsx:197-224`

- [ ] **Step 1: Replace Today button text**

Replace:

```tsx
Today
```

with:

```tsx
{t("calendar.view.today", "Today")}
```

- [ ] **Step 2: Replace view tab text**

Replace the four hardcoded tab labels with:

```tsx
<TabsTrigger value="day">{t("calendar.view.day", "Day")}</TabsTrigger>
<TabsTrigger value="week">{t("calendar.view.week", "Week")}</TabsTrigger>
<TabsTrigger value="month">{t("calendar.view.month", "Month")}</TabsTrigger>
<TabsTrigger value="year">{t("calendar.view.year", "Year")}</TabsTrigger>
```

- [ ] **Step 3: Verify no hardcoded calendar controls remain**

Run: `rg 'Loading calendar|title="Refresh"|>Today<|>Day<|>Week<|>Month<|>Year<' apps/webapp/src/components/calendar`

Expected: no matches for `schedule-x-calendar.tsx` or `year-calendar-view.tsx` hardcoded controls.

### Task 4: Final Verification

**Files:**
- Verify: modified calendar components and locale files

- [ ] **Step 1: Run focused checks**

Run: `pnpm --filter webapp exec tsc --noEmit`

Expected: command exits successfully or only reports pre-existing unrelated errors.

- [ ] **Step 2: Run tests if feasible**

Run: `pnpm --filter webapp test`

Expected: command exits successfully or reports pre-existing unrelated failures. Capture the result in the final response.

- [ ] **Step 3: Inspect diff**

Run: `git diff -- apps/webapp/src/components/calendar/schedule-x-calendar.tsx apps/webapp/src/components/calendar/year-calendar-view.tsx apps/webapp/messages/calendar/en.json apps/webapp/messages/calendar/de.json apps/webapp/messages/calendar/es.json apps/webapp/messages/calendar/fr.json apps/webapp/messages/calendar/it.json apps/webapp/messages/calendar/pt.json`

Expected: diff only contains calendar localization and locale formatting changes.

## Self-Review

- Spec coverage: the plan covers hardcoded custom controls, active Tolgee language for custom date labels, existing week-start behavior, Schedule-X locale best effort, and all calendar locale namespace files.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: all translation keys use `calendar.view.*`; component names and file paths match the explored code.
