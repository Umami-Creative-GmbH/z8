"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
	type CustomFieldHistoryDraft,
	customFieldHistoryDraftsOf,
} from "@/lib/organization/custom-fields/history-rules";
import { customFieldDraftOf } from "@/lib/organization/custom-fields/value-rules";
import type {
	CustomFieldSection,
	CustomFieldSectionField,
} from "@/lib/organization/custom-fields/values";
import { CustomFieldControl } from "./custom-field-control";
import { useCustomFieldValueText } from "./custom-field-value-text";
import { TrackedCustomFieldInput } from "./tracked-custom-field-input";
import type { CustomFieldDrafts } from "./use-custom-field-drafts";

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

/**
 * The read-only "Custom fields" list: field names and values. Used for fields
 * the viewer may see but not change, and for the own-profile view (tracked
 * fields show their value as of today there).
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
 * are shown read-only. Tracked fields (#819) show their value as of today and
 * their history, editable through `onHistoryChange`. Renders nothing when the
 * viewer sees no field.
 */
export function CustomFieldValuesSection({
	section,
	drafts,
	onDraftChange,
	historyDrafts = {},
	onHistoryChange,
	disabled = false,
}: {
	section: CustomFieldSection | null;
	drafts: Readonly<Record<string, string>>;
	onDraftChange: (fieldId: string, draft: string) => void;
	/** Edited histories of tracked fields, by field id (absent = the saved history). */
	historyDrafts?: Readonly<Record<string, CustomFieldHistoryDraft[]>>;
	onHistoryChange?: (fieldId: string, entries: CustomFieldHistoryDraft[]) => void;
	disabled?: boolean;
}) {
	const { t } = useTranslate();
	const headingId = useId();
	if (!section || section.fields.length === 0) return null;
	const editable = section.fields.filter((field) => field.editable && !field.tracked);
	const tracked = section.fields.filter((field) => field.tracked);
	const readOnly = section.fields.filter((field) => !field.editable && !field.tracked);
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
						/>
					))}
				</div>
			) : null}
			{tracked.map((field) => (
				<TrackedCustomFieldInput
					key={field.id}
					field={field}
					entries={
						historyDrafts[field.id] ?? customFieldHistoryDraftsOf(section.history[field.id] ?? [])
					}
					today={section.today}
					missing={missing.has(field.id)}
					onChange={
						field.editable && onHistoryChange
							? (entries) => onHistoryChange(field.id, entries)
							: undefined
					}
					disabled={disabled}
				/>
			))}
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
	drafts: Pick<
		CustomFieldDrafts,
		"section" | "drafts" | "setDraft" | "historyDrafts" | "setHistoryDraft"
	>;
	disabled?: boolean;
}) {
	return (
		<CustomFieldValuesSection
			section={drafts.section}
			drafts={drafts.drafts}
			onDraftChange={drafts.setDraft}
			historyDrafts={drafts.historyDrafts}
			onHistoryChange={drafts.setHistoryDraft}
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
}: {
	field: CustomFieldSectionField;
	draft: string;
	missing: boolean;
	onChange: (draft: string) => void;
	disabled: boolean;
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
			/>
		</div>
	);
}
