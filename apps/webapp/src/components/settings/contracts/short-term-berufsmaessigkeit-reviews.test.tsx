/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #1994: the Berufsmäßigkeit checks in the unified Reviews & Conflicts inbox. Under "All" a domain
// with nothing to verify shows no card; under its own filter it says so.

const mocks = vi.hoisted(() => ({
	listShortTermBerufsmaessigkeitReviewsAction: vi.fn(),
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("@/app/[locale]/(app)/settings/contracts/statutory-review-actions", () => ({
	listStatutoryAcknowledgementHistoryAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/contracts/short-term-actions", () => ({
	listShortTermBerufsmaessigkeitReviewsAction: mocks.listShortTermBerufsmaessigkeitReviewsAction,
	acknowledgeShortTermBerufsmaessigkeitAction: vi.fn(),
}));

const { ShortTermBerufsmaessigkeitReviews } =
	await import("./short-term-berufsmaessigkeit-reviews");

const title = "Short-term employment: Berufsmäßigkeit checks";
const empty = "No short-term earnings above the Minijob limit to verify.";

function renderReviews(showWhenEmpty?: boolean) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<ShortTermBerufsmaessigkeitReviews
				organizationId="org-1"
				includeResolved={false}
				showWhenEmpty={showWhenEmpty}
			/>
		</QueryClientProvider>,
	);
}

describe("ShortTermBerufsmaessigkeitReviews (#1994)", () => {
	afterEach(cleanup);
	beforeEach(() => {
		mocks.listShortTermBerufsmaessigkeitReviewsAction.mockReset();
		mocks.listShortTermBerufsmaessigkeitReviewsAction.mockResolvedValue({
			success: true,
			data: [],
		});
	});

	it("shows no card when nothing needs verifying under All", async () => {
		const { container } = renderReviews();

		await waitFor(() =>
			expect(mocks.listShortTermBerufsmaessigkeitReviewsAction).toHaveBeenCalled(),
		);
		await waitFor(() => expect(container.innerHTML).toBe(""));
		expect(screen.queryByText(title)).toBeNull();
	});

	it("says there is nothing to verify under the Short-Term filter", async () => {
		renderReviews(true);

		expect(await screen.findByText(empty)).toBeTruthy();
		expect(screen.getByText(title)).toBeTruthy();
	});
});
