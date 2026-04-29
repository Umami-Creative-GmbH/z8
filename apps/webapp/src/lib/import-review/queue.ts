import { addJob } from "@/lib/queue";
import type { ImportCommitJobData, ImportScanJobData } from "./types";

export async function enqueueImportScanJob(data: ImportScanJobData) {
	const queueJobId = `import-review-scan-${data.jobId}`;
	return addJob(queueJobId, data, { priority: 4, jobId: queueJobId });
}

export async function enqueueImportCommitJob(data: ImportCommitJobData) {
	const queueJobId = `import-review-commit-${data.jobId}`;
	return addJob(queueJobId, data, { priority: 4, jobId: queueJobId });
}
