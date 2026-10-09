/**
 * The project template model (#878): its shape and input rules, shared by the
 * template settings screen and the server. Pure: safe in client and server
 * code. Reads and writes live in `./project-templates` (server only).
 *
 * A template is its own entity, never a project (ADR 0001). Creating a project
 * from it copies its contents once (#880).
 */

import {
	normalizeProjectTaskDescription,
	normalizeProjectTaskEstimate,
	normalizeProjectTaskName,
	PROJECT_TASK_ESTIMATE_MAX_HOURS,
} from "./project-task-model";

export type ProjectTemplateAssignmentType = "team" | "employee";

/**
 * Whether a template's team or employee can still be copied onto a new
 * project: `departed` employees have lost organization access, `removed`
 * teams and employees no longer exist (only their last known name is left).
 */
export type ProjectTemplateMemberAvailability = "available" | "departed" | "removed";

export interface ProjectTemplateTask {
	id: string;
	name: string;
	description: string | null;
	/** numeric(8, 2) text; null = no estimate. */
	estimateHours: string | null;
}

export interface ProjectTemplateManager {
	id: string;
	/** Null once the employee was deleted. */
	employeeId: string | null;
	name: string;
	availability: ProjectTemplateMemberAvailability;
}

export interface ProjectTemplateAssignment {
	id: string;
	type: ProjectTemplateAssignmentType;
	/** Null for an employee assignment, or once the team was deleted. */
	teamId: string | null;
	/** Null for a team assignment, or once the employee was deleted. */
	employeeId: string | null;
	name: string;
	availability: ProjectTemplateMemberAvailability;
}

/**
 * A manager or assignment left out when a template became a project or a
 * project became a template (#880), and why: `departed` employees left the
 * organization, `removed` teams and employees no longer exist.
 */
export interface SkippedProjectMember {
	role: "manager" | "team" | "employee";
	name: string;
	reason: Exclude<ProjectTemplateMemberAvailability, "available">;
}

/** A full template, as `getProjectTemplate` returns it. */
export interface ProjectTemplate {
	id: string;
	organizationId: string;
	name: string;
	description: string | null;
	icon: string | null;
	color: string | null;
	/** numeric(8, 2) text; null = unlimited. */
	budgetHours: string | null;
	/** The new project's deadline is its creation date plus this many days; null = none. */
	deadlineOffsetDays: number | null;
	createdAt: Date;
	updatedAt: Date;
	/** By name, ignoring case. */
	tasks: ProjectTemplateTask[];
	/** By name. */
	managers: ProjectTemplateManager[];
	/** Teams first, then employees, each by name. */
	assignments: ProjectTemplateAssignment[];
}

/** A template in the template list. */
export interface ProjectTemplateSummary {
	id: string;
	name: string;
	description: string | null;
	icon: string | null;
	color: string | null;
	budgetHours: string | null;
	deadlineOffsetDays: number | null;
	taskCount: number;
	managerCount: number;
	assignmentCount: number;
	updatedAt: Date;
}

export interface ProjectTemplateTaskInput {
	name: string;
	description?: string | null;
	/** Hours; null or omitted = no estimate. */
	estimateHours?: number | null;
}

/** Everything a template holds, as the template form submits it. */
export interface ProjectTemplateInput {
	name: string;
	description?: string | null;
	/** A Tabler icon component name, e.g. `IconRocket`. */
	icon?: string | null;
	/** `#rrggbb`. */
	color?: string | null;
	/** Hours; null or omitted = unlimited. */
	budgetHours?: number | null;
	/** Whole days after the project's creation; null or omitted = no deadline. */
	deadlineOffsetDays?: number | null;
	tasks?: ProjectTemplateTaskInput[];
	managerEmployeeIds?: string[];
	assignments?: { type: ProjectTemplateAssignmentType; targetId: string }[];
}

/** A template input after the input rules: trimmed, rounded and de-duplicated. */
export interface NormalizedProjectTemplateInput {
	name: string;
	description: string | null;
	icon: string | null;
	color: string | null;
	budgetHours: string | null;
	deadlineOffsetDays: number | null;
	tasks: { name: string; description: string | null; estimateHours: string | null }[];
	managerEmployeeIds: string[];
	teamIds: string[];
	employeeIds: string[];
}

export const PROJECT_TEMPLATE_NAME_MAX_LENGTH = 200;
export const PROJECT_TEMPLATE_DESCRIPTION_MAX_LENGTH = 2000;
export const PROJECT_TEMPLATE_MAX_TASKS = 200;
export const PROJECT_TEMPLATE_MAX_DEADLINE_OFFSET_DAYS = 3650;
export const PROJECT_TEMPLATE_BUDGET_MAX_HOURS = PROJECT_TASK_ESTIMATE_MAX_HOURS;

