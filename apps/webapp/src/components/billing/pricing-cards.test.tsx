/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BillingPricingCards } from "./pricing-cards";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(message, [name, value]) => message.replace(`{${name}}`, String(value)),
				fallback,
			),
	}),
}));

const { locale } = vi.hoisted(() => ({ locale: { current: "en" } }));

vi.mock("next-intl", () => ({
	useLocale: () => locale.current,
}));

function renderCards(kioskSeatsEnabled?: boolean) {
	render(
		<BillingPricingCards
			buttonLabels={{ monthly: "Start monthly", yearly: "Start yearly" }}
			isLoading={false}
			kioskSeatsEnabled={kioskSeatsEnabled}
			onSubscribe={() => {}}
		/>,
	);
}

describe("BillingPricingCards", () => {
	it("shows the kiosk seat price next to the full seat price for both intervals", () => {
		renderCards(true);

		expect(screen.getByText("€4")).toBeTruthy();
		expect(screen.getByText("Kiosk seats (kiosk-only employees): €2/seat/month")).toBeTruthy();
		expect(screen.getByText("€3")).toBeTruthy();
		expect(screen.getByText("€36/seat billed annually")).toBeTruthy();
		expect(
			screen.getByText(
				"Kiosk seats (kiosk-only employees): €1.50/seat/month, €18/seat billed annually",
			),
		).toBeTruthy();
	});

	it("formats the kiosk seat price in the app locale", () => {
		locale.current = "de";
		try {
			renderCards(true);
		} finally {
			locale.current = "en";
		}

		expect(
			screen.getByText(
				"Kiosk seats (kiosk-only employees): €1,50/seat/month, €18/seat billed annually",
			),
		).toBeTruthy();
	});

	it("shows only the full seat price while kiosk seats are off", () => {
		renderCards();

		expect(screen.getByText("€4")).toBeTruthy();
		expect(screen.getByText("€3")).toBeTruthy();
		expect(screen.queryByText(/Kiosk seats/)).toBeNull();
	});
});
