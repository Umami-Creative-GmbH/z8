import { describe, expect, it } from "vitest";
import { minimiseDocumentRequestAudit } from "./audit-minimisation";

/**
 * #1408: a request's note, return and cancel reasons and submission notes are
 * document descriptions; a purge of one of its documents (or the request's
 * deletion) removes them from the request's audit records.
 */
describe("minimiseDocumentRequestAudit", () => {
	it("removes the note of the created record and keeps the request's structured facts", () => {
		const result = minimiseDocumentRequestAudit({
			changes: null,
			metadata: JSON.stringify({
				request: {
					category: "certificate",
					title: "First aid certificate",
					deadline: "2026-09-30",
					renewedDocumentId: null,
					note: "Please include the back page",
				},
				eventId: "event-1",
			}),
		});

		expect(result.kind).toBe("minimised");
		if (result.kind !== "minimised") return;
		expect(result.changes).toBeNull();
		expect(JSON.parse(result.metadata as string)).toEqual({
			request: {
				category: "certificate",
				title: "First aid certificate",
				deadline: "2026-09-30",
				renewedDocumentId: null,
			},
			eventId: "event-1",
			descriptionsRemoved: true,
		});
	});

	it("removes a typed reason and a submission note but keeps a system reason code", () => {
		const returned = minimiseDocumentRequestAudit({
			changes: null,
			metadata: JSON.stringify({
				request: { category: "other", title: "ID", deadline: "2026-09-30" },
				status: { from: "submitted", to: "open" },
				reason: "The scan is unreadable",
			}),
		});
		const submitted = minimiseDocumentRequestAudit({
			changes: null,
			metadata: JSON.stringify({
				request: { category: "other", title: "ID", deadline: "2026-09-30" },
				submissionId: "submission-1",
				documentIds: ["document-1"],
				submissionNote: "Front and back",
			}),
		});
		const cancelledAtDeparture = minimiseDocumentRequestAudit({
			changes: null,
			metadata: JSON.stringify({
				request: { category: "other", title: "ID", deadline: "2026-09-30" },
				reasonCode: "employment_ended",
			}),
		});

		expect(returned.kind === "minimised" && JSON.parse(returned.metadata as string)).toEqual({
			request: { category: "other", title: "ID", deadline: "2026-09-30" },
			status: { from: "submitted", to: "open" },
			descriptionsRemoved: true,
		});
		expect(submitted.kind === "minimised" && JSON.parse(submitted.metadata as string)).toEqual({
			request: { category: "other", title: "ID", deadline: "2026-09-30" },
			submissionId: "submission-1",
			documentIds: ["document-1"],
			descriptionsRemoved: true,
		});
		expect(cancelledAtDeparture).toEqual({ kind: "unchanged" });
	});

	it("leaves a minimised record unchanged and reports unreadable JSON", () => {
		const once = minimiseDocumentRequestAudit({
			changes: null,
			metadata: JSON.stringify({ request: { note: "Bring the original" }, reason: "Wrong file" }),
		});
		expect(once.kind).toBe("minimised");
		if (once.kind !== "minimised") return;

		expect(minimiseDocumentRequestAudit(once)).toEqual({ kind: "unchanged" });
		expect(minimiseDocumentRequestAudit({ changes: null, metadata: "{not json" })).toEqual({
			kind: "unprocessable",
			reason: "invalid_json",
		});
	});
});
