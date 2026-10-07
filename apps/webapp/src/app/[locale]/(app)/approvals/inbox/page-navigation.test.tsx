/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { type ComponentProps, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type {
	ApprovalInboxItem,
	ApprovalInboxListResult,
} from "@/lib/approvals/inbox/types";
import ApprovalInboxPage from "./page";

vi.mock("next-intl", () => ({ useLocale: () => "en" }));

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: ComponentProps<"a">) =>
		createElement("a", { href, ...props }, children),
}));

const navigation = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(navigation.query),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock(
	"@/app/[locale]/(app)/settings/employees/employee-clock-status.actions",
	() => ({
		getEmployeeClockStatuses: async () => ({ success: true, data: {} }),
	}),
);

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	navigation.query = "";
});

function request(
	id: string,
	type: ApprovalInboxItem["type"],
	name: string,
): ApprovalInboxItem {
	return {
		id,
		type,
		entityId: id,
		status: "pending",
		requester: {
			id,
			name,
			email: `${id}@example.com`,
			image: null,
			teamId: null,
		},
		summary: {
			title: `${name} request`,
			subtitle: "Pending review",
			detail: "",
			badge: null,
		},
		timing: {
			createdAt: "2026-10-01T08:00:00Z",
			resolvedAt: null,
			slaDeadline: null,
			ageDays: 3,
		},
		triage: {
			priority: "normal",
			riskLevel: "low",
			riskReasons: [],
			fastLaneGroup: null,
			isPayrollRelevant: false,
			explanation: "Ready for review",
		},
		capabilities: {
			canApprove: true,
			canReject: true,
			canBulkApprove: true,
			requiresRejectReason: true,
		},
	};
}

it("applies a filtered client arrival after an earlier unfiltered visit to both controls and requests", async () => {
	const requests = [
		request("expense", "travel_expense_claim", "Expense Employee"),
		request("absence", "absence_entry", "Absence Employee"),
	];
	const requestedUrls: URL[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string) => {
			const url = new URL(input, "http://localhost");
			requestedUrls.push(url);
			const types = url.searchParams.get("types")?.split(",");
			const items = requests.filter(
				(item) => !types || types.includes(item.type),
			);
			const result: ApprovalInboxListResult = {
				items,
				total: items.length,
				counts: { absence_entry: 1, time_entry: 0, travel_expense_claim: 1 },
				supportedTypes: ["absence_entry", "time_entry", "travel_expense_claim"],
				warnings: [],
				hasMore: false,
				nextCursor: null,
			};
			return new Response(JSON.stringify(result));
		}),
	);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const page = (
		<QueryClientProvider client={client}>
			<ApprovalInboxPage />
		</QueryClientProvider>
	);
	const view = render(page);
	await screen.findByText("Absence Employee");
	expect(screen.getByText("Expense Employee")).toBeTruthy();
	fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
	expect(screen.getByRole("button", { name: /Approve Selected/ })).toBeTruthy();

	navigation.query = "types=travel_expense_claim";
	view.rerender(
		<QueryClientProvider client={client}>
			<ApprovalInboxPage />
		</QueryClientProvider>,
	);
	await screen.findByText("Expense Employee");
	await waitFor(() =>
		expect(screen.queryByText("Absence Employee")).toBeNull(),
	);
	expect(requestedUrls.at(-1)?.searchParams.get("types")).toBe(
		"travel_expense_claim",
	);
	expect(screen.queryByRole("button", { name: /Approve Selected/ })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: /Type/ }));
	expect(
		(
			await screen.findByRole("menuitemcheckbox", { name: "Travel Expenses" })
		).getAttribute("aria-checked"),
	).toBe("true");
	fireEvent.keyDown(
		screen.getByRole("menuitemcheckbox", { name: "Travel Expenses" }),
		{ key: "Escape" },
	);

	// Local edits persist across rerenders with a new search-params object.
	fireEvent.change(screen.getByRole("textbox", { name: "Search approvals" }), {
		target: { value: "Expense" },
	});
	await waitFor(() =>
		expect(requestedUrls.at(-1)?.searchParams.get("search")).toBe("Expense"),
	);
	view.rerender(
		<QueryClientProvider client={client}>
			<ApprovalInboxPage />
		</QueryClientProvider>,
	);
	expect(
		screen
			.getByRole("textbox", { name: "Search approvals" })
			.getAttribute("value"),
	).toBe("Expense");

	// Back to the unfiltered URL resets local search and returns both kinds.
	navigation.query = "";
	view.rerender(
		<QueryClientProvider client={client}>
			<ApprovalInboxPage />
		</QueryClientProvider>,
	);
	await screen.findByText("Absence Employee");
	expect(screen.getByText("Expense Employee")).toBeTruthy();
	expect(
		screen
			.getByRole("textbox", { name: "Search approvals" })
			.getAttribute("value"),
	).toBe("");
	await waitFor(() =>
		expect(requestedUrls.at(-1)?.searchParams.get("types")).toBeNull(),
	);
	expect(requestedUrls.at(-1)?.searchParams.get("search")).toBeNull();

	// Forward and a fresh mount of that URL agree on the selected kind.
	navigation.query = "types=travel_expense_claim";
	view.rerender(
		<QueryClientProvider client={client}>
			<ApprovalInboxPage />
		</QueryClientProvider>,
	);
	await screen.findByText("Expense Employee");
	expect(screen.queryByText("Absence Employee")).toBeNull();
	view.unmount();
	render(
		<QueryClientProvider client={client}>
			<ApprovalInboxPage />
		</QueryClientProvider>,
	);
	await screen.findByText("Expense Employee");
	expect(screen.queryByText("Absence Employee")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: /Type/ }));
	expect(
		(
			await screen.findByRole("menuitemcheckbox", { name: "Travel Expenses" })
		).getAttribute("aria-checked"),
	).toBe("true");
	client.clear();
});
