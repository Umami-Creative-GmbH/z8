"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
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
import { ALL_LANGUAGES } from "@/tolgee/shared";
import {
	type AbsenceCategoryForSettings,
	buildAbsenceCategoryPayload,
	getAbsenceCategoryFormValues,
} from "./absence-category-form-utils";

export interface AbsenceCategoryFormProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	existingCategory?: AbsenceCategoryForSettings;
	onSuccess?: () => void;
}

const absenceCategoryTypeOptions: Array<{
	value: AbsenceCategoryType;
	labelKey: string;
	fallback: string;
}> = [
	{ value: "custom", labelKey: "settings.absenceCategories.form.typeCustom", fallback: "Custom" },
	{
		value: "vacation",
		labelKey: "settings.absenceCategories.form.typeVacation",
		fallback: "Vacation",
	},
	{ value: "sick", labelKey: "settings.absenceCategories.form.typeSick", fallback: "Sick Leave" },
	{
		value: "home_office",
		labelKey: "settings.absenceCategories.form.typeHomeOffice",
		fallback: "Home Office",
	},
	{
		value: "personal",
		labelKey: "settings.absenceCategories.form.typePersonal",
		fallback: "Personal",
	},
	{ value: "unpaid", labelKey: "settings.absenceCategories.form.typeUnpaid", fallback: "Unpaid" },
	{
		value: "parental",
		labelKey: "settings.absenceCategories.form.typeParental",
		fallback: "Parental Leave",
	},
	{
		value: "bereavement",
		labelKey: "settings.absenceCategories.form.typeBereavement",
		fallback: "Bereavement",
	},
];

function getFieldError(error: unknown) {
	if (typeof error === "string") {
		return error;
	}

	return error && typeof error === "object" && "message" in error
		? String(error.message)
		: "Invalid value";
}

