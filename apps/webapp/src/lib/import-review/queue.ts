import { addJob } from "@/lib/queue";
import type { ImportCommitJobData, ImportScanJobData } from "./types";

export async function enqueueImportScanJob(data: ImportScanJobData) {
	return addJob(`import-review-scan-${data.jobId}`, data, { priority: 4 });
}

export async function enqueueImportCommitJob(data: ImportCommitJobData) {
	return addJob(`import-review-commit-${data.jobId}`, data, { priority: 4 });
}
