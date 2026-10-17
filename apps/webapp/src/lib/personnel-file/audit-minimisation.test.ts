import { describe, expect, it } from "vitest";
import { minimiseDocumentAudit, minimiseZipAudit } from "./audit-minimisation";

const PURGED = "e9230000-0000-4000-8000-000000000001";
const KEPT = "e9230000-0000-4000-8000-000000000002";

describe("minimiseDocumentAudit", () => {
	it("removes the title, file name and reason and keeps the structured evidence", () => {
		const result = minimiseDocumentAudit({
			changes: null,
			metadata: JSON.stringify({
				document: {
					category: "sick_note",
					title: "Sick note flu March",
					documentDate: "2026-03-02",
					payPeriod: null,
					visibility: "shared",
					expiryDate: null,
				},
				fileName: "flu-march.pdf",
				mimeType: "application/pdf",
				sizeBytes: 1234,
				reason: "Uploaded twice",
				absenceId: "a-1",
			}),
		});

		expect(result.kind).toBe("minimised");
		if (result.kind !== "minimised") return;
		expect(result.changes).toBeNull();
		expect(JSON.parse(result.metadata as string)).toEqual({
			document: {
				category: "sick_note",
				documentDate: "2026-03-02",
				payPeriod: null,
				visibility: "shared",
				expiryDate: null,
			},
			mimeType: "application/pdf",
			sizeBytes: 1234,
			absenceId: "a-1",
			descriptionsRemoved: true,
		});
	});

	it("removes both title values of a metadata edit but records that the title changed", () => {
		const result = minimiseDocumentAudit({
			changes: JSON.stringify({
				title: { from: "Contract draft", to: "Contract signed" },
				documentDate: { from: "2026-01-01", to: "2026-01-02" },
			}),
			metadata: JSON.stringify({ document: { category: "contract", title: "Contract signed" } }),
		});

		expect(result.kind).toBe("minimised");
		if (result.kind !== "minimised") return;
		expect(JSON.parse(result.changes as string)).toEqual({
			title: { removed: true },
			documentDate: { from: "2026-01-01", to: "2026-01-02" },
		});
		expect(JSON.parse(result.metadata as string)).toEqual({
			document: { category: "contract" },
			descriptionsRemoved: true,
		});
	});

	it("leaves a record without descriptions unchanged, so a second run changes nothing", () => {
		const purge = {
			changes: null,
			metadata: JSON.stringify({
				document: { category: "payslip", documentDate: "2018-12-31", payPeriod: null },
				retentionStart: "2019-01-01",
				dueOn: "2025-01-01",
				retentionYears: 6,
			}),
		};
		expect(minimiseDocumentAudit(purge)).toEqual({ kind: "unchanged" });

		const first = minimiseDocumentAudit({
			changes: JSON.stringify({ title: { from: "A", to: "B" } }),
			metadata: JSON.stringify({ document: { title: "B" }, reason: "typo" }),
		});
		if (first.kind !== "minimised") throw new Error("expected a change");
		expect(minimiseDocumentAudit(first)).toEqual({ kind: "unchanged" });
	});

	it("keeps a null reason as it is", () => {
		expect(
			minimiseDocumentAudit({
				changes: null,
				metadata: JSON.stringify({ document: { category: "other" }, reason: null }),
			}),
		).toEqual({ kind: "unchanged" });
	});

	it("reports a record whose JSON cannot be read", () => {
		expect(minimiseDocumentAudit({ changes: null, metadata: "{not json" })).toEqual({
			kind: "unprocessable",
			reason: "invalid_json",
		});
		expect(minimiseDocumentAudit({ changes: "[1]", metadata: null })).toEqual({
			kind: "unprocessable",
			reason: "invalid_json",
		});
	});
});

describe("minimiseZipAudit", () => {
	it("removes only the purged document's title, file name and entry name from a download record", () => {
		const result = minimiseZipAudit(
			{
				changes: null,
				metadata: JSON.stringify({
					sharedOnly: false,
					categories: ["contract", "sick_note"],
					formerEmployee: true,
					documents: [
						{
							id: KEPT,
							category: "contract",
							title: "Contract 2020",
							documentDate: "2020-01-01",
							visibility: "shared",
							fileName: "contract.pdf",
							sizeBytes: 10,
							entryName: "Contract/2020-01-01 Contract 2020.pdf",
						},
						{
							id: PURGED,
							category: "sick_note",
							title: "Sick note flu March",
							documentDate: "2026-03-02",
							visibility: "hr_only",
							fileName: "flu-march.pdf",
							sizeBytes: 20,
							entryName: "Sick notes/2026-03-02 Sick note flu March.pdf",
						},
					],
				}),
			},
			new Set([PURGED]),
		);

		expect(result.kind).toBe("minimised");
		if (result.kind !== "minimised") return;
		expect(JSON.parse(result.metadata as string)).toEqual({
			sharedOnly: false,
			categories: ["contract", "sick_note"],
			formerEmployee: true,
			documents: [
				{
					id: KEPT,
					category: "contract",
					title: "Contract 2020",
					documentDate: "2020-01-01",
					visibility: "shared",
					fileName: "contract.pdf",
					sizeBytes: 10,
					entryName: "Contract/2020-01-01 Contract 2020.pdf",
				},
				{
					id: PURGED,
					category: "sick_note",
					documentDate: "2026-03-02",
					visibility: "hr_only",
					sizeBytes: 20,
					descriptionsRemoved: true,
				},
			],
		});
	});

	it("removes the failed document's entry name from an abort record and keeps the delivered ids", () => {
		const abort = {
			changes: null,
			metadata: JSON.stringify({
				downloadAuditId: "audit-1",
				failedDocument: { id: PURGED, entryName: "Sick notes/2026-03-02 Sick note.pdf" },
				deliveredDocumentIds: [KEPT],
			}),
		};

		const result = minimiseZipAudit(abort, new Set([PURGED]));
		expect(result.kind).toBe("minimised");
		if (result.kind !== "minimised") return;
		expect(JSON.parse(result.metadata as string)).toEqual({
			downloadAuditId: "audit-1",
			failedDocument: { id: PURGED, descriptionsRemoved: true },
			deliveredDocumentIds: [KEPT],
		});
		expect(minimiseZipAudit(result, new Set([PURGED]))).toEqual({ kind: "unchanged" });
		// Another document failed: nothing to remove.
		expect(minimiseZipAudit(abort, new Set([KEPT]))).toEqual({ kind: "unchanged" });
	});

	it("reports an unreadable record only when it may name a purged document", () => {
		expect(
			minimiseZipAudit(
				{ changes: null, metadata: `{"documents":[{"id":"${PURGED}"` },
				new Set([PURGED]),
			),
		).toEqual({ kind: "unprocessable", reason: "invalid_json" });
		// Another employee download that never listed the purged document does not block its purge.
		expect(
			minimiseZipAudit(
				{ changes: null, metadata: `{"documents":[{"id":"${KEPT}"` },
				new Set([PURGED]),
			),
		).toEqual({ kind: "unchanged" });
	});
});
