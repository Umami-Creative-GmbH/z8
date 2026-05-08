"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import type { AbsenceCategoryType } from "@/app/[locale]/(app)/settings/vacation/actions";
import {
	createAbsenceCategory,
	updateAbsenceCategory,
} from "@/app/[locale]/(app)/settings/vacation/actions";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";

export interface AbsenceCategoryForSettings {
	id: string;
	type: AbsenceCategoryType;
	name: string;
	description: string | null;
	requiresWorkTime: boolean;
	requiresApproval: boolean;
	countsAgainstVacation: boolean;
	color: string | null;
	isActive: boolean;
}

export interface AbsenceCategoryFormProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	existingCategory?: AbsenceCategoryForSettings;
	onSuccess?: () => void;
}

export type AbsenceCategoryFormValues = {
	name: string;
	type: AbsenceCategoryType;
	description: string;
	requiresWorkTime: boolean;
	requiresApproval: boolean;
	countsAgainstVacation: boolean;
	color: string;
	isActive: boolean;
};

const DEFAULT_CATEGORY_COLOR = "#3b82f6";

export const defaultAbsenceCategoryFormValues: AbsenceCategoryFormValues = {
	name: "",
	type: "custom",
	description: "",
	requiresWorkTime: false,
	requiresApproval: true,
	countsAgainstVacation: false,
	color: DEFAULT_CATEGORY_COLOR,
	isActive: true,
};

const absenceCategoryTypeOptions: Array<{ value: AbsenceCategoryType; label: string }> = [
	{ value: "custom", label: "Custom" },
	{ value: "vacation", label: "Vacation" },
	{ value: "sick", label: "Sick Leave" },
	{ value: "home_office", label: "Home Office" },
	{ value: "personal", label: "Personal" },
	{ value: "unpaid", label: "Unpaid" },
	{ value: "parental", label: "Parental Leave" },
	{ value: "bereavement", label: "Bereavement" },
];

export function getAbsenceCategoryFormValues(
	existingCategory?: AbsenceCategoryForSettings,
): AbsenceCategoryFormValues {
	if (!existingCategory) {
		return { ...defaultAbsenceCategoryFormValues };
	}

	return {
		name: existingCategory.name,
		type: existingCategory.type,
		description: existingCategory.description ?? "",
		requiresWorkTime: existingCategory.requiresWorkTime,
		requiresApproval: existingCategory.requiresApproval,
		countsAgainstVacation: existingCategory.countsAgainstVacation,
		color: existingCategory.color ?? DEFAULT_CATEGORY_COLOR,
		isActive: existingCategory.isActive,
	};
}

export function buildAbsenceCategoryPayload(value: AbsenceCategoryFormValues) {
	return {
		name: value.name.trim(),
		type: value.type,
		description: value.description.trim(),
		requiresWorkTime: value.requiresWorkTime,
		requiresApproval: value.requiresApproval,
		countsAgainstVacation: value.countsAgainstVacation,
		color: value.color.trim(),
		isActive: value.isActive,
	};
}

function getFieldError(error: unknown) {
	if (typeof error === "string") {
		return error;
	}

	return error && typeof error === "object" && "message" in error
		? String(error.message)
		: "Invalid value";
}

