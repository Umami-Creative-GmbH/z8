"use client";

import { useTranslate } from "@tolgee/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CustomFieldSection } from "@/lib/organization/custom-fields/values";
import { CustomFieldValueList } from "./custom-field-values-section";

/**
 * The read-only "Custom fields" section of the signed-in employee's own
 * profile (#818): their employee fields visible to employees. Employees never
 * edit values, not even their own. Hidden when there are none.
 */
export function OwnCustomFieldsCard({ section }: { section: CustomFieldSection }) {
	const { t } = useTranslate();
	if (section.fields.length === 0) return null;
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.customFields.values.title", "Custom fields")}</CardTitle>
				<CardDescription>
					{t(
						"settings.customFields.values.ownDescription",
						"Kept by your organization. Ask an admin or your manager to change them.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<CustomFieldValueList fields={section.fields} values={section.values} />
			</CardContent>
		</Card>
	);
}
