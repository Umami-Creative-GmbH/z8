import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	ecbReferenceRateSettledAt,
	parseEcbReferenceRateXml,
	pickReferencePublication,
	type ReferencePublication,
	type ReferenceRateCoverage,
	resolveReferenceRate,
} from "../reference-rate";
import { ecbDays, ecbFeedXml } from "./ecb-reference-rates-fixture";

/** #608: ECB reference rates with an explicit previous-publication fallback. */

function publications(from: string, through: string): ReferencePublication[] {
	const parsed = parseEcbReferenceRateXml(ecbFeedXml(ecbDays(from, through)));
	if (!parsed.ok) throw new Error("fixture did not parse");
	return parsed.days.map((day) => ({
		id: `pub-${day.date}`,
		provider: "ecb",
		publicationDate: day.date,
		version: 1,
		rates: day.rates,
		contentSha256: "f".repeat(64),
		retrievedAt: "2026-10-06T14:00:00Z",
	}));
}

/** The history is known from the first fixture day and was fetched long after. */
const settled: ReferenceRateCoverage = {
	historyFrom: "2022-02-25",
	latestSuccessAt: "2026-10-06T16:00:00Z",
};
const now = Temporal.Instant.from("2026-10-06T16:30:00Z");

function resolve(
	expenseDate: string,
	options: {
		pair?: [string, string];
		available?: ReferencePublication[];
		coverage?: ReferenceRateCoverage;
		now?: Temporal.Instant;
	} = {},
) {
	const [sourceCurrency, targetCurrency] = options.pair ?? ["USD", "EUR"];
	const available = options.available ?? publications("2022-02-25", "2026-04-08");
	return resolveReferenceRate({
		expenseDate,
		sourceCurrency,
		targetCurrency,
		...pickReferencePublication(available, expenseDate),
		coverage: options.coverage ?? settled,
		now: options.now ?? now,
	});
}

describe("parseEcbReferenceRateXml", () => {
	it("reads every publication day of an official feed, oldest first, with exact rates", () => {
		const parsed = parseEcbReferenceRateXml(ecbFeedXml(ecbDays("2026-03-30", "2026-04-08")));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.days.map((day) => day.date)).toEqual([
			"2026-03-30",
			"2026-03-31",
			"2026-04-01",
			"2026-04-02",
			"2026-04-07",
			"2026-04-08",
		]);
		const easterThursday = parsed.days[3];
		expect(easterThursday?.rates.USD).toBe("1.1525");
		expect(easterThursday?.rates.CHF).toBe("0.9213");
		expect(Object.keys(easterThursday?.rates ?? {})).toHaveLength(29);
	});

	it("refuses a document that is not an ECB rate feed instead of storing nothing as rates", () => {
		expect(parseEcbReferenceRateXml("<html>maintenance</html>")).toEqual({
			ok: false,
			reason: "malformed",
		});
		expect(parseEcbReferenceRateXml(ecbFeedXml([]))).toEqual({ ok: false, reason: "empty" });
		const badRate = ecbFeedXml(ecbDays("2026-04-08", "2026-04-08")).replace(
			'rate="1.1706"',
			'rate="-1"',
		);
		expect(parseEcbReferenceRateXml(badRate)).toEqual({ ok: false, reason: "malformed" });
	});
});

