/* @vitest-environment jsdom */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TodayBriefing } from "./today-briefing";
import { briefingFixture } from "./today-test-fixture";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) =>
					text
						// A minimal ICU plural: `{key, plural, one {…} other {…}}`, `#` is the value.
						.replace(
							new RegExp(`\\{${key}, plural, one \\{([^}]*)\\} other \\{([^}]*)\\}\\}`, "g"),
							(_match, one: string, other: string) =>
								(Number(value) === 1 ? one : other).replaceAll("#", String(value)),
						)
						.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));

describe("manager Today briefing", () => {
	it("leads with urgent evidence and never announces all-clear when a section failed", () => {
		const briefing = briefingFixture();
		briefing.sections.attendance.error = "Section could not be loaded.";
		render(<TodayBriefing briefing={briefing} />);
		expect(screen.queryByText(/All clear/i)).toBeNull();
		const summary = screen.getByRole("region", { name: "Today summary" });
		expect(within(summary).getAllByText("Unavailable")).toHaveLength(2);
		expect(
			screen.getByRole("heading", { name: "Needs Action" }).compareDocumentPosition(summary) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry Attendance" })).toBeTruthy();
	});

	it("counts every pending approval in the approvals panel, as the summary does", () => {
		const briefing = briefingFixture();
		briefing.summary.openApprovals = 40;
		briefing.sections.approvals.items = [
			{
				id: "approval:approval-1",
				category: "approval",
				severity: "warning",
				title: "Ada Lovelace: Vacation request",
				description: "Apr 28",
				href: "/approvals/inbox?types=absence_entry",
				approvalId: "approval-1",
				approvalType: "absence_entry",
				entityId: "absence-1",
				requesterName: "Ada Lovelace",
				summary: "Vacation on Apr 28",
				canApprove: true,
				canReject: true,
			},
		];
		render(<TodayBriefing briefing={briefing} />);

		expect(screen.getByText("Showing 1 of 40 pending approvals.")).toBeTruthy();
	});

	it("names the approval types the briefing could not list in the approvals panel", () => {
		const briefing = briefingFixture();
		briefing.summary.openApprovals = 3;
		briefing.sections.approvals.items = [];
		briefing.sections.approvals.unavailableTypes = ["travel_expense_claim"];
		render(<TodayBriefing briefing={briefing} />);

		expect(screen.getByText(/Some approvals could not be loaded: Travel Expenses\./)).toBeTruthy();
		expect(screen.queryByText("No approvals are waiting.")).toBeNull();
	});

	it("shows open approvals as a lower bound when a type could not be counted", () => {
		const briefing = briefingFixture();
		briefing.summary.openApprovals = 2;
		briefing.sections.approvals.items = [];
		briefing.sections.approvals.uncountedTypes = ["absence_entry"];
		render(<TodayBriefing briefing={briefing} />);

		expect(
			screen.getByText(/Some approvals could not be counted: Absence Requests\./),
		).toBeTruthy();
		const summary = screen.getByRole("region", { name: "Today summary" });
		expect(within(summary).getByText("2+")).toBeTruthy();
	});
});
