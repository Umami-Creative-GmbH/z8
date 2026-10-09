"use client";

import {
	IconEdit,
	IconLoader2,
	IconPlus,
	IconRefresh,
	IconTemplate,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
	getEmployeesForSelection,
	getTeamsForSelection,
} from "@/app/[locale]/(app)/settings/projects/actions";
import {
	createProjectTemplate,
	deleteProjectTemplate,
	getProjectTemplateDetails,
	getProjectTemplates,
	updateProjectTemplate,
} from "@/app/[locale]/(app)/settings/projects/template-actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import type { ServerActionResult } from "@/lib/effect/result";
import { normalizeProjectTaskEstimate } from "@/lib/projects/project-task-model";
import {
	PROJECT_TEMPLATE_DESCRIPTION_MAX_LENGTH,
	PROJECT_TEMPLATE_MAX_DEADLINE_OFFSET_DAYS,
	PROJECT_TEMPLATE_NAME_MAX_LENGTH,
	type ProjectTemplate,
	type ProjectTemplateInput,
	type ProjectTemplateMemberAvailability,
	type ProjectTemplateSummary,
} from "@/lib/projects/project-template-model";
import { queryKeys } from "@/lib/query";
import {
	isProjectIconName,
	PROJECT_COLOR_OPTIONS,
	PROJECT_ICON_OPTIONS,
	type ProjectIconName,
} from "./project-appearance";

/**
 * The project templates section of the project settings (#878), shown to org
 * owners and admins only. A template is a blueprint, never a project: it holds
 * tasks, a budget, a deadline offset, managers and assignments that a new
 * project copies once.
 */

interface SelectionOption {
	id: string;
	name: string;
}

