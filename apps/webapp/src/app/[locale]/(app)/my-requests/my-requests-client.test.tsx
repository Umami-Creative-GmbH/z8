/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SelfServiceRequestResult } from "@/lib/self-service-requests/types";

const cancelMyAbsenceRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("next-intl", () => ({
	useLocale: () => "de",
}));

vi.mock("@tabler/icons-react", () => ({
	IconAlertTriangle: () => <span aria-hidden="true" />,
	IconCheck: () => <span aria-hidden="true" />,
	IconClock: () => <span aria-hidden="true" />,
	IconFileDescription: () => <span aria-hidden="true" />,
}));

vi.mock("./actions", () => ({
	cancelMyAbsenceRequest: cancelMyAbsenceRequestMock,
}));

import { MyRequestsClient } from "./my-requests-client";

function createResult(overrides: Partial<SelfServiceRequestResult> = {}): SelfServiceRequestResult {
	return {
		counts: { pending: 1, requiredFixes: 1, recentDecisions: 1, total: 3 },
		sourceErrors: [],
		items: [
			{
				id: "absence-1",
				sourceType: "absence",
				sourceId: "absence-1",
				organizationId: "org-1",
				employeeId: "employee-1",
				status: "rejected",
				submittedAt: new Date("2026-04-18T09:00:00.000Z"),
				resolvedAt: new Date("2026-04-22T10:00:00.000Z"),
				title: "Vacation",
				subtitle: "2026-04-20 - 2026-04-21",
				decisionReason: "Coverage needed",
				availableActions: ["view", "fix"],
				sourceHref: "/absences",
			},
			{
				id: "time-1",
				sourceType: "time_correction",
				sourceId: "period-1",
				organizationId: "org-1",
				employeeId: "employee-1",
				status: "pending",
				submittedAt: new Date("2026-04-25T08:00:00.000Z"),
				resolvedAt: null,
				title: "Time correction",
				subtitle: "Correction request for a work period",
				decisionReason: null,
				availableActions: ["view"],
				sourceHref: "/time-tracking",
			},
			{
				id: "claim-1",
				sourceType: "travel_expense",
				sourceId: "claim-1",
				organizationId: "org-1",
				employeeId: "employee-1",
				status: "approved",
				submittedAt: new Date("2026-04-16T08:00:00.000Z"),
				resolvedAt: new Date("2026-04-17T08:00:00.000Z"),
				title: "Travel expense",
				subtitle: "42.50 EUR",
				decisionReason: null,
				availableActions: ["view"],
				sourceHref: "/travel-expenses",
			},
		],
		...overrides,
	};
}

