import { createHash } from "node:crypto";
import {
	comparePlainDates,
	instantFromDate,
	instantToCanonicalString,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import { canonicalJson } from "./absence-facts";
import { ApprovalEvidenceError } from "./errors";

export const TRAVEL_EXPENSE_EVIDENCE_SCHEMA_VERSION = 1;

/** The only storage a frozen receipt may live in: organization-scoped private objects. */
export const TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER = "s3-private";

type TravelExpenseClaimType = "receipt" | "mileage" | "per_diem";

export interface TravelExpenseMoney {
	/** The persisted decimal text, never re-rounded or converted. */
	amount: string;
	currency: string;
}

/**
 * One frozen receipt: the exact claim relationship, the immutable storage
 * object (write-once key plus provider version when the bucket reports one) and
 * the checksum the server computed over the bytes it stored.
 */
export interface TravelExpenseReceiptManifestItem {
	attachmentId: string;
	claimId: string;
	object: {
		provider: string;
		bucket: string | null;
		key: string;
		versionId: string | null;
	};
	checksumSha256: string;
	sizeBytes: number | null;
	mimeType: string | null;
}

export interface TravelExpenseMaterialFacts {
	schemaVersion: typeof TRAVEL_EXPENSE_EVIDENCE_SCHEMA_VERSION;
	kind: "travel_expense";
	organizationId: string;
	claimId: string;
	subjectEmployeeId: string;
	requesterEmployeeId: string;
	claimType: TravelExpenseClaimType;
	/**
	 * Logical calendar dates exactly as entered. They never shift with a viewer
	 * or server zone; the zone only explains how the compatibility bounds were
	 * derived.
	 */
	tripDates: {
		startDate: string;
		endDate: string;
		interpretation: { source: "entered_logical_dates"; zone: string };
	};
	money: { original: TravelExpenseMoney; calculated: TravelExpenseMoney };
	destination: { city: string | null; country: string | null };
	receipts: { required: boolean; manifest: TravelExpenseReceiptManifestItem[] };
}

export interface TravelExpenseSubmittedFacts extends TravelExpenseMaterialFacts {
	/** A reference the FK may clear later; descriptive, not material. */
	projectId: string | null;
	/** The claim's UTC bounds, derived from the logical dates. Not requested times. */
	compatibility: {
		encoding: "effective_zone_day_bounds";
		tripStartAt: string;
		tripEndAt: string;
	};
}

export interface TravelExpenseFactsInput {
	claim: {
		id: string;
		organizationId: string;
		employeeId: string;
		type: TravelExpenseClaimType;
		tripStartDate: string | null;
		tripEndDate: string | null;
		tripDateTimeZone: string | null;
		tripStart: Date;
		tripEnd: Date;
		originalAmount: string;
		originalCurrency: string;
		calculatedAmount: string;
		calculatedCurrency: string;
		destinationCity: string | null;
		destinationCountry: string | null;
		projectId: string | null;
	};
	attachments: ReadonlyArray<{
		id: string;
		claimId: string;
		organizationId: string;
		storageProvider: string;
		storageBucket: string | null;
		storageKey: string;
		storageVersionId: string | null;
		checksumSha256: string | null;
		sizeBytes: number | null;
		mimeType: string | null;
	}>;
}

const MONEY_AMOUNT = /^\d{1,10}\.\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function incomplete(field: string): never {
	throw new ApprovalEvidenceError("evidence_incomplete", { field });
}

function tripDates(
	claim: TravelExpenseFactsInput["claim"],
): TravelExpenseMaterialFacts["tripDates"] {
	const { tripStartDate, tripEndDate, tripDateTimeZone } = claim;
	// Current or effective timezone is no proof of the zone the dates were entered in.
	if (!tripStartDate || !tripEndDate || !tripDateTimeZone) incomplete("trip_dates");
	try {
		const start = parsePlainDate(tripStartDate);
		const end = parsePlainDate(tripEndDate);
		if (comparePlainDates(end, start) < 0) incomplete("trip_dates");
	} catch (error) {
		if (error instanceof ApprovalEvidenceError) throw error;
		incomplete("trip_dates");
	}
	return {
		startDate: tripStartDate,
		endDate: tripEndDate,
		interpretation: { source: "entered_logical_dates", zone: tripDateTimeZone },
	};
}

function money(amount: string, currency: string): TravelExpenseMoney {
	if (!MONEY_AMOUNT.test(amount) || !CURRENCY.test(currency)) incomplete("money");
	return { amount, currency };
}

function manifest(input: TravelExpenseFactsInput): TravelExpenseReceiptManifestItem[] {
	return input.attachments
		.map((attachment) => {
			if (
				attachment.organizationId !== input.claim.organizationId ||
				attachment.claimId !== input.claim.id
			) {
				throw new ApprovalEvidenceError("invariant", { field: "receipt_scope" });
			}
			if (attachment.storageProvider !== TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER) {
				incomplete("receipt_storage");
			}
			// Historical uploads never stored a checksum; count alone proves nothing.
			if (!attachment.checksumSha256 || !SHA256_HEX.test(attachment.checksumSha256)) {
				incomplete("receipt_checksum");
			}
			return {
				attachmentId: attachment.id,
				claimId: attachment.claimId,
				object: {
					provider: attachment.storageProvider,
					bucket: attachment.storageBucket,
					key: attachment.storageKey,
					versionId: attachment.storageVersionId,
				},
				checksumSha256: attachment.checksumSha256,
				sizeBytes: attachment.sizeBytes,
				mimeType: attachment.mimeType,
			};
		})
		.sort((left, right) =>
			left.attachmentId < right.attachmentId ? -1 : left.attachmentId > right.attachmentId ? 1 : 0,
		);
}

/**
 * Builds the immutable submitted facts of one travel expense claim from its
 * persisted rows. Anything that cannot be established from request-specific
 * evidence throws instead of being guessed; no reimbursement, tax, exchange
 * rate or policy calculation is derived. Notes and file names are not facts.
 */
export function buildTravelExpenseSubmittedFacts(
	input: TravelExpenseFactsInput,
): TravelExpenseSubmittedFacts {
	const { claim } = input;
	const required = claim.type === "receipt";
	const receipts = manifest(input);
	if (required && receipts.length === 0) incomplete("receipts");
	return {
		schemaVersion: TRAVEL_EXPENSE_EVIDENCE_SCHEMA_VERSION,
		kind: "travel_expense",
		organizationId: claim.organizationId,
		claimId: claim.id,
		subjectEmployeeId: claim.employeeId,
		requesterEmployeeId: claim.employeeId,
		claimType: claim.type,
		tripDates: tripDates(claim),
		money: {
			original: money(claim.originalAmount, claim.originalCurrency),
			calculated: money(claim.calculatedAmount, claim.calculatedCurrency),
		},
		destination: {
			city: claim.destinationCity,
			country: claim.destinationCountry,
		},
		receipts: { required, manifest: receipts },
		projectId: claim.projectId,
		compatibility: {
			encoding: "effective_zone_day_bounds",
			tripStartAt: instantToCanonicalString(instantFromDate(claim.tripStart)),
			tripEndAt: instantToCanonicalString(instantFromDate(claim.tripEnd)),
		},
	};
}

const MATERIAL_FIELDS = [
	"organizationId",
	"claimId",
	"subjectEmployeeId",
	"requesterEmployeeId",
	"claimType",
	"tripDates",
	"money",
	"destination",
	"receipts",
] as const;

type MaterialField = (typeof MATERIAL_FIELDS)[number];

function materialValue(facts: TravelExpenseMaterialFacts, field: MaterialField): unknown {
	if (field === "tripDates") {
		// The logical dates are the fact; their interpretation zone is provenance.
		return { startDate: facts.tripDates.startDate, endDate: facts.tripDates.endDate };
	}
	return facts[field];
}

export function materialTravelExpenseFacts(
	facts: TravelExpenseMaterialFacts,
): Record<string, unknown> {
	return Object.fromEntries([
		["schemaVersion", facts.schemaVersion],
		["kind", facts.kind],
		...MATERIAL_FIELDS.map((field) => [field, materialValue(facts, field)]),
	]);
}

/** Versioned identity of the reviewed claim, including receipt content identity. */
export function fingerprintTravelExpenseMaterialFacts(facts: TravelExpenseMaterialFacts): string {
	return `travel_expense:v${TRAVEL_EXPENSE_EVIDENCE_SCHEMA_VERSION}:${createHash("sha256")
		.update(canonicalJson(materialTravelExpenseFacts(facts)))
		.digest("hex")}`;
}

export type TravelExpenseRevisionComparison =
	| { kind: "current" }
	| { kind: "material_change"; changedFields: string[] };

/**
 * Compares live claim rows with the immutable submitted revision. A changed
 * receipt set, amount, date or identity needs a supported successor
 * submission; live rows that can no longer be verified are held the same way.
 */
export function compareLiveTravelExpenseWithRevision(
	submitted: TravelExpenseMaterialFacts,
	live: TravelExpenseFactsInput,
): TravelExpenseRevisionComparison {
	let liveFacts: TravelExpenseSubmittedFacts;
	try {
		liveFacts = buildTravelExpenseSubmittedFacts(live);
	} catch (error) {
		if (!(error instanceof ApprovalEvidenceError)) throw error;
		return {
			kind: "material_change",
			changedFields: [`unverifiable:${error.details.field ?? error.code}`],
		};
	}
	const changedFields = MATERIAL_FIELDS.filter(
		(field) =>
			canonicalJson(materialValue(submitted, field)) !==
			canonicalJson(materialValue(liveFacts, field)),
	);
	return changedFields.length > 0
		? { kind: "material_change", changedFields: [...changedFields] }
		: { kind: "current" };
}

/** Request-time descriptive labels. Never material and never outbound by default. */
export interface TravelExpenseSubmittedLabels {
	subjectName: string | null;
	requesterName: string | null;
	submitterName: string | null;
	projectName: string | null;
	/** Uploaded file names by attachment ID; review-only, never card content. */
	receiptFileNames: Record<string, string>;
}