describe("resolveReferenceRate", () => {
	it("applies the publication of the expense date itself", () => {
		const result = resolve("2026-04-02");
		expect(result).toMatchObject({
			status: "applied",
			fallback: false,
			publication: { publicationDate: "2026-04-02" },
			rate: { base: "EUR", quote: "USD", value: "1.1525" },
		});
	});

	it("falls back over Easter TARGET closing days to the last publication before them", () => {
		for (const date of ["2026-04-03", "2026-04-04", "2026-04-05", "2026-04-06"]) {
			expect(resolve(date)).toMatchObject({
				status: "applied",
				fallback: true,
				publication: { publicationDate: "2026-04-02" },
				rate: { base: "EUR", quote: "USD", value: "1.1525" },
			});
		}
	});

	it("falls back over Christmas and New Year closing days", () => {
		expect(resolve("2025-12-26")).toMatchObject({
			status: "applied",
			publication: { publicationDate: "2025-12-24" },
		});
		expect(resolve("2026-01-01", { pair: ["CHF", "EUR"] })).toMatchObject({
			status: "applied",
			publication: { publicationDate: "2025-12-31" },
			rate: { base: "EUR", quote: "CHF", value: "0.9314" },
		});
	});

	it("quotes the pair as published when the reimbursement currency is not the euro", () => {
		expect(resolve("2026-04-07", { pair: ["EUR", "CHF"] })).toMatchObject({
			status: "applied",
			rate: { base: "EUR", quote: "CHF", value: "0.9242" },
		});
	});

	it("never derives a cross rate between two non-euro currencies", () => {
		expect(resolve("2026-04-07", { pair: ["USD", "CHF"] })).toEqual({
			status: "unavailable",
			reason: "pair_unsupported",
		});
	});

	it("treats a ceased currency as unavailable even though an older publication had it", () => {
		// RUB was last published on 2022-03-01 and suspended from 2022-03-02.
		expect(resolve("2022-03-01", { pair: ["RUB", "EUR"] })).toMatchObject({
			status: "applied",
			rate: { value: "117.201" },
		});
		expect(resolve("2022-03-02", { pair: ["RUB", "EUR"] })).toEqual({
			status: "unavailable",
			reason: "currency_unavailable",
		});
		// The lev was last published on 2025-12-31; Bulgaria adopted the euro.
		expect(resolve("2026-01-02", { pair: ["BGN", "EUR"] })).toEqual({
			status: "unavailable",
			reason: "currency_unavailable",
		});
	});

	it("treats a currency ECB never publishes as unavailable", () => {
		expect(resolve("2026-04-07", { pair: ["KES", "EUR"] })).toEqual({
			status: "unavailable",
			reason: "currency_unavailable",
		});
	});

	it("never uses a publication from after the expense date", () => {
		// Only publications after the expense date are known: nothing on or before it.
		expect(
			resolve("2026-04-06", {
				available: publications("2026-04-07", "2026-04-08"),
				coverage: { historyFrom: "2026-04-07", latestSuccessAt: "2026-04-08T17:00:00Z" },
			}),
		).toEqual({ status: "unavailable", reason: "history_unavailable" });
	});

	it("does not fall back before the expense date's own publication time has passed", () => {
		// 2026-04-08 is a working day; at 14:00 UTC (16:00 Frankfurt) it may not be fetched yet.
		const morning = Temporal.Instant.from("2026-04-08T08:00:00Z");
		const available = publications("2026-03-30", "2026-04-07");
		const coverage = { historyFrom: "2026-03-30", latestSuccessAt: "2026-04-08T07:55:00Z" };
		expect(resolve("2026-04-08", { available, coverage, now: morning })).toEqual({
			status: "unavailable",
			reason: "not_yet_published",
		});
		// An expense dated in the future has no publication yet either.
		expect(resolve("2026-04-09", { available, coverage, now: morning })).toEqual({
			status: "unavailable",
			reason: "not_yet_published",
		});
	});

	it("reports the provider unavailable when no fetch succeeded since the date's publication time", () => {
		const evening = Temporal.Instant.from("2026-04-08T19:00:00Z");
		const available = publications("2026-03-30", "2026-04-07");
		expect(
			resolve("2026-04-08", {
				available,
				coverage: { historyFrom: "2026-03-30", latestSuccessAt: "2026-04-08T07:55:00Z" },
				now: evening,
			}),
		).toEqual({ status: "unavailable", reason: "provider_unavailable" });
		// Once a later fetch confirmed the weekend has no publication, Friday applies.
		const saturday = Temporal.Instant.from("2026-04-11T19:00:00Z");
		expect(
			resolve("2026-04-11", {
				available: publications("2026-03-30", "2026-04-08"),
				coverage: { historyFrom: "2026-03-30", latestSuccessAt: "2026-04-11T18:00:00Z" },
				now: saturday,
			}),
		).toMatchObject({ status: "applied", publication: { publicationDate: "2026-04-08" } });
	});

	it("does not reach before the known history or stretch a fallback beyond a week", () => {
		expect(resolve("2022-02-24")).toEqual({
			status: "unavailable",
			reason: "history_unavailable",
		});
		expect(
			resolve("2026-01-06", { coverage: { historyFrom: null, latestSuccessAt: null } }),
		).toEqual({ status: "unavailable", reason: "history_unavailable" });
		// Without the March fixture days, 2026-03-30 is more than 7 days after 2026-01-06.
		expect(resolve("2026-03-29", { available: publications("2022-02-25", "2026-01-06") })).toEqual({
			status: "unavailable",
			reason: "rate_stale",
		});
	});
});

describe("ecbReferenceRateSettledAt", () => {
	it("is 18:00 Frankfurt time of the publication date, in summer and winter", () => {
		expect(ecbReferenceRateSettledAt("2026-04-08").toString()).toBe("2026-04-08T16:00:00Z");
		expect(ecbReferenceRateSettledAt("2026-01-05").toString()).toBe("2026-01-05T17:00:00Z");
	});
});
