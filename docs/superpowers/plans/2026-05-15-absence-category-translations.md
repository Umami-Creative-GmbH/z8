# Absence Category Translations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add localized absence category names and descriptions, using app translations for built-in defaults and organization-owned JSON maps for custom categories.

**Architecture:** Add two nullable `jsonb` columns to `absence_category`, normalize them in the existing vacation settings server actions, and route all category display text through a shared helper. The settings form remains the write surface and adds locale-specific translation inputs while replacing hardcoded form copy with `t()` calls.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle ORM, PostgreSQL `jsonb`, TanStack Form, Tolgee `useTranslate`, Vitest, Testing Library.

---

## File Structure

- Modify `apps/webapp/src/db/schema/absence.ts`: add typed JSON translation columns to `absenceCategory`.
- Create `apps/webapp/drizzle/0022_absence_category_translations.sql`: add the database columns.
- Create `apps/webapp/src/lib/absences/category-display.ts`: centralize name and description display fallback logic.
- Create `apps/webapp/src/lib/absences/category-display.test.ts`: cover built-in `t()` fallback, custom locale match, and canonical fallback.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/vacation/actions.ts`: accept, normalize, and persist translation maps.
- Modify `apps/webapp/src/components/settings/absence-category-form.tsx`: include translation fields, normalize payload, and localize existing hardcoded sheet strings.
- Modify `apps/webapp/src/components/settings/absence-category-form.test.tsx`: cover translation defaults and payload normalization.
- Modify `apps/webapp/src/components/settings/absence-categories-table.tsx`: display localized category text and pass the current locale into helpers.
- Modify `apps/webapp/src/components/settings/absence-categories-table.test.tsx`: keep mocks aligned with the new category shape and add a custom translation display test.
- Modify `apps/webapp/messages/settings/en.json`, `de.json`, `fr.json`, `es.json`, `it.json`, `pt.json`: add form, default category, and helper strings.

## Task 1: Database Shape

**Files:**
- Modify: `apps/webapp/src/db/schema/absence.ts:1-44`
- Create: `apps/webapp/drizzle/0022_absence_category_translations.sql`

- [ ] **Step 1: Update the Drizzle schema**

In `apps/webapp/src/db/schema/absence.ts`, add `jsonb` to the import from `drizzle-orm/pg-core` and add this exported type near the imports:

```ts
export type LocaleTranslationMap = Record<string, string>;
```

Then add these fields to `absenceCategory` after `description`:

```ts
nameTranslations: jsonb("name_translations").$type<LocaleTranslationMap | null>(),
descriptionTranslations: jsonb("description_translations").$type<LocaleTranslationMap | null>(),
```

- [ ] **Step 2: Add the SQL migration**

Create `apps/webapp/drizzle/0022_absence_category_translations.sql` with:

```sql
ALTER TABLE "absence_category" ADD COLUMN "name_translations" jsonb;
ALTER TABLE "absence_category" ADD COLUMN "description_translations" jsonb;
```

- [ ] **Step 3: Run typecheck-focused tests for schema consumers**

Run:

```bash
pnpm --filter webapp test src/components/settings/absence-category-form.test.tsx
```

Expected: existing tests still pass or fail only because later tasks have not updated TypeScript callers yet.

- [ ] **Step 4: Commit database shape**

```bash
git add apps/webapp/src/db/schema/absence.ts apps/webapp/drizzle/0022_absence_category_translations.sql
git commit -m "feat: add absence category translation columns"
```

## Task 2: Display Helper

**Files:**
- Create: `apps/webapp/src/lib/absences/category-display.ts`
- Create: `apps/webapp/src/lib/absences/category-display.test.ts`

- [ ] **Step 1: Write failing display-helper tests**

Create `apps/webapp/src/lib/absences/category-display.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
	getAbsenceCategoryDisplayDescription,
	getAbsenceCategoryDisplayName,
} from "./category-display";

const t = vi.fn((key: string, fallback: string) => `${key}:${fallback}`);

