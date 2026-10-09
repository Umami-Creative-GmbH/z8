import type { DocumentCategory } from "./document.types";

/**
 * Suggested retention periods per document category (#870). They are shown as
 * "suggested, not legal advice" and only applied when an owner or admin
 * chooses to. Each value is the longest of the German, Austrian and Swiss
 * periods listed below, so applying it never deletes a document earlier than
 * one of these rules requires. All periods count from the end of the year of
 * the triggering event, as the retention start does.
 *
 * These are a starting point for maintainer review, not a legal assessment:
 * collective agreements, pending disputes, works agreements and other
 * documents in the same file can require longer or shorter periods.
 */

export interface RetentionSuggestion {
	years: number;
	/** Legal sources per country, for review; not shown as advice. */
	sources: Readonly<Record<"DE" | "AT" | "CH", string>>;
}

export const SUGGESTED_RETENTION_PERIODS: Readonly<Record<DocumentCategory, RetentionSuggestion>> =
	{
		contract: {
			years: 10,
			sources: {
				DE: "6 years: § 147 (1) no. 5, (3) AO and § 257 (1) no. 3, (4) HGB (documents relevant for taxation); claims become time-barred after 3 years, § 195, § 199 BGB",
				AT: "7 years: § 132 (1) BAO; claims become time-barred after 3 years, § 1486 no. 5 ABGB (30 years for the employment reference, § 1478 ABGB)",
				CH: "10 years: Art. 958f OR (business records) and Art. 127 OR (general limitation, e.g. the employment reference)",
			},
		},
		payslip: {
			years: 10,
			sources: {
				DE: "8 years: § 147 (1) no. 4, (3) AO and § 257 (1) no. 4, (4) HGB (accounting vouchers); payroll account 6 years, § 41 (1) EStG",
				AT: "7 years: § 132 (1) BAO",
				CH: "10 years: Art. 958f OR (accounting vouchers)",
			},
		},
		certificate: {
			years: 5,
			sources: {
				DE: "No statutory retention duty; claims become time-barred after 3 years, § 195, § 199 BGB",
				AT: "No statutory retention duty; claims become time-barred after 3 years, § 1486 no. 5 ABGB",
				CH: "No statutory retention duty; employment claims become time-barred after 5 years, Art. 128 no. 3 OR",
			},
		},
		sick_note: {
			years: 5,
			sources: {
				DE: "Health data: keep only as long as needed (Art. 5 (1) (e), Art. 9 GDPR); continued pay claims and U1 reimbursement become time-barred after 3 and 4 years, § 195 BGB, § 6 AAG",
				AT: "Health data: keep only as long as needed (Art. 5 (1) (e), Art. 9 GDPR); claims become time-barred after 3 years, § 1486 no. 5 ABGB",
				CH: "Health data: keep only as long as needed (Art. 328b OR, Art. 6 DSG); employment claims become time-barred after 5 years, Art. 128 no. 3 OR",
			},
		},
		other: {
			years: 5,
			sources: {
				DE: "No statutory retention duty; claims become time-barred after 3 years, § 195, § 199 BGB",
				AT: "No statutory retention duty; claims become time-barred after 3 years, § 1486 no. 5 ABGB",
				CH: "No statutory retention duty; employment claims become time-barred after 5 years, Art. 128 no. 3 OR",
			},
		},
	};
