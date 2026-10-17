"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { getCustomersForSelection } from "@/app/[locale]/(app)/settings/customers/actions";
import type {
	ProjectStatus,
	ProjectWithDetails,
} from "@/app/[locale]/(app)/settings/projects/actions";
import {
	getProjectTemplateChoices,
	getProjectTemplatePreview,
} from "@/app/[locale]/(app)/settings/projects/from-template-actions";
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
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/lib/query";
import { useBillableTimeEnabled } from "@/stores/organization-settings-store";
import { CustomFieldDraftsSection } from "./custom-fields/custom-field-values-section";
import { useCustomFieldDrafts } from "./custom-fields/use-custom-field-drafts";
import {
	ProjectBillableDefaultField,
	ProjectCustomerField,
	ProjectPlanningFields,
	ProjectRequiresTaskField,
	ProjectTemplateChoiceField,
} from "./project-dialog-fields";
import { projectFormDefaults, submitProjectForm } from "./project-dialog-submit";
import {
	ProjectTemplatePreview,
	useNotCopiedMessage,
} from "./project-template-preview";

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
	// The "Custom fields" section (#818); saved with the project.
	const customFields = useCustomFieldDrafts({
		entity: "project",
		recordId: project?.id ?? null,
		enabled: open,
		onOpenChange,
		onSaved: onSuccess,
	});
	const succeed = customFields.handleSaved;

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
	const skippedMembersMessage = useNotCopiedMessage();

	// Anyone who may create projects may start one from a template (#880).
	const { data: templateChoices = [] } = useQuery({
		queryKey: queryKeys.projects.templateChoices(organizationId),
		queryFn: async () => {
			const result = await getProjectTemplateChoices();
			return result.success ? result.data : [];
		},
		enabled: open && !isEditing,
	});

	const defaultValues = projectFormDefaults(project);

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			setIsSubmitting(true);
			// Promise#finally rather than try/finally: the React Compiler cannot
			// compile try statements without a catch clause.
			await submitProjectForm(value, {
				organizationId,
				project,
				defaultValues,
				billableTimeEnabled,
				customFieldValues: customFields.values,
				skippedMembersMessage,
				t,
				succeed,
			}).finally(() => setIsSubmitting(false));
		},
	});

	const templateId = useStore(form.store, (state) => state.values.templateId);
	const { data: templatePreview = null } = useQuery({
		queryKey: queryKeys.projects.templatePreview(templateId),
		queryFn: async () => {
			const result = await getProjectTemplatePreview(templateId);
			return result.success ? result.data : null;
		},
		enabled: open && !isEditing && templateId !== "",
	});

	return {
		billableTimeEnabled,
		customers,
		customFields,
		// The deleted customer is never a choice; the project starts without customer (#938).
		deletedCustomerName: project?.deletedCustomerName ?? null,
		form,
		isEditing,
		isSubmitting,
		// Closing the dialog drops unsaved custom field drafts.
		onOpenChange: customFields.handleOpenChange,
		t,
		templateChoices,
		templateId,
		templatePreview,
	};
}

export type ProjectDialogController = ReturnType<typeof useProjectDialogController>;

export function ProjectDialog(props: ProjectDialogProps) {
	const controller = useProjectDialogController(props);

	return (
		<ActionPanel open={props.open} onOpenChange={controller.onOpenChange}>
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

function ProjectDialogForm({
	controller,
}: {
	controller: ProjectDialogController;
}) {
	const {
		billableTimeEnabled,
		customers,
		customFields,
		deletedCustomerName,
		form,
		isEditing,
		isSubmitting,
		onOpenChange,
		t,
		templateChoices,
		templateId,
		templatePreview,
	} = controller;
	const fromTemplate = !isEditing && templateId !== "";

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
			className="flex min-h-0 flex-1 flex-col"
		>
			<ActionPanelBody className="grid gap-4">
				{/* Start from a template (#880) */}
				{!isEditing && templateChoices.length > 0 && (
					<ProjectTemplateChoiceField controller={controller} />
				)}

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
				{(customers.length > 0 || deletedCustomerName) && (
					<ProjectCustomerField controller={controller} />
				)}

				{/* Billable default (#900): only for a project with a customer */}
				{billableTimeEnabled ? (
					<ProjectBillableDefaultField controller={controller} />
				) : null}

				{/* Task requirement (#884); a project from a template takes the template's. */}
				{!fromTemplate && (
					<ProjectRequiresTaskField controller={controller} />
				)}

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
								<SelectTrigger id="status">
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

				{fromTemplate && templatePreview && (
					<ProjectTemplatePreview template={templatePreview} />
				)}

				{/* Colour, budget and deadline come from the template when there is one. */}
				{!fromTemplate && (
					<ProjectPlanningFields controller={controller} />
				)}

				<CustomFieldDraftsSection drafts={customFields} disabled={isSubmitting} />
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
