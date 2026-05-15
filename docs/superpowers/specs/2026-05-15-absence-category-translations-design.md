# Absence Category Translations Design

## Goal

Allow organization admins to translate absence category names and descriptions. Built-in default categories should use application translations through `t()` with stored database values as fallbacks. Custom categories should support organization-owned locale maps stored with the category.

## Data Model

Add optional JSON translation maps to `absence_category`:

- `nameTranslations`: locale code to translated display name.
- `descriptionTranslations`: locale code to translated description.

The existing `name` and `description` fields stay as canonical base values. Server actions trim translation entries and drop empty values before insert or update. Translation data remains organization-scoped because it is stored on the existing organization-scoped category row.

## Display Rules

Use shared display helpers for category name and description instead of reading `category.name` directly in UI surfaces.

For built-in categories, display helpers use stable translation keys by category type, for example `settings.absenceCategories.defaults.vacation.name`, with the stored database value as fallback. This keeps seeded defaults localized even when the stored row contains English text.

For custom categories, display helpers read the JSON map for the current locale. If no matching translation exists, they fall back to the canonical `name` or `description` value.

## Form Behavior

The add/edit category sheet keeps the existing base fields and adds a translations section for custom category text. Admins can enter translated names and descriptions for supported app locales. The base name remains required. Translation entries are optional.

The sheet should also localize its own UI strings with `t()`: labels, helper text, placeholders, validation messages, type option labels, and section copy. It should not leave hardcoded English strings in the form UI.

## Server Actions

Create and update actions accept translation maps in addition to existing category fields. They validate that translation maps are plain locale-to-string records, normalize whitespace, and write only non-empty values. Existing authorization and organization ownership checks remain unchanged.

## Testing

Add focused tests for payload normalization and form rendering where current test patterns support it. Add tests for display helper fallback behavior: built-in category translation fallback, custom category locale match, and canonical fallback when a custom translation is missing.
