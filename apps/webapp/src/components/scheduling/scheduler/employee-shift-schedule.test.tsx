/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act as actPreact } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";
import { queryKeys } from "@/lib/query/keys";
import { EmployeeShiftSchedule } from "./employee-shift-schedule";

const { getShifts } = vi.hoisted(() => ({ getShifts: vi.fn() }));
vi.mock("@/app/[locale]/(app)/scheduling/actions", () => ({
	getShifts,
	getShiftTemplates: vi.fn(),
	getScheduleComplianceSummary: vi.fn(),
	upsertShift: vi.fn(),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

const range = { startDate: "2026-11-16", endDateExclusive: "2026-11-23" };
function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
	render(
		<QueryClientProvider client={client}>
			<UserPreferencesProvider weekStartDay="monday">
				<EmployeeShiftSchedule
					organizationId="org-a"
					employeeId="employee-a"
					organizationTimezone="Europe/Berlin"
					focusDate="2026-11-16"
				/>
			</UserPreferencesProvider>
		</QueryClientProvider>,
	);
	return client;
}

describe("employee schedule recovery", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
		vi.stubGlobal("matchMedia", () => ({
			matches: true,
			addEventListener() {},
			removeEventListener() {},
		}));
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		Element.prototype.scrollIntoView = vi.fn();
	});
	afterEach(async () => {
		actPreact(() => cleanup());
		await new Promise((resolve) => setTimeout(resolve, 50));
	});

	it("offers Retry after a failed read without marking unloaded days free", async () => {
		getShifts.mockResolvedValueOnce({ success: false, error: "Unavailable" });
		mount();
		await screen.findByRole("alert");
		expect(screen.queryByText("No shifts")).toBeNull();
		getShifts.mockResolvedValue({ success: true, data: [] });
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
		expect(screen.getAllByText("No shifts")).toHaveLength(7);
	});

	it("retains loaded shifts when a background refresh fails", async () => {
		getShifts.mockResolvedValue({
			success: true,
			data: [
				{
					id: "shift-a",
					organizationId: "org-a",
					employeeId: "employee-a",
					status: "published",
					date: new Date("2026-11-15T23:00:00Z"),
					startTime: "09:00",
					endTime: "17:00",
					notes: "Reception shift",
					subarea: { name: "Reception", location: { name: "Office" } },
				},
			],
		});
		const client = mount();
		await screen.findByRole("button", { name: /09:00/ });
		getShifts.mockResolvedValue({ success: false, error: "Refresh failed" });
		await act(() => client.invalidateQueries({ queryKey: queryKeys.shifts.list("org-a", range) }));
		await screen.findByRole("alert");
		expect(screen.getByRole("button", { name: /09:00/ })).toBeTruthy();
	});
	it("does not present a planner's cached drafts as the employee's published schedule", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		client.setQueryData(queryKeys.shifts.list("org-a", range), [
			{
				id: "planner-draft",
				organizationId: "org-a",
				employeeId: "other",
				status: "draft",
				date: new Date("2026-11-15T23:00:00Z"),
				startTime: "03:00",
				endTime: "04:00",
			},
		]);
		getShifts.mockImplementation(() => new Promise(() => {}));
		mount(client);
		expect(screen.queryByRole("button", { name: /03:00/ })).toBeNull();
	});
	it("keeps late A data out of B and restores A on A to B to A navigation", async () => {
		const data = [
			{
				id: "shift-a",
				organizationId: "org-a",
				employeeId: "employee-a",
				status: "published",
				date: new Date("2026-11-15T23:00:00Z"),
				startTime: "03:00",
				endTime: "04:00",
			},
		];
		let finishA: (value: unknown) => void = () => {};
		getShifts
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finishA = resolve;
					}),
			)
			.mockResolvedValueOnce({ success: true, data: [] })
			.mockResolvedValue({ success: true, data });
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const draw = (organizationId: string) => (
			<QueryClientProvider client={client}>
				<UserPreferencesProvider weekStartDay="monday">
					<EmployeeShiftSchedule
						key={organizationId}
						organizationId={organizationId}
						employeeId={`employee-${organizationId}`}
						organizationTimezone="Europe/Berlin"
						focusDate="2026-11-16"
					/>
				</UserPreferencesProvider>
			</QueryClientProvider>
		);
		const view = render(draw("org-a"));
		await screen.findByRole("status");
		view.rerender(draw("org-b"));
		await screen.findAllByText("No shifts");
		await act(async () => finishA({ success: true, data }));
		expect(screen.queryByRole("button", { name: /03:00/ })).toBeNull();
		view.rerender(draw("org-a"));
		expect(await screen.findByRole("button", { name: /03:00/ })).toBeTruthy();
	});
});
