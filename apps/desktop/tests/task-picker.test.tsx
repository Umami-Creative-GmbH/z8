import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClosingAttributionFields } from "../src/components/ClosingAttributionFields";
import { useClosingAttribution } from "../src/hooks/useClosingAttribution";
import { LocaleProvider } from "../src/lib/i18n";
import type { ClosingAttribution, DesktopContext } from "../src/types";

afterEach(cleanup);

const ALPHA = "11111111-1111-4111-8111-111111111111";
const DELTA = "33333333-3333-4333-8333-333333333333";
const BETA = "44444444-4444-4444-8444-444444444444";
const BUILD = "22222222-2222-4222-8222-222222222222";
const DESIGN = "55555555-5555-4555-8555-555555555555";
const REVIEW = "66666666-6666-4666-8666-666666666666";

/** The `GET /api/desktop/context` shape from #875: every project carries its open tasks. */
function context(overrides: Partial<DesktopContext> = {}): DesktopContext {
	return {
		userId: "user-1",
		organizationId: "org-1",
		employeeId: "employee-1",
		timezone: "Europe/Berlin",
		locale: null,
		fetchedAt: "2026-10-09T08:00:00.000Z",
		cached: false,
		dayTotalBasis: undefined as never,
		projects: [
			{
				id: ALPHA,
				name: "Alpha",
				tasks: [
					{ id: BUILD, name: "Build" },
					{ id: DESIGN, name: "design" },
				],
			},
			{ id: BETA, name: "Beta", tasks: [] },
			{ id: DELTA, name: "Delta", tasks: [{ id: REVIEW, name: "Review" }] },
		],
		categories: [],
		liveWork: {
			id: "period-1",
			projectId: null,
			workCategoryId: null,
			workLocationType: "office",
		},
		...overrides,
	};
}

function Closing({
	context,
	onClockOut,
}: {
	context: DesktopContext;
	onClockOut: (attribution: ClosingAttribution) => void;
}) {
	const attribution = useClosingAttribution(context);
	return (
		<>
			<ClosingAttributionFields
				form={attribution.form}
				context={context}
				disabled={false}
			/>
			<button
				type="button"
				disabled={attribution.taskMissing}
				onClick={() => onClockOut(attribution.value(context))}
			>
				Clock out
			</button>
		</>
	);
}

function setup(data: DesktopContext) {
	const onClockOut = vi.fn<(attribution: ClosingAttribution) => void>();
	render(<Closing context={data} onClockOut={onClockOut} />);
	return {
		onClockOut,
		project: () => screen.getByRole("combobox", { name: "Project" }),
		task: () => screen.queryByRole("combobox", { name: "Task" }),
		requireTask: () => screen.getByRole("combobox", { name: "Task" }),
		clockOut: async () => {
			await userEvent.click(screen.getByRole("button", { name: "Clock out" }));
			return onClockOut.mock.lastCall?.[0];
		},
	};
}

function optionLabels(select: HTMLElement) {
	return Array.from((select as HTMLSelectElement).options).map(
		(option) => option.textContent,
	);
}