describe("absence category display helpers", () => {
	it("uses app translations for built-in category names", () => {
		expect(
			getAbsenceCategoryDisplayName(
				{
					type: "vacation",
					name: "Vacation",
					nameTranslations: { de: "Urlaub custom" },
				},
				"de",
				t,
			),
		).toBe("settings.absenceCategories.defaults.vacation.name:Vacation");
	});

	it("uses custom category translations for the active locale", () => {
		expect(
			getAbsenceCategoryDisplayName(
				{
					type: "custom",
					name: "Training",
					nameTranslations: { de: "Schulung" },
				},
				"de",
				t,
			),
		).toBe("Schulung");
	});

	it("falls back to canonical custom category values", () => {
		expect(
			getAbsenceCategoryDisplayName(
				{ type: "custom", name: "Training", nameTranslations: { fr: "Formation" } },
				"de",
				t,
			),
		).toBe("Training");
	});

	it("uses app translations for built-in descriptions", () => {
		expect(
			getAbsenceCategoryDisplayDescription(
				{
					type: "sick",
					description: "Sick day",
					descriptionTranslations: { de: "Krankheit custom" },
				},
				"de",
				t,
			),
		).toBe("settings.absenceCategories.defaults.sick.description:Sick day");
	});

	it("returns null when no description exists", () => {
		expect(
			getAbsenceCategoryDisplayDescription(
				{ type: "custom", description: null, descriptionTranslations: { de: "" } },
				"de",
				t,
			),
		).toBeNull();
	});
});
```

- [ ] **Step 2: Run the new tests and verify failure**

Run:

```bash
pnpm --filter webapp test src/lib/absences/category-display.test.ts
```

Expected: FAIL because `category-display.ts` does not exist.

- [ ] **Step 3: Implement the display helper**

Create `apps/webapp/src/lib/absences/category-display.ts`:

```ts
import type { LocaleTranslationMap } from "@/db/schema/absence";

export type AbsenceCategoryDisplayType =
	| "home_office"
	| "sick"
	| "vacation"
	| "personal"
	| "unpaid"
	| "parental"
	| "bereavement"
	| "custom";

type Translate = (key: string, fallback: string) => string;

type AbsenceCategoryDisplayInput = {
	type: string;
	name?: string;
	description?: string | null;
	nameTranslations?: LocaleTranslationMap | null;
	descriptionTranslations?: LocaleTranslationMap | null;
};

const BUILT_IN_CATEGORY_TYPES = new Set<AbsenceCategoryDisplayType>([
	"home_office",
	"sick",
	"vacation",
	"personal",
	"unpaid",
	"parental",
	"bereavement",
]);

function isBuiltInCategoryType(type: string): type is AbsenceCategoryDisplayType {
	return BUILT_IN_CATEGORY_TYPES.has(type as AbsenceCategoryDisplayType);
}

function getLocaleTranslation(
	translations: LocaleTranslationMap | null | undefined,
	locale: string,
) {
	const translated = translations?.[locale]?.trim();
	return translated || null;
}

export function getAbsenceCategoryDisplayName(
	category: AbsenceCategoryDisplayInput,
	locale: string,
	t: Translate,
) {
	const fallback = category.name?.trim() || category.type;

	if (isBuiltInCategoryType(category.type)) {
		return t(`settings.absenceCategories.defaults.${category.type}.name`, fallback);
	}

	return getLocaleTranslation(category.nameTranslations, locale) ?? fallback;
}

export function getAbsenceCategoryDisplayDescription(
	category: AbsenceCategoryDisplayInput,
	locale: string,
	t: Translate,
) {
	const fallback = category.description?.trim() || null;

	if (isBuiltInCategoryType(category.type)) {
		return fallback
			? t(`settings.absenceCategories.defaults.${category.type}.description`, fallback)
			: null;
	}

	return getLocaleTranslation(category.descriptionTranslations, locale) ?? fallback;
}
```

- [ ] **Step 4: Run the display-helper tests**

Run:

```bash
pnpm --filter webapp test src/lib/absences/category-display.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit display helper**

