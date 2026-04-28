import type { Job } from "bullmq";
import type { JobResult } from "@/lib/queue";
import { scanClockinImportPartition } from "./clockin-adapter";
import { scanClockodoImportPartition } from "./clockodo-adapter";
import { commitAcceptedRowsForEntity } from "./committers";
import { updateImportBatchJob } from "./repository";
import type { ImportCommitJobData, ImportScanJobData } from "./types";

type ImportReviewJobData = ImportScanJobData | ImportCommitJobData;

function isFinalAttempt(job: Job<ImportReviewJobData>): boolean {
	const maxAttempts = typeof job.opts.attempts === "number" && job.opts.attempts > 0 ? job.opts.attempts : 1;
	return job.attemptsMade + 1 >= maxAttempts;
}

async function markRunning(data: ImportReviewJobData) {
	await updateImportBatchJob({
		jobId: data.jobId,
		organizationId: data.organizationId,
		status: "running",
		errorMessage: null,
	});
}

async function markCompleted(data: ImportReviewJobData, processedRows: number) {
	await updateImportBatchJob({
		jobId: data.jobId,
		organizationId: data.organizationId,
		status: "completed",
		processedRows,
		errorMessage: null,
	});
}

async function markFailed(data: ImportReviewJobData, errorMessage: string) {
	await updateImportBatchJob({
		jobId: data.jobId,
		organizationId: data.organizationId,
		status: "failed",
		errorMessage: errorMessage,
	});
}

export async function processImportReviewJob(job: Job<ImportReviewJobData>): Promise<JobResult> {
	const { data } = job;

	try {
		await markRunning(data);

		switch (data.type) {
			case "import-review-scan": {
				let processedRows: number;
				switch (data.provider) {
					case "clockin":
						processedRows = await scanClockinImportPartition(data);
						break;
					case "clockodo":
						processedRows = await scanClockodoImportPartition(data);
						break;
					default:
						throw new Error(`Unsupported import review provider: ${String(data.provider)}`);
				}

				await markCompleted(data, processedRows);
				return {
					success: true,
					message: "Import review scan completed",
					data: { processedRows },
				};
			}

			case "import-review-commit": {
				const committedRows = await commitAcceptedRowsForEntity(data);
				await markCompleted(data, committedRows);
				return {
					success: true,
					message: "Import review commit completed",
					data: { committedRows },
				};
			}

			default:
				throw new Error(`Unsupported import review job type: ${String(data.type)}`);
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		if (isFinalAttempt(job)) await markFailed(data, errorMessage);
		throw error;
	}
}

export async function processImportReviewScanJob(
	job: Job<ImportScanJobData>,
): Promise<JobResult> {
	return processImportReviewJob(job);
}

export async function processImportReviewCommitJob(
	job: Job<ImportCommitJobData>,
): Promise<JobResult> {
	return processImportReviewJob(job);
}
