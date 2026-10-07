import { db } from "@/db";
import { travelExpenseReferenceRatePolicy } from "@/db/schema";
import {
	type RefreshReferenceRatesResult,
	refreshReferenceRates,
} from "@/lib/travel-expenses/reference-rate-store";

export type TravelExpenseReferenceRatesJobResult =
	| (RefreshReferenceRatesResult & { success: boolean })
	/** No organization approved a reference source: nothing is fetched. */
	| { success: true; skipped: true };

const FETCH_TIMEOUT_MS = 60_000;

/** Fetches an ECB feed document; any network or HTTP failure rejects. */
async function fetchEcbDocument(url: string): Promise<string> {
	const response = await fetch(url, {
		headers: { Accept: "application/xml, text/xml" },
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		cache: "no-store",
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return response.text();
}

/**
 * Stores newly published and corrected ECB reference rates (#608). A failed
 * fetch is recorded on the provider state and retried on the next run;
 * drafts then report the provider as unavailable for dates it has not settled.
 */
export async function runTravelExpenseReferenceRatesJob(): Promise<TravelExpenseReferenceRatesJobResult> {
	const [approved] = await db
		.select({ organizationId: travelExpenseReferenceRatePolicy.organizationId })
		.from(travelExpenseReferenceRatePolicy)
		.limit(1);
	if (!approved) return { success: true, skipped: true };
	const result = await refreshReferenceRates(db, { fetchText: fetchEcbDocument });
	return { success: result.ok, ...result };
}
