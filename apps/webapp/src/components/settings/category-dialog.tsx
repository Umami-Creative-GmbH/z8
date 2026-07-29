"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";

interface CategoryDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	editingCategory?: {
		id: string;
		type: string;
		name: string;
		description: string | null;
		color: string | null;
		blocksTimeEntry: boolean;
		excludeFromCalculations: boolean;
		isActive: boolean;
	};
	onSuccess: () => void;
}

type CategoryType =
	| "public_holiday"
	| "company_holiday"
	| "training_day"
	| "custom";

function useCategoryDialogForm({
	organizationId,
	editingCategory,
	onSuccess,
	onOpenChange,
}: Pick<
	CategoryDialogProps,
	"organizationId" | "editingCategory" | "onSuccess" | "onOpenChange"
>) {
	const { t } = useTranslate();
	const [loading, setLoading] = useState(false);
	const isEditing = !!editingCategory;
	const form = useForm({
		defaultValues: {
			type: (editingCategory?.type || "public_holiday") as CategoryType,
			name: editingCategory?.name || "",
			description: editingCategory?.description || "",
			color: editingCategory?.color || "",
			blocksTimeEntry: editingCategory?.blocksTimeEntry ?? true,
			excludeFromCalculations: editingCategory?.excludeFromCalculations ?? true,
			isActive: editingCategory?.isActive ?? true,
		},
		onSubmit: async ({ value }) => {
			setLoading(true);
			const response = await fetch(
				isEditing
					? `/api/org-admin/holiday-categories/${editingCategory.id}`
					: "/api/org-admin/holiday-categories",
				{
					method: isEditing ? "PATCH" : "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						...value,
						organizationId,
						color: value.color || null,
					}),
				},
			).then(
				(result) => result,
				() => null,
			);
			if (!response?.ok) {
				const responseError = response
					? await response.json().then(
							(result) => result as { error?: string },
							() => null,
						)
					: null;
				toast.error(
					responseError?.error ||
						t(
							"settings.holidays.categories.saveFailed",
							"Failed to save category",
						),
				);
				setLoading(false);
				return;
			}
			toast.success(
				t(
					isEditing
						? "settings.holidays.categories.updated"
						: "settings.holidays.categories.created",
					isEditing
						? "Category updated successfully"
						: "Category created successfully",
				),
			);
			onSuccess();
			onOpenChange(false);
			form.reset();
			setLoading(false);
		},
	});
	return { form, isEditing, loading };
}

