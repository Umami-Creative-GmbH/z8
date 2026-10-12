/**
 * The one message map for refused custom field values (#818/#819), used by the
 * value editors in the browser and by the save actions on the server (with the
 * request's translator), so users read the same translated sentence either way.
 * Client-safe.
 */
import type { CustomFieldHistoryRefusal } from "./history-rules";

/** Why the value store refused a write (`CustomFieldValuesRefused`). */
export type CustomFieldValuesRefusal =
	| CustomFieldHistoryRefusal
	/** Not an active-or-archived field of this record kind in this organization. */
	| "unknown_field"
	| "field_archived"
	/** Above the writer's edit level (or a field they can't see). */
	| "not_editable"
	/** A plain value for a tracked field, which takes dated changes (`{ history }`). */
	| "tracked_field"
	/** A required field the writer may edit is left without a value (as of today). */
	| "missing_required";

/** A Tolgee `t` (client `useTranslate` or server `getTranslate`). */
export type CustomFieldMessageTranslate = (
	key: string,
	defaultValue: string,
	params?: Record<string, string>,
) => string;

/** The English defaults with their placeholders filled in (server logs, tests). */
export const englishDefaults: CustomFieldMessageTranslate = (_key, defaultValue, params) =>
	defaultValue.replace(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? "");

/** Why a custom field value was refused, as a sentence about "this field". */
export function valueRefusalMessage(
	t: CustomFieldMessageTranslate,
	reason: CustomFieldValuesRefusal,
): string {
	switch (reason) {
		case "text_too_long":
			return t("settings.customFields.valueRefusal.textTooLong", "Enter at most 255 characters.");
		case "invalid_number":
			return t("settings.customFields.valueRefusal.invalidNumber", "Enter a number.");
		case "number_not_integer":
			return t("settings.customFields.valueRefusal.numberNotInteger", "Enter a whole number.");
		case "number_out_of_range":
			return t(
				"settings.customFields.valueRefusal.numberOutOfRange",
				"Enter a number within the allowed range.",
			);
		case "invalid_date":
			return t("settings.customFields.valueRefusal.invalidDate", "Enter a valid date.");
		case "option_archived":
			return t(
				"settings.customFields.valueRefusal.optionArchived",
				"This option is archived. Choose another one.",
			);
		case "invalid_option":
		case "invalid_value":
			return t("settings.customFields.valueRefusal.invalidValue", "Enter a valid value.");
		case "invalid_valid_from":
			return t("settings.customFields.valueRefusal.invalidValidFrom", "Enter a valid start date.");
		case "duplicate_valid_from":
			return t(
				"settings.customFields.valueRefusal.duplicateValidFrom",
				"There is already a value starting on that date.",
			);
		case "missing_value":
			return t("settings.customFields.valueRefusal.missingValue", "Enter a value for each date.");
		case "unknown_history_entry":
			return t(
				"settings.customFields.valueRefusal.unknownHistoryEntry",
				"The history changed in the meantime. Reload the page and try again.",
			);
		case "tracked_field":
			return t(
				"settings.customFields.valueRefusal.trackedField",
				"This field keeps a history. Add a dated change instead.",
			);
		case "unknown_field":
			return t(
				"settings.customFields.valueRefusal.unknownField",
				"This field no longer exists. Reload the page and try again.",
			);
		case "field_archived":
			return t("settings.customFields.valueRefusal.fieldArchived", "This field is archived.");
		case "not_editable":
			return t("settings.customFields.valueRefusal.notEditable", "You can't change this field.");
		case "missing_required":
			return t("settings.customFields.valueRefusal.missingRequired", "This field is required.");
	}
}

/** A refusal for a named field, as the save actions report it. */
export function namedValueRefusalMessage(
	t: CustomFieldMessageTranslate,
	reason: CustomFieldValuesRefusal,
	fieldName: string | null,
): string {
	const message = valueRefusalMessage(t, reason);
	return fieldName === null
		? message
		: t("settings.customFields.valueRefusal.forField", 'Custom field "{field}": {message}', {
				field: fieldName,
				message,
			});
}
