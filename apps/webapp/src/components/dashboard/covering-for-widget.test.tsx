/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoverDuties } from "@/lib/absences/cover-duties";

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
vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({
		userId: "user-a",
		organizationId: "org-a",
		role: "manager",
		isLoading: false,
	}),
}));
vi.mock("./widget-card", () => ({
	WidgetCard: ({ children, title }: { children: ReactNode; title: string }) => (
		<section aria-label={title}>{children}</section>
	),
}));

import type { DashboardWidgetData } from "./dashboard-types";

let delivered: { data: DashboardWidgetData["covering-for"] | null; loading?: boolean };
function setDelivery(value: typeof delivered) {
	delivered = value;
}
function initialDelivery() {
	return {
		scope: { userId: "user-a", organizationId: "org-a" },
		updatedAt: Date.now(),
		result:
			delivered.data === null
				? { success: false as const, error: "Fixture unavailable" }
				: { success: true as const, data: delivered.data },
	};
}

import { CoveringForWidget } from "./covering-for-widget";

function showDuties(data: CoverDuties | null, loading = false) {
	setDelivery({ data: data ? { ...data, viewerRole: "manager" } : null, loading });
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

		render(
			<QueryClientProvider client={new QueryClient()}>
				<CoveringForWidget initialSnapshot={initialDelivery()} />
			</QueryClientProvider>,
		);

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

		const { container } = render(
			<QueryClientProvider client={new QueryClient()}>
				<CoveringForWidget initialSnapshot={initialDelivery()} />
			</QueryClientProvider>,
		);

		expect(container.textContent).toBe("");
	});

	it("exposes a failed cover read with a local retry", () => {
		showDuties(null);

		render(
			<QueryClientProvider client={new QueryClient()}>
				<CoveringForWidget initialSnapshot={initialDelivery()} />
			</QueryClientProvider>,
		);

		expect(screen.getByRole("alert")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry Covering for" })).toBeTruthy();
	});
});
