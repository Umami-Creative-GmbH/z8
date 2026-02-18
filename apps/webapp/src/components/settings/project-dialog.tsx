"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { getCustomersForSelection } from "@/app/[locale]/(app)/settings/customers/actions";
import {
	createProject,
	type ProjectStatus,
	type ProjectWithDetails,
	updateProject,
} from "@/app/[locale]/(app)/settings/projects/actions";
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
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/lib/query";

interface ProjectDialogProps {
	organizationId: string;
	project: ProjectWithDetails | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: () => void;
}

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
	{ value: "planned", label: "Planned" },
	{ value: "active", label: "Active" },
	{ value: "paused", label: "Paused" },
	{ value: "completed", label: "Completed" },
	{ value: "archived", label: "Archived" },
];

const COLOR_OPTIONS = [
	"#ef4444", // red
	"#f97316", // orange
	"#eab308", // yellow
	"#22c55e", // green
	"#14b8a6", // teal
	"#3b82f6", // blue
	"#8b5cf6", // violet
	"#ec4899", // pink
	"#6b7280", // gray
];

const NO_CUSTOMER_VALUE = "__none__";

interface FormValues {
	name: string;
	description: string;
	status: ProjectStatus;
	color: string;
	budgetHours: string;
	deadline: string;
	customerId: string;
}

