"use client";

import type { useTranslate } from "@tolgee/react";
import type { PayrollIdentifierFieldOption } from "@/app/[locale]/(app)/settings/payroll-export/actions";
import { SelectItem } from "@/components/ui/select";
import { CUSTOM_FIELD_IDENTIFIER } from "@/lib/payroll-export/personnel-identifier";

type Translate = ReturnType<typeof useTranslate>["t"];

/**
 * The "Custom field: <name>" options of a payroll configuration's personnel
 * identifier or match setting (#821). One select carries both the choice and
 * the field: a custom field option's value is `customField:<field id>`.
 */
const CUSTOM_FIELD_VALUE_PREFIX = `${CUSTOM_FIELD_IDENTIFIER}:`;

/** The select value of an identifier choice and its custom field. */
export function identifierSelectValue(choice: string, customFieldId: string | undefined): string {
	return choice === CUSTOM_FIELD_IDENTIFIER
		? `${CUSTOM_FIELD_VALUE_PREFIX}${customFieldId ?? ""}`
		: choice;
}

/** The identifier choice and custom field a select value stands for. */
export function identifierFromSelectValue(value: string): {
	choice: string;
	customFieldId: string | undefined;
} {
	return value.startsWith(CUSTOM_FIELD_VALUE_PREFIX)
		? {
				choice: CUSTOM_FIELD_IDENTIFIER,
				customFieldId: value.slice(CUSTOM_FIELD_VALUE_PREFIX.length),
			}
		: { choice: value, customFieldId: undefined };
}

/**
 * One option per eligible field (active employee text or number fields). A
 * saved field that is no longer offered stays selectable as "unavailable", so
 * the select never shows another choice than the one saved.
 *
 * Returned as plain `SelectItem` elements, not a component: the select reads
 * its item labels from its direct children.
 */
export function customFieldIdentifierItems(
	t: Translate,
	fields: readonly PayrollIdentifierFieldOption[],
	selectedFieldId: string | undefined,
) {
	const unavailable =
		selectedFieldId !== undefined && !fields.some((field) => field.id === selectedFieldId);
	return [
		...fields.map((field) => (
			<SelectItem key={field.id} value={identifierSelectValue(CUSTOM_FIELD_IDENTIFIER, field.id)}>
				{t("settings.payrollExport.identifier.customField", "Custom field: {name}", {
					name: field.name,
				})}
			</SelectItem>
		)),
		...(unavailable
			? [
					<SelectItem
						key="unavailable"
						value={identifierSelectValue(CUSTOM_FIELD_IDENTIFIER, selectedFieldId)}
					>
						{t("settings.payrollExport.identifier.unavailableField", "Custom field (unavailable)")}
					</SelectItem>,
				]
			: []),
	];
}
