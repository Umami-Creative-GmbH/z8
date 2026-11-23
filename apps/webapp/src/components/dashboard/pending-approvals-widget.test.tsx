/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/render-with-translations";

vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({
		userId: "user-a",
		organizationId: "org-a",
		role: "manager",
		isLoading: false,
	}),
}));
vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("@dnd-kit/sortable", () => ({
	useSortable: () => ({
		attributes: {},
		listeners: {},
		setNodeRef: vi.fn(),
		transform: null,
		transition: undefined,
		isDragging: false,
	}),
}));
vi.mock("@dnd-kit/utilities", () => ({ CSS: { Translate: { toString: () => undefined } } }));

import type { DashboardWidgetSnapshot, PendingApprovalsData } from "./dashboard-types";
import { PendingApprovalsWidget } from "./pending-approvals-widget";

const scope = { userId: "user-a", organizationId: "org-a" };
const delivered = (
	data: PendingApprovalsData | null,
): DashboardWidgetSnapshot<PendingApprovalsData> => ({
	scope,
	updatedAt: Date.now(),
	result: { success: true, data },
});

const pending: PendingApprovalsData = {
	total: 7,
	coveringCount: 2,
	typeCounts: [
		{ type: "absence_entry", count: 4 },
		{ type: "travel_expense_report", count: 2 },
		{ type: "compliance_exception", count: 1 },
	],
	unavailableTypes: [],
	preview: [
		{
			id: "exception-a",
			type: "compliance_exception",
			requesterName: "Ada Lovelace",
			title: { key: "approvals:approvals.test.exceptionTitle", fallback: "Daily overtime" },
			detail: "Inventory count runs late",
			coveringForName: null,
			ownRequest: false,
		},
		{
			id: "absence-a",
			type: "absence_entry",
			requesterName: "Katherine Johnson",
			title: "Vacation",
			detail: {
				key: "approvals:approvals.test.absenceDetail",
				fallback: "Starts {start}",
				params: { start: { kind: "plain_date", date: "2026-12-07" } },
			},
			coveringForName: "Clara Colleague",
			ownRequest: false,
		},
	],
};

