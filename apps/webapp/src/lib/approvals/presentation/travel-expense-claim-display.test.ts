import { FormatIcu } from "@tolgee/format-icu";
import { TolgeeCore } from "@tolgee/react";
import { describe, expect, it } from "vitest";
import { resolveReviewText } from "../inbox/summary-text";
import { travelExpenseClaimDisplay } from "./travel-expense-claim-display";

async function translatorFor(language: string, translations: Record<string, string> = {}) {
	const tolgee = TolgeeCore()
		.use(FormatIcu())
		.init({ language, staticData: { [language]: translations } });
	await tolgee.run();
	return (key: string, fallback: string, params?: Record<string, string | number>) =>
		tolgee.t(key, fallback, params);
}

const claim = {
	type: "receipt" as const,
	tripStartDate: "2026-04-15",
	tripEndDate: "2026-04-17",
	destinationCity: "Berlin",
	destinationCountry: "DE",
	calculatedCurrency: "EUR",
	calculatedAmount: "120.50",
	project: { name: "Berlin rollout" },
};

const german = {
	"approvals:approvals.claimSummary.title": "Reisekosten",
	"approvals:approvals.claimSummary.summary": "{claimType} über {amount}",
	"approvals:approvals.claimSummary.type.receipt": "Beleg",
	"approvals:approvals.claimSummary.type.perDiem": "Tagegeld",
	"approvals:approvals.claimSummary.trip": "Reise",
};

describe("an earlier expense claim's list row (#1978)", () => {
	it("keeps its English texts", () => {
		expect(travelExpenseClaimDisplay(claim)).toMatchObject({
			title: "Travel Expense",
			subtitle: "Berlin - Apr 15-17, 2026",
			summary: "Receipt for EUR 120.50",
			badge: { label: "Berlin rollout", color: null },
			icon: "receipt",
		});
	});

	it("renders its title, claim type, amount and trip dates in German", async () => {
		const de = await translatorFor("de", german);
		const { localized } = travelExpenseClaimDisplay(claim);

		expect(localized).toBeDefined();
		if (!localized) return;
		expect(resolveReviewText(localized.title, de, "de")).toBe("Reisekosten");
		expect(resolveReviewText(localized.summary, de, "de")).toBe("Beleg über 120,50 €");
		expect(resolveReviewText(localized.subtitle, de, "de")).toBe(
			"Berlin - 15.04.2026 – 17.04.2026",
		);
	});

	it("names a claim without a city by its country, or as a trip, in the viewer's language", async () => {
		const de = await translatorFor("de", german);
		const byCountry = travelExpenseClaimDisplay({
			...claim,
			type: "per_diem",
			destinationCity: null,
			tripStartDate: null,
		}).localized;
		const unnamed = travelExpenseClaimDisplay({
			...claim,
			destinationCity: null,
			destinationCountry: null,
			tripStartDate: null,
		}).localized;

		expect(resolveReviewText(byCountry!.subtitle, de, "de")).toBe("Deutschland");
		expect(resolveReviewText(byCountry!.summary, de, "de")).toBe("Tagegeld über 120,50 €");
		expect(resolveReviewText(unnamed!.subtitle, de, "de")).toBe("Reise");
	});
});
