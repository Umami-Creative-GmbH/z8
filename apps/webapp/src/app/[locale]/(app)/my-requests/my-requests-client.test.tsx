/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SelfServiceRequestResult } from "@/lib/self-service-requests/types";

const cancelMyAbsenceRequestMock = vi.hoisted(() => vi.fn());
const cancelMyTimeCorrectionRequestMock = vi.hoisted(() => vi.fn());
const invalidateReadinessMock = vi.hoisted(() => vi.fn());

// Counts readiness invalidations; still invalidates for real when a query client is provided.
vi.mock("@/lib/query/period-submission-readiness", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/query/period-submission-readiness")>();
	const { QueryClientContext } = await import("@tanstack/react-query");
	const { use } = await import("react");
	return {
		...actual,
		useInvalidatePeriodSubmissionReadiness: () => {
			const client = use(QueryClientContext);
			return () => {
				invalidateReadinessMock();
				return client ? actual.invalidatePeriodSubmissionReadiness(client) : Promise.resolve();
			};
		},
	};
});

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("next-intl", () => ({
	useLocale: () => "de",
}));

vi.mock("@tabler/icons-react", () => ({
	IconAlertTriangle: () => <span aria-hidden="true" />,
	IconCheck: () => <span aria-hidden="true" />,
	IconClock: () => <span aria-hidden="true" />,
	IconFileDescription: () => <span aria-hidden="true" />,
	IconInfoCircle: () => <span aria-hidden="true" />,
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/period-submissions", () => ({
	readPeriodReadiness: vi.fn(),
}));

vi.mock("./actions", () => ({
	cancelMyAbsenceRequest: cancelMyAbsenceRequestMock,
	cancelMyTimeCorrectionRequest: cancelMyTimeCorrectionRequestMock,
}));

import { MyRequestsClient } from "./my-requests-client";

