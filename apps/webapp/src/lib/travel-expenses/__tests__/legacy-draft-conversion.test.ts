import { describe, expect, it } from "vitest";
import {
	type LegacyDraftClaim,
	legacyAttachmentNeedsRead,
	legacyReceiptIdentity,
	planLegacyDraftConversion,
} from "../legacy-draft-conversion";

const receiptClaim: LegacyDraftClaim = {
	id: "00000000-0000-4000-8000-000000000001",
	type: "receipt",
	tripStartDate: "2026-03-29",
	tripEndDate: "2026-03-29",
	tripDateTimeZone: "Europe/Berlin",
	destinationCity: "Hamburg",
	destinationCountry: "DE",
	projectId: null,
	originalAmount: "120.50",
	originalCurrency: "EUR",
	calculatedAmount: "120.50",
	calculatedCurrency: "EUR",
	notes: "Taxi to the customer",
};

const context = { defaultTimeZone: "Europe/Berlin", projectInOrganization: false };

describe("planLegacyDraftConversion", () => {
	it("continues a one-day receipt draft as a standalone receipt with its entered amount, date and notes", () => {
		const plan = planLegacyDraftConversion(receiptClaim, context);
		expect(plan.report).toEqual({
			kind: "standalone",
			tripStartDate: null,
			tripEndDate: null,
			tripTimeZone: null,
			tripDestinations: [],
		});
		expect(plan.item).toEqual({
			type: "receipt",
			expenseDate: "2026-03-29",
			description: "Taxi to the customer",
			originalAmount: "120.50",
			originalCurrency: "EUR",
			paidBy: null,
			projectId: null,
			projectInherits: true,
		});
		expect(plan.perDiem).toBeNull();
		expect(plan.flags).toEqual([]);
	});

	it("never picks one day out of a multi-day legacy range for a receipt", () => {
		const plan = planLegacyDraftConversion({ ...receiptClaim, tripEndDate: "2026-03-31" }, context);
		expect(plan.item.expenseDate).toBeNull();
		expect(plan.flags).toEqual(["expense_date_unknown"]);
	});

	it("carries no date from a claim created before logical dates were captured", () => {
		const plan = planLegacyDraftConversion(
			{ ...receiptClaim, tripStartDate: null, tripEndDate: null, tripDateTimeZone: null },
			context,
		);
		expect(plan.item.expenseDate).toBeNull();
		expect(plan.flags).toEqual(["trip_dates_not_recorded"]);
	});

	it("keeps a foreign receipt in its original currency and a zero-decimal currency exactly", () => {
		const yen = planLegacyDraftConversion(
			{ ...receiptClaim, originalAmount: "1500.00", originalCurrency: "jpy" },
			context,
		);
		expect(yen.item).toMatchObject({ originalAmount: "1500.00", originalCurrency: "JPY" });
		// The legacy draft recorded no conversion into the reimbursement currency.
		expect(yen.flags).toContain("conversion_required");
		const fractionalYen = planLegacyDraftConversion(
			{ ...receiptClaim, originalAmount: "1500.50", originalCurrency: "JPY" },
			context,
		);
		expect(fractionalYen.item).toMatchObject({ originalAmount: null, originalCurrency: "JPY" });
		expect(fractionalYen.flags).toEqual(["amount_not_carried", "conversion_required"]);
		expect(
			planLegacyDraftConversion(
				{ ...receiptClaim, originalCurrency: "CHF" },
				{ ...context, reimbursementCurrency: "CHF" },
			).flags,
		).not.toContain("conversion_required");
	});

	it("does not carry an amount the new model would refuse", () => {
		for (const [amount, currency] of [
			["0.00", "EUR"],
			["-5.00", "EUR"],
			["10.00", "XYZ1"],
		]) {
			const plan = planLegacyDraftConversion(
				{ ...receiptClaim, originalAmount: amount, originalCurrency: currency },
				context,
			);
			expect(plan.item.originalAmount).toBeNull();
			expect(plan.flags).toContain("amount_not_carried");
		}
	});

	it("keeps notes too long for a description out of the expense, flagged", () => {
		const plan = planLegacyDraftConversion({ ...receiptClaim, notes: "x".repeat(501) }, context);
		expect(plan.item.description).toBeNull();
		expect(plan.flags).toEqual(["notes_not_carried"]);
	});

	it("continues a mileage draft without inventing a distance, route or vehicle from its typed total", () => {
		const plan = planLegacyDraftConversion(
			{ ...receiptClaim, type: "mileage", originalAmount: "84.00", calculatedAmount: "84.00" },
			context,
		);
		expect(plan.report.kind).toBe("standalone");
		expect(plan.item).toEqual({
			type: "mileage",
			expenseDate: "2026-03-29",
			description: null,
			originalAmount: null,
			originalCurrency: null,
			paidBy: "employee",
			projectId: null,
			projectInherits: true,
		});
		expect(plan.flags).toEqual(["manual_total_not_used", "notes_not_carried"]);
	});

	it("continues a per diem draft as a trip with its days and destination but no itinerary times", () => {
		const plan = planLegacyDraftConversion(
			{
				...receiptClaim,
				type: "per_diem",
				tripEndDate: "2026-03-31",
				destinationCity: " Paris ",
				destinationCountry: "Frankreich",
				notes: null,
			},
			context,
		);
		expect(plan.report).toEqual({
			kind: "trip",
			tripStartDate: "2026-03-29",
			tripEndDate: "2026-03-31",
			tripTimeZone: "Europe/Berlin",
			tripDestinations: [{ place: "Paris", countryCode: "FR" }],
		});
		expect(plan.item).toMatchObject({
			type: "per_diem",
			expenseDate: "2026-03-29",
			originalAmount: null,
			paidBy: "employee",
		});
		expect(plan.perDiem).toEqual({
			startDate: "2026-03-29",
			endDate: "2026-03-31",
			startTimeZone: "Europe/Berlin",
			endTimeZone: "Europe/Berlin",
		});
		expect(plan.flags).toEqual(["manual_total_not_used"]);
	});

	it("uses the employee's zone for a per diem trip without a recorded zone and flags an unknown country", () => {
		const plan = planLegacyDraftConversion(
			{
				...receiptClaim,
				type: "per_diem",
				tripStartDate: null,
				tripEndDate: null,
				tripDateTimeZone: null,
				destinationCity: null,
				destinationCountry: "Atlantis",
			},
			{ ...context, defaultTimeZone: "America/New_York" },
		);
		expect(plan.report).toMatchObject({
			tripTimeZone: "America/New_York",
			tripStartDate: null,
			tripDestinations: [],
		});
		expect(plan.flags).toEqual([
			"trip_dates_not_recorded",
			"destination_unmatched",
			"manual_total_not_used",
			"notes_not_carried",
		]);
	});

	it("matches legacy country text only exactly: codes and English or German names", () => {
		const plan = (country: string) =>
			planLegacyDraftConversion(
				{ ...receiptClaim, type: "per_diem", destinationCity: null, destinationCountry: country },
				context,
			).report.tripDestinations;
		expect(plan("de")).toEqual([{ place: null, countryCode: "DE" }]);
		expect(plan("Germany")).toEqual([{ place: null, countryCode: "DE" }]);
		expect(plan("Österreich")).toEqual([{ place: null, countryCode: "AT" }]);
		expect(plan("Germ")).toEqual([]);
	});
});