describe("task picker in the closing attribution", () => {
	it("offers only the chosen project's open tasks and sends the chosen task", async () => {
		const view = setup(context());
		expect(view.task()).toBeNull();

		await userEvent.selectOptions(view.project(), ALPHA);
		const task = view.task();
		expect(task).not.toBeNull();
		expect(optionLabels(task!)).toEqual(["No task", "Build", "design"]);

		await userEvent.selectOptions(task!, BUILD);
		expect(await view.clockOut()).toStrictEqual({
			project: { kind: "replace", id: ALPHA },
			workCategory: { kind: "preserve" },
			task: { kind: "replace", id: BUILD },
		});
	});

	it("is hidden for a project without open tasks and sends no task", async () => {
		const view = setup(context());
		await userEvent.selectOptions(view.project(), BETA);
		expect(view.task()).toBeNull();
		expect(await view.clockOut()).toStrictEqual({
			project: { kind: "replace", id: BETA },
			workCategory: { kind: "preserve" },
		});
	});

	it("resets the task when the project changes", async () => {
		const view = setup(context());
		await userEvent.selectOptions(view.project(), ALPHA);
		await userEvent.selectOptions(view.task()!, BUILD);

		await userEvent.selectOptions(view.project(), DELTA);
		expect(optionLabels(view.task()!)).toEqual(["No task", "Review"]);
		expect((view.task() as HTMLSelectElement).value).toBe("");
		expect(await view.clockOut()).toStrictEqual({
			project: { kind: "replace", id: DELTA },
			workCategory: { kind: "preserve" },
		});

		await userEvent.selectOptions(view.project(), ALPHA);
		expect((view.task() as HTMLSelectElement).value).toBe("");
	});

	it("says no task when an older context omits the running task", async () => {
		const view = setup(
			context({
				liveWork: {
					id: "period-1",
					projectId: ALPHA,
					workCategoryId: null,
					workLocationType: "office",
				},
			}),
		);
		const task = view.task();
		expect(optionLabels(task!)).toEqual([
			"No task",
			"No task",
			"Build",
			"design",
		]);
		expect(await view.clockOut()).toStrictEqual({
			project: { kind: "preserve" },
			workCategory: { kind: "preserve" },
		});

		await userEvent.selectOptions(task!, "clear");
		expect(await view.clockOut()).toStrictEqual({
			project: { kind: "preserve" },
			workCategory: { kind: "preserve" },
			task: { kind: "clear" },
		});
	});

	it.each([
		["open", BUILD, "Build"],
		["done", REVIEW, "Shipped"],
	])(
		"names the running %s task only while its project is kept",
		async (_state, id, name) => {
			const view = setup(
				context({
					liveWork: {
						id: "period-1",
						projectId: ALPHA,
						workCategoryId: null,
						workLocationType: "office",
						currentTask: { id, name },
					},
				}),
			);
			expect(optionLabels(view.requireTask())[0]).toBe(
				`Keep current task: ${name}`,
			);
			expect(await view.clockOut()).toStrictEqual({
				project: { kind: "preserve" },
				workCategory: { kind: "preserve" },
			});
			await userEvent.selectOptions(view.project(), ALPHA);
			expect(optionLabels(view.requireTask())[0]).toBe(
				`Keep current task: ${name}`,
			);
			await userEvent.selectOptions(view.project(), DELTA);
			expect(optionLabels(view.requireTask())[0]).toBe("No task");
		},
	);

	it("names a done running task when its project has no open tasks", async () => {
		const view = setup(
			context({
				projects: [{ id: ALPHA, name: "Alpha", tasks: [] }],
				liveWork: {
					id: "period-1",
					projectId: ALPHA,
					workCategoryId: null,
					workLocationType: "office",
					currentTask: { id: REVIEW, name: "Shipped" },
				},
			}),
		);
		expect(view.task()).not.toBeNull();
		expect(optionLabels(view.requireTask())).toEqual([
			"Keep current task: Shipped",
			"No task",
		]);
		expect(await view.clockOut()).toStrictEqual({
			project: { kind: "preserve" },
			workCategory: { kind: "preserve" },
		});
		await userEvent.selectOptions(view.requireTask(), "clear");
		expect(await view.clockOut()).toStrictEqual({
			project: { kind: "preserve" },
			workCategory: { kind: "preserve" },
			task: { kind: "clear" },
		});
	});
	it("says no task when live work explicitly has none", () => {
		const view = setup(
			context({
				liveWork: {
					id: "period-1",
					projectId: ALPHA,
					workCategoryId: null,
					workLocationType: "office",
					currentTask: null,
				},
			}),
		);
		expect(optionLabels(view.requireTask())[0]).toBe("No task");
	});

	it("names the running task in German", () => {
		render(
			<LocaleProvider language="de">
				<Closing
					context={context({
						liveWork: {
							id: "period-1",
							projectId: ALPHA,
							workCategoryId: null,
							workLocationType: "office",
							currentTask: { id: BUILD, name: "Build" },
						},
					})}
					onClockOut={vi.fn()}
				/>
			</LocaleProvider>,
		);
		expect(
			optionLabels(screen.getByRole("combobox", { name: "Aufgabe" }))[0],
		).toBe("Aktuelle Aufgabe beibehalten: Build");
	});
	it("never offers or sends a task when the server's context has no tasks", async () => {
		// An older webapp: projects without `tasks`, and it refuses a `task` key.
		const legacy = context({
			projects: [{ id: ALPHA, name: "Alpha" }],
			liveWork: {
				id: "period-1",
				projectId: ALPHA,
				workCategoryId: null,
				workLocationType: "office",
			},
		});
		const view = setup(legacy);
		expect(view.task()).toBeNull();
		await userEvent.selectOptions(view.project(), ALPHA);
		expect(view.task()).toBeNull();
		expect(await view.clockOut()).toStrictEqual({
			project: { kind: "replace", id: ALPHA },
			workCategory: { kind: "preserve" },
		});
	});

	it("presents the task picker in German", async () => {
		render(
			<LocaleProvider language="de">
				<Closing context={context()} onClockOut={vi.fn()} />
			</LocaleProvider>,
		);
		await userEvent.selectOptions(
			screen.getByRole("combobox", { name: "Projekt" }),
			ALPHA,
		);
		const task = screen.getByRole("combobox", { name: "Aufgabe" });
		expect(optionLabels(task)[0]).toBe("Keine Aufgabe");
	});
	it("drops a chosen task that is no longer open when work ends", async () => {
		const onClockOut = vi.fn<(attribution: ClosingAttribution) => void>();
		const { rerender } = render(
			<Closing context={context()} onClockOut={onClockOut} />,
		);
		await userEvent.selectOptions(
			screen.getByRole("combobox", { name: "Project" }),
			ALPHA,
		);
		await userEvent.selectOptions(
			screen.getByRole("combobox", { name: "Task" }),
			BUILD,
		);
		// A context refresh shows the task was marked done meanwhile.
		const refreshed = context();
		refreshed.projects[0].tasks = [{ id: DESIGN, name: "design" }];
		rerender(<Closing context={refreshed} onClockOut={onClockOut} />);
		await userEvent.click(screen.getByRole("button", { name: "Clock out" }));
		expect(onClockOut.mock.lastCall?.[0]).toStrictEqual({
			project: { kind: "replace", id: ALPHA },
			workCategory: { kind: "preserve" },
		});
	});
});