export type ProjectTemplateInputProblem =
	| "nameRequired"
	| "nameTooLong"
	| "descriptionTooLong"
	| "iconInvalid"
	| "colorInvalid"
	| "budgetInvalid"
	| "deadlineOffsetInvalid"
	| "tooManyTasks"
	| "taskNameRequired"
	| "taskNameTooLong"
	| "taskNameDuplicate"
	| "taskDescriptionTooLong"
	| "taskEstimateInvalid";

export type ProjectTemplateInputResult =
	| { ok: true; value: NormalizedProjectTemplateInput }
	| { ok: false; problem: ProjectTemplateInputProblem; taskIndex?: number };

const ICON_PATTERN = /^Icon[A-Z][A-Za-z0-9]{0,63}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function blankToNull(value: string | null | undefined) {
	const trimmed = value?.trim() ?? "";
	return trimmed.length > 0 ? trimmed : null;
}

function unique(values: readonly string[] | undefined) {
	return [...new Set(values ?? [])];
}

const TASK_PROBLEMS = {
	nameRequired: "taskNameRequired",
	nameTooLong: "taskNameTooLong",
	descriptionTooLong: "taskDescriptionTooLong",
	estimateInvalid: "taskEstimateInvalid",
} as const;

/**
 * Applies the template input rules: the name is required and the optional
 * fields are trimmed (blank = none); the budget is positive hours rounded to
 * two decimals; the deadline offset is whole days from 0 to 3650; task names
 * follow the project task rules and are unique within the template, ignoring
 * case; repeated managers and assignments collapse into one.
 */
export function normalizeProjectTemplateInput(
	input: ProjectTemplateInput,
): ProjectTemplateInputResult {
	const name = input.name.trim();
	if (name.length === 0) return { ok: false, problem: "nameRequired" };
	if (name.length > PROJECT_TEMPLATE_NAME_MAX_LENGTH) return { ok: false, problem: "nameTooLong" };

	const description = blankToNull(input.description);
	if (description && description.length > PROJECT_TEMPLATE_DESCRIPTION_MAX_LENGTH) {
		return { ok: false, problem: "descriptionTooLong" };
	}

	const icon = blankToNull(input.icon);
	if (icon && !ICON_PATTERN.test(icon)) return { ok: false, problem: "iconInvalid" };

	const color = blankToNull(input.color);
	if (color && !COLOR_PATTERN.test(color)) return { ok: false, problem: "colorInvalid" };

	let budgetHours: string | null = null;
	if (input.budgetHours !== null && input.budgetHours !== undefined) {
		const rounded = Math.round(input.budgetHours * 100) / 100;
		if (
			!Number.isFinite(input.budgetHours) ||
			rounded <= 0 ||
			rounded > PROJECT_TEMPLATE_BUDGET_MAX_HOURS
		) {
			return { ok: false, problem: "budgetInvalid" };
		}
		budgetHours = rounded.toFixed(2);
	}

	const offset = input.deadlineOffsetDays;
	if (
		offset !== null &&
		offset !== undefined &&
		(!Number.isInteger(offset) || offset < 0 || offset > PROJECT_TEMPLATE_MAX_DEADLINE_OFFSET_DAYS)
	) {
		return { ok: false, problem: "deadlineOffsetInvalid" };
	}

	const rawTasks = input.tasks ?? [];
	if (rawTasks.length > PROJECT_TEMPLATE_MAX_TASKS) return { ok: false, problem: "tooManyTasks" };
	const tasks: NormalizedProjectTemplateInput["tasks"] = [];
	const taskNames = new Set<string>();
	for (const [taskIndex, task] of rawTasks.entries()) {
		const taskName = normalizeProjectTaskName(task.name);
		if (!taskName.ok) return { ok: false, problem: TASK_PROBLEMS[taskName.problem], taskIndex };
		const taskDescription = normalizeProjectTaskDescription(task.description);
		if (!taskDescription.ok) {
			return { ok: false, problem: TASK_PROBLEMS[taskDescription.problem], taskIndex };
		}
		const estimate = normalizeProjectTaskEstimate(task.estimateHours);
		if (!estimate.ok) return { ok: false, problem: TASK_PROBLEMS[estimate.problem], taskIndex };
		const key = taskName.value.toLowerCase();
		if (taskNames.has(key)) return { ok: false, problem: "taskNameDuplicate", taskIndex };
		taskNames.add(key);
		tasks.push({
			name: taskName.value,
			description: taskDescription.value,
			estimateHours: estimate.value,
		});
	}

	const assignments = input.assignments ?? [];
	return {
		ok: true,
		value: {
			name,
			description,
			icon,
			color,
			budgetHours,
			deadlineOffsetDays: offset ?? null,
			tasks,
			managerEmployeeIds: unique(input.managerEmployeeIds),
			teamIds: unique(assignments.filter((a) => a.type === "team").map((a) => a.targetId)),
			employeeIds: unique(assignments.filter((a) => a.type === "employee").map((a) => a.targetId)),
		},
	};
}
