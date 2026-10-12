// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UnmappedOvertimePayoutsWarning } from "./overtime-payout-readiness-alert";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
				fallback,
			),
	}),
}));
vi.mock("@/app/[locale]/(app)/payroll/actions", () => ({
	getOvertimePayoutExportReadinessAction: vi.fn(),
}));

describe("UnmappedOvertimePayoutsWarning (#1001)", () => {
	it("warns before exporting that the format has no overtime wage type for the payouts", () => {
		render(<UnmappedOvertimePayoutsWarning count={2} />);

		expect(screen.getByRole("alert").textContent).toContain(
			"No wage type is mapped to Overtime for this format",
		);
	});

	it("shows nothing while no payout would be left out", () => {
		const { container } = render(<UnmappedOvertimePayoutsWarning count={0} />);

		expect(container.textContent).toBe("");
	});
});
