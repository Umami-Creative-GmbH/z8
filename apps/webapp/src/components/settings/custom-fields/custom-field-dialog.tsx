"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import {
	CUSTOM_FIELD_NAME_MAX_LENGTH,
	CUSTOM_FIELD_TYPES,
	type CustomFieldChange,
	type CustomFieldEntity,
	type CustomFieldType,
	FIELD_EDIT_LEVELS,
	FIELD_VISIBILITY_LEVELS,
	type FieldEditLevel,
	type FieldVisibility,
	isEditLevelWithinVisibility,
} from "@/lib/organization/custom-fields/definition-rules";
import type { CustomFieldDefinitionView } from "@/lib/organization/custom-fields/definitions";
import { entityLabel, levelLabel, typeLabel } from "./custom-field-labels";
import { CustomFieldOptionsEditor } from "./custom-field-options-editor";
import type { RunCustomFieldChange } from "./custom-fields-settings";

interface NumberSettingsValue {
	integerOnly: boolean;
	min: string;
	max: string;
}

interface FormValues {
	name: string;
	type: CustomFieldType;
	required: boolean;
	tracked: boolean;
	visibility: FieldVisibility;
	editLevel: FieldEditLevel;
	number: NumberSettingsValue;
	/** Initial select options, one per line (create only). */
	options: string;
}

function valuesOf(field: CustomFieldDefinitionView | undefined): FormValues {
	return {
		name: field?.name ?? "",
		type: field?.type ?? "text",
		required: field?.required ?? false,
		tracked: field?.tracked ?? false,
		visibility: field?.visibility ?? "admin",
		editLevel: field?.editLevel ?? "admin",
		number: {
			integerOnly: field?.number?.integerOnly ?? false,
			min: field?.number?.min ?? "",
			max: field?.number?.max ?? "",
		},
		options: "",
	};
}

function changeOf(
	values: FormValues,
	entity: CustomFieldEntity,
	field: CustomFieldDefinitionView | undefined,
): CustomFieldChange {
	const type = field?.type ?? values.type;
	const common = {
		name: values.name.trim(),
		required: type === "boolean" ? false : values.required,
		visibility: values.visibility,
		editLevel: values.editLevel,
		number:
			type === "number"
				? {
						integerOnly: values.number.integerOnly,
						min: values.number.min.trim() || null,
						max: values.number.max.trim() || null,
					}
				: null,
	};
	if (field) {
		return { kind: "update", fieldId: field.id, ...common, type: undefined, tracked: undefined };
	}
	return {
		kind: "create",
		entity,
		type,
		tracked: values.tracked,
		...common,
		options:
			type === "select"
				? values.options
						.split("\n")
						.map((line) => line.trim())
						.filter((line) => line.length > 0)
				: [],
	};
}

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
	typeof value === "string" && (values as readonly string[]).includes(value);

/**
 * Creates a custom field for `entity`, or edits `field`: its name, required
 * flag, visibility, edit level and number settings, and a select field's
 * options. Type and tracked flag are fixed once created. The parent remounts
 * the panel (new `key`) each time it opens, so the form starts afresh.
 */
