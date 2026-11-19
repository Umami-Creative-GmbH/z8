/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CalendarFilters } from "@/hooks/use-calendar-data";
import { CalendarControls } from "./calendar-controls";
import { CalendarPageHeader } from "./calendar-page-header";

const readers = vi.hoisted(() => ({ history: vi.fn() }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("@/components/providers/user-preferences-provider", () => ({
	useUserTimezone: () => "Europe/Berlin",
	useTimeFormat: () => "24h",
}));
vi.mock("@/app/[locale]/(app)/settings/employees/work-balance-actions", () => ({
	getEmployeeWorkBalanceSectionAction: readers.history,
	cancelBalanceAdjustmentAction: vi.fn(),
	recordOvertimePayoutAction: vi.fn(),
	setOpeningBalanceAction: vi.fn(),
}));
function Controls() {
	const [filters, setFilters] = useState<CalendarFilters>({
		showHolidays: true,
		showAbsences: true,
		showTimeEntries: false,
		showWorkPeriods: true,
	});
	return (
		<CalendarControls
			filters={filters}
			onFiltersChange={setFilters}
			workBalance={{
				employeeId: "employee-selected",
				organizationId: "org-1",
				actualMinutes: 540,
				requiredMinutes: 480,
				adjustmentMinutes: 0,
				balanceMinutes: 60,
				computedFromDate: "2026-01-01",
				computedThroughDate: "2026-05-01",
				computedAt: new Date("2026-05-02T00:00:00Z"),
			}}
		/>
	);
}
describe("Calendar supporting controls", () => {
	it("exposes real switches in the phone sheet and keeps their selection on reopen", async () => {
		render(<Controls />);
		fireEvent.click(screen.getByRole("button", { name: "Filters & Legend" }));
		const sheet = within(
			screen.getByRole("dialog", { name: "Filters & Legend" }),
		);
		expect(sheet.getAllByRole("switch")).toHaveLength(4);
		fireEvent.click(sheet.getByRole("switch", { name: "Time Entries" }));
		expect(
			sheet
				.getByRole("switch", { name: "Time Entries" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(sheet.getByText("Pending Approval")).toBeTruthy();
		fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		fireEvent.click(screen.getByRole("button", { name: "Filters & Legend" }));
		expect(
			within(screen.getByRole("dialog"))
				.getByRole("switch", { name: "Time Entries" })
				.getAttribute("aria-checked"),
		).toBe("true");
	});
	it("opens one adjustment history for the returned balance employee", async () => {
		readers.history.mockResolvedValue({
			success: true,
			data: { adjustments: [] },
		});
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<Controls />
			</QueryClientProvider>,
		);
		expect(
			screen.getAllByRole("button", { name: "Balance adjustments" }),
		).toHaveLength(1);
		fireEvent.click(
			screen.getByRole("button", { name: "Balance adjustments" }),
		);
		expect(
			await screen.findByRole("dialog", { name: "Balance adjustments" }),
		).toBeTruthy();
		await waitFor(() =>
			expect(readers.history).toHaveBeenCalledWith({
				employeeId: "employee-selected",
			}),
		);
		expect(await screen.findByText("No balance adjustments yet.")).toBeTruthy();
		client.clear();
	});
	it("owns exactly one named page title before asynchronous records arrive", () => {
		render(<CalendarPageHeader />);
		expect(
			screen.getAllByRole("heading", { level: 1, name: "Calendar" }),
		).toHaveLength(1);
	});
});