function widget(snapshot: DashboardWidgetSnapshot<PendingApprovalsData>) {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<PendingApprovalsWidget initialSnapshot={snapshot} />
		</QueryClientProvider>,
	);
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe("Pending Approvals widget (#1978)", () => {
	it("states the unified total and that covered approvals are included", () => {
		widget(delivered(pending));

		expect(screen.getByText("7 pending approvals")).toBeTruthy();
		expect(screen.getByText("Includes 2 approvals you cover for")).toBeTruthy();
	});

	it("uses the singular and omits the covering note without covered approvals", () => {
		widget(
			delivered({
				...pending,
				total: 1,
				coveringCount: 0,
				typeCounts: [{ type: "compliance_exception", count: 1 }],
				preview: [pending.preview[0]],
			}),
		);

		expect(screen.getByText("1 pending approval")).toBeTruthy();
		expect(screen.queryByText(/you cover for/)).toBeNull();
	});

	it("uses the singular for a single covered approval", () => {
		widget(delivered({ ...pending, coveringCount: 1 }));

		expect(screen.getByText("Includes 1 approval you cover for")).toBeTruthy();
	});

	it.each([
		[5, "Requires immediate attention"],
		[4, "Awaiting your approval"],
	] as const)("with %i pending approvals, says: %s", (total, copy) => {
		widget(delivered({ ...pending, total }));

		expect(screen.getByText(copy)).toBeTruthy();
		expect(
			screen.queryByText(
				copy === "Awaiting your approval"
					? "Requires immediate attention"
					: "Awaiting your approval",
			),
		).toBeNull();
	});

	it("lists a full preview of five approvals in the delivered order", () => {
		const names = ["Ada", "Grace", "Hedy", "Katherine", "Margaret"];
		widget(
			delivered({
				...pending,
				total: 9,
				preview: names.map((name, index) => ({
					id: `absence-${index}`,
					type: "absence_entry",
					requesterName: name,
					title: "Vacation",
					detail: "",
					coveringForName: null,
					ownRequest: false,
				})),
			}),
		);

		const rows = within(
			screen.getByRole("list", { name: "Most urgent pending approvals" }),
		).getAllByRole("listitem");
		expect(rows).toHaveLength(5);
		rows.forEach((row, index) => {
			expect(within(row).getByText(names[index])).toBeTruthy();
		});
	});

	it("links a pill for each type with pending approvals to the inbox filtered to that type", () => {
		widget(delivered(pending));

		const pills = within(
			screen.getByRole("list", { name: "Pending approvals by type" }),
		).getAllByRole("link");
		expect(
			pills.map((pill) => [
				pill.textContent?.replace(/\s+/g, " ").trim(),
				pill.getAttribute("href"),
			]),
		).toEqual([
			["Absence Requests 4", "/approvals/inbox?types=absence_entry"],
			["Expense Reports 2", "/approvals/inbox?types=travel_expense_report"],
			["Compliance Exceptions 1", "/approvals/inbox?types=compliance_exception"],
		]);
		expect(screen.queryByText("Time Corrections")).toBeNull();
	});

	it("previews the most urgent approvals in the delivered order with requester, type, localized summary and covering tag", () => {
		widget(delivered(pending));

		const rows = within(
			screen.getByRole("list", { name: "Most urgent pending approvals" }),
		).getAllByRole("listitem");
		expect(rows).toHaveLength(2);
		expect(within(rows[0]).getByText("Ada Lovelace")).toBeTruthy();
		expect(within(rows[0]).getByText("Compliance Exceptions")).toBeTruthy();
		expect(within(rows[0]).getByText("Daily overtime")).toBeTruthy();
		expect(within(rows[0]).getByText("Inventory count runs late")).toBeTruthy();
		expect(within(rows[0]).queryByText(/Covering for/)).toBeNull();
		expect(within(rows[1]).getByText("Katherine Johnson")).toBeTruthy();
		expect(within(rows[1]).getByText("Absence Requests")).toBeTruthy();
		expect(within(rows[1]).getByText("Starts Dec 7, 2026")).toBeTruthy();
		expect(within(rows[1]).getByText("Covering for Clara Colleague")).toBeTruthy();
		expect(screen.getByRole("link", { name: /Review All Approvals/ }).getAttribute("href")).toBe(
			"/approvals/inbox",
		);
	});

	it.each([
		[
			"nothing pending",
			{ total: 0, coveringCount: 0, typeCounts: [], preview: [], unavailableTypes: [] },
		],
		["no Approval inbox", null],
	] as const)("shows the empty state for %s", (_case, data) => {
		widget(delivered(data));

		expect(screen.getByRole("status").textContent).toBe("No pending approvals");
		expect(screen.queryByRole("link", { name: /Review All Approvals/ })).toBeNull();
	});

	it("says which approval types could not be loaded and offers a retry, keeping what loaded", () => {
		widget(delivered({ ...pending, unavailableTypes: ["travel_expense_claim", "time_entry"] }));

		expect(screen.getByRole("alert").textContent).toBe(
			"Some approvals could not be loaded (Travel Expenses, Time Corrections). Totals may be incomplete.",
		);
		fireEvent.click(screen.getByRole("button", { name: "Retry Pending Approvals" }));
		expect(fetch).toHaveBeenCalled();
		expect(screen.getByText("7 pending approvals")).toBeTruthy();
	});

	it("does not claim nothing is pending when an approval type failed to load", () => {
		widget(
			delivered({
				total: 0,
				coveringCount: 0,
				typeCounts: [],
				preview: [],
				unavailableTypes: ["absence_entry"],
			}),
		);

		expect(screen.getByRole("alert").textContent).toContain("Absence Requests");
		expect(screen.queryByText("No pending approvals")).toBeNull();
	});

	it("shows no partial-failure notice when every type loaded", () => {
		widget(delivered(pending));

		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("marks the viewer's own request, which another approver decides", () => {
		widget(
			delivered({
				...pending,
				preview: [{ ...pending.preview[0], ownRequest: true }, pending.preview[1]],
			}),
		);

		const rows = within(
			screen.getByRole("list", { name: "Most urgent pending approvals" }),
		).getAllByRole("listitem");
		expect(
			within(rows[0]).getByText("Your own request: another approver decides it."),
		).toBeTruthy();
		expect(within(rows[1]).queryByText(/Your own request/)).toBeNull();
	});

	it("shows the retryable widget error when the read failed", () => {
		widget({ scope, updatedAt: Date.now(), result: { success: false, error: "Unavailable" } });

		expect(screen.getByRole("alert")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry Pending Approvals" })).toBeTruthy();
		expect(fetch).not.toHaveBeenCalled();
	});
});