```bash
git add apps/webapp/src/lib/absences/category-display.ts apps/webapp/src/lib/absences/category-display.test.ts
git commit -m "feat: localize absence category display text"
```

## Task 3: Server Action Translation Normalization

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/vacation/actions.ts:39-72,847-857,927-938`

- [ ] **Step 1: Extend the write type and normalizer**

In `apps/webapp/src/app/[locale]/(app)/settings/vacation/actions.ts`, import `LocaleTranslationMap`:

```ts
import type { LocaleTranslationMap } from "@/db/schema/absence";
```

Extend `AbsenceCategoryWriteData`:

```ts
type AbsenceCategoryWriteData = {
	type: AbsenceCategoryType;
	name: string;
	description?: string | null;
	nameTranslations?: LocaleTranslationMap | null;
	descriptionTranslations?: LocaleTranslationMap | null;
	requiresWorkTime: boolean;
	requiresApproval: boolean;
	countsAgainstVacation: boolean;
	color?: string | null;
	isActive?: boolean;
};
```

Add this helper below `normalizeOptionalText`:

```ts
function normalizeTranslationMap(value: LocaleTranslationMap | null | undefined) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}

	const entries = Object.entries(value)
		.map(([locale, translation]) => [locale.trim(), translation.trim()] as const)
		.filter(([locale, translation]) => locale && translation);

	return entries.length > 0 ? Object.fromEntries(entries) : null;
}
```

Update `normalizeAbsenceCategoryData` to include:

```ts
nameTranslations: normalizeTranslationMap(data.nameTranslations),
descriptionTranslations: normalizeTranslationMap(data.descriptionTranslations),
```

- [ ] **Step 2: Persist translations on create and update**

In `createAbsenceCategory`, include these values in `.values({ ... })`:

```ts
nameTranslations: normalized.nameTranslations,
descriptionTranslations: normalized.descriptionTranslations,
```

In `updateAbsenceCategory`, include the same two fields in `.set({ ... })`.

- [ ] **Step 3: Run action scope tests**

Run:

```bash
pnpm --filter webapp test src/app/[locale]/\(app\)/settings/vacation/actions.scope.test.ts
```

Expected: PASS. If TypeScript complains about fixtures missing new fields, add `nameTranslations: null` and `descriptionTranslations: null` to affected absence category test objects.

- [ ] **Step 4: Commit server action changes**

```bash
git add apps/webapp/src/app/[locale]/\(app\)/settings/vacation/actions.ts apps/webapp/src/app/[locale]/\(app\)/settings/vacation/actions.scope.test.ts
git commit -m "feat: persist absence category translation maps"
```

## Task 4: Settings Form Translations

**Files:**
- Modify: `apps/webapp/src/components/settings/absence-category-form.tsx`
- Modify: `apps/webapp/src/components/settings/absence-category-form.test.tsx`

- [ ] **Step 1: Update form helper tests first**

In `apps/webapp/src/components/settings/absence-category-form.test.tsx`, update expected default values to include:

```ts
nameTranslations: {},
descriptionTranslations: {},
```

Update existing category fixtures with:

```ts
nameTranslations: { de: "Krankheit" },
descriptionTranslations: { de: "Medizinische Abwesenheit" },
```

Add this test to the `absence category form helpers` block:

```ts
it("normalizes custom translation maps in the payload", () => {
	expect(
		buildAbsenceCategoryPayload({
			...defaultAbsenceCategoryFormValues,
			name: "Training",
			description: "Training day",
			nameTranslations: { de: " Schulung ", fr: "" },
			descriptionTranslations: { de: " Weiterbildung ", fr: "   " },
		}),
	).toMatchObject({
		nameTranslations: { de: "Schulung" },
		descriptionTranslations: { de: "Weiterbildung" },
	});
});
```

- [ ] **Step 2: Run form tests and verify failure**

Run:

```bash
pnpm --filter webapp test src/components/settings/absence-category-form.test.tsx
```

Expected: FAIL because the form values and payload do not include translations yet.

- [ ] **Step 3: Extend form types and helpers**

In `apps/webapp/src/components/settings/absence-category-form.tsx`, import locale constants:

```ts
import { ALL_LANGUAGES } from "@/tolgee/shared";
```

Add `nameTranslations` and `descriptionTranslations` to `AbsenceCategoryForSettings` and `AbsenceCategoryFormValues` as `Record<string, string>` maps. Add both empty maps to `defaultAbsenceCategoryFormValues`.

Add this helper near `getFieldError`:

```ts
function normalizeTranslationMap(value: Record<string, string>) {
	const entries = Object.entries(value)
		.map(([locale, translation]) => [locale.trim(), translation.trim()] as const)
		.filter(([locale, translation]) => locale && translation);

	return Object.fromEntries(entries);
}
```

Update `getAbsenceCategoryFormValues`, the `useEffect` reset values, and `buildAbsenceCategoryPayload` so both translation maps round-trip and payload maps are trimmed.

- [ ] **Step 4: Localize existing hardcoded form strings**

Replace hardcoded labels, placeholders, helper text, validation messages, and type option labels in `absence-category-form.tsx` with `t()` keys under `settings.absenceCategories.form.*`. For example:

```tsx
<Label htmlFor="absenceCategoryName">{t("settings.absenceCategories.form.name", "Name")}</Label>
```

Use `t()` for the Zod fallback messages:

```ts
.min(1, t("settings.absenceCategories.form.nameRequired", "Category name is required"))
.max(100, t("settings.absenceCategories.form.nameMaxLength", "Use 100 characters or fewer"))
```

- [ ] **Step 5: Add translation inputs**

After the description field, add a translations section:

```tsx
<div className="space-y-3 rounded-lg border p-4">
	<div className="space-y-1">
		<h3 className="font-medium text-sm">
			{t("settings.absenceCategories.form.translations", "Translations")}
		</h3>
		<p className="text-sm text-muted-foreground">
			{t(
				"settings.absenceCategories.form.translationsHelp",
				"Optional localized labels for employees using another app language.",
			)}
		</p>
	</div>
	{ALL_LANGUAGES.map((locale) => (
		<div key={locale} className="grid gap-3 md:grid-cols-2">
			<form.Field name={`nameTranslations.${locale}`}>
				{(field) => (
					<div className="space-y-2">
						<Label htmlFor={`absenceCategoryNameTranslation-${locale}`}>
							{t("settings.absenceCategories.form.translatedName", "{locale} name", {
								locale: locale.toUpperCase(),
							})}
						</Label>
						<Input
							id={`absenceCategoryNameTranslation-${locale}`}
							value={field.state.value ?? ""}
							onChange={(event) => field.handleChange(event.target.value)}
							onBlur={field.handleBlur}
							placeholder={t("settings.absenceCategories.form.translatedNamePlaceholder", "Localized name")}
						/>
					</div>
				)}
			</form.Field>
			<form.Field name={`descriptionTranslations.${locale}`}>
				{(field) => (
					<div className="space-y-2">
						<Label htmlFor={`absenceCategoryDescriptionTranslation-${locale}`}>
							{t("settings.absenceCategories.form.translatedDescription", "{locale} description", {
								locale: locale.toUpperCase(),
							})}
						</Label>
						<Input
							id={`absenceCategoryDescriptionTranslation-${locale}`}
							value={field.state.value ?? ""}
							onChange={(event) => field.handleChange(event.target.value)}
							onBlur={field.handleBlur}
							placeholder={t(
								"settings.absenceCategories.form.translatedDescriptionPlaceholder",
								"Localized description",
							)}
						/>
					</div>
				)}
			</form.Field>
		</div>
	))}
