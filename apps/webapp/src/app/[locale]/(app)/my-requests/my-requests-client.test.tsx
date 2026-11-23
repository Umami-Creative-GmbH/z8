/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SelfServiceRequestResult } from "@/lib/self-service-requests/types";

const cancelMyAbsenceRequestMock = vi.hoisted(() => vi.fn());
const cancelMyTimeCorrectionRequestMock = vi.hoisted(() => vi.fn());
const invalidateReadinessMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: refreshMock }),
}));

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

const catalog = vi.hoisted(() => ({ messages: {} as Record<string, string> }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback?: string, params?: Record<string, unknown>) =>
			(catalog.messages[key] ?? fallback ?? key).replace(/\{(\w+)\}/g, (match, name: string) =>
				params && name in params ? String(params[name]) : match,
			),
	}),
}));

vi.mock("next-intl", () => ({
	useLocale: () => "de",
}));

vi.mock("@tabler/icons-react", () => {
	const Icon = () => <span aria-hidden="true" />;
	return {
		IconAlertTriangle: Icon,
		IconArrowBackUp: Icon,
		IconBan: Icon,
		IconHourglassEmpty: Icon,
		IconShieldCheck: Icon,
		IconCalendarEvent: Icon,
		IconCheck: Icon,
		IconClock: Icon,
		IconClockEdit: Icon,
		IconFileDescription: Icon,
		IconInfoCircle: Icon,
		IconReceipt: Icon,
		IconSearch: Icon,
		IconX: Icon,
	};
});

/** Opens a request's cancel confirmation and answers it. */
async function answerCancel(scope: HTMLElement, answer: "Cancel request" | "Keep request") {
	fireEvent.click(within(scope).getByRole("button", { name: "Cancel request" }));
	const dialog = await screen.findByRole("alertdialog", { name: "Cancel this request?" });
	fireEvent.click(within(dialog).getByRole("button", { name: answer }));
}

vi.mock("@/app/[locale]/(app)/time-tracking/actions/period-submissions", () => ({
	readPeriodReadiness: vi.fn(),
}));

vi.mock("./actions", () => ({
	cancelMyAbsenceRequest: cancelMyAbsenceRequestMock,
	cancelMyTimeCorrectionRequest: cancelMyTimeCorrectionRequestMock,
}));

import englishMyRequests from "../../../../../messages/myRequests/en.json";
import { MyRequestsClient } from "./my-requests-client";

/** The shipped English catalog, keyed as the page asks for it ("myRequests:myRequests.title"). */
function myRequestsCatalog(
	value: unknown = englishMyRequests,
	prefix = "",
): Record<string, string> {
	if (typeof value === "string") return { [`myRequests:${prefix}`]: value };
	return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
		(messages, [key, child]) =>
			Object.assign(messages, myRequestsCatalog(child, prefix ? `${prefix}.${key}` : key)),
		{},
	);
}

type RequestItem = SelfServiceRequestResult["items"][number];

function expenseReport(overrides: Partial<RequestItem> = {}): RequestItem {
	return {
		id: "travel_expense_report:report-1",
		sourceType: "travel_expense_report",
		sourceId: "report-1",
		organizationId: "org-1",
		employeeId: "employee-1",
		status: "pending",
		submittedAt: new Date("2026-04-23T08:00:00.000Z"),
		resolvedAt: null,
		title: "travel_expense_report",
		subtitle: "Customer workshop · 2026-04-20 to 2026-04-22",
		decisionReason: null,
		availableActions: ["view"],
		sourceHref: "/travel-expenses/reports/report-1",
		...overrides,
	};
}

function complianceException(overrides: Partial<RequestItem> = {}): RequestItem {
	return {
		id: "compliance_exception:exception-1",
		sourceType: "compliance_exception",
		sourceId: "exception-1",
		organizationId: "org-1",
		employeeId: "employee-1",
		status: "pending",
		submittedAt: new Date("2026-04-26T18:00:00.000Z"),
		resolvedAt: null,
		title: "overtime_daily",
		subtitle: "",
		decisionReason: null,
		availableActions: ["view"],
		sourceHref: "/time-tracking",
		details: {
			kind: "compliance_exception",
			exceptionType: "overtime_daily",
			plannedDurationMinutes: 90,
			validFrom: new Date("2026-04-27T06:00:00.000Z"),
			validUntil: new Date("2026-04-28T06:00:00.000Z"),
			timeZone: "Europe/Berlin",
		},
		...overrides,
	};
}

