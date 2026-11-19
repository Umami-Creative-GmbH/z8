/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { getHolidays } from "@/app/[locale]/(app)/settings/holidays/actions";
import { render } from "@/test/render-with-translations";
import { HolidayList } from "./holiday-list";

vi.mock("@/app/[locale]/(app)/settings/holidays/actions", () => ({
	getHolidays: vi.fn(),
	getHolidayCategories: vi.fn().mockResolvedValue({ success: true, data: [] }),
	deleteHoliday: vi.fn(),
	bulkDeleteHolidays: vi.fn(),
}));
afterEach(cleanup);

it("distinguishes a filtered no-match result from the initial add-first-holiday state", async () => {
	const user = userEvent.setup();
	vi.mocked(getHolidays).mockResolvedValue({
		success: true,
		data: { data: [], total: 0, hasMore: false },
	});
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<HolidayList
				organizationId="org-2"
				canManage={false}
				onAddClick={() => {}}
				onEditClick={() => {}}
			/>
		</QueryClientProvider>,
	);
	await screen.findByText(
		"No holidays found. Add your first holiday to get started.",
	);
	await user.type(
		screen.getByRole("textbox", { name: "Search holidays..." }),
		"unmatched",
	);
	await screen.findByText("No results.");
	client.clear();
});

it("keeps usable records and search during a failed refresh, then retries the actual reader", async () => {
	const user = userEvent.setup();
	const loaded = {
		success: true as const,
		data: {
			data: [
				{
					id: "holiday-1",
					name: "Company day",
					description: "Office closure",
					startDate: new Date("2025-12-01T00:00:00Z"),
					endDate: new Date("2025-12-01T00:00:00Z"),
					recurrenceType: "none",
					recurrenceRule: null,
					recurrenceEndDate: null,
					isActive: true,
					categoryId: "category-1",
					category: {
						id: "category-1",
						name: "Public",
						type: "public_holiday",
						color: null,
					},
				},
			],
			total: 1,
			hasMore: false,
		},
	};
	vi.mocked(getHolidays).mockResolvedValue(loaded);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<HolidayList
				organizationId="org-1"
				canManage={false}
				onAddClick={() => {}}
				onEditClick={() => {}}
			/>
		</QueryClientProvider>,
	);
	await screen.findByText("Company day");
	const search = screen.getByRole("textbox", { name: "Search holidays..." });
	await user.type(search, "Company");
	await screen.findByText("Company day");
	vi.mocked(getHolidays).mockRejectedValue(new Error("Network unavailable"));
	await client.invalidateQueries();
	await screen.findByRole("button", { name: "Retry" });
	expect(screen.getByText("Company day")).toBeTruthy();
	expect(screen.getByRole("textbox", { name: "Search holidays..." })).toBe(
		search,
	);
	vi.mocked(getHolidays).mockResolvedValue(loaded);
	await user.click(screen.getByRole("button", { name: "Retry" }));
	await screen.findByText("Company day");
	client.clear();
});
