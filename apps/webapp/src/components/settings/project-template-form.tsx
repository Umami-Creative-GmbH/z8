"use client";

import { IconLoader2, IconPlus, IconTrash } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	getEmployeesForSelection,
	getTeamsForSelection,
} from "@/app/[locale]/(app)/settings/projects/actions";
import {
	createProjectTemplate,
	updateProjectTemplate,
} from "@/app/[locale]/(app)/settings/projects/template-actions";
import { ActionPanelBody, ActionPanelFooter } from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import type { ServerActionResult } from "@/lib/effect/result";
import { positiveHoursText } from "@/lib/projects/project-task-model";
import {
	type ManagerOrAssignmentAvailability,
	PROJECT_TEMPLATE_BUDGET_MAX_HOURS,
	PROJECT_TEMPLATE_DESCRIPTION_MAX_LENGTH,
	PROJECT_TEMPLATE_MAX_DEADLINE_OFFSET_DAYS,
	PROJECT_TEMPLATE_NAME_MAX_LENGTH,
	type ProjectTemplate,
	type ProjectTemplateInput,
} from "@/lib/projects/project-template-model";
import { queryKeys } from "@/lib/query";
import { PROJECT_ICON_OPTIONS, type ProjectIconName } from "./project-appearance";
import { ProjectColorPicker } from "./project-color-picker";
import {
	hoursFormText,
	hoursFromFormText,
	PROJECT_TASK_ESTIMATE_INPUT,
	PROJECT_TASK_NAME_INPUT,
	useProjectTaskFieldRules,
} from "./project-task-fields";
import { TemplateIcon, useIconLabels } from "./project-template-icon";
import {
	ManagerOrAssignmentField,
	type ManagerOrAssignmentItem,
	type SelectionOption,
} from "./project-template-member-field";

/**
 * The project template form (#878): what a template holds (tasks, budget,
 * deadline offset, managers and assignments) for a new project to copy once.
 */

interface TaskFormValues {
	id: string;
	name: string;
	description: string;
	estimateHours: string;
}

interface TemplateFormValues {
	name: string;
	description: string;
	icon: string;
	color: string;
	budgetHours: string;
	deadlineOffsetDays: string;
	tasks: TaskFormValues[];
	managerEmployeeIds: string[];
	teamIds: string[];
	employeeIds: string[];
}

const EMPTY_TEMPLATE: TemplateFormValues = {
	name: "",
	description: "",
	icon: "",
	color: "",
	budgetHours: "",
	deadlineOffsetDays: "",
	tasks: [],
	managerEmployeeIds: [],
	teamIds: [],
	employeeIds: [],
};

const NO_ICON_VALUE = "__none__";

function formValuesOf(template: ProjectTemplate): TemplateFormValues {
	const present = (id: string | null): id is string => id !== null;
	return {
		name: template.name,
		description: template.description ?? "",
		icon: template.icon ?? "",
		color: template.color ?? "",
		budgetHours: hoursFormText(template.budgetHours),
		deadlineOffsetDays:
			template.deadlineOffsetDays === null ? "" : String(template.deadlineOffsetDays),
		tasks: template.tasks.map((task) => ({
			id: task.id,
			name: task.name,
			description: task.description ?? "",
			estimateHours: hoursFormText(task.estimateHours),
		})),
		managerEmployeeIds: template.managers.map((manager) => manager.employeeId).filter(present),
		teamIds: template.assignments.map((assignment) => assignment.teamId).filter(present),
		employeeIds: template.assignments
			.filter((assignment) => assignment.type === "employee")
			.map((assignment) => assignment.employeeId)
			.filter(present),
	};
}

