import type { Job } from "bullmq";
import type { JobResult } from "@/lib/queue";
import type { ImportCommitJobData, ImportScanJobData } from "./types";

export async function processImportReviewScanJob(
	_job: Job<ImportScanJobData>,
): Promise<JobResult> {
	return { success: true, message: "Import review scan queued" };
}

export async function processImportReviewCommitJob(
	_job: Job<ImportCommitJobData>,
): Promise<JobResult> {
	return { success: true, message: "Import review commit queued" };
}
