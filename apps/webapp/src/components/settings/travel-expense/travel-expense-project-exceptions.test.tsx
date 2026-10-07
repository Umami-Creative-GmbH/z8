/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
	getProjectAttributionExceptionSettings: vi.fn(),
	authorizeProjectAttributionExceptionAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/travel-expenses/project-exception-actions", () => actions);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({
		id,
		name,
		value,
		onChange,
	}: {
		id?: string;
		name: string;
		value: string;
		onChange: (value: string) => void;
	}) => <input id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)} />,
}));

import { TravelExpenseProjectExceptionsCard } from "./travel-expense-project-exceptions";

const dateOrder = "The last day cannot be before the first.";
const reasonError = "Explain why the employee could use the project then.";

function mount() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<TravelExpenseProjectExceptionsCard />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	actions.getProjectAttributionExceptionSettings.mockResolvedValue({
		success: true,
		data: {
			exceptions: [],
			employees: [{ id: "employee-1", name: "Robin" }],
			projects: [{ id: "project-1", name: "Atlas", status: "active" }],
		},
	});
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("project attribution exception form (#688)", () => {
	it("shows the errors on submit and clears each once its value is valid", async () => {
		mount();
		fireEvent.click(await screen.findByRole("button", { name: "Authorize exception" }));
		expect(await screen.findAllByText("Choose an employee.")).toHaveLength(1);
		expect(screen.getAllByText("Choose a project.")).toHaveLength(1);
		expect(screen.getAllByText(reasonError)).toHaveLength(1);
		expect(actions.authorizeProjectAttributionExceptionAction).not.toHaveBeenCalled();

		fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Staffed by plan" } });
		expect(screen.queryByText(reasonError)).toBeNull();
		expect(screen.getByText("Choose an employee.")).toBeTruthy();
	});

	it("re-checks the last day when the first day changes, once the last day was entered", async () => {
		mount();
		const first = await screen.findByLabelText("First expense date covered");
		fireEvent.change(first, { target: { value: "2025-03-10" } });
		// The last day was not entered yet, so it shows no error.
		expect(screen.queryByText("Enter a valid date.")).toBeNull();

		fireEvent.change(screen.getByLabelText("Last expense date covered"), {
			target: { value: "2025-03-01" },
		});
		expect(screen.getAllByText(dateOrder)).toHaveLength(1);
		fireEvent.change(first, { target: { value: "2025-02-20" } });
		expect(screen.queryByText(dateOrder)).toBeNull();
	});
});