function createResult(overrides: Partial<SelfServiceRequestResult> = {}): SelfServiceRequestResult {
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
	it("retries a partial source without losing the current filters or usable records", () => {
		const result = createResult({
			sourceErrors: [{ sourceType: "absence", message: "private" }],
		});
		const view = render(<MyRequestsClient initialResult={result} />);
		fireEvent.change(screen.getByLabelText("Search"), {
			target: { value: "Time" },
		});
		fireEvent.change(screen.getByLabelText("Status"), {
			target: { value: "pending" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(refreshMock).toHaveBeenCalledOnce();
		expect(
			within(screen.getByRole("region", { name: "In review" })).getByText(
				"Time correction request",
			),
		).toBeTruthy();
		view.rerender(<MyRequestsClient initialResult={createResult()} />);
		expect(screen.queryByRole("alert")).toBeNull();
		expect((screen.getByLabelText("Search") as HTMLInputElement).value).toBe("Time");
		expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("pending");
	});

	it("does not call a failed source an empty request history", () => {
		render(
			<MyRequestsClient
				initialResult={createResult({
					items: [],
					sourceErrors: [{ sourceType: "absence", message: "private" }],
				})}
			/>,
		);
		expect(screen.queryByText("No requests yet")).toBeNull();
		expect(screen.getByText("No requests loaded")).toBeTruthy();
	});

	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(new Date("2026-04-28T12:00:00.000Z"));
		vi.clearAllMocks();
		cancelMyAbsenceRequestMock.mockResolvedValue({ success: true });
		cancelMyTimeCorrectionRequestMock.mockResolvedValue({ success: true });
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("renders requests in prioritized groups and all-request history", () => {
		render(<MyRequestsClient initialResult={createResult()} />);

		expect(screen.getByRole("heading", { name: "My Requests" })).toBeTruthy();
		const summary = screen.getByRole("region", { name: "Request summary" });
		expect(within(summary).getByText("In review")).toBeTruthy();
		expect(within(summary).getByText("Required fixes")).toBeTruthy();

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
		expect(within(needsAttention).getByRole("link", { name: "Fix" }).getAttribute("href")).toBe(
			"/absences",
		);

		const inReview = screen.getByRole("region", { name: "In review" });
		expect(within(inReview).getByText("Time correction request")).toBeTruthy();

		const recentlyDecided = screen.getByRole("region", {
			name: "Recently decided",
		});
		expect(within(recentlyDecided).getByText("Travel expense claim")).toBeTruthy();
		// The rejection to fix is a recent decision too, but is shown once, under "Needs attention".
		expect(within(recentlyDecided).queryByText("Vacation")).toBeNull();

		const allRequests = screen.getByRole("region", { name: "All requests" });
		expect(within(allRequests).getByText("Vacation")).toBeTruthy();
		expect(within(allRequests).getByText("Time correction request")).toBeTruthy();
		expect(within(allRequests).getByText("Travel expense claim")).toBeTruthy();
	});

	it("keeps a rejection without a fix out of the attention list, matching the fix count", () => {
		const [rejected, ...rest] = createResult().items;
		render(
			<MyRequestsClient
				initialResult={createResult({
					items: [{ ...rejected, availableActions: ["view"] }, ...rest],
				})}
			/>,
		);

		expect(screen.queryByRole("region", { name: "Needs attention" })).toBeNull();
		const recentlyDecided = screen.getByRole("region", { name: "Recently decided" });
		expect(within(recentlyDecided).getByText("Coverage needed")).toBeTruthy();
	});

	it("clears every filter from the filtered-empty state", () => {
		render(<MyRequestsClient initialResult={createResult()} />);
		fireEvent.change(screen.getByLabelText("Type"), { target: { value: "absence" } });
		fireEvent.change(screen.getByLabelText("Search"), { target: { value: "does-not-match" } });

		const clear = screen.getAllByRole("button", { name: "Clear filters" });
		fireEvent.click(clear[clear.length - 1]);

		expect((screen.getByLabelText("Search") as HTMLInputElement).value).toBe("");
		expect((screen.getByLabelText("Type") as HTMLSelectElement).value).toBe("all");
		expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
		expect(screen.getByRole("region", { name: "In review" })).toBeTruthy();
	});

	it("formats request dates with the active locale", () => {
		render(<MyRequestsClient initialResult={createResult()} />);

		const needsAttention = screen.getByRole("region", {
			name: "Needs attention",
		});
		const vacationCard = within(needsAttention).getByText("Vacation").closest("article");
		expect(vacationCard).not.toBeNull();
		expect(within(vacationCard as HTMLElement).getByText("Submitted: 18. Apr. 2026")).toBeTruthy();
		expect(within(vacationCard as HTMLElement).getByText("Decision: 22. Apr. 2026")).toBeTruthy();
	});

	it("applies filters consistently to grouped sections and all-request history", () => {
		render(<MyRequestsClient initialResult={createResult()} />);

		fireEvent.change(screen.getByLabelText("Status"), {
			target: { value: "pending" },
		});

		const inReview = screen.getByRole("region", { name: "In review" });
		expect(within(inReview).getByText("Time correction request")).toBeTruthy();
		expect(screen.queryByRole("region", { name: "Needs attention" })).toBeNull();
		expect(screen.queryByRole("region", { name: "Recently decided" })).toBeNull();

		const allRequests = screen.getByRole("region", { name: "All requests" });
		expect(within(allRequests).getByText("Time correction request")).toBeTruthy();
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
		expect(within(inReview).getByRole("button", { name: "Cancel request" })).toBeTruthy();

		const allRequests = screen.getByRole("region", { name: "All requests" });
		expect(within(allRequests).queryByRole("button", { name: "Cancel request" })).toBeNull();
		expect(within(allRequests).getByRole("link", { name: "View" })).toBeTruthy();
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
		const timeCard = within(inReview).getByText("Time correction request").closest("article");
		expect(timeCard).not.toBeNull();
		expect(within(timeCard as HTMLElement).queryByRole("link", { name: "Fix" })).toBeNull();
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
		expect(within(inReview).queryByRole("button", { name: "Cancel request" })).toBeNull();
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
		const absenceCard = within(inReview).getByText("Pending vacation").closest("article");
		expect(absenceCard).not.toBeNull();
		await answerCancel(absenceCard as HTMLElement, "Cancel request");

		await waitFor(() => {
			expect(cancelMyAbsenceRequestMock).toHaveBeenCalledWith("absence-pending");
		});
		const timeCard = within(inReview).getByText("Time correction request").closest("article");
		expect(timeCard).not.toBeNull();
		await answerCancel(timeCard as HTMLElement, "Cancel request");
		await waitFor(() => {
			expect(cancelMyTimeCorrectionRequestMock).toHaveBeenCalledWith("period-1");
		});
		expect(cancelMyAbsenceRequestMock).toHaveBeenCalledOnce();
		// Each cancelled request can reopen a period for submission (#1350).
		await waitFor(() => expect(invalidateReadinessMock).toHaveBeenCalledTimes(2));
	});

	it("does not cancel when confirmation is declined", async () => {
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

		await answerCancel(screen.getByRole("region", { name: "In review" }), "Keep request");

		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
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
			expect(
				within(card as HTMLElement).getByRole("button", { name: "Cancel request" }),
			).toBeTruthy();
		});

		it("selects the filters needed to reveal the focused request", async () => {
			const { rerender } = renderFocused(undefined);
			fireEvent.change(screen.getByLabelText("Status"), {
				target: { value: "rejected" },
			});
			fireEvent.change(screen.getByLabelText("Type"), {
				target: { value: "absence" },
			});
			fireEvent.change(screen.getByLabelText("Search"), {
				target: { value: "Vacation" },
			});
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
				expect(invalidate).toHaveBeenCalledWith({
					queryKey: ["period-submissions"],
				}),
			);
			// Only the employee's own list renders, unchanged; no card is focused or marked.
			expect(screen.getAllByRole("article")).toHaveLength(3);
			const history = screen.getByRole("region", { name: "All requests" });
			expect(within(history).getAllByRole("row")).toHaveLength(4);
			expect(document.activeElement?.closest("article")).toBeNull();
		});

		it("does not take focus to the notice when the employee cancels the focused request here", async () => {
			const client = new QueryClient();
			const page = (result: SelfServiceRequestResult) => (
				<QueryClientProvider client={client}>
					<MyRequestsClient initialResult={result} focusRequest="absence:absence-pending" />
				</QueryClientProvider>
			);
			const pending = createResult({
				items: [...createResult().items, PENDING_ABSENCE],
			});
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

	describe("expense reports and compliance exceptions (#1979)", () => {
		afterEach(() => {
			catalog.messages = {};
		});

		it("asks for a fix of a returned report, with the reviewer's note, and never of a rejected one", () => {
			render(
				<MyRequestsClient
					initialResult={createResult({
						counts: { pending: 1, requiredFixes: 1, recentDecisions: 1, total: 3 },
						items: [
							expenseReport({
								id: "travel_expense_report:report-returned",
								sourceId: "report-returned",
								status: "returned",
								resolvedAt: new Date("2026-04-25T08:00:00.000Z"),
								decisionReason: "Add the hotel receipt",
								availableActions: ["fix", "view"],
								sourceHref: "/travel-expenses/reports/report-returned",
								subtitle: "Returned trip · 2026-04-20 to 2026-04-22",
							}),
							expenseReport({
								id: "travel_expense_report:report-rejected",
								sourceId: "report-rejected",
								status: "rejected",
								resolvedAt: new Date("2026-04-27T08:00:00.000Z"),
								decisionReason: "Not a business trip",
								sourceHref: "/travel-expenses/reports/report-rejected",
								subtitle: "Rejected trip · 2026-04-20 to 2026-04-22",
							}),
							expenseReport({ subtitle: "Submitted trip · 2026-04-20 to 2026-04-22" }),
						],
					})}
				/>,
			);

			const summary = screen.getByRole("region", { name: "Request summary" });
			expect(within(summary).getByText("Required fixes").closest("div")?.textContent).toContain(
				"1",
			);

			const needsAttention = screen.getByRole("region", { name: "Needs attention" });
			const returned = within(needsAttention)
				.getByText(/^Returned trip/)
				.closest("article");
			expect(returned).not.toBeNull();
			expect(within(returned as HTMLElement).getByText("Expense report")).toBeTruthy();
			expect(within(returned as HTMLElement).getByText("Returned")).toBeTruthy();
			expect(within(returned as HTMLElement).getByText("Add the hotel receipt")).toBeTruthy();
			expect(
				within(returned as HTMLElement)
					.getByRole("link", { name: "Fix" })
					.getAttribute("href"),
			).toBe("/travel-expenses/reports/report-returned");
			expect(within(needsAttention).queryByText(/^Rejected trip/)).toBeNull();

			const recentlyDecided = screen.getByRole("region", { name: "Recently decided" });
			const rejected = within(recentlyDecided)
				.getByText(/^Rejected trip/)
				.closest("article");
			expect(within(rejected as HTMLElement).getByText("Not a business trip")).toBeTruthy();
			expect(within(rejected as HTMLElement).queryByRole("link", { name: "Fix" })).toBeNull();
			expect(
				within(rejected as HTMLElement)
					.getByRole("link", { name: "View" })
					.getAttribute("href"),
			).toBe("/travel-expenses/reports/report-rejected");
			expect(within(recentlyDecided).queryByText(/^Returned trip/)).toBeNull();

			const inReview = screen.getByRole("region", { name: "In review" });
			const submitted = within(inReview)
				.getByText(/^Submitted trip/)
				.closest("article");
			expect(
				within(submitted as HTMLElement)
					.getByRole("link", { name: "View" })
					.getAttribute("href"),
			).toBe("/travel-expenses/reports/report-1");
			expect(
				within(submitted as HTMLElement).queryByRole("button", { name: "Cancel request" }),
			).toBeNull();

			const history = screen.getByRole("region", { name: "All requests" });
			expect(within(history).getAllByRole("row")).toHaveLength(4);
		});

		it("shows compliance exceptions view-only with their window, and expired ones only in history", () => {
			render(
				<MyRequestsClient
					initialResult={createResult({
						counts: { pending: 1, requiredFixes: 0, recentDecisions: 1, total: 3 },
						items: [
							complianceException(),
							complianceException({
								id: "compliance_exception:exception-rejected",
								sourceId: "exception-rejected",
								title: "rest_period",
								status: "rejected",
								resolvedAt: new Date("2026-04-26T20:00:00.000Z"),
								decisionReason: "Team is fully staffed",
								details: {
									kind: "compliance_exception",
									exceptionType: "rest_period",
									plannedDurationMinutes: null,
									validFrom: new Date("2026-04-27T06:00:00.000Z"),
									validUntil: new Date("2026-04-28T06:00:00.000Z"),
									timeZone: "Europe/Berlin",
								},
							}),
							complianceException({
								id: "compliance_exception:exception-expired",
								sourceId: "exception-expired",
								title: "overtime_weekly",
								status: "expired",
								details: {
									kind: "compliance_exception",
									exceptionType: "overtime_weekly",
									plannedDurationMinutes: 120,
									validFrom: new Date("2026-04-20T06:00:00.000Z"),
									validUntil: new Date("2026-04-21T06:00:00.000Z"),
									timeZone: "Europe/Berlin",
								},
							}),
						],
					})}
				/>,
			);

			const inReview = screen.getByRole("region", { name: "In review" });
			const pending = within(inReview).getByText("Daily overtime exception").closest("article");
			expect(pending).not.toBeNull();
			const pendingCard = pending as HTMLElement;
			expect(within(pendingCard).getByText("In review")).toBeTruthy();
			expect(within(pendingCard).getByText("Compliance exception")).toBeTruthy();
			// The window is read in the organization's zone: 06:00 UTC is 08:00 in Berlin.
			expect(pendingCard.textContent).toMatch(/Planned: 1 h 30 min/);
			expect(pendingCard.textContent).toMatch(/Valid: [^·]*08:00[^·]*08:00/);
			expect(pendingCard.textContent).toContain("Europe/Berlin");
			expect(within(pendingCard).getByRole("link", { name: "View" }).getAttribute("href")).toBe(
				"/time-tracking",
			);
			expect(within(pendingCard).queryByRole("button", { name: "Cancel request" })).toBeNull();

			const recentlyDecided = screen.getByRole("region", { name: "Recently decided" });
			const rejected = within(recentlyDecided)
				.getByText("Rest period exception")
				.closest("article") as HTMLElement;
			expect(within(rejected).getByText("Team is fully staffed")).toBeTruthy();
			expect(within(rejected).queryByRole("link", { name: "Fix" })).toBeNull();
			expect(screen.queryByRole("region", { name: "Needs attention" })).toBeNull();

			expect(within(inReview).queryByText("Weekly overtime exception")).toBeNull();
			expect(within(recentlyDecided).queryByText("Weekly overtime exception")).toBeNull();
			const history = screen.getByRole("region", { name: "All requests" });
			const expiredRow = within(history).getByText("Weekly overtime exception").closest("tr");
			expect(within(expiredRow as HTMLElement).getByText("Expired")).toBeTruthy();
		});

		it("filters by the returned and expired statuses and the new request types", () => {
			render(
				<MyRequestsClient
					initialResult={createResult({
						items: [
							expenseReport({
								status: "returned",
								availableActions: ["fix", "view"],
								resolvedAt: new Date("2026-04-25T08:00:00.000Z"),
							}),
							complianceException({ status: "expired" }),
						],
					})}
				/>,
			);

			const status = screen.getByLabelText("Status") as HTMLSelectElement;
			expect([...status.options].map((option) => option.textContent)).toEqual([
				"All statuses",
				"In review",
				"Returned",
				"Approved",
				"Rejected",
				"Expired",
				"Cancelled",
			]);
			const type = screen.getByLabelText("Type") as HTMLSelectElement;
			expect([...type.options].map((option) => option.textContent)).toEqual([
				"All types",
				"Absence",
				"Time correction",
				"Expense report",
				"Earlier expense claim",
				"Compliance exception",
			]);

			fireEvent.change(status, { target: { value: "expired" } });
			const history = screen.getByRole("region", { name: "All requests" });
			expect(within(history).getByText("Daily overtime exception")).toBeTruthy();
			expect(within(history).queryByText("Expense report")).toBeNull();

			fireEvent.change(status, { target: { value: "returned" } });
			expect(
				within(screen.getByRole("region", { name: "Needs attention" })).getByRole("link", {
					name: "Fix",
				}),
			).toBeTruthy();
		});

		it("never calls a request legacy, with the shipped English copy", () => {
			catalog.messages = myRequestsCatalog();
			render(
				<MyRequestsClient
					initialResult={createResult({
						items: [...createResult().items, expenseReport(), complianceException()],
					})}
				/>,
			);

			expect(screen.getByText(/expense requests in the active organization/)).toBeTruthy();
			expect(document.body.textContent).not.toMatch(/legacy/i);
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

		await answerCancel(screen.getByRole("region", { name: "In review" }), "Cancel request");

		expect((await screen.findByRole("alert")).textContent).toContain("Cannot cancel");
	});

	it("retains the request and permits retry after a cancellation transport failure", async () => {
		cancelMyTimeCorrectionRequestMock.mockRejectedValueOnce(new Error("private transport"));
		const item = {
			...createResult().items[1],
			availableActions: ["view", "cancel"] as ("view" | "cancel")[],
		};
		render(<MyRequestsClient initialResult={createResult({ items: [item] })} />);
		const inReview = screen.getByRole("region", { name: "In review" });
		await answerCancel(inReview, "Cancel request");
		expect((await screen.findByRole("alert")).textContent).toBe("Request could not be cancelled.");
		expect(invalidateReadinessMock).not.toHaveBeenCalled();
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		await answerCancel(inReview, "Cancel request");
		await waitFor(() => expect(invalidateReadinessMock).toHaveBeenCalledOnce());
	});
});
