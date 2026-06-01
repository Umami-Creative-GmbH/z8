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

vi.mock("next-intl", () => ({
	useLocale: () => "de",
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
					hasStripeCustomer: true,
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

	it("offers checkout instead of the Stripe portal for local-only trials", () => {
		render(
			<BillingPageClient
				subscription={{
					id: "sub_123",
					hasStripeCustomer: false,
					status: "trialing",
					isActive: true,
					isTrialing: true,
					isPastDue: false,
					currentSeats: 4,
					trialEnd: "2026-06-01T00:00:00.000Z",
					currentPeriodEnd: null,
					billingInterval: null,
					cancelAt: null,
				}}
				accessResult={{ canAccess: true, status: "trialing" }}
				isOwner={true}
			/>,
		);

		expect(screen.queryByText("Manage Billing")).toBeNull();
		expect(screen.getByRole("button", { name: "Upgrade Monthly" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Upgrade Yearly" })).toBeTruthy();
	});

	it("formats subscription dates with the active app locale", () => {
		render(
			<BillingPageClient
				subscription={{
					id: "sub_123",
					hasStripeCustomer: true,
					status: "active",
					isActive: true,
					isTrialing: false,
					isPastDue: false,
					currentSeats: 4,
					trialEnd: null,
					currentPeriodEnd: "2026-06-15T00:00:00.000Z",
					billingInterval: "month",
					cancelAt: null,
				}}
				accessResult={{ canAccess: true, status: "active" }}
				isOwner={true}
			/>,
		);

		expect(screen.getByText("15. Juni 2026")).toBeTruthy();
		expect(screen.queryByText("Jun 15, 2026")).toBeNull();
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
