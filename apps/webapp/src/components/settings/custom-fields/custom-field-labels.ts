import type { useTranslate } from "@tolgee/react";
import type {
	CustomFieldEntity,
	CustomFieldRefusal,
	CustomFieldType,
	FieldVisibility,
} from "@/lib/organization/custom-fields/definition-rules";
import type {
	ActionFailure,
	RefusalMessages,
} from "@/lib/organization-action/action-error-message";

type Translate = ReturnType<typeof useTranslate>["t"];

export function entityLabel(t: Translate, entity: CustomFieldEntity): string {
	switch (entity) {
		case "employee":
			return t("settings.customFields.entity.employee", "Employees");
		case "project":
			return t("settings.customFields.entity.project", "Projects");
		case "customer":
			return t("settings.customFields.entity.customer", "Customers");
	}
}

export function typeLabel(t: Translate, type: CustomFieldType): string {
	switch (type) {
		case "text":
			return t("settings.customFields.type.text", "Text");
		case "number":
			return t("settings.customFields.type.number", "Number");
		case "date":
			return t("settings.customFields.type.date", "Date");
		case "select":
			return t("settings.customFields.type.select", "Select");
		case "boolean":
			return t("settings.customFields.type.boolean", "Yes/No");
	}
}

/** A base role as a field visibility or edit level. */
export function levelLabel(t: Translate, level: FieldVisibility): string {
	switch (level) {
		case "admin":
			return t("settings.customFields.level.admin", "Admins");
		case "manager":
			return t("settings.customFields.level.manager", "Managers and admins");
		case "employee":
			return t("settings.customFields.level.employee", "Everyone, including the employee");
	}
}

/** The payroll configurations a `used_as_payroll_identifier` refusal names (#821). */
function configurationsOf(failure: ActionFailure): string[] {
	const configurations = failure.details?.configurations;
	return Array.isArray(configurations) ? configurations.map(String) : [];
}

/** The custom field settings' texts for `actionErrorMessage`, by the store's refusal. */
export const CUSTOM_FIELD_REFUSALS = {
	used_as_payroll_identifier: (t, failure) =>
		t(
			"settings.customFields.refusal.usedAsPayrollIdentifier",
			"This field is the personnel identifier of the payroll export configuration {configurations}. Choose another identifier there first.",
			{ configurations: configurationsOf(failure).join(", ") },
		),
	invalid_name: [
		"settings.customFields.refusal.invalidName",
		"Enter a name of at most 100 characters.",
	],
	invalid_level: [
		"settings.customFields.refusal.invalidLevel",
		"Choose who can see and edit values.",
	],
	employees_never_edit: [
		"settings.customFields.refusal.employeesNeverEdit",
		"Employees can't edit custom field values.",
	],
	edit_level_broader_than_visibility: [
		"settings.customFields.refusal.editBroaderThanVisibility",
		"Everyone who can edit values must also be able to see them.",
	],
	boolean_cannot_be_required: [
		"settings.customFields.refusal.booleanRequired",
		"A yes/no field can't be required.",
	],
	invalid_number_bounds: [
		"settings.customFields.refusal.numberBounds",
		"Enter a minimum and maximum as numbers, with the minimum not above the maximum.",
	],
	select_needs_option: [
		"settings.customFields.refusal.selectNeedsOption",
		"Add at least one option to a select field.",
	],
	invalid_option_label: [
		"settings.customFields.refusal.invalidOptionLabel",
		"Enter an option of at most 100 characters.",
	],
	duplicate_option_label: [
		"settings.customFields.refusal.duplicateOption",
		"This field already has an active option with this name.",
	],
	stale_order: [
		"settings.customFields.refusal.staleOrder",
		"The list changed in the meantime. Reload the page and try again.",
	],
	type_fixed: [
		"settings.customFields.refusal.typeFixed",
		"A custom field's type can't change after it is created.",
	],
	tracked_fixed: [
		"settings.customFields.refusal.trackedFixed",
		"Whether a custom field keeps a history can't change after it is created.",
	],
	too_many_fields: [
		"settings.customFields.refusal.tooManyFields",
		"This record type already has 25 active custom fields. Archive one first.",
	],
	name_taken: [
		"settings.customFields.refusal.nameTaken",
		"An active custom field on this record type already has this name.",
	],
	field_not_found: [
		"settings.customFields.refusal.notFound",
		"This custom field no longer exists. Reload the page.",
	],
	option_not_found: [
		"settings.customFields.refusal.notFound",
		"This custom field no longer exists. Reload the page.",
	],
	field_archived: [
		"settings.customFields.refusal.fieldArchived",
		"Restore this custom field before changing it.",
	],
	not_select: ["settings.customFields.refusal.notSelect", "Only select fields have options."],
	option_archived: ["settings.customFields.refusal.optionArchived", "Restore this option first."],
	last_active_option: [
		"settings.customFields.refusal.lastActiveOption",
		"A select field needs at least one active option.",
	],
	invalid_entity: [
		"settings.customFields.refusal.invalidChange",
		"This change can't be saved. Reload the page and try again.",
	],
	invalid_type: [
		"settings.customFields.refusal.invalidChange",
		"This change can't be saved. Reload the page and try again.",
	],
	invalid_change: [
		"settings.customFields.refusal.invalidChange",
		"This change can't be saved. Reload the page and try again.",
	],
} satisfies RefusalMessages<CustomFieldRefusal>;

/** Why a value doesn't fit its field (#819 history editor); shared with the save actions. */
export { valueRefusalMessage } from "@/lib/organization/custom-fields/refusal-messages";
