"use client";

import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import { useAppLocale } from "@/components/providers/app-locale-provider";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { formatDateOnly, parseDateOnly } from "@/components/ui/date-picker-utils";
import { Label } from "@/components/ui/label";
import {
	type CustomFieldHistoryDraft,
	customFieldValueAsOf,
	newestFirst,
} from "@/lib/organization/custom-fields/history-rules";
import {
	customFieldDraftOf,
	customFieldInputOfDraft,
	parseCustomFieldValueInput,
} from "@/lib/organization/custom-fields/value-rules";
import type { CustomFieldSectionField } from "@/lib/organization/custom-fields/values";
import { CustomFieldControl } from "./custom-field-control";
import { valueRefusalMessage } from "./custom-field-labels";
import { useCustomFieldValueText } from "./custom-field-value-text";

/** The entry being added (`key` null) or corrected, as form drafts. */
interface EntryEditor {
	key: string | null;
	validFrom: string;
	draft: string;
	error: string | null;
}

/**
 * A tracked custom field in a record's "Custom fields" section (#819): its
 * value as of today and its history, newest first. With `onChange` (the viewer
 * may edit the field), changes can be added with any valid-from date and
 * entries corrected or deleted; the edited list is saved with the form.
 */
export function TrackedCustomFieldInput({
	field,
	entries,
	today,
	missing,
	onChange,
	disabled = false,
}: {
	field: CustomFieldSectionField;
	entries: readonly CustomFieldHistoryDraft[];
	/** Today in the organization's timezone, "YYYY-MM-DD". */
	today: string;
	missing: boolean;
	onChange?: (entries: CustomFieldHistoryDraft[]) => void;
	disabled?: boolean;
}) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const valueText = useCustomFieldValueText();
	const headingId = useId();
	const [editor, setEditor] = useState<EntryEditor | null>(null);
	const todayDate = parseDateOnly(today);
	const current = todayDate ? customFieldValueAsOf(entries, todayDate) : null;
	const sorted = newestFirst(entries);

	const apply = () => {
		if (!editor || !onChange) return;
		const fail = (error: string) => setEditor({ ...editor, error });
		const validFrom = parseDateOnly(editor.validFrom)?.toString();
		if (!validFrom) {
			return fail(
				t(
					"settings.customFields.values.history.needsValidFrom",
					"Choose the date the value is valid from.",
				),
			);
		}
		const before = entries.find((entry) => entry.key === editor.key) ?? null;
		const parsed = parseCustomFieldValueInput(
			field,
			customFieldInputOfDraft(field.type, editor.draft),
			before?.value ?? null,
		);
		if (!parsed.ok) return fail(valueRefusalMessage(t, parsed.reason));
		if (!parsed.value) {
			return fail(t("settings.customFields.values.history.needsValue", "Enter a value."));
		}
		if (entries.some((entry) => entry.key !== editor.key && entry.validFrom === validFrom)) {
			return fail(
				t(
					"settings.customFields.values.history.duplicateValidFrom",
					"There is already a value valid from this date.",
				),
			);
		}
		const value = parsed.value;
		onChange(
			newestFirst(
				before
					? entries.map((entry) =>
							entry.key === before.key ? { ...entry, validFrom, value } : entry,
						)
					: [...entries, { key: crypto.randomUUID(), entryId: null, validFrom, value }],
			),
		);
		setEditor(null);
	};

	return (
		<fieldset className="grid min-w-0 gap-2" aria-labelledby={headingId}>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span id={headingId} className="text-sm font-medium">
					{field.name}
					{field.required ? " *" : ""}
				</span>
				{onChange && !editor ? (
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={disabled}
						onClick={() => setEditor({ key: null, validFrom: today, draft: "", error: null })}
					>
						<IconPlus aria-hidden="true" className="size-4" />
						{t("settings.customFields.values.history.add", "Add change")}
					</Button>
				) : null}
			</div>
			<p className="text-sm text-muted-foreground">
				{t("settings.customFields.values.history.today", "Today")}:{" "}
				<span
					data-testid={`custom-field-today-${field.id}`}
					className={
						missing && !current ? "font-medium text-destructive" : "font-medium text-foreground"
					}
				>
					{valueText(field, current ?? undefined)}
				</span>
			</p>
			{editor && onChange ? (
				<HistoryEntryEditor
					field={field}
					editor={editor}
					onEditorChange={setEditor}
					onApply={apply}
					onCancel={() => setEditor(null)}
					disabled={disabled}
				/>
			) : null}
			{sorted.length > 0 ? (
				<ul
					aria-label={t("settings.customFields.values.history.label", "History of {name}", {
						name: field.name,
					})}
					className="divide-y rounded-md border"
				>
					{sorted.map((entry) => {
						const date = formatDateOnly(entry.validFrom, locale) || entry.validFrom;
						return (
							<li
								key={entry.key}
								className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
							>
								<span className="min-w-28 text-muted-foreground">
									{t("settings.customFields.values.history.from", "From {date}", { date })}
								</span>
								<span className="flex-1 font-medium break-words">
									{valueText(field, entry.value)}
								</span>
								{onChange ? (
									<span className="flex gap-1">
										<Button
											type="button"
											size="icon"
											variant="ghost"
											disabled={disabled}
											aria-label={t(
												"settings.customFields.values.history.correct",
												"Correct the value valid from {date}",
												{ date },
											)}
											onClick={() =>
												setEditor({
													key: entry.key,
													validFrom: entry.validFrom,
													draft: customFieldDraftOf(entry.value),
													error: null,
												})
											}
										>
											<IconPencil aria-hidden="true" className="size-4" />
										</Button>
										<Button
											type="button"
											size="icon"
											variant="ghost"
											disabled={disabled}
											aria-label={t(
												"settings.customFields.values.history.delete",
												"Delete the value valid from {date}",
												{ date },
											)}
											onClick={() => {
												if (editor?.key === entry.key) setEditor(null);
												onChange(entries.filter((candidate) => candidate.key !== entry.key));
											}}
										>
											<IconTrash aria-hidden="true" className="size-4" />
										</Button>
									</span>
								) : null}
							</li>
						);
					})}
				</ul>
			) : (
				<p className="text-sm text-muted-foreground">
					{t("settings.customFields.values.history.empty", "No values yet.")}
				</p>
			)}
		</fieldset>
	);
}

