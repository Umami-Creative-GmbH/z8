/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { LegacyClaimHistoryRow } from "@/lib/travel-expenses/expense-history";

const edge = vi.hoisted(() => ({
	history: vi.fn(),
	messages: {} as Record<string, string>,
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/history-actions", () => ({
	getMyTravelExpenseHistory: edge.history,
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-actions", () => ({
	deleteDraftTravelExpenseReportAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/legacy-draft-actions", () => ({
	getLegacyTravelExpenseConversion: vi.fn(),
	convertLegacyTravelExpenseDraftAction: vi.fn(),
}));
vi.mock("@/navigation", () => ({
	Link: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string, params?: Record<string, unknown>) =>
			(edge.messages[key] ?? fallback).replace(/\{(\w+)\}/g, (match, name: string) =>
				params && name in params ? String(params[name]) : match,
			),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import englishTravelExpenses from "../../../messages/travelExpenses/en.json";
import { ExpenseHistory } from "./expense-history";

function flattenCatalog(value: unknown, prefix = ""): Record<string, string> {
	// The catalog's own top-level key is already `travelExpenses`.
	if (typeof value === "string") return { [prefix]: value };
	return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
		(messages, [key, child]) =>
			Object.assign(messages, flattenCatalog(child, prefix ? `${prefix}.${key}` : key)),
		{},
	);
}

const undatedClaim: LegacyClaimHistoryRow = {
	source: "legacy_claim",
	id: "fixture-claim",
	href: "/travel-expenses/fixture-claim",
	stage: "approved",
	activityAt: "2026-10-05T10:00:00.000Z",
	balance: null,
	reimbursement: null,
	dates: { start: null, end: null },
	claimType: "receipt",
	status: "approved",
	amount: { amount: "42.50", currency: "EUR" },
	destination: null,
	canContinue: false,
};

afterEach(() => {
	cleanup();
	edge.messages = {};
});

it("says an earlier claim without recorded dates is an earlier claim, never legacy (#1979)", async () => {
	// The shipped English catalog: a key whose stored copy still says "legacy" must not be used.
	edge.messages = flattenCatalog(englishTravelExpenses);
	edge.history.mockResolvedValue({ success: true, data: [undatedClaim] });
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

	render(
		<QueryClientProvider client={client}>
			<ExpenseHistory
				organizationId="fixture-org"
				employeeId="fixture-employee"
				filter="all"
				setFilter={vi.fn()}
			/>
		</QueryClientProvider>,
	);

	expect(await screen.findByText("Trip date context not recorded (earlier claim)")).toBeTruthy();
	expect(document.body.textContent).not.toMatch(/legacy/i);
	client.clear();
});
