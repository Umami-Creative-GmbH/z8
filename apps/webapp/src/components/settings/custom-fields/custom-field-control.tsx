"use client";

import { useTranslate } from "@tolgee/react";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { CUSTOM_FIELD_TEXT_MAX_LENGTH } from "@/lib/organization/custom-fields/definition-rules";
import type { CustomFieldSectionField } from "@/lib/organization/custom-fields/values";

const NONE = "__none__";

/**
 * The input of one custom field value, by type (#818). `draft` is the value as
 * a string ("" = no value; "true" / "false" for yes/no).
 */
export function CustomFieldControl({
	id,
	field,
	draft,
	onChange,
	disabled,
	invalid,
	required,
	describedBy,
}: {
	id: string;
	field: CustomFieldSectionField;
	draft: string;
	onChange: (draft: string) => void;
	disabled: boolean;
	invalid: boolean;
	/** Whether "no value" can't be picked. Default: the field's required flag. */
	required?: boolean;
	/** The id of the message describing the control (its error). */
	describedBy?: string;
}) {
	const { t } = useTranslate();
	const isRequired = required ?? field.required;
	switch (field.type) {
		case "date":
			return (
				<DatePicker
					id={id}
					value={draft}
					onChange={onChange}
					required={isRequired}
					disabled={disabled}
					aria-invalid={invalid || undefined}
					aria-describedby={describedBy}
				/>
			);
		case "select":
			return (
				<Select
					value={draft || NONE}
					onValueChange={(value) =>
						onChange(value === NONE || typeof value !== "string" ? "" : value)
					}
					disabled={disabled}
				>
					<SelectTrigger id={id} aria-invalid={invalid || undefined} aria-describedby={describedBy}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={NONE}>
							{t("settings.customFields.values.notSet", "Not set")}
						</SelectItem>
						{field.options
							.filter((option) => !option.archived || option.id === draft)
							.map((option) => (
								<SelectItem key={option.id} value={option.id}>
									{option.archived
										? t("settings.customFields.values.archivedOption", "{label} (archived)", {
												label: option.label,
											})
										: option.label}
								</SelectItem>
							))}
					</SelectContent>
				</Select>
			);
		case "boolean":
			return (
				<Select
					value={draft || NONE}
					onValueChange={(value) =>
						onChange(value === NONE || typeof value !== "string" ? "" : value)
					}
					disabled={disabled}
				>
					<SelectTrigger id={id} aria-invalid={invalid || undefined} aria-describedby={describedBy}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={NONE}>
							{t("settings.customFields.values.notSet", "Not set")}
						</SelectItem>
						<SelectItem value="true">{t("settings.customFields.values.yes", "Yes")}</SelectItem>
						<SelectItem value="false">{t("settings.customFields.values.no", "No")}</SelectItem>
					</SelectContent>
				</Select>
			);
		case "number":
			return (
				<Input
					id={id}
					inputMode="decimal"
					autoComplete="off"
					value={draft}
					onChange={(event) => onChange(event.target.value)}
					disabled={disabled}
					aria-invalid={invalid || undefined}
					aria-describedby={describedBy}
				/>
			);
		default:
			return (
				<Input
					id={id}
					autoComplete="off"
					maxLength={CUSTOM_FIELD_TEXT_MAX_LENGTH}
					value={draft}
					onChange={(event) => onChange(event.target.value)}
					disabled={disabled}
					aria-invalid={invalid || undefined}
					aria-describedby={describedBy}
				/>
			);
	}
}
