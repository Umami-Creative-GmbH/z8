/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TFnType } from "@tolgee/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkPeriodMileageAction } from "./work-period-mileage-action";

const { getMileage, addMileage, push, toastError } = vi.hoisted(() => ({
	getMileage: vi.fn(),
	addMileage: vi.fn(),
	push: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/travel-expenses/work-period-mileage-actions", () => ({
	getWorkPeriodMileageAction: getMileage,
	addWorkPeriodMileageAction: addMileage,
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ push }),
	Link: ({ href, ...props }: ComponentProps<"a">) => <a href={String(href)} {...props} />,
}));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

const t = ((_key: string, fallback: string, params?: Record<string, unknown>) =>
	fallback.replace(/\{(\w+)\}/g, (_match, name: string) =>
		String(params?.[name] ?? ""),
	)) as unknown as TFnType;

const workPeriodId = "4a1ab5ee-67f8-4b52-bd33-a1fb0dc59a2e";
const tripId = "8f0c3b7e-2f7b-4f53-9d55-0a4c5d1e2f30";

function renderAction() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={queryClient}>
			<WorkPeriodMileageAction workPeriodId={workPeriodId} locale="en-US" t={t} />
		</QueryClientProvider>,
	);
}

describe("WorkPeriodMileageAction (#1131)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows nothing for work that cannot be added", async () => {
		getMileage.mockResolvedValue({ success: true, data: { status: "unavailable" } });
		renderAction();
		await waitFor(() => expect(getMileage).toHaveBeenCalledWith(workPeriodId));
		expect(screen.queryByRole("button", { name: "Add to expense report" })).toBeNull();
	});

	it("adds the work's distance to a chosen draft trip and opens the report for the route", async () => {
		getMileage.mockResolvedValue({
			success: true,
			data: {
				status: "available",
				expenseDate: "2026-09-15",
				distanceKm: 61,
				trips: [{ id: tripId, purpose: "Customer workshop", startDate: null, endDate: null }],
			},
		});
		addMileage.mockResolvedValue({
			success: true,
			data: { status: "added", reportId: tripId, itemId: "item" },
		});
		renderAction();

		fireEvent.click(await screen.findByRole("button", { name: "Add to expense report" }));
		expect(screen.getByRole("radio", { name: "New mileage report" })).toBeTruthy();
		fireEvent.click(screen.getByRole("radio", { name: "Customer workshop" }));
		fireEvent.click(screen.getByRole("button", { name: "Add 61 km" }));

		await waitFor(() =>
			expect(addMileage).toHaveBeenCalledWith({ workPeriodId, reportId: tripId }),
		);
		expect(push).toHaveBeenCalledWith(`/travel-expenses/reports/${tripId}`);
	});

	it("creates a new standalone mileage report by default", async () => {
		getMileage.mockResolvedValue({
			success: true,
			data: { status: "available", expenseDate: "2026-09-15", distanceKm: 61, trips: [] },
		});
		addMileage.mockResolvedValue({
			success: true,
			data: { status: "added", reportId: "new-report", itemId: "item" },
		});
		renderAction();

		fireEvent.click(await screen.findByRole("button", { name: "Add to expense report" }));
		fireEvent.click(screen.getByRole("button", { name: "Add 61 km" }));

		await waitFor(() => expect(addMileage).toHaveBeenCalledWith({ workPeriodId, reportId: null }));
		expect(push).toHaveBeenCalledWith("/travel-expenses/reports/new-report");
	});

	it("says when another request added the distance first", async () => {
		getMileage.mockResolvedValue({
			success: true,
			data: { status: "available", expenseDate: "2026-09-15", distanceKm: 61, trips: [] },
		});
		addMileage.mockResolvedValue({
			success: true,
			data: { status: "already_added", reportId: "other-report" },
		});
		renderAction();

		fireEvent.click(await screen.findByRole("button", { name: "Add to expense report" }));
		fireEvent.click(screen.getByRole("button", { name: "Add 61 km" }));

		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith(
				"This work's distance is already in an expense report.",
			),
		);
		expect(push).not.toHaveBeenCalled();
	});

	it("links to the expense report instead of offering the action once added", async () => {
		getMileage.mockResolvedValue({
			success: true,
			data: { status: "added", reportId: tripId },
		});
		renderAction();

		const link = await screen.findByRole("link", { name: "In an expense report" });
		expect(link.getAttribute("href")).toBe(`/travel-expenses/reports/${tripId}`);
		expect(screen.queryByRole("button", { name: "Add to expense report" })).toBeNull();
	});
});