function toInput(values: TemplateFormValues): ProjectTemplateInput {
	const days = values.deadlineOffsetDays.trim();
	return {
		name: values.name.trim(),
		description: values.description.trim() || null,
		icon: values.icon || null,
		color: values.color || null,
		budgetHours: hoursFromFormText(values.budgetHours),
		deadlineOffsetDays: days ? Number(days) : null,
		tasks: values.tasks.map((task) => ({
			name: task.name.trim(),
			description: task.description.trim() || null,
			estimateHours: hoursFromFormText(task.estimateHours),
		})),
		managerEmployeeIds: values.managerEmployeeIds,
		assignments: [
			...values.teamIds.map((targetId) => ({ type: "team" as const, targetId })),
			...values.employeeIds.map((targetId) => ({ type: "employee" as const, targetId })),
		],
	};
}

async function selectionOptions<T extends SelectionOption>(
	request: Promise<ServerActionResult<T[]>>,
): Promise<T[]> {
	const result = await request;
	if (!result.success) throw new Error(result.error);
	return result.data;
}

function useProjectTemplateForm({
	organizationId,
	template,
	onCancel,
	onSaved,
}: {
	organizationId: string;
	template: ProjectTemplate | null;
	onCancel: () => void;
	onSaved: () => void;
}) {
	const { t } = useTranslate();
	const iconLabels = useIconLabels();
	const taskRules = useProjectTaskFieldRules();
	const isEditing = template !== null;

	const { data: teams = [] } = useQuery({
		queryKey: queryKeys.projects.teamSelection(organizationId),
		queryFn: () => selectionOptions(getTeamsForSelection(organizationId)),
	});
	const { data: employees = [] } = useQuery({
		queryKey: queryKeys.projects.employeeSelection(organizationId),
		queryFn: () => selectionOptions(getEmployeesForSelection(organizationId)),
	});

	// Names and states of what the template already holds; departed employees
	// are not offered by the pickers but may stay.
	const known = new Map<string, { name: string; availability: ManagerOrAssignmentAvailability }>();
	for (const option of [...teams, ...employees]) {
		known.set(option.id, { name: option.name, availability: "available" });
	}
	const held = [
		...(template?.managers ?? []).map((manager) => ({ ...manager, id: manager.employeeId })),
		...(template?.assignments ?? []).map((assignment) => ({
			...assignment,
			id: assignment.teamId ?? assignment.employeeId,
		})),
	];
	for (const { id, ...item } of held) {
		if (id && (item.availability !== "available" || !known.has(id))) {
			known.set(id, { name: item.name, availability: item.availability });
		}
	}
	const removedManagers = (template?.managers ?? []).filter((m) => m.availability === "removed");
	const removedTeams = (template?.assignments ?? []).filter(
		(a) => a.type === "team" && a.availability === "removed",
	);
	const removedEmployees = (template?.assignments ?? []).filter(
		(a) => a.type === "employee" && a.availability === "removed",
	);

	const form = useForm({
		defaultValues: template ? formValuesOf(template) : EMPTY_TEMPLATE,
		onSubmit: async ({ value }) => {
			const input = toInput(value);
			const result = await (template
				? updateProjectTemplate(template.id, input)
				: createProjectTemplate(input)
			).catch(() => null);
			if (result?.success) {
				toast.success(
					template
						? t("settings.projects.templates.updated", "Template updated")
						: t("settings.projects.templates.created", "Template created"),
				);
				onSaved();
				return;
			}
			toast.error(
				result?.error ||
					(template
						? t("settings.projects.templates.updateFailed", "Failed to update template")
						: t("settings.projects.templates.createFailed", "Failed to create template")),
			);
		},
	});

	function items(
		ids: string[],
		removed: { id: string; name: string }[],
		onRemove: (index: number) => void,
	): ManagerOrAssignmentItem[] {
		return [
			...ids.map((id, index) => {
				const item = known.get(id);
				return {
					key: id,
					name: item?.name ?? t("settings.projects.templates.member.unknown", "Unknown"),
					availability: item?.availability ?? "available",
					onRemove: () => onRemove(index),
				};
			}),
			...removed.map((item) => ({
				key: item.id,
				name: item.name,
				availability: "removed" as const,
			})),
		];
	}

	const hasRemoved = removedManagers.length + removedTeams.length + removedEmployees.length > 0;

	return {
		template,
		t,
		form,
		iconLabels,
		taskRules,
		items,
		removedManagers,
		employees,
		removedTeams,
		teams,
		removedEmployees,
		hasRemoved,
		onCancel,
		isEditing,
	};
}

