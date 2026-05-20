/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TrialBanner } from "./trial-banner";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, number>) =>
			fallback.replace("{days}", String(params?.days)),
	}),
}));

describe("TrialBanner", () => {
	it("renders trial messaging and upgrade link", () => {
		render(<TrialBanner daysRemaining={9} billingHref="/en/settings/billing" />);

		expect(screen.getByText("14-day trial active")).toBeTruthy();
		expect(
			screen.getByText(
				"9 days remaining. Add payment details now; your paid subscription starts after the trial.",
			),
		).toBeTruthy();

		const link = screen.getByRole("link", { name: "Upgrade" });
		expect(link.getAttribute("href")).toBe("/en/settings/billing");
	});

	it("is wired into the app layout billing access flow", () => {
		const layoutSource = readFileSync(
			join(process.cwd(), "src/app/[locale]/(app)/layout.tsx"),
			"utf8",
		);

		expect(layoutSource).toContain("@/components/billing/trial-banner");
		expect(layoutSource).toContain("BillingEnforcementService");
		expect(layoutSource).toContain("activeOrganizationId = session.session?.activeOrganizationId");
		expect(layoutSource).toContain("checkBillingAccess(activeOrganizationId)");
		expect(layoutSource).toContain("<TrialBanner");
		expect(layoutSource).toContain('billingAccess.state === "trialing"');
	});
});
