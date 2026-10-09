/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectTask } from "@/lib/projects/project-task-model";
import { ProjectTasksPanel } from "./project-tasks-panel";

const actions = vi.hoisted(() => ({
	getProjectTasks: vi.fn(),
	createProjectTask: vi.fn(),
	updateProjectTask: vi.fn(),
	markProjectTaskDone: vi.fn(),
	reopenProjectTask: vi.fn(),
	deleteProjectTask: vi.fn(),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/app/[locale]/(app)/settings/projects/task-actions", () => actions);

vi.mock("sonner", () => ({ toast }));

vi.mock("next-intl", () => ({ useLocale: () => "en" }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			params
				? fallback.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
				: fallback,
	}),
}));

function task(overrides: Partial<ProjectTask> = {}): ProjectTask {
	return {
		id: "task-1",
		organizationId: "org-1",
		projectId: "project-1",
		name: "Design",
		description: null,
		estimateHours: null,
		state: "open",
		doneAt: null,
		doneBy: null,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

function renderPanel() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<ProjectTasksPanel
				project={{ id: "project-1", name: "Apollo" }}
				open
				onOpenChange={vi.fn()}
			/>
		</QueryClientProvider>,
	);
}

describe("ProjectTasksPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		actions.getProjectTasks.mockResolvedValue({
			success: true,
			data: [
				task({
					id: "task-open",
					name: "Design",
					description: "Wireframes",
					estimateHours: "12.50",
				}),
				task({
					id: "task-done",
					name: "Kickoff",
					state: "done",
					doneAt: new Date("2026-02-01T00:00:00Z"),
					doneBy: "user-1",
				}),
			],
		});
		for (const mutation of [
			actions.createProjectTask,
			actions.updateProjectTask,
			actions.markProjectTaskDone,
			actions.reopenProjectTask,
			actions.deleteProjectTask,
		]) {
			mutation.mockResolvedValue({ success: true, data: undefined });
		}
	});

	it("lists the project's tasks with their estimate and state", async () => {
		renderPanel();

		const list = await screen.findByRole("list", { name: "Tasks of Apollo" });
		const [design, kickoff] = within(list).getAllByRole("listitem");
		expect(within(design).getByText("Design")).toBeTruthy();
		expect(within(design).getByText("Wireframes")).toBeTruthy();
		expect(within(design).getByText("Estimate: 12.5 h")).toBeTruthy();
		expect(within(kickoff).getByText("Kickoff")).toBeTruthy();
		expect(within(kickoff).getByText("Done")).toBeTruthy();
		expect(actions.getProjectTasks).toHaveBeenCalledWith("project-1");
	});

	it("adds a task with a description and an estimate", async () => {
		const user = userEvent.setup();
		renderPanel();

		const form = screen.getByRole("form", { name: "Add a task" });
		await user.type(within(form).getByLabelText(/Name/), "Build");
		await user.type(within(form).getByLabelText("Description"), "Implementation");
		await user.type(within(form).getByLabelText("Estimate (hours)"), "4.5");
		await user.click(within(form).getByRole("button", { name: "Add task" }));

		expect(actions.createProjectTask).toHaveBeenCalledWith({
			projectId: "project-1",
			name: "Build",
			description: "Implementation",
			estimateHours: 4.5,
		});
		expect(toast.success).toHaveBeenCalledWith("Task added");
	});

	it("does not submit a task without a name", async () => {
		const user = userEvent.setup();
		renderPanel();

		const form = screen.getByRole("form", { name: "Add a task" });
		await user.type(within(form).getByLabelText(/Name/), "   ");
		await user.click(within(form).getByRole("button", { name: "Add task" }));

		expect(actions.createProjectTask).not.toHaveBeenCalled();
		expect(within(form).getByText("Enter a task name")).toBeTruthy();
	});

	it("reports a refused task without clearing the form", async () => {
		const user = userEvent.setup();
		actions.createProjectTask.mockResolvedValue({
			success: false,
			error: "A task with this name already exists in this project",
		});
		renderPanel();

		const form = screen.getByRole("form", { name: "Add a task" });
		const name = within(form).getByLabelText(/Name/);
		await user.type(name, "Design");
		await user.click(within(form).getByRole("button", { name: "Add task" }));

		expect(toast.error).toHaveBeenCalledWith(
			"A task with this name already exists in this project",
		);
		expect((name as HTMLInputElement).value).toBe("Design");
	});

	it("renames a task and edits its estimate", async () => {
		const user = userEvent.setup();
		renderPanel();

		await user.click(await screen.findByRole("button", { name: "Edit Design" }));
		const form = screen.getByRole("form", { name: "Edit Design" });
		const name = within(form).getByLabelText(/Name/);
		await user.clear(name);
		await user.type(name, "Visual design");
		const estimate = within(form).getByLabelText("Estimate (hours)");
		await user.clear(estimate);
		await user.click(within(form).getByRole("button", { name: "Save" }));

		expect(actions.updateProjectTask).toHaveBeenCalledWith("task-open", {
			name: "Visual design",
			description: "Wireframes",
			estimateHours: null,
		});
		expect(toast.success).toHaveBeenCalledWith("Task updated");
	});

	it("marks an open task done and reopens a done task", async () => {
		const user = userEvent.setup();
		renderPanel();

		await user.click(await screen.findByRole("button", { name: "Mark Design done" }));
		await user.click(screen.getByRole("button", { name: "Reopen Kickoff" }));

		expect(actions.markProjectTaskDone).toHaveBeenCalledWith("task-open");
		expect(actions.reopenProjectTask).toHaveBeenCalledWith("task-done");
	});

	it("deletes a task only after confirmation", async () => {
		const user = userEvent.setup();
		renderPanel();

		await user.click(await screen.findByRole("button", { name: "Delete Design" }));
		expect(actions.deleteProjectTask).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: "Confirm deleting Design" }));

		expect(actions.deleteProjectTask).toHaveBeenCalledWith("task-open");
		expect(toast.success).toHaveBeenCalledWith("Design deleted");
	});
});
