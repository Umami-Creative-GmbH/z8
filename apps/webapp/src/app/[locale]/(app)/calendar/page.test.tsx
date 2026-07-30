import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	connection: vi.fn(),
	getAuthContext: vi.fn(),
	resolveAuthorizedCalendarEmployeeContext: vi.fn(),
}));

vi.mock("next/server", () => ({ connection: mockState.connection }));
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: mockState.getAuthContext,
}));
vi.mock("@/lib/calendar/calendar-employee-context", () => ({
	resolveAuthorizedCalendarEmployeeContext:
		mockState.resolveAuthorizedCalendarEmployeeContext,
}));
vi.mock("@/components/calendar/calendar-view", () => ({
	CalendarView: "CalendarView",
}));
vi.mock("@/components/errors/no-employee-error", () => ({
	NoEmployeeError: "NoEmployeeError",
}));

const { CalendarPageContent } = await import("./page");

describe("CalendarPageContent initial date", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getAuthContext.mockResolvedValue({
			user: { id: "user-1", role: "user" },
			employee: { id: "employee-current", organizationId: "org-1" },
		});
		mockState.resolveAuthorizedCalendarEmployeeContext.mockResolvedValue({
			employeeId: "employee-selected",
			timezone: "America/New_York",
			initialDateKey: "2026-06-01",
		});
	});

	it("uses a valid requested date after employee authorization", async () => {
		const page = await CalendarPageContent({
			selectedEmployeeId: "employee-selected",
			requestedDate: "2026-06-12",
		});

		expect(
			mockState.resolveAuthorizedCalendarEmployeeContext,
		).toHaveBeenCalledTimes(1);
		expect(page.props.initialDateKey).toBe("2026-06-12");
	});

	it("renders with the employee-local fallback for an invalid requested date", async () => {
		const page = await CalendarPageContent({
			selectedEmployeeId: "employee-selected",
			requestedDate: "2026-02-30",
		});

		expect(page.props.initialDateKey).toBe("2026-06-01");
	});

	it("does not apply a requested date when employee authorization fails", async () => {
		mockState.resolveAuthorizedCalendarEmployeeContext.mockResolvedValue(null);

		const page = await CalendarPageContent({
			selectedEmployeeId: "employee-unauthorized",
			requestedDate: "2026-06-12",
		});

		expect(page.type).toBe("div");
		expect(page.props.children.type).toBe("NoEmployeeError");
	});
});
