/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClockOutOnBehalfDialog } from "./clock-out-on-behalf-dialog";

const { getClockOutOnBehalfTaskChoices } = vi.hoisted(() => ({
	getClockOutOnBehalfTaskChoices: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/on-behalf-task-choices", () => ({
	getClockOutOnBehalfTaskChoices,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
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
		projects: { id: string; requiresTask?: boolean; tasks: { id: string; name: string }[] }[];
		value?: string;
	}) => {
		const project = projects.find((choice) => choice.id === projectId);
		const tasks = [...(project?.tasks ?? [])];
		if (currentTask && currentTask.projectId === projectId && currentTask.id === value) {
			tasks.unshift(currentTask);
		}
		return tasks.length === 0 ? null : (
			<select
				aria-label={project?.requiresTask ? "Task (required)" : "Task"}
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

function renderDialog() {
	const onConfirm = vi.fn();
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<ClockOutOnBehalfDialog
			open
			workPeriodId="period-1"
			isPending={false}
			onOpenChange={() => {}}
			onConfirm={onConfirm}
		/>,
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={client}>{children}</QueryClientProvider>
			),
		},
	);
	return { onConfirm };
}

function choices(currentTask: { id: string; name: string; state: "open" | "done" } | null) {
	return {
		success: true,
		data: {
			projectId: "project-1",
			tasks: [
				{ id: "task-build", name: "Build" },
				{ id: "task-design", name: "Design" },
			],
			currentTask: currentTask ? { ...currentTask, projectId: "project-1" } : null,
		},
	};
}

describe("ClockOutOnBehalfDialog task (#874)", () => {
	beforeEach(() => {
		getClockOutOnBehalfTaskChoices.mockReset();
	});

	it("offers the open tasks of the running work's project", async () => {
		getClockOutOnBehalfTaskChoices.mockResolvedValue(choices(null));
		renderDialog();

		const task = (await screen.findByLabelText("Task")) as HTMLSelectElement;
		expect(Array.from(task.options).map((option) => option.textContent)).toEqual([
			"No task",
			"Build",
			"Design",
		]);
		expect(getClockOutOnBehalfTaskChoices).toHaveBeenCalledWith("period-1");
	});

	it("books the chosen task", async () => {
		getClockOutOnBehalfTaskChoices.mockResolvedValue(choices(null));
		const { onConfirm } = renderDialog();

		fireEvent.change(await screen.findByLabelText("Task"), { target: { value: "task-design" } });
		fireEvent.click(screen.getByRole("button", { name: "Clock Out" }));

		expect(onConfirm).toHaveBeenCalledWith({ taskId: "task-design" });
	});

	it("keeps the running work's task, even a done one, unless another is chosen", async () => {
		getClockOutOnBehalfTaskChoices.mockResolvedValue(
			choices({ id: "task-kickoff", name: "Kickoff", state: "done" }),
		);
		const { onConfirm } = renderDialog();

		const task = (await screen.findByLabelText("Task")) as HTMLSelectElement;
		expect(task.value).toBe("task-kickoff");
		fireEvent.click(screen.getByRole("button", { name: "Clock Out" }));

		expect(onConfirm).toHaveBeenCalledWith({});
	});

	it("clears the running work's task", async () => {
		getClockOutOnBehalfTaskChoices.mockResolvedValue(
			choices({ id: "task-build", name: "Build", state: "open" }),
		);
		const { onConfirm } = renderDialog();

		fireEvent.change(await screen.findByLabelText("Task"), { target: { value: "" } });
		fireEvent.click(screen.getByRole("button", { name: "Clock Out" }));

		expect(onConfirm).toHaveBeenCalledWith({ taskId: null });
	});

	it("hands the picker the project's task requirement (#884)", async () => {
		const required = choices(null);
		getClockOutOnBehalfTaskChoices.mockResolvedValue({
			...required,
			data: { ...required.data, requiresTask: true },
		});
		renderDialog();

		expect(await screen.findByLabelText("Task (required)")).toBeTruthy();
	});

	it("holds the clock-out until a required task is chosen (#884)", async () => {
		const required = choices(null);
		getClockOutOnBehalfTaskChoices.mockResolvedValue({
			...required,
			data: { ...required.data, requiresTask: true },
		});
		const { onConfirm } = renderDialog();

		const task = await screen.findByLabelText("Task (required)");
		expect(screen.getByRole("button", { name: "Clock Out" }).hasAttribute("disabled")).toBe(true);
		fireEvent.change(task, { target: { value: "task-build" } });
		fireEvent.click(screen.getByRole("button", { name: "Clock Out" }));

		expect(onConfirm).toHaveBeenCalledWith({ taskId: "task-build" });
	});

	it("lets the running work's task satisfy a required task (#884)", async () => {
		const kept = choices({ id: "task-build", name: "Build", state: "open" });
		getClockOutOnBehalfTaskChoices.mockResolvedValue({
			...kept,
			data: { ...kept.data, requiresTask: true },
		});
		renderDialog();

		await screen.findByLabelText("Task (required)");
		expect(screen.getByRole("button", { name: "Clock Out" }).hasAttribute("disabled")).toBe(false);
	});

	it("does not hold the clock-out when the project offers no open task (#884)", async () => {
		getClockOutOnBehalfTaskChoices.mockResolvedValue({
			success: true,
			data: { projectId: "project-1", tasks: [], currentTask: null, requiresTask: true },
		});
		const { onConfirm } = renderDialog();

		await waitFor(() => expect(getClockOutOnBehalfTaskChoices).toHaveBeenCalled());
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Clock Out" }).hasAttribute("disabled")).toBe(
				false,
			),
		);
		fireEvent.click(screen.getByRole("button", { name: "Clock Out" }));
		expect(onConfirm).toHaveBeenCalledWith({});
	});

	it("still clocks out when the task choices cannot be loaded", async () => {
		getClockOutOnBehalfTaskChoices.mockResolvedValue({ success: false, error: "Nope" });
		const { onConfirm } = renderDialog();

		await waitFor(() => expect(getClockOutOnBehalfTaskChoices).toHaveBeenCalled());
		fireEvent.click(screen.getByRole("button", { name: "Clock Out" }));

		expect(screen.queryByLabelText("Task")).toBeNull();
		expect(onConfirm).toHaveBeenCalledWith({});
	});
});