interface TaskFormValues {
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

function hoursText(value: string | null) {
	return value ? String(Number(value)) : "";
}

function formValuesOf(template: ProjectTemplate): TemplateFormValues {
	const present = (id: string | null): id is string => id !== null;
	return {
		name: template.name,
		description: template.description ?? "",
		icon: template.icon ?? "",
		color: template.color ?? "",
		budgetHours: hoursText(template.budgetHours),
		deadlineOffsetDays:
			template.deadlineOffsetDays === null ? "" : String(template.deadlineOffsetDays),
		tasks: template.tasks.map((task) => ({
			name: task.name,
			description: task.description ?? "",
			estimateHours: hoursText(task.estimateHours),
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
	const optionalNumber = (value: string) => (value.trim() ? Number(value) : null);
	return {
		name: values.name.trim(),
		description: values.description.trim() || null,
		icon: values.icon || null,
		color: values.color || null,
		budgetHours: optionalNumber(values.budgetHours),
		deadlineOffsetDays: optionalNumber(values.deadlineOffsetDays),
		tasks: values.tasks.map((task) => ({
			name: task.name.trim(),
			description: task.description.trim() || null,
			estimateHours: optionalNumber(task.estimateHours),
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

function useIconLabels(): Record<ProjectIconName, string> {
	const { t } = useTranslate();
	return {
		IconBriefcase: t("settings.projects.templates.icons.briefcase", "Briefcase"),
		IconBulb: t("settings.projects.templates.icons.bulb", "Light bulb"),
		IconChartBar: t("settings.projects.templates.icons.chartBar", "Bar chart"),
		IconCloud: t("settings.projects.templates.icons.cloud", "Cloud"),
		IconCode: t("settings.projects.templates.icons.code", "Code"),
		IconDatabase: t("settings.projects.templates.icons.database", "Database"),
		IconDevices: t("settings.projects.templates.icons.devices", "Devices"),
		IconPalette: t("settings.projects.templates.icons.palette", "Palette"),
		IconRocket: t("settings.projects.templates.icons.rocket", "Rocket"),
		IconSettings: t("settings.projects.templates.icons.settings", "Settings"),
		IconShoppingCart: t("settings.projects.templates.icons.shoppingCart", "Shopping cart"),
		IconUsers: t("settings.projects.templates.icons.users", "People"),
	};
}

function TemplateIcon({ icon, className }: { icon: string | null; className?: string }) {
	if (!isProjectIconName(icon)) return null;
	const Icon = PROJECT_ICON_OPTIONS[icon];
	return <Icon className={className} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Members (managers, teams, employees) inside the template form
// ---------------------------------------------------------------------------

interface MemberListItem {
	key: string;
	name: string;
	availability: ProjectTemplateMemberAvailability;
	/** Omitted for removed teams and employees, which are dropped on save anyway. */
	onRemove?: () => void;
}

function MemberField({
	title,
	pickerLabel,
	placeholder,
	emptyText,
	items,
	options,
	onAdd,
}: {
	title: string;
	pickerLabel: string;
	placeholder: string;
	emptyText: string;
	items: MemberListItem[];
	options: SelectionOption[];
	onAdd: (id: string) => void;
}) {
	const { t } = useTranslate();
	const headingId = useId();

	return (
		<section aria-labelledby={headingId} className="space-y-2">
			<h4 id={headingId} className="text-sm font-medium">
				{title}
			</h4>
			{items.length === 0 ? (
				<p className="text-sm text-muted-foreground">{emptyText}</p>
			) : (
				<ul className="divide-y rounded-md border">
					{items.map((item) => (
						<li
							key={item.key}
							aria-label={item.name}
							className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm"
						>
							<span className="flex min-w-0 flex-wrap items-center gap-2">
								<span className={item.availability === "available" ? "" : "text-muted-foreground"}>
									{item.name}
								</span>
								{item.availability === "departed" && (
									<Badge variant="secondary">
										{t("settings.projects.templates.member.departed", "Left the organization")}
									</Badge>
								)}
								{item.availability === "removed" && (
									<Badge variant="outline">
										{t("settings.projects.templates.member.removed", "No longer exists")}
									</Badge>
								)}
							</span>
							{item.onRemove && (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="size-8"
									aria-label={t("settings.projects.templates.member.remove", "Remove {name}", {
										name: item.name,
									})}
									onClick={item.onRemove}
								>
									<IconX className="size-4" aria-hidden="true" />
								</Button>
							)}
						</li>
					))}
				</ul>
			)}
			<Select
				value=""
				onValueChange={(value) => {
					if (value) onAdd(value);
				}}
			>
				<SelectTrigger aria-label={pickerLabel}>
					<SelectValue placeholder={placeholder} />
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem key={option.id} value={option.id}>
							{option.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</section>
	);
}

// ---------------------------------------------------------------------------
// Template form
// ---------------------------------------------------------------------------

function TemplateForm({
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
	const known = new Map<
		string,
		{ name: string; availability: ProjectTemplateMemberAvailability }
	>();
	for (const option of [...teams, ...employees]) {
		known.set(option.id, { name: option.name, availability: "available" });
	}
	const heldMembers = [
		...(template?.managers ?? []).map((manager) => ({ ...manager, id: manager.employeeId })),
		...(template?.assignments ?? []).map((assignment) => ({
			...assignment,
			id: assignment.teamId ?? assignment.employeeId,
		})),
	];
	for (const { id, ...member } of heldMembers) {
		if (id && (member.availability !== "available" || !known.has(id))) {
			known.set(id, { name: member.name, availability: member.availability });
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

	function memberItems(
		ids: string[],
		removed: { id: string; name: string }[],
		onRemove: (index: number) => void,
	): MemberListItem[] {
		return [
			...ids.map((id, index) => {
				const member = known.get(id);
				return {
					key: id,
					name: member?.name ?? t("settings.projects.templates.member.unknown", "Unknown"),
					availability: member?.availability ?? "available",
					onRemove: () => onRemove(index),
				};
			}),
			...removed.map((member) => ({
				key: member.id,
				name: member.name,
				availability: "removed" as const,
			})),
		];
	}

	const hasRemoved = removedManagers.length + removedTeams.length + removedEmployees.length > 0;

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
								<TFormLabel>{t("settings.projects.templates.field.color", "Colour")}</TFormLabel>
								<div className="flex flex-wrap gap-2">
									{PROJECT_COLOR_OPTIONS.map((color) => (
										<button
											key={color}
											type="button"
											aria-label={t("settings.projects.field.colorOption", "Select color {color}", {
												color,
											})}
											aria-pressed={field.state.value === color}
											onClick={() => field.handleChange(color)}
											className={`size-7 rounded-full border-2 transition-transform hover:scale-110 ${
												field.state.value === color
													? "border-foreground ring-2 ring-foreground ring-offset-2"
													: "border-transparent"
											}`}
											style={{ backgroundColor: color }}
										/>
									))}
									<button
										type="button"
										aria-label={t("settings.projects.field.clearColor", "Clear color")}
										aria-pressed={!field.state.value}
										onClick={() => field.handleChange("")}
										className={`flex size-7 items-center justify-center rounded-full border-2 text-xs ${
											!field.state.value
												? "border-foreground ring-2 ring-foreground ring-offset-2"
												: "border-muted"
										}`}
									>
										-
									</button>
								</div>
							</TFormItem>
						)}
					</form.Field>
				</div>

				<div className="grid gap-4 sm:grid-cols-2">
					<form.Field
						name="budgetHours"
						validators={{
							onSubmit: ({ value }) =>
								!value.trim() || normalizeProjectTaskEstimate(Number(value)).ok
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
									{tasksField.state.value.map((_, index) => {
										const position = index + 1;
										return (
											// biome-ignore lint/suspicious/noArrayIndexKey: TanStack Form array rows are addressed by index.
											<li key={index} className="grid gap-2 rounded-md border p-3">
												<div className="flex items-start gap-2">
													<form.Field
														name={`tasks[${index}].name`}
														validators={{
															onSubmit: ({ value }) =>
																value.trim()
																	? undefined
																	: t(
																			"settings.projects.templates.tasks.nameRequired",
																			"Enter a task name",
																		),
														}}
													>
														{(field) => (
															<div className="grid flex-1 gap-1">
																<Input
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
														validators={{
															onSubmit: ({ value }) =>
																!value.trim() || normalizeProjectTaskEstimate(Number(value)).ok
																	? undefined
																	: t(
																			"settings.projects.templates.tasks.estimateInvalid",
																			"Enter a positive number of hours",
																		),
														}}
													>
														{(field) => (
															<div className="grid w-28 gap-1">
																<Input
																	type="number"
																	inputMode="decimal"
																	min="0.01"
																	step="0.25"
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
									tasksField.pushValue({ name: "", description: "", estimateHours: "" })
								}
							>
								<IconPlus className="size-4" aria-hidden="true" />
								{t("settings.projects.templates.tasks.add", "Add task")}
							</Button>
						</section>
					)}
				</form.Field>

				<form.Field name="managerEmployeeIds" mode="array">
					{(field) => (
						<MemberField
							title={t("settings.projects.templates.managers.title", "Project managers")}
							pickerLabel={t(
								"settings.projects.templates.managers.picker",
								"Project manager to add",
							)}
							placeholder={t("settings.projects.templates.selectEmployee", "Select an employee")}
							emptyText={t("settings.projects.templates.managers.empty", "No project managers")}
							items={memberItems(field.state.value, removedManagers, field.removeValue)}
							options={employees.filter((employee) => !field.state.value.includes(employee.id))}
							onAdd={(id) => field.pushValue(id)}
						/>
					)}
				</form.Field>

				<form.Field name="teamIds" mode="array">
					{(field) => (
						<MemberField
							title={t("settings.projects.templates.teams.title", "Teams")}
							pickerLabel={t("settings.projects.templates.teams.picker", "Team to assign")}
							placeholder={t("settings.projects.templates.selectTeam", "Select a team")}
							emptyText={t("settings.projects.templates.teams.empty", "No teams assigned")}
							items={memberItems(field.state.value, removedTeams, field.removeValue)}
							options={teams.filter((team) => !field.state.value.includes(team.id))}
							onAdd={(id) => field.pushValue(id)}
						/>
					)}
				</form.Field>

				<form.Field name="employeeIds" mode="array">
					{(field) => (
						<MemberField
							title={t("settings.projects.templates.employees.title", "Employees")}
							pickerLabel={t("settings.projects.templates.employees.picker", "Employee to assign")}
							placeholder={t("settings.projects.templates.selectEmployee", "Select an employee")}
							emptyText={t("settings.projects.templates.employees.empty", "No employees assigned")}
							items={memberItems(field.state.value, removedEmployees, field.removeValue)}
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

function ProjectTemplateDialog({
	organizationId,
	templateId,
	open,
	onOpenChange,
	onSaved,
}: {
	organizationId: string;
	/** Null creates a new template. */
	templateId: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved: () => void;
}) {
	const { t } = useTranslate();
	const { data: template, isLoading } = useQuery({
		queryKey: queryKeys.projects.templateDetail(templateId ?? ""),
		queryFn: async () => {
			const result = await getProjectTemplateDetails(templateId ?? "");
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: open && templateId !== null,
	});

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{templateId
							? t("settings.projects.templates.editTitle", "Edit template")
							: t("settings.projects.templates.createTitle", "Create template")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.projects.templates.dialogDescription",
							"New projects created from this template copy its contents once.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>
				{open &&
					(templateId === null ? (
						<TemplateForm
							organizationId={organizationId}
							template={null}
							onCancel={() => onOpenChange(false)}
							onSaved={onSaved}
						/>
					) : isLoading || !template ? (
						<ActionPanelBody className="space-y-3" aria-busy="true">
							<Skeleton className="h-9 w-full" />
							<Skeleton className="h-16 w-full" />
							<Skeleton className="h-9 w-full" />
						</ActionPanelBody>
					) : (
						<TemplateForm
							key={`${template.id}:${template.updatedAt.toString()}`}
							organizationId={organizationId}
							template={template}
							onCancel={() => onOpenChange(false)}
							onSaved={onSaved}
						/>
					))}
			</ActionPanelContent>
		</ActionPanel>
	);
}

// ---------------------------------------------------------------------------
// Template list
// ---------------------------------------------------------------------------

function TemplateRowActions({
	template,
	onEdit,
	onDeleted,
}: {
	template: ProjectTemplateSummary;
	onEdit: () => void;
	onDeleted: () => void;
}) {
	const { t } = useTranslate();
	const [confirming, setConfirming] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);

	async function remove() {
		setIsDeleting(true);
		const result = await deleteProjectTemplate(template.id).catch(() => null);
		setIsDeleting(false);
		if (result?.success) {
			toast.success(
				t("settings.projects.templates.deleted", "{name} deleted", { name: template.name }),
			);
			setConfirming(false);
			onDeleted();
			return;
		}
		toast.error(
			result?.error ||
				t("settings.projects.templates.deleteFailed", "Failed to delete {name}", {
					name: template.name,
				}),
		);
	}

	if (confirming) {
		return (
			<div className="flex items-center justify-end gap-1">
				<span className="text-xs text-muted-foreground">
					{t("settings.projects.templates.deleteQuestion", "Delete this template?")}
				</span>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={isDeleting}
					onClick={() => setConfirming(false)}
				>
					{t("common.cancel", "Cancel")}
				</Button>
				<Button
					type="button"
					variant="destructive"
					size="sm"
					disabled={isDeleting}
					aria-label={t("settings.projects.templates.confirmDelete", "Confirm deleting {name}", {
						name: template.name,
					})}
					onClick={remove}
				>
					{isDeleting && <IconLoader2 className="size-4 animate-spin" aria-hidden="true" />}
					{t("settings.projects.templates.delete", "Delete")}
				</Button>
			</div>
		);
	}

	return (
		<div className="flex items-center justify-end gap-1">
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="size-8"
				aria-label={t("settings.projects.templates.editAction", "Edit {name}", {
					name: template.name,
				})}
				onClick={onEdit}
			>
				<IconEdit className="size-4" aria-hidden="true" />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="size-8"
				aria-label={t("settings.projects.templates.deleteAction", "Delete {name}", {
					name: template.name,
				})}
				onClick={() => setConfirming(true)}
			>
				<IconTrash className="size-4" aria-hidden="true" />
			</Button>
		</div>
	);
}

export function ProjectTemplateManagement({ organizationId }: { organizationId: string }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const queryClient = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);

	const {
		data: templates = [],
		isLoading,
		isFetching,
		refetch,
	} = useQuery({
		queryKey: queryKeys.projects.templates(organizationId),
		queryFn: async () => {
			const result = await getProjectTemplates();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	const hours = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });

	function refresh() {
		queryClient.invalidateQueries({ queryKey: queryKeys.projects.templates(organizationId) });
		if (editingId) {
			queryClient.invalidateQueries({ queryKey: queryKeys.projects.templateDetail(editingId) });
		}
	}

	function openEditor(templateId: string | null) {
		setEditingId(templateId);
		setDialogOpen(true);
	}

	const createButton = (
		<Button onClick={() => openEditor(null)}>
			<IconPlus className="size-4" aria-hidden="true" />
			{t("settings.projects.templates.create", "Create template")}
		</Button>
	);

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-col gap-2">
					<h2 className="text-2xl font-semibold tracking-tight">
						{t("settings.projects.templates.title", "Project templates")}
					</h2>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.projects.templates.description",
							"Blueprints for new projects: tasks, budget, deadline, managers and members.",
						)}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
						<IconRefresh className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
						<span className="sr-only">{t("common.refresh", "Refresh")}</span>
					</Button>
					{createButton}
				</div>
			</div>

			{isLoading ? (
				<Card aria-busy="true">
					<CardHeader className="space-y-2">
						<Skeleton className="h-6 w-40" />
					</CardHeader>
					<CardContent className="space-y-4">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</CardContent>
				</Card>
			) : templates.length === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-center justify-center py-12 text-center">
						<IconTemplate className="size-12 text-muted-foreground" aria-hidden="true" />
						<h3 className="mt-4 text-lg font-medium">
							{t("settings.projects.templates.empty.title", "No templates yet")}
						</h3>
						<p className="mt-2 max-w-md text-sm text-muted-foreground">
							{t(
								"settings.projects.templates.empty.description",
								"Save the tasks, budget and people you set up for every similar project once, and start new projects from it.",
							)}
						</p>
						<div className="mt-4">{createButton}</div>
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardHeader>
						<CardTitle>{t("settings.projects.templates.listTitle", "All templates")}</CardTitle>
						<CardDescription>
							{t(
								"settings.projects.templates.listCount",
								"{count, plural, one {# template} other {# templates}}",
								{ count: templates.length },
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("settings.projects.templates.column.name", "Name")}</TableHead>
									<TableHead>{t("settings.projects.templates.column.tasks", "Tasks")}</TableHead>
									<TableHead>{t("settings.projects.templates.column.budget", "Budget")}</TableHead>
									<TableHead>
										{t("settings.projects.templates.column.deadline", "Deadline")}
									</TableHead>
									<TableHead>{t("settings.projects.templates.column.people", "People")}</TableHead>
									<TableHead className="w-[120px]">
										<span className="sr-only">
											{t("settings.projects.templates.column.actions", "Actions")}
										</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{templates.map((template) => (
									<TableRow key={template.id}>
										<TableCell>
											<div className="flex items-center gap-2">
												{template.color && (
													<span
														className="size-4 shrink-0 rounded-full"
														style={{ backgroundColor: template.color }}
														aria-hidden="true"
													/>
												)}
												<TemplateIcon
													icon={template.icon}
													className="size-4 shrink-0 text-muted-foreground"
												/>
												<div className="min-w-0">
													<div className="font-medium">{template.name}</div>
													{template.description && (
														<div className="line-clamp-1 text-sm text-muted-foreground">
															{template.description}
														</div>
													)}
												</div>
											</div>
										</TableCell>
										<TableCell>
											{t(
												"settings.projects.templates.taskCount",
												"{count, plural, one {# task} other {# tasks}}",
												{ count: template.taskCount },
											)}
										</TableCell>
										<TableCell>
											{template.budgetHours ? (
												t("settings.projects.templates.budgetHours", "{hours} h", {
													hours: hours.format(Number(template.budgetHours)),
												})
											) : (
												<span className="text-muted-foreground">-</span>
											)}
										</TableCell>
										<TableCell>
											{template.deadlineOffsetDays === null ? (
												<span className="text-muted-foreground">-</span>
											) : template.deadlineOffsetDays === 0 ? (
												t("settings.projects.templates.deadlineSameDay", "On the day of creation")
											) : (
												t(
													"settings.projects.templates.deadlineOffset",
													"{count, plural, one {# day after creation} other {# days after creation}}",
													{ count: template.deadlineOffsetDays },
												)
											)}
										</TableCell>
										<TableCell>
											{t(
												"settings.projects.templates.peopleCount",
												"{count, plural, one {# person or team} other {# people and teams}}",
												{ count: template.managerCount + template.assignmentCount },
											)}
										</TableCell>
										<TableCell>
											<TemplateRowActions
												template={template}
												onEdit={() => openEditor(template.id)}
												onDeleted={refresh}
											/>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			)}

			<ProjectTemplateDialog
				organizationId={organizationId}
				templateId={editingId}
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onSaved={() => {
					refresh();
					setDialogOpen(false);
				}}
			/>
		</div>
	);
}
