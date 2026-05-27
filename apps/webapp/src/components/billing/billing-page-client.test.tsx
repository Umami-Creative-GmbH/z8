/* @vitest-environment jsdom */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BillingPageClient } from "./billing-page-client";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({}),
}));

describe("BillingPageClient", () => {
	it("shows trial checkout clarification copy for trialing subscriptions", () => {
		render(
			<BillingPageClient
				subscription={{
					id: "sub_123",
					status: "trialing",
					isActive: true,
					isTrialing: true,
					isPastDue: false,
					currentSeats: 4,
					trialEnd: "2026-06-01T00:00:00.000Z",
					currentPeriodEnd: null,
					billingInterval: "month",
					cancelAt: null,
				}}
				accessResult={{ canAccess: true, status: "trialing" }}
				isOwner={true}
			/>,
		);

		expect(screen.getByText("Your trial continues after upgrade")).toBeTruthy();
		expect(
			screen.getByText(
				"Stripe Checkout collects payment details now. Your paid subscription starts only after the trial expires.",
			),
		).toBeTruthy();
	});

	it("uses localized checkout keys and fallbacks", () => {
		const source = readFileSync(
			join(process.cwd(), "src/components/billing/billing-page-client.tsx"),
			"utf8",
		);

		expect(source).toContain("useTranslate");
		expect(source).toContain("billing.checkout.trialContinuesTitle");
		expect(source).toContain("billing.checkout.trialContinuesDescription");
	});

	it("defines checkout copy in the loaded billing namespace for supported locales", () => {
		const locales = ["en", "de", "es", "fr", "it", "pt"];

		for (const locale of locales) {
			const billingMessages = JSON.parse(
				readFileSync(join(process.cwd(), `messages/billing/${locale}.json`), "utf8"),
			);
			expect(billingMessages.billing.checkout.trialContinuesTitle).toBeTruthy();
			expect(billingMessages.billing.checkout.trialContinuesDescription).toBeTruthy();
			expect(existsSync(join(process.cwd(), `messages/${locale}.json`))).toBe(false);
		}
	});
});
