/** @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type BookingTask, TaskSelectorView } from "./task-selector";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? "")),
	}),
}));

beforeAll(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	HTMLElement.prototype.scrollIntoView = vi.fn();
});

const projects = [
	{
		id: "project-website",
		tasks: [
			{ id: "task-design", name: "Design" },
			{ id: "task-launch", name: "Launch" },
		],
	},
	{ id: "project-audit", tasks: [{ id: "task-fieldwork", name: "Fieldwork" }] },
	{ id: "project-internal", tasks: [] },
];

function Picker({
	projectId,
	initialValue,
	currentTask,
}: {
	projectId: string | undefined;
	initialValue?: string;
	currentTask?: BookingTask | null;
}) {
	const [value, setValue] = useState<string | undefined>(initialValue);
	return (
		<>
			<TaskSelectorView
				projectId={projectId}
				projects={projects}
				value={value}
				onValueChange={setValue}
				currentTask={currentTask}
			/>
			<output data-testid="chosen">{value ?? "none"}</output>
		</>
	);
}

async function openOptions() {
	const user = userEvent.setup();
	await user.click(screen.getByRole("combobox", { name: "Task" }));
	return { user, listbox: await screen.findByRole("listbox") };
}

function optionNames(listbox: HTMLElement) {
	return within(listbox)
		.getAllByRole("option")
		.map((option) => option.textContent);
}

describe("TaskSelectorView", () => {
	it("offers only the open tasks of the chosen project", async () => {
		render(<Picker projectId="project-website" />);

		const { listbox } = await openOptions();

		expect(optionNames(listbox)).toEqual(["No task", "Design", "Launch"]);
	});

	it("is hidden until a project is chosen", () => {
		render(<Picker projectId={undefined} />);

		expect(screen.queryByRole("combobox", { name: "Task" })).toBeNull();
	});

	it("is hidden for a project without open tasks", () => {
		render(<Picker projectId="project-internal" />);

		expect(screen.queryByRole("combobox", { name: "Task" })).toBeNull();
	});

	it("is hidden for a project it has no task list for", () => {
		render(<Picker projectId="project-unknown" />);

		expect(screen.queryByRole("combobox", { name: "Task" })).toBeNull();
	});

	it("books the chosen task and can clear it again", async () => {
		render(<Picker projectId="project-audit" />);

		const first = await openOptions();
		await first.user.click(within(first.listbox).getByRole("option", { name: "Fieldwork" }));
		expect(screen.getByTestId("chosen").textContent).toBe("task-fieldwork");

		const second = await openOptions();
		await second.user.click(within(second.listbox).getByRole("option", { name: "No task" }));
		expect(screen.getByTestId("chosen").textContent).toBe("none");
	});

	it("keeps a booking's done task visible and selected", async () => {
		const done: BookingTask = {
			id: "task-kickoff",
			name: "Kickoff",
			state: "done",
			projectId: "project-website",
		};
		render(<Picker projectId="project-website" initialValue="task-kickoff" currentTask={done} />);

		expect(screen.getByRole("combobox", { name: "Task" }).textContent).toContain("Kickoff");
		const { listbox } = await openOptions();
		expect(optionNames(listbox)).toEqual(["No task", "Kickoff (done)", "Design", "Launch"]);
	});

	it("does not offer a done task once another task is chosen", async () => {
		const done: BookingTask = {
			id: "task-kickoff",
			name: "Kickoff",
			state: "done",
			projectId: "project-website",
		};
		render(<Picker projectId="project-website" initialValue="task-kickoff" currentTask={done} />);

		const first = await openOptions();
		await first.user.click(within(first.listbox).getByRole("option", { name: "Design" }));

		const second = await openOptions();
		expect(optionNames(second.listbox)).toEqual(["No task", "Design", "Launch"]);
	});

	it("shows a booking's done task even when its project has no open tasks", () => {
		const done: BookingTask = {
			id: "task-retro",
			name: "Retro",
			state: "done",
			projectId: "project-internal",
		};
		render(<Picker projectId="project-internal" initialValue="task-retro" currentTask={done} />);

		expect(screen.getByRole("combobox", { name: "Task" }).textContent).toContain("Retro");
	});

	it("never offers a booking's task under another project", async () => {
		const current: BookingTask = {
			id: "task-design",
			name: "Design",
			state: "open",
			projectId: "project-website",
		};
		render(<Picker projectId="project-audit" initialValue="task-design" currentTask={current} />);

		const { listbox } = await openOptions();
		expect(optionNames(listbox)).toEqual(["No task", "Fieldwork"]);
	});
});
