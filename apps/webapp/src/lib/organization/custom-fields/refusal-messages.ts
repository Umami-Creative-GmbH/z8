/**
 * The one message map for refused custom field values (#818/#819), used by the
 * value editors in the browser and by the save actions on the server (with the
 * request's translator), so users read the same translated sentence either way.
 * Client-safe.
 */
import {
	actionMessageText,
	type RefusalMessages,
	type Translate,
} from "@/lib/organization-action/action-error-message";
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
export type CustomFieldMessageTranslate = Translate;

/** The English defaults with their placeholders filled in (server logs, tests). */
export const englishDefaults: CustomFieldMessageTranslate = (_key, defaultValue, params) =>
	defaultValue.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ""));

/**
 * Why a custom field value was refused, as a sentence about "this field": the
 * override map custom field forms pass to `actionErrorMessage`.
 */
export const CUSTOM_FIELD_VALUE_REFUSALS = {
	text_too_long: [
		"settings.customFields.valueRefusal.textTooLong",
		"Enter at most 255 characters.",
	],
	invalid_number: ["settings.customFields.valueRefusal.invalidNumber", "Enter a number."],
	number_not_integer: [
		"settings.customFields.valueRefusal.numberNotInteger",
		"Enter a whole number.",
	],
	number_out_of_range: [
		"settings.customFields.valueRefusal.numberOutOfRange",
		"Enter a number within the allowed range.",
	],
	invalid_date: ["settings.customFields.valueRefusal.invalidDate", "Enter a valid date."],
	option_archived: [
		"settings.customFields.valueRefusal.optionArchived",
		"This option is archived. Choose another one.",
	],
	invalid_option: ["settings.customFields.valueRefusal.invalidValue", "Enter a valid value."],
	invalid_value: ["settings.customFields.valueRefusal.invalidValue", "Enter a valid value."],
	invalid_valid_from: [
		"settings.customFields.valueRefusal.invalidValidFrom",
		"Enter a valid start date.",
	],
	duplicate_valid_from: [
		"settings.customFields.valueRefusal.duplicateValidFrom",
		"There is already a value starting on that date.",
	],
	missing_value: [
		"settings.customFields.valueRefusal.missingValue",
		"Enter a value for each date.",
	],
	unknown_history_entry: [
		"settings.customFields.valueRefusal.unknownHistoryEntry",
		"The history changed in the meantime. Reload the page and try again.",
	],
	tracked_field: [
		"settings.customFields.valueRefusal.trackedField",
		"This field keeps a history. Add a dated change instead.",
	],
	unknown_field: [
		"settings.customFields.valueRefusal.unknownField",
		"This field no longer exists. Reload the page and try again.",
	],
	field_archived: ["settings.customFields.valueRefusal.fieldArchived", "This field is archived."],
	not_editable: ["settings.customFields.valueRefusal.notEditable", "You can't change this field."],
	missing_required: [
		"settings.customFields.valueRefusal.missingRequired",
		"This field is required.",
	],
} satisfies RefusalMessages<CustomFieldValuesRefusal>;

/** Why a custom field value was refused, as a sentence about "this field". */
export function valueRefusalMessage(
	t: CustomFieldMessageTranslate,
	reason: CustomFieldValuesRefusal,
): string {
	return actionMessageText(t, CUSTOM_FIELD_VALUE_REFUSALS[reason]);
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
