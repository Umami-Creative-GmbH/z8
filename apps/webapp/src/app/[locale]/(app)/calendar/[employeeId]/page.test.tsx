import { describe, expect, it, vi } from "vitest";

vi.mock("../page", () => ({ CalendarPageContent: "CalendarPageContent" }));

const { default: CalendarEmployeePage } = await import("./page");

describe("CalendarEmployeePage", () => {
	it("passes the raw requested date to the authorized employee calendar content", async () => {
		const page = await CalendarEmployeePage({
			params: Promise.resolve({ employeeId: "employee-1" }),
			searchParams: Promise.resolve({ date: "06/12/2026" }),
		});

		expect(page.props.children.props).toMatchObject({
			selectedEmployeeId: "employee-1",
			requestedDate: "06/12/2026",
		});
	});
});
