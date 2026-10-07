import { isValidIanaTimeZone } from "@/lib/timezone/validation";
import {
	isAllowedTravelExpenseMime,
	TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER,
} from "./attachment-validation";
import { currencyMinorUnitDigits, formatUnits, parseUnits, STORED_AMOUNT_SCALE } from "./money";
import {
	DEFAULT_REIMBURSEMENT_CURRENCY,
	isSupportedCurrency,
	MAX_DESCRIPTION_LENGTH,
} from "./receipt-report";
import type { TripDestination } from "./trip-destination";
import { isTripCountryCode, MAX_DESTINATION_PLACE_LENGTH, TRIP_COUNTRY_CODES } from "./trip-report";

/**
 * Legacy draft conversion (#616), the pure part. An employee continues one of
 * their legacy `travel_expense_claim` drafts as a single-item report: entered
 * amounts, logical dates, destination, notes and project are carried over as
 * far as the new model can hold them exactly, and every fact the new
 * calculations need but the legacy draft never recorded stays empty and is
 * flagged. Nothing is inferred: a manually entered mileage or per diem total
 * never becomes a distance, an itinerary or a policy application, and a
 * multi-day range never becomes one expense date. The legacy claim itself is
 * never changed (`legacy-draft-conversion-store.ts`).
 */

export const LEGACY_CLAIM_TYPES = ["receipt", "mileage", "per_diem"] as const;
export type LegacyClaimType = (typeof LEGACY_CLAIM_TYPES)[number];

/** The legacy draft's facts as stored; `trip*Date` are null for claims from before date capture. */
export interface LegacyDraftClaim {
	id: string;
	type: LegacyClaimType;
	tripStartDate: string | null;
	tripEndDate: string | null;
	tripDateTimeZone: string | null;
	destinationCity: string | null;
	destinationCountry: string | null;
	projectId: string | null;
	originalAmount: string;
	originalCurrency: string;
	calculatedAmount: string;
	calculatedCurrency: string;
	notes: string | null;
}

/**
 * The legacy draft exactly as it was when it was converted, kept on the
 * conversion record: everything the employee entered, including what the new
 * model could not hold (a typed mileage total, a travel range, free-text
 * country), and which report receipt continues which legacy attachment.
 */
export interface LegacyDraftSnapshot extends Omit<LegacyDraftClaim, "id"> {
	createdAt: string;
	attachments: {
		attachmentId: string;
		receiptId: string;
		fileName: string;
		storageKey: string;
		checksumSha256: string;
	}[];
}

/**
 * What the converted draft lacks because the legacy draft did not record it
 * in a form the new model accepts. The editors' own requirements show the
 * empty fields; these explain why they are empty.
 */
export const LEGACY_CONVERSION_FLAGS = [
	/** A multi-day legacy range: the employee picks the expense's own date. */
	"expense_date_unknown",
	/** Created before logical dates were captured: no date is carried over. */
	"trip_dates_not_recorded",
	/** The legacy country text matches no country code; the employee chooses it. */
	"destination_unmatched",
	/** The legacy receipt amount or currency is not a valid amount in the new model. */
	"amount_not_carried",
	/** A mileage or per diem total was typed in; it is kept for reference only. */
	"manual_total_not_used",
	/** The notes did not fit a field of the new expense; they stay readable on the legacy draft. */
	"notes_not_carried",
	/** The legacy project was carried over; submission still needs proven eligibility or an exception. */
	"project_eligibility_required",
	/** The legacy project no longer exists in the organization. */
	"project_not_carried",
	/**
	 * A foreign-currency legacy receipt (#616): it needs a conversion into the
	 * reimbursement currency, which the legacy draft never recorded.
	 */
	"conversion_required",
] as const;
export type LegacyConversionFlag = (typeof LEGACY_CONVERSION_FLAGS)[number];

export interface LegacyConversionReportPlan {
	kind: "standalone" | "trip";
	tripStartDate: string | null;
	tripEndDate: string | null;
	tripTimeZone: string | null;
	tripDestinations: TripDestination[];
}

export interface LegacyConversionItemPlan {
	type: LegacyClaimType;
	expenseDate: string | null;
	description: string | null;
	originalAmount: string | null;
	originalCurrency: string | null;
	/** Mileage and per diem are the employee's own by definition; a receipt's payer was never recorded. */
	paidBy: "employee" | null;
	projectId: string | null;
	projectInherits: boolean;
}

/** The per diem itinerary: the legacy travel days only; times, nights and meals were never recorded. */
export interface LegacyConversionPerDiemPlan {
	startDate: string | null;
	endDate: string | null;
	startTimeZone: string;
	endTimeZone: string;
}

export interface LegacyConversionPlan {
	report: LegacyConversionReportPlan;
	item: LegacyConversionItemPlan;
	perDiem: LegacyConversionPerDiemPlan | null;
	flags: LegacyConversionFlag[];
}

