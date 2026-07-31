/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComplianceAlertBanner } from "@/components/compliance/compliance-alert-banner";
import type { ComplianceAlert } from "@/db/schema";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

describe("ComplianceAlertBanner", () => {
	it("preserves alert identity when severity sorting reorders updated alerts", () => {
		const firstAlert: ComplianceAlert = {
			alertType: "daily_hours",
			severity: "warning",
			message: "Daily hours at 80%",
		};
		const secondAlert: ComplianceAlert = {
			alertType: "weekly_hours",
			severity: "violation",
			message: "Weekly hours at 100%",
		};
		const { rerender } = render(
			<ComplianceAlertBanner alerts={[firstAlert, secondAlert]} />,
		);
		const firstAlertNode = screen
			.getByText(firstAlert.message)
			.closest('[role="alert"]');
		const secondAlertNode = screen
			.getByText(secondAlert.message)
			.closest('[role="alert"]');

		rerender(
			<ComplianceAlertBanner
				alerts={[
					{ ...firstAlert, severity: "violation", message: "Daily hours at 100%" },
					{ ...secondAlert, severity: "warning", message: "Weekly hours at 80%" },
				]}
			/>,
		);

		expect(screen.getByText("Daily hours at 100%").closest('[role="alert"]')).toBe(
			firstAlertNode,
		);
		expect(screen.getByText("Weekly hours at 80%").closest('[role="alert"]')).toBe(
			secondAlertNode,
		);
	});
});