export function ProjectDialog({
	organizationId,
	project,
	open,
	onOpenChange,
	onSuccess,
}: ProjectDialogProps) {
	const { t } = useTranslate();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const isEditing = !!project;

	const { data: customersData } = useQuery({
		queryKey: queryKeys.customers.selection(organizationId),
		queryFn: async () => {
			const result = await getCustomersForSelection(organizationId);
			if (!result.success) return [];
			return result.data;
		},
		enabled: open,
	});

	const customers = customersData || [];

	const defaultValues: FormValues = {
		name: project?.name || "",
		description: project?.description || "",
		status: project?.status || "planned",
		color: project?.color || "",
		budgetHours: project?.budgetHours || "",
		deadline: project?.deadline ? new Date(project.deadline).toISOString().split("T")[0] : "",
		customerId: project?.customerId || "",
	};

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			setIsSubmitting(true);
			const budgetHours = value.budgetHours ? parseFloat(value.budgetHours) : undefined;
			const deadline = value.deadline ? new Date(value.deadline) : undefined;
			const customerId = value.customerId || undefined;

			if (isEditing && project) {
				const result = await updateProject(project.id, {
					name: value.name,
					description: value.description || undefined,
					status: value.status,
					color: value.color || undefined,
					budgetHours: budgetHours ?? null,
					deadline: deadline ?? null,
					customerId: customerId ?? null,
				}).catch(() => null);

				if (!result) {
					toast.error(t("settings.projects.updateFailed", "Failed to update project"));
					setIsSubmitting(false);
					return;
				}

				if (result.success) {
					toast.success(t("settings.projects.updated", "Project updated"));
					onSuccess();
				} else {
					toast.error(result.error || t("settings.projects.updateFailed", "Failed to update project"));
				}
				setIsSubmitting(false);
				return;
			}

			const result = await createProject({
				organizationId,
				name: value.name,
				description: value.description || undefined,
				status: value.status,
				color: value.color || undefined,
				budgetHours,
				deadline,
				customerId,
			}).catch(() => null);

			if (!result) {
				toast.error(t("settings.projects.createFailed", "Failed to create project"));
				setIsSubmitting(false);
				return;
			}

			if (result.success) {
				toast.success(t("settings.projects.created", "Project created"));
				onSuccess();
			} else {
				toast.error(result.error || t("settings.projects.createFailed", "Failed to create project"));
			}

			setIsSubmitting(false);
		},
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>
						{isEditing
							? t("settings.projects.dialog.editTitle", "Edit Project")
							: t("settings.projects.dialog.createTitle", "Create Project")}
					</DialogTitle>
					<DialogDescription>
						{isEditing
							? t("settings.projects.dialog.editDescription", "Update project details")
							: t(
									"settings.projects.dialog.createDescription",
									"Create a new project for time tracking",
								)}
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
				>
					<div className="grid gap-4 py-4">
						{/* Name */}
						<form.Field name="name">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="name">{t("settings.projects.field.name", "Name")} *</Label>
									<Input
										id="name"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t("settings.projects.field.namePlaceholder", "Enter project name")}
									/>
								</div>
							)}
						</form.Field>

						{/* Description */}
						<form.Field name="description">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="description">
										{t("settings.projects.field.description", "Description")}
									</Label>
									<Textarea
										id="description"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.projects.field.descriptionPlaceholder",
											"Optional project description",
										)}
										rows={2}
									/>
								</div>
							)}
						</form.Field>

						{/* Customer */}
						{customers.length > 0 && (
							<form.Field name="customerId">
								{(field) => (
									<div className="grid gap-2">
										<Label htmlFor="customerId">
											{t("settings.projects.field.customer", "Customer")}
										</Label>
										<Select
											value={field.state.value || NO_CUSTOMER_VALUE}
											onValueChange={(value) =>
												field.handleChange(value === NO_CUSTOMER_VALUE ? "" : value)
											}
										>
											<SelectTrigger>
												<SelectValue
													placeholder={t(
														"settings.projects.field.customerPlaceholder",
														"Select a customer",
													)}
												/>
											</SelectTrigger>
											<SelectContent>
												<SelectItem value={NO_CUSTOMER_VALUE}>
													{t("settings.projects.field.noCustomer", "No customer")}
												</SelectItem>
												{customers.map((c) => (
													<SelectItem key={c.id} value={c.id}>
														{c.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								)}
							</form.Field>
						)}

						{/* Status */}
						<form.Field name="status">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="status">{t("settings.projects.field.status", "Status")}</Label>
									<Select
										value={field.state.value}
										onValueChange={(value) => field.handleChange(value as ProjectStatus)}
									>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{STATUS_OPTIONS.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}
						</form.Field>

						{/* Color */}
						<form.Field name="color">
							{(field) => (
								<div className="grid gap-2">
									<Label>{t("settings.projects.field.color", "Color")}</Label>
									<div className="flex flex-wrap gap-2">
										{COLOR_OPTIONS.map((color) => (
											<button
												key={color}
												type="button"
												onClick={() => field.handleChange(color)}
												className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ${
													field.state.value === color
														? "border-foreground ring-2 ring-foreground ring-offset-2"
														: "border-transparent"
												}`}
												style={{ backgroundColor: color }}
											/>
										))}
										<button
											type="button"
											onClick={() => field.handleChange("")}
											className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs ${
												!field.state.value
													? "border-foreground ring-2 ring-foreground ring-offset-2"
													: "border-muted"
											}`}
										>
											-
										</button>
									</div>
								</div>
							)}
						</form.Field>

						{/* Budget Hours */}
						<form.Field name="budgetHours">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="budgetHours">
										{t("settings.projects.field.budget", "Budget (hours)")}
									</Label>
									<Input
										id="budgetHours"
										type="number"
										step="0.5"
										min="0"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t("settings.projects.field.budgetPlaceholder", "e.g., 100")}
									/>
									<p className="text-xs text-muted-foreground">
										{t("settings.projects.field.budgetHelp", "Leave empty for unlimited budget")}
									</p>
								</div>
							)}
						</form.Field>

						{/* Deadline */}
						<form.Field name="deadline">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="deadline">
										{t("settings.projects.field.deadline", "Deadline")}
									</Label>
									<Input
										id="deadline"
										type="date"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
									/>
								</div>
							)}
						</form.Field>
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={isSubmitting}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							{isEditing
								? t("settings.projects.dialog.save", "Save Changes")
								: t("settings.projects.dialog.create", "Create Project")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