// eslint-disable-next-line react-doctor/no-giant-component
export function AbsenceCategoryForm({
	open,
	onOpenChange,
	organizationId,
	existingCategory,
	onSuccess,
}: AbsenceCategoryFormProps) {
	const { t } = useTranslate();
	const [loading, setLoading] = useState(false);

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
			}

			setLoading(false);
		},
	});

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
					onSubmit={form.handleSubmit}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="space-y-6">
						<form.Field
							name="name"
							validators={{
								onChange: z
									.string()
									.trim()
									.min(
										1,
										t("settings.absenceCategories.form.nameRequired", "Category name is required"),
									)
									.max(
										100,
										t(
											"settings.absenceCategories.form.nameMaxLength",
											"Use 100 characters or fewer",
										),
									),
								onSubmit: z
									.string()
									.trim()
									.min(
										1,
										t("settings.absenceCategories.form.nameRequired", "Category name is required"),
									)
									.max(
										100,
										t(
											"settings.absenceCategories.form.nameMaxLength",
											"Use 100 characters or fewer",
										),
									),
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="absenceCategoryName">
										{t("settings.absenceCategories.form.name", "Name")}
									</Label>
									<Input
										id="absenceCategoryName"
										name="name"
										autoComplete="off"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.absenceCategories.form.namePlaceholder",
											"e.g., Training Day…",
										)}
									/>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.absenceCategories.form.nameHelp",
											"Use a clear label employees and approvers will recognize.",
										)}
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
										<Label htmlFor="absenceCategoryType">
											{t("settings.absenceCategories.form.type", "Type")}
										</Label>
										<Select
											value={field.state.value}
											onValueChange={(value) => field.handleChange(value as AbsenceCategoryType)}
										>
											<SelectTrigger id="absenceCategoryType" className="w-full">
												<SelectValue
													placeholder={t(
														"settings.absenceCategories.form.typePlaceholder",
														"Select category type",
													)}
												/>
											</SelectTrigger>
											<SelectContent>
												{absenceCategoryTypeOptions.map((option) => (
													<SelectItem key={option.value} value={option.value}>
														{t(option.labelKey, option.fallback)}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<p className="text-sm text-muted-foreground">
											{t(
												"settings.absenceCategories.form.typeHelp",
												"Groups reports and downstream absence workflows.",
											)}
										</p>
									</div>
								)}
							</form.Field>

							<form.Field name="color">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="absenceCategoryColor">
											{t("settings.absenceCategories.form.color", "Color")}
										</Label>
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
										<p className="text-sm text-muted-foreground">
											{t("settings.absenceCategories.form.colorHelp", "Calendar marker")}
										</p>
									</div>
								)}
							</form.Field>
						</div>

						<form.Field name="description">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="absenceCategoryDescription">
										{t("settings.absenceCategories.form.description", "Description")}
									</Label>
									<Textarea
										id="absenceCategoryDescription"
										name="description"
										autoComplete="off"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.absenceCategories.form.descriptionPlaceholder",
											"e.g., Use for approved training or certification days…",
										)}
									/>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.absenceCategories.form.descriptionHelp",
											"Optional guidance shown to admins and reviewers.",
										)}
									</p>
								</div>
							)}
						</form.Field>

						<section className="space-y-3">
							<div className="space-y-1">
								<h3 className="text-sm font-medium">
									{t("settings.absenceCategories.form.translations", "Translations")}
								</h3>
								<p className="text-sm text-muted-foreground">
									{t(
										"settings.absenceCategories.form.translationsHelp",
										"Optional localized labels for employees using another app language.",
									)}
								</p>
							</div>
							<div className="space-y-4">
								{ALL_LANGUAGES.map((locale) => {
									const localeLabel = locale.toUpperCase();

									return (
										<div key={locale} className="grid gap-3 md:grid-cols-2">
											<form.Field name={`nameTranslations.${locale}`}>
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={`absenceCategoryNameTranslation-${locale}`}>
															{t(
																"settings.absenceCategories.form.nameTranslation",
																"{locale} name",
																{ locale: localeLabel },
															)}
														</Label>
														<Input
															id={`absenceCategoryNameTranslation-${locale}`}
															autoComplete="off"
															value={field.state.value ?? ""}
															onChange={(event) => field.handleChange(event.target.value)}
															onBlur={field.handleBlur}
															placeholder={t(
																"settings.absenceCategories.form.nameTranslationPlaceholder",
																"Localized name",
															)}
														/>
													</div>
												)}
											</form.Field>

											<form.Field name={`descriptionTranslations.${locale}`}>
												{(field) => (
													<div className="space-y-2">
														<Label htmlFor={`absenceCategoryDescriptionTranslation-${locale}`}>
															{t(
																"settings.absenceCategories.form.descriptionTranslation",
																"{locale} description",
																{ locale: localeLabel },
															)}
														</Label>
														<Input
															id={`absenceCategoryDescriptionTranslation-${locale}`}
															autoComplete="off"
															value={field.state.value ?? ""}
															onChange={(event) => field.handleChange(event.target.value)}
															onBlur={field.handleBlur}
															placeholder={t(
																"settings.absenceCategories.form.descriptionTranslationPlaceholder",
																"Localized description",
															)}
														/>
													</div>
												)}
											</form.Field>
										</div>
									);
								})}
							</div>
						</section>

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
												{t("settings.absenceCategories.form.requiresApproval", "Requires Approval")}
											</Label>
											<p className="text-sm text-muted-foreground">
												{t(
													"settings.absenceCategories.form.requiresApprovalHelp",
													"Managers must approve requests before they become active.",
												)}
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
												{t(
													"settings.absenceCategories.form.countsAgainstVacation",
													"Counts Against Vacation Balance",
												)}
											</Label>
											<p className="text-sm text-muted-foreground">
												{t(
													"settings.absenceCategories.form.countsAgainstVacationHelp",
													"Deduct approved days from the employee vacation allowance.",
												)}
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
												{t(
													"settings.absenceCategories.form.requiresWorkTime",
													"Requires Work Time",
												)}
											</Label>
											<p className="text-sm text-muted-foreground">
												{t(
													"settings.absenceCategories.form.requiresWorkTimeHelp",
													"Employees must record work time for this absence category.",
												)}
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
											{t("settings.absenceCategories.form.active", "Active")}
										</Label>
										<p className="text-sm text-muted-foreground">
											{t(
												"settings.absenceCategories.form.activeHelp",
												"Active categories are available for new absence requests.",
											)}
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
