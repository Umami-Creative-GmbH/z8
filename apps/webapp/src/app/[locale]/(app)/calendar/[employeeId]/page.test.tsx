/* @vitest-environment jsdom */

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../page", () => ({
	CalendarPageContent: ({
		requestedDate,
		selectedEmployeeId,
	}: {
		requestedDate?: string;
		selectedEmployeeId: string;
	}) => (
		<div
			data-testid="calendar-page-content"
			data-requested-date={requestedDate}
			data-selected-employee-id={selectedEmployeeId}
		/>
	),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string) =>
			key === "common:loading.calendar" ? "Kalender wird geladen" : fallback,
	}),
}));

const { default: CalendarEmployeePage } = await import("./page");

describe("CalendarEmployeePage", () => {
	it("renders the calendar shell before URL data resolves", async () => {
		const pending = new Promise<never>(() => {});

		await act(async () => {
			render(<CalendarEmployeePage params={pending} searchParams={pending} />);
		});

		expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
		expect(screen.getByText("Kalender wird geladen")).toBeTruthy();
	});

	it("passes the raw requested date to the authorized employee calendar content", async () => {
		const page = CalendarEmployeePage({
			params: Promise.resolve({ employeeId: "employee-1" }),
			searchParams: Promise.resolve({ date: "06/12/2026" }),
		});
		const content = await page.props.children.type(page.props.children.props);

		expect(content.props).toMatchObject({
			selectedEmployeeId: "employee-1",
			requestedDate: "06/12/2026",
		});
	});
});
