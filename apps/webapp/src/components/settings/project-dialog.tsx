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
import { DatePicker } from "@/components/ui/date-picker";
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
import { queryKeys } from "@/lib/query";
import { useBillableTimeEnabled } from "@/stores/organization-settings-store";

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
	/** Billable Time (#900): whether new work on the project starts as billable. */
	billableDefault: boolean;
}

function useProjectDialogController({
	organizationId,
	project,
	open,
	onOpenChange,
	onSuccess,
}: ProjectDialogProps) {
	const { t } = useTranslate();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const isEditing = !!project;
	const billableTimeEnabled = useBillableTimeEnabled();

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
		deadline: project?.deadline
			? new Date(project.deadline).toISOString().split("T")[0]
			: "",
		customerId: project?.customerId || "",
		billableDefault: project?.billableDefault ?? false,
	};

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			setIsSubmitting(true);
			const budgetHours = value.budgetHours
				? parseFloat(value.budgetHours)
				: undefined;
			const deadline = value.deadline ? new Date(value.deadline) : undefined;
			const customerId = value.customerId || undefined;
			// Only a project with a customer has a billable default; the module hides it otherwise.
			const billableDefault = billableTimeEnabled
				? { billableDefault: customerId ? value.billableDefault : false }
				: {};

			if (isEditing && project) {
				const result = await updateProject(project.id, {
					name: value.name,
					description: value.description || undefined,
					status: value.status,
					color: value.color || undefined,
					budgetHours: budgetHours ?? null,
					deadline: deadline ?? null,
					customerId: customerId ?? null,
					...billableDefault,
				}).catch(() => null);

				if (!result) {
					toast.error(
						t("settings.projects.updateFailed", "Failed to update project"),
					);
					setIsSubmitting(false);
					return;
				}

				if (result.success) {
					toast.success(t("settings.projects.updated", "Project updated"));
					onSuccess();
				} else {
					toast.error(
						result.error ||
							t("settings.projects.updateFailed", "Failed to update project"),
					);
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
				...billableDefault,
			}).catch(() => null);

			if (!result) {
				toast.error(
					t("settings.projects.createFailed", "Failed to create project"),
				);
				setIsSubmitting(false);
				return;
			}

			if (result.success) {
				toast.success(t("settings.projects.created", "Project created"));
				onSuccess();
			} else {
				toast.error(
					result.error ||
						t("settings.projects.createFailed", "Failed to create project"),
				);
			}

			setIsSubmitting(false);
		},
	});

	return {
		billableTimeEnabled,
		customers,
		form,
		isEditing,
		isSubmitting,
		onOpenChange,
		t,
	};
}

type ProjectDialogController = ReturnType<typeof useProjectDialogController>;

export function ProjectDialog(props: ProjectDialogProps) {
	const controller = useProjectDialogController(props);

	return (
		<ActionPanel open={props.open} onOpenChange={props.onOpenChange}>
			<ActionPanelContent>
				<ProjectDialogHeader controller={controller} />
				<ProjectDialogForm controller={controller} />
			</ActionPanelContent>
		</ActionPanel>
	);
}

function ProjectDialogHeader({
	controller,
}: {
	controller: ProjectDialogController;
}) {
	const { isEditing, t } = controller;

	return (
		<ActionPanelHeader>
			<ActionPanelTitle>
				{isEditing
					? t("settings.projects.dialog.editTitle", "Edit Project")
					: t("settings.projects.dialog.createTitle", "Create Project")}
			</ActionPanelTitle>
			<ActionPanelDescription>
				{isEditing
					? t(
							"settings.projects.dialog.editDescription",
							"Update project details",
						)
					: t(
							"settings.projects.dialog.createDescription",
							"Create a new project for time tracking",
						)}
			</ActionPanelDescription>
		</ActionPanelHeader>
	);
}

function ProjectDialogForm({ controller }: { controller: ProjectDialogController }) {
	const { billableTimeEnabled, customers, form, isEditing, isSubmitting, onOpenChange, t } =
		controller;

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
			className="flex min-h-0 flex-1 flex-col"
		>
			<ActionPanelBody className="grid gap-4">
				{/* Name */}
				<form.Field name="name">
					{(field) => (
						<div className="grid gap-2">
							<Label htmlFor="name">
								{t("settings.projects.field.name", "Name")} *
							</Label>
							<Input
								id="name"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								placeholder={t(
									"settings.projects.field.namePlaceholder",
									"Enter project name",
								)}
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

				{/* Billable default (#900): only for a project with a customer */}
				{billableTimeEnabled ? (
					<form.Subscribe selector={(state) => state.values.customerId}>
						{(customerId) => (
							<form.Field name="billableDefault">
								{(field) => (
									<div className="flex items-center justify-between gap-3 rounded-lg border p-3">
										<div className="space-y-0.5">
											<Label htmlFor="billableDefault">
												{t("settings.projects.field.billableDefault", "Billable by default")}
											</Label>
											<p className="text-sm text-muted-foreground">
												{customerId
													? t(
															"settings.projects.field.billableDefaultHelp",
															"New work on this project starts as billable. Existing work keeps its billability.",
														)
													: t(
															"settings.projects.field.billableDefaultNeedsCustomer",
															"Choose a customer to make new work billable by default.",
														)}
											</p>
										</div>
										<Switch
											id="billableDefault"
											checked={Boolean(customerId) && field.state.value}
											onCheckedChange={(checked) => field.handleChange(checked)}
											disabled={!customerId}
										/>
									</div>
								)}
							</form.Field>
						)}
					</form.Subscribe>
				) : null}

				{/* Status */}
				<form.Field name="status">
					{(field) => (
						<div className="grid gap-2">
							<Label htmlFor="status">
								{t("settings.projects.field.status", "Status")}
							</Label>
							<Select
								value={field.state.value}
								onValueChange={(value) =>
									field.handleChange(value as ProjectStatus)
								}
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
										aria-label={t(
											"settings.projects.field.colorOption",
											"Select color {color}",
											{
												color,
											},
										)}
										onClick={() => field.handleChange(color)}
										className={`size-8 rounded-full border-2 transition-transform hover:scale-110 ${
											field.state.value === color
												? "border-foreground ring-2 ring-foreground ring-offset-2"
												: "border-transparent"
										}`}
										style={{ backgroundColor: color }}
									/>
								))}
								<button
									type="button"
									aria-label={t(
										"settings.projects.field.clearColor",
										"Clear color",
									)}
									onClick={() => field.handleChange("")}
									className={`flex size-8 items-center justify-center rounded-full border-2 text-xs ${
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
								placeholder={t(
									"settings.projects.field.budgetPlaceholder",
									"e.g., 100",
								)}
							/>
							<p className="text-xs text-muted-foreground">
								{t(
									"settings.projects.field.budgetHelp",
									"Leave empty for unlimited budget",
								)}
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
							<DatePicker
								id="deadline"
								value={field.state.value}
								onChange={field.handleChange}
								onBlur={field.handleBlur}
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
					disabled={isSubmitting}
				>
					{t("common.cancel", "Cancel")}
				</Button>
				<Button type="submit" disabled={isSubmitting}>
					{isSubmitting && <IconLoader2 className="mr-2 size-4 animate-spin" />}
					{isEditing
						? t("settings.projects.dialog.save", "Save Changes")
						: t("settings.projects.dialog.create", "Create Project")}
				</Button>
			</ActionPanelFooter>
		</form>
	);
}
