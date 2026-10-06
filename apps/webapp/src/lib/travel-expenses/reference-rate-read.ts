import { and, asc, desc, eq, gt, isNull, lte, max } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	type TravelExpenseReportStatus,
	travelExpenseReferenceRatePolicy,
	travelExpenseReferenceRateProviderState,
	travelExpenseReferenceRatePublication,
} from "@/db/schema";
import {
	type Instant,
	instantFromDate,
	instantToCanonicalString,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { loadReportConversions } from "./conversion-read";
import type { ItemConversion } from "./currency-conversion";
import {
	ECB_REFERENCE_RATES,
	type ReferencePublication,
	type ReferencePublicationCandidates,
	type ReferenceRateCoverage,
	type ReferenceRateProvider,
	resolveReferenceRate,
} from "./reference-rate";
import {
	type ReferenceRateItemStatus,
	recordedConversionApplies,
	referenceRateConversion,
} from "./reference-rate-conversion";
import { isEditableReportStatus } from "./report-return";

/**
 * Reads of #608: the organization's approved reference source, the stored
 * publications, and the conversions report items count with. Editable
 * reports derive their reference conversions on every read; submitted
 * reports keep the rows their submission stored.
 */

type Database = typeof appDb;
type Reader = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface ReferenceRatePolicyView {
	provider: ReferenceRateProvider;
	approvedByName: string;
	/** Canonical UTC instant of the approval. */
	approvedAt: string;
}

export async function loadReferenceRatePolicy(
	database: Reader,
	organizationId: string,
): Promise<ReferenceRatePolicyView | null> {
	const [row] = await database
		.select()
		.from(travelExpenseReferenceRatePolicy)
		.where(eq(travelExpenseReferenceRatePolicy.organizationId, organizationId))
		.limit(1);
	return row
		? {
				provider: row.provider,
				approvedByName: row.approvedByName,
				approvedAt: instantToCanonicalString(instantFromDate(row.approvedAt)),
			}
		: null;
}

export interface ReferenceRateProviderStatus extends ReferenceRateCoverage {
	provider: ReferenceRateProvider;
	latestPublicationDate: string | null;
	latestFailure: string | null;
	latestFailureAt: string | null;
}

const canonical = (value: Date | null) =>
	value ? instantToCanonicalString(instantFromDate(value)) : null;

export async function loadReferenceRateProviderStatus(
	database: Reader,
	provider: ReferenceRateProvider = ECB_REFERENCE_RATES.provider,
): Promise<ReferenceRateProviderStatus> {
	// Sequential: the reader may be a transaction, which runs one query at a time.
	const [state] = await database
		.select()
		.from(travelExpenseReferenceRateProviderState)
		.where(eq(travelExpenseReferenceRateProviderState.provider, provider))
		.limit(1);
	const [latest] = await database
		.select({ date: max(travelExpenseReferenceRatePublication.publicationDate) })
		.from(travelExpenseReferenceRatePublication)
		.where(eq(travelExpenseReferenceRatePublication.provider, provider));
	return {
		provider,
		historyFrom: state?.historyFrom ?? null,
		latestSuccessAt: canonical(state?.latestSuccessAt ?? null),
		latestPublicationDate: latest?.date ?? null,
		latestFailure: state?.latestFailure ?? null,
		latestFailureAt: canonical(state?.latestFailureAt ?? null),
	};
}

type PublicationRow = typeof travelExpenseReferenceRatePublication.$inferSelect;

function toPublication(row: PublicationRow): ReferencePublication {
	return {
		id: row.id,
		provider: row.provider,
		publicationDate: row.publicationDate,
		version: row.version,
		rates: row.rates,
		contentSha256: row.contentSha256,
		retrievedAt: instantToCanonicalString(instantFromDate(row.retrievedAt)),
	};
}

/** The current publications around each expense date. */
async function loadCandidates(
	database: Reader,
	provider: ReferenceRateProvider,
	dates: Iterable<string>,
): Promise<Map<string, ReferencePublicationCandidates>> {
	const current = (date: string, after: boolean) =>
		database
			.select()
			.from(travelExpenseReferenceRatePublication)
			.where(
				and(
					eq(travelExpenseReferenceRatePublication.provider, provider),
					isNull(travelExpenseReferenceRatePublication.supersededAt),
					after
						? gt(travelExpenseReferenceRatePublication.publicationDate, date)
						: lte(travelExpenseReferenceRatePublication.publicationDate, date),
				),
			)
			.orderBy(
				after
					? asc(travelExpenseReferenceRatePublication.publicationDate)
					: desc(travelExpenseReferenceRatePublication.publicationDate),
			)
			.limit(1);
	const candidates = new Map<string, ReferencePublicationCandidates>();
	for (const date of new Set(dates)) {
		const [onOrBefore] = await current(date, false);
		const [later] = await current(date, true);
		candidates.set(date, {
			publication: onOrBefore ? toPublication(onOrBefore) : null,
			laterPublicationExists: !!later,
		});
	}
	return candidates;
}

export interface ConversionReportScope {
	id: string;
	status: TravelExpenseReportStatus;
	reimbursementCurrency: string;
	items: readonly { id: string; expenseDate: string | null; originalCurrency: string | null }[];
}

export interface ResolvedReportConversions {
	/** The conversion each item counts with, by item id. */
	conversions: Map<string, ItemConversion>;
	/**
	 * The reference-rate outcome of each foreign item of an editable report
	 * that has no recorded conversion, while the organization approved a source.
	 */
	referenceRates: Map<string, ReferenceRateItemStatus>;
}

/**
 * The conversions report items count with. Recorded card charges and
 * documented rates come first; a foreign item of an editable report without
 * one gets the approved reference rate when it is available, and otherwise a
 * status that says why not. Stored reference rows of editable reports (left
 * by an earlier submission cycle) are never reused.
 */
export async function resolveReportConversions(
	database: Reader,
	scope: { organizationId: string; reports: readonly ConversionReportScope[] },
	now: Instant = systemClock.nowInstant(),
): Promise<ResolvedReportConversions> {
	const result: ResolvedReportConversions = { conversions: new Map(), referenceRates: new Map() };
	if (scope.reports.length === 0) return result;
	const stored = await loadReportConversions(database, {
		organizationId: scope.organizationId,
		reportIds: scope.reports.map((report) => report.id),
	});
	const policy = await loadReferenceRatePolicy(database, scope.organizationId);

	const pending: { itemId: string; date: string; pair: [string, string] }[] = [];
	for (const report of scope.reports) {
		const editable = isEditableReportStatus(report.status);
		for (const item of report.items) {
			const recorded = stored.get(item.id);
			if (!editable) {
				if (recorded) result.conversions.set(item.id, recorded);
				continue;
			}
			if (recorded && recorded.basis !== "reference_rate") {
				result.conversions.set(item.id, recorded);
			}
			const currency = item.originalCurrency;
			if (!policy || !currency || currency === report.reimbursementCurrency) continue;
			const pair = { sourceCurrency: currency, targetCurrency: report.reimbursementCurrency };
			if (recordedConversionApplies(recorded, pair)) continue;
			if (!item.expenseDate) {
				result.referenceRates.set(item.id, {
					status: "unavailable",
					reason: "expense_date_missing",
				});
				continue;
			}
			pending.push({
				itemId: item.id,
				date: item.expenseDate,
				pair: [pair.sourceCurrency, pair.targetCurrency],
			});
		}
	}
	if (!policy || pending.length === 0) return result;

	const status = await loadReferenceRateProviderStatus(database, policy.provider);
	const candidates = await loadCandidates(
		database,
		policy.provider,
		pending.map((entry) => entry.date),
	);
	for (const entry of pending) {
		const [sourceCurrency, targetCurrency] = entry.pair;
		const resolution = resolveReferenceRate({
			expenseDate: entry.date,
			sourceCurrency,
			targetCurrency,
			publication: null,
			laterPublicationExists: false,
			...candidates.get(entry.date),
			coverage: status,
			now,
		});
		if (resolution.status !== "applied") {
			result.referenceRates.set(entry.itemId, resolution);
			continue;
		}
		result.conversions.set(
			entry.itemId,
			referenceRateConversion(resolution, {
				sourceCurrency,
				targetCurrency,
				expenseDate: entry.date,
				policyApprovedAt: policy.approvedAt,
			}),
		);
		result.referenceRates.set(entry.itemId, {
			status: "applied",
			rateDate: resolution.publication.publicationDate,
			fallback: resolution.fallback,
		});
	}
	return result;
}
