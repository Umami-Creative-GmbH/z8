"use client";

import { IconLoader2, IconPalette } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useEffect } from "react";
import { toast } from "sonner";
import {
	createOrganizationCategory,
	updateOrganizationCategory,
} from "@/app/[locale]/(app)/settings/work-categories/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

interface WorkCategoryDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	category?: {
		id: string;
		name: string;
		description: string | null;
		factor: string;
		color: string | null;
	} | null;
	onSuccess: () => void;
}

// Predefined color palette
const COLOR_PALETTE = [
	"#ef4444", // red
	"#f97316", // orange
	"#f59e0b", // amber
	"#eab308", // yellow
	"#84cc16", // lime
	"#22c55e", // green
	"#10b981", // emerald
	"#14b8a6", // teal
	"#06b6d4", // cyan
	"#0ea5e9", // sky
	"#3b82f6", // blue
	"#6366f1", // indigo
	"#8b5cf6", // violet
	"#a855f7", // purple
	"#d946ef", // fuchsia
	"#ec4899", // pink
];

export function WorkCategoryDialog({
	open,
	onOpenChange,
	organizationId,
	category,
	onSuccess,
}: WorkCategoryDialogProps) {
	const { t } = useTranslate();
	const isEditing = !!category;

	// Form
	const form = useForm({
		defaultValues: {
			name: category?.name || "",
			description: category?.description || "",
			factor: category?.factor || "1.00",
			color: category?.color || (null as string | null),
		},
		onSubmit: async ({ value }) => {
			if (isEditing && category) {
				updateMutation.mutate({
					categoryId: category.id,
					name: value.name,
					description: value.description || null,
					factor: value.factor,
					color: value.color,
				});
			} else {
				createMutation.mutate({
					organizationId,
					name: value.name,
					description: value.description || null,
					factor: value.factor,
					color: value.color,
				});
			}
		},
	});

	// Reset form when category changes or dialog opens
	useEffect(() => {
		if (open) {
			form.reset();
			form.setFieldValue("name", category?.name || "");
			form.setFieldValue("description", category?.description || "");
			form.setFieldValue("factor", category?.factor || "1.00");
			form.setFieldValue("color", category?.color || null);
		}
	}, [open, category, form]);

	// Create mutation
	const createMutation = useMutation({
		mutationFn: (data: {
			organizationId: string;
			name: string;
			description: string | null;
			factor: string;
			color: string | null;
		}) => createOrganizationCategory(data),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workCategories.categoryCreated", "Category created"));
				onSuccess();
			} else {
				toast.error(
					result.error ||
						t("settings.workCategories.categoryCreateFailed", "Failed to create category"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.workCategories.categoryCreateFailed", "Failed to create category"));
		},
	});

	// Update mutation
	const updateMutation = useMutation({
		mutationFn: (data: {
			categoryId: string;
			name: string;
			description: string | null;
			factor: string;
			color: string | null;
		}) => updateOrganizationCategory(data),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workCategories.categoryUpdated", "Category updated"));
				onSuccess();
			} else {
				toast.error(
					result.error ||
						t("settings.workCategories.categoryUpdateFailed", "Failed to update category"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.workCategories.categoryUpdateFailed", "Failed to update category"));
		},
	});

	const isMutating = createMutation.isPending || updateMutation.isPending;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>
						{isEditing
							? t("settings.workCategories.editCategory", "Edit Category")
							: t("settings.workCategories.createCategory", "Create Category")}
					</DialogTitle>
					<DialogDescription>
						{isEditing
							? t("settings.workCategories.editCategoryDescription", "Update the category details")
							: t(
									"settings.workCategories.createCategoryDescription",
									"Create a new work category that can be assigned to multiple sets",
								)}
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
				>
					<div className="space-y-4 py-4">
						{/* Name and Color */}
						<div className="flex gap-2">
							<form.Field name="color">
								{(field) => (
									<ColorPicker
										value={field.state.value}
										onChange={(color) => field.handleChange(color)}
										label={t("settings.workCategories.chooseColor", "Choose color")}
										colorOptionsLabel={t("settings.workCategories.colorOptions", "Color options")}
										noColorLabel={t("settings.workCategories.noColor", "No color")}
									/>
								)}
							</form.Field>
							<div className="flex-1 space-y-2">
								<Label htmlFor="category-name">
									{t("settings.workCategories.categoryName", "Name")}
								</Label>
								<form.Field name="name">
									{(field) => (
										<Input
											id="category-name"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											placeholder={t(
												"settings.workCategories.categoryNamePlaceholder",
												"e.g., Passive Travel",
											)}
										/>
									)}
								</form.Field>
							</div>
						</div>

						{/* Description */}
						<div className="space-y-2">
							<Label htmlFor="category-description">
								{t("settings.workCategories.description", "Description")}
							</Label>
							<form.Field name="description">
								{(field) => (
									<Textarea
										id="category-description"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										placeholder={t(
											"settings.workCategories.descriptionPlaceholder",
											"Optional description",
										)}
										rows={2}
									/>
								)}
							</form.Field>
						</div>

						{/* Factor */}
						<div className="space-y-2">
							<Label htmlFor="category-factor">
								{t("settings.workCategories.factor", "Factor")}
							</Label>
							<form.Field name="factor">
								{(field) => (
									<Input
										id="category-factor"
										type="number"
										step="0.01"
										min="0"
										max="2"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
									/>
								)}
							</form.Field>
							<p className="text-xs text-muted-foreground">
								{t(
									"settings.workCategories.factorExplanation",
									"Factor determines effective time: 0.5 = 50% (e.g., passive travel), 1.0 = 100% (normal work), 1.5 = 150% (overtime)",
								)}
							</p>
						</div>
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isMutating}>
							{isMutating ? (
								<>
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
									{t("common.saving", "Saving...")}
								</>
							) : isEditing ? (
								t("common.save", "Save")
							) : (
								t("common.create", "Create")
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

// Color name mapping for accessibility
const COLOR_NAMES: Record<string, string> = {
	"#ef4444": "Red",
	"#f97316": "Orange",
	"#f59e0b": "Amber",
	"#eab308": "Yellow",
	"#84cc16": "Lime",
	"#22c55e": "Green",
	"#10b981": "Emerald",
	"#14b8a6": "Teal",
	"#06b6d4": "Cyan",
	"#0ea5e9": "Sky",
	"#3b82f6": "Blue",
	"#6366f1": "Indigo",
	"#8b5cf6": "Violet",
	"#a855f7": "Purple",
	"#d946ef": "Fuchsia",
	"#ec4899": "Pink",
};

// Color picker component
function ColorPicker({
	value,
	onChange,
	label,
	colorOptionsLabel,
	noColorLabel,
}: {
	value: string | null;
	onChange: (color: string | null) => void;
	label: string;
	colorOptionsLabel: string;
	noColorLabel: string;
}) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="mt-8 h-9 w-9 flex-shrink-0"
					aria-label={label}
				>
					{value ? (
						<div
							className="h-5 w-5 rounded-full"
							style={{ backgroundColor: value }}
							aria-hidden="true"
						/>
					) : (
						<IconPalette className="h-4 w-4" aria-hidden="true" />
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-auto p-3">
				<div className="grid grid-cols-4 gap-2" role="listbox" aria-label={colorOptionsLabel}>
					{COLOR_PALETTE.map((color) => (
						<button
							key={color}
							type="button"
							role="option"
							aria-selected={value === color}
							aria-label={COLOR_NAMES[color] || color}
							className="h-6 w-6 rounded-full hover:scale-110 transition-transform focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
							style={{ backgroundColor: color }}
							onClick={() => onChange(color)}
						/>
					))}
					<button
						type="button"
						role="option"
						aria-selected={value === null}
						aria-label={noColorLabel}
						className="h-6 w-6 rounded-full border-2 border-dashed border-muted-foreground/50 hover:border-muted-foreground transition-colors flex items-center justify-center"
						onClick={() => onChange(null)}
					>
						<span className="text-xs text-muted-foreground" aria-hidden="true">
							x
						</span>
					</button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