export interface LegacyConversionContext {
	/** The zone a per diem trip uses when the legacy draft recorded none (the employee's effective zone). */
	defaultTimeZone: string;
	/** Whether the legacy `projectId` names a project of the claim's organization. */
	projectInOrganization: boolean;
	/** The converted report's reimbursement currency (default EUR). */
	reimbursementCurrency?: string;
}

function trimmed(value: string | null): string | null {
	const text = value?.trim();
	return text ? text : null;
}

/** Exactly the entered amount, when it is a valid positive amount of a supported currency. */
function carriedAmount(
	amount: string,
	currency: string,
): { amount: string | null; currency: string | null } {
	const code = currency.trim().toUpperCase();
	if (!/^[A-Z]{3}$/.test(code) || !isSupportedCurrency(code))
		return { amount: null, currency: null };
	const digits = currencyMinorUnitDigits(code);
	if (digits > STORED_AMOUNT_SCALE || parseUnits(amount.trim(), digits) === null) {
		return { amount: null, currency: code };
	}
	const units = parseUnits(amount.trim(), STORED_AMOUNT_SCALE);
	const max = BigInt("99999999999");
	if (units === null || units <= BigInt(0) || units > max) return { amount: null, currency: code };
	return { amount: formatUnits(units, STORED_AMOUNT_SCALE), currency: code };
}

function normalizedName(value: string): string {
	return value
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/[^a-z]/g, "");
}

let countryNames: Map<string, string> | null = null;

/** English and German country names, which the legacy form's free text was entered in. */
function countryNameIndex(): Map<string, string> {
	if (countryNames) return countryNames;
	const index = new Map<string, string>();
	for (const locale of ["en", "de"]) {
		const names = new Intl.DisplayNames([locale], { type: "region" });
		for (const code of TRIP_COUNTRY_CODES) {
			const name = names.of(code);
			if (name && name !== code) index.set(normalizedName(name), code);
		}
	}
	countryNames = index;
	return index;
}

/** The country code the legacy text names exactly (a code, or an English/German name); never a guess. */
export function legacyCountryCode(text: string | null): string | null {
	const value = trimmed(text);
	if (!value) return null;
	const upper = value.toUpperCase();
	if (/^[A-Z]{2}$/.test(upper)) return isTripCountryCode(upper) ? upper : null;
	return countryNameIndex().get(normalizedName(value)) ?? null;
}

function legacyDestination(claim: LegacyDraftClaim): {
	destinations: TripDestination[];
	unmatched: boolean;
} {
	const city = trimmed(claim.destinationCity);
	const countryText = trimmed(claim.destinationCountry);
	const countryCode = legacyCountryCode(countryText);
	const place = city && city.length <= MAX_DESTINATION_PLACE_LENGTH ? city : null;
	const unmatched = (countryText !== null && countryCode === null) || (city !== null && !place);
	return {
		destinations: place || countryCode ? [{ place, countryCode }] : [],
		unmatched,
	};
}

/** Plans the single-item report a legacy draft continues as. Pure and deterministic. */
export function planLegacyDraftConversion(
	claim: LegacyDraftClaim,
	context: LegacyConversionContext,
): LegacyConversionPlan {
	const flags = new Set<LegacyConversionFlag>();
	const startDate = claim.tripStartDate;
	const endDate = claim.tripEndDate;
	if (!startDate || !endDate) flags.add("trip_dates_not_recorded");
	const notes = trimmed(claim.notes);

	let projectId: string | null = null;
	if (claim.projectId) {
		if (context.projectInOrganization) {
			projectId = claim.projectId;
			flags.add("project_eligibility_required");
		} else flags.add("project_not_carried");
	}
	const project = { projectId, projectInherits: projectId === null };

	if (claim.type === "per_diem") {
		// Per diem belongs to a trip (spec decision 17): the legacy days and destination
		// become the trip's; departure and return times, nights and meals stay empty.
		const timeZone =
			claim.tripDateTimeZone && isValidIanaTimeZone(claim.tripDateTimeZone)
				? claim.tripDateTimeZone
				: context.defaultTimeZone;
		const destination = legacyDestination(claim);
		if (destination.unmatched) flags.add("destination_unmatched");
		flags.add("manual_total_not_used");
		if (notes) flags.add("notes_not_carried");
		return {
			report: {
				kind: "trip",
				tripStartDate: startDate,
				tripEndDate: endDate,
				tripTimeZone: timeZone,
				tripDestinations: destination.destinations,
			},
			item: {
				type: "per_diem",
				expenseDate: startDate,
				description: null,
				originalAmount: null,
				originalCurrency: null,
				paidBy: "employee",
				...project,
			},
			perDiem: { startDate, endDate, startTimeZone: timeZone, endTimeZone: timeZone },
			flags: orderedFlags(flags),
		};
	}

	// A receipt or mileage is a standalone expense of one day; its legacy travel
	// range and destination stay readable on the conversion record.
	let expenseDate: string | null = null;
	if (startDate && endDate) {
		if (startDate === endDate) expenseDate = startDate;
		else flags.add("expense_date_unknown");
	}
	const report: LegacyConversionReportPlan = {
		kind: "standalone",
		tripStartDate: null,
		tripEndDate: null,
		tripTimeZone: null,
		tripDestinations: [],
	};

	if (claim.type === "mileage") {
		flags.add("manual_total_not_used");
		if (notes) flags.add("notes_not_carried");
		return {
			report,
			item: {
				type: "mileage",
				expenseDate,
				description: null,
				originalAmount: null,
				originalCurrency: null,
				paidBy: "employee",
				...project,
			},
			perDiem: null,
			flags: orderedFlags(flags),
		};
	}

	const money = carriedAmount(claim.originalAmount, claim.originalCurrency);
	if (money.amount === null) flags.add("amount_not_carried");
	if (
		money.currency !== null &&
		money.currency !== (context.reimbursementCurrency ?? DEFAULT_REIMBURSEMENT_CURRENCY)
	) {
		flags.add("conversion_required");
	}
	const description = notes && notes.length <= MAX_DESCRIPTION_LENGTH ? notes : null;
	if (notes && !description) flags.add("notes_not_carried");
	return {
		report,
		item: {
			type: "receipt",
			expenseDate,
			description,
			originalAmount: money.amount,
			originalCurrency: money.currency,
			paidBy: null,
			...project,
		},
		perDiem: null,
		flags: orderedFlags(flags),
	};
}

