"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { getHolidayCategories } from "@/app/[locale]/(app)/settings/holidays/actions";
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
import { type HolidayFormValues, holidayFormSchema } from "@/lib/holidays/validation";

interface HolidayDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	editingHoliday?: any;
	onSuccess: () => void;
}

export function HolidayDialog({
	open,
	onOpenChange,
	organizationId,
	editingHoliday,
	onSuccess,
}: HolidayDialogProps) {
	const { t } = useTranslate();
	const [loading, setLoading] = useState(false);
	const [categories, setCategories] = useState<any[]>([]);
	const [categoriesLoading, setCategoriesLoading] = useState(true);
	const isEditing = !!editingHoliday;

	const form = useForm<HolidayFormValues>({
		resolver: zodResolver(holidayFormSchema),
		defaultValues: editingHoliday
			? {
					name: editingHoliday.name,
					description: editingHoliday.description || "",
					categoryId: editingHoliday.categoryId,
					startDate: new Date(editingHoliday.startDate),
					endDate: new Date(editingHoliday.endDate),
					recurrenceType: editingHoliday.recurrenceType || "none",
					recurrenceRule: editingHoliday.recurrenceRule || undefined,
					recurrenceEndDate: editingHoliday.recurrenceEndDate
						? new Date(editingHoliday.recurrenceEndDate)
						: null,
					isActive: editingHoliday.isActive,
				}
			: {
					name: "",
					description: "",
					categoryId: "",
					startDate: new Date(),
					endDate: new Date(),
					recurrenceType: "none",
					recurrenceRule: undefined,
					recurrenceEndDate: null,
					isActive: true,
				},
	});

	// Fetch categories on mount
	useEffect(() => {
		async function fetchCategories() {
			setCategoriesLoading(true);
			const result = await getHolidayCategories(organizationId);
			if (result.success && result.data) {
				setCategories(result.data);
			} else {
				toast.error(t("settings.holidays.categories.loadFailed", "Failed to load categories"));
			}
			setCategoriesLoading(false);
		}
		if (open) {
			fetchCategories();
		}
	}, [open, organizationId, t]);

	async function onSubmit(values: HolidayFormValues) {
		setLoading(true);

		try {
			// Generate recurrence rule for yearly holidays
			let recurrenceRule = values.recurrenceRule;
			if (values.recurrenceType === "yearly" && !recurrenceRule) {
				const month = values.startDate.getMonth() + 1; // 1-12
				const day = values.startDate.getDate();
				recurrenceRule = JSON.stringify({ month, day });
			}

			const payload = {
				...values,
				recurrenceRule,
				// Convert dates to ISO strings for API
				startDate: values.startDate.toISOString(),
				endDate: values.endDate.toISOString(),
				recurrenceEndDate: values.recurrenceEndDate?.toISOString() || null,
			};

			const endpoint = isEditing
				? `/api/admin/holidays/${editingHoliday.id}`
				: "/api/admin/holidays";
			const method = isEditing ? "PATCH" : "POST";

			const response = await fetch(endpoint, {
				method,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.error || "Failed to save holiday");
			}

			toast.success(
				t(
					isEditing ? "settings.holidays.updated" : "settings.holidays.created",
					isEditing ? "Holiday updated successfully" : "Holiday created successfully",
				),
			);

			onSuccess();
			onOpenChange(false);
			form.reset();
		} catch (error: any) {
			toast.error(error.message || t("settings.holidays.saveFailed", "Failed to save holiday"));
		} finally {
			setLoading(false);
		}
	}

	const recurrenceType = form.watch("recurrenceType");

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{isEditing
							? t("settings.holidays.edit", "Edit Holiday")
							: t("settings.holidays.add", "Add Holiday")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"settings.holidays.form.description",
							"Create or update a holiday for your organization",
						)}
					</DialogDescription>
				</DialogHeader>

				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
						{/* Name */}
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>{t("settings.holidays.form.name", "Name")}</FormLabel>
									<FormControl>
										<Input
											{...field}
											placeholder={t(
												"settings.holidays.form.namePlaceholder",
												"e.g., Christmas Day",
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
										{t("settings.holidays.form.description", "Description")} (
										{t("settings.holidays.form.optional", "optional")})
									</FormLabel>
									<FormControl>
										<Textarea
											{...field}
											placeholder={t(
												"settings.holidays.form.descriptionPlaceholder",
												"Add a description...",
											)}
											rows={3}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						{/* Category */}
						<FormField
							control={form.control}
							name="categoryId"
							render={({ field }) => (
								<FormItem>
									<FormLabel>{t("settings.holidays.form.category", "Category")}</FormLabel>
									<Select
										onValueChange={field.onChange}
										defaultValue={field.value}
										disabled={categoriesLoading}
									>
										<FormControl>
											<SelectTrigger>
												<SelectValue
													placeholder={t(
														"settings.holidays.form.categoryPlaceholder",
														"Select a category",
													)}
												/>
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											{categories.map((category) => (
												<SelectItem key={category.id} value={category.id}>
													{category.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<FormMessage />
								</FormItem>
							)}
						/>

						{/* Date Range */}
						<div className="grid grid-cols-2 gap-4">
							<FormField
								control={form.control}
								name="startDate"
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("settings.holidays.form.startDate", "Start Date")}</FormLabel>
										<FormControl>
											<Input
												type="date"
												value={field.value?.toISOString().split("T")[0] || ""}
												onChange={(e) => field.onChange(new Date(e.target.value))}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="endDate"
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("settings.holidays.form.endDate", "End Date")}</FormLabel>
										<FormControl>
											<Input
												type="date"
												value={field.value?.toISOString().split("T")[0] || ""}
												onChange={(e) => field.onChange(new Date(e.target.value))}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>

						{/* Recurrence */}
						<FormField
							control={form.control}
							name="recurrenceType"
							render={({ field }) => (
								<FormItem>
									<FormLabel>{t("settings.holidays.form.recurrence", "Recurrence")}</FormLabel>
									<Select onValueChange={field.onChange} defaultValue={field.value}>
										<FormControl>
											<SelectTrigger>
												<SelectValue
													placeholder={t(
														"settings.holidays.form.recurrencePlaceholder",
														"Select recurrence type",
													)}
												/>
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											<SelectItem value="none">
												{t("settings.holidays.form.recurrence.none", "One-time")}
											</SelectItem>
											<SelectItem value="yearly">
												{t("settings.holidays.form.recurrence.yearly", "Yearly")}
											</SelectItem>
										</SelectContent>
									</Select>
									<FormDescription>
										{recurrenceType === "yearly" &&
											t(
												"settings.holidays.form.recurrence.yearlyDesc",
												"This holiday will repeat every year on the same date",
											)}
									</FormDescription>
									<FormMessage />
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
										<FormLabel>{t("settings.holidays.form.active", "Active")}</FormLabel>
										<FormDescription>
											{t(
												"settings.holidays.form.activeDescription",
												"Inactive holidays won't appear in the calendar",
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
