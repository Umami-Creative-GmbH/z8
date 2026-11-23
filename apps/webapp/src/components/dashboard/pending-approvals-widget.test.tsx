/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	fireEvent,
	render as renderWithoutTranslations,
	screen,
	within,
} from "@testing-library/react";
import { TolgeeProvider } from "@tolgee/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	GERMAN_SUMMARY_CASES,
	GERMAN_SUMMARY_TRANSLATIONS,
	inboxRowFromDisplay,
} from "@/test/german-approval-summaries";
import { createTestTolgee, render } from "@/test/render-with-translations";

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
	notLoadedTypes: [],
	notCountedTypes: [],
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
		expect(within(rows[0]).getByText("Compliance exception")).toBeTruthy();
		expect(within(rows[0]).getByText("Daily overtime")).toBeTruthy();
		expect(within(rows[0]).getByText("Inventory count runs late")).toBeTruthy();
		expect(within(rows[0]).queryByText(/Covering for/)).toBeNull();
		expect(within(rows[1]).getByText("Katherine Johnson")).toBeTruthy();
		expect(within(rows[1]).getByText("Absence request")).toBeTruthy();
		expect(within(rows[1]).getByText("Starts Dec 7, 2026")).toBeTruthy();
		expect(within(rows[1]).getByText("Covering for Clara Colleague")).toBeTruthy();
		expect(screen.getByRole("link", { name: /Review All Approvals/ }).getAttribute("href")).toBe(
			"/approvals/inbox",
		);
	});

	it.each([
		["time_entry", "Time entry"],
		["travel_expense_claim", "Travel expense claim"],
		["travel_expense_report", "Expense report"],
		["absence_change_request", "Absence change request"],
		["period_submission", "Period submission"],
	] as const)(
		"badges one %s preview row in the singular, as the pill keeps the plural",
		(type, label) => {
			widget(
				delivered({
					...pending,
					typeCounts: [{ type, count: 3 }],
					preview: [{ ...pending.preview[0], type }],
				}),
			);

			const [row] = within(
				screen.getByRole("list", { name: "Most urgent pending approvals" }),
			).getAllByRole("listitem");
			expect(within(row).getByText(label)).toBeTruthy();
			expect(
				within(screen.getByRole("list", { name: "Pending approvals by type" })).getByRole("link")
					.textContent,
			).not.toContain(label);
		},
	);

	it.each([
		[
			"nothing pending",
			{
				total: 0,
				coveringCount: 0,
				typeCounts: [],
				preview: [],
				notLoadedTypes: [],
				notCountedTypes: [],
			},
		],
		["no Approval inbox", null],
	] as const)("shows the empty state for %s", (_case, data) => {
		widget(delivered(data));

		expect(screen.getByRole("status").textContent).toBe("No pending approvals");
		expect(screen.queryByRole("link", { name: /Review All Approvals/ })).toBeNull();
	});

	it("says which approval types could not be loaded and offers a retry, keeping what loaded", () => {
		widget(delivered({ ...pending, notLoadedTypes: ["time_entry", "travel_expense_claim"] }));

		expect(screen.getByRole("alert").textContent).toBe(
			"Some approvals could not be loaded (Time Corrections and Travel Expenses). The list and totals may be incomplete.",
		);
		fireEvent.click(screen.getByRole("button", { name: "Retry Pending Approvals" }));
		expect(fetch).toHaveBeenCalled();
		// The totals may be incomplete, so the banner does not claim them whole.
		expect(screen.getByText("At least 7 pending approvals")).toBeTruthy();
	});

	it("says a type whose rows list but whose count failed could not be counted, not loaded", () => {
		widget(delivered({ ...pending, notCountedTypes: ["travel_expense_report"] }));

		expect(screen.getByRole("alert").textContent).toBe(
			"Some approvals could not be counted (Expense Reports). Totals may be incomplete.",
		);
	});

	it("names both kinds of failure when some types failed to load and others to count", () => {
		widget(
			delivered({
				...pending,
				notLoadedTypes: ["time_entry"],
				notCountedTypes: ["travel_expense_report", "compliance_exception"],
			}),
		);

		expect(screen.getByRole("alert").textContent).toBe(
			"Some approvals could not be loaded (Time Corrections). The list and totals may be incomplete. " +
				"Some approvals could not be counted (Expense Reports and Compliance Exceptions). Totals may be incomplete.",
		);
	});

	it("lists the approval types that could not be loaded or counted as the viewer's language does", () => {
		renderWithoutTranslations(
			<TolgeeProvider
				tolgee={createTestTolgee("de", {
					"dashboard.pending-approvals.not-loaded":
						"Einige Genehmigungen konnten nicht geladen werden ({types}).",
					"dashboard.pending-approvals.not-counted":
						"Einige Genehmigungen konnten nicht gezählt werden ({types}).",
					"approvals:approvals.types.travel_expense_claim": "Reisekosten",
					"approvals:approvals.types.time_entry": "Zeitkorrekturen",
					"approvals:approvals.types.travel_expense_report": "Spesenabrechnungen",
					"approvals:approvals.types.period_submission": "Zeitraumabgaben",
				})}
			>
				<QueryClientProvider client={new QueryClient()}>
					<PendingApprovalsWidget
						initialSnapshot={delivered({
							...pending,
							notLoadedTypes: ["time_entry", "travel_expense_claim"],
							notCountedTypes: ["travel_expense_report", "period_submission"],
						})}
					/>
				</QueryClientProvider>
			</TolgeeProvider>,
		);

		expect(screen.getByRole("alert").textContent).toBe(
			"Einige Genehmigungen konnten nicht geladen werden (Zeitkorrekturen und Reisekosten). " +
				"Einige Genehmigungen konnten nicht gezählt werden (Spesenabrechnungen und Zeitraumabgaben).",
		);
	});

	it("does not claim nothing is pending when an approval type failed to load, and still links to the inbox", () => {
		widget(
			delivered({
				total: 0,
				coveringCount: 0,
				typeCounts: [],
				preview: [],
				notLoadedTypes: ["absence_entry"],
				notCountedTypes: [],
			}),
		);

		expect(screen.getByRole("alert").textContent).toContain("Absence Requests");
		expect(screen.queryByText("No pending approvals")).toBeNull();
		expect(screen.getByRole("link", { name: /Review All Approvals/ }).getAttribute("href")).toBe(
			"/approvals/inbox",
		);
	});

	it("previews the rows of an expense report whose count failed, though nothing was counted", () => {
		// The legacy expense report source listed its row, but its count failed: a total of 0.
		widget(
			delivered({
				total: 0,
				coveringCount: 0,
				typeCounts: [],
				preview: [{ ...pending.preview[0], id: "report-a", type: "travel_expense_report" }],
				notLoadedTypes: [],
				notCountedTypes: ["travel_expense_report"],
			}),
		);

		expect(screen.getByRole("alert").textContent).toContain(
			"could not be counted (Expense Reports)",
		);
		expect(screen.queryByText("No pending approvals")).toBeNull();
		// Never fewer than the rows it shows, and never claimed as the whole total.
		expect(screen.getByText("At least 1 pending approval")).toBeTruthy();
		const rows = within(
			screen.getByRole("list", { name: "Most urgent pending approvals" }),
		).getAllByRole("listitem");
		expect(rows).toHaveLength(1);
		expect(within(rows[0]).getByText("Expense report")).toBeTruthy();
		expect(screen.getByRole("link", { name: /Review All Approvals/ }).getAttribute("href")).toBe(
			"/approvals/inbox",
		);
	});

	it("marks the pill of a type whose count failed as a lower bound", () => {
		widget(
			delivered({
				...pending,
				total: 35,
				typeCounts: [
					{ type: "absence_entry", count: 32, atLeast: true },
					{ type: "travel_expense_report", count: 3 },
				],
				notCountedTypes: ["absence_entry"],
			}),
		);

		const pills = within(
			screen.getByRole("list", { name: "Pending approvals by type" }),
		).getAllByRole("link");
		expect(pills.map((pill) => pill.textContent?.replace(/\s+/g, " ").trim())).toEqual([
			"Absence Requests 32+",
			"Expense Reports 3",
		]);
	});

	it("never states a total below the rows it previews when a count failed", () => {
		widget(
			delivered({
				...pending,
				total: 1,
				coveringCount: 0,
				typeCounts: [{ type: "absence_entry", count: 1 }],
				preview: [
					pending.preview[1],
					{ ...pending.preview[0], id: "report-a", type: "travel_expense_report" },
					{ ...pending.preview[0], id: "report-b", type: "travel_expense_report" },
				],
				notCountedTypes: ["travel_expense_report"],
			}),
		);

		expect(screen.getByText("At least 3 pending approvals")).toBeTruthy();
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

	it.each(GERMAN_SUMMARY_CASES)(
		"previews $name in the viewer's language and formats",
		({ type, display, title, detail }) => {
			const { summary } = inboxRowFromDisplay("approval-1", type, display);
			renderWithoutTranslations(
				<TolgeeProvider tolgee={createTestTolgee("de", GERMAN_SUMMARY_TRANSLATIONS)}>
					<QueryClientProvider client={new QueryClient()}>
						<PendingApprovalsWidget
							initialSnapshot={delivered({
								...pending,
								preview: [
									{
										id: "approval-1",
										type,
										requesterName: "Ada Lovelace",
										// As the Dashboard reader passes them on.
										title: summary.localized?.title ?? summary.title,
										detail: summary.localized?.detail ?? summary.detail,
										coveringForName: null,
										ownRequest: false,
									},
								],
							})}
						/>
					</QueryClientProvider>
				</TolgeeProvider>,
			);

			const [row] = within(
				screen.getByRole("list", { name: "Most urgent pending approvals" }),
			).getAllByRole("listitem");
			expect(within(row).getByText(title)).toBeTruthy();
			expect(within(row).getByText(detail)).toBeTruthy();
		},
	);

	it("shows the retryable widget error when the read failed", () => {
		widget({ scope, updatedAt: Date.now(), result: { success: false, error: "Unavailable" } });

		expect(screen.getByRole("alert")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry Pending Approvals" })).toBeTruthy();
		expect(fetch).not.toHaveBeenCalled();
	});
});