/** A legacy attachment's recorded storage and content identity. */
export interface LegacyAttachmentIdentityInput {
	storageProvider: string;
	mimeType: string | null;
	sizeBytes: number | null;
	checksumSha256: string | null;
}

/** What the stored bytes show: their size, SHA-256 and detected receipt type (if any). */
export interface ObservedReceiptContent {
	sizeBytes: number;
	checksumSha256: string;
	mimeType: string | null;
}

export type LegacyReceiptIdentity =
	| { ok: true; mimeType: string; sizeBytes: number; checksumSha256: string }
	| {
			ok: false;
			reason: "unsupported_storage" | "unreadable" | "identity_mismatch" | "unsupported_type";
	  };

function allowedMime(mime: string | null): string | null {
	const lower = mime?.toLowerCase() ?? null;
	return lower && isAllowedTravelExpenseMime(lower) ? lower : null;
}

/**
 * Whether a report receipt can only name this attachment after its stored
 * bytes were read: a report receipt always carries the exact size, SHA-256 and
 * a receipt type, which historical uploads did not record.
 */
export function legacyAttachmentNeedsRead(attachment: LegacyAttachmentIdentityInput): boolean {
	return (
		attachment.storageProvider === TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER &&
		(!attachment.checksumSha256 ||
			attachment.sizeBytes === null ||
			!allowedMime(attachment.mimeType))
	);
}

/**
 * The content identity a converted receipt keeps: the recorded one, or, for a
 * historical upload, the identity of its stored bytes, which must agree with
 * everything that was recorded. Never a guess: unreadable or contradicting
 * content refuses the conversion instead of dropping the receipt.
 */
export function legacyReceiptIdentity(
	attachment: LegacyAttachmentIdentityInput,
	observed: ObservedReceiptContent | null,
): LegacyReceiptIdentity {
	if (attachment.storageProvider !== TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER) {
		return { ok: false, reason: "unsupported_storage" };
	}
	if (!legacyAttachmentNeedsRead(attachment)) {
		return {
			ok: true,
			mimeType: allowedMime(attachment.mimeType) as string,
			sizeBytes: attachment.sizeBytes as number,
			checksumSha256: attachment.checksumSha256 as string,
		};
	}
	if (!observed) return { ok: false, reason: "unreadable" };
	if (
		(attachment.sizeBytes !== null && attachment.sizeBytes !== observed.sizeBytes) ||
		(attachment.checksumSha256 && attachment.checksumSha256 !== observed.checksumSha256)
	) {
		return { ok: false, reason: "identity_mismatch" };
	}
	const mimeType = allowedMime(attachment.mimeType) ?? allowedMime(observed.mimeType);
	if (!mimeType) return { ok: false, reason: "unsupported_type" };
	return {
		ok: true,
		mimeType,
		sizeBytes: observed.sizeBytes,
		checksumSha256: attachment.checksumSha256 ?? observed.checksumSha256,
	};
}

function orderedFlags(flags: ReadonlySet<LegacyConversionFlag>): LegacyConversionFlag[] {
	return LEGACY_CONVERSION_FLAGS.filter((flag) => flags.has(flag));
}
