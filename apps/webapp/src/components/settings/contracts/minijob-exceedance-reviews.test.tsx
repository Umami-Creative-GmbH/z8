/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	acknowledgeMinijobExceedanceAction: vi.fn(),
	listMinijobExceedanceReviewsAction: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			Object.entries(params ?? {}).reduce(
				(text, [k, v]) => text.replaceAll(`{${k}}`, String(v)),
				fallback,
			),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

vi.mock("sonner", () => ({
	toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
}));

vi.mock("@/app/[locale]/(app)/settings/contracts/minijob-review-actions", () => ({
	acknowledgeMinijobExceedanceAction: mocks.acknowledgeMinijobExceedanceAction,
	listMinijobExceedanceReviewsAction: mocks.listMinijobExceedanceReviewsAction,
}));

const { MinijobExceedanceReviews } = await import("./minijob-exceedance-reviews");
const { minijobMonitorQueryKey } = await import("./minijob-query-keys");
const { statutoryAcknowledgementHistoryQueryKey, statutoryMonitorFindingsQueryKey } =
	await import("./statutory-review-query-keys");

const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000001";

const review = {
	id: "finding-1",
	employeeId: EMPLOYEE_ID,
	employeeName: "Mia Minijob",
	month: "2026-11",
	severity: "critical",
	status: "unacknowledged",
	acknowledgeable: true,
	totalCents: 70_000,
	capCents: 60_300,
	doubleCapCents: 120_600,
	externalCents: 0,
	plannedCents: 0,
	priorExceedanceMonths: [],
	inputFingerprint: "v1:shown",
	acknowledgement: { status: "none", acknowledgedAt: null, acknowledgedBy: null, reason: null },
};

describe("MinijobExceedanceReviews (#1989)", () => {
	afterEach(cleanup);
	beforeEach(() => vi.clearAllMocks());

	it("refreshes every viewer's Minijob monitor of the employee after documenting an exceedance", async () => {
		mocks.listMinijobExceedanceReviewsAction.mockResolvedValue({ success: true, data: [review] });
		mocks.acknowledgeMinijobExceedanceAction.mockResolvedValue({
			success: true,
			data: { id: "ack-1" },
		});
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		// The monitor as the admin and as a scoped manager cached it on Employee Detail.
		const monitors = [
			minijobMonitorQueryKey("admin-1", "org-1", EMPLOYEE_ID),
			minijobMonitorQueryKey("manager-1", "org-1", EMPLOYEE_ID),
		];
		for (const key of monitors) client.setQueryData(key, { audience: "restricted" });
		render(
			<QueryClientProvider client={client}>
				<MinijobExceedanceReviews organizationId="org-1" includeAcknowledged={false} />
			</QueryClientProvider>,
		);

		fireEvent.change(await screen.findByRole("textbox", { name: "Why was it unforeseeable?" }), {
			target: { value: "Covered a sick colleague" },
		});
		fireEvent.click(screen.getByRole("button", { name: /Document as unforeseeable/ }));

		await waitFor(() =>
			expect(mocks.acknowledgeMinijobExceedanceAction).toHaveBeenCalledWith(
				// The figures the admin was shown are the precondition: fingerprint and total.
				expect.objectContaining({
					employeeId: EMPLOYEE_ID,
					expectedFingerprint: "v1:shown",
					expectedTotalCents: 70_000,
				}),
			),
		);
		await waitFor(() =>
			expect(monitors.map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([true, true]),
		);
	});

	it("refreshes the statutory limits to act on and the acknowledgement history after documenting an exceedance", async () => {
		mocks.listMinijobExceedanceReviewsAction.mockResolvedValue({ success: true, data: [review] });
		mocks.acknowledgeMinijobExceedanceAction.mockResolvedValue({
			success: true,
			data: { id: "ack-1" },
		});
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		// An acknowledged month leaves the rolling 12-month sum, which the monitor findings show.
		const monitorFindings = statutoryMonitorFindingsQueryKey("org-1");
		const history = statutoryAcknowledgementHistoryQueryKey(
			"org-1",
			{
				employeeId: EMPLOYEE_ID,
				acknowledgementKind: "minijob_unforeseeable_exceedance",
				findingKind: "minijob_monthly_cap",
				subjectKey: "2026-11",
			},
			"v1:shown",
			"none",
		);
		const otherOrganization = statutoryMonitorFindingsQueryKey("org-2");
		for (const key of [monitorFindings, history, otherOrganization]) client.setQueryData(key, []);
		render(
			<QueryClientProvider client={client}>
				<MinijobExceedanceReviews organizationId="org-1" includeAcknowledged={false} />
			</QueryClientProvider>,
		);

		fireEvent.change(await screen.findByRole("textbox", { name: "Why was it unforeseeable?" }), {
			target: { value: "Covered a sick colleague" },
		});
		fireEvent.click(screen.getByRole("button", { name: /Document as unforeseeable/ }));

		await waitFor(() =>
			expect(
				[monitorFindings, history].map((key) => client.getQueryState(key)?.isInvalidated),
			).toEqual([true, true]),
		);
		expect(client.getQueryState(otherOrganization)?.isInvalidated).toBe(false);
	});

	it("flags a month whose acknowledgement no longer applies, without offering to acknowledge it again", async () => {
		mocks.listMinijobExceedanceReviewsAction.mockResolvedValue({
			success: true,
			data: [
				{
					...review,
					status: "over_double_cap",
					acknowledgeable: false,
					totalCents: 127_500,
					acknowledgement: {
						status: "no_longer_applies",
						acknowledgedAt: new Date("2026-11-18T10:00:00Z"),
						acknowledgedBy: "user-1",
						reason: "Covered a sick colleague",
					},
				},
			],
		});
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(
			<QueryClientProvider client={client}>
				<MinijobExceedanceReviews organizationId="org-1" includeAcknowledged={false} />
			</QueryClientProvider>,
		);

		const notice = await screen.findByText(/Acknowledgement no longer applies/);
		expect(notice.textContent).toContain("above twice the limit");
		expect(notice.textContent).toContain("documented reason no longer counts");
		expect(notice.closest("li")?.className).toContain("border-warning");
		expect(notice.closest("li")?.className).not.toMatch(/amber/);
		expect(
			screen.getByText("Documented reason (no longer counts): Covered a sick colleague"),
		).toBeTruthy();
		expect(screen.queryByText(/Documented reason: /)).toBeNull();
		// Not "invalidated … acknowledge again": the month cannot be acknowledged any more.
		expect(screen.queryByText(/acknowledge again/)).toBeNull();
		expect(screen.queryByRole("button", { name: /Document as unforeseeable/ })).toBeNull();
	});
});