/** The context with the given projects' task requirement active (#1297). */
function requiring(
	projectIds: string[],
	overrides: Partial<DesktopContext> = {},
): DesktopContext {
	const base = context(overrides);
	return {
		...base,
		projects: base.projects.map((project) =>
			projectIds.includes(project.id)
				? { ...project, taskRequired: true }
				: project,
		),
	};
}

function liveOn(
	projectId: string,
	currentTask?: { id: string; name: string } | null,
): Partial<DesktopContext> {
	return {
		liveWork: {
			id: "period-1",
			projectId,
			workCategoryId: null,
			workLocationType: "office",
			...(currentTask === undefined ? {} : { currentTask }),
		},
	};
}

describe("task picker for a project that requires a task (#1297)", () => {
	const clockOutButton = () =>
		screen.getByRole("button", { name: "Clock out" });
	const isBlocked = () => (clockOutButton() as HTMLButtonElement).disabled;

	it("says a task is required and sends the clock-out only once an open task is picked", async () => {
		const view = setup(requiring([ALPHA]));

		await userEvent.selectOptions(view.project(), ALPHA);
		expect(optionLabels(view.requireTask())).toEqual([
			"Task required",
			"Build",
			"design",
		]);
		expect(isBlocked()).toBe(true);
		expect(screen.getByText("Choose a task to clock out.")).toBeDefined();
		await userEvent.click(clockOutButton());
		expect(view.onClockOut).not.toHaveBeenCalled();

		await userEvent.selectOptions(view.requireTask(), BUILD);
		expect(isBlocked()).toBe(false);
		expect(screen.queryByText("Choose a task to clock out.")).toBeNull();
		expect(await view.clockOut()).toStrictEqual({
			project: { kind: "replace", id: ALPHA },
			workCategory: { kind: "preserve" },
			task: { kind: "replace", id: BUILD },
		});
	});

	it("offers no way to clear the task of running work on such a project", () => {
		const view = setup(requiring([ALPHA], liveOn(ALPHA, null)));

		expect(optionLabels(view.requireTask())).toEqual([
			"Task required",
			"Build",
			"design",
		]);
		expect(isBlocked()).toBe(true);
	});

	it.each([
		["open", BUILD, "Build"],
		["done", REVIEW, "Shipped"],
	])(
		"lets the running %s task satisfy the requirement while it is kept",
		async (_state, id, name) => {
			const view = setup(
				requiring([ALPHA, DELTA], liveOn(ALPHA, { id, name })),
			);

			expect(optionLabels(view.requireTask())).toEqual([
				`Keep current task: ${name}`,
				"Build",
				"design",
			]);
			expect(isBlocked()).toBe(false);
			expect(await view.clockOut()).toStrictEqual({
				project: { kind: "preserve" },
				workCategory: { kind: "preserve" },
			});

			await userEvent.selectOptions(view.project(), DELTA);
			expect(optionLabels(view.requireTask())).toEqual([
				"Task required",
				"Review",
			]);
			expect(isBlocked()).toBe(true);
		},
	);

	it("requires nothing once the work leaves the project", async () => {
		const view = setup(requiring([ALPHA], liveOn(ALPHA, null)));

		await userEvent.selectOptions(view.project(), "clear");
		expect(view.task()).toBeNull();
		expect(isBlocked()).toBe(false);
		expect(await view.clockOut()).toStrictEqual({
			project: { kind: "clear" },
			workCategory: { kind: "preserve" },
		});
	});

	it("still offers no task for a project without an active requirement", async () => {
		const view = setup(requiring([DELTA], liveOn(ALPHA, null)));

		expect(optionLabels(view.requireTask())).toEqual([
			"No task",
			"No task",
			"Build",
			"design",
		]);
		expect(isBlocked()).toBe(false);
		await userEvent.selectOptions(view.requireTask(), "clear");
		expect(isBlocked()).toBe(false);
		expect(await view.clockOut()).toStrictEqual({
			project: { kind: "preserve" },
			workCategory: { kind: "preserve" },
			task: { kind: "clear" },
		});
	});

	it("blocks the clock-out again when the picked task was marked done meanwhile", async () => {
		const onClockOut = vi.fn<(attribution: ClosingAttribution) => void>();
		const { rerender } = render(
			<Closing context={requiring([ALPHA])} onClockOut={onClockOut} />,
		);
		await userEvent.selectOptions(
			screen.getByRole("combobox", { name: "Project" }),
			ALPHA,
		);
		await userEvent.selectOptions(
			screen.getByRole("combobox", { name: "Task" }),
			BUILD,
		);
		expect(isBlocked()).toBe(false);

		const refreshed = requiring([ALPHA]);
		refreshed.projects[0].tasks = [{ id: DESIGN, name: "design" }];
		rerender(<Closing context={refreshed} onClockOut={onClockOut} />);

		expect(isBlocked()).toBe(true);
	});

	it("says a task is required in German", async () => {
		render(
			<LocaleProvider language="de">
				<Closing context={requiring([ALPHA])} onClockOut={vi.fn()} />
			</LocaleProvider>,
		);
		await userEvent.selectOptions(
			screen.getByRole("combobox", { name: "Projekt" }),
			ALPHA,
		);
		expect(
			optionLabels(screen.getByRole("combobox", { name: "Aufgabe" }))[0],
		).toBe("Aufgabe erforderlich");
		expect(
			screen.getByText("Wählen Sie eine Aufgabe, um auszustempeln."),
		).toBeDefined();
	});
});