function HistoryEntryEditor({
	field,
	editor,
	onEditorChange,
	onApply,
	onCancel,
	disabled,
}: {
	field: CustomFieldSectionField;
	editor: EntryEditor;
	onEditorChange: (editor: EntryEditor) => void;
	onApply: () => void;
	onCancel: () => void;
	disabled: boolean;
}) {
	const { t } = useTranslate();
	const id = useId();
	return (
		<div className="grid items-end gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
			<div className="grid gap-1.5">
				<Label htmlFor={`${id}-from`}>
					{t("settings.customFields.values.history.validFrom", "Valid from")}
				</Label>
				<DatePicker
					id={`${id}-from`}
					value={editor.validFrom}
					onChange={(validFrom) => onEditorChange({ ...editor, validFrom, error: null })}
					required
					disabled={disabled}
				/>
			</div>
			<div className="grid gap-1.5">
				<Label htmlFor={`${id}-value`}>
					{t("settings.customFields.values.history.value", "Value")}
				</Label>
				<CustomFieldControl
					id={`${id}-value`}
					field={field}
					draft={editor.draft}
					onChange={(draft) => onEditorChange({ ...editor, draft, error: null })}
					disabled={disabled}
					invalid={editor.error !== null}
					required
				/>
			</div>
			<div className="flex gap-2">
				<Button type="button" size="sm" onClick={onApply} disabled={disabled}>
					{t("settings.customFields.values.history.apply", "Apply")}
				</Button>
				<Button type="button" size="sm" variant="ghost" onClick={onCancel}>
					{t("common.cancel", "Cancel")}
				</Button>
			</div>
			{editor.error ? (
				<p role="alert" className="text-sm text-destructive sm:col-span-3">
					{editor.error}
				</p>
			) : null}
		</div>
	);
}
