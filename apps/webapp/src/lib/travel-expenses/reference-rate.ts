import { Temporal } from "temporal-polyfill";
import { type Instant, parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { type ExchangeRate, normalizeRate } from "./currency-conversion";
import type { ReferenceRateAcknowledgement, ReferenceRateProvider } from "./reference-rate.types";

/**
 * Reference exchange rates an organization explicitly approved as a
 * conversion basis (#608). The only provider is the European Central Bank's
 * euro foreign exchange reference rates: one publication per TARGET working
 * day, around 16:00 Frankfurt time, quoted as `1 EUR = rate X` for a limited
 * and changing set of currencies (the rouble is suspended since 2022-03-02,
 * the lev ended when Bulgaria adopted the euro). ECB publishes them for
 * information only, so an organization must opt in; an evidenced card charge
 * or an authorized documented rate always takes precedence.
 *
 * An expense uses the latest publication on or before its date, and shows
 * that publication's real date. The fallback never reaches into the future,
 * never walks past the latest publication to find a currency it no longer
 * carries, and never decides before the expense date's own publication could
 * have been fetched. Everything here is pure; storage is in
 * `reference-rate-store.ts`.
 */

export {
	REFERENCE_RATE_ACKNOWLEDGEMENTS,
	REFERENCE_RATE_PROVIDERS,
	type ReferenceRateAcknowledgement,
	type ReferenceRateProvider,
} from "./reference-rate.types";

/** The statement each source's approval form currently shows. */
export const CURRENT_REFERENCE_RATE_ACKNOWLEDGEMENT = {
	ecb: "ecb_information_only_v1",
} as const satisfies Record<ReferenceRateProvider, ReferenceRateAcknowledgement>;

export const ECB_REFERENCE_RATES = {
	provider: "ecb",
	/** Every rate is quoted against the euro. */
	base: "EUR",
	/** The last 90 publications; fetched routinely. */
	recentFeedUrl: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml",
	/** Every publication since 1999-01-04 (about 8 MB); fetched to backfill. */
	fullHistoryUrl: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml",
	/** ECB publishes "around 16:00 CET", i.e. Frankfurt local time. */
	publicationZone: "Europe/Berlin",
	/**
	 * Local time after which a date without a fetched publication is taken to
	 * have none; two hours of headroom over the usual 16:00.
	 */
	settledAfter: Temporal.PlainTime.from("18:00"),
	/**
	 * Longest previous-publication fallback. TARGET closures span at most four
	 * days (Good Friday to Easter Monday); a longer gap means the feed stopped.
	 */
	maxFallbackDays: 7,
} as const;

export interface ReferenceRateDay {
	/** Publication date; it has no zone. */
	date: string;
	/** `1 EUR = rate` per ISO currency code, as normalized decimal strings. */
	rates: Record<string, string>;
}

const DAY_BLOCK = /<Cube\s+time="([^"]*)"\s*>([\s\S]*?)<\/Cube>/g;
const RATE_ENTRY = /<Cube\s+currency="([^"]*)"\s+rate="([^"]*)"\s*\/>/g;
const CURRENCY_CODE = /^[A-Z]{3}$/;

/**
 * Reads an ECB reference-rate feed (daily, 90-day or full history XML). The
 * whole document is refused when any day or rate is malformed, so a broken
 * download never stores a partial publication.
 */
export function parseEcbReferenceRateXml(
	xml: string,
): { ok: true; days: ReferenceRateDay[] } | { ok: false; reason: "malformed" | "empty" } {
	if (!xml.includes("<gesmes:Envelope") || !xml.includes("eurofxref")) {
		return { ok: false, reason: "malformed" };
	}
	const days = new Map<string, Record<string, string>>();
	for (const [, date = "", body = ""] of xml.matchAll(DAY_BLOCK)) {
		try {
			parsePlainDate(date);
		} catch {
			return { ok: false, reason: "malformed" };
		}
		if (days.has(date)) return { ok: false, reason: "malformed" };
		const rates: Record<string, string> = {};
		for (const [, currency = "", rate = ""] of body.matchAll(RATE_ENTRY)) {
			const value = normalizeRate(rate);
			if (!CURRENCY_CODE.test(currency) || currency === "EUR" || !value || currency in rates) {
				return { ok: false, reason: "malformed" };
			}
			rates[currency] = value;
		}
		if (Object.keys(rates).length === 0) return { ok: false, reason: "malformed" };
		days.set(date, rates);
	}
	if (days.size === 0) return { ok: false, reason: "empty" };
	return {
		ok: true,
		days: [...days.entries()]
			.map(([date, rates]) => ({ date, rates }))
			.toSorted((left, right) => left.date.localeCompare(right.date)),
	};
}

/** One stored publication; a corrected publication is a new version of its date. */
export interface ReferencePublication {
	id: string;
	provider: ReferenceRateProvider;
	publicationDate: string;
	version: number;
	rates: Record<string, string>;
	/** SHA-256 of the canonical rates, so a correction is recognizable. */
	contentSha256: string;
	/** Canonical UTC instant this version was first fetched. */
	retrievedAt: string;
}

/** How far the stored history of a provider is known to be complete. */
export interface ReferenceRateCoverage {
	/** Earliest date from which every publication is stored; null before any fetch. */
	historyFrom: string | null;
	/** Canonical instant of the latest successful fetch. */
	latestSuccessAt: string | null;
}

/** What `resolveReferenceRate` needs from the stored publications around a date. */
export interface ReferencePublicationCandidates {
	/** The latest current publication on or before the expense date. */
	publication: ReferencePublication | null;
	/** Whether a publication after the expense date is stored. */
	laterPublicationExists: boolean;
}

/** Picks the candidates for `expenseDate` from current publications (any order). */
export function pickReferencePublication(
	publications: readonly ReferencePublication[],
	expenseDate: string,
): ReferencePublicationCandidates {
	let publication: ReferencePublication | null = null;
	let laterPublicationExists = false;
	for (const candidate of publications) {
		if (candidate.publicationDate > expenseDate) laterPublicationExists = true;
		else if (!publication || candidate.publicationDate > publication.publicationDate) {
			publication = candidate;
		}
	}
	return { publication, laterPublicationExists };
}

export type ReferenceRateUnavailableReason =
	/** Neither currency is the euro: ECB quotes no cross rates and none is derived. */
	| "pair_unsupported"
	/** The expense date's publication cannot have been fetched yet. */
	| "not_yet_published"
	/** No fetch succeeded since the expense date's publication time (an outage). */
	| "provider_unavailable"
	/** The stored history does not reach back to the expense date. */
	| "history_unavailable"
	/** The applicable publication does not carry the currency (never, or no longer). */
	| "currency_unavailable"
	/** The latest publication is older than the allowed fallback. */
	| "rate_stale";

export type ReferenceRateResolution =
	| {
			status: "applied";
			publication: ReferencePublication;
			/** As published: `1 EUR = value X`. */
			rate: ExchangeRate;
			/** Whether an earlier publication stands in for the expense date. */
			fallback: boolean;
	  }
	| { status: "unavailable"; reason: ReferenceRateUnavailableReason };

/** The instant after which `date` is taken to have no publication unless one was fetched. */
export function ecbReferenceRateSettledAt(date: string): Instant {
	return parsePlainDate(date)
		.toZonedDateTime({
			timeZone: ECB_REFERENCE_RATES.publicationZone,
			plainTime: ECB_REFERENCE_RATES.settledAfter,
		})
		.toInstant();
}

function unavailable(reason: ReferenceRateUnavailableReason): ReferenceRateResolution {
	return { status: "unavailable", reason };
}

/**
 * The reference rate for converting `sourceCurrency` into `targetCurrency` on
 * `expenseDate`: the latest publication on or before that date, provided the
 * date's own publication is settled (fetched, or known not to exist) and the
 * publication carries the currency.
 */
export function resolveReferenceRate(
	input: {
		expenseDate: string;
		sourceCurrency: string;
		targetCurrency: string;
		coverage: ReferenceRateCoverage;
		now: Instant;
	} & ReferencePublicationCandidates,
): ReferenceRateResolution {
	const { base } = ECB_REFERENCE_RATES;
	const quoted =
		input.sourceCurrency === base
			? input.targetCurrency
			: input.targetCurrency === base
				? input.sourceCurrency
				: null;
	if (!quoted || quoted === base) return unavailable("pair_unsupported");

	const { expenseDate, publication, coverage } = input;
	const settledAt = ecbReferenceRateSettledAt(expenseDate);
	const ownPublication = publication?.publicationDate === expenseDate;
	if (!ownPublication && !input.laterPublicationExists) {
		const fetchedAfter =
			coverage.latestSuccessAt !== null &&
			Temporal.Instant.compare(parseInstant(coverage.latestSuccessAt), settledAt) >= 0;
		if (!fetchedAfter) {
			return unavailable(
				Temporal.Instant.compare(input.now, settledAt) < 0
					? "not_yet_published"
					: "provider_unavailable",
			);
		}
	}

	if (!publication || coverage.historyFrom === null || expenseDate < coverage.historyFrom) {
		return unavailable("history_unavailable");
	}
	const gap = parsePlainDate(publication.publicationDate).until(parsePlainDate(expenseDate)).days;
	if (gap > ECB_REFERENCE_RATES.maxFallbackDays) return unavailable("rate_stale");
	const value = publication.rates[quoted];
	if (!value) return unavailable("currency_unavailable");
	return {
		status: "applied",
		publication,
		rate: { base, quote: quoted, value },
		fallback: !ownPublication,
	};
}
