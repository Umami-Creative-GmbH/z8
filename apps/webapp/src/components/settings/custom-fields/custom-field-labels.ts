import type { useTranslate } from "@tolgee/react";
import type {
	CustomFieldEntity,
	CustomFieldRefusal,
	CustomFieldType,
	FieldVisibility,
} from "@/lib/organization/custom-fields/definition-rules";

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

export function refusalMessage(t: Translate, reason: CustomFieldRefusal): string {
	switch (reason) {
		case "invalid_name":
			return t(
				"settings.customFields.refusal.invalidName",
				"Enter a name of at most 100 characters.",
			);
		case "invalid_level":
			return t("settings.customFields.refusal.invalidLevel", "Choose who can see and edit values.");
		case "employees_never_edit":
			return t(
				"settings.customFields.refusal.employeesNeverEdit",
				"Employees can't edit custom field values.",
			);
		case "edit_level_broader_than_visibility":
			return t(
				"settings.customFields.refusal.editBroaderThanVisibility",
				"Everyone who can edit values must also be able to see them.",
			);
		case "boolean_cannot_be_required":
			return t(
				"settings.customFields.refusal.booleanRequired",
				"A yes/no field can't be required.",
			);
		case "invalid_number_bounds":
			return t(
				"settings.customFields.refusal.numberBounds",
				"Enter a minimum and maximum as numbers, with the minimum not above the maximum.",
			);
		case "select_needs_option":
			return t(
				"settings.customFields.refusal.selectNeedsOption",
				"Add at least one option to a select field.",
			);
		case "invalid_option_label":
			return t(
				"settings.customFields.refusal.invalidOptionLabel",
				"Enter an option of at most 100 characters.",
			);
		case "duplicate_option_label":
			return t(
				"settings.customFields.refusal.duplicateOption",
				"This field already has an active option with this name.",
			);
		case "stale_order":
			return t(
				"settings.customFields.refusal.staleOrder",
				"The list changed in the meantime. Reload the page and try again.",
			);
		case "type_fixed":
			return t(
				"settings.customFields.refusal.typeFixed",
				"A custom field's type can't change after it is created.",
			);
		case "tracked_fixed":
			return t(
				"settings.customFields.refusal.trackedFixed",
				"Whether a custom field keeps a history can't change after it is created.",
			);
		case "too_many_fields":
			return t(
				"settings.customFields.refusal.tooManyFields",
				"This record type already has 25 active custom fields. Archive one first.",
			);
		case "name_taken":
			return t(
				"settings.customFields.refusal.nameTaken",
				"An active custom field on this record type already has this name.",
			);
		case "field_not_found":
		case "option_not_found":
			return t(
				"settings.customFields.refusal.notFound",
				"This custom field no longer exists. Reload the page.",
			);
		case "field_archived":
			return t(
				"settings.customFields.refusal.fieldArchived",
				"Restore this custom field before changing it.",
			);
		case "not_select":
			return t("settings.customFields.refusal.notSelect", "Only select fields have options.");
		case "option_archived":
			return t("settings.customFields.refusal.optionArchived", "Restore this option first.");
		case "last_active_option":
			return t(
				"settings.customFields.refusal.lastActiveOption",
				"A select field needs at least one active option.",
			);
		case "invalid_entity":
		case "invalid_type":
		case "invalid_change":
			return t(
				"settings.customFields.refusal.invalidChange",
				"This change can't be saved. Reload the page and try again.",
			);
	}
}
