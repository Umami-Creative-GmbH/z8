"use client";

import { IconLoader2, IconMapPin } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import {
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { ShiftTemplateLocations } from "./shift-template-management-controller";

export function ShiftTemplateDialogHeader({
	isEditing,
}: {
	isEditing: boolean;
}) {
	const { t } = useTranslate();

	return (
		<ActionPanelHeader>
			<ActionPanelTitle>
				{isEditing
					? t("settings.shiftTemplates.edit.title", "Edit Template")
					: t("settings.shiftTemplates.create.title", "Create Template")}
			</ActionPanelTitle>
			<ActionPanelDescription>
				{isEditing
					? t(
							"settings.shiftTemplates.edit.description",
							"Update the shift template details",
						)
					: t(
							"settings.shiftTemplates.create.description",
							"Create a new shift template for quick scheduling",
						)}
			</ActionPanelDescription>
		</ActionPanelHeader>
	);
}

interface ShiftTemplateSubareaFieldProps {
	value: string;
	onChange: (value: string) => void;
	locations: ShiftTemplateLocations;
	requireScopedSubareaSelection: boolean;
	getSubareaDisplay: (subareaId: string) => string;
}

export function ShiftTemplateSubareaField({
	value,
	onChange,
	locations,
	requireScopedSubareaSelection,
	getSubareaDisplay,
}: ShiftTemplateSubareaFieldProps) {
	const { t } = useTranslate();

	return (
		<div className="space-y-2">
			<Label className="flex items-center gap-2">
				<IconMapPin className="size-4" aria-hidden="true" />
				{t("settings.shiftTemplates.form.defaultSubarea", "Default Subarea")}
				<span className="text-xs text-muted-foreground">
					({t("common.optional", "Optional")})
				</span>
			</Label>
			<Select
				value={value}
				onValueChange={(nextValue) =>
					onChange(nextValue === "none" ? "" : nextValue)
				}
			>
				<SelectTrigger>
					<SelectValue
						placeholder={t(
							"settings.shiftTemplates.form.selectSubarea",
							"Select a subarea…",
						)}
					>
						{value
							? getSubareaDisplay(value)
							: t(
									"settings.shiftTemplates.form.noSubarea",
									"No default subarea",
								)}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					{!requireScopedSubareaSelection ? (
						<SelectItem value="none">
							{t(
								"settings.shiftTemplates.form.noSubarea",
								"No default subarea",
							)}
						</SelectItem>
					) : null}
					{locations.flatMap((location) =>
						location.subareas.flatMap((subarea) =>
							subarea.isActive
								? [
										<SelectItem key={subarea.id} value={subarea.id}>
											{t(
												"settings.shiftTemplates.form.subareaFormat",
												"{location} – {subarea}",
												{
													location: location.name,
													subarea: subarea.name,
												},
											)}
										</SelectItem>,
									]
								: [],
						),
					)}
				</SelectContent>
			</Select>
			<p className="text-xs text-muted-foreground">
				{t(
					"settings.shiftTemplates.form.subareaHelp",
					"When using this template, shifts will be pre-assigned to this subarea.",
				)}
			</p>
		</div>
	);
}

export function ShiftTemplateSubmitButton({
	isSubmitting,
	disabled,
	isEditing,
}: {
	isSubmitting: boolean;
	disabled: boolean;
	isEditing: boolean;
}) {
	const { t } = useTranslate();

	return (
		<Button type="submit" disabled={disabled}>
			{isSubmitting ? (
				<>
					<IconLoader2
						className="mr-2 size-4 animate-spin"
						aria-hidden="true"
					/>
					{t("common.saving", "Saving…")}
				</>
			) : isEditing ? (
				t("common.save", "Save")
			) : (
				t("common.create", "Create")
			)}
		</Button>
	);
}