export function AbsenceCategoryForm({
	open,
	onOpenChange,
	organizationId,
	existingCategory,
	onSuccess,
}: AbsenceCategoryFormProps) {
	const { t } = useTranslate();
	const [loading, setLoading] = useState(false);
	const categoryId = existingCategory?.id;
	const categoryType = existingCategory?.type;
	const categoryName = existingCategory?.name;
	const categoryDescription = existingCategory?.description;
	const categoryRequiresWorkTime = existingCategory?.requiresWorkTime;
	const categoryRequiresApproval = existingCategory?.requiresApproval;
	const categoryCountsAgainstVacation = existingCategory?.countsAgainstVacation;
	const categoryColor = existingCategory?.color;
	const categoryIsActive = existingCategory?.isActive;

	const form = useForm({
		defaultValues: getAbsenceCategoryFormValues(existingCategory),
		onSubmit: async ({ value }) => {
			setLoading(true);

			try {
				const payload = buildAbsenceCategoryPayload(value);
				const result = existingCategory
					? await updateAbsenceCategory(existingCategory.id, {
							...payload,
						})
					: await createAbsenceCategory({
							...payload,
							organizationId,
						});

				if (result.success) {
					toast.success(
						existingCategory
							? t("settings.absenceCategories.categoryUpdated", "Absence category updated")
							: t("settings.absenceCategories.categoryCreated", "Absence category created"),
					);
					onSuccess?.();
					onOpenChange(false);
				} else {
					toast.error(
						result.error ||
							t("settings.absenceCategories.saveFailed", "Could not save the absence category"),
					);
				}
			} catch (_error) {
				toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			} finally {
				setLoading(false);
			}
		},
	});

	useEffect(() => {
		if (open) {
			form.reset(
				categoryId
					? {
							name: categoryName ?? "",
							type: categoryType ?? "custom",
							description: categoryDescription ?? "",
							requiresWorkTime: categoryRequiresWorkTime ?? false,
							requiresApproval: categoryRequiresApproval ?? true,
							countsAgainstVacation: categoryCountsAgainstVacation ?? false,
							color: categoryColor ?? DEFAULT_CATEGORY_COLOR,
							isActive: categoryIsActive ?? true,
						}
					: { ...defaultAbsenceCategoryFormValues },
			);
		}
	}, [
		open,
		categoryId,
		categoryType,
		categoryName,
		categoryDescription,
		categoryRequiresWorkTime,
		categoryRequiresApproval,
		categoryCountsAgainstVacation,
		categoryColor,
		categoryIsActive,
		form,
	]);

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{existingCategory
							? t("settings.absenceCategories.editCategory", 'Edit "{name}"', {
									name: existingCategory.name,
								})
							: t("settings.absenceCategories.createCategory", "Create Absence Category")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.absenceCategories.categoryDescription",
							"Configure how this organization records, approves, and reports this type of absence.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<form
					onSubmit={(event) => {
						event.preventDefault();
						form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="space-y-6">
						<form.Field
							name="name"
							validators={{
								onChange: z
									.string()
									.trim()
									.min(1, "Category name is required")
									.max(100, "Use 100 characters or fewer"),
								onSubmit: z
									.string()
									.trim()
									.min(1, "Category name is required")
									.max(100, "Use 100 characters or fewer"),
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="absenceCategoryName">Name</Label>
									<Input
										id="absenceCategoryName"
										name="name"
										autoComplete="off"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										placeholder="e.g., Training Day…"
									/>
									<p className="text-sm text-muted-foreground">
										Use a clear label employees and approvers will recognize.
									</p>
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm text-destructive" role="alert" aria-live="polite">
											{getFieldError(field.state.meta.errors[0])}
										</p>
									)}
								</div>
							)}
						</form.Field>

						<div className="grid gap-4 md:grid-cols-[1fr_auto]">
							<form.Field name="type">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="absenceCategoryType">Type</Label>
										<Select
											value={field.state.value}
											onValueChange={(value) => field.handleChange(value as AbsenceCategoryType)}
										>
											<SelectTrigger id="absenceCategoryType" className="w-full">
												<SelectValue placeholder="Select category type" />
											</SelectTrigger>
											<SelectContent>
												{absenceCategoryTypeOptions.map((option) => (
													<SelectItem key={option.value} value={option.value}>
														{option.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<p className="text-sm text-muted-foreground">
											Groups reports and downstream absence workflows.
										</p>
									</div>
								)}
							</form.Field>

							<form.Field name="color">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="absenceCategoryColor">Color</Label>
										<Input
											id="absenceCategoryColor"
											name="color"
											type="color"
											autoComplete="off"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
											className="h-10 w-full p-1 md:w-24"
										/>
										<p className="text-sm text-muted-foreground">Calendar marker</p>
									</div>
								)}
							</form.Field>
						</div>

						<form.Field name="description">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="absenceCategoryDescription">Description</Label>
									<Textarea
										id="absenceCategoryDescription"
										name="description"
										autoComplete="off"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										placeholder="e.g., Use for approved training or certification days…"
									/>
									<p className="text-sm text-muted-foreground">
										Optional guidance shown to admins and reviewers.
									</p>
								</div>
							)}
						</form.Field>

						<div className="space-y-3">
							<form.Field name="requiresApproval">
								{(field) => (
									<div className="flex items-start gap-3 rounded-lg border p-4">
										<Checkbox
											id="absenceCategoryRequiresApproval"
											checked={field.state.value}
											onCheckedChange={(checked) => field.handleChange(checked === true)}
										/>
										<div className="space-y-1 leading-none">
											<Label htmlFor="absenceCategoryRequiresApproval" className="cursor-pointer">
												Requires Approval
											</Label>
											<p className="text-sm text-muted-foreground">
												Managers must approve requests before they become active.
											</p>
										</div>
									</div>
								)}
							</form.Field>

							<form.Field name="countsAgainstVacation">
								{(field) => (
									<div className="flex items-start gap-3 rounded-lg border p-4">
										<Checkbox
											id="absenceCategoryCountsAgainstVacation"
											checked={field.state.value}
											onCheckedChange={(checked) => field.handleChange(checked === true)}
										/>
										<div className="space-y-1 leading-none">
											<Label
												htmlFor="absenceCategoryCountsAgainstVacation"
												className="cursor-pointer"
											>
												Counts Against Vacation Balance
											</Label>
											<p className="text-sm text-muted-foreground">
												Deduct approved days from the employee vacation allowance.
											</p>
										</div>
									</div>
								)}
							</form.Field>

							<form.Field name="requiresWorkTime">
								{(field) => (
									<div className="flex items-start gap-3 rounded-lg border p-4">
										<Checkbox
											id="absenceCategoryRequiresWorkTime"
											checked={field.state.value}
											onCheckedChange={(checked) => field.handleChange(checked === true)}
										/>
										<div className="space-y-1 leading-none">
											<Label htmlFor="absenceCategoryRequiresWorkTime" className="cursor-pointer">
												Requires Work Time
											</Label>
											<p className="text-sm text-muted-foreground">
												Employees must record work time for this absence category.
											</p>
										</div>
									</div>
								)}
							</form.Field>
						</div>

						<form.Field name="isActive">
							{(field) => (
								<div className="flex items-center justify-between gap-4 rounded-lg border p-4">
									<div className="space-y-1">
										<Label htmlFor="absenceCategoryIsActive" className="text-base">
											Active
										</Label>
										<p className="text-sm text-muted-foreground">
											Active categories are available for new absence requests.
										</p>
									</div>
									<Switch
										id="absenceCategoryIsActive"
										checked={field.state.value}
										onCheckedChange={field.handleChange}
									/>
								</div>
							)}
						</form.Field>
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={loading}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={loading}>
							{loading && <IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
							{loading
								? t("common.saving", "Saving…")
								: existingCategory
									? t("settings.absenceCategories.updateCategory", "Update Category")
									: t("settings.absenceCategories.createCategoryButton", "Create Category")}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