export function CustomFieldDialog({
	open,
	onOpenChange,
	entity,
	field,
	pending,
	runChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	entity: CustomFieldEntity;
	field: CustomFieldDefinitionView | undefined;
	pending: boolean;
	runChange: RunCustomFieldChange;
}) {
	const { t } = useTranslate();
	const editing = field !== undefined;
	const form = useForm({
		defaultValues: valuesOf(field),
		onSubmit: async ({ value }) => {
			if (await runChange(changeOf(value, entity, field))) onOpenChange(false);
		},
	});
	const nameRequired = t("settings.customFields.form.nameRequired", "Enter a name");
	const requireName = ({ value }: { value: string }) => (value.trim() ? undefined : nameRequired);

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{editing
							? t("settings.customFields.form.editTitle", "Edit custom field")
							: t("settings.customFields.form.createTitle", "Add custom field")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t("settings.customFields.form.description", "A custom field on {entity}.", {
							entity: entityLabel(t, field?.entity ?? entity),
						})}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<form
					className="flex min-h-0 flex-1 flex-col"
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<ActionPanelBody className="space-y-4">
						<form.Field name="name" validators={{ onChange: requireName, onSubmit: requireName }}>
							{(formField) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(formField)}>
										{t("settings.customFields.form.name", "Name")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(formField)}>
										<Input
											value={formField.state.value}
											maxLength={CUSTOM_FIELD_NAME_MAX_LENGTH}
											onChange={(event) => formField.handleChange(event.target.value)}
											onBlur={formField.handleBlur}
										/>
									</TFormControl>
									<TFormMessage field={formField} />
								</TFormItem>
							)}
						</form.Field>

						<form.Field name="type">
							{(formField) => (
								<ChoiceSelect
									label={t("settings.customFields.form.type", "Type")}
									description={
										editing
											? t(
													"settings.customFields.form.typeFixed",
													"The type can't change after the field is created.",
												)
											: undefined
									}
									value={formField.state.value}
									choices={CUSTOM_FIELD_TYPES.map((type) => ({
										value: type,
										label: typeLabel(t, type),
									}))}
									disabled={editing}
									onChange={(value) => {
										if (isOneOf(CUSTOM_FIELD_TYPES, value)) formField.handleChange(value);
									}}
								/>
							)}
						</form.Field>

						<form.Subscribe selector={(state) => state.values.type}>
							{(type) => (
								<>
									{!editing && type === "select" ? (
										<form.Field name="options">
											{(formField) => (
												<TFormItem>
													<TFormLabel>
														{t("settings.customFields.form.options", "Options")}
													</TFormLabel>
													<TFormControl>
														<Textarea
															rows={4}
															value={formField.state.value}
															onChange={(event) => formField.handleChange(event.target.value)}
														/>
													</TFormControl>
													<TFormDescription>
														{t("settings.customFields.form.optionsHelp", "One option per line.")}
													</TFormDescription>
												</TFormItem>
											)}
										</form.Field>
									) : null}
									{type === "number" ? (
										<form.Field name="number">
											{(formField) => (
												<NumberSettingsInput
													value={formField.state.value}
													onChange={formField.handleChange}
												/>
											)}
										</form.Field>
									) : null}
									{type !== "boolean" ? (
										<form.Field name="required">
											{(formField) => (
												<SwitchRow
													id="custom-field-required"
													label={t("settings.customFields.form.required", "Required")}
													description={t(
														"settings.customFields.form.requiredHelp",
														"Forms refuse to save a record without a value.",
													)}
													checked={formField.state.value}
													onCheckedChange={formField.handleChange}
												/>
											)}
										</form.Field>
									) : null}
								</>
							)}
						</form.Subscribe>

						<form.Field name="tracked">
							{(formField) => (
								<SwitchRow
									id="custom-field-tracked"
									label={t("settings.customFields.form.tracked", "Keep a history")}
									description={
										editing
											? t(
													"settings.customFields.form.trackedFixed",
													"Whether a field keeps a history can't change after it is created.",
												)
											: t(
													"settings.customFields.form.trackedHelp",
													"Each value carries the date it is valid from.",
												)
									}
									checked={formField.state.value}
									onCheckedChange={formField.handleChange}
									disabled={editing}
								/>
							)}
						</form.Field>

						<form.Field name="visibility">
							{(formField) => (
								<ChoiceSelect
									label={t("settings.customFields.form.visibility", "Who can see values")}
									value={formField.state.value}
									choices={FIELD_VISIBILITY_LEVELS.map((level) => ({
										value: level,
										label: levelLabel(t, level),
									}))}
									onChange={(value) => {
										if (!isOneOf(FIELD_VISIBILITY_LEVELS, value)) return;
										formField.handleChange(value);
										if (!isEditLevelWithinVisibility(form.getFieldValue("editLevel"), value)) {
											form.setFieldValue("editLevel", "admin");
										}
									}}
								/>
							)}
						</form.Field>

						<form.Subscribe selector={(state) => state.values.visibility}>
							{(visibility) => (
								<form.Field name="editLevel">
									{(formField) => (
										<ChoiceSelect
											label={t("settings.customFields.form.editLevel", "Who can edit values")}
											description={t(
												"settings.customFields.form.editLevelHelp",
												"Employees never edit custom field values.",
											)}
											value={formField.state.value}
											choices={FIELD_EDIT_LEVELS.map((level) => ({
												value: level,
												label: levelLabel(t, level),
												disabled: !isEditLevelWithinVisibility(level, visibility),
											}))}
											onChange={(value) => {
												if (isOneOf(FIELD_EDIT_LEVELS, value)) formField.handleChange(value);
											}}
										/>
									)}
								</form.Field>
							)}
						</form.Subscribe>

						{field?.type === "select" ? (
							<CustomFieldOptionsEditor field={field} pending={pending} runChange={runChange} />
						) : null}
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button type="submit" disabled={pending || isSubmitting}>
									{pending || isSubmitting ? (
										<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
									) : null}
									{editing
										? t("settings.customFields.form.save", "Save changes")
										: t("settings.customFields.form.create", "Create field")}
								</Button>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}