</div>
```

- [ ] **Step 6: Run form tests**

Run:

```bash
pnpm --filter webapp test src/components/settings/absence-category-form.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit form changes**

```bash
git add apps/webapp/src/components/settings/absence-category-form.tsx apps/webapp/src/components/settings/absence-category-form.test.tsx
git commit -m "feat: edit absence category translations"
```

## Task 5: Settings Table Localized Display

**Files:**
- Modify: `apps/webapp/src/components/settings/absence-categories-table.tsx`
- Modify: `apps/webapp/src/components/settings/absence-categories-table.test.tsx`

- [ ] **Step 1: Update the table test data and add a display test**

In `apps/webapp/src/components/settings/absence-categories-table.test.tsx`, update category fixtures with translation fields:

```ts
nameTranslations: null,
descriptionTranslations: null,
```

Add this test:

```ts
it("shows custom category translations for the active locale", async () => {
	mocks.getAbsenceCategoriesForSettings.mockResolvedValue({
		success: true,
		data: [
			{
				...categories[1],
				nameTranslations: { de: "Schulung" },
				descriptionTranslations: { de: "Weiterbildungstag" },
			},
		],
	});

	renderTable(true);

	expect(await screen.findByText("Schulung")).toBeTruthy();
	expect(screen.getByText("Weiterbildungstag")).toBeTruthy();
});
```

