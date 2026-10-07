import { createHash } from "node:crypto";
import { and, between, eq, isNull, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { user } from "@/db/auth-schema";
import {
	travelExpenseReferenceRatePolicy,
	travelExpenseReferenceRateProviderState,
	travelExpenseReferenceRatePublication,
} from "@/db/schema";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	ECB_REFERENCE_RATES,
	parseEcbReferenceRateXml,
	type ReferenceRateAcknowledgement,
	type ReferenceRateDay,
	type ReferenceRateProvider,
} from "./reference-rate";
import { loadReferenceRatePolicy, type ReferenceRatePolicyView } from "./reference-rate-read";

/**
 * Fetching and storing reference-rate publications (#608). A scheduled job
 * (`cron:travel-expense-reference-rates`) calls `refreshReferenceRates`
 * hourly with the real network fetcher; tests inject one. The first run, and
 * any run after a long outage, backfills the full history; later runs read the
 * 90-day feed. A publication whose rates differ from the stored current
 * version is an ECB correction: the old version is kept and superseded, never
 * overwritten, so frozen submissions stay traceable.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** After this long without a successful fetch the 90-day feed may have a gap. */
const FULL_HISTORY_AFTER_DAYS = 80;
const MAX_FAILURE_LENGTH = 500;
const INSERT_CHUNK = 500;

export type ReferenceRateFeed = "full" | "recent";

export type RefreshReferenceRatesResult =
	| { ok: true; feed: ReferenceRateFeed; inserted: number; corrected: number; unchanged: number }
	| { ok: false; feed: ReferenceRateFeed; failure: string };

/** Returns the document at `url`; rejects on any transport or HTTP failure. */
export type ReferenceRateFetcher = (url: string) => Promise<string>;

