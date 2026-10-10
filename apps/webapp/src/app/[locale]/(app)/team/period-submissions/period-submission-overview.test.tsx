// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { OverviewRow } from "@/lib/time-tracking/period-submissions/overview";
import { PeriodSubmissionOverview } from "./period-submission-overview";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));

vi.mock("next-intl", () => ({ useLocale: () => "en" }));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
	Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

const period = { startDate: "2026-03-02", endDate: "2026-03-08", cadence: "weekly" as const };

const row = (name: string, status: OverviewRow["status"], highlighted: boolean): OverviewRow => ({
	employeeId: `id-${name}`,
	name,
	startDate: "2026-03-02",
	endDate: "2026-03-08",
	status,
	submittedAt: null,
	highlighted,
	opensOn: "2026-03-08",
});

const counts = {
	awaiting_submission: 1,
	submitted: 1,
	approved: 0,
	rejected: 0,
	sent_back_after_change: 0,
};

describe("the period submission overview", () => {
	it("marks employees who have not submitted and links each one's calendar", () => {
		render(
			<PeriodSubmissionOverview
				periods={[period]}
				selected={period}
				running={false}
				rows={[row("Bert", "awaiting_submission", true), row("Anna", "submitted", false)]}
				counts={counts}
			/>,
		);

		const bert = screen.getByRole("row", { name: /Bert/ });
		expect(within(bert).getByText("Not submitted")).toBeTruthy();
		expect(within(bert).getAllByText("Awaiting submission").length).toBeGreaterThan(0);
		const anna = screen.getByRole("row", { name: /Anna/ });
		expect(within(anna).queryByText("Not submitted")).toBeNull();
		expect(
			within(anna).getByRole("link", { name: "Open the calendar of Anna" }).getAttribute("href"),
		).toBe("/calendar/id-Anna?date=2026-03-02");
		expect(screen.getByText(/not submitted this period yet/)).toBeTruthy();
	});

	it("says when nobody in view is expected to submit, and when the period is still running", () => {
		render(
			<PeriodSubmissionOverview
				periods={[period]}
				selected={period}
				running
				rows={[]}
				counts={{ ...counts, awaiting_submission: 0, submitted: 0 }}
			/>,
		);

		expect(screen.getByText("No one you can see is expected to submit this period.")).toBeTruthy();
		expect(
			screen.getByText("This period is still running. Employees can submit it from its last day."),
		).toBeTruthy();
	});
});