describe("MyRequestsClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		cancelMyAbsenceRequestMock.mockResolvedValue({ success: true });
		vi.spyOn(window, "confirm").mockReturnValue(true);
	});

	it("renders summary cards, needs-attention items, and unified rows", () => {
		render(<MyRequestsClient initialResult={createResult()} />);

		expect(screen.getByRole("heading", { name: "My Requests" })).toBeTruthy();
		expect(screen.getByText("Pending")).toBeTruthy();
		expect(screen.getByText("Required fixes")).toBeTruthy();
		expect(screen.getByText("Coverage needed")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Fix" }).getAttribute("href")).toBe("/absences");
		expect(screen.getByText("Time correction request")).toBeTruthy();
		expect(screen.getByText("Travel expense claim")).toBeTruthy();
	});

	it("formats request dates with the active locale", () => {
		render(<MyRequestsClient initialResult={createResult()} />);

		expect(screen.getByText("18. Apr. 2026")).toBeTruthy();
	});

	it("filters by status", () => {
		render(<MyRequestsClient initialResult={createResult()} />);

		fireEvent.change(screen.getByLabelText("Status"), { target: { value: "pending" } });

		expect(screen.getByText("Time correction request")).toBeTruthy();
		expect(screen.queryByText("Vacation")).toBeNull();
	});

	it("shows source error notices", () => {
		render(
			<MyRequestsClient
				initialResult={createResult({
					sourceErrors: [
						{
							sourceType: "travel_expense",
							message: "Travel expense requests could not be loaded.",
						},
					],
				})}
			/>,
		);

		expect(screen.getByText("Some requests could not be loaded.")).toBeTruthy();
		expect(screen.getByText("Travel expense requests could not be loaded.")).toBeTruthy();
	});

	it("distinguishes empty and filtered-empty states", () => {
		const { rerender } = render(
			<MyRequestsClient
				initialResult={createResult({
					items: [],
					counts: { pending: 0, requiredFixes: 0, recentDecisions: 0, total: 0 },
				})}
			/>,
		);
		expect(screen.getByText("No requests yet")).toBeTruthy();

		rerender(<MyRequestsClient initialResult={createResult()} />);
		fireEvent.change(screen.getByLabelText("Search"), {
			target: { value: "does-not-match" },
		});
		expect(screen.getByText("No requests match your filters")).toBeTruthy();
	});

	it("does not render unsupported actions", () => {
		render(<MyRequestsClient initialResult={createResult()} />);

		const timeRow = screen.getByRole("row", { name: /Time correction request/ });
		expect(within(timeRow).queryByRole("link", { name: "Fix" })).toBeNull();
	});

	it("renders cancel for pending absence requests only", async () => {
		render(
			<MyRequestsClient
				initialResult={createResult({
					items: [
						{
							id: "absence-pending",
							sourceType: "absence",
							sourceId: "absence-pending",
							organizationId: "org-1",
							employeeId: "employee-1",
							status: "pending",
							submittedAt: new Date("2026-04-25T08:00:00.000Z"),
							resolvedAt: null,
							title: "Pending vacation",
							subtitle: "2026-05-01 - 2026-05-02",
							decisionReason: null,
							availableActions: ["view", "cancel"],
							sourceHref: "/absences",
						},
						{
							id: "time-1",
							sourceType: "time_correction",
							sourceId: "period-1",
							organizationId: "org-1",
							employeeId: "employee-1",
							status: "pending",
							submittedAt: new Date("2026-04-25T08:00:00.000Z"),
							resolvedAt: null,
							title: "Time correction",
							subtitle: "Correction request for a work period",
							decisionReason: null,
							availableActions: ["view"],
							sourceHref: "/time-tracking",
						},
					],
				})}
			/>,
		);

		const absenceRow = screen.getByRole("row", { name: /Pending vacation/ });
		fireEvent.click(within(absenceRow).getByRole("button", { name: "Cancel" }));

		expect(window.confirm).toHaveBeenCalledWith("Cancel this absence request?");
		await waitFor(() => {
			expect(cancelMyAbsenceRequestMock).toHaveBeenCalledWith("absence-pending");
		});
		const timeRow = screen.getByRole("row", { name: /Time correction request/ });
		expect(within(timeRow).queryByRole("button", { name: "Cancel" })).toBeNull();
	});

	it("does not cancel when confirmation is declined", () => {
		vi.mocked(window.confirm).mockReturnValue(false);
		render(
			<MyRequestsClient
				initialResult={createResult({
					items: [
						{
							id: "absence-pending",
							sourceType: "absence",
							sourceId: "absence-pending",
							organizationId: "org-1",
							employeeId: "employee-1",
							status: "pending",
							submittedAt: new Date("2026-04-25T08:00:00.000Z"),
							resolvedAt: null,
							title: "Pending vacation",
							subtitle: "2026-05-01 - 2026-05-02",
							decisionReason: null,
							availableActions: ["view", "cancel"],
							sourceHref: "/absences",
						},
					],
				})}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		expect(window.confirm).toHaveBeenCalledWith("Cancel this absence request?");
		expect(cancelMyAbsenceRequestMock).not.toHaveBeenCalled();
	});

	it("shows cancellation errors returned by the action", async () => {
		cancelMyAbsenceRequestMock.mockResolvedValue({ success: false, error: "Cannot cancel" });
		render(
			<MyRequestsClient
				initialResult={createResult({
					items: [
						{
							id: "absence-pending",
							sourceType: "absence",
							sourceId: "absence-pending",
							organizationId: "org-1",
							employeeId: "employee-1",
							status: "pending",
							submittedAt: new Date("2026-04-25T08:00:00.000Z"),
							resolvedAt: null,
							title: "Pending vacation",
							subtitle: "2026-05-01 - 2026-05-02",
							decisionReason: null,
							availableActions: ["view", "cancel"],
							sourceHref: "/absences",
						},
					],
				})}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		expect((await screen.findByRole("alert")).textContent).toContain("Cannot cancel");
	});
});
