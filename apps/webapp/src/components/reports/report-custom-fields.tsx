"use client";

import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import { useAppLocale } from "@/components/providers/app-locale-provider";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatDateOnly } from "@/components/ui/date-picker-utils";
import type { CustomFieldReportValue } from "@/lib/organization/custom-fields/report-values";

/** A report's custom field value as text: Yes/No, dates in the app locale, "—" for none. */
function useReportCustomFieldText() {
	const { t } = useTranslate();
	const locale = useAppLocale();
	return (field: CustomFieldReportValue): string => {
		if (field.value === null) return "—";
		if (typeof field.value === "boolean") {
			return field.value
				? t("reports.customFields.yes", "Yes")
				: t("reports.customFields.no", "No");
		}
		if (field.type === "date") return formatDateOnly(field.value, locale) || field.value;
		return field.value;
	};
}

/** The custom fields of a report's record, as name and value pairs in their order (#820). */
export function ReportCustomFieldList({ fields }: { fields: readonly CustomFieldReportValue[] }) {
	const valueText = useReportCustomFieldText();
	return (
		<dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{fields.map((field) => (
				<div key={field.fieldId} className="grid gap-0.5">
					<dt className="text-sm text-muted-foreground">{field.name}</dt>
					<dd className="text-sm font-medium break-words">{valueText(field)}</dd>
				</div>
			))}
		</dl>
	);
}

/**
 * The "Custom fields" card of a report: the fields the requester sees, with
 * values as of the period's last day. Renders nothing without fields.
 */
export function ReportCustomFieldsCard({
	fields,
	title,
}: {
	fields: readonly CustomFieldReportValue[];
	/** Defaults to "Custom fields". */
	title?: string;
}) {
	const { t } = useTranslate();
	const headingId = useId();
	if (fields.length === 0) return null;
	return (
		<Card aria-labelledby={headingId}>
			<CardHeader>
				<h3 id={headingId} className="leading-none font-semibold">
					{title ?? t("reports.customFields.title", "Custom fields")}
				</h3>
			</CardHeader>
			<CardContent>
				<ReportCustomFieldList fields={fields} />
			</CardContent>
		</Card>
	);
}