function createResult(
	overrides: Partial<SelfServiceRequestResult> = {},
): SelfServiceRequestResult {
	return {
		counts: { pending: 1, requiredFixes: 1, recentDecisions: 2, total: 3 },
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
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(new Date("2026-04-28T12:00:00.000Z"));
		vi.clearAllMocks();
		cancelMyAbsenceRequestMock.mockResolvedValue({ success: true });
		cancelMyTimeCorrectionRequestMock.mockResolvedValue({ success: true });
		vi.spyOn(window, "confirm").mockReturnValue(true);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("renders requests in prioritized groups and all-request history", () => {
		render(<MyRequestsClient initialResult={createResult()} />);

		expect(screen.getByRole("heading", { name: "My Requests" })).toBeTruthy();
		expect(screen.getByText("Pending")).toBeTruthy();
		expect(screen.getByText("Required fixes")).toBeTruthy();

		const needsAttention = screen.getByRole("region", {
			name: "Needs attention",
		});
		expect(
			within(needsAttention).getByRole("heading", {
				level: 2,
				name: "Needs attention",
			}),
		).toBeTruthy();
		expect(within(needsAttention).getByText("Coverage needed")).toBeTruthy();
		expect(
			within(needsAttention)
				.getByRole("link", { name: "Fix" })
				.getAttribute("href"),
		).toBe("/absences");

		const inReview = screen.getByRole("region", { name: "In review" });
		expect(within(inReview).getByText("Time correction request")).toBeTruthy();

		const recentlyDecided = screen.getByRole("region", {
			name: "Recently decided",
		});
		expect(
			within(recentlyDecided).getByText("Travel expense claim"),
		).toBeTruthy();

		const allRequests = screen.getByRole("region", { name: "All requests" });
		expect(
			within(allRequests).getByText("Time correction request"),
		).toBeTruthy();
		expect(within(allRequests).getByText("Travel expense claim")).toBeTruthy();
	});

	it("formats request dates with the active locale", () => {
		render(<MyRequestsClient initialResult={createResult()} />);

		const needsAttention = screen.getByRole("region", {
			name: "Needs attention",
		});
		const vacationCard = within(needsAttention)
			.getByText("Vacation")
			.closest("article");
		expect(vacationCard).not.toBeNull();
		expect(
			within(vacationCard as HTMLElement).getByText("Submitted: 18. Apr. 2026"),
		).toBeTruthy();
		expect(
			within(vacationCard as HTMLElement).getByText("Decision: 22. Apr. 2026"),
		).toBeTruthy();
	});

	it("applies filters consistently to grouped sections and all-request history", () => {
		render(<MyRequestsClient initialResult={createResult()} />);

		fireEvent.change(screen.getByLabelText("Status"), {
			target: { value: "pending" },
		});

		const inReview = screen.getByRole("region", { name: "In review" });
		expect(within(inReview).getByText("Time correction request")).toBeTruthy();
		expect(
			screen.queryByRole("region", { name: "Needs attention" }),
		).toBeNull();
		expect(
			screen.queryByRole("region", { name: "Recently decided" }),
		).toBeNull();

		const allRequests = screen.getByRole("region", { name: "All requests" });
		expect(
			within(allRequests).getByText("Time correction request"),
		).toBeTruthy();
		expect(within(allRequests).queryByText("Vacation")).toBeNull();
	});

	it("suppresses duplicate cancel actions in all-request history", () => {
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

		const inReview = screen.getByRole("region", { name: "In review" });
		expect(
			within(inReview).getByRole("button", { name: "Cancel" }),
		).toBeTruthy();

		const allRequests = screen.getByRole("region", { name: "All requests" });
		expect(
			within(allRequests).queryByRole("button", { name: "Cancel" }),
		).toBeNull();
		expect(
			within(allRequests).getByRole("link", { name: "View" }),
		).toBeTruthy();
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
		expect(
			screen.getByText("Travel expense requests could not be loaded."),
		).toBeTruthy();
	});

	it("distinguishes empty and filtered-empty states", () => {
		const { rerender } = render(
			<MyRequestsClient
				initialResult={createResult({
					items: [],
					counts: {
						pending: 0,
						requiredFixes: 0,
						recentDecisions: 0,
						total: 0,
					},
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

		const inReview = screen.getByRole("region", { name: "In review" });
		const timeCard = within(inReview)
			.getByText("Time correction request")
			.closest("article");
		expect(timeCard).not.toBeNull();
		expect(
			within(timeCard as HTMLElement).queryByRole("link", { name: "Fix" }),
		).toBeNull();
	});

	it("does not dispatch cancellation for unsupported request source types", () => {
		render(
			<MyRequestsClient
				initialResult={createResult({
					items: [
						{
							...createResult().items[2],
							status: "pending",
							resolvedAt: null,
							availableActions: ["cancel", "view"],
						},
					],
				})}
			/>,
		);

		const inReview = screen.getByRole("region", { name: "In review" });
		expect(
			within(inReview).queryByRole("button", { name: "Cancel" }),
		).toBeNull();
	});

	it("dispatches pending cancellation by source type with neutral copy", async () => {
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
							availableActions: ["view", "cancel"],
							sourceHref: "/time-tracking",
						},
					],
				})}
			/>,
		);

		const inReview = screen.getByRole("region", { name: "In review" });
		const absenceCard = within(inReview)
			.getByText("Pending vacation")
			.closest("article");
		expect(absenceCard).not.toBeNull();
		fireEvent.click(
			within(absenceCard as HTMLElement).getByRole("button", {
				name: "Cancel",
			}),
		);

		expect(window.confirm).toHaveBeenCalledWith("Cancel this request?");
		await waitFor(() => {
			expect(cancelMyAbsenceRequestMock).toHaveBeenCalledWith(
				"absence-pending",
			);
		});
		const timeCard = within(inReview)
			.getByText("Time correction request")
			.closest("article");
		expect(timeCard).not.toBeNull();
		fireEvent.click(
			within(timeCard as HTMLElement).getByRole("button", { name: "Cancel" }),
		);
		await waitFor(() => {
			expect(cancelMyTimeCorrectionRequestMock).toHaveBeenCalledWith(
				"period-1",
			);
		});
		expect(cancelMyAbsenceRequestMock).toHaveBeenCalledOnce();
		// Each cancelled request can reopen a period for submission (#1350).
		await waitFor(() => expect(invalidateReadinessMock).toHaveBeenCalledTimes(2));
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

		expect(window.confirm).toHaveBeenCalledWith("Cancel this request?");
		expect(cancelMyAbsenceRequestMock).not.toHaveBeenCalled();
	});

	describe("focused request from a period blocker", () => {
		const PENDING_ABSENCE = {
			id: "absence:absence-pending",
			sourceType: "absence" as const,
			sourceId: "absence-pending",
			organizationId: "org-1",
			employeeId: "employee-1",
			status: "pending" as const,
			submittedAt: new Date("2026-04-25T08:00:00.000Z"),
			resolvedAt: null,
			title: "Pending vacation",
			subtitle: "2026-05-01 - 2026-05-02",
			decisionReason: null,
			availableActions: ["view" as const, "cancel" as const],
			sourceHref: "/absences",
		};

		function renderFocused(focusRequest: string | undefined, result = createResult()) {
			const client = new QueryClient();
			const invalidate = vi.spyOn(client, "invalidateQueries");
			const view = render(
				<QueryClientProvider client={client}>
					<MyRequestsClient initialResult={result} focusRequest={focusRequest} />
				</QueryClientProvider>,
			);
			const rerender = (next: string | undefined) =>
				view.rerender(
					<QueryClientProvider client={client}>
						<MyRequestsClient initialResult={result} focusRequest={next} />
					</QueryClientProvider>,
				);
			return { invalidate, rerender };
		}

		it("focuses the pending correction in review", async () => {
			const { invalidate } = renderFocused("time_correction:period-1");

			const inReview = screen.getByRole("region", { name: "In review" });
			const card = within(inReview).getByText("Time correction request").closest("article");
			await waitFor(() => expect(document.activeElement).toBe(card));
			expect(screen.queryByRole("status")).toBeNull();
			expect(invalidate).not.toHaveBeenCalled();
		});

		it("focuses the pending absence, with its existing cancel action", async () => {
			renderFocused(
				"absence:absence-pending",
				createResult({ items: [...createResult().items, PENDING_ABSENCE] }),
			);

			const inReview = screen.getByRole("region", { name: "In review" });
			const card = within(inReview).getByText("Pending vacation").closest("article");
			await waitFor(() => expect(document.activeElement).toBe(card));
			expect(within(card as HTMLElement).getByRole("button", { name: "Cancel" })).toBeTruthy();
		});

		it("selects the filters needed to reveal the focused request", async () => {
			const { rerender } = renderFocused(undefined);
			fireEvent.change(screen.getByLabelText("Status"), { target: { value: "rejected" } });
			fireEvent.change(screen.getByLabelText("Type"), { target: { value: "absence" } });
			fireEvent.change(screen.getByLabelText("Search"), { target: { value: "Vacation" } });
			expect(screen.queryByRole("region", { name: "In review" })).toBeNull();

			rerender("time_correction:period-1");

			const inReview = await screen.findByRole("region", { name: "In review" });
			const card = within(inReview).getByText("Time correction request").closest("article");
			await waitFor(() => expect(document.activeElement).toBe(card));
			expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("pending");
			expect((screen.getByLabelText("Type") as HTMLSelectElement).value).toBe("time_correction");
			expect((screen.getByLabelText("Search") as HTMLInputElement).value).toBe("");
		});

		it.each([
			["a request that is no longer pending", "absence:absence-1"],
			["a missing or cancelled request", "absence:absence-gone"],
			["another employee's or organization's request", "time_correction:foreign-period"],
		])("explains %s without disclosing anything and re-checks readiness", async (_name, focus) => {
			const { invalidate } = renderFocused(focus);

			const notice = await screen.findByRole("status");
			expect(notice.textContent).toBe(
				"This request is no longer pending, or it can't be shown here. Period readiness is being checked again.",
			);
			await waitFor(() => expect(document.activeElement).toBe(notice));
			await waitFor(() =>
				expect(invalidate).toHaveBeenCalledWith({ queryKey: ["period-submissions"] }),
			);
			// Only the employee's own list renders, unchanged; no card is focused or marked.
			expect(screen.getAllByRole("article")).toHaveLength(7);
			expect(document.activeElement?.closest("article")).toBeNull();
		});

		it("does not take focus to the notice when the employee cancels the focused request here", async () => {
			const client = new QueryClient();
			const page = (result: SelfServiceRequestResult) => (
				<QueryClientProvider client={client}>
					<MyRequestsClient initialResult={result} focusRequest="absence:absence-pending" />
				</QueryClientProvider>
			);
			const pending = createResult({ items: [...createResult().items, PENDING_ABSENCE] });
			const view = render(page(pending));
			const card = within(screen.getByRole("region", { name: "In review" }))
				.getByText("Pending vacation")
				.closest("article");
			await waitFor(() => expect(document.activeElement).toBe(card));

			// The page refreshes after the cancel: the request is no longer pending.
			view.rerender(
				page(
					createResult({
						items: [
							...createResult().items,
							{
								...PENDING_ABSENCE,
								status: "cancelled" as const,
								availableActions: ["view" as const],
							},
						],
					}),
				),
			);

			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(screen.queryByRole("status")).toBeNull();
		});

		it("ignores a malformed focus value", () => {
			const { invalidate } = renderFocused("absence:<script>");
			expect(screen.queryByRole("status")).toBeNull();
			expect(invalidate).not.toHaveBeenCalled();
		});
	});

	it("shows cancellation errors returned by the action", async () => {
		cancelMyAbsenceRequestMock.mockResolvedValue({
			success: false,
			error: "Cannot cancel",
		});
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

		expect((await screen.findByRole("alert")).textContent).toContain(
			"Cannot cancel",
		);
	});
});