Update the Tolgee mock to include `useLocale`:

```ts
vi.mock("@tolgee/react", () => ({
	useLocale: () => "de",
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
```

- [ ] **Step 2: Run table tests and verify failure**

Run:

```bash
pnpm --filter webapp test src/components/settings/absence-categories-table.test.tsx
```

Expected: FAIL because the table still renders `row.original.name` and `row.original.description`.

- [ ] **Step 3: Use display helpers in the table**

In `apps/webapp/src/components/settings/absence-categories-table.tsx`, import `useLocale` and helpers:

```ts
import { useLocale, useTranslate } from "@tolgee/react";
import {
	getAbsenceCategoryDisplayDescription,
	getAbsenceCategoryDisplayName,
} from "@/lib/absences/category-display";
```

Inside the component, add:

```ts
const locale = useLocale();
```

In the name cell, compute:

```tsx
const displayName = getAbsenceCategoryDisplayName(row.original, locale, t);
const displayDescription = getAbsenceCategoryDisplayDescription(row.original, locale, t);
```

Render `displayName` and `displayDescription`. Use `displayName` in the actions button `aria-label` and delete dialog copy instead of `row.original.name`.

- [ ] **Step 4: Run table tests**

Run:

```bash
pnpm --filter webapp test src/components/settings/absence-categories-table.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit table display changes**

```bash
git add apps/webapp/src/components/settings/absence-categories-table.tsx apps/webapp/src/components/settings/absence-categories-table.test.tsx
git commit -m "feat: show localized absence categories in settings"
```

## Task 6: Message Catalogs

**Files:**
- Modify: `apps/webapp/messages/settings/en.json`
- Modify: `apps/webapp/messages/settings/de.json`
- Modify: `apps/webapp/messages/settings/fr.json`
- Modify: `apps/webapp/messages/settings/es.json`
- Modify: `apps/webapp/messages/settings/it.json`
- Modify: `apps/webapp/messages/settings/pt.json`

- [ ] **Step 1: Add English messages**

In `apps/webapp/messages/settings/en.json`, under `settings.absenceCategories`, add:

```json
"defaults": {
  "bereavement": { "description": "Bereavement leave", "name": "Bereavement" },
  "home_office": { "description": "Remote work day", "name": "Home Office" },
  "parental": { "description": "Parental leave absence", "name": "Parental Leave" },
  "personal": { "description": "Personal time off", "name": "Personal Day" },
  "sick": { "description": "Sick day", "name": "Sick Leave" },
  "unpaid": { "description": "Unpaid absence", "name": "Unpaid Leave" },
  "vacation": { "description": "Paid time off", "name": "Vacation" }
},
"form": {
  "active": "Active",
  "activeHelp": "Active categories are available for new absence requests.",
  "color": "Color",
  "colorHelp": "Calendar marker",
  "countsAgainstVacation": "Counts Against Vacation Balance",
  "countsAgainstVacationHelp": "Deduct approved days from the employee vacation allowance.",
  "description": "Description",
  "descriptionHelp": "Optional guidance shown to admins and reviewers.",
  "descriptionPlaceholder": "e.g., Use for approved training or certification days…",
  "name": "Name",
  "nameHelp": "Use a clear label employees and approvers will recognize.",
  "nameMaxLength": "Use 100 characters or fewer",
  "namePlaceholder": "e.g., Training Day…",
  "nameRequired": "Category name is required",
  "requiresApproval": "Requires Approval",
  "requiresApprovalHelp": "Managers must approve requests before they become active.",
  "requiresWorkTime": "Requires Work Time",
  "requiresWorkTimeHelp": "Employees must record work time for this absence category.",
  "translatedDescription": "{locale} description",
  "translatedDescriptionPlaceholder": "Localized description",
  "translatedName": "{locale} name",
  "translatedNamePlaceholder": "Localized name",
  "translations": "Translations",
  "translationsHelp": "Optional localized labels for employees using another app language.",
  "type": "Type",
  "typeHelp": "Groups reports and downstream absence workflows.",
  "typePlaceholder": "Select category type"
}
```

- [ ] **Step 2: Add equivalent keys to the other locale files**

Add the same key structure to `de.json`, `fr.json`, `es.json`, `it.json`, and `pt.json`. It is acceptable to use English fallback text for any string where a verified translation is not available, because `t()` fallbacks still prevent missing-key output.

- [ ] **Step 3: Validate JSON syntax**

Run:

```bash
pnpm --filter webapp test src/lib/absences/category-display.test.ts
```

Expected: PASS and no JSON parse errors from the test environment.

- [ ] **Step 4: Commit message catalog changes**

```bash
git add apps/webapp/messages/settings/en.json apps/webapp/messages/settings/de.json apps/webapp/messages/settings/fr.json apps/webapp/messages/settings/es.json apps/webapp/messages/settings/it.json apps/webapp/messages/settings/pt.json
git commit -m "feat: add absence category translation messages"
```

## Task 7: Final Verification

**Files:**
- Verify all files touched by previous tasks.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter webapp test src/lib/absences/category-display.test.ts src/components/settings/absence-category-form.test.tsx src/components/settings/absence-categories-table.test.tsx src/app/[locale]/\(app\)/settings/vacation/actions.scope.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full tests if time allows**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
CI=true pnpm build
```

