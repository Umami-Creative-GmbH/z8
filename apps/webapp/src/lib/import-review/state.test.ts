import { describe, expect, it } from "vitest";
import { canCommitRow, nextBatchStatusAfterJobs, normalizeDecision } from "./state";

describe("import review state", () => {
	it("moves scanning batches to needs_review when all scan jobs complete", () => {
		expect(
			nextBatchStatusAfterJobs("scanning", [{ status: "completed" }, { status: "completed" }]),
		).toBe("needs_review");
	});

	it("moves scanning batches to scan_failed when any scan job fails", () => {
		expect(
			nextBatchStatusAfterJobs("scanning", [{ status: "completed" }, { status: "failed" }]),
		).toBe("scan_failed");
	});

	it("allows only accepted staged rows to commit", () => {
		expect(canCommitRow({ rowStatus: "accepted", issueSeverity: "none" })).toBe(true);
		expect(canCommitRow({ rowStatus: "blocked", issueSeverity: "blocking" })).toBe(false);
		expect(canCommitRow({ rowStatus: "rejected", issueSeverity: "none" })).toBe(false);
	});

	it("normalizes blocking issues to blocked unless user rejects the row", () => {
		expect(normalizeDecision("accepted", "blocking")).toBe("blocked");
		expect(normalizeDecision("rejected", "blocking")).toBe("rejected");
	});
});