export function ProjectTemplateForm({
	organizationId,
	template,
	onCancel,
	onSaved,
}: {
	organizationId: string;
	template: ProjectTemplate | null;
	onCancel: () => void;
	onSaved: () => void;
}) {
	const {
		t,
		form,
		iconLabels,
		taskRules,
		items,
		removedManagers,
		employees,
		removedTeams,
		teams,
		removedEmployees,
		hasRemoved,
		isEditing,
	} = useProjectTemplateForm({ organizationId, template, onCancel, onSaved });
	return (
		// TanStack Form owns the submission lifecycle; see .react-doctor/false-positives.md.
		// react-doctor-disable-next-line react-doctor/no-prevent-default
		<form
			aria-label={
				template
					? t("settings.projects.templates.editLabel", "Edit {name}", { name: template.name })
					: t("settings.projects.templates.createLabel", "Create project template")
			}
			noValidate
			className="flex min-h-0 flex-1 flex-col"
			onSubmit={(event) => {
				event.preventDefault();
				form.handleSubmit();
			}}
		>
			<ActionPanelBody className="grid gap-5">
				<form.Field
					name="name"
					validators={{
						onSubmit: ({ value }) =>
							value.trim()
								? undefined
								: t("settings.projects.templates.field.nameRequired", "Enter a template name"),
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)} required>
								{t("settings.projects.templates.field.name", "Name")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<Input
									value={field.state.value}
									maxLength={PROJECT_TEMPLATE_NAME_MAX_LENGTH}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
									placeholder={t(
										"settings.projects.templates.field.namePlaceholder",
										"e.g., Website relaunch",
									)}
								/>
							</TFormControl>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>

				<form.Field name="description">
					{(field) => (
						<TFormItem>
							<TFormLabel>
								{t("settings.projects.templates.field.description", "Description")}
							</TFormLabel>
							<TFormControl>
								<Textarea
									value={field.state.value}
									maxLength={PROJECT_TEMPLATE_DESCRIPTION_MAX_LENGTH}
									rows={2}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
						</TFormItem>
					)}
				</form.Field>

				<div className="grid gap-4 sm:grid-cols-2">
					<form.Field name="icon">
						{(field) => (
							<TFormItem>
								<TFormLabel>{t("settings.projects.templates.field.icon", "Icon")}</TFormLabel>
								<div className="flex items-center gap-2">
									<span className="flex size-9 shrink-0 items-center justify-center rounded-md border">
										<TemplateIcon icon={field.state.value} className="size-4" />
									</span>
									<Select
										value={field.state.value || NO_ICON_VALUE}
										onValueChange={(value) =>
											field.handleChange(value === NO_ICON_VALUE ? "" : value)
										}
									>
										<SelectTrigger
											aria-label={t("settings.projects.templates.field.icon", "Icon")}
											className="flex-1"
										>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value={NO_ICON_VALUE}>
												{t("settings.projects.templates.field.noIcon", "No icon")}
											</SelectItem>
											{(Object.keys(PROJECT_ICON_OPTIONS) as ProjectIconName[]).map((icon) => (
												<SelectItem key={icon} value={icon}>
													{iconLabels[icon]}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</TFormItem>
						)}
					</form.Field>

					<form.Field name="color">
						{(field) => (
							<TFormItem>
								<TFormLabel>{t("settings.projects.templates.field.color", "Color")}</TFormLabel>
								<ProjectColorPicker value={field.state.value} onChange={field.handleChange} />
							</TFormItem>
						)}
					</form.Field>
				</div>

				<div className="grid gap-4 sm:grid-cols-2">
					<form.Field
						name="budgetHours"
						validators={{
							onSubmit: ({ value }) =>
								positiveHoursText(value.trim() || null, PROJECT_TEMPLATE_BUDGET_MAX_HOURS).ok
									? undefined
									: t(
											"settings.projects.templates.field.budgetInvalid",
											"Enter a positive number of hours",
										),
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.projects.templates.field.budget", "Budget (hours)")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Input
										type="number"
										inputMode="decimal"
										min="0.01"
										step="0.5"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					<form.Field
						name="deadlineOffsetDays"
						validators={{
							onSubmit: ({ value }) => {
								if (!value.trim()) return undefined;
								const days = Number(value);
								return Number.isInteger(days) &&
									days >= 0 &&
									days <= PROJECT_TEMPLATE_MAX_DEADLINE_OFFSET_DAYS
									? undefined
									: t(
											"settings.projects.templates.field.deadlineOffsetInvalid",
											"Enter whole days from 0 to {max}",
											{ max: PROJECT_TEMPLATE_MAX_DEADLINE_OFFSET_DAYS },
										);
							},
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t(
										"settings.projects.templates.field.deadlineOffset",
										"Deadline (days after creation)",
									)}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Input
										type="number"
										inputMode="numeric"
										min="0"
										max={PROJECT_TEMPLATE_MAX_DEADLINE_OFFSET_DAYS}
										step="1"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
				</div>
				<p className="-mt-3 text-xs text-muted-foreground">
					{t(
						"settings.projects.templates.field.budgetDeadlineHelp",
						"Leave empty for an unlimited budget or no deadline.",
					)}
				</p>

				<TemplateTaskFields form={form} t={t} taskRules={taskRules} />

				<form.Field name="managerEmployeeIds" mode="array">
					{(field) => (
						<ManagerOrAssignmentField
							title={t("settings.projects.templates.managers.title", "Project managers")}
							pickerLabel={t(
								"settings.projects.templates.managers.picker",
								"Project manager to add",
							)}
							placeholder={t("settings.projects.templates.selectEmployee", "Select an employee")}
							emptyText={t("settings.projects.templates.managers.empty", "No project managers")}
							items={items(field.state.value, removedManagers, field.removeValue)}
							options={employees.filter((employee) => !field.state.value.includes(employee.id))}
							onAdd={(id) => field.pushValue(id)}
						/>
					)}
				</form.Field>

				<form.Field name="teamIds" mode="array">
					{(field) => (
						<ManagerOrAssignmentField
							title={t("settings.projects.templates.teams.title", "Teams")}
							pickerLabel={t("settings.projects.templates.teams.picker", "Team to assign")}
							placeholder={t("settings.projects.templates.selectTeam", "Select a team")}
							emptyText={t("settings.projects.templates.teams.empty", "No teams assigned")}
							items={items(field.state.value, removedTeams, field.removeValue)}
							options={teams.filter((team) => !field.state.value.includes(team.id))}
							onAdd={(id) => field.pushValue(id)}
						/>
					)}
				</form.Field>

				<form.Field name="employeeIds" mode="array">
					{(field) => (
						<ManagerOrAssignmentField
							title={t("settings.projects.templates.employees.title", "Employees")}
							pickerLabel={t("settings.projects.templates.employees.picker", "Employee to assign")}
							placeholder={t("settings.projects.templates.selectEmployee", "Select an employee")}
							emptyText={t("settings.projects.templates.employees.empty", "No employees assigned")}
							items={items(field.state.value, removedEmployees, field.removeValue)}
							options={employees.filter((employee) => !field.state.value.includes(employee.id))}
							onAdd={(id) => field.pushValue(id)}
						/>
					)}
				</form.Field>

				{hasRemoved && (
					<p className="text-xs text-muted-foreground">
						{t(
							"settings.projects.templates.member.removedHelp",
							"Teams and employees that no longer exist are dropped when you save.",
						)}
					</p>
				)}
			</ActionPanelBody>

			<ActionPanelFooter>
				<form.Subscribe selector={(state) => state.isSubmitting}>
					{(isSubmitting) => (
						<>
							<Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
								{t("common.cancel", "Cancel")}
							</Button>
							<Button type="submit" disabled={isSubmitting}>
								{isSubmitting && <IconLoader2 className="size-4 animate-spin" aria-hidden="true" />}
								{isEditing
									? t("settings.projects.templates.save", "Save changes")
									: t("settings.projects.templates.create", "Create template")}
							</Button>
						</>
					)}
				</form.Subscribe>
			</ActionPanelFooter>
		</form>
	);
}

function TemplateTaskFields({
	form,
	t,
	taskRules,
}: Pick<ReturnType<typeof useProjectTemplateForm>, "form" | "t" | "taskRules">) {
	return (
		<form.Field name="tasks" mode="array">
			{(tasksField) => (
				<section className="space-y-2">
					<h4 className="text-sm font-medium">
						{t("settings.projects.templates.tasks.title", "Tasks")}
					</h4>
					{tasksField.state.value.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.projects.templates.tasks.empty",
								"No tasks. Projects created from this template start with these tasks.",
							)}
						</p>
					) : (
						<ol className="space-y-3">
							{tasksField.state.value.map((task, index) => {
								const position = index + 1;
								return (
									<li key={task.id} className="grid gap-2 rounded-md border p-3">
										<div className="flex items-start gap-2">
											<form.Field
												name={`tasks[${index}].name`}
												validators={{ onSubmit: taskRules.name }}
											>
												{(field) => (
													<div className="grid flex-1 gap-1">
														<Input
															{...PROJECT_TASK_NAME_INPUT}
															aria-label={t(
																"settings.projects.templates.tasks.name",
																"Task {position} name",
																{ position },
															)}
															aria-invalid={fieldHasError(field)}
															placeholder={t(
																"settings.projects.templates.tasks.namePlaceholder",
																"Task name",
															)}
															value={field.state.value}
															onChange={(event) => field.handleChange(event.target.value)}
															onBlur={field.handleBlur}
														/>
														<TFormMessage field={field} />
													</div>
												)}
											</form.Field>
											<form.Field
												name={`tasks[${index}].estimateHours`}
												validators={{ onSubmit: taskRules.estimate }}
											>
												{(field) => (
													<div className="grid w-28 gap-1">
														<Input
															{...PROJECT_TASK_ESTIMATE_INPUT}
															aria-label={t(
																"settings.projects.templates.tasks.estimate",
																"Task {position} estimate (hours)",
																{ position },
															)}
															aria-invalid={fieldHasError(field)}
															placeholder={t(
																"settings.projects.templates.tasks.estimatePlaceholder",
																"Hours",
															)}
															value={field.state.value}
															onChange={(event) => field.handleChange(event.target.value)}
															onBlur={field.handleBlur}
														/>
														<TFormMessage field={field} />
													</div>
												)}
											</form.Field>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="size-9 shrink-0"
												aria-label={t(
													"settings.projects.templates.tasks.remove",
													"Remove task {position}",
													{ position },
												)}
												onClick={() => tasksField.removeValue(index)}
											>
												<IconTrash className="size-4" aria-hidden="true" />
											</Button>
										</div>
										<form.Field name={`tasks[${index}].description`}>
											{(field) => (
												<Textarea
													rows={1}
													aria-label={t(
														"settings.projects.templates.tasks.description",
														"Task {position} description",
														{ position },
													)}
													placeholder={t(
														"settings.projects.templates.tasks.descriptionPlaceholder",
														"Description (optional)",
													)}
													value={field.state.value}
													onChange={(event) => field.handleChange(event.target.value)}
													onBlur={field.handleBlur}
												/>
											)}
										</form.Field>
									</li>
								);
							})}
						</ol>
					)}
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() =>
							tasksField.pushValue({
								id: crypto.randomUUID(),
								name: "",
								description: "",
								estimateHours: "",
							})
						}
					>
						<IconPlus className="size-4" aria-hidden="true" />
						{t("settings.projects.templates.tasks.add", "Add task")}
					</Button>
				</section>
			)}
		</form.Field>
	);
}