export function CategoryDialog({
	open,
	onOpenChange,
	organizationId,
	editingCategory,
	onSuccess,
}: CategoryDialogProps) {
	const { t } = useTranslate();
	const { form, isEditing, loading } = useCategoryDialogForm({
		organizationId,
		editingCategory,
		onSuccess,
		onOpenChange,
	});

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<CategoryDialogHeader isEditing={isEditing} />

				<form
					action={() => {
						void form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="space-y-4">
						{/* Category Type */}
						<form.Field name="type">
							{(field) => (
								<div className="space-y-2">
									<Label>
										{t("settings.holidays.categories.form.type", "Type")}
									</Label>
									<Select
										value={field.state.value}
										onValueChange={(value) =>
											field.handleChange(value as CategoryType)
										}
									>
										<SelectTrigger>
											<SelectValue
												placeholder={t(
													"settings.holidays.categories.form.typePlaceholder",
													"Select a category type",
												)}
											/>
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="public_holiday">
												{t(
													"settings.holidays.categories.types.public",
													"Public Holiday",
												)}
											</SelectItem>
											<SelectItem value="company_holiday">
												{t(
													"settings.holidays.categories.types.company",
													"Company Holiday",
												)}
											</SelectItem>
											<SelectItem value="training_day">
												{t(
													"settings.holidays.categories.types.training",
													"Training Day",
												)}
											</SelectItem>
											<SelectItem value="custom">
												{t(
													"settings.holidays.categories.types.custom",
													"Custom",
												)}
											</SelectItem>
										</SelectContent>
									</Select>
								</div>
							)}
						</form.Field>

						{/* Name */}
						<form.Field
							name="name"
							validators={{
								onChange: ({ value }) => {
									if (!value) return "Name is required";
									if (value.length > 100) return "Name is too long";
									return undefined;
								},
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label>
										{t("settings.holidays.categories.form.name", "Name")}
									</Label>
									<Input
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.holidays.categories.form.namePlaceholder",
											"e.g., National Holidays",
										)}
									/>
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm text-destructive">
											{field.state.meta.errors[0]}
										</p>
									)}
								</div>
							)}
						</form.Field>

						{/* Description */}
						<form.Field name="description">
							{(field) => (
								<div className="space-y-2">
									<Label>
										{t(
											"settings.holidays.categories.form.description",
											"Description",
										)}{" "}
										(
										{t(
											"settings.holidays.categories.form.optional",
											"optional",
										)}
										)
									</Label>
									<Textarea
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.holidays.categories.form.descriptionPlaceholder",
											"Add a description...",
										)}
										rows={3}
									/>
								</div>
							)}
						</form.Field>

						{/* Color */}
						<form.Field name="color">
							{(field) => (
								<div className="space-y-2">
									<Label>
										{t("settings.holidays.categories.form.color", "Color")} (
										{t(
											"settings.holidays.categories.form.optional",
											"optional",
										)}
										)
									</Label>
									<div className="flex gap-2">
										<Input
											type="color"
											value={field.state.value || "#3B82F6"}
											onChange={(e) => field.handleChange(e.target.value)}
											className="w-20 h-10 cursor-pointer"
										/>
										<Input
											type="text"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											placeholder={t(
												"settings.holidays.categories.form.colorPlaceholder",
												"#3B82F6",
											)}
											className="flex-1"
										/>
									</div>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.holidays.categories.form.colorDescription",
											"Hex color code for calendar display",
										)}
									</p>
								</div>
							)}
						</form.Field>

						{/* Blocks Time Entry Toggle */}
						<form.Field name="blocksTimeEntry">
							{(field) => (
								<CategoryToggleField
									label={t(
										"settings.holidays.categories.form.blocksTimeEntry",
										"Blocks Time Entry",
									)}
									description={t(
										"settings.holidays.categories.form.blocksTimeEntryDescription",
										"Prevent employees from clocking in/out on holidays in this category",
									)}
									checked={field.state.value}
									onCheckedChange={field.handleChange}
								/>
							)}
						</form.Field>

						{/* Exclude from Calculations Toggle */}
						<form.Field name="excludeFromCalculations">
							{(field) => (
								<CategoryToggleField
									label={t(
										"settings.holidays.categories.form.excludeFromCalculations",
										"Exclude from Calculations",
									)}
									description={t(
										"settings.holidays.categories.form.excludeFromCalculationsDescription",
										"Exclude holidays in this category from work time calculations",
									)}
									checked={field.state.value}
									onCheckedChange={field.handleChange}
								/>
							)}
						</form.Field>

						{/* Active Toggle */}
						<form.Field name="isActive">
							{(field) => (
								<CategoryToggleField
									label={t(
										"settings.holidays.categories.form.active",
										"Active",
									)}
									description={t(
										"settings.holidays.categories.form.activeDescription",
										"Inactive categories cannot be assigned to new holidays",
									)}
									checked={field.state.value}
									onCheckedChange={field.handleChange}
								/>
							)}
						</form.Field>
					</ActionPanelBody>

					<CategoryDialogFooter
						isEditing={isEditing}
						loading={loading}
						onCancel={() => onOpenChange(false)}
					/>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}

function CategoryToggleField({
	label,
	description,
	checked,
	onCheckedChange,
}: {
	label: string;
	description: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
}) {
	return (
		<div className="flex items-center justify-between rounded-lg border p-3">
			<div className="space-y-0.5">
				<Label>{label}</Label>
				<p className="text-sm text-muted-foreground">{description}</p>
			</div>
			<Switch checked={checked} onCheckedChange={onCheckedChange} />
		</div>
	);
}

function CategoryDialogFooter({
	isEditing,
	loading,
	onCancel,
}: {
	isEditing: boolean;
	loading: boolean;
	onCancel: () => void;
}) {
	const { t } = useTranslate();
	return (
		<ActionPanelFooter>
			<Button
				type="button"
				variant="outline"
				onClick={onCancel}
				disabled={loading}
			>
				{t("common.cancel", "Cancel")}
			</Button>
			<Button type="submit" disabled={loading}>
				{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
				{isEditing ? t("common.save", "Save") : t("common.create", "Create")}
			</Button>
		</ActionPanelFooter>
	);
}

function CategoryDialogHeader({ isEditing }: { isEditing: boolean }) {
	const { t } = useTranslate();
	return (
		<ActionPanelHeader>
			<ActionPanelTitle>
				{isEditing
					? t("settings.holidays.categories.edit", "Edit Category")
					: t("settings.holidays.categories.add", "Add Category")}
			</ActionPanelTitle>
			<ActionPanelDescription>
				{t(
					"settings.holidays.categories.form.description",
					"Create or update a holiday category for your organization",
				)}
			</ActionPanelDescription>
		</ActionPanelHeader>
	);
}