/** SHA-256 of a publication's rates in canonical (code-sorted) form. */
export function referenceRatesSha256(rates: Record<string, string>): string {
	const canonical = Object.keys(rates)
		.toSorted()
		.map((currency) => [currency, rates[currency]]);
	return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

async function loadState(database: Database | Transaction, provider: ReferenceRateProvider) {
	const [state] = await database
		.select()
		.from(travelExpenseReferenceRateProviderState)
		.where(eq(travelExpenseReferenceRateProviderState.provider, provider))
		.limit(1);
	return state ?? null;
}

function chooseFeed(state: Awaited<ReturnType<typeof loadState>>, now: Instant): ReferenceRateFeed {
	if (!state?.historyFrom || !state.latestSuccessAt) return "full";
	const age = instantFromDate(state.latestSuccessAt).until(now, { largestUnit: "hours" });
	return age.hours > FULL_HISTORY_AFTER_DAYS * 24 ? "full" : "recent";
}

async function recordFailure(
	database: Database,
	provider: ReferenceRateProvider,
	failure: string,
	at: Date,
) {
	const latestFailure = failure.slice(0, MAX_FAILURE_LENGTH);
	await database
		.insert(travelExpenseReferenceRateProviderState)
		.values({ provider, latestAttemptAt: at, latestFailure, latestFailureAt: at })
		.onConflictDoUpdate({
			target: travelExpenseReferenceRateProviderState.provider,
			set: { latestAttemptAt: at, latestFailure, latestFailureAt: at },
		});
}

/**
 * Fetches the provider's feed and stores its publications. A failed fetch or
 * a malformed document is recorded and changes no publication.
 */
export async function refreshReferenceRates(
	database: Database,
	options: { fetchText: ReferenceRateFetcher; now?: Instant },
): Promise<RefreshReferenceRatesResult> {
	const now = options.now ?? systemClock.nowInstant();
	const at = dateFromInstant(now);
	const provider = ECB_REFERENCE_RATES.provider;
	const feed = chooseFeed(await loadState(database, provider), now);
	const url =
		feed === "full" ? ECB_REFERENCE_RATES.fullHistoryUrl : ECB_REFERENCE_RATES.recentFeedUrl;

	let document: string;
	try {
		document = await options.fetchText(url);
	} catch (error) {
		const failure = `fetch failed: ${error instanceof Error ? error.message : String(error)}`;
		await recordFailure(database, provider, failure, at);
		return { ok: false, feed, failure };
	}
	const parsed = parseEcbReferenceRateXml(document);
	if (!parsed.ok) {
		const failure = `feed ${parsed.reason}`;
		await recordFailure(database, provider, failure, at);
		return { ok: false, feed, failure };
	}
	const counts = await ingestReferenceRateDays(database, {
		provider,
		feed,
		days: parsed.days,
		sourceUrl: url,
		retrievedAt: at,
	});
	return { ok: true, feed, ...counts };
}

/**
 * Records an expense administrator's explicit approval of a reference source
 * for the organization (the caller checks the permission), with the versioned
 * statement they acknowledged for it. Approving again renews the approval and
 * its acknowledgement; the approver is kept by name.
 */
export async function approveReferenceRatePolicy(
	database: Database,
	input: {
		organizationId: string;
		userId: string;
		provider: ReferenceRateProvider;
		acknowledgement: ReferenceRateAcknowledgement;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<ReferenceRatePolicyView | null> {
	const [approver] = await database
		.select({ name: user.name })
		.from(user)
		.where(eq(user.id, input.userId))
		.limit(1);
	if (!approver) return null;
	const at = dateFromInstant(now);
	const values = {
		provider: input.provider,
		approvedBy: input.userId,
		approvedByName: approver.name,
		approvedAt: at,
		acknowledgement: input.acknowledgement,
		acknowledgedAt: at,
	};
	await database
		.insert(travelExpenseReferenceRatePolicy)
		.values({ organizationId: input.organizationId, ...values })
		.onConflictDoUpdate({ target: travelExpenseReferenceRatePolicy.organizationId, set: values });
	return loadReferenceRatePolicy(database, input.organizationId);
}

/** Turns reference conversion off for the organization's drafts; submissions keep theirs. */
export async function revokeReferenceRatePolicy(
	database: Database,
	organizationId: string,
): Promise<boolean> {
	const removed = await database
		.delete(travelExpenseReferenceRatePolicy)
		.where(eq(travelExpenseReferenceRatePolicy.organizationId, organizationId))
		.returning({ provider: travelExpenseReferenceRatePolicy.provider });
	return removed.length > 0;
}

/** Stores a parsed feed in one transaction; the provider state row serializes runs. */
export async function ingestReferenceRateDays(
	database: Database,
	input: {
		provider: ReferenceRateProvider;
		feed: ReferenceRateFeed;
		/** Oldest first, as `parseEcbReferenceRateXml` returns them. */
		days: readonly ReferenceRateDay[];
		sourceUrl: string;
		retrievedAt: Date;
	},
): Promise<{ inserted: number; corrected: number; unchanged: number }> {
	const earliest = input.days[0]?.date;
	const latest = input.days.at(-1)?.date;
	if (!earliest || !latest) return { inserted: 0, corrected: 0, unchanged: 0 };
	const { provider, retrievedAt: at } = input;
	return database.transaction(async (tx) => {
		await tx
			.insert(travelExpenseReferenceRateProviderState)
			.values({ provider, latestAttemptAt: at })
			.onConflictDoNothing();
		const [state] = await tx
			.select()
			.from(travelExpenseReferenceRateProviderState)
			.where(eq(travelExpenseReferenceRateProviderState.provider, provider))
			.for("update");
		// Read only once the provider state lock above serializes ingest runs.
		// react-doctor-disable-next-line react-doctor/server-sequential-independent-await
		const [stored] = await tx
			.select({
				latest: sql<
					string | null
				>`max(${travelExpenseReferenceRatePublication.publicationDate})::text`,
			})
			.from(travelExpenseReferenceRatePublication)
			.where(eq(travelExpenseReferenceRatePublication.provider, provider));

		const current = await tx
			.select()
			.from(travelExpenseReferenceRatePublication)
			.where(
				and(
					eq(travelExpenseReferenceRatePublication.provider, provider),
					isNull(travelExpenseReferenceRatePublication.supersededAt),
					between(travelExpenseReferenceRatePublication.publicationDate, earliest, latest),
				),
			);
		const currentByDate = new Map(current.map((row) => [row.publicationDate, row]));

		const fresh: (typeof travelExpenseReferenceRatePublication.$inferInsert)[] = [];
		let corrected = 0;
		let unchanged = 0;
		for (const day of input.days) {
			const contentSha256 = referenceRatesSha256(day.rates);
			const existing = currentByDate.get(day.date);
			const row = {
				provider,
				publicationDate: day.date,
				rates: day.rates,
				contentSha256,
				sourceUrl: input.sourceUrl,
				retrievedAt: at,
			};
			if (!existing) {
				fresh.push({ ...row, version: 1 });
			} else if (existing.contentSha256 === contentSha256) {
				unchanged += 1;
			} else {
				// A correction supersedes the current row before its next version is inserted.
				// react-doctor-disable-next-line react-doctor/async-await-in-loop
				await tx
					.update(travelExpenseReferenceRatePublication)
					.set({ supersededAt: at })
					.where(eq(travelExpenseReferenceRatePublication.id, existing.id));
				await tx
					.insert(travelExpenseReferenceRatePublication)
					.values({ ...row, version: existing.version + 1 });
				corrected += 1;
			}
		}
		for (let index = 0; index < fresh.length; index += INSERT_CHUNK) {
			// Chunked on purpose: it bounds statement size, in the ingest transaction.
			// react-doctor-disable-next-line react-doctor/async-await-in-loop
			await tx
				.insert(travelExpenseReferenceRatePublication)
				.values(fresh.slice(index, index + INSERT_CHUNK));
		}

		// The stored history stays complete only if this feed reaches back to it.
		const contiguous =
			input.feed === "recent" &&
			!!state?.historyFrom &&
			!!stored?.latest &&
			stored.latest >= earliest;
		const historyFrom = contiguous ? (state?.historyFrom ?? earliest) : earliest;
		await tx
			.update(travelExpenseReferenceRateProviderState)
			.set({ historyFrom, latestSuccessAt: at, latestAttemptAt: at })
			.where(eq(travelExpenseReferenceRateProviderState.provider, provider));
		return { inserted: fresh.length, corrected, unchanged };
	});
}
