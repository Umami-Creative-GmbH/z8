/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@/lib/calendar/types";
import { WorkPeriodEditDialog } from "./work-period-edit-dialog";

const { updateWorkPeriodProject, toastError, toastSuccess } = vi.hoisted(() => ({
	updateWorkPeriodProject: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions", () => ({
	updateWorkPeriodNotes: vi.fn(),
	updateWorkPeriodProject,
}));

vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			fallback.replace(/\{(\w+)\}/g, (_, name: string) => params?.[name] ?? ""),
	}),
}));

vi.mock("@/stores/organization-settings-store", () => ({ useProjectsEnabled: () => true }));

vi.mock("./work-period-time-edit-section", () => ({ WorkPeriodTimeSection: () => null }));

vi.mock("@/lib/query/use-assigned-projects", () => ({
	useAssignedProjects: () => ({
		projects: [
			{ id: "project-1", name: "Website", tasks: [{ id: "task-design", name: "Design" }] },
			{ id: "project-2", name: "Audit", tasks: [{ id: "task-fieldwork", name: "Fieldwork" }] },
		],
		isLoading: false,
		isError: false,
	}),
}));

vi.mock("@/components/time-tracking/project-selector", () => ({
	ProjectSelectorView: ({
		onValueChange,
		projects,
		value,
	}: {
		onValueChange: (value: string | undefined) => void;
		projects: { id: string; name: string }[];
		value?: string;
	}) => (
		<select
			aria-label="Project"
			onChange={(event) => onValueChange(event.target.value || undefined)}
			value={value ?? ""}
		>
			<option value="">No project</option>
			{projects.map((project) => (
				<option key={project.id} value={project.id}>
					{project.name}
				</option>
			))}
		</select>
	),
}));

/** Lists what the real picker would offer: the project's open tasks, plus a selected current task. */
vi.mock("@/components/time-tracking/task-selector", () => ({
	TaskSelectorView: ({
		currentTask,
		onValueChange,
		projectId,
		projects,
		value,
	}: {
		currentTask?: { id: string; name: string; projectId: string } | null;
		onValueChange: (value: string | undefined) => void;
		projectId: string | undefined;
		projects: { id: string; tasks: { id: string; name: string }[] }[];
		value?: string;
	}) => {
		const tasks = [...(projects.find((project) => project.id === projectId)?.tasks ?? [])];
		if (currentTask && currentTask.projectId === projectId && currentTask.id === value) {
			tasks.unshift(currentTask);
		}
		return tasks.length === 0 ? null : (
			<select
				aria-label="Task"
				onChange={(event) => onValueChange(event.target.value || undefined)}
				value={value ?? ""}
			>
				<option value="">No task</option>
				{tasks.map((task) => (
					<option key={task.id} value={task.id}>
						{task.name}
					</option>
				))}
			</select>
		);
	},
}));

function bookedEvent(metadata: Record<string, unknown> = {}): CalendarEvent {
	return {
		id: "period-1",
		type: "work_period",
		date: new Date("2026-09-01T07:00:00Z"),
		endDate: new Date("2026-09-01T11:00:00Z"),
		title: "Work",
		color: "#000",
		metadata: {
			durationMinutes: 240,
			employeeName: "Alex",
			projectId: "project-1",
			projectName: "Website",
			taskId: "task-kickoff",
			taskName: "Kickoff",
			taskState: "done",
			...metadata,
		},
	};
}

function renderDialog(event: CalendarEvent = bookedEvent()) {
	render(
		<WorkPeriodEditDialog
			event={event}
			canChangeProject
			open
			onOpenChange={() => {}}
			displayContext={{ timezone: "UTC", locale: "en-US" } as never}
		/>,
	);
	// The project section comes before the notes section, each with its own Edit button.
	const [editProject] = screen.getAllByRole("button", { name: "Edit" });
	if (!editProject) throw new Error("Project edit button not found");
	fireEvent.click(editProject);
}

