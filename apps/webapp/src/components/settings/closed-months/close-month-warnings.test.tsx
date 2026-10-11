// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CloseMonthWarning } from "@/lib/time-tracking/closed-months/close-warnings";
import { CloseMonthWarningList } from "./close-month-warnings";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
				fallback,
			),
	}),
}));
vi.mock("@/app/[locale]/(app)/settings/closed-months/actions", () => ({
	getMonthCloseWarningsAction: vi.fn(),
}));

const warning = (
	employeeName: string,
	startDate: string,
	endDate: string,
	status: CloseMonthWarning["status"],
): CloseMonthWarning => ({
	kind: "period_submission",
	employeeId: `${employeeName}-id`,
	employeeName,
	startDate,
	endDate,
	status,
});

describe("CloseMonthWarningList (#1065)", () => {
	it("lists missing and unapproved period submissions as a warning that does not stop the close", () => {
		render(
			<CloseMonthWarningList
				warnings={[
					warning("Ada", "2026-03-23", "2026-03-29", "awaiting_submission"),
					warning("Ada", "2026-03-30", "2026-04-05", "rejected"),
					warning("Bo", "2026-03-01", "2026-03-31", "sent_back_after_change"),
				]}
			/>,
		);

		const text = screen.getByRole("status").textContent;
		expect(text).toContain("This does not stop the close");
		expect(text).toContain("Ada: period 2026-03-23 – 2026-03-29 not submitted");
		expect(text).toContain("Ada: period 2026-03-30 – 2026-04-05 rejected");
		expect(text).toContain("Bo: period 2026-03-01 – 2026-03-31 sent back after a change");
	});

	it("shortens a long list", () => {
		const warnings = Array.from({ length: 13 }, (_, index) =>
			warning(`Person ${index}`, "2026-03-01", "2026-03-31", "awaiting_submission"),
		);

		render(<CloseMonthWarningList warnings={warnings} />);

		expect(screen.getAllByRole("listitem")).toHaveLength(10);
		expect(screen.getByRole("status").textContent).toContain("and 3 more");
	});

	it("shows nothing without warnings", () => {
		const { container } = render(<CloseMonthWarningList warnings={[]} />);

		expect(container.textContent).toBe("");
	});
});
