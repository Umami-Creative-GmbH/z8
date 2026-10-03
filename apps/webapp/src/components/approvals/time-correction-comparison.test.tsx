// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApprovalInboxTimeComparison } from "@/lib/approvals/inbox/types";
import { TimeCorrectionComparison } from "./time-correction-comparison";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_, key) => String(params?.[key])),
	}),
}));

const comparison: ApprovalInboxTimeComparison = {
	type: "time_comparison",
	action: "edit",
	original: {
		start: { at: "2026-10-02T06:00:00Z", utcOffsetMinutes: 120 },
		end: { at: "2026-10-02T10:00:00Z", utcOffsetMinutes: 120 },
	},
	requested: {
		start: { at: "2026-10-02T06:00:00Z", utcOffsetMinutes: 120 },
		end: { at: "2026-10-02T11:00:00Z", utcOffsetMinutes: 120 },
	},
};

describe("TimeCorrectionComparison", () => {
	it("labels the complete original and requested ranges with elapsed time", () => {
		render(<TimeCorrectionComparison comparison={comparison} />);
		const section = screen.getByRole("region", { name: "Time comparison" });
		expect(within(section).getByText("Original")).toBeTruthy();
		expect(within(section).getByText("Requested")).toBeTruthy();
		expect(
			within(section).getByText("2026-10-02 08:00 (UTC+02:00) – 2026-10-02 12:00 (UTC+02:00)"),
		).toBeTruthy();
		expect(
			within(section).getByText("2026-10-02 08:00 (UTC+02:00) – 2026-10-02 13:00 (UTC+02:00)"),
		).toBeTruthy();
		expect(within(section).getByText("300 min elapsed")).toBeTruthy();
	});
	it("displays deletion explicitly rather than treating deletion markers as work", () => {
		render(
			<TimeCorrectionComparison
				comparison={{
					...comparison,
					action: "delete",
					requested: { start: null, end: null },
				}}
			/>,
		);
		expect(screen.getByText("Deleted")).toBeTruthy();
		expect(screen.queryByText("Unavailable – Unavailable")).toBeNull();
	});
});
