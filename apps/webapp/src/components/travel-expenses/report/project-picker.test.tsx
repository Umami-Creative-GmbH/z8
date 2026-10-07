/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
	getReportProjectChoicesAction: vi.fn(),
	saveItemProjectAction: vi.fn(),
	saveTripProjectAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-project-actions", () => actions);
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
	}),
}));
// A native select stands in for the popover select, so the test drives the field, not the widget.
vi.mock("@/components/ui/select", () => ({
	Select: ({
		value,
		onValueChange,
		disabled,
		children,
	}: {
		value: string;
		onValueChange: (value: string) => void;
		disabled?: boolean;
		children: ReactNode;
	}) => (
		<select
			aria-label="Project"
			data-value={value}
			value={value}
			disabled={disabled}
			onChange={(event) => onValueChange(event.target.value)}
		>
			{children}
		</select>
	),
	SelectTrigger: () => null,
	SelectValue: () => null,
	SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
	SelectItem: ({
		value,
		disabled,
		children,
	}: {
		value: string;
		disabled?: boolean;
		children: ReactNode;
	}) => (
		<option value={value} disabled={disabled}>
			{children}
		</option>
	),
}));

import { ItemProjectField } from "./project-picker";

const reportId = "6a000000-0000-4000-8000-000000000001";
const itemId = "6a000000-0000-4000-8000-000000000002";
const projectA = "6a000000-0000-4000-8000-0000000000a1";
const projectB = "6a000000-0000-4000-8000-0000000000b1";

function choices(selected: { id: string; name: string; eligible: boolean } | null = null) {
	return {
		success: true,
		data: {
			timeZone: "Europe/Berlin",
			choices: [
				{
					id: projectA,
					name: "Hamburg rollout",
					customerName: "Hanse AG",
					status: "completed",
					basis: "employee_assignment",
				},
				{
					id: projectB,
					name: "Legacy migration",
					customerName: null,
					status: "active",
					basis: "exception",
				},
			],
			selected,
		},
	};
}

function renderField(overrides: Partial<Parameters<typeof ItemProjectField>[0]> = {}) {
	const saver = {
		runExclusive: vi.fn(async (write: (version: number) => Promise<unknown>) => write(7)),
	};
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<ItemProjectField
				reportId={reportId}
				itemId={itemId}
				isTrip
				expenseDate="2026-09-14"
				initialChoice={{ mode: "inherit" }}
				tripProjectId={null}
				saver={saver as never}
				{...overrides}
			/>
		</QueryClientProvider>,
	);
	return { saver };
}

describe("ItemProjectField", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("offers the projects proven for the expense date, closed and excepted ones included", async () => {
		actions.getReportProjectChoicesAction.mockResolvedValue(choices());
		renderField();
		await screen.findByRole("option", { name: "Hamburg rollout · Hanse AG" });
		expect(
			screen.getByRole("option", { name: "Legacy migration · authorized exception" }),
		).toBeTruthy();
		expect(actions.getReportProjectChoicesAction).toHaveBeenCalledWith({
			reportId,
			from: "2026-09-14",
			to: "2026-09-14",
			selectedProjectId: null,
		});
	});

	it("shows a standalone expense without its own project as having none (#617)", async () => {
		actions.getReportProjectChoicesAction.mockResolvedValue(choices());
		renderField({ isTrip: false });
		await screen.findByRole("option", { name: "Hamburg rollout · Hanse AG" });
		// Without a trip there is nothing to inherit: the shown value must be a listed option.
		const select = screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement;
		expect(select.dataset.value).toBe("none");
		expect(select.selectedOptions[0]?.textContent).toBe("No project");
	});

	it("asks for the date before offering projects", () => {
		renderField({ expenseDate: null });
		expect(screen.getByText(/Enter the receipt date/)).toBeTruthy();
		expect(actions.getReportProjectChoicesAction).not.toHaveBeenCalled();
	});

	it("saves a chosen project through the draft saver on its confirmed version", async () => {
		actions.getReportProjectChoicesAction.mockResolvedValue(choices());
		actions.saveItemProjectAction.mockResolvedValue({
			success: true,
			data: { status: "saved", version: 8 },
		});
		const { saver } = renderField();
		await screen.findByRole("option", { name: "Hamburg rollout · Hanse AG" });
		fireEvent.change(screen.getByLabelText("Project"), {
			target: { value: `project:${projectA}` },
		});
		await waitFor(() => expect(actions.saveItemProjectAction).toHaveBeenCalled());
		expect(saver.runExclusive).toHaveBeenCalledTimes(1);
		expect(actions.saveItemProjectAction).toHaveBeenCalledWith({
			reportId,
			itemId,
			expectedVersion: 7,
			choice: { mode: "project", projectId: projectA },
		});
	});

	it("explains a refused project and keeps the previous choice", async () => {
		actions.getReportProjectChoicesAction.mockResolvedValue(choices());
		actions.saveItemProjectAction.mockResolvedValue({
			success: true,
			data: { status: "refused", reason: "ineligible" },
		});
		renderField();
		await screen.findByRole("option", { name: "Hamburg rollout · Hanse AG" });
		fireEvent.change(screen.getByLabelText("Project"), {
			target: { value: `project:${projectA}` },
		});
		expect(await screen.findByText(/not assigned to this project on that date/)).toBeTruthy();
		expect((screen.getByLabelText("Project") as HTMLSelectElement).value).toBe("inherit");
	});

	it("warns when the saved project is not proven on the current date", async () => {
		actions.getReportProjectChoicesAction.mockResolvedValue(
			choices({ id: "6a000000-0000-4000-8000-0000000000c1", name: "Old project", eligible: false }),
		);
		renderField({
			initialChoice: { mode: "project", projectId: "6a000000-0000-4000-8000-0000000000c1" },
		});
		expect(await screen.findByText(/Old project cannot be used on this date/)).toBeTruthy();
	});
});
