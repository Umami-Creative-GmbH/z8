"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import { useAppLocale } from "@/components/providers/app-locale-provider";
import { Badge } from "@/components/ui/badge";
import { DatePicker } from "@/components/ui/date-picker";
import { formatDateOnly } from "@/components/ui/date-picker-utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { CUSTOM_FIELD_TEXT_MAX_LENGTH } from "@/lib/organization/custom-fields/definition-rules";
import {
	type CustomFieldValue,
	customFieldDraftOf,
} from "@/lib/organization/custom-fields/value-rules";
import type {
	CustomFieldSection,
	CustomFieldSectionField,
} from "@/lib/organization/custom-fields/values";
import type { CustomFieldDrafts } from "./use-custom-field-drafts";

type Translate = ReturnType<typeof useTranslate>["t"];

const NONE = "__none__";

/** Marks a record with a required custom field that has no value (#818). */
export function MissingRequiredValuesBadge({ className }: { className?: string }) {
	const { t } = useTranslate();
	return (
		<Badge variant="outline" className={className}>
			<IconAlertTriangle aria-hidden="true" className="size-3.5 text-amber-600" />
			{t("settings.customFields.values.missingRequired", "Missing required values")}
		</Badge>
	);
}

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

/**
 * The read-only "Custom fields" list: field names and values. Used for fields
 * the viewer may see but not change, and for the own-profile view.
 */
export function CustomFieldValueList({
	fields,
	values,
}: {
	fields: CustomFieldSectionField[];
	values: CustomFieldSection["values"];
}) {
	const valueText = useCustomFieldValueText();
	return (
		<dl className="grid gap-3 sm:grid-cols-2">
			{fields.map((field) => (
				<div key={field.id} className="grid gap-0.5">
					<dt className="text-sm text-muted-foreground">{field.name}</dt>
					<dd className="text-sm font-medium break-words">{valueText(field, values[field.id])}</dd>
				</div>
			))}
		</dl>
	);
}

/**
 * The "Custom fields" section of a record's form (#818): the active fields the
 * viewer sees, in order. Fields the viewer may change are inputs; the others
 * are shown read-only. Renders nothing when the viewer sees no field.
 */
export function CustomFieldValuesSection({
	section,
	drafts,
	onDraftChange,
	disabled = false,
}: {
	section: CustomFieldSection | null;
	drafts: Readonly<Record<string, string>>;
	onDraftChange: (fieldId: string, draft: string) => void;
	disabled?: boolean;
}) {
	const { t } = useTranslate();
	const headingId = useId();
	if (!section || section.fields.length === 0) return null;
	const editable = section.fields.filter((field) => field.editable);
	const readOnly = section.fields.filter((field) => !field.editable);
	const missing = new Set(section.missingRequiredFieldIds);

	return (
		<section className="grid gap-4 border-t pt-4" aria-labelledby={headingId}>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 id={headingId} className="text-sm font-semibold">
					{t("settings.customFields.values.title", "Custom fields")}
				</h3>
				{section.missingRequiredFieldIds.length > 0 ? <MissingRequiredValuesBadge /> : null}
			</div>
			{editable.length > 0 ? (
				<div className="grid gap-4 md:grid-cols-2">
					{editable.map((field) => (
						<CustomFieldInput
							key={field.id}
							field={field}
							draft={drafts[field.id] ?? customFieldDraftOf(section.values[field.id] ?? null)}
							missing={missing.has(field.id)}
							onChange={(draft) => onDraftChange(field.id, draft)}
							disabled={disabled}
							t={t}
						/>
					))}
				</div>
			) : null}
			{readOnly.length > 0 ? (
				<CustomFieldValueList fields={readOnly} values={section.values} />
			) : null}
		</section>
	);
}

/** The section bound to a form's drafts (`useCustomFieldDrafts`). */
export function CustomFieldDraftsSection({
	drafts,
	disabled,
}: {
	drafts: Pick<CustomFieldDrafts, "section" | "drafts" | "setDraft">;
	disabled?: boolean;
}) {
	return (
		<CustomFieldValuesSection
			section={drafts.section}
			drafts={drafts.drafts}
			onDraftChange={drafts.setDraft}
			disabled={disabled}
		/>
	);
}

function CustomFieldInput({
	field,
	draft,
	missing,
	onChange,
	disabled,
	t,
}: {
	field: CustomFieldSectionField;
	draft: string;
	missing: boolean;
	onChange: (draft: string) => void;
	disabled: boolean;
	t: Translate;
}) {
	const id = `custom-field-${field.id}`;
	return (
		<div className="grid gap-2">
			<Label htmlFor={id}>
				{field.name}
				{field.required ? " *" : ""}
			</Label>
			<CustomFieldControl
				id={id}
				field={field}
				draft={draft}
				onChange={onChange}
				disabled={disabled}
				invalid={missing && draft === ""}
				t={t}
			/>
		</div>
	);
}

function CustomFieldControl({
	id,
	field,
	draft,
	onChange,
	disabled,
	invalid,
	t,
}: {
	id: string;
	field: CustomFieldSectionField;
	draft: string;
	onChange: (draft: string) => void;
	disabled: boolean;
	invalid: boolean;
	t: Translate;
}) {
	switch (field.type) {
		case "date":
			return (
				<DatePicker
					id={id}
					value={draft}
					onChange={onChange}
					required={field.required}
					disabled={disabled}
					aria-invalid={invalid || undefined}
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
					<SelectTrigger id={id} aria-invalid={invalid || undefined}>
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
					<SelectTrigger id={id}>
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
				/>
			);
	}
}