Expected: PASS.

- [ ] **Step 4: Review the final diff**

Run:

```bash
git diff --stat HEAD
git diff HEAD -- apps/webapp/src/db/schema/absence.ts apps/webapp/src/lib/absences/category-display.ts apps/webapp/src/components/settings/absence-category-form.tsx apps/webapp/src/components/settings/absence-categories-table.tsx apps/webapp/src/app/[locale]/\(app\)/settings/vacation/actions.ts
```

Expected: only absence category translation changes are present.

- [ ] **Step 5: Commit final verification fixes if any**

If verification required changes, commit them:

```bash
git add apps/webapp/src apps/webapp/messages/settings apps/webapp/drizzle
git commit -m "fix: finalize absence category translations"
```

If no verification fixes were needed, do not create an empty commit.

## Self-Review

Spec coverage:

- JSON map storage is covered by Tasks 1 and 3.
- Default category `t()` fallbacks are covered by Tasks 2, 5, and 6.
- Custom category translation editing is covered by Task 4.
- Hardcoded add/edit sheet strings are covered by Tasks 4 and 6.
- Testing and verification are covered by Tasks 2, 4, 5, and 7.

Placeholder scan: no placeholder implementation steps remain.

Type consistency: the plan consistently uses `LocaleTranslationMap`, `nameTranslations`, and `descriptionTranslations` across schema, actions, form, helper, and tests.
