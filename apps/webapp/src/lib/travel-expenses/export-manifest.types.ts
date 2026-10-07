/**
 * The stored shape of a travel expense export manifest (#613). Kept free of
 * imports: the database schema types its `manifest` column with it, and every
 * runtime image that loads the schema would otherwise need the frozen report
 * facts and everything they import. The facts stay a type parameter here;
 * `export-manifest.ts` binds them to the frozen report facts.
 */

export interface TravelExpenseExportManifestRevisionRecord<TFacts = unknown> {
	reportId: string;
	/** `approval_submitted_revision.id` of the approved cycle. */
	revisionId: string;
	submissionCycle: number;
	/** Fingerprint of the frozen facts (`travel_expense_report:vN:…`). */
	materialFingerprint: string;
	/** UTC instant the revision was approved (decision evidence). */
	approvedAt: string;
	employeeId: string;
	/** Display name when the batch was created; descriptive only. */
	employeeName: string | null;
	/** The frozen facts exactly as approved, receipts included. */
	facts: TFacts;
	/** Uploaded file names by receipt id (revision labels); descriptive only. */
	receiptFileNames: Record<string, string>;
}

export interface TravelExpenseExportManifestRecord<TFacts = unknown> {
	kind: "travel_expense_export";
	version: number;
	organizationId: string;
	batchId: string;
	/** UTC instant the batch was created. */
	createdAt: string;
	/** Sorted by report id. */
	revisions: TravelExpenseExportManifestRevisionRecord<TFacts>[];
}
