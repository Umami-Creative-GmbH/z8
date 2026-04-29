import type { ImportBatchStatus, ImportIssueSeverity, ImportJobStatus, ImportRowStatus } from "./types";

export function nextBatchStatusAfterJobs(currentStatus: ImportBatchStatus, jobs: Array<{ status: ImportJobStatus }>): ImportBatchStatus {
	if (currentStatus !== "scanning" && currentStatus !== "committing") return currentStatus;
	if (jobs.some((job) => job.status === "failed")) return currentStatus === "scanning" ? "scan_failed" : "commit_failed";
	if (jobs.length > 0 && jobs.every((job) => job.status === "completed")) return currentStatus === "scanning" ? "needs_review" : "completed";
	return currentStatus;
}

export function normalizeDecision(requestedStatus: "accepted" | "rejected", severity: ImportIssueSeverity): ImportRowStatus {
	if (requestedStatus === "rejected") return "rejected";
	return severity === "blocking" ? "blocked" : "accepted";
}

export function canCommitRow(row: { rowStatus: ImportRowStatus; issueSeverity: ImportIssueSeverity }): boolean {
	return row.rowStatus === "accepted" && row.issueSeverity !== "blocking";
}
