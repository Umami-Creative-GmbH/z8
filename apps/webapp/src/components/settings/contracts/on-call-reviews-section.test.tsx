/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	listOnCallReviewItemsAction: vi.fn(),
	acknowledgeOnCallShortNoticeAction: vi.fn(),
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
	Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("@/app/[locale]/(app)/settings/contracts/on-call-actions", () => ({
	listOnCallReviewItemsAction: mocks.listOnCallReviewItemsAction,
	acknowledgeOnCallShortNoticeAction: mocks.acknowledgeOnCallShortNoticeAction,
}));

const { OnCallReviewsSection } = await import("./on-call-reviews-section");

function shortNotice(employeeName: string, shiftId: string, fingerprint: string) {
	return {
		employeeId: `${employeeName}-id`,
		employeeName,
		finding: {
			id: `finding-${shiftId}`,
			organizationId: "org",
			employeeId: `${employeeName}-id`,
			domain: "on_call",
			kind: "on_call_short_notice",
			severity: "warning",
			subjectKey: `shift:${shiftId}`,
			periodStart: "2026-11-25",
			periodEnd: "2026-11-26",
			legalReference: "§ 12 Abs. 3 TzBfG",
			summary: { used: { unit: "days", value: 1 }, limit: { unit: "days", value: 4 } },
			inputFingerprint: fingerprint,
			acknowledgementKind: "on_call_short_notice_agreement",
			adminDetail: null,
			acknowledgement: { status: "none" },
		},
	};
}

describe("OnCallReviewsSection (#1992)", () => {
	afterEach(cleanup);
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("never shows one organization's cached findings under another", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		mocks.listOnCallReviewItemsAction.mockResolvedValueOnce({
			success: true,
			data: [shortNotice("Alice", "11111111-1111-4111-8111-111111111111", "v1:a")],
		});
		const view = render(
			<QueryClientProvider client={client}>
				<OnCallReviewsSection organizationId="org-a" />
			</QueryClientProvider>,
		);
		expect(await screen.findByText("Alice")).toBeTruthy();

		mocks.listOnCallReviewItemsAction.mockResolvedValueOnce({
			success: true,
			data: [shortNotice("Bob", "22222222-2222-4222-8222-222222222222", "v1:b")],
		});
		view.rerender(
			<QueryClientProvider client={client}>
				<OnCallReviewsSection organizationId="org-b" />
			</QueryClientProvider>,
		);

		expect(await screen.findByText("Bob")).toBeTruthy();
		expect(screen.queryByText("Alice")).toBeNull();
		expect(mocks.listOnCallReviewItemsAction).toHaveBeenCalledTimes(2);
	});

	it("documents the agreement for the finding the admin was shown", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const shiftId = "11111111-1111-4111-8111-111111111111";
		mocks.listOnCallReviewItemsAction.mockResolvedValue({
			success: true,
			data: [shortNotice("Alice", shiftId, "v1:shown")],
		});
		mocks.acknowledgeOnCallShortNoticeAction.mockResolvedValue({
			success: true,
			data: { id: "ack", acknowledgedAt: "2026-11-23T10:00:00Z" },
		});
		render(
			<QueryClientProvider client={client}>
				<OnCallReviewsSection organizationId="org-a" />
			</QueryClientProvider>,
		);

		fireEvent.change(await screen.findByRole("textbox"), {
			target: { value: "Agreed by phone" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Document agreement" }));

		await waitFor(() =>
			expect(mocks.acknowledgeOnCallShortNoticeAction).toHaveBeenCalledWith({
				shiftId,
				expectedFingerprint: "v1:shown",
				reason: "Agreed by phone",
			}),
		);
	});
});
