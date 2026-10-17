/* @vitest-environment jsdom */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useBillingActions } from "./billing-page/use-billing-actions";
import { BillingPageClient } from "./billing-page-client";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
				params && name in params ? String(params[name]) : placeholder,
			),
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

vi.mock("sonner", () => ({
	toast: { error: toastError },
}));

function CheckoutActionHarness() {
	const { isCheckoutLoading, startCheckout } = useBillingActions();

	return (
		<button
			disabled={isCheckoutLoading}
			onClick={() => startCheckout("month")}
			type="button"
		>
			{isCheckoutLoading ? "Starting checkout" : "Upgrade monthly"}
		</button>
	);
}

describe("BillingPageClient", () => {
	it("uses a visible settings fallback while URL state resolves", () => {
		const source = readFileSync(
			"src/components/billing/billing-page-client.tsx",
			"utf8",
		);

		expect(source).toContain(
			"<Suspense fallback={<SettingsContentLoading />}>",
		);
		expect(source).not.toContain("<Suspense fallback={null}>");
	});

	it("keeps checkout actionable after a failed request", async () => {
		const user = userEvent.setup();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValueOnce(new Error("Network error")),
		);

		render(<CheckoutActionHarness />);
		await user.click(screen.getByRole("button", { name: "Upgrade monthly" }));

		await waitFor(() => {
			expect(toastError).toHaveBeenCalledWith("Failed to start checkout");
		});
		expect(
			screen.getByRole("button", { name: "Upgrade monthly" }),
		).toHaveProperty("disabled", false);

		vi.unstubAllGlobals();
	});

	it("shows trial checkout clarification copy for trialing subscriptions", () => {
		render(
			<BillingPageClient
				subscription={{
					id: "sub_123",
					hasStripeCustomer: true,
					hasStripeSubscription: true,
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

	it("shows full pricing cards instead of the Stripe portal for local-only trials", () => {
		render(
			<BillingPageClient
				subscription={{
					id: "sub_123",
					hasStripeCustomer: false,
					hasStripeSubscription: false,
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
		expect(screen.getByText("Monthly")).toBeTruthy();
		expect(screen.getByText("Yearly")).toBeTruthy();
		expect(screen.getByText("€4")).toBeTruthy();
		expect(screen.getByText("€3")).toBeTruthy();
		expect(
			screen.getByText(
				"Choose a billing cadence now. Your paid subscription starts only after the remaining trial period.",
			),
		).toBeTruthy();
		expect(screen.queryByText(/No credit card required to start\./)).toBeNull();
		expect(
			screen.getByRole("button", { name: "Upgrade Monthly" }),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Upgrade Yearly" })).toBeTruthy();
	});

	it("shows pricing cards when a Stripe customer exists without a subscription", () => {
		render(
			<BillingPageClient
				subscription={{
					id: "sub_123",
					hasStripeCustomer: true,
					hasStripeSubscription: false,
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
		expect(screen.getByText("Monthly")).toBeTruthy();
		expect(screen.getByText("Yearly")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Upgrade Monthly" }),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Upgrade Yearly" })).toBeTruthy();
	});

	it("formats subscription dates with the active app locale", () => {
		render(
			<BillingPageClient
				subscription={{
					id: "sub_123",
					hasStripeCustomer: true,
					hasStripeSubscription: true,
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

	describe("seat lines (#886)", () => {
		const activeSubscription = {
			id: "sub_123",
			hasStripeCustomer: true,
			hasStripeSubscription: true,
			status: "active",
			isActive: true,
			isTrialing: false,
			isPastDue: false,
			currentSeats: 8,
			trialEnd: null,
			currentPeriodEnd: "2026-06-15T00:00:00.000Z",
			cancelAt: null,
		};

		// The app locale is "de" here, so amounts use German decimals, like the pricing cards.
		it("shows full and kiosk seat lines that add up to the monthly total", () => {
			render(
				<BillingPageClient
					subscription={{ ...activeSubscription, billingInterval: "month", currentKioskSeats: 5 }}
					accessResult={{ canAccess: true, status: "active" }}
					isOwner={true}
					kioskSeatsEnabled={true}
				/>,
			);

			const full = screen.getByTestId("seat-line-full");
			expect(full.textContent).toContain("Full seats");
			expect(full.textContent).toContain("3 × €4/mo");
			expect(full.textContent).toContain("€12");
			const kiosk = screen.getByTestId("seat-line-kiosk");
			expect(kiosk.textContent).toContain("Kiosk seats");
			expect(kiosk.textContent).toContain("5 × €2/mo");
			expect(kiosk.textContent).toContain("€10");
			expect(screen.getByTestId("seat-line-total").textContent).toBe("Total€22/mo");
			expect(screen.getByText("€22", { selector: "p" })).toBeTruthy();
		});

		it("prices yearly kiosk seats at €1.50 per month in the app locale", () => {
			render(
				<BillingPageClient
					subscription={{ ...activeSubscription, billingInterval: "year", currentKioskSeats: 5 }}
					accessResult={{ canAccess: true, status: "active" }}
					isOwner={true}
					kioskSeatsEnabled={true}
				/>,
			);

			const kiosk = screen.getByTestId("seat-line-kiosk");
			expect(kiosk.textContent).toContain("5 × €1,50/mo");
			expect(kiosk.textContent).toContain("€7,50");
			expect(screen.getByTestId("seat-line-total").textContent).toContain("€16,50/mo");
			expect(screen.getByText("€198/year total")).toBeTruthy();
		});

		it("shows only the full seat line while kiosk seats are off", () => {
			render(
				<BillingPageClient
					subscription={{ ...activeSubscription, billingInterval: "month", currentKioskSeats: 0 }}
					accessResult={{ canAccess: true, status: "active" }}
					isOwner={true}
				/>,
			);

			expect(screen.getByTestId("seat-line-full").textContent).toContain("8 × €4/mo");
			expect(screen.queryByTestId("seat-line-kiosk")).toBeNull();
			expect(screen.getByText("€32", { selector: "p" })).toBeTruthy();
		});

		it("names each seat line by its visible label, not by an aria-label", () => {
			render(
				<BillingPageClient
					subscription={{ ...activeSubscription, billingInterval: "month", currentKioskSeats: 5 }}
					accessResult={{ canAccess: true, status: "active" }}
					isOwner={true}
					kioskSeatsEnabled={true}
				/>,
			);

			for (const line of screen.getAllByRole("listitem")) {
				expect(line.getAttribute("aria-label")).toBeNull();
			}
		});
	});

	describe("kiosk seat prices in the pricing cards (#886)", () => {
		const localTrial = {
			id: "sub_123",
			hasStripeCustomer: false,
			hasStripeSubscription: false,
			status: "trialing",
			isActive: true,
			isTrialing: true,
			isPastDue: false,
			currentSeats: 4,
			trialEnd: "2026-06-01T00:00:00.000Z",
			currentPeriodEnd: null,
			billingInterval: null,
			cancelAt: null,
		};

		it("shows the kiosk seat price on both cards before the first subscription", () => {
			render(
				<BillingPageClient
					subscription={null}
					accessResult={{ canAccess: true }}
					isOwner={true}
					kioskSeatsEnabled={true}
				/>,
			);

			expect(screen.getAllByText(/^Kiosk seats \(kiosk-only employees\)/)).toHaveLength(2);
		});

		it("shows the kiosk seat price on the trial upgrade cards", () => {
			render(
				<BillingPageClient
					subscription={localTrial}
					accessResult={{ canAccess: true, status: "trialing" }}
					isOwner={true}
					kioskSeatsEnabled={true}
				/>,
			);

			expect(screen.getAllByText(/^Kiosk seats \(kiosk-only employees\)/)).toHaveLength(2);
		});

		it("hides the kiosk seat price while kiosk seats are off", () => {
			render(
				<BillingPageClient subscription={null} accessResult={{ canAccess: true }} isOwner={true} />,
			);

			expect(screen.queryByText(/^Kiosk seats \(kiosk-only employees\)/)).toBeNull();
		});
	});

	it("uses localized checkout keys and fallbacks", () => {
		const source = readFileSync(
			join(
				process.cwd(),
				"src/components/billing/billing-page/billing-alerts.tsx",
			),
			"utf8",
		);

		expect(source).toContain("billing.checkout.trialContinuesTitle");
		expect(source).toContain("billing.checkout.trialContinuesDescription");
	});

	it("defines checkout copy in the loaded billing namespace for supported locales", () => {
		const locales = ["en", "de", "es", "fr", "it", "pt"];

		for (const locale of locales) {
			const billingMessages = JSON.parse(
				readFileSync(
					join(process.cwd(), `messages/billing/${locale}.json`),
					"utf8",
				),
			);
			expect(billingMessages.billing.chooseUpgradePlanDescription).toBeTruthy();
			expect(billingMessages.billing.upgradeMonthly).toBeTruthy();
			expect(billingMessages.billing.upgradeYearly).toBeTruthy();
			expect(billingMessages.billing.checkout.trialContinuesTitle).toBeTruthy();
			expect(
				billingMessages.billing.checkout.trialContinuesDescription,
			).toBeTruthy();
			expect(existsSync(join(process.cwd(), `messages/${locale}.json`))).toBe(
				false,
			);
		}
	});
});