function ChoiceSelect({
	label,
	description,
	value,
	choices,
	disabled,
	onChange,
}: {
	label: string;
	description?: string;
	value: string;
	choices: { value: string; label: string; disabled?: boolean }[];
	disabled?: boolean;
	onChange: (value: unknown) => void;
}) {
	return (
		<TFormItem>
			<TFormLabel>{label}</TFormLabel>
			<TFormControl>
				<Select value={value} disabled={disabled} onValueChange={(next: unknown) => onChange(next)}>
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{choices.map((choice) => (
							<SelectItem key={choice.value} value={choice.value} disabled={choice.disabled}>
								{choice.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</TFormControl>
			{description ? <TFormDescription>{description}</TFormDescription> : null}
		</TFormItem>
	);
}

function NumberSettingsInput({
	value,
	onChange,
}: {
	value: NumberSettingsValue;
	onChange: (value: NumberSettingsValue) => void;
}) {
	const { t } = useTranslate();
	return (
		<div className="space-y-3 rounded-lg border p-3">
			<div className="flex items-center justify-between gap-3">
				<Label htmlFor="custom-field-integer-only">
					{t("settings.customFields.form.integerOnly", "Whole numbers only")}
				</Label>
				<Switch
					id="custom-field-integer-only"
					checked={value.integerOnly}
					onCheckedChange={(integerOnly) => onChange({ ...value, integerOnly })}
				/>
			</div>
			<div className="grid gap-3 sm:grid-cols-2">
				<div className="grid gap-2">
					<Label htmlFor="custom-field-min">{t("settings.customFields.form.min", "Minimum")}</Label>
					<Input
						id="custom-field-min"
						inputMode="decimal"
						value={value.min}
						onChange={(event) => onChange({ ...value, min: event.target.value })}
					/>
				</div>
				<div className="grid gap-2">
					<Label htmlFor="custom-field-max">{t("settings.customFields.form.max", "Maximum")}</Label>
					<Input
						id="custom-field-max"
						inputMode="decimal"
						value={value.max}
						onChange={(event) => onChange({ ...value, max: event.target.value })}
					/>
				</div>
			</div>
			<p className="text-sm text-muted-foreground">
				{t("settings.customFields.form.boundsHelp", "Leave a bound empty for no limit.")}
			</p>
		</div>
	);
}

function SwitchRow({
	id,
	label,
	description,
	checked,
	onCheckedChange,
	disabled,
}: {
	id: string;
	label: string;
	description: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	disabled?: boolean;
}) {
	return (
		<div className="flex items-center justify-between gap-3 rounded-lg border p-3">
			<div className="space-y-0.5">
				<Label htmlFor={id}>{label}</Label>
				<p className="text-sm text-muted-foreground">{description}</p>
			</div>
			<Switch
				id={id}
				checked={checked}
				onCheckedChange={(value) => onCheckedChange(value)}
				disabled={disabled}
			/>
		</div>
	);
}
