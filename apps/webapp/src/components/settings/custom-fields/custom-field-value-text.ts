"use client";

import { useTranslate } from "@tolgee/react";
import { useAppLocale } from "@/components/providers/app-locale-provider";
import { formatDateOnly } from "@/components/ui/date-picker-utils";
import type { CustomFieldValue } from "@/lib/organization/custom-fields/value-rules";
import type { CustomFieldSectionField } from "@/lib/organization/custom-fields/values";

/** A value as text: select labels, Yes/No, dates in the app locale. */
export function useCustomFieldValueText() {
	const { t } = useTranslate();
	const locale = useAppLocale();
	return (field: CustomFieldSectionField, value: CustomFieldValue | undefined): string => {
		if (!value) return "—";
		switch (value.type) {
			case "boolean":
				return value.value
					? t("settings.customFields.values.yes", "Yes")
					: t("settings.customFields.values.no", "No");
			case "date":
				return formatDateOnly(value.value, locale) || value.value;
			case "select": {
				const option = field.options.find((candidate) => candidate.id === value.value);
				if (!option) return "—";
				return option.archived
					? t("settings.customFields.values.archivedOption", "{label} (archived)", {
							label: option.label,
						})
					: option.label;
			}
			default:
				return value.value;
		}
	};
}
