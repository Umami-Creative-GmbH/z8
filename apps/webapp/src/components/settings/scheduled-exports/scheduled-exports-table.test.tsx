/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledExportSummary } from "@/app/[locale]/(app)/settings/scheduled-exports/actions";
import { ScheduledExportsTable } from "./scheduled-exports-table";

const actions = vi.hoisted(() => ({ list: vi.fn(), toggle: vi.fn(), error: vi.fn() }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { error: actions.error } }));
vi.mock("@/app/[locale]/(app)/settings/scheduled-exports/actions", () => ({
	getScheduledExportsAction: actions.list,
	toggleScheduledExportAction: actions.toggle,
}));

const schedule: ScheduledExportSummary = {
	id: "schedule-one",
	name: "Monthly payroll",
	description: null,
	scheduleType: "monthly",
	cronExpression: null,
	timezone: "Europe/Berlin",
	reportType: "payroll_export",
	deliveryMethod: "s3_only",
	dateRangeStrategy: "previous_month",
	isActive: true,
	lastExecutionAt: null,
	nextExecutionAt: null,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	ownerId: "owner-one",
	ownerName: "Owner",
	ownerEligible: true,
};

function table(currentUserId: string, initialSchedules = [schedule]) {
	return (
		<ScheduledExportsTable
			organizationId="org-one"
			currentUserId={currentUserId}
			initialSchedules={initialSchedules}
			initialFilterOptions={null}
			initialPayrollConfigs={[]}
		/>
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	actions.list.mockResolvedValue({ success: true, data: [schedule] });
});

describe("Scheduled exports query ownership", () => {
	it("rolls an optimistic toggle back after the server refuses it", async () => {
		let refuse!: (value: { success: false; error: string }) => void;
		actions.toggle.mockImplementation(
			() =>
				new Promise((resolve) => {
					refuse = resolve;
				}),
		);
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(<QueryClientProvider client={client}>{table("actor-one")}</QueryClientProvider>);
		await waitFor(() => expect(actions.list).toHaveBeenCalledTimes(1));
		const toggle = screen.getByRole("switch");
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(toggle);
		await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
		await act(async () => refuse({ success: false, error: "Owner is no longer eligible" }));
		await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
		expect(actions.error).toHaveBeenCalled();
	});

	it("does not reuse a different actor's schedule snapshot", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const view = render(
			<QueryClientProvider client={client}>{table("actor-one")}</QueryClientProvider>,
		);
		await screen.findByText("Monthly payroll");
		await waitFor(() => expect(actions.list).toHaveBeenCalledTimes(1));
		actions.list.mockImplementation(() => new Promise(() => {}));
		view.rerender(
			<QueryClientProvider client={client}>{table("actor-two", [])}</QueryClientProvider>,
		);
		expect(screen.queryByText("Monthly payroll")).toBeNull();
	});
});
