"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
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

interface HolidayDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	editingHoliday?: any;
	onSuccess: () => void;
}

type RecurrenceType = "none" | "yearly" | "custom";

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

	const form = useForm({
		defaultValues: {
			name: "",
			description: "",
			categoryId: "",
			startDate: new Date(),
			endDate: new Date(),
			recurrenceType: "none" as RecurrenceType,
			recurrenceRule: undefined as string | undefined,
			recurrenceEndDate: null as Date | null,
			isActive: true,
		},
		onSubmit: async ({ value }) => {
			setLoading(true);

			// Generate recurrence rule for yearly holidays
			let recurrenceRule = value.recurrenceRule;
			if (value.recurrenceType === "yearly" && !recurrenceRule) {
				const month = value.startDate.getMonth() + 1; // 1-12
				const day = value.startDate.getDate();
				recurrenceRule = JSON.stringify({ month, day });
			}

			const payload = {
				...value,
				recurrenceRule,
				// Convert dates to ISO strings for API
				startDate: value.startDate.toISOString(),
				endDate: value.endDate.toISOString(),
				recurrenceEndDate: value.recurrenceEndDate?.toISOString() || null,
			};

			const endpoint = isEditing ? `/api/admin/holidays/${editingHoliday.id}` : "/api/admin/holidays";
			const method = isEditing ? "PATCH" : "POST";

			const response = await fetch(endpoint, {
				method,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			}).catch(() => null);

			if (!response) {
				toast.error(t("settings.holidays.saveFailed", "Failed to save holiday"));
				setLoading(false);
				return;
			}

			if (!response.ok) {
				const error = await response.json().catch(() => null);
				toast.error(error?.error || t("settings.holidays.saveFailed", "Failed to save holiday"));
				setLoading(false);
				return;
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
			setLoading(false);
		},
	});

	// Reset form when editingHoliday changes or dialog opens
	useEffect(() => {
		if (open) {
			if (editingHoliday) {
				form.reset();
				form.setFieldValue("name", editingHoliday.name);
				form.setFieldValue("description", editingHoliday.description || "");
				form.setFieldValue("categoryId", editingHoliday.categoryId);
				form.setFieldValue("startDate", new Date(editingHoliday.startDate));
				form.setFieldValue("endDate", new Date(editingHoliday.endDate));
				form.setFieldValue("recurrenceType", editingHoliday.recurrenceType || "none");
				form.setFieldValue("recurrenceRule", editingHoliday.recurrenceRule || undefined);
				form.setFieldValue(
					"recurrenceEndDate",
					editingHoliday.recurrenceEndDate ? new Date(editingHoliday.recurrenceEndDate) : null,
				);
				form.setFieldValue("isActive", editingHoliday.isActive);
			} else {
				form.reset();
			}
		}
	}, [open, editingHoliday, form]);

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

				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className="space-y-4"
				>
					{/* Name */}
					<form.Field
						name="name"
						validators={{
							onChange: ({ value }) => {
								if (!value) return "Name is required";
								if (value.length > 255) return "Name is too long";
								return undefined;
							},
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label>{t("settings.holidays.form.name", "Name")}</Label>
								<Input
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									placeholder={t("settings.holidays.form.namePlaceholder", "e.g., Christmas Day")}
								/>
								{field.state.meta.errors.length > 0 && (
									<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
								)}
							</div>
						)}
					</form.Field>

					{/* Description */}
					<form.Field name="description">
						{(field) => (
							<div className="space-y-2">
								<Label>
									{t("settings.holidays.form.description", "Description")} (
									{t("settings.holidays.form.optional", "optional")})
								</Label>
								<Textarea
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									placeholder={t(
										"settings.holidays.form.descriptionPlaceholder",
										"Add a description...",
									)}
									rows={3}
								/>
							</div>
						)}
					</form.Field>

					{/* Category */}
					<form.Field
						name="categoryId"
						validators={{
							onChange: ({ value }) => {
								if (!value) return "Category is required";
								return undefined;
							},
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label>{t("settings.holidays.form.category", "Category")}</Label>
								<Select
									value={field.state.value}
									onValueChange={field.handleChange}
									disabled={categoriesLoading}
								>
									<SelectTrigger>
										<SelectValue
											placeholder={t(
												"settings.holidays.form.categoryPlaceholder",
												"Select a category",
											)}
										/>
									</SelectTrigger>
									<SelectContent>
										{categories.map((category) => (
											<SelectItem key={category.id} value={category.id}>
												{category.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								{field.state.meta.errors.length > 0 && (
									<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
								)}
							</div>
						)}
					</form.Field>

					{/* Date Range */}
					<div className="grid grid-cols-2 gap-4">
						<form.Field
							name="startDate"
							validators={{
								onChange: ({ value }) => {
									if (!value) return "Start date is required";
									return undefined;
								},
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label>{t("settings.holidays.form.startDate", "Start Date")}</Label>
									<Input
										type="date"
										value={field.state.value?.toISOString().split("T")[0] || ""}
										onChange={(e) => field.handleChange(new Date(e.target.value))}
									/>
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
									)}
								</div>
							)}
						</form.Field>
						<form.Field
							name="endDate"
							validators={{
								onChange: ({ value, fieldApi }) => {
									if (!value) return "End date is required";
									const startDate = fieldApi.form.getFieldValue("startDate");
									if (startDate && value < startDate) {
										return "End date must be after or equal to start date";
									}
									return undefined;
								},
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label>{t("settings.holidays.form.endDate", "End Date")}</Label>
									<Input
										type="date"
										value={field.state.value?.toISOString().split("T")[0] || ""}
										onChange={(e) => field.handleChange(new Date(e.target.value))}
									/>
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
									)}
								</div>
							)}
						</form.Field>
					</div>

					{/* Recurrence */}
					<form.Field name="recurrenceType">
						{(field) => (
							<div className="space-y-2">
								<Label>{t("settings.holidays.form.recurrence.title", "Recurrence")}</Label>
								<Select
									value={field.state.value}
									onValueChange={(value) => field.handleChange(value as RecurrenceType)}
								>
									<SelectTrigger>
										<SelectValue
											placeholder={t(
												"settings.holidays.form.recurrence.placeholder",
												"Select recurrence type",
											)}
										/>
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="none">
											{t("settings.holidays.form.recurrence.none", "One-time")}
										</SelectItem>
										<SelectItem value="yearly">
											{t("settings.holidays.form.recurrence.yearly", "Yearly")}
										</SelectItem>
									</SelectContent>
								</Select>
								{field.state.value === "yearly" && (
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.holidays.form.recurrence.yearlyDesc",
											"This holiday will repeat every year on the same date",
										)}
									</p>
								)}
							</div>
						)}
					</form.Field>

					{/* Active Toggle */}
					<form.Field name="isActive">
						{(field) => (
							<div className="flex items-center justify-between rounded-lg border p-3">
								<div className="space-y-0.5">
									<Label>{t("settings.holidays.form.active", "Active")}</Label>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.holidays.form.activeDescription",
											"Inactive holidays won't appear in the calendar",
										)}
									</p>
								</div>
								<Switch checked={field.state.value} onCheckedChange={field.handleChange} />
							</div>
						)}
					</form.Field>

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
			</DialogContent>
		</Dialog>
	);
}