describe("legacyReceiptIdentity", () => {
	const attachment = {
		storageProvider: "s3-private",
		mimeType: "application/pdf",
		sizeBytes: 1234,
		checksumSha256: "a".repeat(64),
	};

	it("uses the recorded content identity without reading the object", () => {
		expect(legacyAttachmentNeedsRead(attachment)).toBe(false);
		expect(legacyReceiptIdentity(attachment, null)).toEqual({
			ok: true,
			mimeType: "application/pdf",
			sizeBytes: 1234,
			checksumSha256: "a".repeat(64),
		});
	});

	it("establishes a historical receipt's identity from its stored bytes", () => {
		const historical = { ...attachment, checksumSha256: null, sizeBytes: null, mimeType: null };
		expect(legacyAttachmentNeedsRead(historical)).toBe(true);
		expect(
			legacyReceiptIdentity(historical, {
				sizeBytes: 99,
				checksumSha256: "b".repeat(64),
				mimeType: "image/png",
			}),
		).toEqual({ ok: true, mimeType: "image/png", sizeBytes: 99, checksumSha256: "b".repeat(64) });
	});

	it("refuses content that is unreadable, differs from what was recorded or is not a receipt type", () => {
		const noChecksum = { ...attachment, checksumSha256: null };
		expect(legacyReceiptIdentity(noChecksum, null)).toEqual({ ok: false, reason: "unreadable" });
		expect(
			legacyReceiptIdentity(noChecksum, {
				sizeBytes: 1,
				checksumSha256: "c".repeat(64),
				mimeType: "application/pdf",
			}),
		).toEqual({ ok: false, reason: "identity_mismatch" });
		expect(
			legacyReceiptIdentity(
				{ ...attachment, mimeType: null },
				{ sizeBytes: 1234, checksumSha256: "d".repeat(64), mimeType: null },
			),
		).toEqual({ ok: false, reason: "identity_mismatch" });
		expect(
			legacyReceiptIdentity(
				{ ...attachment, mimeType: "text/html" },
				{ sizeBytes: 1234, checksumSha256: "a".repeat(64), mimeType: null },
			),
		).toEqual({ ok: false, reason: "unsupported_type" });
		expect(legacyReceiptIdentity({ ...attachment, storageProvider: "s3" }, null)).toEqual({
			ok: false,
			reason: "unsupported_storage",
		});
	});
});

describe("planLegacyDraftConversion projects", () => {
	it("carries the legacy project as the expense's own project, flagged for eligibility", () => {
		const projectId = "00000000-0000-4000-8000-0000000000aa";
		const carried = planLegacyDraftConversion(
			{ ...receiptClaim, projectId },
			{ ...context, projectInOrganization: true },
		);
		expect(carried.item).toMatchObject({ projectId, projectInherits: false });
		expect(carried.flags).toEqual(["project_eligibility_required"]);
		const dropped = planLegacyDraftConversion({ ...receiptClaim, projectId }, context);
		expect(dropped.item).toMatchObject({ projectId: null, projectInherits: true });
		expect(dropped.flags).toEqual(["project_not_carried"]);
	});
});
