/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getGap: vi.fn() }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback
				.replace(
					/\{count, plural, one \{([^}]*)\} other \{([^}]*)\}\}/g,
					(_match, one: string, other: string) =>
						(params?.count === 1 ? one : other).replace("#", String(params?.count)),
				)
				.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
	}),
}));
vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/finance-actions", () => ({
	getExpenseOfficerCoverageGap: mocks.getGap,
}));

import { OfficerCoverageGapNotice } from "./officer-coverage-gap";

function mount() {
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<OfficerCoverageGapNotice />
		</QueryClientProvider>,
	);
}

describe("officer coverage gap warning (#756)", () => {
	beforeEach(() => mocks.getGap.mockReset());
	afterEach(cleanup);

	it("counts the uncovered expenses and links to them in the finance queue", async () => {
		mocks.getGap.mockResolvedValue({ success: true, data: { uncovered: 3, truncated: false } });
		mount();
		expect(
			await screen.findByText(
				"3 approved expenses await reimbursement that no expense officer covers",
			),
		).toBeTruthy();
		expect(screen.getByRole("link", { name: "Show these expenses" }).getAttribute("href")).toBe(
			"/travel-expenses/finance?coverage=uncovered",
		);
	});

	it("says when more are uncovered than were counted", async () => {
		mocks.getGap.mockResolvedValue({ success: true, data: { uncovered: 500, truncated: true } });
		mount();
		expect(
			await screen.findByText(
				"More than 500 approved expenses await reimbursement that no expense officer covers",
			),
		).toBeTruthy();
	});

	it.each([
		["without expense officers or for non-administrators", null],
		["when every expense is covered", { uncovered: 0, truncated: false }],
	])("shows nothing %s", async (_case, data) => {
		mocks.getGap.mockResolvedValue({ success: true, data });
		mount();
		await waitFor(() => expect(mocks.getGap).toHaveBeenCalled());
		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.queryByRole("link")).toBeNull();
	});
});
