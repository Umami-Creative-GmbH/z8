import type { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	createProject,
	type ProjectStatus,
	type ProjectWithDetails,
	updateProject,
} from "@/app/[locale]/(app)/settings/projects/actions";
import { createProjectFromTemplate } from "@/app/[locale]/(app)/settings/projects/from-template-actions";
import type { useCustomFieldDrafts } from "./custom-fields/use-custom-field-drafts";
import type { useNotCopiedMessage } from "./project-template-preview";

type Translate = ReturnType<typeof useTranslate>["t"];
type CustomFieldValues = ReturnType<ReturnType<typeof useCustomFieldDrafts>["values"]>;

export interface ProjectFormValues {
	/** The template to start from; empty for a blank project. */
	templateId: string;
	name: string;
	description: string;
	status: ProjectStatus;
	color: string;
	budgetHours: string;
	deadline: string;
	customerId: string;
	/** Billable Time (#900): whether new work on the project starts as billable. */
	billableDefault: boolean;
	/** Task requirement (#884); a project from a template takes the template's. */
	requiresTask: boolean;
}

/** The form's starting values: the project's when editing, a blank planned project otherwise. */
export function projectFormDefaults(project: ProjectWithDetails | null): ProjectFormValues {
	return {
		templateId: "",
		name: project?.name || "",
		description: project?.description || "",
		status: project?.status || "planned",
		color: project?.color || "",
		budgetHours: project?.budgetHours || "",
		deadline: project?.deadline ? new Date(project.deadline).toISOString().split("T")[0] : "",
		customerId: project?.customerId || "",
		billableDefault: project?.billableDefault ?? false,
		requiresTask: project?.requiresTask ?? false,
	};
}

/** What saving the project dialog needs besides the submitted values. */
export interface ProjectSubmitContext {
	organizationId: string;
	/** The project being edited; null when creating one. */
	project: ProjectWithDetails | null;
	defaultValues: ProjectFormValues;
	billableTimeEnabled: boolean;
	customFieldValues: () => CustomFieldValues;
	skippedMembersMessage: ReturnType<typeof useNotCopiedMessage>;
	t: Translate;
	/** Called once the project (and its custom fields) are saved. */
	succeed: () => void;
}

/** The parsed values every save sends, whatever kind of save it is. */
function parsedValues(value: ProjectFormValues, billableTimeEnabled: boolean) {
	const customerId = value.customerId || undefined;
	return {
		budgetHours: value.budgetHours ? parseFloat(value.budgetHours) : undefined,
		deadline: value.deadline ? new Date(value.deadline) : undefined,
		customerId,
		// Only a project with a customer has a billable default; the module hides it otherwise.
		billableDefault: billableTimeEnabled
			? { billableDefault: customerId ? value.billableDefault : false }
			: {},
	};
}

/** Shows how a save went: the success toast (and `succeed`), or the error toast. */
function reportSave(
	result: { success: true } | { success: false; error?: string } | null,
	messages: { success: string; failure: string },
	succeed: () => void,
) {
	if (!result) {
		toast.error(messages.failure);
		return;
	}
	if (result.success) {
		toast.success(messages.success);
		succeed();
	} else {
		toast.error(result.error || messages.failure);
	}
}

async function saveEditedProject(
	project: ProjectWithDetails,
	value: ProjectFormValues,
	context: ProjectSubmitContext,
) {
	const { t } = context;
	const { budgetHours, deadline, customerId, billableDefault } = parsedValues(
		value,
		context.billableTimeEnabled,
	);
	const result = await updateProject(project.id, {
		name: value.name,
		description: value.description || undefined,
		status: value.status,
		color: value.color || undefined,
		budgetHours: budgetHours ?? null,
		deadline: deadline ?? null,
		customerId: customerId ?? null,
		...billableDefault,
		// Sent only when changed here, so a dialog opened before someone else
		// changed the requirement never undoes that change.
		...(value.requiresTask === context.defaultValues.requiresTask
			? {}
			: { requiresTask: value.requiresTask }),
		customFieldValues: context.customFieldValues(),
	}).catch(() => null);
	reportSave(
		result,
		{
			success: t("settings.projects.updated", "Project updated"),
			failure: t("settings.projects.updateFailed", "Failed to update project"),
		},
		context.succeed,
	);
}

async function createFromTemplate(value: ProjectFormValues, context: ProjectSubmitContext) {
	const { t } = context;
	const { customerId, billableDefault } = parsedValues(value, context.billableTimeEnabled);
	const result = await createProjectFromTemplate({
		templateId: value.templateId,
		name: value.name,
		description: value.description.trim() || null,
		status: value.status,
		customerId: customerId ?? null,
		...billableDefault,
		customFieldValues: context.customFieldValues(),
	}).catch(() => null);

	if (result?.success) {
		toast.success(t("settings.projects.created", "Project created"));
		if (result.data.skipped.length > 0) {
			toast.warning(context.skippedMembersMessage(result.data.skipped));
		}
		context.succeed();
	} else {
		toast.error(result?.error || t("settings.projects.createFailed", "Failed to create project"));
	}
}

async function createBlankProject(value: ProjectFormValues, context: ProjectSubmitContext) {
	const { t } = context;
	const { budgetHours, deadline, customerId, billableDefault } = parsedValues(
		value,
		context.billableTimeEnabled,
	);
	const result = await createProject({
		organizationId: context.organizationId,
		name: value.name,
		description: value.description || undefined,
		status: value.status,
		color: value.color || undefined,
		budgetHours,
		deadline,
		customerId,
		...billableDefault,
		requiresTask: value.requiresTask,
		customFieldValues: context.customFieldValues(),
	}).catch(() => null);
	reportSave(
		result,
		{
			success: t("settings.projects.created", "Project created"),
			failure: t("settings.projects.createFailed", "Failed to create project"),
		},
		context.succeed,
	);
}

/**
 * Saves the project dialog: updates the edited project, or creates one from the
 * chosen template (#880) or blank. Failures show as toasts; nothing throws.
 */
export function submitProjectForm(value: ProjectFormValues, context: ProjectSubmitContext) {
	if (context.project) return saveEditedProject(context.project, value, context);
	if (value.templateId) return createFromTemplate(value, context);
	return createBlankProject(value, context);
}
