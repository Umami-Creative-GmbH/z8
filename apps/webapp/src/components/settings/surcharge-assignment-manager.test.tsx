/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query";
import { SurchargeAssignmentManager } from "./surcharge-assignment-manager";

const deleteSurchargeAssignmentMock = vi.fn();
const getSurchargeAssignmentsMock = vi.fn();

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/app/[locale]/(app)/settings/surcharges/actions", () => ({
	deleteSurchargeAssignment: (...args: unknown[]) =>
		deleteSurchargeAssignmentMock(...args),
	getSurchargeAssignments: (...args: unknown[]) =>
		getSurchargeAssignmentsMock(...args),
}));

const assignments = [
	{
		id: "team-2",
		modelId: "model-2",
		assignmentType: "team",
		teamId: "team-b",
		employeeId: null,
		priority: 2,
		effectiveFrom: null,
		effectiveUntil: null,
		isActive: true,
		createdAt: new Date("2026-01-03T00:00:00Z"),
		model: { id: "model-2", name: "Night" },
		team: { id: "team-b", name: "Support" },
		employee: null,
	},
	{
		id: "team-1",
		modelId: "model-1",
		assignmentType: "team",
		teamId: "team-a",
		employeeId: null,
		priority: 1,
		effectiveFrom: null,
		effectiveUntil: null,
		isActive: true,
		createdAt: new Date("2026-01-02T00:00:00Z"),
		model: { id: "model-1", name: "Weekend" },
		team: { id: "team-a", name: "Operations" },
		employee: null,
	},
	{
		id: "employee-1",
		modelId: "model-3",
		assignmentType: "employee",
		teamId: null,
		employeeId: "employee-a",
		priority: 3,
		effectiveFrom: null,
		effectiveUntil: null,
		isActive: true,
		createdAt: new Date("2026-01-04T00:00:00Z"),
		model: { id: "model-3", name: "Holiday" },
		team: null,
		employee: { id: "employee-a", firstName: "Ada", lastName: "Lovelace" },
	},
	{
		id: "inactive",
		modelId: "model-4",
		assignmentType: "employee",
		teamId: null,
		employeeId: "employee-b",
		priority: 4,
		effectiveFrom: null,
		effectiveUntil: null,
		isActive: false,
		createdAt: new Date("2026-01-05T00:00:00Z"),
		model: { id: "model-4", name: "Inactive Model" },
		team: null,
		employee: { id: "employee-b", firstName: "Grace", lastName: "Hopper" },
	},
] as const;

function renderManager() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
	const onAssignClick = vi.fn();
	const view = render(
		<QueryClientProvider client={queryClient}>
			<SurchargeAssignmentManager
				canManage
				onAssignClick={onAssignClick}
				organizationId="org-approved"
			/>
		</QueryClientProvider>,
	);
	return { ...view, invalidateQueries, onAssignClick };
}

describe("SurchargeAssignmentManager", () => {
	beforeEach(() => {
		deleteSurchargeAssignmentMock.mockReset();
		getSurchargeAssignmentsMock.mockReset();
		getSurchargeAssignmentsMock.mockResolvedValue({
			success: true,
			data: assignments,
		});
	});

	it("keeps the server-provided assignment order and filters inactive assignments", async () => {
		const { onAssignClick } = renderManager();

		await screen.findByText("Support");
		expect(getSurchargeAssignmentsMock).toHaveBeenCalledWith("org-approved");
		expect(screen.queryByText("Inactive Model")).toBeNull();
		expect(
			screen
				.getAllByText(/Support|Operations/)
				.map((element) => element.textContent),
		).toEqual(["Support", "Operations"]);

		fireEvent.click(screen.getByRole("button", { name: "Assign to Team" }));
		fireEvent.click(screen.getByRole("button", { name: "Assign to Employee" }));
		expect(onAssignClick.mock.calls).toEqual([["team"], ["employee"]]);
	});

	it("invalidates only the organization assignment list after removal", async () => {
		deleteSurchargeAssignmentMock.mockResolvedValue({
			success: true,
			data: undefined,
		});
		const { container, invalidateQueries } = renderManager();

		await screen.findByText("Support");
		const firstDeleteButton = container.querySelector<HTMLButtonElement>(
			"button.text-muted-foreground.hover\\:text-destructive",
		);
		expect(firstDeleteButton).toBeTruthy();
		fireEvent.click(firstDeleteButton as HTMLButtonElement);
		fireEvent.click(screen.getByRole("button", { name: "Remove" }));

		await waitFor(() =>
			expect(deleteSurchargeAssignmentMock).toHaveBeenCalledWith("team-2"),
		);
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: queryKeys.surcharges.assignments.list("org-approved"),
		});
	});
});
