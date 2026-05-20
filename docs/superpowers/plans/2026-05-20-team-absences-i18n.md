# Team Absences I18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded user-facing `/team/absences` table and dialog strings with Tolgee `t()` calls and locale messages.

**Architecture:** Keep the existing client components and behavior unchanged. Add `useTranslate()` to `TeamAbsencesTable`, extend existing translation use in `RecordAbsenceDialog`, and store strings under `team.absences.*` in root locale files.

**Tech Stack:** Next.js client components, React, Tolgee `@tolgee/react`, Vitest, Testing Library, pnpm.

---

## File Structure

- Modify `apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.tsx`: table/control/pagination labels and ARIA text.
- Modify `apps/webapp/src/app/[locale]/(app)/team/absences/record-absence-dialog.tsx`: dynamic title and local validation strings.
- Modify `apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.test.tsx`: make the Tolgee test mock support interpolation parameters.
- Modify `apps/webapp/messages/en.json`: source English messages.
- Modify `apps/webapp/messages/de.json`: German messages.
- Modify `apps/webapp/messages/es.json`: Spanish messages.
- Modify `apps/webapp/messages/fr.json`: French messages.
- Modify `apps/webapp/messages/it.json`: Italian messages.
- Modify `apps/webapp/messages/pt.json`: Portuguese messages.

### Task 1: Make Existing Tests Interpolation-Aware

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.test.tsx:15-17`

- [ ] **Step 1: Update the Tolgee mock**

Replace the existing mock with an interpolation-aware fallback implementation:

```tsx
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));
```

- [ ] **Step 2: Run the focused test file before implementation**

Run: `pnpm --filter webapp test apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.test.tsx`

Expected: tests pass before behavior-preserving i18n changes, or fail only because the repo test command uses a different path filter. If the command shape fails, use the package's existing focused Vitest command from `apps/webapp/package.json`.

### Task 2: Localize TeamAbsencesTable

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.tsx`

- [ ] **Step 1: Import and initialize Tolgee**

Add the import:

```tsx
import { useTranslate } from "@tolgee/react";
```

Inside `TeamAbsencesTable`, add:

```tsx
const { t } = useTranslate();
```

- [ ] **Step 2: Replace sortable header labels and ARIA strings**

Use translated labels when calling `renderSortableHeader`:

```tsx
{renderSortableHeader(t("team.absences.table.employee", "Employee"), "employee")}
{renderSortableHeader(t("team.absences.table.teamOrPosition", "Team or Position"), "team")}
{renderSortableHeader(t("team.absences.table.allowance", "Allowance"), "vacationAllowance", "text-right")}
{renderSortableHeader(t("team.absences.table.used", "Used"), "usedVacationDays", "text-right")}
{renderSortableHeader(t("team.absences.table.pending", "Pending"), "pendingVacationDays", "text-right")}
{renderSortableHeader(t("team.absences.table.left", "Left"), "remainingVacationDays", "text-right")}
{renderSortableHeader(t("team.absences.table.sick", "Sick"), "sickDays", "text-right")}
<TableHead className="text-right">{t("team.absences.table.actions", "Actions")}</TableHead>
```

Update `directionLabel` and button `aria-label` inside `renderSortableHeader`:

```tsx
const directionLabel = data.direction === "asc"
	? t("team.absences.sort.ascending", "ascending")
	: t("team.absences.sort.descending", "descending");
const sortLabel = isActive
	? t("team.absences.sort.byWithDirection", "Sort by {label} ({direction})", {
			label,
			direction: directionLabel,
		})
	: t("team.absences.sort.by", "Sort by {label}", { label });
```

Use `aria-label={sortLabel}` on the sort button.

- [ ] **Step 3: Replace controls, empty state, action, and pagination strings**

Replace search/filter strings:

```tsx
placeholder={t("team.absences.filters.searchPlaceholder", "Search employees…")}
aria-label={t("team.absences.filters.searchLabel", "Search employees")}
{t("team.absences.filters.searchSubmit", "Search")}
aria-label={t("team.absences.filters.teamLabel", "Filter by team")}
<SelectValue placeholder={t("team.absences.filters.teamPlaceholder", "Team")} />
<SelectItem value="all">{t("team.absences.filters.allTeams", "All teams")}</SelectItem>
aria-label={t("team.absences.filters.yearLabel", "Filter by year")}
<SelectValue placeholder={t("team.absences.filters.yearPlaceholder", "Year")} />
```

Replace action, empty state, and pagination strings:

```tsx
aria-label={t("team.absences.actions.recordForEmployee", "Record absence for {name}", {
	name: employee.name,
})}
aria-label={t("team.absences.empty.label", "No employees found")}
{t("team.absences.empty.title", "No employees found")}
{t("team.absences.empty.description", "Try adjusting filters or search to find team members.")}
{t("team.absences.pagination.showing", "Showing {firstItem} to {lastItem} of {total}", {
	firstItem,
	lastItem,
	total: data.total,
})}
aria-label={t("team.absences.pagination.previousLabel", "Previous page")}
{t("team.absences.pagination.previous", "Previous")}
{t("team.absences.pagination.page", "Page {page} of {pageCount}", {
	page: visiblePage,
	pageCount: visiblePageCount,
})}
aria-label={t("team.absences.pagination.nextLabel", "Next page")}
{t("team.absences.pagination.next", "Next")}
```

### Task 3: Localize RecordAbsenceDialog Remaining Local Strings

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/record-absence-dialog.tsx`

- [ ] **Step 1: Replace the required-message helper with a translation-aware local function**

Remove the module-level helper:

```tsx
function requiredMessage(label: string) {
	return `${label} is required`;
}
```

Inside `RecordAbsenceDialog`, add:

```tsx
function requiredMessage(label: string) {
	return t("team.absences.recordDialog.required", "{label} is required", { label });
}
```

- [ ] **Step 2: Translate the employee-specific title**

Replace the title expression with:

```tsx
const title = employee
	? t("team.absences.recordDialog.titleForEmployee", "Record absence for {name}", {
			name: employee.name,
		})
	: t("team.absences.recordDialog.title", "Record absence");
```

### Task 4: Add Locale Messages

**Files:**
- Modify: `apps/webapp/messages/en.json`
- Modify: `apps/webapp/messages/de.json`
- Modify: `apps/webapp/messages/es.json`
- Modify: `apps/webapp/messages/fr.json`
- Modify: `apps/webapp/messages/it.json`
- Modify: `apps/webapp/messages/pt.json`

- [ ] **Step 1: Add the English source messages**

Add this under the existing root object, merging with any existing `team.absences` object if present:

```json
"team": {
  "absences": {
    "actions": {
      "recordForEmployee": "Record absence for {name}"
    },
    "empty": {
      "description": "Try adjusting filters or search to find team members.",
      "label": "No employees found",
      "title": "No employees found"
    },
    "filters": {
      "allTeams": "All teams",
      "searchLabel": "Search employees",
      "searchPlaceholder": "Search employees…",
      "searchSubmit": "Search",
      "teamLabel": "Filter by team",
      "teamPlaceholder": "Team",
      "yearLabel": "Filter by year",
      "yearPlaceholder": "Year"
    },
    "pagination": {
      "next": "Next",
      "nextLabel": "Next page",
      "page": "Page {page} of {pageCount}",
      "previous": "Previous",
      "previousLabel": "Previous page",
      "showing": "Showing {firstItem} to {lastItem} of {total}"
    },
    "recordDialog": {
      "required": "{label} is required",
      "titleForEmployee": "Record absence for {name}"
    },
    "sort": {
      "ascending": "ascending",
      "by": "Sort by {label}",
      "byWithDirection": "Sort by {label} ({direction})",
      "descending": "descending"
    },
    "table": {
      "actions": "Actions",
      "allowance": "Allowance",
      "employee": "Employee",
      "left": "Left",
      "pending": "Pending",
      "sick": "Sick",
      "teamOrPosition": "Team or Position",
      "used": "Used"
    }
  }
}
```

- [ ] **Step 2: Add equivalent keys to `de`, `es`, `fr`, `it`, and `pt`**

Use natural translations while preserving interpolation placeholders exactly: `{name}`, `{label}`, `{direction}`, `{page}`, `{pageCount}`, `{firstItem}`, `{lastItem}`, and `{total}`.

### Task 5: Verify

**Files:**
- Test: `apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.test.tsx`

- [ ] **Step 1: Run focused tests**

Run: `pnpm --filter webapp test apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.test.tsx`

Expected: all tests in the file pass.

- [ ] **Step 2: Inspect diff**

Run: `git diff -- apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.tsx apps/webapp/src/app/[locale]/(app)/team/absences/record-absence-dialog.tsx apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.test.tsx apps/webapp/messages/en.json apps/webapp/messages/de.json apps/webapp/messages/es.json apps/webapp/messages/fr.json apps/webapp/messages/it.json apps/webapp/messages/pt.json`

Expected: only i18n-related code and message changes are present.

## Self-Review

- Spec coverage: the plan covers the table, controls, empty state, pagination, action labels, dialog title, validation helper, all locale files, and focused tests.
- Placeholder scan: no placeholder task content remains; all code examples and commands are explicit.
- Type consistency: all interpolation examples use Tolgee-compatible `t(key, fallback, params)` call sites and existing component props/state names.
