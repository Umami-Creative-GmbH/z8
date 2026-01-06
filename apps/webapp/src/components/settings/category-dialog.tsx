"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { type CategoryFormValues, categoryFormSchema } from "@/lib/holidays/validation";

interface CategoryDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	editingCategory?: any;
	onSuccess: () => void;
}

export function CategoryDialog({
	open,
	onOpenChange,
	organizationId,
	editingCategory,
	onSuccess,
}: CategoryDialogProps) {
	const { t } = useTranslate();
	const [loading, setLoading] = useState(false);
	const isEditing = !!editingCategory;

	const form = useForm<CategoryFormValues>({
		resolver: zodResolver(categoryFormSchema),
		defaultValues: editingCategory
			? {
					type: editingCategory.type,
					name: editingCategory.name,
					description: editingCategory.description || "",
					color: editingCategory.color || "",
					blocksTimeEntry: editingCategory.blocksTimeEntry,
					excludeFromCalculations: editingCategory.excludeFromCalculations,
					isActive: editingCategory.isActive,
				}
			: {
					type: "public_holiday",
					name: "",
					description: "",
					color: "",
					blocksTimeEntry: true,
					excludeFromCalculations: true,
					isActive: true,
				},
	});

	async function onSubmit(values: CategoryFormValues) {
		setLoading(true);

		try {
			const payload = {
				...values,
				organizationId,
				color: values.color || null,
			};

			const endpoint = isEditing
				? `/api/admin/holiday-categories/${editingCategory.id}`
				: "/api/admin/holiday-categories";
			const method = isEditing ? "PATCH" : "POST";

			const response = await fetch(endpoint, {
				method,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.error || "Failed to save category");
			}

			toast.success(
				t(
					isEditing
						? "settings.holidays.categories.updated"
						: "settings.holidays.categories.created",
					isEditing ? "Category updated successfully" : "Category created successfully",
				),
			);

			onSuccess();
			onOpenChange(false);
			form.reset();
		} catch (error: any) {
			toast.error(
				error.message || t("settings.holidays.categories.saveFailed", "Failed to save category"),
			);
		} finally {
			setLoading(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{isEditing
							? t("settings.holidays.categories.edit", "Edit Category")
							: t("settings.holidays.categories.add", "Add Category")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"settings.holidays.categories.form.description",
							"Create or update a holiday category for your organization",
						)}
					</DialogDescription>
				</DialogHeader>

				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
						{/* Category Type */}
						<FormField
							control={form.control}
							name="type"
							render={({ field }) => (
								<FormItem>
									<FormLabel>{t("settings.holidays.categories.form.type", "Type")}</FormLabel>
									<Select onValueChange={field.onChange} defaultValue={field.value}>
										<FormControl>
											<SelectTrigger>
												<SelectValue
													placeholder={t(
														"settings.holidays.categories.form.typePlaceholder",
														"Select a category type",
													)}
												/>
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											<SelectItem value="public_holiday">
												{t("settings.holidays.categories.types.public", "Public Holiday")}
											</SelectItem>
											<SelectItem value="company_holiday">
												{t("settings.holidays.categories.types.company", "Company Holiday")}
											</SelectItem>
											<SelectItem value="training_day">
												{t("settings.holidays.categories.types.training", "Training Day")}
											</SelectItem>
											<SelectItem value="custom">
												{t("settings.holidays.categories.types.custom", "Custom")}
											</SelectItem>
										</SelectContent>
									</Select>
									<FormMessage />
								</FormItem>
							)}
						/>

						{/* Name */}
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>{t("settings.holidays.categories.form.name", "Name")}</FormLabel>
									<FormControl>
										<Input
											{...field}
											placeholder={t(
												"settings.holidays.categories.form.namePlaceholder",
												"e.g., National Holidays",
											)}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						{/* Description */}
						<FormField
							control={form.control}
							name="description"
							render={({ field }) => (
								<FormItem>
									<FormLabel>
										{t("settings.holidays.categories.form.description", "Description")} (
										{t("settings.holidays.categories.form.optional", "optional")})
									</FormLabel>
									<FormControl>
										<Textarea
											{...field}
											placeholder={t(
												"settings.holidays.categories.form.descriptionPlaceholder",
												"Add a description...",
											)}
											rows={3}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						{/* Color */}
						<FormField
							control={form.control}
							name="color"
							render={({ field }) => (
								<FormItem>
									<FormLabel>
										{t("settings.holidays.categories.form.color", "Color")} (
										{t("settings.holidays.categories.form.optional", "optional")})
									</FormLabel>
									<div className="flex gap-2">
										<FormControl>
											<Input {...field} type="color" className="w-20 h-10 cursor-pointer" />
										</FormControl>
										<FormControl>
											<Input
												{...field}
												type="text"
												placeholder={t(
													"settings.holidays.categories.form.colorPlaceholder",
													"#3B82F6",
												)}
												className="flex-1"
											/>
										</FormControl>
									</div>
									<FormDescription>
										{t(
											"settings.holidays.categories.form.colorDescription",
											"Hex color code for calendar display",
										)}
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						{/* Blocks Time Entry Toggle */}
						<FormField
							control={form.control}
							name="blocksTimeEntry"
							render={({ field }) => (
								<FormItem className="flex items-center justify-between rounded-lg border p-3">
									<div className="space-y-0.5">
										<FormLabel>
											{t("settings.holidays.categories.form.blocksTimeEntry", "Blocks Time Entry")}
										</FormLabel>
										<FormDescription>
											{t(
												"settings.holidays.categories.form.blocksTimeEntryDescription",
												"Prevent employees from clocking in/out on holidays in this category",
											)}
										</FormDescription>
									</div>
									<FormControl>
										<Switch checked={field.value} onCheckedChange={field.onChange} />
									</FormControl>
								</FormItem>
							)}
						/>

						{/* Exclude from Calculations Toggle */}
						<FormField
							control={form.control}
							name="excludeFromCalculations"
							render={({ field }) => (
								<FormItem className="flex items-center justify-between rounded-lg border p-3">
									<div className="space-y-0.5">
										<FormLabel>
											{t(
												"settings.holidays.categories.form.excludeFromCalculations",
												"Exclude from Calculations",
											)}
										</FormLabel>
										<FormDescription>
											{t(
												"settings.holidays.categories.form.excludeFromCalculationsDescription",
												"Exclude holidays in this category from work time calculations",
											)}
										</FormDescription>
									</div>
									<FormControl>
										<Switch checked={field.value} onCheckedChange={field.onChange} />
									</FormControl>
								</FormItem>
							)}
						/>

						{/* Active Toggle */}
						<FormField
							control={form.control}
							name="isActive"
							render={({ field }) => (
								<FormItem className="flex items-center justify-between rounded-lg border p-3">
									<div className="space-y-0.5">
										<FormLabel>{t("settings.holidays.categories.form.active", "Active")}</FormLabel>
										<FormDescription>
											{t(
												"settings.holidays.categories.form.activeDescription",
												"Inactive categories cannot be assigned to new holidays",
											)}
										</FormDescription>
									</div>
									<FormControl>
										<Switch checked={field.value} onCheckedChange={field.onChange} />
									</FormControl>
								</FormItem>
							)}
						/>

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => onOpenChange(false)}
								disabled={loading}
							>
								{t("common.cancel", "Cancel")}
							</Button>
							<Button type="submit" disabled={loading}>
								{loading && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
								{isEditing ? t("common.save", "Save") : t("common.create", "Create")}
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}
