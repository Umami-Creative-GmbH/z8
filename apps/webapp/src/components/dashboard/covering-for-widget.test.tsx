/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoverDuties } from "@/lib/absences/cover-duties";

const { useWidgetDataMock } = vi.hoisted(() => ({ useWidgetDataMock: vi.fn() }));

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(message, [key, value]) => message.replace(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));
vi.mock("./cover-duties-actions", () => ({ getCoverDuties: vi.fn() }));
vi.mock("./dashboard-widget", () => ({
	DashboardWidget: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("./use-widget-data", () => ({ useWidgetData: useWidgetDataMock }));
vi.mock("./widget-card", () => ({
	WidgetCard: ({ children, title }: { children: ReactNode; title: string }) => (
		<section aria-label={title}>{children}</section>
	),
}));

import { CoveringForWidget } from "./covering-for-widget";

function showDuties(data: CoverDuties | null, loading = false) {
	useWidgetDataMock.mockReturnValue({ data, loading, refreshing: false, refetch: vi.fn() });
}

describe("CoveringForWidget", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("says whom the deputy covers for now and until when, and who is coming up", () => {
		showDuties({
			running: [
				{
					absenceId: "absence-1",
					employeeId: "employee-1",
					employeeName: "Ada Lovelace",
					startDate: "2026-10-08",
					endDate: "2026-10-16",
					category: null,
				},
			],
			upcoming: [
				{
					absenceId: "absence-2",
					employeeId: "employee-2",
					employeeName: "Alan Turing",
					startDate: "2026-10-20",
					endDate: "2026-10-23",
					category: { name: "Vacation", color: "#22c55e" },
				},
			],
		});

		render(<CoveringForWidget />);

		const card = screen.getByRole("region", { name: "Covering for" });
		expect(card.textContent).toContain("Covering for Ada Lovelace until Oct 16, 2026");
		expect(card.textContent).toContain(
			"Upcoming: covering for Alan Turing from Oct 20, 2026 to Oct 23, 2026",
		);
		// The category shows only where the server sent it.
		expect(screen.getByText("Vacation")).toBeTruthy();
		expect(screen.getAllByText(/Vacation|Sick/)).toHaveLength(1);
	});

	it("shows nothing to an employee who is nobody's deputy", () => {
		showDuties({ running: [], upcoming: [] });

		const { container } = render(<CoveringForWidget />);

		expect(container.textContent).toBe("");
	});

	it("shows nothing when the cover duties could not be loaded", () => {
		showDuties(null);

		const { container } = render(<CoveringForWidget />);

		expect(container.textContent).toBe("");
	});
});