function save() {
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

describe("WorkPeriodEditDialog project and task (#874)", () => {
	beforeEach(() => {
		updateWorkPeriodProject.mockReset();
		updateWorkPeriodProject.mockResolvedValue({
			success: true,
			data: { workPeriodId: "period-1", projectId: "project-1" },
		});
	});

	it("shows the booking's task next to its project", () => {
		render(
			<WorkPeriodEditDialog
				event={bookedEvent({ taskState: "open", taskName: "Design", taskId: "task-design" })}
				canChangeProject
				open
				onOpenChange={() => {}}
				displayContext={{ timezone: "UTC", locale: "en-US" } as never}
			/>,
		);

		expect(screen.getByText("Website")).toBeTruthy();
		expect(screen.getByText("Design")).toBeTruthy();
	});

	it("offers no project or task change on another employee's work, only the owner may change it", () => {
		render(
			<WorkPeriodEditDialog
				event={bookedEvent()}
				canChangeProject={false}
				open
				onOpenChange={() => {}}
				displayContext={{ timezone: "UTC", locale: "en-US" } as never}
			/>,
		);

		expect(screen.getByText("Website")).toBeTruthy();
		// Only the notes keep their Edit button.
		expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
		expect(screen.queryByLabelText("Project")).toBeNull();
	});

	it("pre-selects the booking's task, even a done one", () => {
		renderDialog();

		const task = screen.getByLabelText("Task") as HTMLSelectElement;
		expect(task.value).toBe("task-kickoff");
	});

	it("keeps the current task when saving without changing it", async () => {
		renderDialog();

		save();

		await waitFor(() => expect(updateWorkPeriodProject).toHaveBeenCalledOnce());
		expect(updateWorkPeriodProject).toHaveBeenCalledWith("period-1", "project-1", undefined);
	});

	it("books another open task of the same project", async () => {
		renderDialog();

		fireEvent.change(screen.getByLabelText("Task"), { target: { value: "task-design" } });
		save();

		await waitFor(() =>
			expect(updateWorkPeriodProject).toHaveBeenCalledWith("period-1", "project-1", "task-design"),
		);
	});

	it("clears the task", async () => {
		renderDialog();

		fireEvent.change(screen.getByLabelText("Task"), { target: { value: "" } });
		save();

		await waitFor(() =>
			expect(updateWorkPeriodProject).toHaveBeenCalledWith("period-1", "project-1", null),
		);
	});

	it("clears the task when the project changes and books a task of the new one", async () => {
		renderDialog();

		fireEvent.change(screen.getByLabelText("Project"), { target: { value: "project-2" } });
		expect((screen.getByLabelText("Task") as HTMLSelectElement).value).toBe("");
		fireEvent.change(screen.getByLabelText("Task"), { target: { value: "task-fieldwork" } });
		save();

		await waitFor(() =>
			expect(updateWorkPeriodProject).toHaveBeenCalledWith(
				"period-1",
				"project-2",
				"task-fieldwork",
			),
		);
	});

	it("does not offer a done task again once another project was chosen", () => {
		renderDialog();

		fireEvent.change(screen.getByLabelText("Project"), { target: { value: "project-2" } });
		fireEvent.change(screen.getByLabelText("Project"), { target: { value: "project-1" } });

		const options = Array.from((screen.getByLabelText("Task") as HTMLSelectElement).options);
		expect(options.map((option) => option.textContent)).toEqual(["No task", "Design"]);
	});

	it("sends a project change without a task as a clear", async () => {
		renderDialog();

		fireEvent.change(screen.getByLabelText("Project"), { target: { value: "project-2" } });
		save();

		await waitFor(() =>
			expect(updateWorkPeriodProject).toHaveBeenCalledWith("period-1", "project-2", null),
		);
	});

	it("words a refused task's stable reason in the app's language", async () => {
		updateWorkPeriodProject.mockResolvedValue({
			success: false,
			error: "This task is done and takes no new bookings",
			code: "task_done",
		});
		renderDialog();

		fireEvent.change(screen.getByLabelText("Task"), { target: { value: "task-design" } });
		save();

		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith("This task is done, so no time can be booked to it"),
		);
	});
});
